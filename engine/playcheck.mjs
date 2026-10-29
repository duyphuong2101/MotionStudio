// Play-through QA: plays a composition forward frame by frame, the way the render steps through it, and reports what
// a still cannot show: text over text, a caption over scene text, two captions (or, with oneScene, two scenes) at once,
// state that differs from a direct seek, and lint findings mid-motion. Runs in a page openComposition already opened.
import { lintInPage } from './media.mjs';

export const PLAY_DEFAULTS = { enabled: true, step: 1 / 12, maxFrames: 1500, historyEvery: 0.5, opacity: 0.35 };
// Two text boxes overlap only when they intersect by more than this, both ways (px).
const TOLERANCE = 2;
// Text over text for at most this many frames is a transition frame: a warning, not an error.
const SHORT_FRAMES = 2;
// Frames per page.evaluate call.
const BATCH = 60;
const MAX_RANGES = 3;

/** Runs in the page: installs window.__pc, the per-frame probe. Self-contained (serialised by Playwright). */
function install(o) {
  const stage = document.getElementById('stage') || document.body;
  const S = window.__studio;
  const ids = new Set(S.scenes.map((s) => s.id));
  const lint = new Function(`return (${o.lintSrc})`)();
  const ctx = document.createElement('canvas').getContext('2d');
  const FRAME = { l: 0, t: 0, r: S.width, b: S.height };
  const metrics = new Map(), owners = new WeakMap(), tags = new WeakMap();
  let nTag = 0, cs, op, clip, flow;
  const fresh = () => { cs = new Map(); op = new Map(); clip = new Map(); flow = new Map(); };
  const tag = (el) => { if (!tags.has(el)) tags.set(el, ++nTag); return tags.get(el); };
  const style = (el) => { let c = cs.get(el); if (!c) cs.set(el, (c = getComputedStyle(el))); return c; };
  const sceneAt = (t) => (S.scenes.find((s) => t >= s.start && t < s.end) || S.scenes[S.scenes.length - 1] || {}).id || '';
  const name = (el) => el.id || (typeof el.className === 'string' && el.className.trim().split(/\s+/)[0]) || el.tagName.toLowerCase();
  const label = (el) => {
    const t = el.textContent.trim().replace(/\s+/g, ' ');
    return `${name(el)} "${t.length > 28 ? `${t.slice(0, 27)}…` : t}"`;
  };
  // The scene group (g-<scene>) or caption (.subt) an element belongs to; text inside an SVG is skipped.
  const owner = (el) => {
    let r = owners.get(el);
    if (r) return r;
    r = { scene: null, cap: null, svg: !!el.closest('svg') };
    for (let n = el; n && n !== stage; n = n.parentElement) {
      if (n.classList.contains('subt')) { r.cap = n; break; }
      if (n.id && n.id.startsWith('g-') && ids.has(n.id.slice(2))) { r.scene = n.id.slice(2); break; }
    }
    owners.set(el, r);
    return r;
  };
  const opOf = (el) => {
    let v = op.get(el);
    if (v !== undefined) return v;
    const c = style(el);
    v = c.display === 'none' ? 0 : +c.opacity;
    if (v > 0 && el !== stage && el.parentElement) v *= opOf(el.parentElement);
    op.set(el, v);
    return v;
  };
  const inter = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const inset = (b, s) => {
    const v = s.slice(6, s.indexOf(')')).split(' round ')[0].trim().split(/\s+/);
    const [t, r = t, bo = t, l = r] = v;
    const len = (x, size) => (x.endsWith('%') ? (parseFloat(x) / 100) * size : parseFloat(x) || 0);
    const w = b.r - b.l, h = b.b - b.t;
    return { l: b.l + len(l, w), t: b.t + len(t, h), r: b.r - len(r, w), b: b.b - len(bo, h) };
  };
  // The part of the frame an element's content can paint in: the stage, overflow clips and inset clip-paths above it.
  const clipOf = (el) => {
    let v = clip.get(el);
    if (v) return v;
    v = el === stage || !el.parentElement ? FRAME : clipOf(el.parentElement);
    const c = style(el), ox = c.overflowX !== 'visible', oy = c.overflowY !== 'visible', cp = c.clipPath.startsWith('inset(');
    if (ox || oy || cp) {
      const b = box(el.getBoundingClientRect());
      if (ox) v = { ...v, l: Math.max(v.l, b.l), r: Math.min(v.r, b.r) };
      if (oy) v = { ...v, t: Math.max(v.t, b.t), b: Math.min(v.b, b.b) };
      if (cp) v = inter(v, inset(b, c.clipPath));
    }
    clip.set(el, v);
    return v;
  };
  // Text that flows in one block is laid out by the browser and never stacks: inline boxes share their block's root.
  const rootOf = (el) => {
    let v = flow.get(el);
    if (v) return v;
    const c = style(el);
    v = el !== stage && el.parentElement && c.display.startsWith('inline') && (c.position === 'static' || c.position === 'relative') ? rootOf(el.parentElement) : el;
    flow.set(el, v);
    return v;
  };
  // Glyph extent above and below the baseline (canvas metrics), so a big number's line box is not counted as ink.
  const ink = (c, text) => {
    const shown = c.textTransform === 'uppercase' ? text.toUpperCase() : text;
    const font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
    const key = `${font}\n${shown}`;
    let m = metrics.get(key);
    if (!m) {
      ctx.font = font;
      const x = ctx.measureText(shown);
      m = { a: x.actualBoundingBoxAscent, d: x.actualBoundingBoxDescent, fa: x.fontBoundingBoxAscent, fd: x.fontBoundingBoxDescent };
      if (metrics.size > 5000) metrics.clear();
      metrics.set(key, m);
    }
    return m;
  };
  const pieces = () => {
    const out = [];
    const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const text = n.textContent, from = text.search(/\S/);
      if (from < 0) continue;
      const el = n.parentElement;
      if (!el) continue;
      const own = owner(el);
      if (own.svg) continue;
      const c = style(el);
      if (c.visibility !== 'visible') continue;
      const v = opOf(el);
      if (v < o.opacity) continue;
      const to = text.trimEnd().length;
      const range = document.createRange();
      range.setStart(n, from);
      range.setEnd(n, to);
      const m = ink(c, text.slice(from, to));
      const cl = clipOf(el);
      const rects = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const k = r.height / (m.fa + m.fd || r.height);
        const b = inter({ l: r.left, r: r.right, t: r.top + (m.fa - m.a) * k, b: r.top + (m.fa + m.d) * k }, cl);
        if (b.r - b.l > 1 && b.b - b.t > 1) rects.push(b);
      }
      if (rects.length) out.push({ el, root: rootOf(el), own, rects });
    }
    return out;
  };
  const meets = (a, b) => {
    for (const x of a) for (const y of b) {
      if (Math.min(x.r, y.r) - Math.max(x.l, y.l) > o.tolerance && Math.min(x.b, y.b) - Math.max(x.t, y.t) > o.tolerance) return true;
    }
    return false;
  };

  const probe = (i, t) => {
    fresh();
    const hits = new Map();
    const add = (h) => { if (!hits.has(h.key)) hits.set(h.key, { i, ...h }); };
    // A brand blend (templates/blend.mjs) shows both scenes of a cut on purpose: inside its window their text may meet,
    // and the other scene may pass under a caption.
    const mixing = (S.blends || []).some(([a, b]) => t > a && t < b), now = sceneAt(t);
    const txt = pieces().filter((p) => !p.own.cap);
    const caps = [...stage.querySelectorAll('.subt')].filter((el) => style(el).visibility === 'visible' && opOf(el) >= o.opacity)
      .map((el) => ({ el, r: box((el.querySelector('.sw') || el).getBoundingClientRect()) }));
    if (caps.length > 1) {
      const names = caps.map((c) => c.el.id).join(' + ');
      add({ k: 'caps', key: `caps|${names}`, scene: sceneAt(t), el: 'captions', what: names });
    }
    for (const c of caps) for (const p of txt) {
      if (mixing && p.own.scene && p.own.scene !== now) continue;
      if (meets([c.r], p.rects)) add({ k: 'cover', key: `cover|${tag(p.root)}`, scene: p.own.scene || sceneAt(t), el: name(p.root), what: `${c.el.id} over ${label(p.root)}` });
    }
    for (let x = 0; x < txt.length; x++) for (let y = x + 1; y < txt.length; y++) {
      let a = txt[x], b = txt[y];
      if (a.root === b.root || a.root.contains(b.root) || b.root.contains(a.root) || !meets(a.rects, b.rects)) continue;
      if (tag(a.root) > tag(b.root)) [a, b] = [b, a];
      const across = a.own.scene && b.own.scene && a.own.scene !== b.own.scene;
      if (across && mixing) continue;
      const k = across ? 'across' : 'text';
      add({
        k, key: `${k}|${tag(a.root)}|${tag(b.root)}`, scene: a.own.scene || b.own.scene || sceneAt(t), el: `${name(a.root)} × ${name(b.root)}`,
        what: across ? `${label(a.root)} (${a.own.scene}) × ${label(b.root)} (${b.own.scene})` : `${label(a.root)} × ${label(b.root)}`,
      });
    }
    if (o.oneScene && !mixing) {
      const on = [...new Set(txt.map((p) => p.own.scene).filter(Boolean))];
      if (on.length > 1) add({ k: 'scenes', key: `scenes|${on.join('+')}`, scene: on[0], el: 'scenes', what: on.join(' + ') });
    }
    return [...hits.values()];
  };

  const shownOp = (el) => (style(el).visibility === 'visible' ? opOf(el) : 0);
  // The classes a timeline sets to show state: a subtitle word being said (on, hl) and a highlighter mark that is on.
  const STATE_CLASSES = ['on', 'hl'];
  const classState = (el) => STATE_CLASSES.filter((k) => el.classList.contains(k)).join(' ');
  // A cheap signature of a WebGL canvas: its pixels scaled down to SIG x SIG, RGBA.
  const SIG = 8, sigCtx = Object.assign(document.createElement('canvas'), { width: SIG, height: SIG }).getContext('2d', { willReadFrequently: true });
  const pixels = (cv) => {
    try {
      sigCtx.clearRect(0, 0, SIG, SIG);
      sigCtx.drawImage(cv, 0, 0, SIG, SIG);
      return [...sigCtx.getImageData(0, 0, SIG, SIG).data];
    } catch { return null; }
  };
  // Every element with an id: effective opacity (to 0.05), its own text and its state classes; every mark; every
  // WebGL canvas's pixels and every video's time, to compare played with jumped.
  const state = () => {
    fresh();
    const s = {};
    for (const el of stage.querySelectorAll('[id]')) {
      let text = '';
      for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
      s[el.id] = { op: Math.round(shownOp(el) * 20) / 20, text: text.trim(), cls: classState(el) };
    }
    stage.querySelectorAll('.mk').forEach((el, k) => { s[`mark#${k}`] = { op: Math.round(shownOp(el) * 20) / 20, text: '', cls: classState(el) }; });
    stage.querySelectorAll('canvas[data-gl]').forEach((el, k) => {
      const op = Math.round(shownOp(el) * 20) / 20;
      s[`gl#${el.id || k}`] = { op, text: '', cls: '', px: op > 0 ? pixels(el) : null };
    });
    stage.querySelectorAll('video').forEach((el, k) => { s[`video#${el.id || el.dataset.clip || k}`] = { op: Math.round(shownOp(el) * 20) / 20, text: '', cls: '', time: Math.round(el.currentTime * 1000) / 1000 }; });
    return s;
  };
  // Mean channel difference (0-255) above which two canvas signatures are different pictures.
  const PX_DIFF = 6;
  const pxDiff = (a, b) => (a && b ? a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length : 0);
  // How the jumped state differs from the played one, or ''. Text, classes and time count only where they show.
  const differ = (id, a, b, dir) => {
    const shows = Math.max(a.op, b.op) > 0;
    if (Math.abs(a.op - b.op) > 0.1) return `${id} opacity ${a.op} played, ${b.op} jumped ${dir}`;
    if (a.text !== b.text && shows) return `${id} text "${a.text.slice(0, 24)}" played, "${b.text.slice(0, 24)}" jumped ${dir}`;
    if (a.cls !== b.cls && shows) return `${id} class "${a.cls}" played, "${b.cls}" jumped ${dir}`;
    if (pxDiff(a.px, b.px) > PX_DIFF) return `${id} pixels differ by ${pxDiff(a.px, b.px).toFixed(1)} played vs jumped ${dir}`;
    if (a.time !== undefined && shows && Math.abs(a.time - b.time) > 1 / 60) return `${id} time ${a.time} s played, ${b.time} s jumped ${dir}`;
    return '';
  };
  const played = [];
  // A clip seek on a busy machine can miss the page's 1.5 s wait; one more try tells that from a clip that never lands.
  const seekSure = async (t) => {
    try { await window.seek(t); } catch (err) {
      if (!/did not reach/.test(String(err && err.message))) throw err;
      await new Promise((r) => setTimeout(r, 250));
      await window.seek(t);
    }
  };

  window.__pc = {
    async play(frames) {
      const out = [];
      for (const f of frames) {
        await seekSure(f.t);
        out.push(...probe(f.i, f.t));
        if (f.j === undefined) continue;
        played[f.j] = { t: f.t, s: state() };
        for (const x of lint(o.safeArea)) {
          out.push({ k: 'lint', i: f.j, key: `lint|${x.el}|${x.msg.replace(/-?\d+(\.\d+)?/g, '#')}`, scene: sceneAt(f.t), el: String(x.el), what: x.msg });
        }
      }
      return out;
    },
    async jump(from, to) {
      const out = [];
      for (let j = from; j < Math.min(to, played.length); j++) {
        const { t, s } = played[j];
        for (const [start, dir] of [[S.duration, 'from the end'], [0, 'from the start']]) {
          // Seeking 0 from 0 is not a jump (GSAP's zero-time sets flip with the direction there).
          if (start === t) continue;
          await seekSure(start);
          await seekSure(t);
          const now = state();
          for (const id of Object.keys(s)) {
            // Text only counts where it shows: a hidden scene may keep a stale value until it plays again.
            const what = differ(id, s[id], now[id] || { op: 0, text: '', cls: '' }, dir);
            if (!what) continue;
            const el = document.getElementById(id);
            out.push({ k: 'hist', i: j, key: `hist|${id}|${dir}`, scene: (el && owner(el).scene) || sceneAt(t), el: id, what });
          }
        }
      }
      return out;
    },
  };
}

const LEVEL = { text: 'error', across: 'error', cover: 'error', caps: 'error', scenes: 'error', hist: 'error', lint: 'warning' };
const TITLE = {
  text: 'text over text', across: 'text of two scenes at once', cover: 'caption covers scene text', caps: 'two captions at once',
  scenes: 'two scenes at once', hist: 'played and jumped differ', lint: 'mid-motion lint',
};

const sec = (t) => t.toFixed(2);

/** Consecutive indexes as runs: [[first, last], …]. */
function runsOf(idx) {
  const runs = [];
  for (const i of idx) {
    const r = runs[runs.length - 1];
    if (r && i === r[1] + 1) r[1] = i;
    else if (!r || i > r[1]) runs.push([i, i]);
  }
  return runs;
}

function rangeText(runs, times) {
  const shown = runs.slice(0, MAX_RANGES).map(([a, b]) => (a === b ? sec(times[a]) : `${sec(times[a])}–${sec(times[b])}`)).join(', ');
  return `${shown} s${runs.length > MAX_RANGES ? ` (+${runs.length - MAX_RANGES} more)` : ''}`;
}

/** Hits from many frames → one finding per problem, with its time ranges. */
export function groupHits(hits, frameTimes, markTimes) {
  const byKey = new Map();
  for (const h of hits) {
    let g = byKey.get(h.key);
    if (!g) byKey.set(h.key, (g = { ...h, idx: [] }));
    g.idx.push(h.i);
  }
  const out = [];
  for (const g of byKey.values()) {
    const times = g.k === 'hist' || g.k === 'lint' ? markTimes : frameTimes;
    const runs = runsOf(g.idx);
    const longest = Math.max(...runs.map(([a, b]) => b - a + 1));
    const short = (g.k === 'text' || g.k === 'across') && longest <= SHORT_FRAMES;
    out.push({
      level: short ? 'warning' : LEVEL[g.k], scene: g.scene, el: g.el,
      msg: `${TITLE[g.k]} ${rangeText(runs, times)}: ${g.what}${short ? ' (a transition frame)' : ''}`,
      t: Math.round(times[runs[0][0]] * 100) / 100,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Frame times (sampled evenly when there are more than maxFrames) and which frames take a history mark. */
export function playFrames(duration, { step, maxFrames, historyEvery }) {
  const n = Math.max(1, Math.min(Math.ceil(duration / step), maxFrames));
  const dt = Math.max(step, duration / maxFrames);
  const frames = [], marks = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const t = Math.round(i * dt * 1000) / 1000;
    const slot = Math.floor(t / historyEvery + 1e-9);
    const f = { i, t };
    if (slot > last) { last = slot; f.j = marks.length; marks.push(t); }
    frames.push(f);
  }
  return { frames, times: frames.map((f) => f.t), marks };
}

/** Reloads the composition, so what is played next is exactly what the render sees. */
export async function freshLoad(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
}

/**
 * Plays the open composition from a fresh load and returns { findings, frames, step }. Options: PLAY_DEFAULTS plus
 * `safeArea` (lint), `oneScene` (two scenes at once is an error; the brand's motion profile sets it), `skipLint` (Set of "scene|el" already found by stills lint)
 * and `shots` (sorted by `t`) with `onShot(shot)`: called on the way, between the played frames around each shot's time.
 */
export async function playCheck(page, info, opts = {}) {
  const o = { ...PLAY_DEFAULTS, ...opts };
  await freshLoad(page);
  await page.evaluate(install, { opacity: o.opacity, tolerance: TOLERANCE, safeArea: o.safeArea ?? 0, oneScene: !!o.oneScene, lintSrc: lintInPage.toString() });
  const { frames, times, marks } = playFrames(info.duration, o);
  const hits = [];
  let at = 0;
  const playTo = async (to) => {
    while (at < to) {
      const b = frames.slice(at, Math.min(at + BATCH, to));
      hits.push(...await page.evaluate((x) => window.__pc.play(x), b));
      at += b.length;
    }
  };
  for (const s of o.shots || []) {
    const next = frames.findIndex((f) => f.t > s.t);
    await playTo(next < 0 ? frames.length : next);
    await o.onShot(s);
  }
  await playTo(frames.length);
  for (let k = 0; k < marks.length; k += BATCH) hits.push(...await page.evaluate(([a, b]) => window.__pc.jump(a, b), [k, k + BATCH]));
  const skip = o.skipLint || new Set();
  const kept = hits.filter((h) => h.k !== 'lint' || !skip.has(`${h.scene}|${h.el}`));
  return { findings: groupHits(kept, times, marks), frames: frames.length, step: frames.length > 1 ? times[1] - times[0] : o.step };
}
