import { page, geometry, h, asset, num, hasLogoBug } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { iconSet } from '../../motion-kit/icons.mjs';

export function build({ brand, script, timing, size, icons }) {
  const ICONS = iconSet(icons);
  const g = geometry(size);
  const { px, port, short } = g;
  const vis = short ? 540 : port ? 720 : 470;
  const scenes = [];
  const parts = [];
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'hook') {
      const ws = String(sc.title).split(/\s+/).filter(Boolean);
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="hook">
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd hookt" data-lint>${ws.map((w, i) => `<span class="hw" id="${id}-w${i}">${h(w)}</span>`).join(' ')}</div>
        <svg class="uline" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><path id="${id}-ul" d="M5 28 C150 8 300 36 595 14"/></svg></div></div>`);
      scenes.push({ id, kind: 'hook', n: ws.length });
    } else if (sc.kind === 'offer') {
      const cur = h(sc.currency || '$');
      const visual = sc.asset
        ? `<img class="oimg" id="${id}-img" src="${asset(sc.asset)}" alt="">`
        : `<svg class="oicon" id="${id}-img" viewBox="0 0 100 112" aria-hidden="true"><path class="ois" d="${ICONS[sc.icon] || ICONS.star}"/><path class="oif" d="${ICONS[sc.icon] || ICONS.star}"/></svg>`;
      parts.push(`<div class="sc fill" id="g-${id}"><div class="offer">
        <div class="ovis">${visual}${sc.badge ? `<div class="badge" id="${id}-badge" data-lint>${h(sc.badge)}</div>` : ''}</div>
        <div class="oinfo">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
          <div class="hd ot" data-lint>${h(sc.title)}</div>
          <div class="prices">${sc.was !== undefined && sc.was !== '' ? `<span class="was" id="${id}-was">${cur}${num(sc.was).toFixed(2)}<i id="${id}-strike"></i></span>` : ''}
            <span class="now" id="${id}-nowbox">${cur}<b id="${id}-now" data-count="${num(sc.now)}" data-format="dec" data-dec="2">0.00</b></span></div>
          ${sc.text ? `<div class="otx" data-lint>${h(sc.text)}</div>` : ''}</div></div></div>`);
      scenes.push({ id, kind: 'offer', was: num(sc.was, 0), now: num(sc.now) });
    } else if (sc.kind === 'code') {
      parts.push(`<div class="sc fill" id="g-${id}"><div class="code">
        ${sc.title ? `<div class="hd ct" data-lint>${h(sc.title)}</div>` : ''}
        <div class="ticket" data-lint><svg viewBox="0 0 800 220" preserveAspectRatio="none" aria-hidden="true"><rect id="${id}-rect" x="6" y="6" width="788" height="208" rx="34"/></svg>
          <span class="cval" id="${id}-code" data-text="${h(sc.code)}"></span></div>
        <div class="copied" id="${id}-copied">✓ Copied</div>
        ${sc.text ? `<div class="otx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'code', len: String(sc.code).length });
    } else if (sc.kind === 'countdown') {
      const units = [['days', 'Days'], ['hours', 'Hours'], ['minutes', 'Min'], ['seconds', 'Sec']];
      parts.push(`<div class="sc fill" id="g-${id}"><div class="cd">
        <div class="hd ct" data-lint>${h(sc.title)}</div>
        <div class="boxes">${units.map(([k, l]) => `<div class="box" id="${id}-${k}"><b>00</b><span>${l}</span></div>`).join('')}</div>
        ${sc.text ? `<div class="otx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'countdown', total: num(sc.days) * 86400 + num(sc.hours) * 3600 + num(sc.minutes) * 60 + num(sc.seconds) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="cta">
        ${logo ? `<div class="clogo" id="${id}-logo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd ctat" id="${id}-t" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>
        ${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta' });
    }
  }

  const css = `
.hook,.code,.cd,.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 ${px(90)};gap:${px(28)}}
.hookt{font-size:${px(port ? 150 : 128)};color:var(--on)}
.hw{display:inline-block}
.uline{width:${px(560)};height:${px(40)};overflow:visible}.uline path{fill:none;stroke:var(--secondary);stroke-width:12;stroke-linecap:round}
.offer{position:absolute;inset:0;display:flex;flex-direction:${port ? 'column' : 'row'};align-items:center;justify-content:center;gap:${px(port ? 40 : 30)};padding:${px(90)}}
.ovis{position:relative;flex:none;width:${px(vis)};height:${px(vis)};display:grid;place-items:center}
.oimg{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 ${px(40)} ${px(40)} rgba(15,23,42,.25))}
.oicon{width:75%;height:75%;overflow:visible}.ois{fill:none;stroke:var(--primary);stroke-width:4}.oif{fill:var(--secondary)}
.badge{position:absolute;right:${px(-10)};top:${px(10)};width:${px(210)};height:${px(210)};border-radius:50%;background:#e11d48;color:#fff;display:grid;place-items:center;text-align:center;font-weight:900;font-size:${px(46)};line-height:1;padding:${px(20)};box-shadow:0 ${px(16)} ${px(30)} rgba(225,29,72,.35)}
.oinfo{display:flex;flex-direction:column;gap:${px(18)};${port ? 'align-items:center;text-align:center' : 'max-width:' + px(520)}}
.ot{font-size:${px(port ? 76 : 60)}}
.prices{display:flex;align-items:baseline;gap:${px(26)};flex-wrap:wrap;${port ? 'justify-content:center' : ''}}
.was{position:relative;font-size:${px(52)};color:var(--muted);font-weight:600}.was i{position:absolute;left:-4%;right:-4%;top:52%;height:${px(7)};background:#e11d48;transform-origin:0 50%;border-radius:4px}
.now{font-family:var(--display);font-weight:900;font-size:${px(port ? 150 : 120)};color:var(--primary2);font-variant-numeric:tabular-nums;letter-spacing:-.03em}
.otx{font-size:${px(40)};color:var(--muted);line-height:1.3}
.code{align-items:center;text-align:center}.ct{font-size:${px(port ? 92 : 76)}}
.ticket{position:relative;width:${px(800)};height:${px(220)};display:grid;place-items:center}
.ticket svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.ticket rect{fill:rgba(255,255,255,.7);stroke:var(--primary2);stroke-width:6;stroke-dasharray:22 14}
.cval{position:relative;font-family:ui-monospace,Consolas,monospace;font-weight:800;font-size:${px(110)};letter-spacing:.08em;color:var(--ink)}
.copied{font-size:${px(34)};font-weight:700;color:#fff;background:#16a34a;border-radius:999px;padding:${px(10)} ${px(28)}}
.cd{align-items:center;text-align:center}
.boxes{display:flex;gap:${px(22)}}
.box{width:${px(port ? 210 : 190)};height:${px(port ? 240 : 210)};border-radius:${px(26)};background:var(--primary);color:var(--on);display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 ${px(20)} ${px(40)} rgba(15,23,42,.2)}
.box b{font-family:var(--display);font-size:${px(port ? 120 : 104)};font-variant-numeric:tabular-nums;line-height:1}.box span{font-size:${px(28)};opacity:.75;text-transform:uppercase;letter-spacing:.12em}
.cta{align-items:flex-start}.ctat{font-size:${px(port ? 120 : 100)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}`;

  const js = `
const KINDS = {
  hook(sc, s, e) {
    const ws = [...Array(sc.n)].map((_, k) => $(sc.id + '-w' + k));
    ws.forEach((w, k) => tl.fromTo(w, { y: 80 * U, opacity: 0, scale: 0.7 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)', immediateRender: false }, s + 0.1 + k * Math.min(0.18, (e - s - 1) / Math.max(1, sc.n))));
    draw($(sc.id + '-ul'), s + 0.25 + sc.n * 0.15, 0.6);
    tl.fromTo($('g-' + sc.id).querySelector('.hookt'), { scale: 1 }, { scale: 1.06, duration: e - s, ease: 'none', immediateRender: false }, s);
  },
  offer(sc, s, e) {
    const img = $(sc.id + '-img');
    pop(img, s + 0.05, { from: 0.8 });
    if (img && img.tagName === 'svg') { draw(img.querySelector('.ois'), s + 0.1, 0.9); tl.fromTo(img.querySelector('.oif'), { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, s + 0.7); }
    tl.fromTo(img, { rotation: -2 }, { rotation: 2, duration: e - s, ease: 'sine.inOut', immediateRender: false }, s);
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.15);
    fadeUp(g.querySelector('.ot'), s + 0.25);
    const was = $(sc.id + '-was');
    if (was) { fadeUp(was, s + 0.45); tl.fromTo($(sc.id + '-strike'), { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power2.out', immediateRender: false }, cue(sc, 0.35)); }
    fadeUp($(sc.id + '-nowbox'), cue(sc, 0.4));
    countUp($(sc.id + '-now'), cue(sc, 0.4), 0.9, sc.was || 0);
    const badge = $(sc.id + '-badge');
    if (badge) tl.fromTo(badge, { scale: 0, rotation: -40 }, { scale: 1, rotation: 12, duration: 0.6, ease: 'back.out(2.2)', immediateRender: false }, cue(sc, 0.55));
    fadeUp(g.querySelector('.otx'), cue(sc, 0.7));
  },
  code(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.ct'), s + 0.05);
    draw($(sc.id + '-rect'), s + 0.2, 0.9);
    typeText($(sc.id + '-code'), s + 0.6, Math.min(1.2, sc.len * 0.09));
    pop($(sc.id + '-copied'), s + 0.8 + Math.min(1.2, sc.len * 0.09));
    fadeUp(g.querySelector('.otx'), cue(sc, 0.6));
  },
  countdown(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.ct'), s + 0.05);
    const boxes = ['days', 'hours', 'minutes', 'seconds'].map((k) => $(sc.id + '-' + k));
    boxes.forEach((b, k) => pop(b, s + 0.2 + k * 0.1, { from: 0.7 }));
    const show = (left) => {
      left = Math.max(0, Math.round(left));
      const v = [Math.floor(left / 86400), Math.floor(left / 3600) % 24, Math.floor(left / 60) % 60, left % 60];
      boxes.forEach((b, k) => { b.querySelector('b').textContent = String(v[k]).padStart(2, '0'); });
    };
    const o = { t: 0 };
    show(sc.total);
    tl.to(o, { t: e - s, duration: e - s, ease: 'none', onUpdate: () => show(sc.total - Math.floor(o.t)) }, s);
    tl.fromTo(boxes[3], { scale: 1 }, { scale: 1.05, duration: 0.15, yoyo: true, repeat: Math.max(1, Math.floor((e - s) - 1) * 2 - 1), ease: 'sine.inOut', immediateRender: false }, s + 0.8);
    fadeUp(g.querySelector('.otx'), cue(sc, 0.6));
  },
  cta(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp($(sc.id + '-logo'), s + 0.05);
    fadeUp(g.querySelector('.kick'), s + 0.1);
    fadeUp($(sc.id + '-t'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6);
    tl.to($(sc.id + '-btn'), { scale: 1.06, duration: 0.45, yoyo: true, repeat: 3, ease: 'sine.inOut' }, s + 1.3);
    fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return page({ brand, script, timing, size, title: 'promo', css, body: parts.join('\n'), scenes, js });
}
