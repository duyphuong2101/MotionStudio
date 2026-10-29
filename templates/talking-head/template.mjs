import { page, geometry, h, hasLogoBug, asset } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { markWords, hasMark } from '../../engine/marks.mjs';

export function build({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port } = g;
  const scenes = [];
  const parts = [];
  const layouts = new Set();
  // The kit's corner logo replaces the clip's own logo, so a frame never shows two.
  const mark = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true, cls: 'bug-img' });
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'clip') {
      // split: the speaker slides to one half and the screenshot fills the other; pip: the screenshot fills the
      // frame and the speaker shrinks into a corner. A full clip keeps its plain markup.
      const lay = (sc.layout === 'split' || sc.layout === 'pip') && sc.image ? sc.layout : 'full';
      const video = `<video id="${id}-v" src="clips/${encodeURIComponent(id)}.mp4" muted playsinline preload="auto"></video>`;
      const inner = lay === 'full' ? video : `<div class="scr" id="${id}-scr"><img src="${asset(sc.image)}" alt=""></div><div class="cv" id="${id}-cv">${video}</div>`;
      if (lay !== 'full') layouts.add(lay);
      parts.push(`<div class="sc fill clip${lay === 'full' ? '' : ` ${lay}`}" id="g-${id}">${inner}
        ${sc.name ? `<div class="l3" id="${id}-l3"><i></i><div><div class="ln" data-lint>${h(sc.name)}</div>${sc.role ? `<div class="lr" data-lint>${h(sc.role)}</div>` : ''}</div></div>` : ''}
        ${mark ? `<div class="bug">${mark}</div>` : ''}</div>`);
      scenes.push({ id, kind: 'clip', zoom: sc.zoom || 'none', ...(lay === 'full' ? {} : { layout: lay }) });
    } else if (sc.kind === 'card') {
      const ws = markWords(sc.title);
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="card">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd ct" data-lint>${ws.map((w, k) => `<span class="cm"${hasMark(w) ? ' style="overflow:visible"' : ''}><span id="${id}-w${k}">${h(w)}</span></span>`).join(' ')}</div>
        ${sc.text ? `<div class="cx" data-lint>${h(sc.text)}</div>` : ''}<div class="bar" id="${id}-bar"></div></div></div>`);
      scenes.push({ id, kind: 'card', n: ws.length });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      parts.push(`<div class="sc fill dark" id="g-${id}"><div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta' });
    }
  }
  const css = `
.clip{background:#000}.clip video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:50% 40%}
.l3{position:absolute;left:${px(70)};bottom:${px(port ? 330 : 190)};display:flex;align-items:stretch;gap:${px(18)};background:rgba(255,255,255,.96);border-radius:${px(18)};padding:${px(18)} ${px(30)} ${px(18)} ${px(18)};box-shadow:0 ${px(16)} ${px(40)} rgba(0,0,0,.25);max-width:calc(100% - ${px(140)})}
.l3 i{width:${px(10)};border-radius:${px(5)};background:var(--secondary);transform-origin:50% 100%}
.ln{font-family:var(--display);font-weight:800;font-size:${px(44)};color:var(--ink);white-space:nowrap}.lr{font-size:${px(32)};color:var(--muted);white-space:nowrap}
.bug{position:absolute;right:${px(60)};top:${px(port ? 120 : 60)};opacity:.85}.bug-img{height:${px(56)};max-width:${px(260)};object-fit:contain;display:block}.bug .txt{color:#fff;font-weight:800;font-size:${px(36)};text-shadow:0 2px 8px rgba(0,0,0,.4)}
.card,.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:${px(28)};padding:${px(port ? 140 : 100)} ${padX(100)}}
.ct{font-size:${px(port ? 120 : 104)}}.cm{display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:${px(6)}}.cm span{display:inline-block}
.cx{font-size:${px(44)};opacity:.85;line-height:1.3}
.bar{width:${px(160)};height:${px(10)};border-radius:5px;background:var(--secondary);transform-origin:0 50%}
.cta{align-items:center;text-align:center}.ctat{font-size:${px(port ? 116 : 100)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(84)};max-width:${px(560)};object-position:center}.clogo .txt{font-weight:800;font-size:${px(56)}}${layouts.size ? `
.cv{position:absolute;inset:0;overflow:hidden;z-index:2}
.scr{position:absolute;display:flex;align-items:center;justify-content:center;background:var(--bg);z-index:1}
.scr img{display:block;max-width:86%;max-height:100%;object-fit:contain;border-radius:${px(14)};box-shadow:0 ${px(18)} ${px(44)} rgba(15,23,42,.22)}` : ''}${layouts.has('split') ? `
.clip.split .scr{${port ? `left:0;right:0;top:50%;bottom:0;padding:${px(50)} ${px(60)} ${px(330)}` : `left:50%;right:0;top:0;bottom:0;padding:${px(90)} ${px(70)} ${px(190)}`};z-index:3}
.clip.split .l3{${port ? `bottom:calc(50% + ${px(40)})` : `max-width:calc(50% - ${px(140)})`}}` : ''}${layouts.has('pip') ? `
.clip.pip .scr{inset:0;${port ? `align-items:flex-start;padding:${px(170)} ${padX(70)} ${px(330)}` : `justify-content:flex-start;padding:${px(110)} ${padX(90)} ${px(190)}`}}
.clip.pip .scr img{max-width:${port ? 100 : 68}%;max-height:${port ? 46 : 100}%}
.clip.pip .cv{transform-origin:100% 100%}` : ''}`;
  const js = `
const CLIPS = D.scenes.filter((s) => s.kind === 'clip');
const KINDS = {
  clip(sc, s, e) {
    if (sc.zoom === 'in') tl.fromTo($(sc.id + '-v'), { scale: 1 }, { scale: 1.08, duration: e - s, ease: 'none', immediateRender: false }, s);${layouts.size ? `
    // The speaker is seen full frame first; the layout change runs a quarter of the way in (0.8-2 s).
    const T = s + Math.min(2, Math.max(0.8, (e - s) * 0.25)), cv = $(sc.id + '-cv'), scr = $(sc.id + '-scr');
    if (sc.layout === 'split') {
      tl.fromTo(cv, { clipPath: 'inset(0% 0% 0% 0%)', x: 0, y: 0 }, { clipPath: D.port ? 'inset(25% 0% 25% 0%)' : 'inset(0% 25% 0% 25%)', x: D.port ? 0 : -D.W / 4, y: D.port ? -D.H / 4 : 0, duration: 0.9, ease: XIO, immediateRender: false }, T);
      tl.fromTo(scr, D.port ? { yPercent: 100 } : { xPercent: 100 }, { ...(D.port ? { yPercent: 0 } : { xPercent: 0 }), duration: 0.9, ease: XIO, immediateRender: false }, T);
    } else if (sc.layout === 'pip') {
      tl.fromTo(scr, { opacity: 0, scale: 1.04 }, { opacity: 1, scale: 1, duration: 0.6, immediateRender: false }, T);
      tl.fromTo(cv, { scale: 1, x: 0, y: 0, clipPath: 'inset(0% round 0px)' }, { scale: D.port ? 0.34 : 0.28, x: -50 * U, y: -(D.port ? 420 : 240) * U, clipPath: 'inset(0% round ' + Math.round(64 * U) + 'px)', duration: 0.9, ease: XIO, immediateRender: false }, T);
    }` : ''}
    const l3 = $(sc.id + '-l3');
    if (l3) {
      tl.fromTo(l3, { x: -60 * U, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, immediateRender: false }, s + 0.4)
        .fromTo(l3.querySelector('i'), { scaleY: 0 }, { scaleY: 1, duration: 0.5, immediateRender: false }, s + 0.55);${layouts.has('pip') ? `
      // A picture-in-picture speaker is too small for the lower third: it leaves as the speaker shrinks.
      if (sc.layout === 'pip') tl.to(l3, { x: -40 * U, opacity: 0, duration: 0.4, ease: XI }, T);
      else` : ''}
      if (e - s > 4) tl.to(l3, { x: -40 * U, opacity: 0, duration: 0.4, ease: XI }, Math.min(s + 4.5, e - 0.6));
    }
  },
  card(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05, { y: 20 });
    for (let k = 0; k < sc.n; k++) tl.fromTo($(sc.id + '-w' + k), { yPercent: 110 }, { yPercent: 0, duration: 0.55, ease: X, immediateRender: false }, s + 0.15 + k * 0.07);
    fadeUp(g.querySelector('.cx'), s + 0.5 + sc.n * 0.07, { y: 20 });
    tl.fromTo($(sc.id + '-bar'), { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: XIO, immediateRender: false }, s + 0.4);
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};
// Every frame seeks each visible clip to the matching source time and waits until that frame is on screen.
const seekVideo = (v, to) => new Promise((resolve) => {
  if (Math.abs(v.currentTime - to) < 0.004 && v.readyState >= 2) return resolve();
  const timer = setTimeout(resolve, 1500);
  const done = () => { clearTimeout(timer); resolve(); };
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => done());
  else v.addEventListener('seeked', done, { once: true });
  v.currentTime = to;
});
window.__prepare = async () => {
  await Promise.all(CLIPS.map((c) => new Promise((resolve, reject) => {
    const v = $(c.id + '-v');
    if (v.readyState >= 2) return resolve();
    v.addEventListener('loadeddata', resolve, { once: true });
    v.addEventListener('error', () => reject(new Error('clip ' + c.id + ' could not be loaded')), { once: true });
  })));
  afterSeek = (t) => Promise.all(CLIPS.filter((c) => t >= c.start - 0.4 && t <= c.end + 0.4).map((c) => {
    const v = $(c.id + '-v');
    const len = Number.isFinite(v.duration) ? v.duration : c.end - c.start;
    return seekVideo(v, Math.min(Math.max(t - c.start, 0), Math.max(0, len - 0.04)) + 0.001);
  })).then(() => t);
};`;
  return page({ brand, script, timing, size, title: 'talking-head', css, body: parts.join('\n'), scenes, js });
}
