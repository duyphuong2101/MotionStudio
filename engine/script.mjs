import { StudioError, assertFileName } from './core.mjs';
import { ICON_NAMES } from '../motion-kit/icons.mjs';
import { splitKind } from './mix.mjs';
import { MARK_FIELDS, stripMarks, hasMarkup, markErrors } from './marks.mjs';
import { PART_RE, DECAL_SIZE } from './model-rules.mjs';
import { lookProblem } from './looks.mjs';

const wordsOf = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
export const SCENE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
// A stat's unit next to the counted number ("h", "%", "x").
export const STAT_UNIT_MAX = 4;
// Every limit error ends with how much to cut, in the unit of the limit.
const overLimit = (at, what, n, unit, max) => `${at}: ${what} ${unit === 'words' ? 'has' : 'is'} ${n} ${unit}, limit ${max}: cut ${n - max}`;

// A scene a person left for the Director: `draft: { note, by, at }` on an otherwise placeholder scene.
export const DRAFT_NOTE_MAX = 300;
// Text in square brackets is a placeholder a person still has to replace (the UI writes one for a new voice line).
const PLACEHOLDER_RE = /^\[[^\]]*\]$/;
export const draftScenes = (script) => (Array.isArray(script?.scenes) ? script.scenes.filter((s) => s?.draft) : []);
export const draftsWaiting = (n) => `${n} draft scene(s) waiting — click Run Director for this job`;

/** Prepare and render refuse a script that still has draft scenes. */
export function assertNoDrafts(script) {
  const n = draftScenes(script).length;
  if (n) throw new StudioError(draftsWaiting(n), 409);
}

function draftErrors(s) {
  const note = s.draft?.note;
  if (typeof note !== 'string' || !note.trim()) return [`${s.id}: a draft scene needs a note for the Director`];
  if (note.length > DRAFT_NOTE_MAX) return [overLimit(s.id, 'draft note', note.length, 'chars', DRAFT_NOTE_MAX)];
  return [];
}

/** Returns { errors, warnings } for a script against a template's beats.json. */
// A sound clip's scene may keep the last frame this long after the clip ends, so a short bite does not cut away at once.
export const MAX_HOLD = 3;

const SOURCE_REF_RE = /^(bullets|facts)\[(\d+)\]$|^brief\.([a-zA-Z]+)$/;

/**
 * A scene's `source` names where its claim comes from: one or more of `bullets[n]`, `facts[n]` (lines of
 * source.json) or `brief.<field>` (a filled text field of the brief), comma separated. Returns one message per
 * ref that points at nothing, so a reordered or shortened source.json cannot leave a claim pointing elsewhere.
 */
export function sourceRefProblems(script, source, brief = null) {
  const out = [];
  for (const sc of Array.isArray(script?.scenes) ? script.scenes : []) {
    if (!sc || sc.source === undefined) continue;
    for (const ref of String(sc.source).split(',').map((r) => r.trim())) {
      const m = SOURCE_REF_RE.exec(ref);
      const ok = m && (m[3] ? brief === null || (typeof brief[m[3]] === 'string' && brief[m[3]].trim() !== '')
        : Array.isArray(source?.[m[1]]) && Boolean(source[m[1]][Number(m[2])]));
      if (!ok) out.push(`${sc.id}: source "${ref}" is not a line of source.json${m?.[3] ? ' or a filled brief field' : ''}`);
    }
  }
  return out;
}

export function validateScript(script, beats, { assets = [], icons = ICON_NAMES, source = null, brief = null } = {}) {
  const errors = [];
  const warnings = [];
  const scenes = Array.isArray(script?.scenes) ? script.scenes : null;
  if (!scenes) return { errors: ['script.scenes must be an array'], warnings };
  if (source) errors.push(...sourceRefProblems(script, source, brief));
  const look = lookProblem(script.look);
  if (look) errors.push(look);

  const ids = new Set();
  for (const s of scenes) {
    if (!s || typeof s.id !== 'string' || !SCENE_ID_RE.test(s.id)) errors.push(`scene id "${s?.id}" must be a-z, 0-9, dashes`);
    else if (ids.has(s.id)) errors.push(`duplicate scene id ${s.id}`);
    else ids.add(s.id);
  }

  let i = 0;
  for (const slot of beats.sequence) {
    let n = 0;
    while (i < scenes.length && slot.kind.includes(scenes[i].kind) && n < slot.max) { i++; n++; }
    if (n < slot.min) errors.push(`expected ${slot.min}-${slot.max} scene(s) of kind ${slot.kind.join('|')} at position ${i + 1}`);
  }
  if (i < scenes.length) errors.push(`unexpected scene "${scenes[i].id}" of kind ${scenes[i].kind} at position ${i + 1}`);

  for (const s of scenes) {
    const { tpl, kind } = splitKind(s.kind);
    if (tpl && !beats.sources?.[tpl]) {
      errors.push(`${s.id}: kind ${s.kind} comes from template ${tpl}, which is not in this brief's mix`);
      continue;
    }
    if (s.draft !== undefined) errors.push(...draftErrors(s));
    else if (PLACEHOLDER_RE.test(String(s.vo ?? '').trim())) warnings.push(`${s.id}: the voice line is still a placeholder; write the real line`);
    const spec = beats.fields[s.kind];
    if (!spec) continue;
    // A scene from an extra template follows that template's limits, enums and shots rules.
    const rules = tpl ? beats.sources[tpl] : beats;
    const L = rules.limits;
    for (const f of spec.required) {
      const v = s[f];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) errors.push(`${s.id}: ${f} is required`);
    }
    const allowed = new Set(['id', 'kind', 'draft', 'speaker', 'stress', ...spec.required, ...spec.optional]);
    for (const k of Object.keys(s)) if (!allowed.has(k)) warnings.push(`${s.id}: field "${k}" is ignored by this template`);
    for (const [f, max] of Object.entries(L)) {
      if (f === 'voWords') continue;
      const len = typeof s[f] === 'string' ? stripMarks(s[f]).length : 0;
      if (len > max) errors.push(overLimit(s.id, f, len, 'chars', max));
    }
    errors.push(...sceneMarkErrors(s, rules.marks === true));
    const vw = wordsOf(s.vo).length;
    // A scene with end notes may also read them (logo-reveal `data.reveal.voWithNotes`).
    const voMax = s.notes !== undefined && rules.data?.[kind]?.voWithNotes ? rules.data[kind].voWithNotes : L.voWords;
    if (vw > voMax) errors.push(overLimit(s.id, 'voice line', vw, 'words', voMax));
    if (s.icon && !icons.includes(s.icon)) errors.push(`${s.id}: icon "${s.icon}" is not a motion-kit or brand icon (${icons.join(', ')})`);
    for (const [field, allowed] of Object.entries(rules.enums || {})) {
      if (s[field] !== undefined && !allowed.includes(s[field])) errors.push(`${s.id}: ${field} must be ${allowed.join('|')}`);
    }
    if (kind === 'stat' &&(spec.required.includes('stat') || spec.optional.includes('stat'))) {
      if (!s.stat || !Number.isFinite(Number(s.stat.value))) errors.push(`${s.id}: stat.value must be a number`);
      else if (String(s.stat.unit ?? '').length > STAT_UNIT_MAX) errors.push(`${s.id}: stat.unit max ${STAT_UNIT_MAX} chars`);
    }
    if (s.asset && !assets.includes(s.asset)) errors.push(`${s.id}: asset "${s.asset}" is not in the project assets`);
    if (s.image && !assets.includes(s.image)) errors.push(`${s.id}: image "${s.image}" is not in the project assets`);
    if (Array.isArray(s.photos)) {
      for (const p of s.photos) {
        if (typeof p?.asset !== 'string') continue;
        if (!/\.(png|jpe?g|webp)$/i.test(p.asset)) errors.push(`${s.id}: photo "${p.asset}" must be a .png, .jpg or .webp image`);
        else if (!assets.includes(p.asset)) errors.push(`${s.id}: photo "${p.asset}" is not in the project assets`);
      }
    }
    if ((s.layout === 'split' || s.layout === 'pip') && !s.image) errors.push(`${s.id}: layout ${s.layout} needs an image, the screenshot shown beside or behind the speaker`);
    if (s.lottie !== undefined) {
      if (typeof s.lottie !== 'string' || !/\.json$/i.test(s.lottie)) errors.push(`${s.id}: lottie must be a .json Lottie file`);
      else if (!assets.includes(s.lottie)) errors.push(`${s.id}: lottie "${s.lottie}" is not in the project assets`);
    }
    if (s.video !== undefined) {
      if (typeof s.video !== 'string' || !/\.(mp4|webm|mov)$/i.test(s.video)) errors.push(`${s.id}: video must be a .mp4, .webm or .mov file`);
      else if (!assets.includes(s.video)) errors.push(`${s.id}: video "${s.video}" is not in the project assets`);
    }
    if (s.model !== undefined) {
      if (typeof s.model !== 'string' || !/\.glb$/i.test(s.model)) errors.push(`${s.id}: model must be a .glb file`);
      else if (!assets.includes(s.model)) errors.push(`${s.id}: model "${s.model}" is not in the project assets`);
    }
    for (const f of ['in', 'out']) if (s[f] !== undefined && s[f] !== '' && !(Number(s[f]) >= 0)) errors.push(`${s.id}: ${f} must be a number of seconds`);
    if (s.sound !== undefined && typeof s.sound !== 'boolean') errors.push(`${s.id}: sound must be true or false`);
    if (s.speaker !== undefined && (typeof s.speaker !== 'string' || !/^[a-z][a-z0-9-]{0,19}$/.test(s.speaker))) errors.push(`${s.id}: speaker must name a voice in the brand's voice cast`);
    if (s.stress !== undefined) errors.push(...stressErrors(s));
    if (s.logo !== undefined && typeof s.logo !== 'boolean') errors.push(`${s.id}: logo must be true or false`);
    if (s.hold !== undefined && s.hold !== '' && !(Number(s.hold) >= 0 && Number(s.hold) <= MAX_HOLD)) errors.push(`${s.id}: hold must be 0 to ${MAX_HOLD} seconds`);
    if (s.video && s.sound === true && wordsOf(s.vo).length) warnings.push(`${s.id}: the clip plays its own sound under the voice line; if the voice runs longer than the clip, the scene holds the clip's last frame until the voice ends`);
    if (s.shots !== undefined) errors.push(...validateShots(s, rules, assets));
    if (rules.data?.[kind]) errors.push(...validateData(s, kind, rules.data[kind], icons));
  }
  return { errors, warnings };
}

export const MAX_STRESS = 3;
const stressKey = (w) => String(w).toLowerCase().replace(/[^a-z0-9%]/g, '');
/** Where a stressed phrase sits in a voice line: the index of its first and last word, or null. */
export function stressAt(vo, phrase) {
  const toks = wordsOf(vo).map(stressKey), ws = wordsOf(phrase).map(stressKey).filter(Boolean);
  if (!ws.length) return null;
  const i = toks.findIndex((_, k) => ws.every((w, j) => toks[k + j] === w));
  return i < 0 ? null : [i, i + ws.length - 1];
}
/** `stress`: 1-3 phrases of the scene's own voice line that the voice says louder (engine/tts.mjs). */
function stressErrors(s) {
  if (!Array.isArray(s.stress) || !s.stress.length || s.stress.length > MAX_STRESS) return [`${s.id}: stress must list 1-${MAX_STRESS} phrases of the voice line`];
  return s.stress.filter((p) => typeof p !== 'string' || !stressAt(s.vo, p)).map((p) => `${s.id}: stress "${String(p).slice(0, 60)}" is not a run of words in the voice line`);
}

// A mark the page would draw; text like "[[1, 2]]" in a code listing is not one.
const DRAWN_MARK = /\[\[(circle|underline|strike|mark):/;

/** Marks only in the on-screen text fields of a template that draws them; never in a voice line or nested data. */
function sceneMarkErrors(s, supported) {
  const errs = [];
  const stray = (v, at) => {
    if (typeof v === 'string') { if (DRAWN_MARK.test(v)) errs.push(`${s.id}: ${at} cannot hold a mark; marks go in ${MARK_FIELDS.join(', ')}`); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) stray(x, `${at}.${k}`);
  };
  for (const [f, v] of Object.entries(s)) {
    if (['id', 'kind', 'draft', 'source'].includes(f)) continue;
    if (!MARK_FIELDS.includes(f) || typeof v !== 'string') { stray(v, f); continue; }
    if (!hasMarkup(v)) continue;
    if (!supported) errs.push(`${s.id}: this template does not draw marks; remove [[…]] from ${f}`);
    else errs.push(...markErrors(v, f).map((m) => `${s.id}: ${m}`));
  }
  return errs;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const shortText = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;

/**
 * Shape of chart data a template declares in beats.json `data[kind]`, so a chart never draws from a
 * malformed list. race: periods + series (one value per period); stripes: a list of numbers; line: band and ref;
 * flash: a short list of short items.
 */
export function validateData(s, kind, d, icons = ICON_NAMES) {
  const errs = [];
  if (kind === 'race') {
    const P = s.periods, S = s.series;
    if (!Array.isArray(P) || P.length < d.periods[0] || P.length > d.periods[1]) errs.push(`${s.id}: periods must list ${d.periods[0]}-${d.periods[1]} labels`);
    else if (!P.every((p) => shortText(p, d.periodChars))) errs.push(`${s.id}: each period is a label of at most ${d.periodChars} characters, e.g. "2020"`);
    if (!Array.isArray(S) || S.length < d.series[0] || S.length > d.series[1]) errs.push(`${s.id}: series must list ${d.series[0]}-${d.series[1]} items`);
    else {
      S.forEach((x, i) => {
        if (!x || !shortText(x.label, d.labelChars)) errs.push(`${s.id}.series[${i}]: label is required, at most ${d.labelChars} characters`);
        if (!Array.isArray(x?.values) || !x.values.every(finite)) errs.push(`${s.id}.series[${i}]: values must be numbers`);
        else if (Array.isArray(P) && x.values.length !== P.length) errs.push(`${s.id}.series[${i}]: ${x.values.length} values for ${P.length} periods`);
        else if (x.values.some((v) => v < 0)) errs.push(`${s.id}.series[${i}]: a bar cannot be negative`);
      });
    }
    if (s.top !== undefined && s.top !== '' && !(Number.isInteger(Number(s.top)) && Number(s.top) >= d.top[0] && Number(s.top) <= d.top[1])) errs.push(`${s.id}: top must be a whole number ${d.top[0]}-${d.top[1]}`);
  }
  if (kind === 'stripes') {
    const V = s.values;
    if (!Array.isArray(V) || V.length < d.values[0] || V.length > d.values[1] || !V.every(finite)) errs.push(`${s.id}: values must be ${d.values[0]}-${d.values[1]} numbers`);
    else if (Math.max(...V) === Math.min(...V)) errs.push(`${s.id}: values are all the same, so the stripes would show nothing`);
    if (s.labels !== undefined && (!Array.isArray(s.labels) || s.labels.length !== 2 || !s.labels.every((l) => shortText(l, d.periodChars)))) errs.push(`${s.id}: labels must be the first and last period, e.g. ["1880", "2025"]`);
  }
  // data-story bars: with two series, every item carries a second value drawn beside the first.
  if (kind === 'bars' && s.series !== undefined) {
    if (!Array.isArray(s.series) || s.series.length !== 2 || !s.series.every((x) => shortText(x, d.seriesChars))) errs.push(`${s.id}: series must name the two values of every item, e.g. ["Commercial PEX", "Delivery PEX"], each at most ${d.seriesChars} characters`);
    else if (!Array.isArray(s.items) || !s.items.every((x) => finite(x?.value2))) errs.push(`${s.id}: with series, every item needs value2, a number`);
  }
  // data-story line: an optional highlighted span of points and an optional dashed reference value.
  if (kind === 'line') {
    const n = Array.isArray(s.points) ? s.points.length : 0;
    const label = (x) => x.label === undefined || shortText(x.label, d.labelChars);
    const at = (v) => Number.isInteger(v) && v >= 0 && v < n;
    const b = s.band;
    if (b !== undefined && (!b || typeof b !== 'object' || !at(b.from) || !at(b.to) || b.from > b.to || !label(b))) errs.push(`${s.id}: band must be { "from": 2, "to": 3, "label": "Q3" }: point positions counted from 0, from <= to, label at most ${d.labelChars} characters`);
    const r = s.ref;
    if (r !== undefined && (!r || typeof r !== 'object' || !finite(r.value) || !label(r))) errs.push(`${s.id}: ref must be { "value": 50, "label": "Target" }: a number, label at most ${d.labelChars} characters`);
  }
  // explainer flash: words that flash one at a time, each short enough to fill one line.
  if (kind === 'flash') {
    const I = s.items;
    if (!Array.isArray(I) || I.length < d.items[0] || I.length > d.items[1]) errs.push(`${s.id}: items must list ${d.items[0]}-${d.items[1]} words or short phrases`);
    else I.forEach((x, i) => { if (!shortText(x, d.chars)) errs.push(`${s.id}.items[${i}]: text is required, at most ${d.chars} characters`); });
  }
  // logo-reveal notes: optional silent lines under the tagline (end notes).
  if (kind === 'reveal' && s.notes !== undefined) {
    const N = s.notes;
    if (!Array.isArray(N) || N.length < d.notes[0] || N.length > d.notes[1]) errs.push(`${s.id}: notes must list ${d.notes[0]}-${d.notes[1]} short lines`);
    else N.forEach((x, i) => { if (!shortText(x, d.chars)) errs.push(`${s.id}.notes[${i}]: text is required, at most ${d.chars} characters`); });
  }
  // notesCue: the word of the voice line where it starts reading the notes; the roll starts there.
  if (kind === 'reveal' && s.notesCue !== undefined) {
    const key = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.notes === undefined) errs.push(`${s.id}: notesCue needs notes`);
    else if (typeof s.notesCue !== 'string' || !key(s.notesCue) || !wordsOf(s.vo).some((w) => key(w) === key(s.notesCue))) errs.push(`${s.id}: notesCue "${s.notesCue}" is not a word of the voice line`);
  }
  // A model scene (data.view): an optional start pose, each number inside its range (templates/model3d.mjs
  // VIEW_RANGE); an optional camera path of 2-4 such poses; optional exploded parts (named nodes of the .glb).
  if (d.view) {
    const keys = Object.keys(d.view);
    const poseErrs = (v, what) => {
      if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !keys.includes(k))) return errs.push(`${s.id}: ${what} must be { "azimuth": 30, "elevation": 12, "zoom": 1 }, each key optional`);
      for (const [k, [lo, hi]] of Object.entries(d.view)) if (v[k] !== undefined && !(finite(v[k]) && v[k] >= lo && v[k] <= hi)) errs.push(`${s.id}: ${what}.${k} must be a number from ${lo} to ${hi}`);
    };
    if (s.view !== undefined) poseErrs(s.view, 'view');
    if (s.path !== undefined) {
      const [lo, hi] = d.path || [2, 4];
      if (!Array.isArray(s.path) || s.path.length < lo || s.path.length > hi) errs.push(`${s.id}: path must list ${lo}-${hi} poses shaped like view`);
      else s.path.forEach((p, i) => poseErrs(p, `path[${i}]`));
    }
    if (s.explode !== undefined) {
      const [lo, hi] = d.explode?.parts || [1, 6];
      if (!Array.isArray(s.explode) || s.explode.length < lo || s.explode.length > hi || s.explode.some((p) => typeof p !== 'string' || !PART_RE.test(p))) errs.push(`${s.id}: explode must list ${lo}-${hi} part names of the model (letters, digits, _ . -)`);
    }
    if (s.gap !== undefined) {
      const [lo, hi] = d.explode?.gap || [0.1, 1];
      if (!(finite(s.gap) && s.gap >= lo && s.gap <= hi)) errs.push(`${s.id}: gap must be a number from ${lo} to ${hi}`);
    }
  }
  // A decal: an icon stamped on the model's front face, placed by fractions of it, sized by its height.
  if (d.decal) {
    if (s.decal !== undefined) {
      const dc = s.decal, [lo, hi] = d.decal?.size || DECAL_SIZE;
      if (!dc || typeof dc !== 'object' || Array.isArray(dc) || Object.keys(dc).some((k) => !['icon', 'at', 'size', 'part'].includes(k))) errs.push(`${s.id}: decal must be { "icon": "shield", "at": [0.85, 0.15], "size": 0.28, "part": "front" }, icon required`);
      else {
        if (typeof dc.icon !== 'string' || !icons.includes(dc.icon)) errs.push(`${s.id}: decal.icon must be an icon name from the context's icons list`);
        if (dc.at !== undefined && !(Array.isArray(dc.at) && dc.at.length === 2 && dc.at.every((v) => finite(v) && v >= 0 && v <= 1))) errs.push(`${s.id}: decal.at must be [x, y], each 0 to 1`);
        if (dc.size !== undefined && !(finite(dc.size) && dc.size >= lo && dc.size <= hi)) errs.push(`${s.id}: decal.size must be a number from ${lo} to ${hi}`);
        if (dc.part !== undefined && !(typeof dc.part === 'string' && PART_RE.test(dc.part))) errs.push(`${s.id}: decal.part must be a part name of the model`);
      }
    }
  }
  // lifestyle gallery: a few photos dropped as prints, each with an optional short caption.
  if (kind === 'gallery') {
    const P = s.photos;
    if (!Array.isArray(P) || P.length < d.photos[0] || P.length > d.photos[1]) errs.push(`${s.id}: photos must list ${d.photos[0]}-${d.photos[1]} photos`);
    else P.forEach((p, i) => {
      if (!p || typeof p !== 'object' || typeof p.asset !== 'string' || !p.asset) errs.push(`${s.id}.photos[${i}]: each photo is { "asset": "team.jpg", "caption": "Kick-off day" }`);
      else if (p.caption !== undefined && p.caption !== '' && !shortText(p.caption, d.caption)) errs.push(`${s.id}.photos[${i}]: caption at most ${d.caption} characters`);
    });
  }
  // code-story: listings must fit the panel; lists must hold what the renderer expects.
  const block = (field) => {
    if (typeof s[field] !== 'string') { errs.push(`${s.id}: ${field} must be text`); return; }
    const lines = s[field].replace(/\r/g, '').split('\n');
    if (lines.length > d.lines) errs.push(`${s.id}: ${field} has ${lines.length} lines, at most ${d.lines}`);
    const long = lines.findIndex((l) => l.replace(/\t/g, '  ').length > d.chars);
    if (long >= 0) errs.push(`${s.id}: ${field} line ${long + 1} is longer than ${d.chars} characters`);
  };
  if (kind === 'code') {
    block('code');
    if (s.highlight !== undefined && (!Array.isArray(s.highlight) || !s.highlight.every((n) => Number.isInteger(n) && n >= 1))) errs.push(`${s.id}: highlight must be a list of line numbers, e.g. [2, 3]`);
  }
  if (kind === 'diff') {
    block('before');
    block('after');
    if (typeof s.before === 'string' && s.before === s.after) errs.push(`${s.id}: before and after are the same`);
  }
  if (kind === 'tree') {
    if (!Array.isArray(s.files) || !s.files.length || s.files.length > d.files) errs.push(`${s.id}: files must list 1-${d.files} files`);
    else s.files.forEach((f, i) => {
      if (!f || !shortText(f.path, d.chars)) errs.push(`${s.id}.files[${i}]: path is required, at most ${d.chars} characters`);
      if (![f?.added ?? 0, f?.removed ?? 0].every((n) => Number.isInteger(n) && n >= 0)) errs.push(`${s.id}.files[${i}]: added and removed must be whole numbers`);
    });
  }
  if (kind === 'terminal') {
    if (!Array.isArray(s.lines) || !s.lines.length || s.lines.length > d.lines) errs.push(`${s.id}: lines must list 1-${d.lines} lines`);
    else s.lines.forEach((l, i) => {
      const text = typeof l === 'string' ? l : l?.cmd ?? l?.out;
      if (typeof text !== 'string' || (typeof l === 'object' && ('cmd' in l) === ('out' in l))) errs.push(`${s.id}.lines[${i}]: each line is { "cmd": "..." } or { "out": "..." }`);
      else if (text.length > d.chars) errs.push(`${s.id}.lines[${i}]: longer than ${d.chars} characters`);
    });
  }
  if (kind === 'checklist') {
    if (!Array.isArray(s.items) || !s.items.length || s.items.length > d.items) errs.push(`${s.id}: items must list 1-${d.items} items`);
    else s.items.forEach((x, i) => { if (!shortText(typeof x === 'string' ? x : x?.text, d.chars)) errs.push(`${s.id}.items[${i}]: text is required, at most ${d.chars} characters`); });
  }
  return errs;
}

function validateShots(s, beats, assets) {
  const errs = [];
  const spec = beats.shots || { max: 4, imageSize: { width: 1920, height: 1080 } };
  const { width: W, height: H } = spec.imageSize;
  if (!Array.isArray(s.shots) || !s.shots.length) return [`${s.id}: shots must be a non-empty array`];
  if (s.shots.length > spec.max) errs.push(`${s.id}: at most ${spec.max} shots per scene`);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  s.shots.forEach((sh, i) => {
    const at = `${s.id}.shots[${i}]`;
    if (!sh || typeof sh.asset !== 'string') { errs.push(`${at}: asset is required`); return; }
    if (!assets.includes(sh.asset)) errs.push(`${at}: asset "${sh.asset}" is not in the project assets`);
    if (sh.focus != null) {
      const f = sh.focus;
      if (![f.x, f.y, f.w, f.h].every(num) || f.w < 40 || f.h < 40 || f.x < 0 || f.y < 0 || f.x + f.w > W + 1 || f.y + f.h > H + 1) errs.push(`${at}: focus must be {x,y,w,h} inside ${W}x${H}, at least 40px`);
    }
    if (sh.cursor != null && (!num(sh.cursor.x) || !num(sh.cursor.y) || sh.cursor.x < 0 || sh.cursor.y < 0 || sh.cursor.x > W || sh.cursor.y > H)) errs.push(`${at}: cursor must be {x,y} inside the image`);
    if (sh.click && !sh.cursor) errs.push(`${at}: click needs a cursor position`);
    if (sh.cue !== undefined) {
      const key = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (typeof sh.cue !== 'string' || !key(sh.cue) || /\s/.test(sh.cue.trim())) errs.push(`${at}: cue must be one word of the voice line`);
      else if (!wordsOf(s.vo).some((w) => key(w) === key(sh.cue))) errs.push(`${at}: cue "${sh.cue}" is not a word of the voice line`);
    }
  });
  return errs;
}

/**
 * Whether `words` voice words, spoken at `wps` words per second after `lead` seconds, end inside a clip of
 * `clipSeconds` that plays its own sound (such a clip sets the scene's length).
 */
export const voiceFitsClip = (words, clipSeconds, wps, lead = 0) => !words || lead + words / wps <= clipSeconds;

export function assertValidScript(script, beats, opts) {
  const r = validateScript(script, beats, opts);
  if (r.errors.length) throw new StudioError(`Script invalid:\n- ${r.errors.join('\n- ')}`, 400);
  return r;
}

// A bullet's optional screenshot: a raster image in the project assets (SVG is a logo or icon, not a screen).
export const IMAGE_ASSET_RE = /\.(png|jpe?g|webp)$/i;

function bulletAssetError(asset, at, assets) {
  try { assertFileName(asset, 'screenshot'); } catch { return `${at}.asset is not a valid file name`; }
  if (!IMAGE_ASSET_RE.test(asset)) return `${at}.asset must be a .png, .jpg or .webp image`;
  if (!assets.includes(asset)) return `${at}.asset "${asset}" is not in the project assets. Upload it in the Brand tab → Assets first`;
  return '';
}

/** `assets` is the project's asset list; a bullet `asset` must name one of them. */
export function validateSource(source, { assets = [] } = {}) {
  const errors = [];
  if (!source || typeof source !== 'object') return ['source must be an object'];
  if (!source.name) errors.push('name is required');
  if (!Array.isArray(source.bullets) || !source.bullets.length) errors.push('bullets must be a non-empty array');
  else source.bullets.forEach((b, i) => {
    if (!b || typeof b.text !== 'string' || !b.text) errors.push(`bullets[${i}].text is required`);
    if (!b || typeof b.ref !== 'string' || !b.ref) errors.push(`bullets[${i}].ref (where the claim comes from) is required`);
    const bad = b?.asset !== undefined && bulletAssetError(b.asset, `bullets[${i}]`, assets);
    if (bad) errors.push(bad);
  });
  return errors;
}

/** The bullets that carry a screenshot, as the Director sees them in `context`. */
export const bulletScreenshots = (source) => (source?.bullets || []).flatMap((b, i) => (b?.asset ? [{ source: `bullets[${i}]`, asset: b.asset }] : []));

export { wordsOf };
