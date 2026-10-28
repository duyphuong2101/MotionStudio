import { ICON_NAMES } from '../motion-kit/icons.mjs';
import { splitKind } from './mix.mjs';
import { nearestIcon } from './icon-match.mjs';
import { SCENE_ID_RE } from './script.mjs';

const SHOWN_MAX = 40;
const shown = (v) => { const t = JSON.stringify(v) ?? String(v); return t.length > SHOWN_MAX ? `${t.slice(0, SHOWN_MAX)}…` : t; };
const isScene = (s) => Boolean(s) && typeof s === 'object' && !Array.isArray(s);

/**
 * What the next lock merge will put back from `existing` (the commit base), so a repair never touches it:
 * the scene order, a scene's kind, and a field lock on a scene the merge keeps (a carried lock only on the same kind).
 */
function lockView(existing) {
  const locks = existing?.locks || {};
  const exById = new Map((existing?.scenes || []).filter(isScene).map((s) => [s.id, s]));
  const has = (s, key) => Boolean(locks[`scene:${s.id}.${key}`]) && exById.has(s.id);
  return {
    order: Boolean(locks.scenes),
    kindOf: (s) => (has(s, 'kind') ? exById.get(s.id).kind : s.kind),
    field: (s, f) => has(s, f) && (existing.carried !== true || exById.get(s.id).kind === s.kind),
  };
}

const slug = (kind) => String(kind ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'scene';
function freeId(base, n, taken) {
  for (let k = n; ; k++) {
    const tail = `-${k}`;
    const id = `${base.slice(0, 32 - tail.length).replace(/-+$/, '')}${tail}`;
    if (!taken.has(id)) return id;
  }
}

/** A missing, invalid or repeated scene id becomes `<kind>-<position>` (the next free number if taken). */
function repairIds(scenes, repairs) {
  const valid = (s) => typeof s.id === 'string' && SCENE_ID_RE.test(s.id);
  const taken = new Set(scenes.filter((s) => isScene(s) && valid(s)).map((s) => s.id));
  const seen = new Set();
  scenes.forEach((s, i) => {
    if (!isScene(s)) return;
    if (valid(s) && !seen.has(s.id)) { seen.add(s.id); return; }
    const was = valid(s) ? `duplicate id "${s.id}"` : s.id === undefined ? 'missing id' : `id ${shown(s.id)}`;
    const id = freeId(slug(s.kind), i + 1, taken);
    taken.add(id);
    seen.add(id);
    repairs.push(`scene ${i + 1}: ${was} is now ${id}`);
    s.id = id;
  });
}

/**
 * Scenes past a slot's `max` that no later slot takes are dropped (the later ones), walking `beats.sequence` the way
 * validateScript does; such a scene could only ever be an "unexpected scene" error.
 */
function dropOverMax(doc, beats, kindOf, repairs) {
  const seq = beats.sequence || [];
  const scenes = doc.scenes;
  const drop = new Set();
  let i = 0;
  seq.forEach((slot, k) => {
    const takes = (s) => isScene(s) && slot.kind.includes(kindOf(s));
    let n = 0;
    while (i < scenes.length && takes(scenes[i]) && n < slot.max) { i++; n++; }
    if (n < slot.max) return;
    const later = seq.slice(k + 1).flatMap((x) => x.kind);
    const extra = [];
    while (i < scenes.length && takes(scenes[i]) && !later.includes(kindOf(scenes[i]))) extra.push(scenes[i++]);
    if (!extra.length) return;
    extra.forEach((s) => drop.add(s));
    repairs.push(`dropped ${extra.length} scene(s) over the ${slot.max} of kind ${slot.kind.join('|')} the template takes: ${extra.map((s) => s.id).join(', ')}`);
  });
  if (drop.size) doc.scenes = scenes.filter((s) => !drop.has(s));
}

/** Ends of on-screen text and the voice line trimmed (silently); an unknown icon swapped; an off-list enum value removed. */
function repairScene(s, beats, icons, locks, repairs) {
  const { tpl } = splitKind(s.kind);
  const spec = beats.fields?.[s.kind];
  const rules = tpl ? beats.sources?.[tpl] : beats;
  if (!spec || !rules) return;
  const open = (f) => !locks.field(s, f);
  for (const f of ['vo', ...Object.keys(rules.limits || {})]) {
    if (typeof s[f] === 'string' && s[f] !== s[f].trim() && open(f)) s[f] = s[f].trim();
  }
  if (s.icon && !icons.includes(s.icon) && open('icon')) {
    const to = nearestIcon(String(s.icon), icons, beats.defaults?.[s.kind]?.icon);
    if (to) {
      repairs.push(`${s.id}: icon ${shown(s.icon)} is not an icon; using ${to}`);
      s.icon = to;
    }
  }
  for (const [f, allowed] of Object.entries(rules.enums || {})) {
    // A required enum field stays: removing it would only trade one error for another.
    if (s[f] === undefined || allowed.includes(s[f]) || spec.required.includes(f) || !open(f)) continue;
    repairs.push(`${s.id}: ${f} ${shown(s[f])} is not ${allowed.join('|')}; removed`);
    delete s[f];
  }
}

/**
 * Mechanical fixes on a script draft before the lock merge, for every Director: scene ids, scenes over a slot's
 * `max`, unknown icons, off-list enum values. Never changes words and never touches what a person locked in
 * `existing` (the commit base). Returns `{ doc, repairs }`: a copy of the draft and one line per repair.
 */
export function repairScript(draft, beats, { icons = ICON_NAMES, existing = null } = {}) {
  if (!Array.isArray(draft?.scenes)) return { doc: draft, repairs: [] };
  const doc = structuredClone(draft);
  const repairs = [];
  const locks = lockView(existing);
  if (!locks.order) {
    repairIds(doc.scenes, repairs);
    dropOverMax(doc, beats, locks.kindOf, repairs);
  }
  for (const s of doc.scenes) if (isScene(s)) repairScene(s, beats, icons, locks, repairs);
  return { doc, repairs };
}
