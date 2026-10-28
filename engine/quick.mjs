// Quick mode (plan quick-video): a Director writes a short outline and the engine expands it into a full script
// through the template's declarative `beats.quick` block. The engine copies the outline's words and never shortens
// them: a field over its limit is an error that names the cut. No model, no clock, no random: one outline, one script.
import { ICON_NAMES } from '../motion-kit/icons.mjs';
import { LANG_RE } from './jobs.mjs';
import { wordsOf } from './script.mjs';
import { stripMarks } from './marks.mjs';
import { matchIcon } from './icon-match.mjs';
import { LOOK_NAMES } from './looks.mjs';

// Moods are the look names: the outline's mood becomes script.look, and brand fields a person set still win at prepare.
export const DEFAULT_MOOD = 'calm';
// These moods open on the brand dark colour where the opening kind takes a theme.
const DARK_MOODS = ['premium', 'bold'];

/**
 * The outline, the same for every template: per part (`headline` → open, each of `points` → point, `cta` → close),
 * what it must carry and what it may carry. `beats.quick[part]` maps these fields onto one scene kind
 * (`{ kind, <outline field>: <scene field> }`).
 */
export const OUTLINE = {
  open: { required: ['text'], fields: ['text', 'say', 'source'] },
  point: { required: ['label', 'text', 'source'], fields: ['label', 'text', 'say', 'tag', 'number', 'icon', 'source'] },
  close: { required: ['text', 'button'], fields: ['text', 'button', 'say', 'source'] },
};
const TOP_FIELDS = ['lang', 'mood', 'headline', 'points', 'cta'];
const TEXT_FIELDS = ['text', 'label', 'say', 'tag', 'button', 'icon', 'source'];
// Mapping keys the engine fills itself: the opening theme from the mood, a point's icon by matching.
const ENGINE_FILLED = ['theme', 'icon'];
const SOURCE_RE = /^(bullets|facts)\[(\d+)\]$/;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const hasSay = (item) => typeof item.say === 'string' && Boolean(item.say.trim());
// The voice line is the on-screen text when the outline gives no `say`.
const sayOf = (item) => (hasSay(item) ? item.say : item.text);
const landing = (beats, kind, field) => `${beats.id} ${kind} ${field === 'vo' ? 'voice line' : field}`;
const linesOf = (source) => ['bullets', 'facts'].map((k) => {
  const n = Array.isArray(source[k]) ? source[k].length : 0;
  return n > 1 ? `${k}[0-${n - 1}]` : n ? `${k}[0]` : `no ${k}`;
}).join(', ');

function sourceError(ref, source, at) {
  const m = SOURCE_RE.exec(ref.trim());
  if (!m) return `${at} must name a source.json line: "bullets[n]" or "facts[n]"`;
  const list = source[m[1]];
  if (!Array.isArray(list) || !list[Number(m[2])]) return `${at} "${ref}" is not in source.json (it has ${linesOf(source)})`;
  return null;
}

/** Errors and warnings for one part of the outline (`at` is its path, e.g. `points[2]`). */
function partErrors(beats, part, item, at, source, out) {
  const spec = OUTLINE[part];
  const map = beats.quick[part];
  const kind = map.kind;
  const required = [...spec.required, ...(map.source && beats.fields[kind].required.includes(map.source) ? ['source'] : [])];
  if (!isObj(item)) { out.errors.push(`${at} must be an object with ${required.join(', ')}`); return; }
  for (const k of Object.keys(item)) if (!spec.fields.includes(k)) out.warnings.push(`${at}.${k} is not an outline field; ignored`);
  for (const f of required) if (blank(item[f])) out.errors.push(`${at}.${f} is required`);
  for (const f of TEXT_FIELDS) if (item[f] !== undefined && typeof item[f] !== 'string') out.errors.push(`${at}.${f} must be text`);
  for (const f of spec.fields) if (item[f] !== undefined && !Object.hasOwn(map, f)) out.warnings.push(`${at}.${f} is not shown by ${beats.id}; ignored`);
  if (source && typeof item.source === 'string' && item.source.trim()) {
    const e = sourceError(item.source, source, `${at}.source`);
    if (e) out.errors.push(e);
  }
  for (const [f, to] of Object.entries(map)) {
    if (f === 'kind' || ENGINE_FILLED.includes(f)) continue;
    const from = f === 'say' && !hasSay(item) ? 'text' : f;
    const v = item[from];
    if (typeof v !== 'string') continue;
    if (to === 'vo') {
      const n = wordsOf(v).length, max = beats.limits?.voWords;
      if (max && n > max) out.errors.push(`${at}.${from} has ${n} words, limit ${max} (${landing(beats, kind, to)}): cut ${n - max}`);
    } else {
      const n = stripMarks(v.trim()).length, max = beats.limits?.[to];
      if (max && n > max) out.errors.push(`${at}.${from} is ${n} characters, limit ${max} (${landing(beats, kind, to)}): cut ${n - max}`);
    }
  }
}

/**
 * Checks an outline against a template's `beats.quick` and the job's source.json. Returns `{ errors, warnings }`;
 * each limit error names the outline field, the template field it lands in, the limit and how much to cut.
 */
export function validateOutline(outline, beats, { source = null } = {}) {
  const out = { errors: [], warnings: [] };
  const q = beats?.quick;
  if (!q) { out.errors.push(`Template ${beats?.id} has no quick mode: write script.draft.json instead`); return out; }
  if (!isObj(outline)) { out.errors.push('The outline must be a JSON object with headline, points and cta'); return out; }
  const src = isObj(source) ? source : null;
  if (!src) out.errors.push('Commit source.json first: every point names the source.json bullet or fact it comes from');
  for (const k of Object.keys(outline)) if (!TOP_FIELDS.includes(k)) out.warnings.push(`${k} is not an outline field; ignored`);
  if (outline.mood !== undefined && !LOOK_NAMES.includes(outline.mood)) out.errors.push(`mood ${JSON.stringify(outline.mood)} is not one of ${LOOK_NAMES.join(', ')}`);
  if (outline.lang !== undefined && !(typeof outline.lang === 'string' && LANG_RE.test(outline.lang))) out.errors.push('lang must be a language code such as "en" or "vi"');
  if (outline.headline === undefined) out.errors.push('headline is required: { "text": "..." }');
  else partErrors(beats, 'open', outline.headline, 'headline', src, out);
  const [lo, hi] = q.points;
  const points = outline.points;
  if (!Array.isArray(points)) out.errors.push(`points must be a list of ${lo}-${hi} points`);
  else {
    if (points.length > hi) out.errors.push(`points has ${points.length} items, limit ${hi} (${beats.id}): cut ${points.length - hi}`);
    if (points.length < lo) out.errors.push(`points has ${points.length} item(s), at least ${lo} (${beats.id}): add ${lo - points.length}`);
    points.forEach((p, i) => partErrors(beats, 'point', p, `points[${i}]`, src, out));
  }
  if (outline.cta === undefined) {
    const closing = q.close && beats.sequence.find((s) => s.kind.includes(q.close.kind));
    if (closing?.min >= 1) out.errors.push(`cta is required by ${beats.id}: { "text": "...", "button": "..." }`);
  } else if (!q.close) out.warnings.push(`cta is not shown by ${beats.id}; ignored`);
  else partErrors(beats, 'close', outline.cta, 'cta', src, out);
  return out;
}

// The example outline in the quick context, cut down to the fields a template maps. Short enough for any template.
const EXAMPLE = {
  open: { text: 'The news in one line', say: 'The headline as it is spoken.', source: 'bullets[0]' },
  point: (n) => ({ label: `Point ${n}`, text: 'What it means to the viewer', say: 'One short spoken sentence.', source: `bullets[${n}]` }),
  close: { text: 'What to do next', button: 'Shop now', say: 'Ask the viewer to act.' },
};
const OUTLINE_PATH = { open: 'headline', point: 'points[]', close: 'cta' };
// Average English word plus its space, for the words hint next to a character limit.
const CHARS_PER_WORD = 6;
const QUICK_RULE = 'Write an outline, not a script: shaped like shape, every field within its limit in fields, as many points as the source supports. The engine builds the script: scenes open, point-1 … point-N, close, with layouts, icons and the mood\'s look. Take every claim from source.json and name its line in source. The engine never shortens text: an error names the field and the cut; fix only that. say is the spoken line. A locked field keeps the person\'s value. With outline present, start from it and change only what the brief, the notes or the step to redo ask.';

/** What one outline field takes, in a short line a model can follow. */
function fieldNote(beats, part, from, to) {
  const map = beats.quick[part];
  const need = OUTLINE[part].required.includes(from) || (from === 'source' && beats.fields[map.kind].required.includes(to)) ? 'required' : 'optional';
  if (from === 'source') return `${need}: bullets[n] or facts[n]`;
  if (from === 'icon') return `${need}: one of icons, default matched`;
  const max = to === 'vo' ? beats.limits?.voWords : beats.limits?.[to];
  if (to === 'vo') return `${need} spoken line${max ? `: max ${max} words` : ''}, default the text`;
  return max ? `${need}: max ${max} chars (~${Math.floor(max / CHARS_PER_WORD)} words)` : need;
}

/**
 * The quick context's rules for one template: point count, whether the cta is required, the moods, each outline
 * field with its limit, the icon names, an example outline that passes validateOutline, and the rule text.
 */
export function quickRules(beats, { brandIcons = [] } = {}) {
  const q = beats.quick;
  const closing = q.close && beats.sequence.find((s) => s.kind.includes(q.close.kind));
  const fields = { mood: `optional: one of moods, default ${DEFAULT_MOOD}`, lang: 'optional: language code, default the brief\'s' };
  for (const part of Object.keys(OUTLINE)) {
    for (const [from, to] of Object.entries(q[part] || {})) {
      if (from !== 'kind' && OUTLINE[part].fields.includes(from)) fields[`${OUTLINE_PATH[part]}.${from}`] = fieldNote(beats, part, from, to);
    }
  }
  const pick = (part, ex) => Object.fromEntries(Object.entries(ex).filter(([k]) => Object.hasOwn(q[part], k) || OUTLINE[part].required.includes(k)));
  // Two example points, within the template's count: the rule asks for as many as the source supports.
  const n = Math.max(q.points[0], Math.min(q.points[1], 2));
  return {
    template: beats.id, points: q.points, cta: closing?.min >= 1 ? 'required' : q.close ? 'optional' : 'none',
    // One line of names: a JSON list would print one name a line in `cli context`.
    moods: LOOK_NAMES, fields, icons: { brand: brandIcons, builtIn: ICON_NAMES.join(', ') },
    shape: {
      mood: DEFAULT_MOOD, headline: pick('open', EXAMPLE.open),
      points: Array.from({ length: n }, (_, i) => pick('point', EXAMPLE.point(i + 1))),
      ...(q.close ? { cta: pick('close', EXAMPLE.close) } : {}),
    },
    rule: QUICK_RULE,
  };
}

/** One scene from one outline part: the mapped fields copied (ends trimmed), never composed or cut. */
function sceneOf(id, item, map) {
  const sc = { id, kind: map.kind };
  for (const [f, to] of Object.entries(map)) {
    if (f === 'kind' || ENGINE_FILLED.includes(f)) continue;
    const v = f === 'say' ? sayOf(item) : item[f];
    if (v !== undefined) sc[to] = typeof v === 'string' ? v.trim() : v;
  }
  return sc;
}

/**
 * A point's icon: the outline's own, else a brand icon named in the point, else the best keyword match, else the
 * template's fallback cycle. A matched icon an earlier point already shows falls to the cycle, so the icon changes.
 */
function pickIcon(p, i, cycle, icons, brandIcons, used) {
  if (typeof p.icon === 'string' && p.icon.trim()) return { icon: p.icon.trim(), how: 'from the outline' };
  const hit = matchIcon([p.label, p.text, p.say, p.tag], icons, brandIcons);
  if (hit && !used.has(hit)) return { icon: hit, how: brandIcons.includes(hit) ? 'brand icon named in the point' : 'keyword match' };
  const pool = cycle.filter((n) => icons.includes(n));
  const free = pool.map((_, k) => pool[(i + k) % pool.length]).find((n) => !used.has(n));
  return { icon: free ?? pool[i % pool.length] ?? hit ?? icons[0], how: hit ? `fallback, ${hit} is on an earlier point` : 'fallback, no keyword matched' };
}

/**
 * The full script for a valid outline (run validateOutline first): scenes `open`, `point-1` … `point-N`, `close`, so
 * a person's locks hold across re-runs; `vary` cycled over the points; `look` from the mood; `generated: "outline"`.
 * Returns `{ script, notes }`, `notes` saying how each icon and the look were chosen.
 */
export function expandOutline(outline, beats, { icons = ICON_NAMES, brandIcons = [] } = {}) {
  const q = beats.quick;
  const mood = outline.mood ?? DEFAULT_MOOD;
  const notes = [`look ${mood} (${outline.mood === undefined ? 'no mood given' : 'the mood'})`];
  const open = sceneOf('open', outline.headline, q.open);
  if (q.open.theme && DARK_MOODS.includes(mood)) {
    open[q.open.theme] = 'dark';
    notes.push(`open: theme dark (the ${mood} mood)`);
  }
  const used = new Set();
  const points = outline.points.map((p, i) => {
    const sc = sceneOf(`point-${i + 1}`, p, q.point);
    for (const [f, cycle] of Object.entries(q.vary || {})) sc[f] = cycle[i % cycle.length];
    if (q.point.icon) {
      const { icon, how } = pickIcon(p, i, q.icons || [], icons, brandIcons, used);
      sc[q.point.icon] = icon;
      used.add(icon);
      notes.push(`${sc.id}: icon ${icon} (${how})`);
    }
    return sc;
  });
  const close = outline.cta !== undefined && q.close ? [sceneOf('close', outline.cta, q.close)] : [];
  const script = {
    template: beats.id, ...(outline.lang ? { lang: outline.lang } : {}), look: mood, generated: 'outline',
    scenes: [open, ...points, ...close],
  };
  return { script, notes };
}
