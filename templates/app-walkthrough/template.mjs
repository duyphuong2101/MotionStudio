import { logoHtml } from '../shared.mjs';
import { page, h, rgb, checkBrand, hasLogoBug, contentArea, geometry, camera as kitCamera } from '../kit.mjs';

export const W = 1920;
export const H = 1080;
const SIZE = { width: W, height: H };
const IMG_W = 1920;
const IMG_H = 1080;
const BAR = 40;
// The browser window that holds the screenshots; with the brand's corner logo it sits lower and a little smaller,
// so the logo never covers its title bar.
const FRAMES = { plain: { x: 160, y: 58, w: 1600 }, bug: { x: 200, y: 120, w: 1520 } };
const MAX_ZOOM = 2.4;

const camera = (focus) => kitCamera(focus, { width: IMG_W, height: IMG_H }, MAX_ZOOM);

export function build(args) {
  return page({ ...args, size: SIZE, title: 'app-walkthrough', ...parts(args) });
}

/** css, body, scenes and js for page(). Subtitles show only when the brand sets them; captions then sit above them. */
export function parts({ brand, script, timing }) {
  const { c } = checkBrand(brand);
  const bug = hasLogoBug(brand), subtitles = !!brand.subtitles;
  const FRAME = { ...(bug ? FRAMES.bug : FRAMES.plain), bar: BAR };
  FRAME.h = Math.round((FRAME.w * IMG_H) / IMG_W);
  const BASE = FRAME.w / IMG_W;
  const capBottom = subtitles ? contentArea(brand, geometry(SIZE)).bottom : 54;
  const tById = Object.fromEntries(timing.scenes.map((s) => [s.id, s]));
  const scenes = script.scenes.map((sc) => ({
    id: sc.id, kind: sc.kind, pace: sc.pace || 'normal',
    shots: (sc.shots || []).map((sh, k) => ({
      layer: `shot-${sc.id}-${k}`, cam: camera(sh.focus), focus: sh.focus || null,
      cursor: sh.cursor || null, click: !!sh.click, highlight: !!sh.highlight && !!sh.focus,
    })),
    // The title and closing cards are drawn on the brand primary.
    ...(sc.kind === 'screen' ? {} : { dark: true }),
  }));

  const stills = [];
  for (const sc of scenes) {
    const t = tById[sc.id], n = Math.max(1, sc.shots.length), slot = (t.end - t.start) / n;
    for (let k = 0; k < n; k++) {
      const at = Math.min(t.end - 0.15, t.start + slot * (k + 1) - 0.3);
      stills.push({ id: n > 1 ? `${sc.id}-${k + 1}` : sc.id, t: Math.round(at * 100) / 100 });
    }
  }

  const layers = script.scenes.flatMap((sc) => (sc.shots || []).map((sh, k) =>
    `<img class="shot" id="shot-${sc.id}-${k}" src="assets/${encodeURIComponent(sh.asset)}" alt="">`)).join('\n        ');

  // Each screen scene's caption is its scene group, so the page shows and hides it with the scene.
  const captions = script.scenes.filter((s) => s.kind === 'screen').map((s) => {
    const sc = scenes.find((x) => x.id === s.id);
    return `<div class="sc" id="g-${s.id}"><div class="cap ${sc.pace}" id="cap-${s.id}" data-lint>
      ${s.kicker ? `<div class="ck">${h(s.kicker)}</div>` : ''}<div class="ct">${h(s.title)}</div></div></div>`;
  }).join('\n  ');

  // With the corner logo on every scene, the cards leave their own out.
  const logo = bug ? '' : logoHtml(brand, { onDark: true, fallbackText: false });
  const lg = logo ? `<div class="lg">${logo}</div>` : '';
  const title = script.scenes.find((s) => s.kind === 'title');
  const cta = script.scenes.find((s) => s.kind === 'cta');
  const css = `
#stage{background:var(--bg)}
.full .lg .brandlogo{height:76px;max-width:520px;object-fit:contain;object-position:left center}
#wash{position:absolute;inset:0;background:radial-gradient(1200px 800px at 50% 45%,rgba(${rgb(c.primary2)},.12),transparent 70%)}
#win{position:absolute;left:${FRAME.x}px;top:${FRAME.y}px;width:${FRAME.w}px;height:${FRAME.h + FRAME.bar}px;border-radius:18px;overflow:hidden;
  background:#fff;box-shadow:0 40px 90px rgba(${rgb(c.ink)},.28),0 0 0 1px rgba(${rgb(c.ink)},.08);transform-origin:50% 50%}
#bar{height:${FRAME.bar}px;background:#eef1f5;display:flex;align-items:center;gap:8px;padding:0 16px;border-bottom:1px solid #e1e5ea}
#bar i{width:12px;height:12px;border-radius:50%;background:#d5d9e0}
#bar i:nth-child(1){background:#f26d5f}#bar i:nth-child(2){background:#f5bd4f}#bar i:nth-child(3){background:#5dc466}
#bar span{margin-left:18px;font-size:15px;color:#6b7280;background:#fff;border-radius:8px;padding:4px 14px;flex:0 1 520px;font-family:var(--body)}
#view{position:absolute;left:0;top:${FRAME.bar}px;width:${IMG_W}px;height:${IMG_H}px;transform:scale(${BASE});transform-origin:0 0;overflow:hidden}
#cam{position:absolute;left:0;top:0;width:${IMG_W}px;height:${IMG_H}px;transform-origin:0 0}
.shot{position:absolute;left:0;top:0;width:${IMG_W}px;height:${IMG_H}px;opacity:0}
#hl{position:absolute;border:4px solid var(--primary2);border-radius:14px;box-shadow:0 0 0 9999px rgba(${rgb(c.ink)},.32);opacity:0;pointer-events:none}
#cursor{position:absolute;left:0;top:0;width:34px;height:44px;opacity:0;transform-origin:0 0;filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))}
#ring{position:absolute;left:0;top:0;width:80px;height:80px;margin:-40px 0 0 -40px;border-radius:50%;border:5px solid var(--primary2);opacity:0}
.cap{position:absolute;left:96px;bottom:${capBottom}px;max-width:820px;padding:20px 30px 22px;border-radius:16px;background:var(--primary);color:var(--on);
  box-shadow:0 20px 50px rgba(${rgb(c.ink)},.35);opacity:0;z-index:5}
.cap .ck{font-size:20px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--secondary);margin-bottom:6px}
.cap .ct{font-family:var(--display);font-weight:700;font-size:40px;line-height:1.15}
.cap.quick{padding:14px 24px 16px}.cap.quick .ct{font-size:32px}.cap.quick .ck{font-size:17px}
.cap.focus .ct{font-size:44px}
.full{position:absolute;inset:0;background:var(--primary);color:var(--on);display:flex;flex-direction:column;justify-content:center;padding:0 180px;gap:26px;z-index:8;opacity:0}
.full .t{font-family:var(--display);font-weight:800;font-size:132px;line-height:1;letter-spacing:-.03em}
.full .s{font-size:44px;opacity:.85;max-width:1200px}
.full .b{display:block;align-self:flex-start;background:var(--secondary);color:var(--ink);font-weight:800;font-size:46px;padding:28px 56px;border-radius:999px}
.full .u{font-size:34px;opacity:.8}`;
  const body = `<div id="wash"></div>
  <div id="win">
    <div id="bar"><i></i><i></i><i></i><span>${h(brand.site || brand.name)}</span></div>
    <div id="view"><div id="cam">
        ${layers}
        <div id="hl"></div>
        <div id="ring"></div>
        <svg id="cursor" viewBox="0 0 34 44" aria-hidden="true"><path d="M3 2 L3 34 L11 26 L17 40 L23 37 L17 24 L29 24 Z" fill="#111" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>
    </div></div>
  </div>
  ${captions}
  ${title ? `<div class="full" id="g-${title.id}">${lg}<div class="t" data-lint>${h(title.title)}</div>${title.subtitle ? `<div class="s" data-lint>${h(title.subtitle)}</div>` : ''}</div>` : ''}
  ${cta ? `<div class="full" id="g-${cta.id}">${lg}<div class="t" data-lint>${h(cta.title)}</div><div class="btn b" data-lint>${h(cta.button)}</div>${cta.url ? `<div class="u" data-lint>${h(cta.url)}</div>` : ''}</div>` : ''}`;
  // The page shows each scene group at its start, fades a card out at its end and fades a later card in; the title
  // card fades in here, as the first scene gets no fade from the page.
  const js = `
const MOVE = { quick: 0.55, normal: 0.9, focus: 1.1 };
gsap.set('#cam', { x: 0, y: 0, scale: 1 });
gsap.set('#win', { opacity: 0, scale: 0.94, y: 30 });
let firstShot = true, cur = { x: 960, y: 620 }, prevLayer = null;
function card(sc, s, e, c) {
  const g = $('g-' + sc.id);
  if (sc.kind === 'title') {
    if (c.first) tl.fromTo(g, { opacity: 0 }, { opacity: 1, duration: 0.5, immediateRender: false }, s);
    tl.fromTo(g.children, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.18, immediateRender: false }, s + 0.15);
    return;
  }
  // The window is gone before the closing card fades in, so the two never show together.
  tl.to('#win', { scale: 0.9, opacity: 0, duration: 0.35, ease: XI }, s - 0.35)
    .fromTo(g.children, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.2, immediateRender: false }, s + 0.2);
}
function screenScene(sc, s, e, c) {
  if (firstShot) { tl.to('#win', { opacity: 1, scale: 1, y: 0, duration: 0.7 }, s); firstShot = false; }
  const cap = $('cap-' + sc.id);
  tl.fromTo(cap, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, immediateRender: false }, s + 0.1);
  if (!c.last) tl.to(cap, { y: -10, opacity: 0, duration: 0.3, ease: XI }, e - 0.3);
  const n = sc.shots.length, slot = (e - s) / n, move = MOVE[sc.pace] || 0.9;
  sc.shots.forEach((sh, k) => {
    const t0 = s + slot * k, layer = $(sh.layer);
    if (prevLayer && prevLayer !== layer) tl.to(prevLayer, { opacity: 0, duration: 0.3 }, t0);
    tl.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, t0)
      .to('#cam', { x: sh.cam.x, y: sh.cam.y, scale: sh.cam.z, duration: move, ease: XIO }, t0);
    // slow drift keeps a held shot alive
    const hold = slot - move;
    if (hold > 0.6 && sc.pace !== 'quick') {
      const z2 = sh.cam.z * 1.025;
      tl.to('#cam', { scale: z2, x: sh.cam.x - (z2 - sh.cam.z) * 960, y: sh.cam.y - (z2 - sh.cam.z) * 540, duration: hold, ease: 'none' }, t0 + move);
    }
    if (sh.highlight) {
      const f = sh.focus, pad = 10;
      tl.set('#hl', { left: f.x - pad, top: f.y - pad, width: f.w + pad * 2, height: f.h + pad * 2, borderWidth: 4 / sh.cam.z }, t0)
        .fromTo('#hl', { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, t0 + move * 0.7)
        .to('#hl', { opacity: 0, duration: 0.3 }, t0 + slot - 0.3);
    }
    if (sh.cursor) {
      const k1 = 1 / sh.cam.z;
      tl.set('#cursor', { opacity: 1 }, t0 + 0.05)
        .fromTo('#cursor', { x: cur.x, y: cur.y, scale: k1 }, { x: sh.cursor.x, y: sh.cursor.y, scale: k1, duration: Math.min(0.9, slot * 0.35), ease: XIO, immediateRender: false }, t0 + 0.1);
      cur = { x: sh.cursor.x, y: sh.cursor.y };
      if (sh.click) {
        const tc = t0 + 0.1 + Math.min(0.9, slot * 0.35) + 0.1;
        tl.to('#cursor', { scale: k1 * 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: 'none' }, tc)
          .fromTo('#ring', { left: sh.cursor.x, top: sh.cursor.y, scale: 0.3 * k1, opacity: 0.9 }, { scale: 1.4 * k1, opacity: 0, duration: 0.55, immediateRender: false }, tc);
      }
    } else {
      tl.to('#cursor', { opacity: 0, duration: 0.2 }, t0);
    }
    prevLayer = layer;
  });
}
const KINDS = { title: card, cta: card, screen: screenScene };`;
  return { css, body, scenes, js, subtitles, extra: { base: BASE, frame: FRAME }, stills };
}
