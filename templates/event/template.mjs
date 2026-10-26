import { page, geometry, h, asset, hasLogoBug } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const GLYPH = {
  time: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3.5 2.5',
  place: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 7a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  date: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
};

/** ISO dates become a day/month tile; anything else is shown as written. */
function dateParts(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return { day: String(d.getUTCDate()), month: MONTHS[d.getUTCMonth()], weekday: DAYS[d.getUTCDay()], year: m[1] };
}
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function build(args) {
  return page({ ...args, title: 'event', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, size }) {
  const g = geometry(size);
  const { px, padX, port, land } = g;
  const scenes = [];
  const blocks = [];
  const row = (id, k, kind, text) => `<div class="info" id="${id}-i${k}"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="${id}-g${k}" d="${GLYPH[kind]}"/></svg><span data-lint>${h(text)}</span></div>`;
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'poster') {
      const dp = dateParts(sc.date);
      const info = [];
      if (!dp) info.push(['date', sc.date]);
      if (sc.time) info.push(['time', sc.time]);
      if (sc.place) info.push(['place', sc.place]);
      blocks.push(`<div class="sc fill" id="g-${id}">${sc.asset ? `<div class="pimg" id="${id}-img"><img src="${asset(sc.asset)}" alt=""></div>` : ''}
        <div class="poster ${sc.asset ? 'withimg' : ''}">
          ${dp ? `<div class="tile" id="${id}-tile"><div class="tm">${dp.month}</div><div class="td">${dp.day}</div><div class="tw">${dp.weekday}</div></div>` : ''}
          <div class="ptext">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
            <div class="hd pt" data-lint>${h(sc.title)}</div>
            <div class="infos">${info.map(([kind, text], k) => row(id, k, kind, text)).join('')}</div></div></div></div>`);
      scenes.push({ id, kind: 'poster', n: info.length });
    } else if (sc.kind === 'speakers') {
      const ppl = (sc.people || []).slice(0, 4);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="block"><div class="hd bt" data-lint>${h(sc.title)}</div>
        <div class="ppl">${ppl.map((p, k) => `<div class="person" id="${id}-p${k}">
          <div class="av">${p.asset ? `<img src="${asset(p.asset)}" alt="">` : `<span>${h(initials(p.name))}</span>`}<svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle id="${id}-r${k}" cx="50" cy="50" r="47"/></svg></div>
          <div class="pn" data-lint>${h(p.name)}</div>${p.role ? `<div class="pr" data-lint>${h(p.role)}</div>` : ''}</div>`).join('')}</div></div></div>`);
      scenes.push({ id, kind: 'speakers', n: ppl.length });
    } else if (sc.kind === 'agenda') {
      const items = (sc.items || []).slice(0, 6);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="block"><div class="hd bt" data-lint>${h(sc.title)}</div>
        <div class="agenda"><div class="rail"><i id="${id}-rail"></i></div>
        ${items.map((it, k) => `<div class="ag" id="${id}-a${k}"><b class="dot" id="${id}-d${k}"></b><span class="at" data-lint>${h(it.time || '')}</span><span class="ax" data-lint>${h(it.text || '')}</span></div>`).join('')}</div></div></div>`);
      scenes.push({ id, kind: 'agenda', n: items.length });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      const dp = dateParts(sc.date);
      const when = dp ? `${dp.weekday} ${dp.day} ${dp.month} ${dp.year}` : sc.date || '';
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        ${when ? `<div class="when" data-lint>${h(when)}</div>` : ''}
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const tileW = port ? 360 : land ? 330 : 280;
  const css = `
.pimg{position:absolute;inset:0;overflow:hidden}.pimg img{width:100%;height:100%;object-fit:cover}
.pimg::after{content:"";position:absolute;inset:0;background:linear-gradient(${port ? 'to top' : 'to right'},var(--bg) 38%,rgba(255,255,255,.55) 70%,rgba(255,255,255,0))}
.poster{position:absolute;inset:0;display:flex;flex-direction:${port ? 'column' : 'row'};align-items:${port ? 'flex-start' : 'center'};justify-content:${port ? 'flex-end' : 'flex-start'};gap:${px(port ? 50 : 70)};padding:${px(port ? 140 : 100)} ${padX(land ? 140 : 90)} ${px(port ? 300 : 100)}}
.tile{flex:none;width:${px(tileW)};border-radius:${px(36)};background:#fff;box-shadow:0 ${px(30)} ${px(60)} rgba(15,23,42,.16);overflow:hidden;text-align:center;transform-origin:50% 0}
.tm{background:var(--primary);color:var(--on);font-weight:800;letter-spacing:.2em;font-size:${px(tileW * 0.14)};padding:${px(18)} 0}
.td{font-family:var(--display);font-weight:900;font-size:${px(tileW * 0.5)};line-height:1.05;color:var(--ink)}
.tw{font-weight:700;letter-spacing:.2em;color:var(--muted);font-size:${px(tileW * 0.1)};padding-bottom:${px(22)}}
.ptext{display:flex;flex-direction:column;gap:${px(24)};max-width:${px(land ? 1150 : 900)}}
.pt{font-size:${px(port ? 108 : land ? 100 : 84)}}
.infos{display:flex;flex-direction:column;gap:${px(16)};margin-top:${px(10)}}
.info{display:flex;align-items:center;gap:${px(18)};font-size:${px(42)};font-weight:600}
.info svg{width:${px(48)};height:${px(48)};flex:none;overflow:visible}.info path{fill:none;stroke:var(--primary2);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.block{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:${px(56)};padding:${px(port ? 140 : 100)} ${padX(land ? 160 : 90)}}
.bt{font-size:${px(port ? 96 : 84)}}
.ppl{display:grid;grid-template-columns:repeat(${port ? 2 : land ? 4 : 2},1fr);gap:${px(50)} ${px(40)}}
.person{display:flex;flex-direction:column;align-items:center;text-align:center;gap:${px(12)}}
.av{position:relative;width:${px(port ? 300 : 240)};height:${px(port ? 300 : 240)};border-radius:50%;background:var(--primary2);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-weight:800;font-size:${px(port ? 110 : 88)}}
.av img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.ring{position:absolute;inset:${px(-14)};width:calc(100% + ${px(28)});height:calc(100% + ${px(28)});overflow:visible}.ring circle{fill:none;stroke:var(--secondary);stroke-width:3;transform:rotate(-90deg);transform-origin:50% 50%}
.pn{font-weight:800;font-size:${px(44)}}.pr{font-size:${px(34)};color:var(--muted)}
.agenda{position:relative;display:flex;flex-direction:column;gap:${px(40)};padding-left:${px(70)}}
.rail{position:absolute;left:${px(18)};top:${px(20)};bottom:${px(20)};width:${px(6)};border-radius:3px;background:rgba(15,23,42,.08)}.rail i{display:block;width:100%;height:100%;background:var(--primary2);transform-origin:50% 0}
.ag{position:relative;display:flex;align-items:baseline;gap:${px(30)};font-size:${px(46)}}
.dot{position:absolute;left:${px(-64)};top:${px(14)};width:${px(30)};height:${px(30)};border-radius:50%;background:#fff;border:${px(6)} solid var(--primary2)}
.at{font-weight:800;color:var(--primary2);font-variant-numeric:tabular-nums;min-width:${px(150)}}.ax{font-weight:600}
.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:${px(30)};padding:${px(90)} ${padX(90)}}
.ctat{font-size:${px(port ? 120 : 100)}}.when{font-weight:700;letter-spacing:.12em;font-size:${px(40)};color:var(--secondary)}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(84)};max-width:${px(560)};object-position:center}.clogo .txt{font-weight:800;font-size:${px(56)}}`;
  const js = `
const KINDS = {
  poster(sc, s, e) {
    const g = $('g-' + sc.id);
    const img = $(sc.id + '-img');
    if (img) tl.fromTo(img.querySelector('img'), { scale: 1.12 }, { scale: 1, duration: e - s + 0.5, ease: 'none', immediateRender: false }, s - 0.35);
    const tile = $(sc.id + '-tile');
    if (tile) {
      tl.fromTo(tile, { rotationX: -95, opacity: 0, transformPerspective: 900 }, { rotationX: 0, opacity: 1, duration: 0.9, ease: 'back.out(1.4)', immediateRender: false }, s + 0.1);
      pop(tile.querySelector('.td'), s + 0.55, { from: 0.5 });
    }
    fadeUp(g.querySelector('.kick'), s + 0.3); fadeUp(g.querySelector('.pt'), s + 0.4, { d: 0.7 });
    for (let k = 0; k < sc.n; k++) { fadeUp($(sc.id + '-i' + k), s + 0.9 + k * 0.2, { y: 20 }); draw($(sc.id + '-g' + k), s + 0.95 + k * 0.2, 0.7); }
  },
  speakers(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.bt'), s + 0.05);
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.35 + k * 0.25;
      pop($(sc.id + '-p' + k).querySelector('.av'), at, { from: 0.4 });
      draw($(sc.id + '-r' + k), at + 0.2, 0.8);
      fadeUp($(sc.id + '-p' + k).querySelector('.pn'), at + 0.25, { y: 18 }); fadeUp($(sc.id + '-p' + k).querySelector('.pr'), at + 0.35, { y: 18 });
    }
  },
  agenda(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.bt'), s + 0.05);
    const span = Math.max(0.3, Math.min(0.7, (e - s - 1.4) / Math.max(1, sc.n)));
    tl.fromTo($(sc.id + '-rail'), { scaleY: 0 }, { scaleY: 1, duration: span * sc.n + 0.3, ease: 'none', immediateRender: false }, s + 0.35);
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.4 + k * span;
      pop($(sc.id + '-d' + k), at, { from: 0 });
      tl.fromTo($(sc.id + '-a' + k), { x: -30 * U, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, immediateRender: false }, at + 0.05);
    }
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    fadeUp(g.querySelector('.when'), s + 0.45); pop($(sc.id + '-btn'), s + 0.65); fadeUp(g.querySelector('.curl'), s + 0.9);
    tl.to($(sc.id + '-btn'), { scale: 1.06, duration: 0.5, yoyo: true, repeat: 3, ease: 'sine.inOut' }, s + 1.4);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js };
}
