import { page, geometry, h, asset, hasLogoBug, UNDER_BUG, contentArea, fitWords } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { markWords, hasMark } from '../../engine/marks.mjs';

// gallery: an instant print is this tall for its width (square photo, wider bottom margin for the caption).
const PRINT_H = 1.165;
const ROT = [-6, 4, -3, 6];
// Print centres as fractions of the gallery area, and the print width, per frame shape and count.
// Landscape lays a row; portrait zigzags down; square and 4:5 a row of up to three, else two by two.
function printLayout(shape, n, aw, ah) {
  if (shape === 'land') {
    const cw = Math.min(ah * 0.82 / PRINT_H, aw / (n + 0.9));
    const step = Math.min(1 / n, (cw * 1.08) / aw);
    return { cw, at: Array.from({ length: n }, (_, k) => [0.5 + (k - (n - 1) / 2) * step, [0.5, 0.46, 0.53, 0.47][k]]) };
  }
  if (shape === 'port') {
    if (n === 2) return { cw: Math.min(aw * 0.62, (ah * 0.44) / PRINT_H), at: [[0.37, 0.27], [0.63, 0.73]] };
    if (n === 3) return { cw: Math.min(aw * 0.56, (ah * 0.38) / PRINT_H), at: [[0.32, 0.19], [0.68, 0.5], [0.36, 0.81]] };
    return { cw: Math.min(aw * 0.45, (ah * 0.42) / PRINT_H), at: [[0.27, 0.26], [0.73, 0.28], [0.27, 0.74], [0.73, 0.72]] };
  }
  if (n <= 3) {
    const cw = Math.min(aw * (n === 2 ? 0.42 : 0.31), (ah * 0.85) / PRINT_H);
    return { cw, at: n === 2 ? [[0.3, 0.5], [0.7, 0.5]] : [[0.19, 0.52], [0.5, 0.46], [0.81, 0.52]] };
  }
  return { cw: Math.min(aw * 0.45, (ah * 0.44) / PRINT_H), at: [[0.27, 0.26], [0.73, 0.28], [0.27, 0.74], [0.73, 0.72]] };
}

export function build(args) {
  return page({ ...args, title: 'lifestyle', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port, land, U, W, H } = g;
  const A = contentArea(brand, g);
  // A photo title sits between padX(80) on each side: its longest word must fit there whole.
  const titleBase = port ? 116 : 96;
  const fitTitle = (ws) => { const fit = fitWords(ws, titleBase, W / U - 2 * (parseInt(padX(80), 10) / U)); return fit < titleBase ? ` style="font-size:${px(fit)}"` : ''; };
  const side = port ? 80 : 120;
  const scenes = [];
  const blocks = [];
  for (const sc of script.scenes) {
    const id = sc.id;
    const align = sc.align || 'bottom';
    if (sc.kind === 'photo') {
      const ws = markWords(sc.title);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="ph" id="${id}-ph"><img src="${asset(sc.asset)}" alt=""></div>
        <div class="shade ${align}"></div>
        <div class="cap ${align}">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
          <div class="hd lt" data-lint${fitTitle(ws)}>${ws.map((w, k) => `<span class="lm"${hasMark(w) ? ' style="overflow:visible"' : ''}><span class="lw" id="${id}-w${k}">${h(w)}</span></span>`).join(' ')}</div>
          ${sc.subtitle ? `<div class="ls" data-lint>${h(sc.subtitle)}</div>` : ''}</div></div>`);
      // A centre shade darkens the whole frame: the corner logo and the subtitles take their dark-surface colours. A top
      // shade darkens only the top, with the subtitles still over the bare photo, so it stays as it was.
      scenes.push({ id, kind: 'photo', n: ws.length, move: sc.move || 'in', ...(align === 'center' ? { dark: true } : {}) });
    } else if (sc.kind === 'gallery') {
      // Instant prints on a table: each lands in turn with the voice and develops from a pale flash.
      const photos = (sc.photos || []).slice(0, 4);
      const head = sc.title || sc.kicker ? (port ? 230 : 170) : 30;
      // A 21:9 frame keeps the prints in its centred 16:9 area, like padX.
      const top = A.top + head, bottom = H / U - A.bottom, left = side + (W > H * 2 ? (W - (H * 16) / 9) / 2 / U : 0);
      const aw = W / U - 2 * left, ah = bottom - top;
      const { cw, at } = printLayout(land ? 'land' : port ? 'port' : 'square', photos.length, aw, ah);
      const prints = photos.map((p, k) => {
        const cx = left + at[k][0] * aw, cy = top + at[k][1] * ah;
        const cap = String(p.caption || '');
        const fs = Math.min(cw * 0.085, (cw * 0.86) / (Math.max(8, cap.length) * 0.52));
        return `<div class="pol" id="${id}-p${k}" style="left:${px(cx - cw / 2)};top:${px(cy - (cw * PRINT_H) / 2)};width:${px(cw)};padding:${px(cw * 0.055)} ${px(cw * 0.055)} 0;z-index:${k + 1}">
          <div class="pimg"><img src="${asset(p.asset)}" alt=""></div><div class="pcb" style="height:${px(cw * 0.2)}">${cap ? `<div class="pcap" data-lint style="font-size:${px(fs)}">${h(cap)}</div>` : ''}</div></div>`;
      }).join('');
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="tbl" id="${id}-tbl">${prints}</div>
        ${sc.title || sc.kicker ? `<div class="gh">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}${sc.title ? `<div class="hd gt" data-lint>${h(sc.title)}</div>` : ''}</div>` : ''}</div>`);
      scenes.push({ id, kind: 'gallery', n: photos.length, rot: photos.map((_, k) => ROT[k]) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill ${sc.asset ? '' : 'dark'}" id="g-${id}">${sc.asset ? `<div class="ph" id="${id}-ph"><img src="${asset(sc.asset)}" alt=""></div><div class="shade full"></div>` : ''}
        <div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      // With a photo the cta is under a full shade; without one it is the dark brand colour: dark either way.
      scenes.push({ id, kind: 'cta', photo: !!sc.asset, dark: true });
    }
  }
  const hasGallery = scenes.some((s) => s.kind === 'gallery');
  const css = `
.ph{position:absolute;inset:0;overflow:hidden}.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%}
.shade{position:absolute;inset:0}
.shade.bottom{background:linear-gradient(to top,rgba(0,0,0,.72) 0%,rgba(0,0,0,.25) 45%,rgba(0,0,0,0) 70%)}
.shade.top{background:linear-gradient(to bottom,rgba(0,0,0,.72) 0%,rgba(0,0,0,.25) 45%,rgba(0,0,0,0) 70%)}
.shade.center,.shade.full{background:rgba(0,0,0,.42)}
.cap{position:absolute;left:${padX(80)};right:${padX(80)};display:flex;flex-direction:column;gap:${px(18)};color:#fff}
.cap.bottom{bottom:${px(port ? 300 : 170)}}.cap.top{top:${px(port ? 220 : hasLogoBug(brand) ? UNDER_BUG : 110)}}.cap.center{top:50%;transform:translateY(-50%);align-items:center;text-align:center}
.cap .kick{color:var(--secondary)}
.lt{font-size:${px(port ? 116 : 96)};text-shadow:0 ${px(4)} ${px(24)} rgba(0,0,0,.35)}
.lm{display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:${px(6)}}.lw{display:inline-block}
.ls{font-size:${px(42)};opacity:.9}
.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:${px(30)};padding:${px(90)} ${padX(90)};color:#fff}
.ctat{font-size:${px(port ? 120 : 100)}}.curl{font-size:${px(38)};opacity:.85}
.clogo .brandlogo{height:${px(84)};max-width:${px(560)};object-position:center}.clogo .txt{font-weight:800;font-size:${px(56)}}${hasGallery ? `
.tbl{position:absolute;inset:0;transform-origin:50% 55%}
.pol{position:absolute;background:#fbfaf6;border-radius:${px(4)};box-shadow:0 ${px(3)} ${px(6)} rgba(0,0,0,.12),0 ${px(22)} ${px(44)} rgba(0,0,0,.22)}
.pimg{aspect-ratio:1/1;overflow:hidden;background:#d9d6cf}.pimg img{display:block;width:100%;height:100%;object-fit:cover}
.pcb{display:flex;align-items:center;justify-content:center}
.pcap{font-family:var(--body);font-weight:600;color:#2a2a2a;white-space:nowrap;letter-spacing:.01em}
.gh{position:absolute;left:${padX(side)};right:${padX(side)};top:${px(A.top + 10)};display:flex;flex-direction:column;gap:${px(12)};${port ? 'align-items:center;text-align:center' : ''}}
.gt{font-size:${px(port ? 84 : 72)}}` : ''}`;
  const js = `
const kenBurns = (img, s, e, move) => {
  const d = e - s + 0.7;
  const from = { in: { scale: 1.05, x: 0, y: 0 }, out: { scale: 1.2, x: 0, y: 0 }, left: { scale: 1.15, x: 40 * U, y: 0 }, right: { scale: 1.15, x: -40 * U, y: 0 } }[move] || { scale: 1.05 };
  const to = { in: { scale: 1.2 }, out: { scale: 1.05 }, left: { x: -40 * U }, right: { x: 40 * U } }[move] || { scale: 1.2 };
  tl.fromTo(img, from, { ...from, ...to, duration: d, ease: 'none', immediateRender: false }, s - 0.35);
};
const KINDS = {
  photo(sc, s, e) {
    kenBurns($(sc.id + '-ph').querySelector('img'), s, e, sc.move);
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.1, { y: 20 });
    for (let k = 0; k < sc.n; k++) tl.fromTo($(sc.id + '-w' + k), { yPercent: 110 }, { yPercent: 0, duration: 0.55, ease: X, immediateRender: false }, s + 0.2 + k * 0.07);
    fadeUp(g.querySelector('.ls'), s + 0.5 + sc.n * 0.07, { y: 20 });
  },${hasGallery ? `
  gallery(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05, { y: 20 }); fadeUp(g.querySelector('.gt'), s + 0.12, { d: 0.7 });
    tl.fromTo($(sc.id + '-tbl'), { scale: 1 }, { scale: 1.035, duration: Math.max(0.1, e - s), ease: 'none', immediateRender: false }, s);
    // Prints land in order, spread over the voice line, at least 0.35 s apart and all in before the scene ends.
    let prev = s - 0.1;
    for (let k = 0; k < sc.n; k++) {
      const at = Math.min(Math.max(cue(sc, k / sc.n), prev + 0.35, s + 0.3), e - 0.9 - (sc.n - 1 - k) * 0.2);
      prev = at;
      const el = $(sc.id + '-p' + k), r = sc.rot[k];
      tl.fromTo(el, { opacity: 0, scale: 1.3, y: -70 * U, rotation: r + (k % 2 ? 9 : -9) }, { opacity: 1, scale: 1, y: 0, rotation: r, duration: 0.6, ease: 'back.out(1.3)', immediateRender: false }, at);
      tl.fromTo(el.querySelector('img'), { filter: 'brightness(1.7) saturate(0.15)' }, { filter: 'brightness(1) saturate(1)', duration: 1.4, ease: 'power1.out', immediateRender: false }, at + 0.1);
      fadeUp(el.querySelector('.pcap'), at + 0.45, { y: 10, d: 0.4 });
    }
  },` : ''}
  cta(sc, s, e) {
    const g = $('g-' + sc.id);
    if (sc.photo) kenBurns($(sc.id + '-ph').querySelector('img'), s, e, 'in');
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js };
}
