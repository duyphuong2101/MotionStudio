// type-film (plan .ai/plans/art-direction.md E4): kinetic typography. Each `line` scene shows its own voice line as
// large type, every word landing at the time prepare gave it (TTS, a cloud voice or a recorded take), in one of three
// styles: punch (one word or short phrase at a time, filling the frame), stack (short lines pile up and the column
// rises) and build (the whole sentence builds word by word). The words on screen are the line, so the page draws no
// subtitles. Sizes come from rough glyph widths (wordEm), so nothing is measured at run time.
import { page, geometry, h, hasLogoBug, wordEm, themeClass, ACCENT_CSS, UNDER_BUG } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';

export const PUNCH_MAX = 3, PUNCH_CHARS = 12, PUNCH_HOLD = 0.28;
const STYLES = ['punch', 'stack', 'build'];
const PUNCT = /[.,!?;:…]$/;
const bare = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');
const LINE_H = 1.08;

export function build(args) {
  return page({ ...args, title: 'type-film', ...parts(args) });
}

/** A scene's words with their times: prepare's words of that scene, else the voice line's words with no times. */
export function sceneWords(sc, timing) {
  const ws = (timing?.words || []).filter((w) => w.scene === sc.id);
  if (ws.length) return ws.map((w) => ({ w: w.w, start: w.start, end: w.end }));
  return String(sc.vo || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ w }));
}

/**
 * Punch groups as [first, last] word indexes: a group closes once it has been on screen PUNCH_HOLD seconds (so a
 * quick "a" or "the" rides with the next word), at punctuation, at PUNCH_MAX words or PUNCH_CHARS characters.
 */
export function punchGroups(ws) {
  const out = [];
  let a = 0;
  for (let k = 0; k < ws.length; k++) {
    const chars = ws.slice(a, k + 1).map((x) => x.w).join(' ').length;
    // A short word ("the", "a", "of") never closes a group: it rides with the word after it.
    const held = ws[k].end != null && ws[a].start != null ? ws[k].end - ws[a].start >= PUNCH_HOLD - 1e-6 : chars >= 6;
    const short = bare(ws[k].w).length < 4;
    const nextChars = k + 1 < ws.length ? chars + 1 + ws[k + 1].w.length : Infinity;
    if (k === ws.length - 1 || PUNCT.test(ws[k].w) || (held && !short)) { out.push([a, k]); a = k + 1; continue; }
    if (k - a + 1 >= PUNCH_MAX || nextChars > PUNCH_CHARS) {
      // Full: close here, but a short last word moves on to open the next group.
      if (short && k > a) { out.push([a, k - 1]); a = k; } else { out.push([a, k]); a = k + 1; }
    }
  }
  return out;
}

/** Stack lines as [first, last] word indexes: up to `max` characters, closing at punctuation. */
export function stackLines(ws, max) {
  const out = [];
  let a = 0;
  for (let k = 0; k < ws.length; k++) {
    const chars = ws.slice(a, k + 1).map((x) => x.w).join(' ').length;
    const next = k + 1 < ws.length ? chars + 1 + ws[k + 1].w.length : Infinity;
    if (k === ws.length - 1 || PUNCT.test(ws[k].w) || next > max) { out.push([a, k]); a = k + 1; }
  }
  return out;
}

const emOf = (text) => wordEm(text) + 0.28 * (text.split(' ').length - 1);

/** Lines a greedy wrap of `ws` makes at `fs` units in `width` units (rough glyph widths, a 10 % margin). */
export function wrapLines(ws, fs, width) {
  let lines = 1, used = 0;
  for (const w of ws) {
    const need = wordEm(w) * fs * 1.1;
    if (used && used + 0.28 * fs + need > width) { lines++; used = need; } else used += (used ? 0.28 * fs : 0) + need;
  }
  return lines;
}

/** The build style's size: the largest, down to 56, whose wrap fits the area. */
export function buildSize(ws, width, height, max) {
  for (let fs = max; fs > 56; fs -= 4) if (wrapLines(ws, fs, width) * fs * LINE_H <= height) return fs;
  return 56;
}

/** css, body, scenes and js for page(). */
export function parts({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port, land, W, H, U } = g;
  const wide = W > H * 2;
  const pad = port ? 80 : 120;
  const AW = (wide ? 1920 : W / U) - 2 * pad;
  const top = hasLogoBug(brand) ? UNDER_BUG : 100;
  const AH = H / U - top - 110;
  const MAX = port ? 300 : land ? 250 : 240;
  const scenes = [];
  const blocks = [];
  let themes = false;
  for (const sc of script.scenes) {
    const id = sc.id;
    const tc = themeClass(sc);
    if (tc) themes = true;
    const dark = sc.theme === 'dark';
    if (sc.kind === 'title') {
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="tft">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd tftt" data-lint>${h(sc.title)}</div></div></div>`);
      scenes.push({ id, kind: 'title' });
    } else if (sc.kind === 'line') {
      const style = STYLES.includes(sc.style) ? sc.style : 'stack';
      const ws = sceneWords(sc, timing);
      const accent = new Set(String(sc.accent || '').split(/\s+/).map(bare).filter(Boolean));
      const word = (k, cls = 'tw') => `<span class="${cls}${accent.has(bare(ws[k].w)) ? ' ac' : ''}" id="${id}-w${k}">${h(ws[k].w)}</span>`;
      let inner, groups;
      if (style === 'punch') {
        groups = punchGroups(ws);
        inner = groups.map(([a, b], j) => {
          const text = ws.slice(a, b + 1).map((x) => x.w).join(' ');
          const fs = Math.max(60, Math.min(MAX * 1.25, Math.floor(AW / emOf(text))));
          return `<div class="pg" id="${id}-g${j}" style="font-size:${px(fs)}" data-lint>${ws.slice(a, b + 1).map((_, i) => word(a + i)).join(' ')}</div>`;
        }).join('');
      } else if (style === 'stack') {
        groups = stackLines(ws, port ? 11 : 18);
        let y = 0;
        const rows = groups.map(([a, b], j) => {
          const text = ws.slice(a, b + 1).map((x) => x.w).join(' ');
          const fs = Math.max(56, Math.min(MAX, Math.floor(AW / emOf(text))));
          const row = `<div class="sl" id="${id}-l${j}" style="font-size:${px(fs)};top:${px(y)}" data-lint>${ws.slice(a, b + 1).map((_, i) => word(a + i)).join(' ')}</div>`;
          groups[j] = [a, b, Math.round(y + (fs * LINE_H) / 2), Math.round(y + fs * LINE_H)];
          y += fs * LINE_H + 18;
          return row;
        });
        inner = `<div class="stk" id="${id}-stk">${rows.join('')}</div>`;
      } else {
        // One paragraph: the largest size whose word-by-word wrap fits the area.
        const fs = buildSize(ws.map((x) => x.w), AW, AH, Math.round(MAX * 0.8));
        inner = `<div class="bp" style="font-size:${px(fs)}" data-lint>${ws.map((_, k) => word(k)).join(' ')}</div>`;
        groups = null;
      }
      blocks.push(`<div class="sc fill${tc}" id="g-${id}"><div class="tf tf-${style}">${inner}</div></div>`);
      scenes.push({ id, kind: 'line', style, n: ws.length, ...(groups ? { groups } : {}), ...(style === 'stack' ? { area: Math.round(AH) } : {}), ...(dark ? { dark: true } : {}) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="tfc">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd tfct" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const area = `position:absolute;left:${padX(pad)};right:${padX(pad)};top:${px(top)};bottom:${px(110)}`;
  const css = `${themes ? ACCENT_CSS : ''}
.tft,.tfc{${area};display:flex;flex-direction:column;justify-content:center;align-items:${port ? 'center' : 'flex-start'};text-align:${port ? 'center' : 'left'};gap:${px(30)}}
.tftt{font-size:${px(port ? 150 : 130)};line-height:1.02;font-weight:900;letter-spacing:-0.02em}
.tfct{font-size:${px(port ? 116 : 96)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}
.tf{${area};font-family:var(--display);font-weight:900;letter-spacing:-0.02em;line-height:${LINE_H}}
.tw{display:inline-block}.tw.ac{color:var(--secondary)}.acc .tw.ac{color:var(--primary)}
.tf-punch .pg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:0.28em;white-space:nowrap;overflow:hidden;opacity:0}
.tf-stack{overflow:hidden}.stk{position:absolute;left:0;right:0;top:50%}
.sl{position:absolute;left:0;right:0;text-align:${port ? 'center' : 'left'};white-space:nowrap;overflow:hidden;opacity:0}
.tf-build{display:flex;align-items:center;justify-content:${port ? 'center' : 'flex-start'}}
.bp{width:100%;max-height:100%;overflow:hidden;text-align:${port ? 'center' : 'left'}}`;
  const js = `
// A word's time: prepare's when the scene's words match the markup, else spread over the scene.
// The first word lands with the cut when the voice starts soon after it, so a scene never opens on an empty frame.
const wordAt = (sc, s, e) => {
  const ws = words(sc.id), ok = ws.length === sc.n;
  const raw = (k) => (ok ? ws[k].start : s + 0.15 + (k * Math.max(0.1, e - s - 0.5)) / Math.max(1, sc.n));
  return (k) => (k === 0 && raw(0) - s < 0.6 ? s + 0.04 : raw(k));
};
const KINDS = {
  title(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.tftt'), s + 0.15, { d: 0.7 });
  },
  line(sc, s, e, { last }) {
    const at = wordAt(sc, s, e), w = (k) => $(sc.id + '-w' + k);
    if (sc.style === 'punch') {
      sc.groups.forEach(([a, b], j) => {
        const el = $(sc.id + '-g' + j), t0 = Math.max(s, at(a) - 0.04), t1 = j + 1 < sc.groups.length ? Math.max(t0 + 0.08, at(sc.groups[j + 1][0]) - 0.04) : null;
        tl.fromTo(el, { opacity: 0, scale: 1.22 }, { opacity: 1, scale: 1, duration: 0.14, ease: 'power3.out', immediateRender: false }, t0);
        for (let k = a + 1; k <= b; k++) tl.fromTo(w(k), { opacity: 0.15 }, { opacity: 1, duration: 0.08, immediateRender: false }, Math.max(t0, at(k) - 0.03));
        if (t1 !== null) tl.set(el, { opacity: 0 }, t1);
      });
    } else if (sc.style === 'stack') {
      const stk = $(sc.id + '-stk');
      // A line shows from its first word; once the column has carried it above the area it is gone, so no line
      // waits below the frame or lingers above it.
      sc.groups.forEach(([a, b, mid], j) => {
        const t0 = Math.max(s, at(a) - 0.06), line = $(sc.id + '-l' + j);
        if (j) tl.to(stk, { y: -mid * U, duration: 0.35, ease: 'power3.inOut' }, Math.max(s, t0 - 0.1));
        else tl.set(stk, { y: -mid * U }, s);
        tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.01, immediateRender: false }, Math.max(s, t0 - 0.02));
        for (let k = a; k <= b; k++) tl.fromTo(w(k), { opacity: 0, y: 30 * U }, { opacity: 1, y: 0, duration: 0.18, ease: 'power3.out', immediateRender: false }, Math.max(s, at(k) - 0.04));
        if (j) tl.to($(sc.id + '-l' + (j - 1)), { opacity: 0.22, duration: 0.3 }, t0);
        for (let i = 0; i < j - 1; i++) {
          // Gone as soon as its top would reach the area's edge, so no line shows cut in half.
          if (2 * sc.groups[i][2] - sc.groups[i][3] - mid < -sc.area / 2 + 20) tl.to($(sc.id + '-l' + i), { opacity: 0, duration: 0.2 }, Math.max(s, t0 - 0.1));
        }
      });
    } else {
      for (let k = 0; k < sc.n; k++) {
        const t0 = Math.max(s, at(k) - 0.04), next = k + 1 < sc.n ? Math.max(t0 + 0.06, at(k + 1) - 0.04) : null;
        tl.fromTo(w(k), { opacity: 0, y: 24 * U }, { opacity: 1, y: 0, duration: 0.16, ease: 'power3.out', immediateRender: false }, t0);
        // The word being said is solid, the ones before it settle a little lighter.
        if (next !== null) tl.to(w(k), { opacity: 0.55, duration: 0.2 }, next);
      }
      if (!last) tl.to($('g-' + sc.id).querySelectorAll('.tw'), { opacity: 1, duration: 0.2 }, Math.max(s, e - 0.6));
    }
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.tfct'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js, subtitles: false };
}
