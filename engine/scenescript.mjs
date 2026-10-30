// Scene import (`node engine/cli.mjs import-script`, the UI's New from script; a person's tool, never the Director's):
// a person's scene script and the clips and pictures it names become a job whose source.json and script.json are
// locked as the person's own, status scripted. No model. Words are copied, never rewritten: a field over its limit
// is an error that names the scene, the line and the cut, as in engine/quick.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {
  DIRS, StudioError, assertId, assertFileName, within, readJson, writeJson, exists, nowIso, round, loadStudioConfig,
} from './core.mjs';
import {
  validateBrief, saveBrief, loadTemplate, loadBriefTemplate, loadBrand, listAssets, assetPath, setStatus, jobFile, briefFile, profileDir, humanEdit,
} from './jobs.mjs';
import { composeBeats } from './mix.mjs';
import { assertValidScript, validateSource, wordsOf, IMAGE_ASSET_RE, MAX_HOLD } from './script.mjs';
import { stripMarks } from './marks.mjs';
import { estimateTiming } from './timing.mjs';
import { probeMedia } from './media.mjs';

const SCENE_SCRIPT_CAPS ={ chars: 64 * 1024, scenes: 30, clips: 6, probes: 40 };
// Clip scenes are explainer `video` scenes; picture scenes are lifestyle `gallery` scenes through the mix. A script with
// no TITLE and no End card is a clip reel (templates/clip-reel): clips only, full frame, no cards, no subtitles.
const LEAD = 'explainer';
const REEL = 'clip-reel';
const PICTURES = 'lifestyle';
const GALLERY = `${PICTURES}.gallery`;
const DEFAULT_FORMAT = '16:9';
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
const SCRIPT_FILE_RE = /\.(txt|md)$/i;
// prepare refuses a clip shorter than this (sceneVideos in engine/pipeline.mjs).
const MIN_CLIP = 0.5;
// A range may end this far past a clip's probed length (container rounding).
const END_SLACK = 0.05;
// A picture scene whose voice line misses its span by more than this gets a warning.
const SPAN_SLACK = 0.5;
const IMPORT_NOTE = 'imported from a scene script';
export const SCENE_SCRIPT_RECORD = 'scene-script.json';
// Lockable fields every scene has (engine/jobs.mjs sceneFieldNames).
const EVERY_SCENE = ['speaker', 'stress', 'hold'];

const SCENE_RE = /^(?:SCENE|Scene|Cảnh|CẢNH)\s+(\d{1,3})\s*(?:[-–—]+|:)\s*(.*?)\s*(?:\(([^()]*)\))?$/;
// `Create an 8-second video` inside a scene without a span: its length, laid after the scene before it.
const LENGTH_RE = /\b(\d{1,3}(?:\.\d+)?)[\s-]*(?:s|secs?|seconds?)\b/i;
const SPAN_RE = /^([\d:.]+)\s*s?\s*[-–—]\s*([\d:.]+)\s*(?:s|secs?|seconds?)?$/i;
const CLIP_RE = /^(\S+)(?:\s+([\d:.]+)\s*s?\s*[-–—]\s*([\d:.]+)\s*s?)?$/i;
const KEY_RE = /^(clip|image|images|voice|on screen|button)\s*:\s*(.*)$/i;
const DIALOGUE_RE = /^optional\s+[\p{L} ]*dialogue\s*:\s*(.*)$/iu;
const END_CARD_RE = /^end card\s*:\s*(.*)$/i;
// A label in capitals (TITLE:, MAIN CHARACTER:, IMPORTANT TECHNICAL RULE:): a header field before the first scene;
// after it, with nothing behind the colon, a section of its own that ends the scene.
const LABEL_RE = /^([A-Z][A-Z0-9 ]*[A-Z0-9])\s*:\s*(.*)$/;
const HEADER_KEYS = { 'VIDEO ID': 'videoId', TITLE: 'title', DURATION: 'duration', FORMAT: 'format' };
const FIELD_OF = { clip: 'clips', image: 'image', images: 'images', voice: 'voice', 'on screen': 'onScreen', button: 'button' };
const QUOTES = { '"': '"', '“': '”', "'": "'", '‘': '’', '«': '»' };

const unquote = (s) => {
  const t = s.trim(), close = QUOTES[t[0]];
  return close && t.length > 1 && t.endsWith(close) ? t.slice(1, -1).trim() : t;
};
const isLabel = (line) => { const m = LABEL_RE.exec(line); return Boolean(m) && !m[2] && !KEY_RE.test(line); };
const breaksValue = (line) => SCENE_RE.test(line) || KEY_RE.test(line) || DIALOGUE_RE.test(line) || END_CARD_RE.test(line) || isLabel(line);
const slugOf = (v) => String(v || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Seconds from `4`, `4.5`, `4s` or `0:04`; null for anything else. */
export function parseSeconds(v) {
  const m = /^(?:(\d{1,3}):)?(\d+(?:\.\d+)?)$/.exec(String(v ?? '').trim().replace(/s$/i, ''));
  if (!m || (m[1] !== undefined && Number(m[2]) >= 60)) return null;
  return round((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]));
}

/** `Vertical 9:16` → `9:16`; a ratio, or vertical / horizontal / square in words; null when none. */
export function parseFormat(v) {
  const m = /(\d{1,2})\s*[:x×]\s*(\d{1,2})/.exec(String(v));
  if (m) return `${m[1]}:${m[2]}`;
  if (/vertical|portrait/i.test(v)) return '9:16';
  if (/horizontal|landscape/i.test(v)) return '16:9';
  if (/square/i.test(v)) return '1:1';
  return null;
}

/** `c3a.mp4 0:00-0:04, c3b.mp4` → clips with an optional in-out range in seconds. */
function parseClips(value, at) {
  const clips = [], errors = [];
  for (const item of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = CLIP_RE.exec(item);
    if (!m) { errors.push(`${at}: "${item}" is not a clip: write CLIP: name.mp4 or CLIP: name.mp4 0:00-0:04`); continue; }
    const clip = { name: m[1] };
    if (m[2] !== undefined) {
      const a = parseSeconds(m[2]), b = parseSeconds(m[3]);
      if (a === null || b === null || b <= a) { errors.push(`${at}: ${m[1]} ${m[2]}-${m[3]} is not a range: write start-end in seconds or m:ss, e.g. 0:00-0:04`); continue; }
      Object.assign(clip, { in: a, out: b });
    }
    clips.push(clip);
  }
  return { clips, errors };
}

/**
 * Reads a scene script (pure, no file access): the header (TITLE, DURATION, FORMAT, VIDEO ID, a VOICE line for the
 * opening title card, other capital labels kept as they are), the `SCENE n — TITLE (a–b seconds)` blocks with their
 * CLIP, IMAGE, IMAGES, VOICE and ON SCREEN lines (`Optional … dialogue:` + a quoted line is the VOICE), other lines
 * as notes, the `End card:` line with its own VOICE and BUTTON, and the capital sections after the scenes. Mistakes
 * the person must fix land in `errors` (per scene on the scene); a missing or oversized text throws.
 */
export function parseSceneScript(text, caps = SCENE_SCRIPT_CAPS) {
  if (typeof text !== 'string' || !text.trim()) throw new StudioError('Paste the scene script: a TITLE line, then SCENE 1 — TITLE (0–4 seconds) blocks', 400);
  if (text.length > caps.chars) throw new StudioError(`The script is ${text.length} characters, limit ${caps.chars}: split it into two videos`, 413);
  const doc = { header: { other: {}, notes: [] }, scenes: [], endCard: null, sections: [], errors: [] };
  let where = 'header', scene = null, section = null, pending = null;
  const atOf = () => (where === 'card' ? 'End card' : where === 'scene' ? `Scene ${scene.n}` : 'Title card');
  const errorsOf = () => (where === 'card' ? doc.endCard.errors : where === 'scene' ? scene.errors : doc.errors);

  const setHeader = (key, raw, label) => {
    const v = unquote(raw);
    if (key === 'duration') {
      const m = /(\d+(?:\.\d+)?)/.exec(v);
      if (m) doc.header.duration = Number(m[1]); else doc.errors.push('DURATION: write the length in seconds, e.g. 45 seconds');
    } else if (key === 'format') {
      doc.header.format = parseFormat(v);
      if (!doc.header.format) doc.errors.push(`FORMAT: "${v}" names no format: write e.g. Vertical 9:16 or 16:9`);
    } else if (key) doc.header[key] = v;
    else doc.header.other[label] = v;
  };

  // One field of the scene, the end card or the header (a VOICE before SCENE 1 is the title card's).
  const put = (key, raw, line) => {
    const at = atOf(), label = key.toUpperCase();
    const field = FIELD_OF[key] || key;
    if (where === 'header' && field !== 'voice') { doc.errors.push(`Line ${line}: ${label}: comes before SCENE 1: put it under its scene`); return; }
    // The end card sits inside the last scene: only its text, VOICE and BUTTON are the card's.
    const card = where === 'card' && ['voice', 'button', 'text'].includes(field);
    const into = where === 'header' ? doc.header : card ? doc.endCard : scene;
    const errs = card ? doc.endCard.errors : where === 'header' ? doc.errors : scene.errors;
    const sceneAt = card || where === 'header' ? at : `Scene ${scene.n}`;
    if (field === 'button' && !card) { errs.push(`${sceneAt}: BUTTON: belongs under End card`); return; }
    if (field === 'clips') {
      const r = parseClips(raw, sceneAt);
      scene.clips.push(...r.clips);
      errs.push(...r.errors);
      return;
    }
    const value = field === 'images' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : field === 'voice' ? unquote(raw) : raw.trim();
    if (field === 'image' && value.includes(',')) { errs.push(`${sceneAt}: IMAGE takes one picture: use IMAGES: for 2-4`); return; }
    if (into[field] !== undefined && into[field] !== '' && !(Array.isArray(into[field]) && !into[field].length)) {
      errs.push(`${sceneAt} has two ${field === 'text' ? 'End card' : label} lines: keep one`);
      return;
    }
    into[field] = value;
  };
  const later = (key, line) => {
    const at = atOf(), errs = errorsOf();
    pending = { set: (v) => put(key, v, line), missing: () => errs.push(`${at}: ${key === 'text' ? 'End card' : key.toUpperCase()}: has no text: write it after the colon`) };
  };

  // trim() also drops a byte order mark.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  lines.forEach((line, i) => {
    if (!line) return;
    const n = i + 1;
    if (pending) {
      const p = pending;
      pending = null;
      if (!breaksValue(line)) { p.set(line); return; }
      p.missing();
    }
    const sc = SCENE_RE.exec(line);
    if (sc) {
      if (doc.endCard && !doc.endCard.errors.some((e) => e.includes('comes before SCENE'))) doc.endCard.errors.push(`End card: it comes before SCENE ${sc[1]}: move it under the last scene`);
      const num = Number(sc[1]);
      scene = { n: num, title: sc[2], from: null, to: null, clips: [], image: '', images: [], voice: '', onScreen: '', notes: [], errors: [], line: n };
      if (doc.scenes.some((s) => s.n === num)) scene.errors.push(`Scene ${num} appears twice: number the scenes 1, 2, 3…`);
      if (!sc[2]) scene.errors.push(`Scene ${num}: give the scene a title after the dash`);
      const span = sc[3] === undefined ? null : SPAN_RE.exec(sc[3].trim());
      const from = span && parseSeconds(span[1]), to = span && parseSeconds(span[2]);
      if (sc[3] !== undefined && (from === null || to === null || to <= from)) scene.errors.push(`Scene ${num}: "(${sc[3]})" is not a span of seconds: write it like (10–19 seconds)`);
      else Object.assign(scene, { from, to });
      doc.scenes.push(scene);
      where = 'scene';
      return;
    }
    const key = KEY_RE.exec(line), dialogue = DIALOGUE_RE.exec(line), end = END_CARD_RE.exec(line), label = LABEL_RE.exec(line);
    if (where === 'section') {
      if (isLabel(line)) { section = { title: label[1], lines: [] }; doc.sections.push(section); return; }
      if (key || dialogue || end) { doc.errors.push(`Line ${n}: "${line.slice(0, 40)}" is under ${section.title}, not under a scene: move it into its scene`); return; }
      section.lines.push(line);
      return;
    }
    if (key || dialogue) {
      const k = key ? key[1].toLowerCase() : 'voice', v = key ? key[2] : dialogue[1];
      if (v.trim()) put(k, v, n); else later(k, n);
      return;
    }
    if (where === 'header') {
      if (end) { doc.errors.push(`Line ${n}: End card comes before SCENE 1: put it under the last scene`); return; }
      if (label) { if (label[2]) setHeader(HEADER_KEYS[label[1]], label[2], label[1]); else pending = { set: (v) => setHeader(HEADER_KEYS[label[1]], v, label[1]), missing: () => doc.errors.push(`${label[1]}: has no text: write it after the colon`) }; return; }
      doc.header.notes.push(line);
      return;
    }
    if (end) {
      if (doc.endCard) { doc.endCard.errors.push(`End card: a second End card on line ${n}: keep one`); return; }
      doc.endCard = { text: '', voice: '', button: '', notes: [], errors: [], scene: scene.n };
      where = 'card';
      if (end[1].trim()) put('text', end[1], n); else later('text', n);
      return;
    }
    // A bare capital label after the End card opens a trailing section; inside a scene (ACTION:, CAMERA:) it is a note.
    if (isLabel(line) && where === 'card') { section = { title: label[1], lines: [] }; doc.sections.push(section); where = 'section'; return; }
    (where === 'card' ? doc.endCard.notes : scene.notes).push(line);
  });
  if (pending) pending.missing();
  spanScenes(doc);
  if (!doc.header.format) {
    for (const s of doc.scenes) { const f = s.notes.map(parseFormat).find(Boolean); if (f) { doc.header.format = f; break; } }
  }
  if (!doc.scenes.length) doc.errors.push('No SCENE lines found: start each scene with SCENE 1 — TITLE (0–4 seconds)');
  if (doc.scenes.length > caps.scenes) doc.errors.push(`The script has ${doc.scenes.length} scenes, limit ${caps.scenes}: split it into two videos`);
  return doc;
}

/**
 * A scene with no `(a–b seconds)` takes its length from an `N-second` phrase in its lines and starts where the scene
 * before it ends (0 for the first); a scene with neither gets an error. Spans given on the SCENE line are kept.
 */
function spanScenes(doc) {
  let end = 0;
  for (const s of doc.scenes) {
    if (s.from === null && s.to === null && !s.errors.some((e) => e.includes('is not a span'))) {
      const m = s.notes.map((l) => LENGTH_RE.exec(l)).find(Boolean);
      const len = m ? parseSeconds(m[1]) : null;
      if (len) Object.assign(s, { from: round(end), to: round(end + len) });
      else s.errors.push(`Scene ${s.n}: add its seconds to the SCENE line, e.g. (0–4 seconds), or say its length in the text, e.g. an 8-second video`);
    }
    if (s.to !== null) end = s.to;
  }
}

/** A job id from the script: its VIDEO ID, else its TITLE, as a-z0-9 and dashes. */
export function scriptJobId(header, doc = null) {
  const s = slugOf(header.videoId) || slugOf(header.title) || slugOf(doc?.scenes?.[0]?.title && `${doc.scenes[0].title}-reel`);
  return s ? s.slice(0, 64).replace(/-+$/, '') : 'scene-script';
}

/** A field over its template limit: an error naming the line it came from, where it lands and the cut. */
function limit(r, rules, field, value, line, landing) {
  if (!value) return;
  const words = field === 'vo';
  const n = words ? wordsOf(value).length : stripMarks(value).length;
  const max = words ? rules.limits.voWords : rules.limits[field];
  if (max && n > max) r.errors.push(`${r.at}: ${line} ${words ? 'has' : 'is'} ${n} ${words ? 'words' : 'characters'}, limit ${max} (${landing} ${words ? 'voice line' : field}): cut ${n - max}`);
}

/** One CLIP entry against the assets and its probed length: { name, in, out, sound } or null with an error on the row. */
function clipPart(c, r, assets, media) {
  const { name } = c;
  try { assertFileName(name, 'clip'); } catch { r.errors.push(`${r.at}: "${name}" is not a file name: use letters, digits, dots, dashes or underscores`); return null; }
  if (!VIDEO_RE.test(name)) { r.errors.push(`${r.at}: ${name} is not a video: CLIP takes .mp4, .webm or .mov`); return null; }
  if (!assets.includes(name)) { r.errors.push(`${r.at}: ${name} is not in the project assets: upload it, then check again`); return null; }
  const info = media[name];
  if (!info || info.error) { r.errors.push(`${r.at}: ${name}: ${info?.error || 'its length could not be read'}`); return null; }
  const length = round(info.duration);
  const from = c.in ?? 0;
  if (c.out !== undefined && c.out > length + END_SLACK) { r.errors.push(`${r.at}: ${name} is ${round(length, 2)} s long, its range ends at ${c.out} s`); return null; }
  const to = Math.min(c.out ?? length, length);
  if (to - from < MIN_CLIP) { r.errors.push(`${r.at}: ${name} ${from}-${to} s is under ${MIN_CLIP} s: widen the range`); return null; }
  return { name, in: from, out: to, sound: info.hasAudio === true, hold: 0 };
}

/**
 * The scene's span over its clips: a longer run is cut at the last clip's `out`, a shorter one holds the last clip's
 * last frame (`hold`, at most MAX_HOLD). Only a clip that plays its own sound sets its scene's length (prepare's
 * `fixed` lengths), so a silent last clip keeps no hold and the row says the span will not hold.
 */
function fitSpan(parts, span, r, notes) {
  const len = (p) => round(p.out - p.in);
  const total = round(parts.reduce((a, p) => a + len(p), 0));
  const last = parts[parts.length - 1];
  if (total > span + 0.001) {
    const cut = round(total - span);
    if (len(last) - cut < MIN_CLIP) { r.errors.push(`${r.at}: the clips run ${total} s, the span ${span} s: cut ${cut} s from the ranges`); return false; }
    last.out = round(last.out - cut);
    notes.push(`${r.at}: ${last.name} ends at ${last.out} s to fit the ${span} s span`);
  } else if (span - total > 0.001) {
    const hold = round(span - total);
    if (hold > MAX_HOLD) { r.errors.push(`${r.at}: the clips run ${total} s of a ${span} s span, and a clip holds its last frame at most ${MAX_HOLD} s: add ${round(hold - MAX_HOLD)} s of clip`); return false; }
    if (last.sound) last.hold = hold;
  }
  for (const p of parts) if (!p.sound) r.warnings.push(`${r.at}: ${p.name} has no sound, so its scene follows the voice line, not the ${span} s span (a clip sets its scene's length only through its own sound)`);
  return true;
}

const sceneFact = (s) => `Scene ${s.n} — ${s.title}${s.onScreen ? `. On screen: ${s.onScreen}` : ''}${s.voice ? `. Voice: "${s.voice}"` : ''}`;

/**
 * The job for a parsed script, without writing anything: `{ id, brief, source, script, rows, errors, warnings, notes,
 * duration, record }`. `beats` composes explainer with lifestyle (sceneBeats); `media` holds each clip's probed
 * `{ duration, hasAudio }` (or `{ error }`); `timing` is config/studio.json → timing. Each row (title card, scene,
 * end card) lists the scenes it made with their assets, and its own errors and warnings, each naming the row.
 */
export function mapSceneScript(doc, { beats, reel: reelBeats = null, assets = [], media = {}, timing, lang = 'en', file = 'script', job, project, by = 'cli', caps = SCENE_SCRIPT_CAPS }) {
  const reel = isReel(doc);
  const lead = reel ? (reelBeats || loadTemplate(REEL).beats) : beats.sources[LEAD], pics = beats.sources[PICTURES];
  const wps = timing.wordsPerSecond[lang] ?? timing.wordsPerSecond[String(lang).split('-')[0]] ?? timing.wordsPerSecond.default;
  const speaks = (vo, tail = timing.tailOut) => round(timing.leadIn + wordsOf(vo).length / wps + tail, 1);
  const rows = [], errors = [...doc.errors], warnings = [], notes = [], facts = [], scenes = [];
  const row = (at, title, from = {}) => { const r = { at, title: title || '', parts: [], errors: [...(from.errors || [])], warnings: [] }; rows.push(r); return r; };
  const factOf = (text, ref) => { facts.push({ text, ref: `${file}, ${ref}` }); return `facts[${facts.length - 1}]`; };
  const { header } = doc;
  const title = header.title || '';

  if (reel) {
    notes.push(`No TITLE line and no End card: the film is a clip reel (${REEL}), the clips full frame with their own sound, no cards and no subtitles. Add a TITLE line with a VOICE line for an explainer with a title card.`);
    if (header.voice) errors.push('VOICE before SCENE 1 belongs to a title card: add a TITLE line for an explainer, or move the line under its scene');
  } else {
    const open = row('Title card', title);
    if (!title) open.errors.push('Title card: add a TITLE line: explainer opens on a title card');
    if (!header.voice) open.errors.push('Title card: explainer opens on a title card with a voice line: add a VOICE: line under TITLE, before SCENE 1');
    limit(open, lead, 'title', title, 'TITLE', 'title card');
    limit(open, lead, 'vo', header.voice, 'VOICE', 'title card');
    scenes.push({ id: 'title', kind: 'title', title, vo: header.voice || '', source: 'bullets[0]' });
    open.parts.push({ id: 'title', kind: 'title', assets: [] });
  }

  let mixed = false, prev = null;
  const fixed = {};
  for (const s of doc.scenes) {
    const at = `Scene ${s.n}`, shown = s.onScreen || s.title, line = s.onScreen ? 'ON SCREEN' : 'the SCENE title';
    const r = row(at, shown, s);
    const span = s.from !== null && s.to !== null ? round(s.to - s.from) : null;
    if (span !== null) r.span = [s.from, s.to];
    const pictures = s.image ? [s.image] : s.images;
    if (prev && prev.to !== null && s.from !== null && Math.abs(s.from - prev.to) > 0.001) r.warnings.push(`${at} starts at ${s.from} s and scene ${prev.n} ends at ${prev.to} s: the scenes play back to back`);
    prev = s;
    if (!s.clips.length && !pictures.length) { r.errors.push(`${at} has no CLIP or IMAGE: add the clip or picture it shows`); continue; }
    if (s.clips.length && pictures.length) { r.errors.push(`${at} has both CLIP and IMAGE lines: give it one or the other`); continue; }
    if (s.image && s.images.length) { r.errors.push(`${at} has both IMAGE and IMAGES lines: keep one`); continue; }
    if (pictures.length && reel) { r.errors.push(`${at}: a clip reel takes CLIP scenes only: add a TITLE line with a VOICE line to make an explainer, which shows IMAGES as a picture scene`); continue; }
    if (s.image) { r.errors.push(`${at}: IMAGE shows one picture, and no scene kind that mixes into explainer shows one picture (lifestyle photo does not mix): use IMAGES: with 2-4 pictures, or a CLIP`); continue; }
    const source = factOf(sceneFact(s), `scene ${s.n}`);
    if (s.clips.length) {
      // A reel clip carries text only when the scene has an ON SCREEN line; its title stays in the script record.
      const label = reel ? s.onScreen : shown;
      limit(r, lead, 'title', label, line, 'video scene');
      limit(r, lead, 'vo', s.voice, 'VOICE', 'video scene');
      if (s.clips.length > caps.clips) { r.errors.push(`${at} has ${s.clips.length} clips, limit ${caps.clips}: split it into two scenes`); continue; }
      const parts = s.clips.map((c) => clipPart(c, r, assets, media)).filter(Boolean);
      if (parts.length < s.clips.length || span === null || !fitSpan(parts, span, r, notes)) continue;
      parts.forEach((p, k) => {
        const id = parts.length > 1 ? `scene-${s.n}${String.fromCharCode(97 + k)}` : `scene-${s.n}`;
        const vo = k === 0 ? s.voice : '';
        scenes.push({
          id, kind: 'video', ...(label ? { title: label } : {}), ...(vo ? { vo } : {}), video: p.name, in: p.in, out: p.out,
          ...(p.sound ? { sound: true } : {}), ...(p.hold ? { hold: p.hold } : {}), source,
        });
        r.parts.push({ id, kind: 'video', assets: [p.name], in: p.in, out: p.out, hold: p.hold, sound: p.sound });
        const length = round(p.out - p.in);
        if (p.sound) fixed[id] = length;
        if (vo && p.sound && speaks(vo) > length) r.warnings.push(`${at}: the voice line takes about ${speaks(vo)} s, its clip ${length} s: the scene runs on until the voice ends, past its span`);
      });
      continue;
    }
    const [lo, hi] = pics.data.gallery.photos;
    if (pictures.length < lo || pictures.length > hi) r.errors.push(`${at}: IMAGES lists ${pictures.length} picture(s); a picture scene (lifestyle gallery) shows ${lo}-${hi}`);
    for (const name of pictures) {
      let ok = true;
      try { assertFileName(name, 'picture'); } catch { ok = false; }
      if (!ok || !IMAGE_ASSET_RE.test(name)) r.errors.push(`${at}: ${name} is not a picture: IMAGES takes .png, .jpg or .webp files`);
      else if (!assets.includes(name)) r.errors.push(`${at}: ${name} is not in the project assets: upload it, then check again`);
    }
    if (!s.voice) r.errors.push(`${at}: a picture scene (lifestyle gallery) needs a voice line: add a VOICE: line`);
    limit(r, pics, 'title', shown, line, 'picture scene');
    limit(r, pics, 'vo', s.voice, 'VOICE', 'picture scene');
    const id = `scene-${s.n}`;
    scenes.push({ id, kind: GALLERY, title: shown, vo: s.voice, photos: pictures.map((asset) => ({ asset })), source });
    r.parts.push({ id, kind: GALLERY, assets: pictures });
    mixed = true;
    const est = Math.max(pics.pace.normal.minScene, speaks(s.voice));
    if (s.voice && span !== null && Math.abs(est - span) > SPAN_SLACK) r.warnings.push(`${at}: a picture scene lasts as long as its voice line (about ${est} s), not its ${span} s span`);
  }

  if (doc.endCard) {
    const c = doc.endCard, r = row('End card', c.text, c);
    if (!c.text) r.errors.push('End card: write the card text after "End card:"');
    if (!c.voice) r.errors.push('End card: the closing card (explainer cta) needs a voice line: add a VOICE: line under End card');
    if (!c.button) r.errors.push('End card: the closing card (explainer cta) needs a button: add a BUTTON: line under End card, e.g. BUTTON: Watch episode 2');
    limit(r, lead, 'title', c.text, 'End card', 'closing card');
    limit(r, lead, 'vo', c.voice, 'VOICE', 'closing card');
    limit(r, lead, 'button', c.button, 'BUTTON', 'closing card');
    scenes.push({ id: 'end', kind: 'cta', title: c.text, vo: c.voice, button: c.button, source: factOf(`End card: ${c.text}`, 'end card') });
    r.parts.push({ id: 'end', kind: 'cta', assets: [] });
  }

  const body = scenes.filter((s) => s.id !== 'title' && s.id !== 'end').length, bodyMax = lead.sequence[reel ? 0 : 1].max;
  if (body > bodyMax) errors.push(`The scenes make ${body} body scenes (each clip of a scene is one), ${lead.id} takes at most ${bodyMax}: cut ${body - bodyMax}`);
  let format = header.format;
  if (!format) { format = DEFAULT_FORMAT; warnings.push(`FORMAT: none given, so the video is ${DEFAULT_FORMAT}`); }
  const formats = mixed ? lead.formats.filter((f) => pics.formats.includes(f)) : lead.formats;
  if (!formats.includes(format)) errors.push(`FORMAT: ${format} is not one of ${formats.join(', ')}`);

  const script = { template: lead.id, generated: 'scene-script', scenes };
  const all = [...errors, ...rows.flatMap((r) => r.errors)];
  const [dLo, dHi] = reel ? lead.durations : beats.durations;
  // The title card and the end card follow their voice lines, so the film runs a little past the spans.
  const total = all.length ? null : estimateTiming(script, timing, lang, reel ? lead.pace : beats.pace, fixed).duration;
  if (total !== null && total > dHi) all.push(`The film runs about ${total} s, ${lead.id} makes at most ${dHi} s: cut scenes`);
  const duration = total === null ? Math.min(dHi, Math.max(dLo, header.duration || dLo)) : Math.min(dHi, Math.max(dLo, Math.ceil(total)));
  if (total !== null && header.duration && Math.abs(header.duration - total) > 1) warnings.push(`DURATION says ${header.duration} s; with the title card and the end card the film runs about ${total} s, so the brief asks ${duration} s`);

  const id = job ? assertId(job, 'job') : scriptJobId(header, doc);
  const sceneIds = Object.fromEntries(rows.map((r) => [r.at, r.parts.map((p) => p.id)]));
  return {
    id,
    brief: {
      project, id, template: lead.id, mix: mixed ? [PICTURES] : [], format, duration, subject: String(header.videoId || '').slice(0, 64), message: (title || `${doc.scenes.length} clips: ${doc.scenes.map((s) => s.title).join(', ')}`).slice(0, 400),
      notes: `Imported from the scene script ${file}: ${doc.scenes.length} scene(s) and their media, every field locked as written. The scene descriptions are in ${SCENE_SCRIPT_RECORD}.`,
      createdBy: by,
    },
    source: { name: title || `Clip reel from ${file}`, url: '', bullets: [{ text: title || `${doc.scenes.length} clips from ${file}`, ref: `${file}, ${title ? 'TITLE' : 'the scenes'}` }], facts },
    script, rows, errors: all, warnings: [...warnings, ...rows.flatMap((r) => r.warnings)], notes, duration: total,
    record: {
      file, header: doc.header,
      scenes: doc.scenes.map((s) => ({ n: s.n, title: s.title, from: s.from, to: s.to, ids: sceneIds[`Scene ${s.n}`] || [], notes: s.notes })),
      ...(doc.endCard ? { endCard: { text: doc.endCard.text, notes: doc.endCard.notes } } : {}), sections: doc.sections,
    },
  };
}

/** The rules a scene import maps onto: explainer with lifestyle mixed in (the brief mixes only when a scene needs it). */
export const sceneBeats = () => composeBeats(loadTemplate(LEAD).beats, [loadTemplate(PICTURES).beats]);

/** A parsed script with no TITLE line and no End card is a clip reel. */
export const isReel = (doc) => !doc.header.title && !doc.endCard;

function assertProject(project) {
  assertId(project, 'project');
  if (!exists(within(profileDir(project), 'brand.json'))) throw new StudioError(`Unknown project: ${project}. Create it in the UI first.`, 404);
}

/**
 * Locks every field of every scene as the person's own, plus the scene order, each kind and the look (none: the
 * brand), so a later Director commit (mergeRespectingLocks) keeps the imported script as it is.
 */
export function lockAll(script, beats, by) {
  const { doc } = humanEdit('script', { scenes: script.scenes.map(({ id }) => ({ id })) }, script, by, IMPORT_NOTE);
  const stamp = { by, at: nowIso(), note: IMPORT_NOTE };
  const add = (k) => { doc.locks[k] ||= stamp; };
  ['scenes', 'look'].forEach(add);
  for (const s of doc.scenes) {
    const spec = beats.fields[s.kind];
    for (const f of ['kind', ...EVERY_SCENE, ...spec.required, ...spec.optional]) add(`scene:${s.id}.${f}`);
  }
  return doc;
}

const fileLabel = (file) => String(file ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 80) || 'pasted script';

/**
 * Writes the job for a parsed script: the brief (validateBrief + saveBrief), source.json and script.json locked as
 * the person's own (`generated: "scene-script"`), the parsed script with its notes in scene-script.json, then status
 * scripted. Refused, with nothing written, when any row has an error or the job exists.
 */
export function sceneScriptToJob(doc, { project, job, by = 'cli', media = {}, file = 'script' } = {}) {
  assertProject(project);
  const assets = listAssets(project);
  const label = fileLabel(file);
  const m = mapSceneScript(doc, {
    beats: sceneBeats(), assets, media, timing: loadStudioConfig().timing, lang: String(loadBrand(project).voice?.lang || 'en'), file: label, job, project, by,
  });
  if (m.errors.length) throw new StudioError(`The scene script has ${m.errors.length} problem(s):\n- ${m.errors.join('\n- ')}`, 400);
  if (exists(briefFile(project, m.id))) throw new StudioError(`Job ${project}/${m.id} already exists. Pick another job id.`, 409);
  const brief = validateBrief(m.brief, { providers: readJson(within(DIRS.config, 'providers.json'), null) || undefined });
  const { beats } = loadBriefTemplate(brief);
  const srcErrors = validateSource(m.source, { assets });
  if (srcErrors.length) throw new StudioError(`source invalid:\n- ${srcErrors.join('\n- ')}`, 400);
  const source = humanEdit('source', null, m.source, by, IMPORT_NOTE).doc;
  const script = lockAll(m.script, beats, by);
  const { warnings } = assertValidScript(script, beats, { assets, source, brief });
  saveBrief(brief);
  writeJson(jobFile(project, brief.id, 'source.json'), source);
  writeJson(jobFile(project, brief.id, 'script.json'), script);
  writeJson(jobFile(project, brief.id, SCENE_SCRIPT_RECORD), { ...m.record, importedAt: nowIso(), by });
  const all = [...m.warnings, ...warnings];
  setStatus(project, brief.id, { status: 'scripted', step: 5, dirty_from: null, error: null, failed: null },
    `script.json imported from the scene script ${label}: ${script.scenes.length} scenes, every field locked${all.length ? `, ${all.length} warning(s)` : ''}`, by);
  return { brief, script, rows: m.rows, warnings: all, notes: m.notes };
}

/** The aspect Generate makes a clip in for a video format: 9:16 for a portrait format, else 16:9. */
export function clipAspect(format) {
  const m = /^(\d+):(\d+)$/.exec(String(format));
  return m && Number(m[2]) > Number(m[1]) ? '9:16' : '16:9';
}

const ASPECT_LINE = { '9:16': 'Vertical 9:16 composition.', '16:9': 'Horizontal 16:9 composition.' };

/**
 * One scene's Generate clip prompt: the brand's clip brief, `SCENE:` its title, `ACTION:` its kept description lines
 * (camera lines included), then the aspect. The person edits it before the click; Generate refuses it past its cap.
 */
export function clipPrompt(brief, scene, format) {
  const action = (scene.notes || []).join('\n');
  return [String(brief ?? '').trim(), `SCENE: ${scene.title}`, action ? `ACTION: ${action}` : '', ASPECT_LINE[clipAspect(format)]].filter(Boolean).join('\n\n');
}

/** Length and sound of each listed video the script names, read by ffmpeg (probeMedia: no shell, a timeout, a capped log). */
async function probeClips(project, doc, assets, caps = SCENE_SCRIPT_CAPS) {
  const names = [...new Set(doc.scenes.flatMap((s) => s.clips.map((c) => c.name)))].filter((n) => VIDEO_RE.test(n) && assets.includes(n)).slice(0, caps.probes);
  const media = {};
  for (const name of names) {
    try {
      const info = await probeMedia(assetPath(project, name));
      media[name] = { duration: info.duration, hasAudio: info.hasAudio };
    } catch (err) {
      media[name] = { error: err instanceof StudioError ? err.message : 'its length could not be read' };
    }
  }
  return media;
}

/**
 * import-script and the UI's New from script: parses `text`, reads the length of each clip it names, then writes
 * the job (sceneScriptToJob), or with `check` returns what it would make, row by row, and writes nothing. The check
 * also gives each scene its kept notes and Generate clip prompt, and the clip aspect and the brand's reference pictures.
 */
export async function importSceneScript(project, text, { job, by = 'cli', file, check = false } = {}) {
  const doc = parseSceneScript(text);
  assertProject(project);
  const media = await probeClips(project, doc, listAssets(project));
  if (!check) return sceneScriptToJob(doc, { project, job, by, media, file });
  const brand = loadBrand(project);
  const m = mapSceneScript(doc, {
    beats: sceneBeats(), assets: listAssets(project), media, timing: loadStudioConfig().timing, lang: String(brand.voice?.lang || 'en'), file: fileLabel(file), job, project, by,
  });
  const { format } = m.brief;
  return {
    id: m.id, exists: exists(briefFile(project, m.id)), format, duration: m.brief.duration, mix: m.brief.mix, rows: m.rows, errors: m.errors, warnings: m.warnings, notes: m.notes,
    clip: { aspect: clipAspect(format), refs: brand.clipRefs || [], brief: Boolean(brand.clipBrief) },
    scenes: m.record.scenes.map((s) => ({ n: s.n, title: s.title, ids: s.ids, notes: s.notes, prompt: clipPrompt(brand.clipBrief, s, format) })),
  };
}

/** The script file a person named on the CLI: a .txt or .md file, read as UTF-8, size capped. */
export function readScriptFile(file) {
  if (typeof file !== 'string' || !file.trim()) throw new StudioError('Name the script file: import-script <project> <file.txt>', 400);
  const abs = path.resolve(file.trim());
  let st;
  try { st = fs.statSync(abs); } catch { throw new StudioError(`No file at ${abs}`, 404); }
  if (!st.isFile()) throw new StudioError(`${abs} is not a file`, 400);
  if (!SCRIPT_FILE_RE.test(abs)) throw new StudioError('The script must be a .txt or .md file', 400);
  // UTF-8 takes up to 4 bytes a character; the parser checks the character cap itself.
  if (st.size > SCENE_SCRIPT_CAPS.chars * 4) throw new StudioError(`${path.basename(abs)} is larger than ${SCENE_SCRIPT_CAPS.chars * 4 / 1024} KB`, 413);
  return { text: fs.readFileSync(abs, 'utf8'), name: path.basename(abs) };
}
