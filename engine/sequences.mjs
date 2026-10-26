import fs from 'node:fs';
import path from 'node:path';
import {
  DIRS, StudioError, assertId, within, readJson, writeJson, exists, nowIso, round, loadStudioConfig,
} from './core.mjs';
import { listTemplates, loadTemplate, loadBrief, loadBrand, getStatus, briefFile, jobFile, sequenceFile, sequenceIds } from './jobs.mjs';
import { sizeFor, qaFile, mixFilter, brandMusic, SPEECH_FILES } from './pipeline.mjs';
import { srtTime } from './timing.mjs';
import { ffmpeg, probeMedia } from './media.mjs';
import { MUSIC, isLibraryMusic } from './library.mjs';
import { SFX_FILE, cutSound, placeSound, writeSfxTrack } from './sfx.mjs';
import { SFX_GAIN_DB } from './brand.mjs';

/*
 * A sequence joins finished job videos (final.mp4, any template, one format) into one MP4.
 * It lives in sequences/<project>/<id>.json; its status and output go to out/<project>/<id>/,
 * which is why a sequence id may not be a job id of the same project. A part may appear twice.
 */

export const MIN_PARTS = 2;
export const MAX_PARTS = 12;
/**
 * How one part hands over to the next. Every preset but `cut` is an ffmpeg xfade with a matching acrossfade; the
 * neighbours overlap by `seconds`. The UI lists these in this order.
 */
export const TRANSITIONS = {
  cut: { label: 'Cut', seconds: 0 },
  fade: { label: 'Crossfade', xfade: 'fade', seconds: 0.4 },
  'dip-black': { label: 'Dip to black', xfade: 'custom', custom: 'dipBlack', seconds: 0.6 },
  'dip-white': { label: 'Dip to white', xfade: 'custom', custom: 'dipWhite', seconds: 0.6 },
  'wipe-left': { label: 'Wipe left', xfade: 'wipeleft', seconds: 0.5 },
  'wipe-up': { label: 'Wipe up', xfade: 'wipeup', seconds: 0.5 },
  'slide-left': { label: 'Slide left', xfade: 'slideleft', seconds: 0.5 },
  'slide-up': { label: 'Slide up', xfade: 'slideup', seconds: 0.5 },
  'smooth-left': { label: 'Smooth wipe', xfade: 'smoothleft', seconds: 0.6 },
  'circle-open': { label: 'Circle open', xfade: 'circleopen', seconds: 0.6 },
  'zoom-in': { label: 'Zoom in', xfade: 'zoomin', seconds: 0.5 },
  blur: { label: 'Blur', xfade: 'hblur', seconds: 0.5 },
  'clock-wipe': { label: 'Clock wipe', xfade: 'radial', seconds: 0.6 },
  'cover-left': { label: 'Cover left', xfade: 'coverleft', seconds: 0.5 },
  'reveal-left': { label: 'Reveal left', xfade: 'revealleft', seconds: 0.5 },
  slices: { label: 'Slices', xfade: 'hlslice', seconds: 0.5 },
  squeeze: { label: 'Squeeze', xfade: 'squeezeh', seconds: 0.5 },
  diagonal: { label: 'Diagonal wipe', xfade: 'diagtl', seconds: 0.5 },
  'fade-grey': { label: 'Fade through grey', xfade: 'fadegrays', seconds: 0.6 },
  // Custom xfade expressions (see CUSTOM below): the looks editing suites ship that ffmpeg has no preset for.
  flash: { label: 'Flash cut', xfade: 'custom', custom: 'flash', seconds: 0.35 },
  'zoom-punch': { label: 'Zoom punch', xfade: 'custom', custom: 'zoomPunch', seconds: 0.5 },
  'whip-left': { label: 'Whip pan', xfade: 'custom', custom: 'whip', seconds: 0.4 },
  spin: { label: 'Spin', xfade: 'custom', custom: 'spin', seconds: 0.5 },
  'luma-fade': { label: 'Film dissolve', xfade: 'custom', custom: 'luma', seconds: 0.6 },
};

/*
 * Custom xfade expressions. ffmpeg evaluates one expression per pixel and plane with A and B (the two inputs'
 * values here), P (1 at the start of the transition, 0 at its end), X, Y, W, H (of the current plane) and PLANE;
 * aN(x,y) / bN(x,y) sample plane N of either input at any point (clamped to the frame). The st()/ld() registers
 * are shared by xfade's slice threads and race, so every value is written out in full instead.
 */
const T = '(1-P)';
// Smoothstep of the progress, so a move starts and ends softly.
const E = `(${T}*${T}*(3-2*${T}))`;
const sample = (src, x, y) => `if(eq(PLANE,0),${src}0(${x},${y}),if(eq(PLANE,1),${src}1(${x},${y}),${src}2(${x},${y})))`;
const BLACK = 'if(eq(PLANE,0),16,128)';
// Samples `src` at (x, y) when that point is inside the frame, else black.
const inside = (src, x, y) => `if(between(${x},0,W-1)*between(${y},0,H-1),${sample(src, x, y)},${BLACK})`;
// Scaled sample about the frame centre.
const zoomed = (src, sc) => sample(src, `(X-W/2)/${sc}+W/2`, `(Y-H/2)/${sc}+H/2`);
// Rotated and scaled sample about the frame centre.
const spun = (src, ang, sc) => inside(src, `((X-W/2)*cos(${ang})-(Y-H/2)*sin(${ang}))/${sc}+W/2`, `((X-W/2)*sin(${ang})+(Y-H/2)*cos(${ang}))/${sc}+H/2`);
// A then B laid side by side and shifted left, for the whip pan.
const strip = (x) => `if(lt(${x},W),${sample('a', x, 'Y')},${sample('b', `(${x}-W)`, 'Y')})`;
// A's luma under this pixel, on any plane (chroma planes are half size).
const LUMA = 'a0(X*if(eq(PLANE,0),1,2),Y*if(eq(PLANE,0),1,2))/255';
// The flash curve: 0 at both ends, 1 in the middle, smoothed.
const FLASH = `(1-abs(1-2*P))*(1-abs(1-2*P))*(3-2*(1-abs(1-2*P)))`;
const WHIP_DX = `(${E}*W)`, WHIP_BLUR = `(6*${T}*(1-${T})*W*0.03)`;
// A dip through one colour: A goes down to it over the first half and B comes up from it over the second, each half
// smoothed. ffmpeg's fadeblack is black a fifth of the way in and holds it, which reads as a cut to black.
const half = (u) => `(${u})*(${u})*(3-2*(${u}))`;
const dip = (c) => `if(gt(P,0.5),${c}+(A-${c})*${half('2*P-1')},${c}+(B-${c})*${half('1-2*P')})`;
const CUSTOM = {
  // A white burst peaking mid-way, with the cut hidden under it.
  flash: `if(gt(P,0.5),A,B)*(1-${FLASH})+if(eq(PLANE,0),235,128)*${FLASH}`,
  // A pushes in towards the camera while B lands from slightly larger, dissolving between them.
  zoomPunch: `${zoomed('a', `(1+0.6*${E})`)}*(1-${E})+${zoomed('b', `(1.4-0.4*${E})`)}*${E}`,
  // Both frames fly left as one strip; three taps spread by the current speed give the motion blur.
  whip: `(${strip(`X+${WHIP_DX}-${WHIP_BLUR}`)}+${strip(`X+${WHIP_DX}`)}+${strip(`X+${WHIP_DX}+${WHIP_BLUR}`)})/3`,
  // A spins away and grows while B spins in from the other way, dissolving in the middle.
  spin: `${spun('a', `(0.5*${E})`, `(1+0.8*${E})`)}*(1-${E})+${spun('b', `(-0.5*(1-${E}))`, `(1+0.8*(1-${E}))`)}*${E}`,
  // B appears in the bright parts of A first, with a soft edge: a film dissolve. The edge spans 0.6 of the luma range,
  // so a frame of one even brightness (a dark scene) still turns over about a third of the join, not in two frames;
  // the threshold runs 1.6 so the darkest pixel is done by the end.
  luma: `A+(B-A)*clip((${LUMA}-(1-${T}*1.6))/0.6,0,1)`,
  dipBlack: dip(BLACK),
  dipWhite: dip('if(eq(PLANE,0),235,128)'),
};
/** The xfade filter options for a preset: a built-in transition, or custom with its expression. */
const xfadeOf = (preset) => preset.custom ? `transition=custom:expr='${CUSTOM[preset.custom]}'` : `transition=${preset.xfade}`;
export const FADE_SECONDS = TRANSITIONS.fade.seconds;
/** The presets as the UI shows them. */
export const transitionList = () => Object.entries(TRANSITIONS).map(([id, t]) => ({ id, label: t.label, seconds: t.seconds }));
const STATUSES = ['draft', 'rendering', 'done', 'error'];
const MAX_HISTORY = 30;
const TITLE_MAX = 80;
export const TARGET_RANGE = [10, 1200];
const EDITABLE = ['title', 'format', 'parts', 'transition', 'transitions', 'musicBed', 'targetDuration'];
// Editing only these keeps the render.
const KEEPS_RENDER = ['title', 'targetDuration'];
// ffmpeg stops this long before the server's run timeout kills the engine, so no ffmpeg is left orphaned.
const KILL_MARGIN_MS = 30000;
// The music bed comes in once at the start and leaves once at the end of the whole film.
const BED_FADE_IN = 0.5;
const BED_FADE_OUT = 2;
// A bed track shorter than the film loops: each copy stops LOOP_TAIL s before the track's end (built-in tracks fade
// out over their last 3 s) and crossfades over LOOP_XFADE s into the next copy, which starts at least LOOP_HEAD s
// in (built-in tracks fade in over their first 2 s).
const LOOP_TAIL = 4;
const LOOP_HEAD = 2;
const LOOP_XFADE = 2;
export const MAX_LOOP_COPIES = 32;

const seqDir = (project, id) => within(DIRS.out, assertId(project, 'project'), assertId(id, 'sequence'));
const seqOut = (project, id, name) => within(seqDir(project, id), name);

// Each render is kept as its own file, "<title or id> v<N>.mp4": a film someone has open is never overwritten (Windows
// refuses to replace an open file), and earlier cuts stay at hand. Sequences rendered before this wrote final.mp4.
export const VERSION_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79} v\d{1,4}\.mp4$/;

/** The file name stem of a sequence's renders: its title with only letters, digits, spaces, dots, dashes and underscores, else its id. */
export function versionBase(seq) {
  const t = String(seq.title || '').replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+/, '').slice(0, 72).replace(/[ .]+$/, '');
  return t || seq.id;
}

/** The next free "<base> v<N>.mp4" in a folder: one more than the highest version there. */
export function nextVersionFile(dir, base) {
  let n = 0;
  const pre = `${base} v`;
  for (const f of exists(dir) ? fs.readdirSync(dir) : []) {
    if (!f.startsWith(pre) || !f.endsWith('.mp4')) continue;
    const v = f.slice(pre.length, -4);
    if (/^\d{1,4}$/.test(v)) n = Math.max(n, Number(v));
  }
  return { file: `${base} v${n + 1}.mp4`, version: n + 1 };
}

function formatSize(format) {
  const t = listTemplates().find((x) => x.formats.includes(format));
  if (!t) throw new StudioError(`Unknown format: ${format}`, 400);
  return sizeFor(t, format);
}

function validateSequence(input) {
  const s = input || {};
  const errors = [];
  try { assertId(s.project, 'project'); } catch (e) { errors.push(e.message); }
  try { assertId(s.id, 'sequence'); } catch (e) { errors.push(e.message); }
  const formats = [...new Set(listTemplates().flatMap((t) => t.formats))];
  if (!formats.includes(s.format)) errors.push(`format must be one of: ${formats.join(', ')}`);
  if (!TRANSITIONS[s.transition]) errors.push(`transition must be one of: ${Object.keys(TRANSITIONS).join(', ')}`);
  // One transition per join (between part i and i + 1); a missing or short list falls back to `transition`.
  const joins = Array.isArray(s.parts) ? Math.max(0, s.parts.length - 1) : 0;
  const transitions = Array.from({ length: joins }, (_, i) => (Array.isArray(s.transitions) && s.transitions[i] != null ? s.transitions[i] : s.transition));
  if (s.transitions != null && !Array.isArray(s.transitions)) errors.push('transitions must be a list, one per join');
  transitions.forEach((t, i) => { if (!TRANSITIONS[t]) errors.push(`transitions[${i}] must be one of: ${Object.keys(TRANSITIONS).join(', ')}`); });
  if (s.title != null && (typeof s.title !== 'string' || s.title.length > TITLE_MAX)) errors.push(`title must be text up to ${TITLE_MAX} characters`);
  if (s.musicBed != null && typeof s.musicBed !== 'boolean') errors.push('musicBed must be true or false');
  const [tMin, tMax] = TARGET_RANGE;
  if (s.targetDuration != null && (!Number.isInteger(s.targetDuration) || s.targetDuration < tMin || s.targetDuration > tMax)) {
    errors.push(`targetDuration must be whole seconds, ${tMin}-${tMax}`);
  }
  if (!Array.isArray(s.parts) || s.parts.length < MIN_PARTS || s.parts.length > MAX_PARTS) {
    errors.push(`A sequence needs ${MIN_PARTS}-${MAX_PARTS} parts`);
  } else {
    s.parts.forEach((p, i) => { try { assertId(p, 'part'); } catch (e) { errors.push(`Part ${i + 1}: ${e.message}`); } });
  }
  if (errors.length) throw new StudioError(errors.join('; '), 400);
  return {
    id: s.id, project: s.project, title: (s.title || '').trim(), format: s.format, parts: [...s.parts], transition: s.transition, transitions,
    // Kept only when on, so a sequence saved before the field existed reads the same.
    ...(s.musicBed ? { musicBed: true } : {}),
    ...(s.targetDuration != null ? { targetDuration: s.targetDuration } : {}),
    createdBy: s.createdBy || 'ui', createdAt: s.createdAt || nowIso(),
  };
}

// Why a job's final.mp4 cannot be joined at `size` yet ('render' or 'size'), or null when it can.
function joinProblem(project, id, st, size) {
  const o = st.outputs || {};
  if (st.status !== 'done' || !o.final || !exists(jobFile(project, id, 'final.mp4'))) return 'render';
  if (o.width !== size.width || o.height !== size.height) return 'size';
  return null;
}

/** Render and preview: every part must be a done job of this project whose final.mp4 has the sequence's frame size. */
export function checkParts(project, format, parts) {
  const size = formatSize(format);
  const errors = [];
  const out = [];
  for (const id of parts) {
    if (!exists(briefFile(project, id))) { errors.push(`${id}: no such job in ${project}`); continue; }
    const st = getStatus(project, id);
    const o = st.outputs || {};
    const problem = joinProblem(project, id, st, size);
    if (problem === 'render') { errors.push(`${id}: not rendered (${st.status}). Render it in the Jobs list first`); continue; }
    if (problem === 'size') { errors.push(`${id} is ${o.width}x${o.height}, this sequence is ${format} (${size.width}x${size.height})`); continue; }
    const captions = jobFile(project, id, 'captions.srt');
    out.push({ id, template: loadBrief(project, id).template, file: jobFile(project, id, 'final.mp4'), duration: o.duration, captions: exists(captions) ? captions : null });
  }
  if (errors.length) throw new StudioError(`Parts not ready: ${errors.join('; ')}`, 409);
  return out;
}

/** Create and edit: a part may be unrendered (a draft sequence), but it must be a job of this project made at the sequence's size. */
function checkDraftParts(project, format, parts) {
  const size = formatSize(format);
  const errors = [];
  for (const id of new Set(parts)) {
    if (!exists(briefFile(project, id))) { errors.push(`${id}: no such job in ${project}`); continue; }
    const brief = loadBrief(project, id);
    let s;
    try { s = sizeFor(loadTemplate(brief.template).beats, brief.format); } catch (e) { errors.push(`${id}: ${e.message}`); continue; }
    if (s.width !== size.width || s.height !== size.height) errors.push(`${id} is ${s.width}x${s.height}, this sequence is ${format} (${size.width}x${size.height})`);
  }
  if (errors.length) throw new StudioError(`Cannot use these parts: ${errors.join('; ')}`, 409);
}

// The script is (being) rewritten in these states, so an older storyboard length no longer holds.
const SCRIPT_PENDING = ['queued', 'scripting', 'scripted'];

/** A part's length now: its render's, its storyboard's, or else its brief duration (an estimate). */
function partLength(brief, st) {
  if (st.status === 'done' && Number(st.outputs?.duration) > 0) return { duration: st.outputs.duration, from: 'render' };
  const rewrite = SCRIPT_PENDING.includes(st.status) || (st.status === 'dirty' && (st.dirty_from ?? 99) < 5);
  if (!rewrite && Number(st.duration) > 0) return { duration: st.duration, from: 'storyboard' };
  return { duration: brief.duration, from: 'brief' };
}

/**
 * The film's length against its target: each part's current length (render, storyboard, or the brief duration as
 * an estimate), where it starts once the transitions overlap its neighbours (the same maths as sequencePlan), the
 * total, and the parts that cannot be joined yet.
 */
export function sequenceBudget(project, seq) {
  const size = formatSize(seq.format);
  const joins = joinList(seq.parts.length, seq.transition, seq.transitions);
  let end = 0, overlap = 0, prev = false;
  const parts = seq.parts.map((id, i) => {
    // A missing part has no frames: neither the join into it nor the one out of it overlaps anything.
    if (!exists(briefFile(project, id))) {
      prev = false;
      return { id, template: null, status: null, planned: null, duration: 0, from: 'missing', estimate: true, start: round(end), ready: false, problem: 'missing', reason: 'no such job' };
    }
    const o = prev ? joins[i - 1].overlap : 0;
    const start = end - o;
    overlap += o;
    prev = true;
    const brief = loadBrief(project, id);
    const st = getStatus(project, id);
    const len = partLength(brief, st);
    const problem = joinProblem(project, id, st, size);
    end = start + len.duration;
    return {
      id, template: brief.template, status: st.status, planned: brief.duration, duration: round(len.duration), from: len.from, estimate: len.from === 'brief',
      start: round(start), ready: !problem, problem, reason: problem === 'render' ? `not rendered (${st.status})` : problem === 'size' ? `${st.outputs.width}x${st.outputs.height}, not ${size.width}x${size.height}` : null,
    };
  });
  const target = seq.targetDuration ?? null;
  return {
    parts, overlap: round(overlap), total: round(end), target, delta: target ? round(end - target) : null,
    estimate: parts.some((p) => p.estimate), notReady: [...new Set(parts.filter((p) => !p.ready).map((p) => p.id))],
  };
}

export function loadSequence(project, id) {
  const file = sequenceFile(project, id);
  if (!exists(file)) throw new StudioError(`Unknown sequence: ${project}/${id}`, 404);
  return readJson(file);
}

export function getSequenceStatus(project, id) {
  return readJson(seqOut(project, id, 'status.json'), { id, project, kind: 'sequence', status: 'draft', history: [] });
}

export function setSequenceStatus(project, id, patch, event, by = 'engine') {
  if (patch.status && !STATUSES.includes(patch.status)) throw new StudioError(`Unknown sequence status ${patch.status}`);
  const cur = getSequenceStatus(project, id);
  const next = { ...cur, ...patch, id, project, kind: 'sequence', updatedAt: nowIso() };
  if (event) next.history = [...(cur.history || []), { at: next.updatedAt, by, event }].slice(-MAX_HISTORY);
  writeJson(seqOut(project, id, 'status.json'), next);
  return next;
}

/**
 * Why a done sequence's final.mp4 no longer shows its parts: a part is gone, no longer done, or rendered after the
 * sequence. Worked out on every read; nothing watches the files.
 */
function staleness(project, id, seq, st) {
  if (st.status !== 'done') return { stale: false, staleReason: '' };
  const name = st.outputs?.final || 'final.mp4';
  const final = seqOut(project, id, name);
  const why = [];
  if (!exists(final)) why.push(`${name} is missing`);
  else {
    const at = fs.statSync(final).mtimeMs;
    for (const part of new Set(seq.parts)) {
      if (!exists(briefFile(project, part))) { why.push(`${part} no longer exists`); continue; }
      const s = getStatus(project, part).status;
      const file = jobFile(project, part, 'final.mp4');
      if (s !== 'done') why.push(`${part} is ${s}`);
      else if (!exists(file)) why.push(`${part} has no final.mp4`);
      else if (fs.statSync(file).mtimeMs > at) why.push(`${part} was rendered again`);
    }
  }
  return why.length ? { stale: true, staleReason: `${why.join('; ')}. Render the sequence again.` } : { stale: false, staleReason: '' };
}

/** The sequence status as the UI shows it: status.json plus `stale` and `staleReason`, never written back. */
export function sequenceStatusView(project, id, seq = loadSequence(project, id)) {
  const st = getSequenceStatus(project, id);
  return { ...st, ...staleness(project, id, seq, st) };
}

export function listSequences(project) {
  const list = [];
  for (const id of sequenceIds(project)) {
    try {
      const sequence = loadSequence(project, id);
      list.push({ sequence, status: sequenceStatusView(project, id, sequence), budget: sequenceBudget(project, sequence) });
    } catch { /* skip malformed files */ }
  }
  return list.sort((a, b) => String(b.sequence.createdAt).localeCompare(String(a.sequence.createdAt)));
}

export function createSequence(input, by = 'ui') {
  const seq = validateSequence({ ...input, createdBy: by, createdAt: null });
  const { project, id } = seq;
  if (exists(briefFile(project, id))) throw new StudioError(`${id} is already a job id in ${project}. Pick another sequence id.`, 409);
  if (exists(sequenceFile(project, id))) throw new StudioError(`Sequence ${project}/${id} already exists`, 409);
  if (exists(seqDir(project, id))) throw new StudioError(`out/${project}/${id} already exists. Pick another sequence id.`, 409);
  checkDraftParts(project, seq.format, seq.parts);
  const doc = { ...seq, updatedAt: seq.createdAt };
  writeJson(sequenceFile(project, id), doc);
  return doc;
}

/** Title and target edits keep the render; any other change makes final.mp4 stale, so it is removed. */
export function updateSequence(project, id, input, by = 'ui') {
  const stored = loadSequence(project, id);
  for (const k of ['id', 'project']) {
    if (input[k] != null && input[k] !== stored[k]) throw new StudioError(`The ${k === 'id' ? 'id' : 'project'} of a sequence cannot change`, 400);
  }
  if (getSequenceStatus(project, id).status === 'rendering') throw new StudioError('The sequence is rendering. Wait until it finishes, then edit it.', 409);
  const edits = Object.fromEntries(EDITABLE.filter((k) => k in input).map((k) => [k, input[k]]));
  const next = validateSequence({ ...stored, ...edits, id, project });
  checkDraftParts(project, next.format, next.parts);
  const changed = EDITABLE.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(stored[k]));
  if (!changed.length) return { sequence: stored, changed };
  const doc = { ...next, updatedAt: nowIso() };
  writeJson(sequenceFile(project, id), doc);
  if (changed.some((k) => !KEEPS_RENDER.includes(k)) && exists(seqOut(project, id, 'status.json'))) {
    for (const f of ['final.mp4', 'captions.srt', 'preview.mp4']) fs.rmSync(seqOut(project, id, f), { force: true });
    setSequenceStatus(project, id, { status: 'draft', outputs: null, error: null, preview: null }, `edited: ${changed.join(', ')}`, by);
  }
  return { sequence: doc, changed };
}

/** Moves the sequence file and its output to trash/<project>-<id>-<time>/ instead of deleting them. */
export function deleteSequence(project, id) {
  const file = sequenceFile(project, id);
  if (!exists(file)) throw new StudioError(`Unknown sequence: ${project}/${id}`, 404);
  if (getSequenceStatus(project, id).status === 'rendering') throw new StudioError('The sequence is rendering. Wait until it finishes.', 409);
  const trash = within(DIRS.trash, `${project}-${id}-${nowIso().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(trash, { recursive: true });
  const dir = seqDir(project, id);
  try {
    if (exists(dir)) fs.renameSync(dir, path.join(trash, 'out'));
  } catch (err) {
    fs.rmdirSync(trash);
    throw new StudioError(`Could not move out/${project}/${id} (${err.code || err.message}). Close the video if it is open and try again.`, 409);
  }
  fs.renameSync(file, path.join(trash, 'sequence.json'));
  return { id, trash: path.relative(DIRS.trash, trash) };
}

/** The joins between `count` parts: preset id, preset and how many seconds the two neighbours overlap. */
function joinList(count, transition, transitions, fadeSeconds = null) {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => {
    const id = transitions?.[i] ?? transition;
    const preset = TRANSITIONS[id];
    if (!preset) throw new StudioError(`Unknown transition: ${id}`, 400);
    return { id, preset, overlap: preset.xfade ? fadeSeconds ?? preset.seconds : 0 };
  });
}

/**
 * ffmpeg arguments that join `parts` ({ id, file, duration, hasAudio }) into `out`.
 * Each part is trimmed to its probed duration; a part without sound gets silence so concat/acrossfade line up.
 * A preset other than `cut` overlaps its two neighbours by its seconds (xfade + acrossfade), so each later part
 * starts that much earlier; a cut join is a plain concat. `transitions` names the preset of each join (between
 * part i and i + 1); `transition` is the one used where that list is missing. `fadeSeconds` overrides the
 * presets' lengths.
 */
export function sequencePlan({ parts, transition, transitions = null, fps, crf, size, out, fadeSeconds = null }) {
  const joins = joinList(parts.length, transition, transitions, fadeSeconds);
  parts.forEach((p, i) => {
    const before = joins[i - 1], after = joins[i];
    const need = (before?.overlap || 0) + (after?.overlap || 0);
    const names = [before, after].filter((j) => j?.overlap).map((j) => j.preset.label.toLowerCase());
    if (need && p.duration < need + 0.1) throw new StudioError(`${p.id} is ${p.duration} s, too short for a ${names.join(' and a ')} transition. Use a cut.`, 400);
  });
  const args = ['-y'];
  for (const p of parts) args.push('-i', p.file);
  let nextInput = parts.length;
  const audioIn = parts.map((p, i) => {
    if (p.hasAudio) return `${i}:a`;
    args.push('-f', 'lavfi', '-t', p.duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    return `${nextInput++}:a`;
  });
  const chains = parts.map((p, i) => {
    const d = p.duration.toFixed(3);
    return `[${i}:v]fps=${fps},trim=duration=${d},setpts=PTS-STARTPTS,scale=${size.width}:${size.height},setsar=1,format=yuv420p,settb=AVTB[v${i}];`
      + `[${audioIn[i]}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]`;
  });
  const starts = [0];
  const graph = [];
  let end = parts[0].duration;
  if (joins.every((j) => !j.overlap)) {
    for (const p of parts.slice(1)) { starts.push(round(end)); end += p.duration; }
    graph.push(`${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`);
  } else {
    let v = 'v0', a = 'a0';
    for (let i = 1; i < parts.length; i++) {
      const { preset, overlap } = joins[i - 1];
      const last = i === parts.length - 1;
      const vo = last ? 'v' : `vx${i}`, ao = last ? 'a' : `ax${i}`;
      const offset = round(end - overlap);
      if (overlap) {
        graph.push(`[${v}][v${i}]xfade=${xfadeOf(preset)}:duration=${overlap}:offset=${offset}[${vo}]`, `[${a}][a${i}]acrossfade=d=${overlap}[${ao}]`);
      } else {
        graph.push(`[${v}][v${i}]concat=n=2:v=1:a=0,settb=AVTB[${vo}]`, `[${a}][a${i}]concat=n=2:v=0:a=1[${ao}]`);
      }
      starts.push(offset);
      v = vo; a = ao;
      end = offset + parts[i].duration;
    }
  }
  args.push('-filter_complex', [...chains, ...graph].join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-preset', 'medium', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out);
  return { args, starts, duration: round(end), transitions: joins.map((j) => j.id) };
}

/**
 * How a music track `seconds` long loops to cover `duration`: `copies` inputs of the same file from index `input`
 * on, and the filter_complex steps that end in [loop]. Null when the track is long enough, or too short to loop.
 * Copies are cut before the track's fade-out and joined with acrossfade; every copy after the first starts past
 * the fade-in. With `cycle` (seconds of one chord progression) each jump back is whole cycles, so the crossfade
 * joins the same chord. Each copy is its own input: one input split with asplit gave silent later copies.
 */
export function loopMusic(input, seconds, duration, cycle = 0) {
  if (seconds >= duration) return null;
  const end = seconds - LOOP_TAIL;
  const join = end - LOOP_XFADE;
  const jump = cycle ? Math.floor((join - LOOP_HEAD) / cycle) * cycle : 0;
  const skip = jump > 0 ? join - jump : LOOP_HEAD;
  const step = end - skip - LOOP_XFADE;
  if (step < LOOP_XFADE) return null;
  const copies = 1 + Math.ceil((duration - end) / step);
  // Each copy is one more ffmpeg input of the same file: a few-second jingle under a long film plays once instead.
  if (copies > MAX_LOOP_COPIES) return null;
  const e = end.toFixed(3);
  const steps = [`[${input}:a]aresample=48000,atrim=0:${e}[c0]`];
  for (let i = 1; i < copies; i++) steps.push(`[${input + i}:a]aresample=48000,atrim=start=${skip.toFixed(3)}:end=${e},asetpts=PTS-STARTPTS[c${i}]`);
  for (let i = 1; i < copies; i++) steps.push(`[${i === 1 ? 'c0' : `x${i - 1}`}][c${i}]acrossfade=d=${LOOP_XFADE}[${i === copies - 1 ? 'loop' : `x${i}`}]`);
  return { copies, graph: steps.join(';') };
}

/**
 * ffmpeg arguments that give the joined picture `video` (copied, not re-encoded) a new sound track: each part's
 * own speech files (`speech`: { file, start }, start where the part plays in the joined film) over one music
 * track for the whole film (looped by loopMusic, one input per copy, when `musicSeconds` is shorter than the film), ducked under speech
 * with `duck`, faded in and out once, then loudness-normalised. `sfx` ({ file, start }, like `speech`): each
 * part's cut sounds and the sounds at the joins, mixed after the duck. Needs speech, cut sounds or music.
 */
export function musicBedPlan({ video, speech, sfx = [], music = null, musicSeconds = 0, cycle = 0, duration, gainDb, duck = false, out }) {
  const args = ['-y', '-i', video];
  for (const s of [...speech, ...sfx]) args.push('-i', s.file);
  const loop = music && musicSeconds ? loopMusic(speech.length + sfx.length + 1, musicSeconds, duration, cycle) : null;
  if (music) for (let i = 0; i < (loop?.copies || 1); i++) args.push('-i', music);
  const filter = mixFilter({
    speech: speech.length, sfx: sfx.length, sfxOffsets: sfx.length ? sfx.map((s) => s.start) : null, music: Boolean(music), duration, gainDb, duck,
    offsets: speech.map((s) => s.start), fadeIn: BED_FADE_IN, fadeOut: BED_FADE_OUT, loopGraph: loop?.graph || null,
  });
  args.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', duration.toFixed(3), '-movflags', '+faststart', out);
  return args;
}

/**
 * Replaces the sound of `joined` (the parts' own mixes, where the music restarts at every part) with a music bed
 * and writes `out`. A part without speech files plays music only. Returns false, and keeps the joined sound,
 * when there is nothing to lay: no speech files and no brand music.
 */
async function layMusicBed(project, parts, plan, joined, out, timeoutMs) {
  const stopAt = Date.now() + timeoutMs;
  const atPart = (names) => parts.flatMap((p, i) => names.map((f) => jobFile(project, p.id, f)).filter(exists).map((file) => ({ file, start: plan.starts[i] })));
  const speech = atPart(SPEECH_FILES);
  const brand = loadBrand(project);
  const music = await brandMusic(project, brand);
  const joinsFile = out.replace(/\.mp4$/, '.joins-sfx.wav');
  try {
    const joins = joinSfx(project, parts, plan, brand.sfx);
    const sfx = [...atPart([SFX_FILE]), ...(await writeSfxTrack(joins, plan.duration, brand.sfx?.gainDb ?? SFX_GAIN_DB, joinsFile) ? [{ file: joinsFile, start: 0 }] : [])];
    if (!speech.length && !sfx.length && !music) { fs.renameSync(joined, out); return false; }
    const musicSeconds = music ? (await probeMedia(music)).duration : 0;
    const name = brand.music?.file;
    const cycle = isLibraryMusic(name) ? MUSIC.find((m) => m.id === name.slice(8))?.cycle || 0 : 0;
    await ffmpeg(musicBedPlan({ video: joined, speech, sfx, music, musicSeconds, cycle, duration: plan.duration, gainDb: brand.music?.gainDb, duck: brand.music?.duck === true, out }), { timeoutMs: Math.max(1000, stopAt - Date.now()) });
    return true;
  } finally {
    fs.rmSync(joinsFile, { force: true });
  }
}

/**
 * Cut sounds at the joins of a music bed: the brand's cut sound (or the next part's first scene's own `sfx`)
 * on the middle of each transition, where the picture changes; at the join itself for a cut.
 */
export function joinSfx(project, parts, plan, brandSfx) {
  return parts.slice(1).flatMap((p, k) => {
    const prev = parts[k], i = k + 1;
    const overlap = Math.max(0, plan.starts[k] + prev.duration - plan.starts[i]);
    const first = readJson(jobFile(project, p.id, 'script.json'), null)?.scenes?.[0];
    const at = placeSound(cutSound(first, brandSfx), plan.starts[i] + overlap / 2);
    return at ? [{ part: p.id, ...at }] : [];
  });
}

/**
 * Runs the join; with the sequence's `musicBed` the joined file goes to a scratch name first and layMusicBed
 * writes `out`. Both ffmpeg runs share one time budget. Returns the plan and whether a music bed was laid.
 */
async function runJoin(project, seq, parts, planFor, out, cfg) {
  const stopAt = Date.now() + Math.max(60000, cfg.engine.runTimeoutMinutes * 60000 - KILL_MARGIN_MS);
  const joined = seq.musicBed ? out.replace(/\.mp4$/, '.joined.mp4') : out;
  const plan = planFor(joined);
  try {
    await ffmpeg(plan.args, { timeoutMs: stopAt - Date.now() });
    const bed = seq.musicBed ? await layMusicBed(project, parts, plan, joined, out, Math.max(1000, stopAt - Date.now())) : false;
    return { plan, bed };
  } finally {
    if (joined !== out) fs.rmSync(joined, { force: true });
  }
}

function parseSrt(srt) {
  const secs = (m) => +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  const cues = [];
  for (const block of String(srt || '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('-->'));
    const m = at >= 0 && /(\d+):(\d\d):(\d\d)[,.](\d{3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{3})/.exec(lines[at]);
    if (!m) continue;
    const text = lines.slice(at + 1).join('\n').trim();
    if (text) cues.push({ start: secs(m.slice(0, 5)), end: secs([null, ...m.slice(5, 9)]), text });
  }
  return cues;
}

/** One SRT from each part's captions ({ srt, start, duration }), shifted to where the part plays; '' when none has captions. */
export function joinCaptions(parts) {
  const cues = [];
  for (const p of parts) {
    for (const c of parseSrt(p.srt)) {
      if (c.start >= p.duration) continue;
      cues.push({ start: p.start + c.start, end: p.start + Math.min(c.end, p.duration), text: c.text });
    }
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/** The parts of a sequence with their probed length and sound, ready for sequencePlan. */
async function probedParts(project, seq) {
  const parts = [];
  for (const p of checkParts(project, seq.format, seq.parts)) {
    const info = await probeMedia(p.file);
    if (!info.hasVideo) throw new StudioError(`${p.id}: final.mp4 has no video stream`, 400);
    parts.push({ ...p, duration: info.duration, hasAudio: info.hasAudio });
  }
  return parts;
}

export const PREVIEW_SHORT_SIDE = 360;

/**
 * A quick low-resolution cut of the sequence (preview.mp4) to check the joins before the real render: the same
 * plan at a 360 px short side with a fast encode. It never changes the sequence status; the result and its error
 * live under `preview` in status.json, and any edit but the title removes it.
 */
export async function previewSequence(project, id, by = 'engine') {
  const cfg = loadStudioConfig();
  const seq = loadSequence(project, id);
  const dir = seqDir(project, id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'preview.part.mp4');
  const t0 = Date.now();
  try {
    const full = formatSize(seq.format);
    const k = PREVIEW_SHORT_SIDE / Math.min(full.width, full.height);
    const even = (n) => 2 * Math.round((n * k) / 2);
    const size = { width: even(full.width), height: even(full.height) };
    const parts = await probedParts(project, seq);
    const { plan } = await runJoin(project, seq, parts, (out) => {
      const p = sequencePlan({ parts, transition: seq.transition, transitions: seq.transitions, fps: cfg.render.fps, crf: 30, size, out });
      p.args[p.args.indexOf('-preset') + 1] = 'veryfast';
      return p;
    }, tmp, cfg);
    fs.renameSync(tmp, path.join(dir, 'preview.mp4'));
    const secs = round((Date.now() - t0) / 1000, 1);
    return setSequenceStatus(project, id, {
      preview: { file: 'preview.mp4', madeAt: nowIso(), ...size, duration: plan.duration, transitions: plan.transitions, starts: plan.starts, renderSeconds: secs, error: null },
    }, `preview.mp4 written in ${secs}s`, by);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    setSequenceStatus(project, id, { preview: { file: null, error: err.message } }, 'preview failed', by);
    throw err;
  }
}

export async function renderSequence(project, id, by = 'engine') {
  const cfg = loadStudioConfig();
  const seq = loadSequence(project, id);
  const dir = seqDir(project, id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'final.part.mp4');
  setSequenceStatus(project, id, { status: 'rendering', error: null, outputs: null }, 'render started', by);
  const t0 = Date.now();
  try {
    const size = formatSize(seq.format);
    const parts = await probedParts(project, seq);
    const fps = cfg.render.fps;
    const { plan, bed } = await runJoin(project, seq, parts, (out) => sequencePlan({ parts, transition: seq.transition, transitions: seq.transitions, fps, crf: cfg.render.crf, size, out }), tmp, cfg);
    const { file: final, version } = nextVersionFile(dir, versionBase(seq));
    fs.renameSync(tmp, within(dir, final));
    const srt = joinCaptions(parts.map((p, i) => ({ srt: p.captions ? fs.readFileSync(p.captions, 'utf8') : '', start: plan.starts[i], duration: p.duration })));
    const captions = path.join(dir, 'captions.srt');
    if (srt) fs.writeFileSync(captions, srt, 'utf8'); else fs.rmSync(captions, { force: true });
    const qa = await qaFile(dir, final, 'qa.json', { width: size.width, height: size.height, fps, duration: plan.duration, silent: !bed && !parts.some((p) => p.hasAudio), format: seq.format });
    const secs = round((Date.now() - t0) / 1000, 1);
    return setSequenceStatus(project, id, {
      status: 'done',
      outputs: {
        final, version, captions: srt ? 'captions.srt' : null, width: size.width, height: size.height, fps, duration: plan.duration,
        transition: seq.transition, transitions: plan.transitions, ...(bed ? { musicBed: true } : {}), parts: parts.map((p, i) => ({ id: p.id, template: p.template, start: plan.starts[i], duration: round(p.duration), transition: i ? plan.transitions[i - 1] : null })), renderSeconds: secs, qa,
      },
    }, `${final} written in ${secs}s, QA ${qa.passed ? 'passed' : 'failed'}`, by);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    setSequenceStatus(project, id, { status: 'error', error: err.message }, 'render failed', by);
    throw err;
  }
}
