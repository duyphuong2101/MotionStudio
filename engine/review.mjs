// Review sheet and pacing table, written by prepare to out/<project>/<job>/review/: three frames per scene (in, middle,
// before the cut) tiled one row per scene, a cut sheet (frames close around every cut, one row per cut), and per-scene
// speech pace from timing.json. No model, no network.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, exists, escapeHtml, loadStudioConfig, round } from './core.mjs';
import { jobFile } from './jobs.mjs';
import { ffmpeg } from './media.mjs';

export const REVIEW_DEFAULTS = { fastWps: 3.2, slowTail: 1.5, maxSilence: 0.25, sameKindRun: 3, frameIn: 0.45, frameOut: 0.25, minOut: 0.5, tile: 480 };
// Footage differs scene to scene by its picture, so a run of clips is no repeated layout.
const FOOTAGE_KIND = /(^|\.)(video|clip)$/;
export const REVIEW_DIR = 'review';
export const SHEET = `${REVIEW_DIR}/sheet.jpg`;
export const CUT_SHEET = `${REVIEW_DIR}/cuts.jpg`;
export const PACING = `${REVIEW_DIR}/pacing.json`;
// Cut sheet frames, in render frames from the cut: dense where a cut flashes, wider for the veil and the focus pull.
export const CUT_FRAMES = [-8, -3, -1, 0, 1, 3, 8, 14];
const CUT_TILE = 320;
export const FLAG_TEXT = { fast: 'fast', slowTail: 'long tail', dead: 'no sound', repeat: 'same layout', silence: 'too much silence' };
// One render frame: the "before the cut" shot never lands on the next scene.
const EDGE = 1 / 30;
const PAD = 6;
const LABEL_W = 200;
const BG = '16181d';
const SHEET_TIMEOUT_MS = 60000;

const optsOf = (opts) => ({ ...REVIEW_DEFAULTS, ...opts });

/**
 * Pace per scene from timing.json (words carry their scene) and script.json (kind): length, words, words per second
 * (over the voiced span), head (silence before the first word), tail (after the last), silence share, and flags.
 */
export function pacing(timing, script, opts = {}) {
  const o = optsOf(opts);
  const kinds = new Map((script?.scenes || []).map((s) => [s.id, s.kind]));
  // A scene with a 3D model, its own camera pose or exploded parts (a product-tour step, a model scene) shows a different picture.
  const posed = new Set((script?.scenes || []).filter((s) => s.view || s.path || s.explode || s.model).map((s) => s.id));
  // A clip that plays its own sound is heard even with no words over it.
  const sounding = [...(timing.videos || []).filter((v) => v.sound), ...(timing.footage || []).filter((f) => f.hasAudio)];
  const clips = new Map(sounding.map((c) => [c.id, c.seconds]));
  // The loudness match's gain on that clip, when prepare set one.
  const gains = new Map(sounding.filter((c) => c.gainDb !== undefined).map((c) => [c.id, c.gainDb]));
  const words = timing.words || [];
  const last = timing.scenes.length - 1;
  let heard = 0, voiced = 0, count = 0;
  const scenes = timing.scenes.map((s, i) => {
    const length = s.end - s.start;
    const ws = words.filter((w) => w.scene === s.id);
    const row = { id: s.id, kind: kinds.get(s.id) || '', start: s.start, end: s.end, length: round(length, 2), words: ws.length, wps: null, head: null, tail: null, silence: 1, sound: clips.has(s.id), flags: [] };
    let span = 0;
    if (ws.length) {
      const a = Math.min(...ws.map((w) => w.start)), b = Math.max(...ws.map((w) => w.end));
      span = Math.max(0, b - a);
      row.wps = span > 0 ? round(ws.length / span, 2) : null;
      row.head = round(a - s.start, 2);
      row.tail = round(s.end - b, 2);
      count += ws.length;
      voiced += span;
    } else if (row.sound) span = Math.min(length, clips.get(s.id) || length);
    heard += span;
    row.silence = length > 0 ? round(Math.min(1, Math.max(0, 1 - span / length)), 3) : 0;
    if (row.wps !== null && row.wps > o.fastWps) row.flags.push('fast');
    if (i < last && row.tail !== null && row.tail > o.slowTail) row.flags.push('slowTail');
    if (!ws.length && !row.sound) row.flags.push('dead');
    if (gains.has(s.id)) row.gainDb = gains.get(s.id);
    return row;
  });
  // The third scene of one kind in a row, and every one after it, repeats the layout.
  let run = 0;
  scenes.forEach((r, i) => {
    run = i && r.kind && r.kind === scenes[i - 1].kind ? run + 1 : 1;
    if (run >= o.sameKindRun && !FOOTAGE_KIND.test(r.kind) && !posed.has(r.id)) r.flags.push('repeat');
  });
  const duration = timing.duration;
  const silence = duration > 0 ? round(Math.max(0, 1 - heard / duration), 3) : 0;
  return {
    duration, scenes,
    totals: { words: count, wps: voiced > 0 ? round(count / voiced, 2) : null, speech: round(heard, 2), silence, flags: silence > o.maxSilence ? ['silence'] : [] },
    thresholds: { fastWps: o.fastWps, slowTail: o.slowTail, maxSilence: o.maxSilence, sameKindRun: o.sameKindRun },
  };
}

/** The sheet's frames in time order (the order a forward play reaches them); `file` keeps row-major order for tiling. */
export function sheetShots(scenes, opts = {}) {
  const o = optsOf(opts);
  const shots = [];
  scenes.forEach((s, i) => {
    const latest = Math.max(s.start, s.end - EDGE);
    const at = [s.start + o.frameIn, (s.start + s.end) / 2, Math.max(s.end - o.frameOut, s.start + o.minOut)];
    at.forEach((t, k) => shots.push({ scene: s.id, k, t: round(Math.min(Math.max(t, s.start), latest)), file: `f${String(i * 3 + k).padStart(4, '0')}.jpg` }));
  });
  return shots.sort((a, b) => a.t - b.t);
}

/** The cut sheet's frames: CUT_FRAMES around the start of every scene but the first, inside the video, in time order. */
export function cutShots(scenes) {
  const end = scenes.length ? scenes.at(-1).end - EDGE : 0;
  const shots = [];
  scenes.slice(1).forEach((s, i) => {
    CUT_FRAMES.forEach((f, k) => shots.push({ scene: s.id, k, t: round(Math.min(Math.max(s.start + f * EDGE, 0), end)), file: `c${String(i * CUT_FRAMES.length + k).padStart(4, '0')}.jpg` }));
  });
  return shots.sort((a, b) => a.t - b.t);
}

/** Tile size: the frame scaled so its long side is `tile` px, even numbers for the encoder. */
export function tileSize({ width, height }, tile = REVIEW_DEFAULTS.tile) {
  const k = tile / Math.max(width, height);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { tw: even(width * k), th: even(height * k) };
}

const sec = (t) => Number(t).toFixed(2);

// A label row: a bold title, grey lines, and an amber note that also marks the row.
const sceneLabel = (r) => {
  const voice = r.words ? `${r.words} words · ${r.wps ?? '–'} w/s` : r.sound ? 'clip sound' : 'no voice';
  return { title: r.id, lines: [`${sec(r.start)}–${sec(r.end)} s`, voice], note: r.flags.map((f) => FLAG_TEXT[f]).join(', ') };
};
const cutLabel = (c) => ({ title: `${c.from} → ${c.to}`, lines: [`cut at ${sec(c.t)} s`, `frames ${CUT_FRAMES[0]} to +${CUT_FRAMES.at(-1)}`], note: '' });

function labelHtml(rows, th) {
  const row = (r) => `<div class="r${r.note ? ' f' : ''}"><b>${escapeHtml(r.title)}</b>${r.lines.map((l) => `<div class="m">${escapeHtml(l)}</div>`).join('')}${r.note ? `<div class="x">${escapeHtml(r.note)}</div>` : ''}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#${BG};color:#e8e6e1;font:15px/1.4 "Segoe UI",system-ui,sans-serif}
.r{height:${th}px;margin-bottom:${PAD}px;box-sizing:border-box;padding:10px 12px;overflow:hidden;border-left:4px solid #3a3d44}
.r.f{border-left-color:#f0b840}b{display:block;font-size:19px;color:#fff;overflow-wrap:anywhere;margin-bottom:4px}
.m{color:#a9a6a0}.x{color:#f0b840;margin-top:4px}</style><body>${rows.map(row).join('')}</body>`;
}

/**
 * Tiles the frames in `frameDir` (sheetShots files) 3 per row, one row per scene, with a label column drawn in a
 * new tab of the browser that already has the composition open (the composition page itself is not touched).
 */
export async function writeSheet(browser, frameDir, out, rows, size, opts = {}) {
  await tileFrames(browser, frameDir, 'f', out, rows.map(sceneLabel), 3, tileSize(size, optsOf(opts).tile));
}

/** The cut sheet: the cutShots frames in `frameDir`, one row per cut, labelled with the two scenes and the cut time. */
export async function writeCutSheet(browser, frameDir, out, rows, size) {
  const cuts = rows.slice(1).map((r, i) => ({ from: rows[i].id, to: r.id, t: r.start }));
  await tileFrames(browser, frameDir, 'c', out, cuts.map(cutLabel), CUT_FRAMES.length, tileSize(size, CUT_TILE));
}

async function tileFrames(browser, frameDir, prefix, out, labelRows, cols, { tw, th }) {
  const n = labelRows.length;
  const height = n * th + (n - 1) * PAD;
  const labels = path.join(frameDir, `${prefix}-labels.png`);
  const tab = await browser.newPage({ viewport: { width: LABEL_W, height }, deviceScaleFactor: 1 });
  try {
    await tab.setContent(labelHtml(labelRows, th));
    await tab.screenshot({ path: labels, type: 'png' });
  } finally {
    await tab.close();
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const graph = `[0:v]scale=${tw}:${th}:flags=lanczos,setsar=1,format=rgb24,tile=${cols}x${n}:padding=${PAD}:color=0x${BG}[g];[1:v]format=rgb24[l];[l][g]hstack=inputs=2[o]`;
  await ffmpeg(['-y', '-framerate', '1', '-i', path.join(frameDir, `${prefix}%04d.jpg`), '-i', labels, '-filter_complex', graph,
    '-map', '[o]', '-frames:v', '1', '-update', '1', '-q:v', '3', out], { timeoutMs: SHEET_TIMEOUT_MS });
}

/** What the Preview tab and `cli review` show: pacing from the job's current timing, and the sheet if prepare made one. */
export function reviewOf(project, id) {
  const timing = readJson(jobFile(project, id, 'timing.json'), null);
  return {
    pacing: timing ? pacing(timing, readJson(jobFile(project, id, 'script.json'), null), loadStudioConfig().review) : null,
    sheet: exists(jobFile(project, id, SHEET)) ? SHEET : null,
    cuts: exists(jobFile(project, id, CUT_SHEET)) ? CUT_SHEET : null,
  };
}

/** The pacing table as aligned text lines (first column left, the rest right). */
export function pacingTable(p) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const num = (v) => (v === null ? '–' : sec(v));
  const head = ['scene', 'kind', 'start', 'end', 'length', 'words', 'w/s', 'head', 'tail', 'silence', 'flags'];
  const body = p.scenes.map((r) => [r.id, r.kind, sec(r.start), sec(r.end), sec(r.length), String(r.words), num(r.wps), num(r.head), num(r.tail), pct(r.silence), r.flags.map((f) => FLAG_TEXT[f]).join(', ')]);
  const t = p.totals;
  body.push(['total', '', '', '', sec(p.duration), String(t.words), num(t.wps), '', '', pct(t.silence), t.flags.map((f) => FLAG_TEXT[f]).join(', ')]);
  const rows = [head, ...body];
  const w = head.map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  const left = new Set([0, 1, head.length - 1]);
  return rows.map((r) => r.map((v, c) => (left.has(c) ? v.padEnd(w[c]) : v.padStart(w[c]))).join('  ').trimEnd());
}
