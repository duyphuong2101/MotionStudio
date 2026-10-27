import { page, geometry, h } from '../kit.mjs';
import { logoHtml, logoFile } from '../shared.mjs';

export function build({ brand, script, timing, size }) {
  const g = geometry(size);
  const { px, port } = g;
  const sc = script.scenes[0];
  const id = sc.id;
  const style = sc.style || 'draw';
  const dark = (sc.theme || 'dark') === 'dark';
  const file = logoFile(brand, dark);
  const text = brand.logoText || brand.name || '';
  const letters = [...text];
  const logo = file
    ? logoHtml(brand, { onDark: dark, cls: 'lg-img', fallbackText: false })
    : `<div class="lg-txt" data-lint>${letters.map((ch, k) => `<span id="${id}-c${k}">${ch === ' ' ? '&nbsp;' : h(ch)}</span>`).join('')}</div>`;
  const rays = Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    const r1 = 120, r2 = 210 + (k % 2) * 50;
    return `<path id="${id}-ray${k}" d="M${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)} L${(Math.cos(a) * r2).toFixed(1)} ${(Math.sin(a) * r2).toFixed(1)}"/>`;
  }).join('');
  const body = `<div class="sc fill ${dark ? 'dark' : ''}" id="g-${id}">
    <div class="panel p1" id="${id}-p1"></div><div class="panel p2" id="${id}-p2"></div>
    <svg class="fx" viewBox="-300 -300 600 600" aria-hidden="true">
      <circle id="${id}-ring" cx="0" cy="0" r="230"/><circle id="${id}-ring2" cx="0" cy="0" r="262"/>
      <g class="rays">${rays}</g></svg>
    <div class="mark"><div class="lg" id="${id}-logo">${logo}</div>
      <div class="line" id="${id}-line"></div>
      ${sc.tagline ? `<div class="tag" id="${id}-tag" data-lint>${h(sc.tagline)}</div>` : ''}
      ${sc.url ? `<div class="url" id="${id}-url" data-lint>${h(sc.url)}</div>` : ''}</div></div>`;
  const fx = px(port ? 1000 : 900);
  const css = `
#stage{background:${dark ? 'var(--primary)' : 'radial-gradient(circle at 50% 45%,#fff,var(--bg))'}}
#bgc{opacity:${dark ? 0.35 : 1}}
.panel{position:absolute;inset:0;transform:translateX(-101%)}.p1{background:var(--secondary)}.p2{background:var(--primary2)}
.fx{position:absolute;left:50%;top:50%;width:${fx};height:${fx};transform:translate(-50%,-50%);overflow:visible}
.fx circle{fill:none;stroke:var(--secondary);stroke-width:5}#${id}-ring2{stroke-width:2;opacity:.5}
.rays path{stroke:var(--secondary);stroke-width:7;stroke-linecap:round}
.mark{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${px(34)};text-align:center}
.lg{display:flex;justify-content:center}
.lg-img{display:block;height:${px(port ? 220 : 170)};width:auto;max-width:${px(port ? 760 : 640)};object-fit:contain}
.lg-txt{font-family:var(--display);font-weight:900;letter-spacing:-.02em;font-size:${px(port ? 170 : 150)};line-height:1;white-space:nowrap}.lg-txt span{display:inline-block}
.line{width:${px(220)};height:${px(8)};border-radius:4px;background:var(--secondary);transform:scaleX(0)}
.tag{font-size:${px(port ? 52 : 46)};font-weight:600;letter-spacing:.04em;opacity:.92}
.url{font-size:${px(34)};opacity:.7;letter-spacing:.08em}`;
  const scenes = [{ id, kind: 'reveal', style, n: file ? 0 : letters.length }];
  const js = `
const KINDS = {
  reveal(sc, s, e) {
    const logo = $(sc.id + '-logo');
    const rays = [...document.querySelectorAll('.rays path')];
    gsap.set(rays, { drawSVG: '0% 0%' });
    gsap.set(['#' + sc.id + '-ring', '#' + sc.id + '-ring2'], { drawSVG: '0%', rotation: -90, transformOrigin: '50% 50%' });
    let at = s + 0.2;
    if (sc.style === 'slide') {
      tl.fromTo($(sc.id + '-p1'), { xPercent: -101 }, { xPercent: 101, duration: 0.9, ease: XIO, immediateRender: false }, s + 0.05)
        .fromTo($(sc.id + '-p2'), { xPercent: -101 }, { xPercent: 101, duration: 0.9, ease: XIO, immediateRender: false }, s + 0.2);
      at = s + 0.6;
      tl.fromTo(logo, { clipPath: 'inset(0 100% 0 0)', x: -60 * U }, { clipPath: 'inset(0 0% 0 0)', x: 0, duration: 0.8, ease: X, immediateRender: false }, at);
    } else if (sc.style === 'burst') {
      tl.fromTo(rays, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.45, ease: X, stagger: 0.015, immediateRender: false }, s + 0.25)
        .to(rays, { drawSVG: '100% 100%', duration: 0.5, ease: XI, stagger: 0.015 }, s + 0.75)
        // A spent ray is a zero-length stroke whose round cap still shows as a dot (two sat on the tagline): hide them.
        .set(rays, { opacity: 0 }, s + 0.75 + 0.5 + 15 * 0.015);
      at = s + 0.45;
      tl.fromTo(logo, { scale: 0.2, opacity: 0, rotation: -8 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.8, ease: 'back.out(2)', immediateRender: false }, at);
    } else {
      draw($(sc.id + '-ring'), s + 0.1, 1.1, { ease: XIO });
      draw($(sc.id + '-ring2'), s + 0.3, 1.2, { ease: XIO });
      tl.to(['#' + sc.id + '-ring', '#' + sc.id + '-ring2'], { rotation: 0, duration: e - s, ease: 'none' }, s);
      at = s + 0.7;
      tl.fromTo(logo, { clipPath: 'circle(0% at 50% 50%)', scale: 1.08 }, { clipPath: 'circle(75% at 50% 50%)', scale: 1, duration: 0.9, ease: X, immediateRender: false }, at);
    }
    for (let k = 0; k < sc.n; k++) tl.fromTo($(sc.id + '-c' + k), { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.6)', immediateRender: false }, at + 0.05 + k * 0.04);
    tl.fromTo($(sc.id + '-line'), { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: XIO, immediateRender: false }, at + 0.7);
    fadeUp($(sc.id + '-tag'), at + 0.85, { y: 24 });
    fadeUp($(sc.id + '-url'), at + 1.1, { y: 16 });
    tl.to(logo, { scale: 1.03, duration: Math.max(0.5, e - at - 1.2), ease: 'sine.inOut' }, at + 1.0);
  },
};`;
  return page({ brand, script, timing, size, title: 'logo-reveal', css, body, scenes, js, corner: false });
}
