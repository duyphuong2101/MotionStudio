// The Preview tab's Timeline: pure helpers (no DOM), imported by app.js and tests/timeline-ui.test.mjs.
// Lengths come from the last prepare's timing.json; a scene cannot stretch, only reorder and pause after its line.

export const HOLD_MAX = 4; // engine/script.mjs MAX_HOLD
export const HOLD_STEP = 0.1;
export const CUT_SOUNDS = ['whoosh', 'hit', 'riser', 'click', 'none']; // engine/brand.mjs CUT_SOUNDS
// templates/ui-story CUE_TIMES: a cued shot starts this long before its word, and each shot gets at least SHOT_MIN.
export const CUE_LEAD = 0.3;
export const SHOT_MIN = 1.2;
const SHOT_IN = 0.15;
// A scene with no timing yet (added since the last prepare) is drawn at this many words per second plus a second.
const EST_WPS = 2.6;

const r3 = (v) => Math.round(v * 1000) / 1000;
const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/** A hold as the engine takes it: 0-HOLD_MAX in steps of HOLD_STEP. */
export const roundHold = (v) => Math.round(Math.min(HOLD_MAX, Math.max(0, Number(v) || 0)) / HOLD_STEP) / (1 / HOLD_STEP);
export const fmtSec = (v) => `${(Math.round(v * 10) / 10).toFixed(1)} s`;

/**
 * One block per scene in script order. `base` is the scene's length at the last prepare without the hold it had then
 * (timing.json records it); `length` adds the hold the script sets now. `words` are scene-relative.
 */
export function sceneSpans(script, timing) {
  const byId = new Map((timing?.scenes || []).map((s) => [s.id, s]));
  const wps = timing?.wordsPerSecond || EST_WPS;
  let t = 0;
  return (script?.scenes || []).map((sc) => {
    const ts = byId.get(sc.id);
    const hold = roundHold(sc.hold);
    const base = ts ? Math.max(0.1, r3(ts.end - ts.start - (ts.hold || 0))) : r3(Math.max(2, wordCount(sc.vo) / wps + 1));
    const words = ts ? (timing.words || []).filter((w) => w.scene === sc.id).map((w) => ({ w: w.w, at: r3(w.start - ts.start), end: r3(w.end - ts.start) })) : [];
    const span = { id: sc.id, kind: sc.kind, start: r3(t), base, hold, length: r3(base + hold), words, estimated: !ts };
    t += span.length;
    return span;
  });
}

export const totalOf = (spans) => r3(spans.reduce((a, s) => a + s.length, 0));

/** `list` with the item at `from` moved to index `to` (clamped). */
export function moveItem(list, from, to) {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** Where a dragged block whose middle is at `mid` seconds lands: the count of the other blocks whose middle is before it. */
export const dropIndex = (spans, from, mid) => spans.filter((s, i) => i !== from && s.start + s.length / 2 < mid).length;

// The renderer's and the validator's word key (templates/ui-story, engine/script.mjs validateShots).
export const cueKey = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
/** A voice word as a cue: its letters and digits without the punctuation around it ("click," → "click"). */
export const cueWord = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * The words a cue may name between word index `lo` and `hi` (both excluded): those the renderer, searching from `lo`,
 * finds at their own place, so a repeated word counts once, at its first place.
 */
function cueTargets(words, lo, hi) {
  const seen = new Set(), out = [];
  words.forEach((w, i) => {
    const k = cueKey(w.w);
    if (i <= lo || i >= hi || !k || seen.has(k)) return;
    seen.add(k);
    out.push(i);
  });
  return out;
}

/** The word a cue dragged to `t` (scene seconds) snaps to: the nearest of `cueTargets`, -1 when none fits. */
export function snapWord(words, t, lo = -1, hi = Infinity) {
  return cueTargets(words, lo, hi).reduce((best, i) => (best < 0 || Math.abs(words[i].at - t) < Math.abs(words[best].at - t) ? i : best), -1);
}

/** The next cue word from word `from` towards `dir` (+1 later, -1 earlier), under the same rule; -1 when none. */
export function stepWord(words, from, dir, lo = -1, hi = Infinity) {
  const ok = cueTargets(words, lo, hi);
  return (dir > 0 ? ok.find((i) => i > from) : ok.filter((i) => i < from).pop()) ?? -1;
}

/**
 * When each shot of a scene `length` long starts, as templates/ui-story CUE_TIMES places them: a cued shot CUE_LEAD
 * before its word (searched after the previous cued word), the rest spread between, each at least SHOT_MIN apart.
 * Returns [{ t, word }] in scene seconds; `word` is the matched word index, -1 for a shot without a found cue.
 */
export function shotTimes(shots, words, length) {
  const n = shots.length;
  const T = [], hits = [];
  let from = 0;
  for (const sh of shots) {
    const key = sh?.cue ? cueKey(sh.cue) : '';
    const hit = key ? words.findIndex((w, i) => i >= from && cueKey(w.w) === key) : -1;
    if (hit >= 0) from = hit + 1;
    hits.push(hit);
    T.push(hit >= 0 ? words[hit].at - CUE_LEAD : null);
  }
  if (!n) return [];
  if (T[0] === null || T[0] < SHOT_IN) T[0] = SHOT_IN;
  for (let k = 1; k < n; k++) {
    if (T[k] !== null) continue;
    let j = k;
    while (j < n && T[j] === null) j++;
    const tb = j < n ? T[j] : length, ta = T[k - 1];
    for (let m = k; m < j; m++) T[m] = ta + ((tb - ta) * (m - k + 1)) / (j - k + 1);
    k = j - 1;
  }
  for (let k = 1; k < n; k++) T[k] = Math.min(Math.max(T[k], T[k - 1] + SHOT_MIN), length - SHOT_MIN * (n - k));
  return T.map((t, k) => ({ t: r3(t), word: hits[k] }));
}

/** The word range a shot's cue may move in: after the previous shot's matched word, before the next one's. */
export function cueRange(times, k) {
  const before = times.slice(0, k).map((x) => x.word).filter((w) => w >= 0);
  const after = times.slice(k + 1).map((x) => x.word).filter((w) => w >= 0);
  return { lo: before.length ? before[before.length - 1] : -1, hi: after.length ? after[0] : Infinity };
}

/** A mixed brief's extra kinds are "<template>.<kind>"; their rules live in beats.sources[<template>]. */
const rulesFor = (beats, kind) => (kind.includes('.') ? beats.sources?.[kind.slice(0, kind.indexOf('.'))] : null) || beats;

/** The cut sounds a scene of `kind` may pick, or null when its template takes the brand's cut sound only. */
export function sfxOptions(beats, kind) {
  const spec = beats?.fields?.[kind];
  if (!spec || ![...spec.required, ...spec.optional].includes('sfx')) return null;
  return rulesFor(beats, kind).enums?.sfx || CUT_SOUNDS;
}

/** Whether a scene's shots take a `cue`: ui-story's `shot` kind, alone or in a mix. */
export const takesCue = (template, kind) => kind === 'ui-story.shot' || (kind === 'shot' && template === 'ui-story');

/**
 * The script after one Timeline edit, without its locks (the server records them):
 * { order: [ids] } | { hold: id, value } | { sfx: id, value } ('' = the brand's) | { cue: id, shot, value } ('' = none).
 */
export function editScript(script, edit) {
  const doc = structuredClone(script);
  delete doc.locks;
  const sc = (id) => doc.scenes.find((s) => s.id === id);
  if (edit.order) {
    const byId = new Map(doc.scenes.map((s) => [s.id, s]));
    doc.scenes = edit.order.map((id) => byId.get(id)).filter(Boolean);
  } else if (edit.hold !== undefined) {
    const s = sc(edit.hold), v = roundHold(edit.value);
    if (v) s.hold = v; else delete s.hold;
  } else if (edit.sfx !== undefined) {
    const s = sc(edit.sfx);
    if (edit.value) s.sfx = edit.value; else delete s.sfx;
  } else if (edit.cue !== undefined) {
    const sh = sc(edit.cue).shots[edit.shot];
    if (edit.value) sh.cue = edit.value; else delete sh.cue;
  }
  return doc;
}
