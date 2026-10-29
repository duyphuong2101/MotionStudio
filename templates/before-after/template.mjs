import { page, geometry, h, asset, num, hasLogoBug, contentArea, themeClass, ACCENT_CSS, UNDER_BUG } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { motionProfile } from '../../engine/brand.mjs';

export function build({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port, land } = g;
  const stage = motionProfile(brand).layout === 'stage';
  const bug = hasLogoBug(brand);
  const A = contentArea(brand, g);
  // With the corner logo, the split title starts under it and the panels move down by the same amount.
  const titleTop = bug ? Math.max(UNDER_BUG, port ? 120 : 64) : port ? 120 : 64;
  const splitTop = (port ? 250 : 170) + titleTop - (port ? 120 : 64);
  const scenes = [];
  const parts = [];
  const side = (id, which, d) => {
    const items = (d?.items || []).slice(0, 4);
    const mark = which === 'before'
      ? '<path class="bamk x" d="M6 6 L26 26 M26 6 L6 26"/>'
      : '<path class="bamk v" d="M5 17 L13 25 L28 7"/>';
    return `<div class="panel ${which}" id="${id}-${which}">
      ${d?.asset ? `<img class="pimg" src="${asset(d.asset)}" alt="">` : ''}
      <div class="plabel" data-lint>${h(d?.label || (which === 'before' ? 'Before' : 'After'))}</div>
      ${d?.title ? `<div class="hd ptitle" data-lint>${h(d.title)}</div>` : ''}
      <div class="items">${items.map((t, k) => `<div class="item" id="${id}-${which}-i${k}"><svg viewBox="0 0 32 32" aria-hidden="true">${mark}</svg><span data-lint>${h(t)}</span></div>`).join('')}</div></div>`;
  };
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'intro') {
      parts.push(`<div class="sc fill" id="g-${id}"><div class="intro">
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd it" data-lint>${h(sc.title)}</div>${sc.subtitle ? `<div class="isub" data-lint>${h(sc.subtitle)}</div>` : ''}
        <div class="vs"><span>Before</span><i></i><span>After</span></div></div></div>`);
      scenes.push({ id, kind: 'intro' });
    } else if (sc.kind === 'split') {
      parts.push(`<div class="sc fill" id="g-${id}">${sc.title ? `<div class="hd stitle" data-lint>${h(sc.title)}</div>` : ''}
        <div class="split">${side(id, 'before', sc.before)}${side(id, 'after', sc.after)}<div class="divider" id="${id}-div"><b>↔</b></div></div></div>`);
      scenes.push({ id, kind: 'split', nb: (sc.before?.items || []).slice(0, 4).length, na: (sc.after?.items || []).slice(0, 4).length });
    } else if (sc.kind === 'stat') {
      const f = sc.format || 'int';
      // An arrow only for a change value, pointing the way of its sign: "88% less" with no change shows none.
      const ch = sc.change === undefined || sc.change === null || sc.change === '' ? 0 : num(sc.change, 0);
      const up = ch > 0;
      parts.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="stat">
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="big">${ch ? `<svg class="arrow ${up ? 'up' : 'dn'}" viewBox="0 0 60 80" aria-hidden="true"><path id="${id}-ar" d="${up ? 'M30 76 L30 8 M8 30 L30 8 L52 30' : 'M30 4 L30 72 M8 50 L30 72 L52 50'}"/></svg>` : ''}
          <b id="${id}-v" data-count="${num(sc.value)}" data-format="${h(f)}" data-dec="${f === 'dec' ? 1 : 0}">0</b>${sc.unit ? `<small>${h(sc.unit)}</small>` : ''}</div>
        <div class="stx" data-lint>${h(sc.text)}</div></div></div>`);
      scenes.push({ id, kind: 'stat', ...(sc.theme === 'dark' ? { dark: true } : {}) });
    } else if (sc.kind === 'cta') {
      const logo = bug ? '' : logoHtml(brand, { onDark: true });
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta' });
    }
  }
  const hasDark = script.scenes.some((s) => s.kind === 'stat' && s.theme === 'dark');
  const hasAcc = script.scenes.some((s) => s.kind === 'stat' && s.theme === 'accent');
  const css = `
.intro,.stat,.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(90)} ${padX(90)};gap:${px(28)}}
.intro{align-items:center;text-align:center}.it{font-size:${px(port ? 120 : 104)}}.isub{font-size:${px(44)};color:var(--muted)}
.vs{display:flex;align-items:center;gap:${px(24)};font-weight:800;font-size:${px(40)};text-transform:uppercase;letter-spacing:.1em}
.vs span:first-child{color:var(--muted)}.vs span:last-child{color:var(--primary2)}.vs i{width:${px(160)};height:${px(8)};border-radius:4px;background:linear-gradient(90deg,var(--muted),var(--primary2))}
.stitle{position:absolute;left:${padX(90)};right:${padX(90)};top:${px(titleTop)};text-align:center;font-size:${px(port ? 72 : 60)};z-index:3}
.split{position:absolute;left:${padX(70)};right:${padX(70)};top:${px(splitTop)};bottom:${px(port ? 330 : 230)};display:grid;${port ? 'grid-template-rows:1fr 1fr' : 'grid-template-columns:1fr 1fr'};gap:${px(18)}}
.panel{position:relative;border-radius:${px(30)};padding:${px(46)};display:flex;flex-direction:column;justify-content:center;gap:${px(18)};overflow:hidden}
.panel.before{background:#e8eaee;color:#4b5563}.panel.after{background:var(--primary);color:var(--on)}
.pimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.25}
.plabel{position:relative;font-weight:800;font-size:${px(30)};letter-spacing:.14em;text-transform:uppercase}
.after .plabel{color:var(--secondary)}
.ptitle{position:relative;font-size:${px(port ? 64 : 58)}}
.items{position:relative;display:flex;flex-direction:column;gap:${px(16)};margin-top:${px(8)}}
.item{display:flex;align-items:center;gap:${px(18)};font-size:${px(port ? 44 : 40)};font-weight:600}
.item svg{width:${px(46)};height:${px(46)};flex:none;overflow:visible}.bamk{fill:none;stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round}.bamk.x{stroke:#dc2626}.bamk.v{stroke:var(--secondary)}
.divider{position:absolute;${port ? `left:-${px(30)};right:-${px(30)};top:50%;height:${px(8)};margin-top:-${px(4)}` : `top:-${px(30)};bottom:-${px(30)};left:50%;width:${px(8)};margin-left:-${px(4)}`};background:#fff;box-shadow:0 0 ${px(30)} rgba(15,23,42,.25);border-radius:4px;z-index:4}
.divider b{position:absolute;left:50%;top:50%;width:${px(84)};height:${px(84)};margin:-${px(42)} 0 0 -${px(42)};border-radius:50%;background:#fff;color:var(--primary);display:grid;place-items:center;font-size:${px(40)};box-shadow:0 ${px(10)} ${px(24)} rgba(15,23,42,.25)${port ? ';transform:rotate(90deg)' : ''}}
.stat{align-items:center;text-align:center}
.big{display:flex;align-items:center;gap:${px(24)};font-family:var(--display);font-weight:900;font-size:${px(230)};line-height:1;color:var(--primary2);font-variant-numeric:tabular-nums}.big small{font-size:${px(100)}}
.arrow{width:${px(120)};height:${px(160)};overflow:visible}.arrow path{fill:none;stroke-width:9;stroke-linecap:round;stroke-linejoin:round}.arrow.up path{stroke:#16a34a}.arrow.dn path{stroke:#16a34a}
.stx{font-size:${px(44)};color:var(--muted)}
.cta{align-items:flex-start}.ctat{font-size:${px(port ? 116 : 96)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}${hasDark ? `
.dark .big{color:var(--secondary)}.dark .stat .stx{color:var(--on);opacity:.75}` : ''}${hasAcc ? `${ACCENT_CSS}
.acc .big{color:var(--ink)}.acc .stat .stx{color:var(--ink);opacity:.8}.acc .arrow path{stroke:var(--ink)}` : ''}${stage ? `
.stitle{top:${px(A.top)};font-size:${px(port ? 80 : land ? 72 : 60)}}
.split{left:${padX(port ? 70 : 110)};right:${padX(port ? 70 : 110)};top:${px(A.top + (port ? 140 : land ? 120 : 110))};bottom:${px(A.bottom)}}
.panel{padding:${px(land ? 52 : 40)}}.plabel{font-size:${px(land ? 34 : 30)}}.ptitle{font-size:${px(port ? 70 : land ? 72 : 56)}}
.item{font-size:${px(port ? 48 : land ? 50 : 38)}}.item svg{width:${px(land || port ? 56 : 44)};height:${px(land || port ? 56 : 44)}}
.stat{padding:${px(A.top)} ${padX(110)} ${px(A.bottom)}}.stat .kick{font-size:${px(40)}}
.big{font-size:${px(port ? 270 : land ? 300 : 250)}}.big small{font-size:${px(land ? 120 : 100)}}
.arrow{width:${px(land ? 150 : 120)};height:${px(land ? 200 : 160)}}.stx{font-size:${px(land ? 58 : 48)}}` : ''}`;
  const js = `
const KINDS = {
  intro(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.it'), s + 0.15, { d: 0.7 }); fadeUp(g.querySelector('.isub'), s + 0.5);
    tl.fromTo(g.querySelector('.vs i'), { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: XIO, immediateRender: false }, s + 0.6);
    fadeUp(g.querySelector('.vs'), s + 0.55);
  },
  split(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.stitle'), s + 0.05);
    const before = $(sc.id + '-before'), after = $(sc.id + '-after'), div = $(sc.id + '-div');
    fadeUp(before, s + 0.1, { y: 20 });
    for (let k = 0; k < sc.nb; k++) { const it = $(sc.id + '-before-i' + k); fadeUp(it, s + 0.3 + k * 0.15, { y: 16 }); draw(it.querySelector('.bamk'), s + 0.35 + k * 0.15, 0.35); }
    const tw = cue(sc, 0.45);
    const clipFrom = D.land || !D.port ? 'inset(0 0 0 100%)' : 'inset(0 0 100% 0)';
    tl.fromTo(after, { clipPath: clipFrom.replace('100%', '100%') }, { clipPath: 'inset(0 0 0 0%)', duration: 0.9, ease: XIO, immediateRender: false }, tw);
    tl.set(after, { clipPath: clipFrom }, 0);
    tl.fromTo(div, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, tw - 0.2);
    tl.to(div.querySelector('b'), { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1 }, tw - 0.1);
    for (let k = 0; k < sc.na; k++) { const it = $(sc.id + '-after-i' + k); fadeUp(it, tw + 0.6 + k * 0.18, { y: 16 }); draw(it.querySelector('.bamk'), tw + 0.65 + k * 0.18, 0.4); }
  },
  stat(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05);
    pop(g.querySelector('.big'), s + 0.1, { from: 0.85 });
    draw($(sc.id + '-ar'), s + 0.2, 0.7);
    countUp($(sc.id + '-v'), s + 0.2, 1.2);
    fadeUp(g.querySelector('.stx'), cue(sc, 0.4));
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return page({ brand, script, timing, size, title: 'before-after', css, body: parts.join('\n'), scenes, js });
}
