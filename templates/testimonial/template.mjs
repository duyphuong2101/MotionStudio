import { page, geometry, h, asset, num, hasLogoBug } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';

const STAR = 'M50 6 L62 38 L96 39 L69 60 L79 94 L50 74 L21 94 L31 60 L4 39 L38 38 Z';
const initials = (t) => String(t || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function build(args) {
  return page({ ...args, title: 'testimonial', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, size }) {
  const g = geometry(size);
  const { px, padX, port, land } = g;
  const scenes = [];
  const blocks = [];
  const stars = (id, rating) => `<div class="stars">${[0, 1, 2, 3, 4].map((k) => `<svg class="st" viewBox="0 0 100 100" aria-hidden="true"><path class="sto" d="${STAR}"/><path class="stf" id="${id}-s${k}" d="${STAR}" style="opacity:${k < Math.round(rating) ? 1 : 0}"/></svg>`).join('')}</div>`;
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'quote') {
      const ws = String(sc.quote).split(/\s+/).filter(Boolean);
      const avatar = sc.asset ? `<img class="av" src="${asset(sc.asset)}" alt="">` : `<div class="av ini">${h(initials(sc.author))}</div>`;
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="quote">
        <svg class="qm" viewBox="0 0 120 90" aria-hidden="true"><path id="${id}-qm" d="M50 10 C25 14 10 32 10 55 C10 72 22 82 36 82 C50 82 58 72 58 60 C58 48 49 40 37 40 C35 40 33 40 31 41 C34 28 42 20 54 17 Z M110 10 C85 14 70 32 70 55 C70 72 82 82 96 82 C110 82 118 72 118 60 C118 48 109 40 97 40 C95 40 93 40 91 41 C94 28 102 20 114 17 Z"/></svg>
        <div class="qt hd" data-lint>${ws.map((w, k) => `<span class="qw" id="${id}-w${k}">${h(w)}</span>`).join(' ')}</div>
        ${sc.rating !== undefined && sc.rating !== '' ? stars(id, num(sc.rating, 5)) : ''}
        <div class="who" id="${id}-who">${avatar}<div><b data-lint>${h(sc.author)}</b>${sc.role ? `<span data-lint>${h(sc.role)}</span>` : ''}</div></div></div></div>`);
      scenes.push({ id, kind: 'quote', n: ws.length, stars: sc.rating !== undefined && sc.rating !== '' ? Math.round(num(sc.rating, 5)) : 0 });
    } else if (sc.kind === 'product') {
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="prod">
        ${sc.asset ? `<img class="pimg" id="${id}-img" src="${asset(sc.asset)}" alt="">` : ''}
        <div class="pinfo">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd pt" data-lint>${h(sc.title)}</div>${sc.text ? `<div class="ptx" data-lint>${h(sc.text)}</div>` : ''}</div></div></div>`);
      scenes.push({ id, kind: 'product' });
    } else if (sc.kind === 'stat') {
      const f = sc.format || (Number.isInteger(num(sc.value)) ? 'int' : 'dec');
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="stat">
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="big"><b id="${id}-v" data-count="${num(sc.value)}" data-format="${h(f)}" data-dec="1">0</b>${sc.unit ? `<small>${h(sc.unit)}</small>` : ''}</div>
        ${stars(id, Math.min(5, num(sc.value)))}
        <div class="ptx" data-lint>${h(sc.text)}</div></div></div>`);
      scenes.push({ id, kind: 'stat', stars: Math.round(Math.min(5, num(sc.value))) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const css = `
.quote,.stat,.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(port ? 130 : 90)} ${padX(land ? 220 : 90)};gap:${px(34)}}
.qm{width:${px(150)};height:${px(112)};overflow:visible}.qm path{fill:none;stroke:var(--primary2);stroke-width:5;stroke-linejoin:round}
.qt{font-size:${px(port ? 82 : land ? 68 : 64)};font-weight:700;line-height:1.18;color:var(--ink)}
.qw{display:inline-block}
.stars{display:flex;gap:${px(12)}}.st{width:${px(62)};height:${px(62)};overflow:visible}.sto{fill:none;stroke:#f5a524;stroke-width:5;stroke-linejoin:round}.stf{fill:#f5a524}
.who{display:flex;align-items:center;gap:${px(22)}}.who b{display:block;font-size:${px(40)}}.who span{font-size:${px(32)};color:var(--muted)}
.av{width:${px(110)};height:${px(110)};border-radius:50%;object-fit:cover;flex:none}
.av.ini{display:grid;place-items:center;background:var(--primary2);color:#fff;font-weight:800;font-size:${px(44)}}
.prod{position:absolute;inset:0;display:flex;flex-direction:${port ? 'column' : 'row'};align-items:center;justify-content:center;gap:${px(50)};padding:${px(90)} ${padX(90)}}
.pimg{width:${px(port ? 720 : 520)};height:${px(port ? 720 : 520)};object-fit:contain;filter:drop-shadow(0 ${px(40)} ${px(40)} rgba(15,23,42,.22))}
.pinfo{display:flex;flex-direction:column;gap:${px(18)};${port ? 'text-align:center;align-items:center' : 'max-width:' + px(640)}}
.pt{font-size:${px(port ? 86 : 72)}}.ptx{font-size:${px(40)};color:var(--muted);line-height:1.3}
.stat{align-items:center;text-align:center}
.big{font-family:var(--display);font-weight:900;font-size:${px(260)};line-height:1;color:var(--primary2);font-variant-numeric:tabular-nums}.big small{font-size:${px(110)};color:#f5a524;margin-left:${px(10)}}
.cta{align-items:flex-start}.ctat{font-size:${px(port ? 116 : 96)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}`;
  const js = `
const fillStars = (id, n, at) => { for (let k = 0; k < 5; k++) { const st = $(id + '-s' + k); if (!st) continue; tl.fromTo(st, { scale: 0, opacity: 0, transformOrigin: '50% 50%' }, { scale: 1, opacity: k < n ? 1 : 0, duration: 0.35, ease: 'back.out(2.4)', immediateRender: false }, at + k * 0.12); } };
const KINDS = {
  quote(sc, s, e) {
    draw($(sc.id + '-qm'), s + 0.05, 0.9);
    const ws = words(sc.id);
    const match = ws.length === sc.n;
    for (let k = 0; k < sc.n; k++) {
      const at = match ? ws[k].start : s + 0.3 + k * Math.min(0.25, (e - s - 1.2) / sc.n);
      tl.fromTo($(sc.id + '-w' + k), { opacity: 0.12, y: 10 * U }, { opacity: 1, y: 0, duration: 0.25, immediateRender: false }, at);
    }
    if (sc.stars) fillStars(sc.id, sc.stars, cue(sc, 0.5));
    fadeUp($(sc.id + '-who'), cue(sc, 0.6));
  },
  product(sc, s) {
    pop($(sc.id + '-img'), s + 0.05, { from: 0.8 });
    tl.fromTo($(sc.id + '-img'), { y: 0 }, { y: -18 * U, duration: 1.6, yoyo: true, repeat: 3, ease: 'sine.inOut', immediateRender: false }, s + 0.6);
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.2); fadeUp(g.querySelector('.pt'), s + 0.3); fadeUp(g.querySelector('.ptx'), cue(sc, 0.5));
  },
  stat(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05);
    pop(g.querySelector('.big'), s + 0.1, { from: 0.8 });
    countUp($(sc.id + '-v'), s + 0.15, 1.2);
    fillStars(sc.id, sc.stars, s + 0.6);
    fadeUp(g.querySelector('.ptx'), cue(sc, 0.4));
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js };
}
