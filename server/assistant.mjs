// The Assistant panel's brain: no model. A typed line is matched to one of a few intents, read intents answer from
// the project's own files, and every write (a brief, a Director run, a sequence, a clip, a brand change) comes back
// as a proposal the person approves or cancels in the panel before anything is written. With `freeform` on
// (config/studio.json → assistant, user decision 2026-10-30) and a model picked in the composer, a line the parser
// does not know goes once to Gemini (server/assistant-model.mjs), which names one of the same intents; the proposal
// path after that is identical, so the model never writes.
import { StudioError, assertId, assertFileName, nowIso, loadStudioConfig } from '../engine/core.mjs';
import { listJobs, listTemplates, listAssets, loadBrand, loadBrief, getStatus, validateBrief, saveBrief, PLATFORMS } from '../engine/jobs.mjs';
import { listSequences, createSequence } from '../engine/sequences.mjs';
import { validateBrand, MOTIONS, SUBTITLE_STYLES, BACKDROPS, WIPES, BLENDS, REVEALS, EASES } from '../engine/brand.mjs';
import { MUSIC, SFX } from '../engine/library.mjs';

export const COMMANDS = [
  { name: '/brief', usage: '/brief <template> [16:9|9:16|1:1|4:5] <what the video should say>', help: 'Queue a new brief' },
  { name: '/status', usage: '/status [job]', help: 'Where the jobs stand' },
  { name: '/director', usage: '/director [job]', help: 'Run the Director on the jobs waiting for it' },
  { name: '/sequence', usage: '/sequence <job> <job> [...] [as <title>]', help: 'Join finished videos of one format' },
  { name: '/clip', usage: '/clip <asset.mp4> <from>-<to> [name]', help: 'Cut a clip from a video asset (seconds or m:ss)' },
  { name: '/brand', usage: '/brand <field> <value|off>', help: 'Change one brand field' },
  { name: '/help', usage: '/help', help: 'This list' },
];

const STATUS_LABEL = {
  queued: 'queued for the Director', scripting: 'with the Director', scripted: 'scripted', preparing: 'preparing', awaiting_review: 'awaiting review',
  approved: 'approved', rendering: 'rendering', done: 'done', error: 'failed', dirty: 'edited',
};
const QUESTION_MAX = 800;
const DEFAULT_SECONDS = 20;
const DEFAULT_TRANSITION = 'cut';
const BOOL = ['true', 'false'];
const HEX = /^#[0-9a-f]{6}$/i;
const TIME_RE = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/;
const FORMAT_RE = /^\d+:\d+$/;
const OFF = ['off', 'none', 'unset', 'default'];

/** The brand fields the panel may change: a list of values, a check, or free text with a cap. `off` removes the key. */
export const BRAND_FIELDS = {
  motion: { values: MOTIONS }, 'subtitles.style': { values: SUBTITLE_STYLES }, backdrop: { values: BACKDROPS }, wipe: { values: WIPES },
  blend: { values: BLENDS }, reveal: { values: ['words', ...REVEALS] }, ease: { values: Object.keys(EASES) }, 'music.file': { values: MUSIC.map((m) => m.id) },
  'sfx.cut': { values: [...SFX.map((s) => s.id), 'none'] }, 'music.duck': { values: BOOL }, leaks: { values: BOOL }, carry: { values: BOOL }, shine: { values: BOOL },
  confetti: { values: BOOL }, logoBug: { values: BOOL }, film: { values: BOOL },
  'colors.primary': { check: (v) => HEX.test(v), hint: '#rrggbb' }, 'colors.secondary': { check: (v) => HEX.test(v), hint: '#rrggbb' },
  'colors.accent': { check: (v) => HEX.test(v), hint: '#rrggbb' }, 'colors.bg': { check: (v) => HEX.test(v), hint: '#rrggbb' },
  'colors.fg': { check: (v) => HEX.test(v), hint: '#rrggbb' },
  'voice.voice': { max: 40 }, 'voice.lang': { max: 8 }, name: { max: 80 }, logoText: { max: 40 }, site: { max: 120 }, 'fonts.display': { max: 60 }, 'fonts.body': { max: 60 },
};

export function assistantConfig(cfg = loadStudioConfig()) {
  const a = cfg.assistant || {};
  return { ...a, approvalMinutes: Number(a.approvalMinutes) || 10, maxOpen: Number(a.maxOpen) || 20, freeform: a.freeform === true };
}

/* ---------- parsing ---------- */

const slug = (v) => String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const seconds = (s) => {
  const m = TIME_RE.exec(String(s).trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
};
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

function cleanText(text) {
  if (typeof text !== 'string') throw new StudioError('text must be a string', 400);
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) throw new StudioError('Type a question or a command', 400);
  if (t.length > QUESTION_MAX) throw new StudioError(`A message is at most ${QUESTION_MAX} characters`, 400);
  return t;
}

function briefArgs(rest, templates) {
  const ids = templates.map((t) => t.id);
  let template = null, format = null;
  const left = [];
  for (const w of words(rest)) {
    const lw = w.toLowerCase().replace(/[,.:;]+$/, '');
    if (!template && ids.includes(lw)) template = lw;
    else if (!format && FORMAT_RE.test(lw) && !left.length) format = lw;
    else left.push(w);
  }
  let message = left.join(' ').replace(/^(?:brief|video)\b[:\s]*/i, '').replace(/^(?:about|on|saying|that says|for|:)\s+/i, '').trim();
  message = message.replace(/^["“](.*)["”]$/, '$1');
  return { template, format, message };
}

function brandArgs(rest) {
  const m = /^(?:the\s+)?(?:brand\s+)?([a-zA-Z.]+)\s+(?:to\s+|=\s*)?(.+)$/.exec(rest.trim());
  if (!m) return null;
  return { field: m[1], value: m[2].trim().replace(/^["“](.*)["”]$/, '$1') };
}

function clipArgs(rest) {
  const m = /^(\S+)\s+(?:from\s+)?([\d:.]+)\s*(?:-|–|to)\s*([\d:.]+)(?:\s+(?:as\s+)?(\S+))?$/i.exec(rest.trim());
  if (!m) return null;
  return { asset: m[1], from: seconds(m[2]), to: seconds(m[3]), name: m[4] || null };
}

function sequenceArgs(rest) {
  const [list, title] = rest.split(/\s+as\s+/i);
  const parts = words(list.replace(/,/g, ' ')).map((w) => w.toLowerCase()).filter((w) => w !== 'and' && w !== 'of' && w !== 'from');
  return { parts, title: (title || '').trim() };
}

/**
 * One typed line → { intent, args } or { intent: 'unknown' }. A slash command is exact; a plain sentence is matched
 * on a few verbs. `templates` is the template list (ids for the brief intent).
 */
export function parseAsk(text, templates = listTemplates()) {
  const t = cleanText(text);
  const slash = /^\/([a-z]+)\s*(.*)$/s.exec(t);
  if (slash) {
    const [, cmd, rest] = slash;
    switch (cmd) {
      case 'help': return { intent: 'help', args: {} };
      case 'status': return { intent: 'status', args: { job: rest.trim().toLowerCase() || null } };
      case 'director': return { intent: 'director', args: { job: rest.trim().toLowerCase() || null } };
      case 'brief': return { intent: 'brief', args: briefArgs(rest, templates) };
      case 'sequence': return { intent: 'sequence', args: sequenceArgs(rest) };
      case 'clip': return { intent: 'clip', args: clipArgs(rest) };
      case 'brand': return { intent: 'brand', args: brandArgs(rest) };
      default: return { intent: 'unknown', args: { command: `/${cmd}` } };
    }
  }
  const low = t.toLowerCase();
  if (/^(help|what can you do|commands)\??$/.test(low)) return { intent: 'help', args: {} };
  let m;
  if ((m = /^run (?:the )?director(?: on (\S+))?\.?$/i.exec(t))) return { intent: 'director', args: { job: m[1]?.toLowerCase() || null } };
  if ((m = /^(?:set|change|make)\s+(?:the\s+)?(?:brand\s+)?([a-zA-Z.]+)\s+(?:to\s+|=\s*)(.+)$/i.exec(t))) return { intent: 'brand', args: { field: m[1], value: m[2].trim() } };
  if ((m = /^(?:make|create|cut)\s+(?:a\s+)?clip\s+(?:of|from)\s+(.+)$/i.exec(t))) return { intent: 'clip', args: clipArgs(m[1]) };
  if ((m = /^(?:make|create|build)\s+(?:a\s+)?sequence\s+(?:of|from|with)\s+(.+)$/i.exec(t))) return { intent: 'sequence', args: sequenceArgs(m[1]) };
  if ((m = /^(?:new|create|make|queue|add)\s+(?:a\s+|an\s+)?(.+)$/i.exec(t))) return { intent: 'brief', args: briefArgs(m[1], templates) };
  if (/\b(status|waiting|queued|queue|next|where|which jobs|what.*(?:left|pending|done|rendered))\b/.test(low)) {
    const job = /\b(?:status of|how is|where is)\s+([a-z0-9-]+)/.exec(low)?.[1] || null;
    return { intent: 'status', args: { job } };
  }
  return { intent: 'unknown', args: {} };
}

/** What the model may name: ids and values only, never a brief's text or a secret. Fits assistant.maxContextChars. */
export function modelContext(project) {
  const brand = loadBrand(project);
  const jobs = listJobs(project).map((j) => `${j.brief.id} (${j.brief.template}, ${j.brief.format}, ${STATUS_LABEL[j.status.status] || j.status.status})`);
  const fields = Object.entries(BRAND_FIELDS).map(([k, s]) => (s.values ? `${k}: ${s.values.join('|')}` : s.hint ? `${k}: ${s.hint}` : `${k}: text`));
  const set = (k) => getPath(brand, k.split('.'));
  const current = Object.keys(BRAND_FIELDS).filter((k) => set(k) !== undefined && typeof set(k) !== 'object').map((k) => `${k}=${set(k)}`);
  return [
    `Templates: ${listTemplates().map((t) => `${t.id} [${t.formats.join(' ')}]`).join(', ')}`,
    `Jobs: ${jobs.join('; ') || 'none'}`,
    `Video assets: ${listAssets(project).filter((a) => /\.(mp4|webm|mov)$/i.test(a)).join(', ') || 'none'}`,
    `Brand fields: ${fields.join('; ')}`,
    `Brand now: ${current.join(', ') || 'defaults'}`,
  ].join('\n');
}

/* ---------- read answers ---------- */

const helpAnswer = () => ({
  text: 'I work from this project\'s files. With a model picked below, a line I do not know goes once to that model, which only names what you meant. Every change comes back as a card you approve first.',
  rows: COMMANDS.map((c) => [c.usage, c.help]),
});

function statusAnswer(project, job) {
  const jobs = listJobs(project);
  if (job) {
    const it = jobs.find((j) => j.brief.id === job);
    if (!it) throw new StudioError(`No job ${job} in ${project}`, 404);
    const s = it.status;
    const rows = [['Template', [it.brief.template, ...(it.brief.mix || [])].join(' + ')], ['Format', it.brief.format], ['Status', STATUS_LABEL[s.status] || s.status]];
    if (s.status === 'dirty') rows.push(['Needs', (s.dirty_from ?? 99) < 5 ? 'the Director (Run Director)' : 'a new storyboard (Prepare)']);
    if (s.error) rows.push(['Error', String(s.error).slice(0, 200)]);
    if (s.outputs?.final) rows.push(['Output', s.outputs.final]);
    const last = s.history?.at?.(-1);
    if (last) rows.push(['Last', `${last.event} (${last.by || '?'}, ${last.at || ''})`]);
    return { text: `${job}: ${STATUS_LABEL[s.status] || s.status}.`, rows };
  }
  if (!jobs.length) return { text: `No jobs in ${project} yet. Start with /brief or the New brief button.`, rows: [] };
  const by = {};
  for (const j of jobs) {
    const key = j.status.status === 'dirty' ? ((j.status.dirty_from ?? 99) < 5 ? 'queued' : 'awaiting_review') : j.status.status;
    (by[key] ||= []).push(j.brief.id);
  }
  const rows = Object.entries(by).map(([k, ids]) => [STATUS_LABEL[k] || k, ids.join(', ')]);
  const waiting = (by.queued || []).length;
  const text = waiting ? `${jobs.length} job${jobs.length === 1 ? '' : 's'}; ${waiting} waiting for the Director.` : `${jobs.length} job${jobs.length === 1 ? '' : 's'}; none waiting for the Director.`;
  return { text, rows };
}

/* ---------- proposals ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function briefProposal(project, args, deps) {
  const { template, format, message } = args;
  const templates = listTemplates();
  if (!template) throw new StudioError(`Name a template: ${templates.map((t) => t.id).join(', ')}`, 400);
  if (!message) throw new StudioError('Say what the video should say, e.g. /brief explainer 16:9 Our new checkout takes 3 steps', 400);
  const t = templates.find((x) => x.id === template);
  const fmt = format || t.formats[0];
  const brand = loadBrand(project);
  const subject = words(message).slice(0, 4).join(' ');
  const base = `${slug(subject) || 'video'}-${fmt.replace(':', 'x')}`;
  const taken = new Set(listJobs(project).map((j) => j.brief.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  const brief = validateBrief({
    project, id, template, mix: [], format: fmt, platform: '', duration: clamp(DEFAULT_SECONDS, t.durations[0], t.durations[1]),
    subject: subject.slice(0, 64), message, facts: '', cta: '', notes: '', lang: '', voice: '', voiceTake: '', alsoFormats: [], quick: Boolean(t.quick),
    createdBy: deps.user,
  }, { providers: deps.providers() });
  deps.assertVoiceFits(project, brief);
  return {
    action: 'brief', args: brief,
    preview: { title: `New brief ${id}`, rows: [['Template', template + (brief.quick ? ' (quick)' : '')], ['Format', fmt], ['Length', `${brief.duration} s`], ['Message', message], ['Voice', brand?.voice?.voice || 'brand default']] },
    text: `A ${template} brief in ${fmt}. Approve to queue it for the Director.`,
  };
}

function directorProposal(project, args, deps) {
  const next = deps.nextRun(project);
  if (!next || !next.jobs.length) throw new StudioError('No jobs in this project are waiting for the Director', 409);
  if (args.job && !next.jobs.some((j) => j.id === args.job)) throw new StudioError(`${args.job} is not waiting for the Director`, 409);
  const jobs = args.job ? next.jobs.filter((j) => j.id === args.job) : next.jobs;
  return {
    action: 'director', args: { project, job: args.job },
    preview: { title: 'Run the Director', rows: [['Backend', next.label || next.backend?.label || 'Claude seat'], ['Jobs', jobs.map((j) => j.id).join(', ')], ...(next.model ? [['Model', next.model]] : [])] },
    text: `One Director run on ${jobs.length} job${jobs.length === 1 ? '' : 's'}. It writes the storyboard; it never renders or approves.`,
  };
}

function sequenceProposal(project, args) {
  const { parts, title } = args;
  if (parts.length < 2) throw new StudioError('A sequence needs at least two finished jobs: /sequence <job> <job>', 400);
  const jobs = listJobs(project);
  const found = parts.map((id) => jobs.find((j) => j.brief.id === id) || (() => { throw new StudioError(`No job ${id} in ${project}`, 404); })());
  const formats = [...new Set(found.map((j) => j.brief.format))];
  if (formats.length > 1) throw new StudioError(`The parts must share one format; these are ${formats.join(' and ')}`, 400);
  const notDone = found.filter((j) => j.status.status !== 'done').map((j) => j.brief.id);
  const taken = new Set([...listSequences(project).map((s) => s.sequence.id), ...jobs.map((j) => j.brief.id)]);
  const base = `${slug(title) || 'sequence'}-${formats[0].replace(':', 'x')}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  const doc = { project, id, title, format: formats[0], parts, transition: DEFAULT_TRANSITION };
  return {
    action: 'sequence', args: doc,
    preview: { title: `New sequence ${id}`, rows: [['Parts', parts.join(' → ')], ['Format', formats[0]], ['Transition', DEFAULT_TRANSITION], ...(notDone.length ? [['Not rendered yet', notDone.join(', ')]] : [])] },
    text: notDone.length ? 'Saved as a draft: it can render once every part is done.' : 'Approve to save it. Render it from the Sequences list.',
  };
}

function clipProposal(project, args) {
  if (!args || args.from == null || args.to == null) throw new StudioError('Give the asset and a span: /clip talk.mp4 0:04-0:12 [name]', 400);
  assertFileName(args.asset, 'asset');
  if (!listAssets(project).includes(args.asset)) throw new StudioError(`No asset ${args.asset} in ${project}`, 404);
  if (!/\.(mp4|webm|mov)$/i.test(args.asset)) throw new StudioError('A clip is cut from a video asset (.mp4, .webm or .mov)', 400);
  if (args.to <= args.from) throw new StudioError('The clip must end after it starts', 400);
  const name = args.name || `${slug(args.asset.replace(/\.[^.]+$/, ''))}-${Math.round(args.from)}-${Math.round(args.to)}`;
  return {
    action: 'clip', args: { project, asset: args.asset, body: { in: args.from, out: args.to, name } },
    preview: { title: `Clip ${name}.mp4`, rows: [['From', args.asset], ['Span', `${args.from} s to ${args.to} s (${Math.round((args.to - args.from) * 10) / 10} s)`]] },
    text: 'Approve to cut it with ffmpeg into the brand assets.',
  };
}

const setPath = (obj, keys, value) => {
  const [k, ...rest] = keys;
  if (!rest.length) { if (value === undefined) delete obj[k]; else obj[k] = value; return; }
  obj[k] = { ...(obj[k] || {}) };
  setPath(obj[k], rest, value);
  if (!Object.keys(obj[k]).length) delete obj[k];
};
const getPath = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);

function brandProposal(project, args) {
  if (!args) throw new StudioError('Say the field and the value: /brand motion cinematic', 400);
  const spec = BRAND_FIELDS[args.field];
  if (!spec) throw new StudioError(`I can change: ${Object.keys(BRAND_FIELDS).join(', ')}`, 400);
  const raw = args.value.trim();
  let value;
  if (OFF.includes(raw.toLowerCase())) value = undefined;
  else if (spec.values) {
    value = raw.toLowerCase();
    if (!spec.values.includes(value)) throw new StudioError(`${args.field} takes ${spec.values.join(', ')} or off`, 400);
    if (BOOL === spec.values) value = value === 'true';
  } else if (spec.check) {
    if (!spec.check(raw)) throw new StudioError(`${args.field} must look like ${spec.hint}`, 400);
    value = raw;
  } else {
    if (raw.length > spec.max) throw new StudioError(`${args.field} is at most ${spec.max} characters`, 400);
    value = raw;
  }
  const brand = loadBrand(project);
  const keys = args.field.split('.');
  const before = getPath(brand, keys);
  const next = structuredClone(brand);
  setPath(next, keys, value);
  if (args.field === 'wipe' && value !== undefined) delete next.blend;
  if (args.field === 'blend' && value !== undefined) delete next.wipe;
  const valid = validateBrand(next);
  const show = (v) => (v === undefined ? 'not set' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return {
    action: 'brand', args: { project, brand: valid },
    preview: { title: `Brand: ${args.field}`, rows: [['Before', show(before)], ['After', show(value)], ...(args.field === 'wipe' && brand.blend ? [['Also', 'blend off (a brand sets a wipe or a blend)']] : []), ...(args.field === 'blend' && brand.wipe ? [['Also', 'wipe off']] : [])] },
    text: 'Approve to save the brand. Jobs already prepared keep their look until the next prepare.',
  };
}

/* ---------- the assistant ---------- */

/**
 * One per server. `deps`: { user, providers(), assertVoiceFits(project, brief), nextRun(project), startDirector({project, job}),
 * makeClip(project, asset, body), saveBrand(project, brand), picker? (server/assistant-model.mjs) }. Proposals live in memory until approved, cancelled or
 * expired; a server restart forgets them, which is the safe side.
 */
export function createAssistant(deps, cfg = assistantConfig()) {
  const open = new Map();
  let seq = 0;
  const sweep = () => { const now = Date.now(); for (const [id, p] of open) if (p.expiresAtMs <= now) open.delete(id); };

  const propose = (project, p) => {
    sweep();
    if (open.size >= cfg.maxOpen) throw new StudioError(`${cfg.maxOpen} proposals are waiting. Approve or cancel some first.`, 429);
    const id = `p${++seq}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAtMs = Date.now() + cfg.approvalMinutes * 60000;
    open.set(id, { id, project, action: p.action, args: p.args, preview: p.preview, expiresAtMs, by: deps.user });
    return { id, action: p.action, preview: p.preview, expiresAt: new Date(expiresAtMs).toISOString() };
  };

  const execute = {
    brief: async (p) => { const b = saveBrief(p.args); return { text: `Queued ${b.id}. Run the Director when you are ready.`, rows: [['Job', b.id]], changed: 'jobs' }; },
    director: async (p) => { const r = await deps.startDirector(p.args); return { text: 'The Director is running. Its log is in the Jobs tab.', rows: [['Jobs', (r?.jobs || []).join(', ')]], changed: 'jobs' }; },
    sequence: async (p) => { const s = createSequence(p.args, deps.user); return { text: `Saved sequence ${s.id}.`, rows: [['Sequence', s.id]], changed: 'sequences' }; },
    clip: async (p) => { const r = await deps.makeClip(p.project, p.args.asset, p.args.body); return { text: `Saved ${r.name} to the brand assets.`, rows: [['Clip', r.name]], changed: 'brand' }; },
    brand: async (p) => { deps.saveBrand(p.project, p.args.brand); return { text: 'Brand saved.', rows: [], changed: 'brand' }; },
  };

  return {
    capabilities: () => ({
      freeform: cfg.freeform, commands: COMMANDS, approvalMinutes: cfg.approvalMinutes,
      models: cfg.freeform && deps.picker ? deps.picker.models() : [], model: deps.picker ? deps.picker.state() : null,
    }),

    /** Chips for an empty panel, from what the project holds right now. */
    suggestions(project) {
      assertId(project, 'project');
      const jobs = listJobs(project);
      const out = [];
      const waiting = jobs.filter((j) => j.status.status === 'queued' || (j.status.status === 'dirty' && (j.status.dirty_from ?? 99) < 5));
      if (waiting.length) out.push({ text: `Run the Director on ${waiting.length} waiting job${waiting.length === 1 ? '' : 's'}`, ask: '/director' });
      const done = jobs.filter((j) => j.status.status === 'done');
      const byFormat = {};
      for (const j of done) (byFormat[j.brief.format] ||= []).push(j.brief.id);
      const pair = Object.values(byFormat).find((ids) => ids.length >= 2);
      if (pair) out.push({ text: `Join ${pair[0]} and ${pair[1]} into a sequence`, ask: `/sequence ${pair[0]} ${pair[1]}` });
      out.push({ text: jobs.length ? 'Where do the jobs stand?' : 'Queue a first brief', ask: jobs.length ? '/status' : '/brief explainer 16:9 ' });
      const video = listAssets(project).find((a) => /\.(mp4|webm|mov)$/i.test(a));
      if (video) out.push({ text: `Cut a clip from ${video}`, ask: `/clip ${video} 0:00-0:05` });
      const brand = loadBrand(project);
      if (!brand.motion) out.push({ text: 'Try the cinematic motion profile', ask: '/brand motion cinematic' });
      return { scope: { project, label: brand.name || project }, suggestions: out.slice(0, 5) };
    },

    /**
     * One turn: an answer, or a proposal to approve. Never writes. The parser goes first; only a line it does not
     * know (or reads as a brief, clip or brand change with its parts missing), sent with a `model`, goes to the
     * picker (one capped request), and its pick takes the same road. A slash command never does.
     */
    async ask({ project, text, model = null }) {
      assertId(project, 'project');
      loadBrand(project);
      let { intent, args } = parseAsk(text);
      let via = null, reply = null;
      const weak = intent === 'unknown' ? !args.command : !text.trim().startsWith('/') && ((intent === 'brief' && !args.template) || ((intent === 'clip' || intent === 'brand') && !args));
      if (weak && model) {
        if (!deps.picker || !cfg.freeform) throw new StudioError('Freeform asks are off (config/studio.json → assistant.freeform)', 400);
        if (typeof model !== 'string') throw new StudioError('model must be a string', 400);
        const picked = await deps.picker.pick({ text: cleanText(text), model, context: modelContext(project) });
        ({ intent, args, reply } = picked);
        via = picked.model;
      }
      const tail = via ? { via } : {};
      switch (intent) {
        case 'help': return { intent, ...helpAnswer(), ...tail };
        case 'status': return { intent, ...statusAnswer(project, args.job), ...tail };
        case 'unknown': return {
          intent, ...tail,
          text: args.command ? `I do not know ${args.command}.` : reply || 'I did not catch that. Try one of the commands below, or a line like "new explainer 9:16 about our October offer".',
          rows: COMMANDS.map((c) => [c.usage, c.help]),
        };
        default: {
          const p = { brief: briefProposal, director: directorProposal, sequence: sequenceProposal, clip: clipProposal, brand: brandProposal }[intent](project, args, deps);
          return { intent, text: p.text, proposal: propose(project, p), ...tail };
        }
      }
    },

    approvals() { sweep(); return [...open.values()].map(({ id, project, action, preview, expiresAtMs }) => ({ id, project, action, preview, expiresAt: new Date(expiresAtMs).toISOString() })); },

    async approve(id) {
      sweep();
      const p = open.get(String(id));
      if (!p) throw new StudioError('This request expired or was already used. Ask again.', 409);
      open.delete(p.id);
      const r = await execute[p.action](p);
      return { ...r, action: p.action, at: nowIso() };
    },

    reject(id) { const had = open.delete(String(id)); return { ok: true, cancelled: had }; },
  };
}
