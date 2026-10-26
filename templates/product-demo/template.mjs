import { StudioError } from '../../engine/core.mjs';
import { stripMarks } from '../../engine/marks.mjs';
import { iconSet, TICK, DECOR } from '../../motion-kit/icons.mjs';
import { logoHtml } from '../shared.mjs';
import { page, geometry, h, rgb, hasLogoBug, contentArea, checkBrand } from '../kit.mjs';
import { modelCanvas, hasModels } from '../model3d.mjs';

const PORT = { width: 1080, height: 1920 };
// The vector pack's inner sizes are drawn for this pack width and scale with the layout's pack.
const PACK_DESIGN = 760;

/**
 * The 9:16 rows, columns and sizes in 1080 units. `top`/`bottom`: the rows fitRows squeezes between so the layout ends
 * above the caption band. `push`: the camera's zoom about the centre and rise (px) over the video. The pack, ring,
 * icon and wipe sit on x = packX / iconX; kicker, number, chip, text and the closing card start at textX.
 */
const PORT_LAYOUT = {
  top: 290, bottom: 1620, push: { scale: 1.08, y: -60 },
  packX: 540, pack: 760, packTop: 330, shadow: [600, 70],
  heroX: 90, heroW: 900, heroTop: 1200, heroH: 0,
  textX: 90, textW: 900, kicker: 290, big: 340, btxt: 1290, clogo: 200, ctatext: 1160,
  iconX: 540, ring: 600, ringTop: 600, icon: [500, 560], iconTop: 620, decor: [900, 620], decorTop: 590, ctaIconY: 170, wipeR: 1500,
  type: { ttl: 104, sub: 52, kicker: 34, big: 230, small: 110, chip: 40, bt: 56, ctitle: 110, cbtn: 54, curl: 42 },
};

/**
 * 16:9 (`side`: pack, ring and icon in a left column, text in a right one) and 1:1 / 4:5 (stacked): design sizes that
 * flowLayout centres between the corner logo and the caption band, scaled down when the area is shorter than the
 * tallest scene. The camera push stays small so the edge rows keep clear of the logo and the safe area.
 */
const FLOW = {
  land: {
    side: true, push: { scale: 1.03, y: -10 }, packX: 520, packMax: 640, iconX: 520, textX: 950, textW: 860, gap: 30,
    ring: 560, icon: [460, 516], decor: [820, 566],
    type: { ttl: 100, sub: 48, kicker: 34, big: 230, small: 110, chip: 40, bt: 52, ctitle: 96, cbtn: 52, curl: 40 },
  },
  square: {
    side: false, push: { scale: 1.03, y: -10 }, packX: 540, packMax: 560, iconX: 540, textX: 90, textW: 900, gap: 28,
    ring: 280, icon: [280, 314], decor: [760, 524],
    type: { ttl: 76, sub: 36, kicker: 30, big: 150, small: 72, chip: 34, bt: 46, ctitle: 76, cbtn: 44, curl: 34 },
  },
};
// The closing card's icon scale (ICON_PLACE.cta in the page); the pack shadow's width and height per pack width; the
// closing card's own logo with its gap, when the brand has no corner logo.
const CTA_ICON = 0.74, SHADOW = [0.78, 0.09], CARD_LOGO = 100;
// model3d fits a model's bounding sphere into its canvas, so a flat or boxy product fills only part of it: the canvas
// reaches this far past the pack window (centred, fixed at build time) so the model fills the window like a pack image.
const MODEL_GROW = 1.35;

/** A 16:9, 1:1 or 4:5 layout: each scene's block centred in the content area, in final px (no fitRows step). */
function flowLayout(D, g, brand) {
  const A = contentArea(brand, g), top = A.top, bottom = g.H / g.U - A.bottom, mid = (top + bottom) / 2;
  const logo = !hasLogoBug(brand) && logoHtml(brand, { onDark: true }) ? CARD_LOGO : 0;
  // Block heights at scale k, from one kicker line, a chip (padding and border 36, gap 26) over two text lines, the
  // card (two title lines, gaps 2 × 40, button padding 72, the url) and the hero's two title lines and subtitle.
  const sized = (k) => {
    const r = (v) => Math.round(v * k);
    const T = Object.fromEntries(Object.entries(D.type).map(([n, v]) => [n, r(v)]));
    const s = { T, gap: r(D.gap), ring: r(D.ring), icon: D.icon.map(r), decor: D.decor.map(r), packMax: r(D.packMax) };
    s.kick = Math.round(T.kicker * 1.2);
    s.btxt = Math.round(T.chip * 1.2 + 62 + T.bt * 2.5);
    s.card = Math.round(T.ctitle * 2.1 + 80 + T.cbtn + 72 + T.curl * 1.2);
    s.heroText = Math.round(T.ttl * 2.08 + 26 + T.sub * 1.3);
    s.ctaIcon = Math.round(s.icon[1] * CTA_ICON);
    s.stat = D.side ? s.kick + 16 + T.big + 36 + s.btxt : s.kick + 12 + T.big + s.gap + s.ring + s.gap + s.btxt;
    s.benefit = s.kick + s.gap + (D.side ? 0 : s.icon[1] + s.gap) + s.btxt;
    s.cta = D.side ? s.card : logo + s.ctaIcon + s.gap + s.card;
    s.tallest = Math.max(s.stat, s.benefit, s.cta, ...(D.side ? [s.ring, s.decor[1]] : []));
    return s;
  };
  const s = sized(Math.min(1, (bottom - top) / sized(1).tallest)), { T, gap, ring, icon, decor } = s;
  // The top row of a block of height h centred in the area.
  const at = (h) => Math.max(top, Math.round(mid - h / 2));
  // The pack as large as the area allows with its shadow and, stacked, the title under it.
  const under = D.side ? 0 : gap + s.heroText;
  const pack = Math.round(Math.min(s.packMax, (bottom - top - under) / (1 + SHADOW[1])));
  const shadow = [2 * Math.round((pack * SHADOW[0]) / 2), Math.round(pack * SHADOW[1])];
  const packTop = at(pack + shadow[1] + under);
  const L = { push: D.push, packX: D.packX, pack, packTop, shadow, heroX: D.textX, heroW: D.textW, textX: D.textX, textW: D.textW, iconX: D.iconX, ring, icon, decor, type: T };
  const stat = at(s.stat), ben = at(s.benefit);
  if (D.side) {
    // Pack and title, ring or icon and text, icon and card: each pair on the area's centre line.
    return Object.assign(L, {
      heroTop: packTop, heroH: pack,
      kicker: stat, big: stat + s.kick + 16, btxt: stat + s.kick + 16 + T.big + 36, bKicker: ben, bBtxt: ben + s.kick + gap,
      ringTop: Math.round(mid - ring / 2), iconTop: Math.round(mid - icon[1] / 2), decorTop: Math.round(mid - decor[1] / 2),
      clogo: top, ctatext: top, ctaH: bottom - top, ctaIconY: 0, wipeY: Math.round(mid),
    });
  }
  // Stacked: kicker and number over the ring over the text; kicker over the icon over the text; icon over the card.
  // The icon box sits where a benefit shows it; stat and cta move it by ICON_PLACE y.
  const cta = at(s.cta), ringTop = stat + s.kick + 12 + T.big + gap;
  const benIcon = ben + s.kick + gap + icon[1] / 2, statIcon = ringTop + ring / 2, ctaIcon = cta + logo + s.ctaIcon / 2;
  return Object.assign(L, {
    heroTop: packTop + pack + shadow[1] + gap, heroH: 0,
    kicker: stat, big: stat + s.kick + 12, ringTop, btxt: ringTop + ring + gap, bKicker: ben, bBtxt: ben + s.kick + gap + icon[1] + gap,
    iconTop: Math.round(benIcon - icon[1] / 2), decorTop: Math.round(benIcon - decor[1] / 2),
    clogo: cta, ctatext: cta + logo + s.ctaIcon + gap, ctaH: 0,
    statY: Math.round(statIcon - benIcon), ctaIconY: -Math.round(ctaIcon - benIcon), wipeY: Math.round(ctaIcon),
  });
}

const SAME = { y: (v) => v, s: (v) => v };

/**
 * Vertical fit of the 9:16 layout: with subtitles on screen the rows and type below the top row are squeezed so the
 * layout ends above the caption band (contentArea). Without subtitles, when it already fits, or in another format
 * (flowLayout already fits those) it is the identity.
 */
export function fitRows(brand, subtitles, size = PORT) {
  const g = geometry(size), L = PORT_LAYOUT;
  if (!g.port) return SAME;
  const bottom = g.H / g.U - contentArea(brand, g).bottom;
  if (!subtitles || L.bottom <= bottom) return SAME;
  const k = (bottom - L.top) / (L.bottom - L.top);
  return { y: (v) => Math.round(L.top + (v - L.top) * k), s: (v) => Math.round(v * k) };
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

/** The hero's pack window: a turning 3D model when the scene names one, else the pack image or the drawn pack. */
function packWindow(sc, brand, timing) {
  if (!sc.model) return sc.asset ? imagePack(sc) : vectorPack(brand, sc);
  const t = timing?.scenes.find((x) => x.id === sc.id) || { start: 0, end: 0 };
  return modelCanvas(sc.model, t, sc.spin);
}

function sceneHtml(sc, brand, timing) {
  const id = sc.id;
  switch (sc.kind) {
    case 'hero':
      return `<div class="g" id="g-${id}">
  <div class="shadow" id="${id}-shadow"></div>
  <div class="packw" id="${id}-pack" data-lint>${packWindow(sc, brand, timing)}</div>
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

// The hero's entrance: the pack turns in 3D and a light sweeps over it; a 3D model moves by itself, so its window only
// fades in, untransformed.
const PACK_IN = `tl.fromTo(pack, { opacity: 0, y: 60, scale: 1.06, rotateY: -14, rotateX: 6 }, { opacity: 1, y: 0, scale: 1, duration: 1.2 }, s)
      .to(pack, { rotateY: 10, rotateX: -4, duration: Math.max(1, out - s), ease: 'sine.inOut' }, s)
      .fromTo(shadow, { opacity: 0, scaleX: 0.7 }, { opacity: 1, scaleX: 1, duration: 1.2 }, s)
      .fromTo(el('sweep'), { xPercent: -160 }, { xPercent: 300, duration: 1.4, ease: XIO }, s + 0.9)`;
const MODEL_IN = "tl.fromTo(pack, { opacity: 0 }, { opacity: 1, duration: 0.8 }, s)";

export function build(args) {
  const size = args.size || PORT;
  return page({ ...args, size, title: 'product-demo', ...parts({ ...args, size }) });
}

/** css, body, scenes and js for page(), laid out for the frame (9:16 when none is given); subtitles show only when the brand sets them. */
export function parts({ brand, script, timing, icons, size = PORT }) {
  const ICONS = iconSet(icons);
  const { c, f } = checkBrand(brand);
  const g = geometry(size), L = g.port ? PORT_LAYOUT : flowLayout(g.land ? FLOW.land : FLOW.square, g, brand), T = L.type;
  const subtitles = !!brand.subtitles;
  const { y, s: z } = fitRows(brand, subtitles, size);
  // Sizes inside the drawn pack: zq for rows and type that also follow the fit, q for the rest.
  const q = (v) => Math.round((v * L.pack) / PACK_DESIGN), zq = (v) => z(q(v));
  const scenes = script.scenes.map((sc) => ({
    id: sc.id, kind: sc.kind,
    icon: sc.icon || (sc.kind === 'cta' ? 'heart' : null), check: !!sc.check,
    stat: sc.stat ? { value: Number(sc.stat.value) } : null,
    // The closing card sits on the brand primary the wipe brings in.
    ...(sc.kind === 'cta' ? { dark: true } : {}),
  }));
  const usedIcons = Object.fromEntries([...new Set(scenes.map((s) => s.icon).filter(Boolean))].map((k) => [k, ICONS[k]]));
  const body = script.scenes.filter((s) => s.kind !== 'cta').map((s) => sceneHtml(s, brand, timing)).join('\n');
  const cta = script.scenes.filter((s) => s.kind === 'cta').map((s) => sceneHtml(s, brand, timing)).join('\n');
  const model = hasModels(body);
  const firstIcon = scenes.find((s) => s.icon)?.icon || 'drop';
  const pack = z(L.pack);
  // The wipe into the closing card grows from the icon's centre until it covers the farthest corner.
  const wipeY = L.wipeY ?? y(L.iconTop + L.icon[1] / 2);
  // A model fills a fixed square past the pack window; the model draws its own contact shadow, so the pack's is hidden.
  const mbox = Math.round(pack * MODEL_GROW), moff = Math.round((pack - mbox) / 2);
  const wipeAt = `${L.iconX}px ${wipeY}px`;
  const wipeR = L.wipeR || Math.ceil(Math.hypot(Math.max(L.iconX, g.W / g.U - L.iconX), Math.max(wipeY, g.H / g.U - wipeY)));
  const css = `
:root{--display:"${f.display}",Georgia,serif}
#stage{background:var(--bg)}
.brandlogo{display:block;max-width:420px;object-fit:contain;object-position:left center}
.plogo .brandlogo{height:${q(60)}px}.clogo .brandlogo{height:72px}
#wash{position:absolute;inset:0;background:radial-gradient(900px 900px at 50% 42%,rgba(${rgb(c.primary2)},.10),transparent 70%)}
#cam{position:absolute;inset:0;transform-origin:50% 50%;perspective:2400px}
.g{position:absolute;inset:0;visibility:hidden}
.packw{position:absolute;left:${L.packX - pack / 2}px;top:${y(L.packTop)}px;width:${pack}px;height:${pack}px;transform-style:preserve-3d;transform-origin:50% 50%}
.packimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 50px 60px rgba(${rgb(c.primary)},.30))}
.sweepmask{position:absolute;inset:0;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;overflow:hidden}
.psweep{position:absolute;top:-20%;bottom:-20%;left:0;width:40%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-14deg)}
.pack{position:absolute;inset:${zq(40)}px;border-radius:${q(28)}px;background:linear-gradient(160deg,var(--primary2),var(--primary));box-shadow:0 60px 100px rgba(${rgb(c.primary)},.38);overflow:hidden}
.pack .band{position:absolute;left:0;right:0;top:${zq(120)}px;height:${zq(140)}px;background:var(--secondary)}
.pack .plogo{position:absolute;left:${q(56)}px;top:${zq(40)}px;font-weight:800;font-size:${zq(50)}px;color:var(--on)}
.pack .pname{position:absolute;left:${q(56)}px;right:${q(40)}px;top:${zq(300)}px;font-weight:800;font-size:${zq(96)}px;line-height:1;color:var(--on)}
.pack .pline{position:absolute;left:${q(56)}px;top:${zq(520)}px;font-size:${zq(44)}px;color:var(--on);opacity:.85}
.shadow{position:absolute;left:${L.packX - z(L.shadow[0] / 2)}px;top:${y(L.packTop + L.pack)}px;width:${z(L.shadow[0])}px;height:${z(L.shadow[1])}px;border-radius:50%;background:radial-gradient(closest-side,rgba(${rgb(c.primary)},.35),transparent)}
.herotext{position:absolute;left:${L.heroX}px;top:${y(L.heroTop)}px;width:${L.heroW}px;display:flex;flex-direction:column;gap:${z(26)}px${L.heroH ? `;height:${z(L.heroH)}px;justify-content:center` : ''}}
.ttl{font-family:var(--display);font-weight:600;font-size:${z(T.ttl)}px;line-height:1.04;color:var(--primary);letter-spacing:-.02em}
.ln{display:block;overflow:hidden;padding-bottom:6px}.ln>span{display:block}
.sub{font-size:${z(T.sub)}px;line-height:1.3;color:var(--muted)}
.kicker{position:absolute;left:${L.textX}px;top:${y(L.kicker)}px;font-size:${z(T.kicker)}px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.big{position:absolute;left:${L.textX}px;top:${y(L.big)}px;font-family:var(--display);font-weight:600;font-size:${z(T.big)}px;line-height:1;color:var(--primary);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.big small{font-size:${z(T.small)}px;letter-spacing:0;margin-left:10px}
.ring{position:absolute;left:${L.iconX - z(L.ring / 2)}px;top:${y(L.ringTop)}px;width:${z(L.ring)}px;height:${z(L.ring)}px;overflow:visible}
.ring circle{fill:none;stroke-width:5}.ringbg{stroke:rgba(${rgb(c.primary)},.12)}.ringp{stroke:var(--primary);stroke-linecap:round}
.decor{position:absolute;left:${L.iconX - L.decor[0] / 2}px;top:${y(L.decorTop)}px;width:${L.decor[0]}px;height:${z(L.decor[1])}px;overflow:visible}
.decor path{fill:none;stroke:var(--primary2);stroke-width:6;stroke-linecap:round}
.btxt{position:absolute;left:${L.textX}px;top:${y(L.btxt)}px;width:${L.textW}px;display:flex;flex-direction:column;align-items:flex-start;gap:${z(26)}px}
.chip{font-size:${z(T.chip)}px;font-weight:600;color:var(--primary);background:#fff;border:4px solid var(--primary);padding:${z(14)}px 34px;border-radius:999px;white-space:nowrap}
.bt{font-size:${z(T.bt)}px;line-height:1.25;color:var(--ink)}
#icon{position:absolute;z-index:6;left:${L.iconX - z(L.icon[0] / 2)}px;top:${y(L.iconTop)}px;width:${z(L.icon[0])}px;height:${z(L.icon[1])}px;overflow:visible;transform-origin:50% 50%}
#shape{fill:none;stroke:var(--primary);stroke-width:4.5;stroke-linejoin:round}
#fill{fill:var(--secondary)}
#tick{fill:none;stroke:#fff;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}
#wipe{position:absolute;inset:0;z-index:5;background:var(--primary);clip-path:circle(0px at ${wipeAt})}
.cta{z-index:7;color:var(--on)}
.clogo{position:absolute;left:${L.textX}px;top:${y(L.clogo)}px;font-weight:800;font-size:58px}
.ctatext{position:absolute;left:${L.textX}px;top:${y(L.ctatext)}px;width:${L.textW}px;display:flex;flex-direction:column;align-items:flex-start;gap:${z(40)}px${L.ctaH ? `;height:${L.ctaH}px;justify-content:center` : ''}}
.ctitle{font-family:var(--display);font-weight:600;font-size:${z(T.ctitle)}px;line-height:1.05;letter-spacing:-.02em}
.cbtn{display:block;background:var(--secondary);color:var(--ink);font-weight:800;font-size:${z(T.cbtn)}px;padding:${z(36)}px 64px;border-radius:999px;transform-origin:0 50%}
.curl{font-size:${z(T.curl)}px;opacity:.85}${L.bKicker ? `
.g:has(> .decor) > .kicker{top:${L.bKicker}px}.g:has(> .decor) > .btxt{top:${L.bBtxt}px}` : ''}${model ? `
.m3c{position:absolute;left:${moff}px;top:${moff}px;width:${mbox}px;height:${mbox}px}.g:has(.m3c) > .shadow{display:none}` : ''}`;
  const html = `<div id="wash"></div>
  <div id="cam">
${body}
    <svg id="icon" viewBox="0 0 100 112" aria-hidden="true"><path id="shape" d="${ICONS[firstIcon]}"/><path id="fill" d="${ICONS[firstIcon]}"/><path id="tick" d="${TICK}"/></svg>
    <div id="wipe"></div>
${cta}
  </div>`;
  const js = `
const PXI = 'power3.in';
const ICON_PLACE = { stat: { scale: 0.52, y: ${L.statY || 0} }, benefit: { scale: 1, y: 0 }, cta: { scale: ${CTA_ICON}, y: ${-z(L.ctaIconY)} } };
gsap.set('#icon', { autoAlpha: 0, transformOrigin: '50% 50%' });
gsap.set(['#shape'], { drawSVG: '0%' });
gsap.set('#fill', { opacity: 0 });
gsap.set('#tick', { drawSVG: '0%', autoAlpha: 0 });
tl.fromTo('#cam', { scale: 1, y: 0 }, { scale: ${L.push.scale}, y: ${L.push.y}, duration: D.duration, ease: 'none' }, 0);
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
    ${model ? MODEL_IN : PACK_IN}
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
    tl.to('#wipe', { clipPath: 'circle(${wipeR}px at ${wipeAt})', duration: 1.0, ease: XIO }, s - 0.25);
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
