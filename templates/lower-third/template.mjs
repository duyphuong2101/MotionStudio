import { page, geometry, h } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';

// Overlays for other editors: a transparent page, rendered with an alpha channel (beats.json "alpha": true).
export function build({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, padX, port } = g;
  const scenes = [];
  const parts = [];
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'lower') {
      parts.push(`<div class="sc fill" id="g-${id}"><div class="l3" id="${id}-box"><i id="${id}-bar"></i><div>
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="ln" id="${id}-n" data-lint>${h(sc.name)}</div>
        ${sc.role ? `<div class="lr" id="${id}-r" data-lint>${h(sc.role)}</div>` : ''}</div></div></div>`);
      scenes.push({ id, kind: 'lower' });
    } else if (sc.kind === 'caption') {
      parts.push(`<div class="sc fill" id="g-${id}"><div class="cap" id="${id}-box" data-lint>${h(sc.text)}</div></div>`);
      scenes.push({ id, kind: 'caption' });
    } else if (sc.kind === 'bug') {
      const logo = logoHtml(brand, { onDark: sc.theme === 'dark' });
      parts.push(`<div class="sc fill" id="g-${id}"><div class="bug${sc.theme === 'dark' ? ' dk' : ''}" id="${id}-box">${logo}${sc.text ? `<span data-lint>${h(sc.text)}</span>` : ''}</div></div>`);
      scenes.push({ id, kind: 'bug' });
    }
  }
  const css = `
.l3{position:absolute;left:${padX(port ? 70 : 110)};bottom:${px(port ? 420 : 150)};display:flex;align-items:stretch;gap:${px(20)};background:rgba(255,255,255,.97);border-radius:${px(16)};padding:${px(20)} ${px(36)} ${px(20)} ${px(20)};box-shadow:0 ${px(14)} ${px(40)} rgba(0,0,0,.28);max-width:calc(100% - ${px(220)})}
.l3 i{width:${px(10)};border-radius:${px(5)};background:var(--secondary);transform-origin:50% 100%}
.l3 .kick{font-size:${px(24)}}.ln{font-family:var(--display);font-weight:800;font-size:${px(port ? 50 : 46)};color:var(--ink);white-space:nowrap;line-height:1.1}
.lr{font-size:${px(32)};color:var(--muted);white-space:nowrap}
.cap{position:absolute;left:50%;bottom:${px(port ? 420 : 120)};transform:translateX(-50%);max-width:calc(100% - ${px(220)});background:rgba(15,23,42,.84);color:#fff;font-weight:700;font-size:${px(port ? 46 : 42)};line-height:1.3;padding:${px(16)} ${px(30)};border-radius:${px(14)};text-align:center}
.bug{position:absolute;right:${padX(80)};top:${px(port ? 140 : 70)};display:flex;align-items:center;gap:${px(16)};background:rgba(255,255,255,.92);border-radius:${px(14)};padding:${px(14)} ${px(22)}}
.bug.dk{background:rgba(15,23,42,.8);color:#fff}.bug .brandlogo{height:${px(52)};max-width:${px(260)}}.bug .txt{font-weight:800;font-size:${px(34)}}.bug span{font-weight:700;font-size:${px(30)}}`;
  const js = `
// In, hold, out: everything leaves before the scene ends, so the clip cuts cleanly in an editor.
const outAt = (s, e) => Math.max(s + 1.2, e - 0.55);
const KINDS = {
  lower(sc, s, e) {
    const box = $(sc.id + '-box');
    tl.fromTo(box, { x: -60 * U, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, immediateRender: false }, s + 0.1);
    tl.fromTo($(sc.id + '-bar'), { scaleY: 0 }, { scaleY: 1, duration: 0.5, immediateRender: false }, s + 0.2);
    fadeUp($(sc.id + '-n'), s + 0.25, { y: 16, d: 0.45 }); fadeUp($(sc.id + '-r'), s + 0.38, { y: 14, d: 0.45 });
    tl.to(box, { x: -60 * U, opacity: 0, duration: 0.45, ease: XI }, outAt(s, e));
  },
  caption(sc, s, e) {
    const box = $(sc.id + '-box');
    tl.fromTo(box, { y: 30 * U, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, immediateRender: false }, s + 0.1);
    tl.to(box, { y: 20 * U, opacity: 0, duration: 0.4, ease: XI }, outAt(s, e));
  },
  bug(sc, s, e) {
    const box = $(sc.id + '-box');
    tl.fromTo(box, { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)', immediateRender: false }, s + 0.1);
    tl.to(box, { opacity: 0, duration: 0.4 }, outAt(s, e));
  },
};`;
  return page({ brand, script, timing, size, title: 'lower-third', css, body: parts.join('\n'), scenes, js, subtitles: false, particles: false, transparent: true });
}
