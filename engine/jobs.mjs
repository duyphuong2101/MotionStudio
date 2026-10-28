import fs from 'node:fs';
import path from 'node:path';
import {
  DIRS, ID_RE, StudioError, assertId, assertFileName, within, readJson, writeJson, exists, nowIso, listIds,
} from './core.mjs';
import { rendererDir } from './templates.mjs';
import { validateBrand, hostsFromSite, urlCheck } from './brand.mjs';
import { MAX_MIX_EXTRAS, isMixable, composeBeats, splitKind } from './mix.mjs';
import { draftScenes } from './script.mjs';

export { hostsFromSite };

export const STEPS = [
  { n: 1, id: 'brief', label: 'Brief', who: 'human' },
  { n: 2, id: 'pick', label: 'Director picks job', who: 'director' },
  { n: 3, id: 'source', label: 'Source data', who: 'director' },
  { n: 4, id: 'script', label: 'Script', who: 'director' },
  { n: 5, id: 'timing', label: 'Voice / timing', who: 'tool' },
  { n: 6, id: 'compose', label: 'Compose HTML scenes', who: 'tool' },
  { n: 7, id: 'stills', label: 'Lint + storyboard', who: 'tool' },
  { n: 8, id: 'review', label: 'Review', who: 'human' },
  { n: 9, id: 'render', label: 'Render', who: 'tool' },
  { n: 10, id: 'export', label: 'Audio + export', who: 'tool' },
  { n: 11, id: 'done', label: 'Done', who: 'tool' },
];

export const STATUSES = [
  'queued', 'scripting', 'scripted', 'dirty', 'preparing', 'awaiting_review',
  'approved', 'rendering', 'done', 'error',
];

const MAX_HISTORY = 60;

/** Where a video will be posted. `formats` are the aspect ratios that platform shows well, best first. */
export const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', formats: ['9:16'] },
  { id: 'reels', label: 'Instagram Reels', formats: ['9:16'] },
  { id: 'shorts', label: 'YouTube Shorts', formats: ['9:16'] },
  { id: 'stories', label: 'Instagram / Facebook Stories', formats: ['9:16'] },
  { id: 'feed', label: 'Instagram / Facebook feed', formats: ['4:5', '1:1', '9:16'] },
  { id: 'linkedin', label: 'LinkedIn', formats: ['1:1', '4:5', '16:9', '9:16'] },
  { id: 'x', label: 'X', formats: ['16:9', '1:1', '4:5'] },
  { id: 'youtube', label: 'YouTube', formats: ['16:9'] },
  { id: 'pinterest', label: 'Pinterest', formats: ['2:3', '9:16', '1:1'] },
  { id: 'web', label: 'Website / presentation', formats: ['16:9', '21:9', '1:1'] },
];

export const profileDir = (project) => within(DIRS.profiles, assertId(project, 'project'));
export const briefFile = (project, id) => within(DIRS.briefs, assertId(project, 'project'), `${assertId(id, 'job')}.json`);
export const jobDir = (project, id) => within(DIRS.out, assertId(project, 'project'), assertId(id, 'job'));
export const jobFile = (project, id, name) => within(jobDir(project, id), name);
// Sequence ids share the job namespace of a project: both write to out/<project>/<id>/.
export const sequenceFile = (project, id) => within(DIRS.sequences, assertId(project, 'project'), `${assertId(id, 'sequence')}.json`);

export function sequenceIds(project) {
  const dir = within(DIRS.sequences, assertId(project, 'project'));
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id)).sort();
}

export function listProjects() {
  return listIds(DIRS.profiles).map((id) => ({ id, brand: readJson(path.join(DIRS.profiles, id, 'brand.json'), {}) }));
}

export function loadBrand(project) {
  return readJson(path.join(profileDir(project), 'brand.json'));
}

export function loadVoiceNotes(project) {
  const file = path.join(profileDir(project), 'voice.md');
  return exists(file) ? fs.readFileSync(file, 'utf8') : '';
}

const DEFAULT_BRAND = {
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter', googleFonts: 'family=Inter:wght@400;600;800' },
  voice: { tts: 'kokoro', voice: 'af_heart', speed: 1, lang: 'en' },
  music: { file: null, gainDb: -18 },
};

/**
 * Creates profiles/<id>/ with brand.json, a starter voice.md and an empty assets folder.
 * `from` copies another project's look (colors, fonts, voice) but not its files, logo or sources.
 */
export function createProject({ id, name, site = '', from = '' } = {}) {
  const dir = profileDir(id);
  if (exists(dir)) throw new StudioError(`Project ${id} already exists`, 409);
  const base = from ? loadBrand(from) : DEFAULT_BRAND;
  const music = base.music?.file && String(base.music.file).startsWith('library:') ? base.music : { file: null, gainDb: base.music?.gainDb ?? -18, duck: base.music?.duck };
  const brand = validateBrand({
    ...base, name, site: String(site || '').trim(), logoText: '', logo: null, logoDark: null, music,
    sources: { allowedHosts: hostsFromSite(site) },
  });
  writeJson(path.join(dir, 'brand.json'), brand);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'voice.md'), `# ${name} voice

- Audience: who watches these videos and what they care about.
- Tone: three words for how the brand talks.
- Words to avoid:
- Every claim on screen must come from the reference page or the facts in the brief.
- CTA default:
`, 'utf8');
  return { id, brand };
}

const BUSY = ['scripting', 'preparing', 'rendering'];

/**
 * Moves a project's profile, briefs and output into trash/<id>-<time>/ instead of deleting them,
 * so a slip can be undone by moving the folders back. `confirm` must repeat the id.
 */
export function deleteProject(id, confirm) {
  const profile = profileDir(id);
  if (!exists(profile)) throw new StudioError(`Unknown project: ${id}`, 404);
  if (confirm !== id) throw new StudioError(`Type the project id "${id}" to confirm`, 400);
  if (listIds(DIRS.profiles).length <= 1) throw new StudioError('This is the only project. Create another one before deleting it.', 409);
  const busy = [
    ...listJobs(id).filter((j) => BUSY.includes(j.status.status)).map((j) => j.brief.id),
    ...sequenceIds(id).filter((s) => readJson(jobFile(id, s, 'status.json'), {}).status === 'rendering'),
  ];
  if (busy.length) throw new StudioError(`Wait until these jobs finish: ${busy.join(', ')}`, 409);
  const trash = within(DIRS.trash, `${id}-${nowIso().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(trash, { recursive: true });
  const moved = [];
  // Output first: it is the folder most likely held open (a video in a player), and failing there moves nothing else.
  for (const kind of ['out', 'briefs', 'sequences', 'profiles']) {
    const src = within(DIRS[kind], id);
    if (!exists(src)) continue;
    try {
      fs.renameSync(src, path.join(trash, kind));
      moved.push(kind);
    } catch (err) {
      if (!moved.length) fs.rmdirSync(trash);
      throw new StudioError(`Could not move ${kind}/${id} (${err.code || err.message}). Close any file of this project that is open and try again.${moved.length ? ` Already moved to trash: ${moved.join(', ')}.` : ''}`, 409);
    }
  }
  return { id, trash: path.relative(DIRS.trash, trash), moved };
}

/**
 * Moves one job's brief and output into trash/<project>-<id>-<time>/. Refused while the job is busy
 * or while a sequence still plays it, so no sequence is left pointing at a missing video.
 */
export function deleteJob(project, id) {
  const file = briefFile(project, id);
  if (!exists(file)) throw new StudioError(`Unknown job: ${project}/${id}`, 404);
  const st = getStatus(project, id);
  if (BUSY.includes(st.status)) throw new StudioError(`Job is ${st.status}. Wait until it finishes.`, 409);
  const usedBy = sequenceIds(project).filter((s) => (readJson(sequenceFile(project, s), {}).parts || []).includes(id));
  if (usedBy.length) throw new StudioError(`Sequence ${usedBy.join(', ')} plays this job. Remove it from the sequence first.`, 409);
  const trash = within(DIRS.trash, `${project}-${id}-${nowIso().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(trash, { recursive: true });
  const dir = jobDir(project, id);
  try {
    if (exists(dir)) fs.renameSync(dir, path.join(trash, 'out'));
  } catch (err) {
    fs.rmdirSync(trash);
    throw new StudioError(`Could not move out/${project}/${id} (${err.code || err.message}). Close the video if it is open and try again.`, 409);
  }
  fs.renameSync(file, path.join(trash, 'brief.json'));
  return { id, trash: path.relative(DIRS.trash, trash) };
}

export function listAssets(project) {
  const dir = path.join(profileDir(project), 'assets');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|svg|wav|mp3|m4a|mp4|webm|mov|glb|json)$/i.test(f)).sort();
}

export function assetPath(project, name) {
  assertFileName(name, 'asset');
  const file = within(path.join(profileDir(project), 'assets'), name);
  if (!exists(file)) throw new StudioError(`Asset not found in profiles/${project}/assets: ${name}`, 404);
  return file;
}

export function loadBrief(project, id) {
  return readJson(briefFile(project, id));
}

export function listTemplates() {
  return listIds(DIRS.templates).map((id) => readJson(path.join(DIRS.templates, id, 'beats.json')));
}

export function loadTemplate(id) {
  assertId(id, 'template');
  const dir = within(DIRS.templates, id);
  if (!exists(path.join(dir, 'beats.json'))) throw new StudioError(`Unknown template: ${id}`, 400);
  const beats = readJson(path.join(dir, 'beats.json'));
  return { dir: rendererDir(id, beats), beats };
}

/** The rules a brief's script follows: its template's beats, composed with the extras when the brief mixes. */
export function loadBriefTemplate(brief) {
  const lead = loadTemplate(brief.template);
  const mix = brief.mix || [];
  return mix.length ? { dir: lead.dir, beats: composeBeats(lead.beats, mix.map((id) => loadTemplate(id).beats)) } : lead;
}

/** Checks a brief's mix against its lead template and returns the formats every template in it shares. */
function mixFormats(lead, mix, errors) {
  if (mix.length > MAX_MIX_EXTRAS) errors.push(`A brief mixes at most ${MAX_MIX_EXTRAS} other templates`);
  const extras = [];
  mix.forEach((id, i) => {
    if (id === lead.id) errors.push(`${id} is already the brief's template`);
    else if (mix.indexOf(id) !== i) errors.push(`${id} is in the mix twice`);
    else try { extras.push(loadTemplate(id).beats); } catch (e) { errors.push(e.message); }
  });
  for (const t of [lead, ...extras]) if (!isMixable(t)) errors.push(`Template ${t.id} cannot be mixed in`);
  // Two templates drawn by one renderer would put its page (global ids, shared state) twice into one video.
  const renderers = new Map();
  for (const t of [lead, ...extras]) {
    const r = t.extends || t.id;
    if (renderers.has(r)) errors.push(`${t.id} and ${renderers.get(r)} share one renderer and cannot be mixed`);
    else renderers.set(r, t.id);
  }
  return lead.formats.filter((f) => extras.every((x) => x.formats.includes(f)));
}

export function validateBrief(input, { providers } = {}) {
  const errors = [];
  const b = { ...input };
  try { assertId(b.project, 'project'); } catch (e) { errors.push(e.message); }
  try { assertId(b.id, 'id'); } catch (e) { errors.push(e.message); }
  b.mix ??= [];
  if (!Array.isArray(b.mix) || !b.mix.every((x) => typeof x === 'string')) {
    errors.push('mix must be a list of template ids');
    b.mix = [];
  }
  let beats = null;
  try { beats = loadTemplate(b.template).beats; } catch (e) { errors.push(e.message); }
  if (beats) {
    const formats = b.mix.length ? mixFormats(beats, b.mix, errors) : beats.formats;
    if (!formats.includes(b.format)) {
      if (!b.mix.length) errors.push(`Template ${b.template} supports formats: ${beats.formats.join(', ')}`);
      else errors.push(formats.length ? `These templates share formats: ${formats.join(', ')}` : 'These templates share no format');
    }
    // Extra cuts: the same script and voice rendered at other frame sizes the template (or the mix) supports.
    b.alsoFormats ??= [];
    if (!Array.isArray(b.alsoFormats) || !b.alsoFormats.every((x) => typeof x === 'string')) { errors.push('alsoFormats must be a list of formats'); b.alsoFormats = []; }
    b.alsoFormats = [...new Set(b.alsoFormats)];
    if (b.alsoFormats.length > MAX_CUTS) errors.push(`At most ${MAX_CUTS} extra formats`);
    if (b.alsoFormats.includes(b.format)) errors.push(`${b.format} is already the main format`);
    const bad = b.alsoFormats.filter((f) => !formats.includes(f));
    if (bad.length) errors.push(`${bad.join(', ')} not available: these templates make ${formats.join(', ') || 'no shared format'}`);
    if (b.alsoFormats.length && beats.audio === 'footage') errors.push('A footage template makes one format for now');
    const d = Number(b.duration);
    if (!Number.isFinite(d) || d < beats.durations[0] || d > beats.durations[1]) errors.push(`Duration must be ${beats.durations[0]}-${beats.durations[1]} s`);
    b.duration = d;
  }
  // The UI no longer asks: only the seat director exists, so a brief without one gets the default.
  b.director ||= providers?.default || 'seat';
  if (providers && !providers.providers[b.director]) errors.push(`Unknown director: ${b.director}`);
  if (b.platform) {
    const p = PLATFORMS.find((x) => x.id === b.platform);
    if (!p) errors.push(`Unknown platform: ${b.platform}`);
    else if (!p.formats.includes(b.format)) errors.push(`${p.label} takes ${p.formats.join(', ')}, not ${b.format}`);
  }
  // Optional per-video language and voice; absent means the brand's voice.
  if (b.lang && !LANG_RE.test(b.lang)) errors.push('lang must look like en, es or en-gb');
  if (b.voice && !BRIEF_VOICE_RE.test(b.voice)) errors.push('voice must be "kokoro:<voice>", "sapi:<voice>" or "none:"');
  // A recorded voice-over: an audio asset of the project, checked for existence at prepare.
  if (b.voiceTake) {
    try { assertFileName(b.voiceTake, 'voiceTake'); } catch (e) { errors.push(e.message); }
    if (!VOICE_TAKE_RE.test(String(b.voiceTake))) errors.push('voiceTake must be a .wav, .mp3 or .m4a asset');
  }
  if (b.cutOnBeat !== undefined && typeof b.cutOnBeat !== 'boolean') errors.push('cutOnBeat must be true or false');
  if (b.motionBlur !== undefined && typeof b.motionBlur !== 'boolean') errors.push('motionBlur must be true or false');
  if (b.subject == null && b.sku != null) b.subject = b.sku;
  for (const [k, max] of [['message', 400], ['cta', 80], ['notes', 1000], ['subject', 64], ['facts', 2000]]) {
    if (b[k] != null && (typeof b[k] !== 'string' || b[k].length > max)) errors.push(`${k} must be text up to ${max} characters`);
  }
  if (!b.message) errors.push('message is required');
  if (b.url) {
    try {
      const u = new URL(b.url);
      if (!['https:', 'http:'].includes(u.protocol)) throw new Error();
    } catch { errors.push('url must be an http(s) URL'); }
  }
  if (errors.length) throw new StudioError(errors.join('; '), 400);
  return {
    id: b.id, project: b.project, template: b.template, mix: b.mix, format: b.format, duration: b.duration,
    platform: b.platform || '', director: b.director, url: b.url || '', subject: b.subject || '', message: b.message,
    lang: b.lang || '', voice: b.voice || '', ...(b.voiceTake ? { voiceTake: b.voiceTake } : {}),
    alsoFormats: b.alsoFormats || [], cutOnBeat: b.cutOnBeat === true, motionBlur: b.motionBlur === true,
    facts: b.facts || '', cta: b.cta || '', notes: b.notes || '', createdBy: b.createdBy || 'ui', createdAt: b.createdAt || nowIso(),
  };
}

// Checked when a brief is written, never when it is read, so an older brief still loads.
function assertBriefHost(brief) {
  if (!brief.url) return;
  const check = urlCheck(brief.url, loadBrand(brief.project).sources?.allowedHosts);
  if (check.allowed) return;
  if (!check.host) throw new StudioError('url must be an http(s) URL', 400);
  throw new StudioError(`The brief URL host ${check.host} is not in this brand's allowed hosts. Add it in Brand → Allowed data hosts, or clear the URL.`, 400);
}

export function saveBrief(brief) {
  const file = briefFile(brief.project, brief.id);
  if (exists(file)) throw new StudioError(`Brief ${brief.project}/${brief.id} already exists`, 409);
  if (exists(sequenceFile(brief.project, brief.id))) throw new StudioError(`${brief.id} is already a sequence id in ${brief.project}. Pick another job id.`, 409);
  assertBriefHost(brief);
  writeJson(file, brief);
  return brief;
}

const BRIEF_FIELDS = ['template', 'mix', 'format', 'duration', 'platform', 'director', 'url', 'subject', 'message', 'facts', 'cta', 'notes', 'lang', 'voice', 'voiceTake', 'alsoFormats', 'cutOnBeat', 'motionBlur'];
// Changing only these needs a new storyboard (prepare), not a new script from the Director. A script does not
// depend on the frame size: beats.json has no per-format rule and alsoFormats renders one script at other sizes.
const PREPARE_ONLY = ['voice', 'voiceTake', 'alsoFormats', 'cutOnBeat', 'format'];
// Changing only these redoes nothing and keeps the approval: motionBlur touches the render alone, platform is read
// fresh by the render's QA (expect.platformFormats), director picks the backend of the next run.
const NO_STEP = ['motionBlur', 'platform', 'director'];
// Changing any of these means the Director reads the page or the facts again (dirty from step 1).
const SOURCE_INPUTS = ['url', 'subject', 'message', 'facts'];
// Where a template or mix change keeps the script it replaces, and the locks that still hold under the new rules.
const PREV_SCRIPT = 'script.prev.json';
const CARRIED_LOCKS = 'script.locks.json';
export const MAX_CUTS = 3;
export const cutSlug = (format) => format.replace(':', 'x');
export const LANG_RE = /^[a-z]{2}(-[a-z]{2})?$/;
export const BRIEF_VOICE_RE = /^(kokoro|sapi):[A-Za-z0-9 _()-]{1,60}$|^none:$/;
export const VOICE_TAKE_RE = /\.(wav|mp3|m4a)$/i;

/**
 * Rewrites a brief in place; id, project and creation stay. Once the director has written source.json or
 * script.json, a change sends the job back to the director (dirty from step 1, the brief). A template or mix
 * change after a script exists moves the script to script.prev.json and sends the job back from step 3, so the
 * Director writes a new script for the new rules on the kept source.
 */
export function updateBrief(project, id, input, { providers, by = 'ui' } = {}) {
  const stored = loadBrief(project, id);
  for (const k of ['id', 'project']) {
    if (input[k] != null && input[k] !== stored[k]) throw new StudioError(`The ${k === 'id' ? 'job id' : 'project'} of a brief cannot change. Duplicate the brief instead.`, 400);
  }
  const st = getStatus(project, id);
  if (BUSY.includes(st.status)) throw new StudioError(`Job is ${st.status}. Wait until it finishes, then edit the brief.`, 409);
  const next = validateBrief({
    ...input, id, project, director: input.director || stored.director, createdBy: stored.createdBy, createdAt: stored.createdAt,
  }, { providers });
  assertBriefHost(next);
  const was =(k) => (k === 'subject' ? stored.subject ?? stored.sku : k === 'mix' || k === 'alsoFormats' ? stored[k] || [] : k === 'cutOnBeat' || k === 'motionBlur' ? stored[k] === true : stored[k]) ?? '';
  const changed = BRIEF_FIELDS.filter((k) => !same(next[k] ?? '', was(k)));
  if (!changed.length) return { brief: stored, changed, requeued: false };
  const script = jobFile(project, id, 'script.json');
  const hasScript = exists(script);
  // A script follows its template's rules, so another template or mix needs a new one. The old script moves aside
  // to script.prev.json; source.json stays. Its locks that still hold under the new rules go to script.locks.json.
  const newScript = hasScript && (changed.includes('template') || changed.includes('mix'));
  const carried = newScript ? archiveScript(project, id, script, stored, next) : [];
  const brief = { ...next, updatedAt: nowIso() };
  writeJson(briefFile(project, id), brief);
  const started = hasScript || exists(jobFile(project, id, 'source.json'));
  if (changed.every((k) => NO_STEP.includes(k))) return { brief, changed, requeued: false, rePrepare: false };
  const prepareOnly = hasScript && changed.every((k) => PREPARE_ONLY.includes(k) || NO_STEP.includes(k));
  const from = prepareOnly ? 5 : newScript && !changed.some((k) => SOURCE_INPUTS.includes(k)) ? 3 : 1;
  // An earlier edit the Director has not handled yet keeps its lower step.
  const dirtyFrom = Math.min(from, st.status === 'dirty' ? st.dirty_from ?? 99 : 99);
  const moved = newScript ? `; script moved to script.prev.json${carried.length ? `; locks carried: ${carried.join(', ')}` : ''}` : '';
  if (started) setStatus(project, id, { status: 'dirty', dirty_from: dirtyFrom, step: dirtyFrom }, `brief edited in UI: ${changed.join(', ')}${moved}`, by);
  return { brief, changed, requeued: started && dirtyFrom < 5, rePrepare: started && dirtyFrom === 5, newScript };
}

/** Moves script.json to script.prev.json and writes the locks that carry to the new rules; returns their keys. */
function archiveScript(project, id, script, oldBrief, newBrief) {
  const prev = jobFile(project, id, PREV_SCRIPT);
  let carry = null;
  // Old rules that no longer load (a removed template) carry nothing.
  try { carry = carryLocks(readJson(script, null), loadBriefTemplate(oldBrief).beats, loadBriefTemplate(newBrief).beats); } catch { carry = null; }
  try {
    fs.rmSync(prev, { force: true });
    fs.renameSync(script, prev);
  } catch (err) {
    throw new StudioError(`Could not move script.json to ${PREV_SCRIPT} (${err.code || err.message}). Close the file if it is open and try again.`, 409);
  }
  const file = jobFile(project, id, CARRIED_LOCKS);
  fs.rmSync(file, { force: true });
  if (!carry) return [];
  writeJson(file, carry);
  return Object.keys(carry.locks);
}

// What validateScript checks on field `f` of a `kind` scene; null when the kind does not take the field.
function fieldRules(beats, kind, f) {
  const spec = beats.fields?.[kind];
  if (!spec || ![...spec.required, ...spec.optional].includes(f)) return null;
  const { tpl, kind: bare } = splitKind(kind);
  const r = (tpl ? beats.sources?.[tpl] : beats) || {};
  return JSON.stringify([spec, r.limits?.[f], f === 'vo' && r.limits?.voWords, r.enums?.[f], r.data?.[bare], r.marks === true, f === 'shots' && r.shots]);
}

/**
 * The locks of an old script that still hold under new rules: a field lock on a non-draft scene whose kind takes
 * that field under the same rules before and after, so the person's value stays valid. Scene order, kind and draft
 * locks belong to the old template and never carry. Returns a script-shaped doc for mergeRespectingLocks, or null.
 */
function carryLocks(prev, oldBeats, newBeats) {
  const locks = prev?.locks || {};
  const out = { carried: true, scenes: [], locks: {} };
  for (const s of prev?.scenes || []) {
    if (!s?.id || s.draft) continue;
    const scene = { id: s.id, kind: s.kind };
    let held = 0;
    for (const f of sceneFieldNames()) {
      const key = `scene:${s.id}.${f}`;
      const rule = locks[key] ? fieldRules(newBeats, s.kind, f) : null;
      if (!rule || rule !== fieldRules(oldBeats, s.kind, f)) continue;
      out.locks[key] = locks[key];
      if (s[f] !== undefined) scene[f] = s[f];
      held++;
    }
    if (held) out.scenes.push(scene);
  }
  // The look sets the brand overlay, not a template rule, so a person's look carries to any template.
  if (locks[LOOK_LOCK]) {
    out.locks[LOOK_LOCK] = locks[LOOK_LOCK];
    if (prev.look !== undefined) out.look = prev.look;
  }
  return out.scenes.length || out.locks[LOOK_LOCK] ? out : null;
}

/**
 * What a Director commit merges into: the committed source.json or script.json, or, for a script not written yet,
 * the locks a template or mix change carried over (script.locks.json).
 */
export function commitBase(project, id, kind) {
  const doc = readJson(jobFile(project, id, `${kind}.json`), null);
  return doc || kind !== 'script' ? doc : readJson(jobFile(project, id, CARRIED_LOCKS), null);
}

/** A person's way (CLI) to send a job back to step `from`. Refused while the job is busy unless `force`. */
export function markDirty(project, id, from, { force = false, by = 'cli' } = {}) {
  if (!exists(briefFile(project, id))) throw new StudioError(`Unknown job: ${project}/${id}`, 404);
  const n = Number(from);
  if (!Number.isInteger(n) || n < 1 || n > STEPS.length) throw new StudioError(`Give the step to redo from: a whole number 1-${STEPS.length}`, 400);
  const { status } = getStatus(project, id);
  const busy = BUSY.includes(status);
  if (busy && !force) throw new StudioError(`Job is ${status}. Wait until it finishes, or add --force if it is stuck.`, 409);
  return setStatus(project, id, { status: 'dirty', dirty_from: n, step: n }, `marked dirty from step ${n}${busy ? ` (forced while ${status})` : ''}`, by);
}

export function getStatus(project, id) {
  return readJson(jobFile(project, id, 'status.json'), {
    id, project, status: 'queued', step: 1, dirty_from: null, history: [],
  });
}

export function setStatus(project, id, patch, event, by = 'engine') {
  const cur = getStatus(project, id);
  if (patch.status && !STATUSES.includes(patch.status)) throw new StudioError(`Unknown status ${patch.status}`);
  const next = { ...cur, ...patch, id, project, updatedAt: nowIso() };
  // `failed` names what an error broke; any other status ends that error, unless the caller sets it.
  if (patch.status && patch.status !== 'error' && !('failed' in patch)) next.failed = null;
  if (event) next.history = [...(cur.history || []), { at: next.updatedAt, by, event }].slice(-MAX_HISTORY);
  writeJson(jobFile(project, id, 'status.json'), next);
  return next;
}

export function listJobs(project) {
  const projects = project ? [assertId(project, 'project')] : listIds(DIRS.briefs);
  const jobs = [];
  for (const p of projects) {
    const dir = path.join(DIRS.briefs, p);
    if (!exists(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const id = f.slice(0, -5);
      try {
        assertId(id);
        const brief = loadBrief(p, id);
        jobs.push({ brief, status: getStatus(p, id) });
      } catch { /* skip malformed brief files */ }
    }
  }
  return jobs.sort((a, b) => String(b.brief.createdAt).localeCompare(String(a.brief.createdAt)));
}

/* ---------- locks ----------
 * A human edit locks the fields it changed. A director commit keeps locked values,
 * so a re-run cannot silently undo what a person decided.
 */

const SOURCE_FIELDS = ['name', 'image', 'bullets', 'facts'];
// Every field any template's beats.json lets a scene carry, so a UI edit of any of them is locked.
let sceneFields = null;
const sceneFieldNames = () => sceneFields ||= [...new Set(listTemplates().flatMap((t) => Object.values(t.fields || {}).flatMap((f) => [...f.required, ...f.optional])))].sort();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Lock key for an edit that changed only bullet screenshots: no claim changed, so the Director may still rewrite bullets.
export const BULLET_ASSET_LOCK = 'bullets.asset';
// Lock key for the script's look (engine/looks.mjs): one top-level field, kept like a scene field.
const LOOK_LOCK = 'look';
const withoutAssets = (bullets) => (Array.isArray(bullets) ? bullets.map((b) => (b && typeof b === 'object' ? { ...b, asset: undefined } : b)) : bullets);

export function diffLocks(kind, before, after) {
  const keys = [];
  if (kind === 'source') {
    for (const f of SOURCE_FIELDS) {
      if (same(before?.[f], after?.[f])) continue;
      keys.push(f === 'bullets' && same(withoutAssets(before?.bullets), withoutAssets(after?.bullets)) ? BULLET_ASSET_LOCK : f);
    }
  } else {
    const bIds = (before?.scenes || []).map((s) => s.id);
    const aIds = (after?.scenes || []).map((s) => s.id);
    if (!same(bIds, aIds)) keys.push('scenes');
    if (!same(before?.look, after?.look)) keys.push(LOOK_LOCK);
    const byId = Object.fromEntries((before?.scenes || []).map((s) => [s.id, s]));
    for (const s of after?.scenes || []) {
      const old = byId[s.id];
      if (!old) continue;
      for (const f of sceneFieldNames()) if (!same(old[f], s[f])) keys.push(`scene:${s.id}.${f}`);
      if (!same(old.draft?.note, s.draft?.note)) keys.push(`scene:${s.id}.draft`);
    }
  }
  return keys;
}

/**
 * A source edit and a script edit with draft scenes go back to the Director (step 4); any other script edit re-runs
 * from step 5. A source edit that only set bullet screenshots changes no claim: null keeps the job status.
 */
export const editDirtyFrom = (kind, doc, changed = []) => {
  if (kind === 'source') return changed.length && changed.every((k) => k === BULLET_ASSET_LOCK) ? null : 4;
  return draftScenes(doc).length ? 4 : 5;
};

// The screenshots a person changed, by bullet text (null = removed). An asset-only edit keeps texts and order.
const assetChanges = (before = [], after = []) => Object.fromEntries(after
  .filter((b, i) => b.asset !== before[i]?.asset).map((b) => [b.text, b.asset ?? null]));

// Puts back the screenshot a person chose on each bullet whose text the draft kept; other bullets stay the Director's.
const keepBulletAssets = (chosen, bullets) => bullets.map((b) => {
  if (!b || !Object.hasOwn(chosen, b.text)) return b;
  const { asset, ...rest } = b;
  return chosen[b.text] ? { ...rest, asset: chosen[b.text] } : rest;
});

/**
 * A draft scene belongs to the Director except what the person chose: its id and position (the scene order),
 * its kind, its claim source and the draft note. Its content fields are never locked, so the Director can fill them.
 */
function lockDrafts(doc, before, locks, stamp, by) {
  const old = Object.fromEntries((before?.scenes || []).map((s) => [s.id, s]));
  for (const k of Object.keys(locks)) if (k.endsWith('.draft')) delete locks[k];
  doc.scenes = doc.scenes.map((s) => {
    if (!s.draft) return s;
    for (const f of sceneFieldNames()) if (f !== 'source') delete locks[`scene:${s.id}.${f}`];
    for (const k of ['scenes', `scene:${s.id}.kind`, `scene:${s.id}.source`]) locks[k] ||= stamp;
    const prev = old[s.id]?.draft;
    const note = String(s.draft.note ?? '').trim();
    return { ...s, draft: prev && prev.note === note ? prev : { note, by, at: stamp.at } };
  });
}

export function humanEdit(kind, before, after, by, note = '') {
  const changed = diffLocks(kind, before, after);
  const locks = { ...(before?.locks || {}) };
  const stamp = { by, at: nowIso(), note };
  for (const k of changed) locks[k] = stamp;
  if (changed.includes(BULLET_ASSET_LOCK)) {
    locks[BULLET_ASSET_LOCK] = { ...stamp, assets: { ...before?.locks?.[BULLET_ASSET_LOCK]?.assets, ...assetChanges(before?.bullets, after.bullets) } };
  }
  const doc = { ...after, locks };
  if (kind === 'script' && Array.isArray(doc.scenes)) lockDrafts(doc, before, locks, stamp, by);
  return { doc, changed };
}

export function mergeRespectingLocks(kind, existing, draft) {
  const locks = existing?.locks || {};
  if (!existing || !Object.keys(locks).length) return { doc: { ...draft, locks }, kept: [] };
  const kept = [];
  if (kind === 'source') {
    const doc = { ...draft, locks };
    for (const k of Object.keys(locks)) {
      if (k === BULLET_ASSET_LOCK) continue;
      // A field the person cleared stays cleared.
      if (k in existing) doc[k] = existing[k]; else delete doc[k];
      kept.push(k);
    }
    if (locks[BULLET_ASSET_LOCK]?.assets && !locks.bullets && Array.isArray(doc.bullets)) {
      doc.bullets = keepBulletAssets(locks[BULLET_ASSET_LOCK].assets, doc.bullets);
      kept.push(BULLET_ASSET_LOCK);
    }
    return { doc, kept };
  }
  const exById = Object.fromEntries((existing.scenes || []).map((s) => [s.id, s]));
  const drById = Object.fromEntries((draft.scenes || []).map((s) => [s.id, s]));
  // Locks carried from an older template hold only on a scene the Director writes with the same id and kind.
  const carried = existing.carried === true;
  let order = (draft.scenes || []).map((s) => s.id);
  if (locks.scenes) { order = (existing.scenes || []).map((s) => s.id); kept.push('scenes'); }
  const scenes = order.map((id) => {
    const base = { ...(drById[id] || exById[id]) };
    for (const f of sceneFieldNames()) {
      const key = `scene:${id}.${f}`;
      if (locks[key] && exById[id] && (!carried || drById[id]?.kind === exById[id].kind)) {
        if (exById[id][f] === undefined) delete base[f]; else base[f] = exById[id][f];
        kept.push(key);
      }
    }
    if (locks[`scene:${id}.kind`] && exById[id]) { base.kind = exById[id].kind; kept.push(`scene:${id}.kind`); }
    return base;
  });
  const doc = { ...draft, scenes };
  // A look the person picked (or cleared) stays, whatever template the scenes follow.
  if (locks[LOOK_LOCK]) {
    if (existing.look === undefined) delete doc.look; else doc.look = existing.look;
    kept.push(LOOK_LOCK);
  }
  // A carried lock the new script did not use lapses, so it cannot pin a later scene of another kind.
  doc.locks = carried ? Object.fromEntries(kept.map((k) => [k, locks[k]])) : locks;
  return { doc, kept };
}
