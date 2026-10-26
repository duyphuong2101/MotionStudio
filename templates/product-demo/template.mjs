import { StudioError } from '../../engine/core.mjs';
import { stripMarks } from '../../engine/marks.mjs';
import { iconSet, TICK, DECOR } from '../../motion-kit/icons.mjs';
import { logoHtml } from '../shared.mjs';
import { page, geometry, h, rgb, hasLogoBug, contentArea, checkBrand } from '../kit.mjs';

export const W = 1080;
export const H = 1920;
const SIZE = { width: W, height: H };

// The layout below spans these rows (px). The camera push (scale 1.08 about the centre, up 60 px over the video) only
// lifts rows above 1710, so the top row stays clear of the corner logo and the bottom row of the captions.
const TOP = 290, BOTTOM = 1620, PUSH = { scale: 1.08, y: -60 };
const SAME = { y: (v) => v, s: (v) => v };

/**
 * Vertical fit: with subtitles on screen the rows and type below the top row are squeezed so the layout ends above
 * the caption band (contentArea). Without subtitles, or when it already fits, it is the identity.
 */
export function fitRows(brand, subtitles) {
  const bottom = H - contentArea(brand, geometry(SIZE)).bottom;
  if (!subtitles || BOTTOM <= bottom) return SAME;
  const k = (bottom - TOP) / (BOTTOM - TOP);
  return { y: (v) => Math.round(TOP + (v - TOP) * k), s: (v) => Math.round(v * k) };
}

function vectorPack(brand, sc) {
  return `<div class="pack"><div class="band"></div>
    ${logoHtml(brand, { onDark: true }) ? `<div class="plogo">${logoHtml(brand, { onDark: true })}</div>` : ''}
    <div class="pname">${h(stripMarks(sc.title))}</div>
    <div class="pline">${h(sc.packLine || '')}</div>
    <div class="psweep" id="${sc.id}-sweep"></div></div>`;
}

function imagePack(sc) {
  const src = `assets/${encodeURIComponent(sc.asset)}`;
  return `<img class="packimg" src="${src}" alt="">
    <div class="sweepmask" style="-webkit-mask-image:url('${src}');mask-image:url('${src}')"><i class="psweep" id="${sc.id}-sweep"></i></div>`;
}

function sceneHtml(sc, brand) {
  const id = sc.id;
  switch (sc.kind) {
    case 'hero':
      return `<div class="g" id="g-${id}">
  <div class="shadow" id="${id}-shadow"></div>
  <div class="packw" id="${id}-pack" data-lint>${sc.asset ? imagePack(sc) : vectorPack(brand, sc)}</div>
  <div class="herotext">
    <div class="ttl" data-lint><span class="ln" id="${id}-ln"><span id="${id}-title">${h(sc.title)}</span></span></div>
    ${sc.subtitle ? `<div class="sub" id="${id}-sub" data-lint>${h(sc.subtitle)}</div>` : ''}
  </div>
</div>`;
    case 'stat':
      return `<div class="g" id="g-${id}">
  <div class="kicker" id="${id}-kicker" data-lint>${h(sc.kicker)}</div>
  <div class="big" id="${id}-big" data-lint><span id="${id}-num">0</span><small>${h(sc.stat.unit ?? '')}</small></div>
  <svg class="ring" id="${id}-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="ringbg"/><circle cx="50" cy="50" r="44" class="ringp" id="${id}-ringp" transform="rotate(-90 50 50)"/></svg>
  <div class="btxt"><div class="chip" id="${id}-chip" data-lint>${h(sc.chip)}</div><div class="bt" id="${id}-text" data-lint>${h(sc.text)}</div></div>
</div>`;
    case 'benefit':
      return `<div class="g" id="g-${id}">
  <div class="kicker" id="${id}-kicker" data-lint>${h(sc.kicker)}</div>
  <svg class="decor" id="${id}-decor" viewBox="0 0 900 620" aria-hidden="true">${(DECOR[sc.decor || 'none'] || []).map((d) => `<path d="${d}"/>`).join('')}</svg>
  <div class="btxt"><div class="chip" id="${id}-chip" data-lint>${h(sc.chip)}</div><div class="bt" id="${id}-text" data-lint>${h(sc.text)}</div></div>
</div>`;
    case 'cta': {
      // With the brand's corner logo on every scene, the closing card leaves its own out.
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      return `<div class="g cta" id="g-${id}">
  ${logo ? `<div class="clogo" id="${id}-logo" data-lint>${logo}</div>` : ''}
  <div class="ctatext">
    <div class="ctitle" id="${id}-title" data-lint>${h(sc.title)}</div>
    <div class="btn cbtn" id="${id}-btn" data-lint>${h(sc.button)}</div>
    ${sc.url ? `<div class="curl" id="${id}-url" data-lint>${h(sc.url)}</div>` : ''}
  </div>
</div>`;
    }
    default:
      throw new StudioError(`Unknown scene kind ${sc.kind}`, 400);
  }
}

function stillTimes(timing) {
  return timing.scenes.map((s, i) => {
    const last = i === timing.scenes.length - 1;
    const t = last ? s.end - 0.15 : Math.max(s.start + 0.8, s.end - 0.6);
    return { id: s.id, t: Math.round(t * 100) / 100 };
  });
}

export function build(args) {
  return page({ ...args, size: SIZE, title: 'product-demo', ...parts(args) });
}

/** css, body, scenes and js for page(). The frame is always 1080x1920; subtitles show only when the brand sets them. */
export function parts({ brand, script, timing, icons }) {
  const ICONS = iconSet(icons);
  const { c, f } = checkBrand(brand);
  const subtitles = !!brand.subtitles;
  const { y, s: z } = fitRows(brand, subtitles);
  const scenes = script.scenes.map((sc) => ({
    id: sc.id, kind: sc.kind,
    icon: sc.icon || (sc.kind === 'cta' ? 'heart' : null), check: !!sc.check,
    stat: sc.stat ? { value: Number(sc.stat.value) } : null,
    // The closing card sits on the brand primary the wipe brings in.
    ...(sc.kind === 'cta' ? { dark: true } : {}),
  }));
  const usedIcons = Object.fromEntries([...new Set(scenes.map((s) => s.icon).filter(Boolean))].map((k) => [k, ICONS[k]]));
  const body = script.scenes.filter((s) => s.kind !== 'cta').map((s) => sceneHtml(s, brand)).join('\n');
  const cta = script.scenes.filter((s) => s.kind === 'cta').map((s) => sceneHtml(s, brand)).join('\n');
  const firstIcon = scenes.find((s) => s.icon)?.icon || 'drop';
  const pack = z(760);
  const wipeAt = `540px ${y(900)}px`;
  const css = `
:root{--display:"${f.display}",Georgia,serif}
#stage{background:var(--bg)}
.brandlogo{display:block;max-width:420px;object-fit:contain;object-position:left center}
.plogo .brandlogo{height:60px}.clogo .brandlogo{height:72px}
#wash{position:absolute;inset:0;background:radial-gradient(900px 900px at 50% 42%,rgba(${rgb(c.primary2)},.10),transparent 70%)}
#cam{position:absolute;inset:0;transform-origin:50% 50%;perspective:2400px}
.g{position:absolute;inset:0;visibility:hidden}
.packw{position:absolute;left:${540 - pack / 2}px;top:${y(330)}px;width:${pack}px;height:${pack}px;transform-style:preserve-3d;transform-origin:50% 50%}
.packimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 50px 60px rgba(${rgb(c.primary)},.30))}
.sweepmask{position:absolute;inset:0;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;overflow:hidden}
.psweep{position:absolute;top:-20%;bottom:-20%;left:0;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-14deg)}
.pack{position:absolute;inset:${z(40)}px;border-radius:28px;background:linear-gradient(160deg,var(--primary2),var(--primary));box-shadow:0 60px 100px rgba(${rgb(c.primary)},.38);overflow:hidden}
.pack .band{position:absolute;left:0;right:0;top:${z(120)}px;height:${z(140)}px;background:var(--secondary)}
.pack .plogo{position:absolute;left:56px;top:${z(40)}px;font-weight:800;font-size:${z(50)}px;color:var(--on)}
.pack .pname{position:absolute;left:56px;right:40px;top:${z(300)}px;font-weight:800;font-size:${z(96)}px;line-height:1;color:var(--on)}
.pack .pline{position:absolute;left:56px;top:${z(520)}px;font-size:${z(44)}px;color:var(--on);opacity:.85}
.shadow{position:absolute;left:${540 - z(300)}px;top:${y(1090)}px;width:${z(600)}px;height:${z(70)}px;border-radius:50%;background:radial-gradient(closest-side,rgba(${rgb(c.primary)},.35),transparent)}
.herotext{position:absolute;left:90px;top:${y(1200)}px;width:900px;display:flex;flex-direction:column;gap:${z(26)}px}
.ttl{font-family:var(--display);font-weight:600;font-size:${z(104)}px;line-height:1.04;color:var(--primary);letter-spacing:-.02em}
.ln{display:block;overflow:hidden;padding-bottom:6px}.ln>span{display:block}
.sub{font-size:${z(52)}px;line-height:1.3;color:var(--muted)}
.kicker{position:absolute;left:90px;top:${y(290)}px;font-size:${z(34)}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.big{position:absolute;left:90px;top:${y(340)}px;font-family:var(--display);font-weight:600;font-size:${z(230)}px;line-height:1;color:var(--primary);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.big small{font-size:${z(110)}px;letter-spacing:0;margin-left:10px}
.ring{position:absolute;left:${540 - z(300)}px;top:${y(600)}px;width:${z(600)}px;height:${z(600)}px;overflow:visible}
.ring circle{fill:none;stroke-width:5}.ringbg{stroke:rgba(${rgb(c.primary)},.12)}.ringp{stroke:var(--primary);stroke-linecap:round}
.decor{position:absolute;left:90px;top:${y(590)}px;width:900px;height:${z(620)}px;overflow:visible}
.decor path{fill:none;stroke:var(--primary2);stroke-width:6;stroke-linecap:round}
.btxt{position:absolute;left:90px;top:${y(1290)}px;width:900px;display:flex;flex-direction:column;align-items:flex-start;gap:${z(26)}px}
.chip{font-size:${z(40)}px;font-weight:600;color:var(--primary);background:#fff;border:4px solid var(--primary);padding:${z(14)}px 34px;border-radius:999px;white-space:nowrap}
.bt{font-size:${z(56)}px;line-height:1.25;color:var(--ink)}
#icon{position:absolute;z-index:6;left:${540 - z(250)}px;top:${y(620)}px;width:${z(500)}px;height:${z(560)}px;overflow:visible;transform-origin:50% 50%}
#shape{fill:none;stroke:var(--primary);stroke-width:4.5;stroke-linejoin:round}
#fill{fill:var(--secondary)}
#tick{fill:none;stroke:#fff;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}
#wipe{position:absolute;inset:0;z-index:5;background:var(--primary);clip-path:circle(0px at ${wipeAt})}
.cta{z-index:7;color:var(--on)}
.clogo{position:absolute;left:90px;top:${y(200)}px;font-weight:800;font-size:58px}
.ctatext{position:absolute;left:90px;top:${y(1160)}px;width:900px;display:flex;flex-direction:column;align-items:flex-start;gap:${z(40)}px}
.ctitle{font-family:var(--display);font-weight:600;font-size:${z(110)}px;line-height:1.05;letter-spacing:-.02em}
.cbtn{display:block;background:var(--secondary);color:var(--ink);font-weight:800;font-size:${z(54)}px;padding:${z(36)}px 64px;border-radius:999px;transform-origin:0 50%}
.curl{font-size:${z(42)}px;opacity:.85}`;
  const html = `<div id="wash"></div>
  <div id="cam">
${body}
    <svg id="icon" viewBox="0 0 100 112" aria-hidden="true"><path id="shape" d="${ICONS[firstIcon]}"/><path id="fill" d="${ICONS[firstIcon]}"/><path id="tick" d="${TICK}"/></svg>
    <div id="wipe"></div>
${cta}
  </div>`;
  const js = `
const PXI = 'power3.in';
const ICON_PLACE = { stat: { scale: 0.52, y: 0 }, benefit: { scale: 1, y: 0 }, cta: { scale: 0.74, y: ${-z(170)} } };
gsap.set('#icon', { autoAlpha: 0, transformOrigin: '50% 50%' });
gsap.set(['#shape'], { drawSVG: '0%' });
gsap.set('#fill', { opacity: 0 });
gsap.set('#tick', { drawSVG: '0%', autoAlpha: 0 });
tl.fromTo('#cam', { scale: 1, y: 0 }, { scale: ${PUSH.scale}, y: ${PUSH.y}, duration: D.duration, ease: 'none' }, 0);
let iconShown = false;
function demoScene(sc, s, e, c) {
  const out = e - 0.4, last = c.last, id = sc.id;
  const el = (suffix) => $(id + '-' + suffix);
  const fadeIn = (node, at, d = 0.55) => fadeUp(node, at, { y: 30, d });
  const fadeOut = (nodes, at) => { nodes = nodes.filter(Boolean); if (nodes.length && !last) tl.to(nodes, { y: -24, opacity: 0, duration: 0.35, ease: PXI }, at); };
  if (sc.icon && sc.kind !== 'hero') {
    const place = ICON_PLACE[sc.kind], path = D.icons[sc.icon];
    if (!iconShown) {
      iconShown = true;
      tl.set('#icon', { autoAlpha: 1, scale: place.scale, y: place.y }, s - 0.35)
        .set(['#shape', '#fill'], { attr: { d: path } }, s - 0.35)
        .fromTo('#shape', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.1 }, s - 0.35)
        .set('#shape', { strokeDasharray: 'none' }, s + 0.8)
        .fromTo('#fill', { opacity: 0 }, { opacity: 1, duration: 0.5 }, s + 0.45);
    } else {
      tl.to(['#shape', '#fill'], { morphSVG: path, duration: 0.9, ease: XIO }, s - 0.15)
        .to('#icon', { scale: place.scale, y: place.y, duration: 0.9, ease: XIO }, s - 0.15);
    }
    if (sc.kind === 'cta') tl.to('#shape', { stroke: D.onPrimary, duration: 0.6 }, s - 0.1);
    if (sc.check) {
      tl.set('#tick', { autoAlpha: 1 }, s + 0.9).fromTo('#tick', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6 }, s + 0.9);
      if (!last) tl.to('#tick', { autoAlpha: 0, duration: 0.3 }, out);
    }
    if (sc.kind === 'benefit' && !last) tl.to('#icon', { rotation: -3, duration: (out - s - 0.8) / 2, ease: 'sine.inOut', yoyo: true, repeat: 1 }, s + 0.8);
  }
  if (sc.kind === 'hero') {
    const pack = el('pack'), shadow = el('shadow'), reveal = cue(sc, 0);
    tl.fromTo(pack, { opacity: 0, y: 60, scale: 1.06, rotateY: -14, rotateX: 6 }, { opacity: 1, y: 0, scale: 1, duration: 1.2 }, s)
      .to(pack, { rotateY: 10, rotateX: -4, duration: Math.max(1, out - s), ease: 'sine.inOut' }, s)
      .fromTo(shadow, { opacity: 0, scaleX: 0.7 }, { opacity: 1, scaleX: 1, duration: 1.2 }, s)
      .fromTo(el('sweep'), { xPercent: -160 }, { xPercent: 300, duration: 1.4, ease: XIO }, s + 0.9)
      .fromTo(el('title'), { yPercent: 110 }, { yPercent: 0, duration: 0.8 }, reveal);
    // The title rises out of a clipped line; once it is up, a mark drawn round it is not clipped.
    if (el('title').querySelector('.mk')) tl.set(el('ln'), { overflow: 'visible' }, reveal + 0.8);
    fadeIn(el('sub'), cue(sc, 0.45), 0.7);
    if (!last) {
      // The pack, its shadow and the title are gone by the scene end, so the next scene starts on a clear frame.
      if (el('title').querySelector('.mk')) tl.set(el('ln'), { overflow: 'hidden' }, out);
      tl.to(pack, { y: 80, scale: 0.28, rotateY: 0, rotateX: 0, opacity: 0, duration: 0.5, ease: PXI }, out - 0.1)
        .to(shadow, { opacity: 0, duration: 0.4 }, out - 0.1)
        .to(el('title'), { yPercent: -110, duration: 0.4, ease: PXI }, out);
      fadeOut([el('sub')], out);
    }
  }
  if (sc.kind === 'stat') {
    const v = sc.stat.value, snap = Number.isInteger(v) ? 1 : 0.1;
    fadeIn(el('big'), s);
    fadeIn(el('kicker'), s + 0.08);
    tl.fromTo(el('num'), { innerText: 0 }, { innerText: v, snap: { innerText: snap }, duration: Math.min(2.6, (e - s) * 0.55), ease: 'power2.out' }, s + 0.1)
      .fromTo(el('ring'), { opacity: 0, scale: 0.9, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.5 }, s + 0.1)
      .fromTo(el('ringp'), { drawSVG: '0%' }, { drawSVG: '100%', duration: Math.min(2.8, (e - s) * 0.6), ease: 'power2.out' }, s + 0.15);
    fadeIn(el('chip'), cue(sc, 0.15));
    fadeIn(el('text'), cue(sc, 0.4), 0.6);
    fadeOut([el('kicker'), el('big'), el('chip'), el('text')], out);
    if (!last) tl.to(el('ring'), { opacity: 0, scale: 1.15, duration: 0.45, ease: PXI }, out);
  }
  if (sc.kind === 'benefit') {
    fadeIn(el('kicker'), s + 0.1);
    const paths = el('decor') ? el('decor').querySelectorAll('path') : [];
    if (paths.length) {
      tl.fromTo(paths, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.2, stagger: 0.15 }, s + 0.25);
      if (!last) tl.to(paths, { drawSVG: '100% 100%', duration: 0.5, ease: PXI }, out);
    }
    fadeIn(el('chip'), cue(sc, 0.15));
    fadeIn(el('text'), cue(sc, 0.45), 0.6);
    fadeOut([el('kicker'), el('chip'), el('text')], out);
  }
  if (sc.kind === 'cta') {
    tl.to('#wipe', { clipPath: 'circle(1500px at ${wipeAt})', duration: 1.0, ease: XIO }, s - 0.25);
    fadeIn(el('logo'), s + 0.1);
    fadeIn(el('title'), cue(sc, 0), 0.7);
    tl.fromTo(el('btn'), { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.6)' }, s + 0.9)
      .to(el('btn'), { scale: 1.04, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: 1 }, s + 1.5);
    fadeIn(el('url'), cue(sc, 0.7));
  }
}
const KINDS = { hero: demoScene, stat: demoScene, benefit: demoScene, cta: demoScene };`;
  return {
    css, body: html, scenes, js, subtitles,
    extra: { icons: usedIcons, onPrimary: c.onPrimary },
    stills: stillTimes(timing),
  };
}
