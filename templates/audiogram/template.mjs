import { page, geometry, h, asset, hasLogoBug } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';

const BARS = 23; // per side of the centre line; the centre bar is the sound right now

export function build({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port, land } = g;
  const levels = Object.fromEntries((timing.footage || []).map((f) => [f.id, f.levels || []]));
  const scenes = [];
  const parts = [];
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'clip') {
      const art = sc.image ? `<img class="art" src="${asset(sc.image)}" alt="">` : `<div class="art logoart">${logoHtml(brand, { onDark: true }) || ''}</div>`;
      const bars = Array.from({ length: BARS * 2 + 1 }, (_, k) => `<i id="${id}-b${k}"></i>`).join('');
      parts.push(`<div class="sc fill dark ag" id="g-${id}"><div class="agbox">
        <div class="artwrap" id="${id}-art">${art}</div>
        <div class="agtext">${sc.title ? `<div class="kick" data-lint>${h(sc.title)}</div>` : ''}
          ${sc.name ? `<div class="hd agn" id="${id}-n" data-lint>${h(sc.name)}</div>` : ''}${sc.role ? `<div class="agr" data-lint>${h(sc.role)}</div>` : ''}
          <div class="wave" id="${id}-w">${bars}</div>
          <div class="prog"><i id="${id}-p"></i></div><div class="tm" id="${id}-tm">0:00</div></div></div></div>`);
      scenes.push({ id, kind: 'clip', dark: true, lv: levels[id] || [] });
    } else if (sc.kind === 'card') {
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="card">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd ct" data-lint>${h(sc.title)}</div>${sc.text ? `<div class="cx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'card', dark: true });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="card">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ct" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const art = port ? 560 : land ? 520 : 420;
  const css = `
.ag{background:radial-gradient(${px(1200)} ${px(900)} at 30% 30%,color-mix(in srgb,var(--primary2) 35%,var(--primary)),var(--primary))}
.agbox{position:absolute;inset:0;display:flex;flex-direction:${port ? 'column' : 'row'};align-items:center;justify-content:center;gap:${px(port ? 70 : 80)};padding:${px(port ? 140 : 90)} ${padX(port ? 90 : 130)} ${px(port ? 360 : 230)}}
.artwrap{flex:none;width:${px(art)};height:${px(art)};border-radius:${px(28)};overflow:hidden;box-shadow:0 ${px(30)} ${px(80)} rgba(0,0,0,.45);background:rgba(255,255,255,.08)}
.art{width:100%;height:100%;object-fit:cover;display:block}.logoart{display:grid;place-items:center;padding:${px(50)}}.logoart .brandlogo{max-width:100%;max-height:100%;object-position:center}
.logoart .txt{font-weight:900;font-size:${px(64)};text-align:center}
.agtext{display:flex;flex-direction:column;gap:${px(16)};min-width:0;flex:1;${port ? 'width:100%;align-items:center;text-align:center' : ''}}
.agn{font-size:${px(port ? 84 : 76)}}.agr{font-size:${px(38)};opacity:.75}
.wave{display:flex;align-items:center;justify-content:${port ? 'center' : 'flex-start'};gap:${px(8)};height:${px(200)};margin-top:${px(20)}}
.wave i{display:block;width:${px(port ? 13 : 12)};height:100%;border-radius:${px(7)};background:var(--secondary);transform:scaleY(.06);transform-origin:50% 50%}
.prog{width:100%;height:${px(8)};border-radius:${px(4)};background:rgba(255,255,255,.18);overflow:hidden}.prog i{display:block;height:100%;width:0;background:var(--secondary)}
.tm{font-size:${px(30)};opacity:.7;font-variant-numeric:tabular-nums}
.card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:${px(28)};padding:${px(port ? 140 : 100)} ${padX(110)}}
.ct{font-size:${px(port ? 112 : 100)}}.cx{font-size:${px(44)};opacity:.85;line-height:1.3}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}`;
  const js = `
const PER = ${30}, SIDE = ${BARS};
const CLIPS = D.scenes.filter((s) => s.kind === 'clip');
const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const KINDS = {
  clip(sc, s) {
    const g = $('g-' + sc.id);
    pop($(sc.id + '-art'), s + 0.05, { from: 0.9 });
    fadeUp(g.querySelector('.kick'), s + 0.15); fadeUp($(sc.id + '-n'), s + 0.2); fadeUp(g.querySelector('.agr'), s + 0.3);
  },
  card(sc, s) { const g = $('g-' + sc.id); fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.ct'), s + 0.12, { d: 0.6 }); fadeUp(g.querySelector('.cx'), s + 0.4); },
  cta(sc, s) { const g = $('g-' + sc.id); fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ct'), s + 0.2, { d: 0.7 }); pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9); },
};
// The waveform is the clip's own loudness: the centre bar is now, bars further out are the moments just before.
// Set in __prepare because the kit declares afterSeek after this script runs.
const waveAt = (t) => {
  for (const c of CLIPS) {
    if (t < c.start - 0.5 || t > c.end + 0.5) continue;
    const local = Math.max(0, t - c.start), now = Math.floor(local * PER), lv = c.lv;
    for (let k = -SIDE; k <= SIDE; k++) {
      const v = lv[now - Math.abs(k) * 2] ?? 0;
      $(c.id + '-b' + (k + SIDE)).style.transform = 'scaleY(' + Math.max(0.06, v * (1 - Math.abs(k) / (SIDE * 1.6))).toFixed(3) + ')';
    }
    const len = c.end - c.start;
    $(c.id + '-p').style.width = (Math.min(1, local / len) * 100).toFixed(2) + '%';
    $(c.id + '-tm').textContent = mmss(Math.min(local, len)) + ' / ' + mmss(len);
  }
  return t;
};
window.__prepare = async () => { afterSeek = waveAt; };`;
  return page({ brand, script, timing, size, title: 'audiogram', css, body: parts.join('\n'), scenes, js });
}
