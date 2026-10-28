import { page, geometry, h, hasLogoBug, contentArea, themeClass, ACCENT_CSS } from '../kit.mjs';
import { motionProfile } from '../../engine/brand.mjs';
import { logoHtml } from '../shared.mjs';
import { iconSet } from '../../motion-kit/icons.mjs';
import { modelCanvas } from '../model3d.mjs';
import { lottieBox } from '../lottie.mjs';
import { stripMarks } from '../../engine/marks.mjs';

// flash: one item fills a line at up to this size (1080 units); a longer one wraps at the minimum.
const FLASH_MAX = { land: 170, port: 150 }, FLASH_MIN = { land: 110, port: 88 };
// A word as the page matches it against the voice: letters and digits only, lower case ("Auto-Ship," → "autoship").
const wordKey = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
// Rough width of one bold display character, in em, to size a flash line before the page lays it out.
const CHAR_EM = 0.6;
// Per-character widths (em) for the one word that must not break: wide, capital and narrow letters.
const WIDE = /[MWmw@%]/, NARROW = /[ijlI1.,:;!'|]/, SLIM = /[ftr()-]/;
const wordEm = (w) => [...w].reduce((n, ch) => n + (WIDE.test(ch) ? 0.92 : NARROW.test(ch) ? 0.34 : SLIM.test(ch) ? 0.45 : /\p{Lu}/u.test(ch) ? 0.72 : 0.6), 0);

/**
 * A flash line's font size (1080 units) for `text` on a `width`-unit line: the size that fits the line on one row,
 * between `min` and `max`; a longer line wraps at `min`. Its longest word always fits whole, below `min` if it must,
 * so no word breaks mid-letter. Marks count as the words they show.
 */
export function flashSize(text, max, min, width) {
  const t = stripMarks(text);
  const line = Math.max(min, Math.min(max, Math.floor(width / (Math.max(1, t.length) * CHAR_EM))));
  const word = Math.max(0, ...t.split(/\s+/).map(wordEm));
  return word ? Math.min(line, Math.floor(width / word)) : line;
}
const tone = (sc) => (sc.theme === 'dark' ? { dark: true } : {});
// A cta's optional background photo, faded under a brand-colour gradient on the text side.
export const CTA_BG_CSS = '.ctabg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.32;filter:saturate(.9)}.ctabg+.cta{background:linear-gradient(90deg,var(--primary) 30%,rgba(0,0,0,0))}';
// A scene's decal as the renderer takes it: the icon's path from the icon set, the brand secondary on white.
export const decalOf = (decal, ICONS, brand) => (decal && typeof decal === 'object' && ICONS[decal.icon] ? { ...decal, d: ICONS[decal.icon], color: brand.colors?.secondary, bg: '#ffffff' } : undefined);
const themed = (sc) => sc.theme === 'dark' || sc.theme === 'accent';

export function build(args) {
  return page({ ...args, title: 'explainer', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, timing, size, icons }) {
  const ICONS = iconSet(icons);
  const g = geometry(size);
  const { px, padX, port, land, W, H, U, short } = g;
  // A diagram stacks its nodes in any frame taller than wide; 4:5 draws them compact.
  const stack = port || H > W, tight = stack && !port;
  // With the brand's corner logo, a landscape progress bar starts right of it so the logo area stays clear.
  const bugClear = !!brand.logoBug && !port;
  // Stage layout (cinematic and other profiles): footage fills the frame under a lower third, icons are drawn in fine
  // line, no progress bar. The flash items take a focus pull only with the cinematic entrance.
  const M = motionProfile(brand), stage = M.layout === 'stage', focus = M.entrance === 'cine';
  const A = contentArea(brand, g);
  const flashSide = port ? 80 : 130;
  const flashW = (land ? Math.min(W, (H * 16) / 9) : W) / U - 2 * flashSide;
  const fmax = port ? FLASH_MAX.port : FLASH_MAX.land, fmin = port ? FLASH_MIN.port : FLASH_MIN.land;
  const fit = (t, max) => flashSize(t, max, fmin, flashW);
  const scenes = [];
  const blocks = [];
  const steps = script.scenes.filter((s) => s.kind === 'step');
  const stepTheme = steps.some(themed);
  let stepNo = 0;
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'title') {
      // theme "dark": a centred cold open on the brand's dark colour; "accent" the same on the brand's secondary colour.
      const dk = sc.theme === 'dark', acc = sc.theme === 'accent';
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="ttl${dk ? ' tdark' : acc ? ' tacc' : ''}">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd tt" data-lint>${h(sc.title)}</div>${sc.subtitle ? `<div class="tsub" data-lint>${h(sc.subtitle)}</div>` : ''}
        <svg class="tline" viewBox="0 0 400 20" preserveAspectRatio="none" aria-hidden="true"><path id="${id}-tl" d="M2 10 H398"/></svg></div></div>`);
      scenes.push(dk ? { id, kind: 'title', dark: true } : { id, kind: 'title' });
    } else if (sc.kind === 'step') {
      stepNo += 1;
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="step"><div class="sicon"></div>
        <div class="stext"><div class="snum" data-lint>${h(sc.kicker || `Step ${String(stepNo).padStart(2, '0')}`)}${!sc.kicker && (steps.length > 1 || !stage) ? ` <span>/ ${String(steps.length).padStart(2, '0')}</span>` : ''}</div>
          <div class="hd stt" data-lint>${h(sc.title)}</div>${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>
        <div class="prog"><i id="${id}-prog"></i></div></div>`);
      scenes.push({ id, kind: 'step', icon: ICONS[sc.icon] || ICONS.circle, frac: [(stepNo - 1) / steps.length, stepNo / steps.length], ...(themed(sc) ? { theme: sc.theme } : {}), ...tone(sc) });
    } else if (sc.kind === 'diagram') {
      const nodes = (sc.nodes || []).slice(0, 5);
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="diag"><div class="hd dt" data-lint>${h(sc.title)}</div>
        <div class="nodes">${nodes.map((n, k) => `${k ? `<svg class="arr" viewBox="0 0 100 40" aria-hidden="true"><path id="${id}-a${k}" d="M4 20 H88 M76 8 L92 20 L76 32"/></svg>` : ''}<div class="node" id="${id}-n${k}" data-lint>${h(n)}</div>`).join('')}</div>
        ${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'diagram', n: nodes.length, ...tone(sc) });
    } else if (sc.kind === 'flash') {
      // Kinetic type: one very large item at a time, centred, each replacing the last; the title lands last and holds.
      const items = (sc.items || []).slice(0, 12).map(String);
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="flash">${sc.kicker ? `<div class="kick flk" data-lint>${h(sc.kicker)}</div>` : ''}
        ${items.map((t, k) => `<div class="fl" id="${id}-f${k}"><div class="fi" data-lint style="font-size:${px(fit(t, fmax))}">${h(t)}</div></div>`).join('')}
        ${sc.title ? `<div class="flw"><div class="hd fi flt" id="${id}-ft" data-lint style="font-size:${px(fit(sc.title, Math.round(fmax * 0.85)))}">${h(sc.title)}</div></div>` : ''}</div></div>`);
      // Each item's first word, so the page can flash it as the voice says that word (`nine workstreams` names none: even beats).
      scenes.push({ id, kind: 'flash', n: items.length, title: !!sc.title, heads: items.map((t) => wordKey(t.split(/\s+/)[0])), ...(sc.title ? { titleHead: wordKey(String(sc.title).split(/\s+/)[0]) } : {}), ...tone(sc) });
    } else if (sc.kind === 'video') {
      // Footage in a window: prepare cut it to clips/<id>.mp4; the kit seeks it with the page clock.
      const t = timing?.scenes.find((x) => x.id === id) || { start: 0, end: 0 };
      const clip = `<video data-clip="${id}" data-start="${t.start}" data-end="${t.end}" src="clips/${encodeURIComponent(id)}.mp4" muted playsinline preload="auto"></video>`;
      if (stage) {
        // Full frame: the footage, a shade for the type, and the title as a lower third.
        blocks.push(`<div class="sc fill dark vfull" id="g-${id}"><div class="vbg" id="${id}-win">${clip}</div><div class="vshade"></div>
        <div class="vcap">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd vt" data-lint>${h(sc.title)}</div>${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
        scenes.push({ id, kind: 'video', dark: true });
        continue;
      }
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="vid">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd vt" data-lint>${h(sc.title)}</div>
        <div class="vwin" id="${id}-win">${clip}</div>
        ${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'video' });
    } else if (sc.kind === 'model') {
      // A 3D model (a .glb asset) on the scene's own background; templates/model3d.mjs draws it at every seek.
      const t = timing?.scenes.find((x) => x.id === id) || { start: 0, end: 0 };
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="mod">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd vt" data-lint>${h(sc.title)}</div>
        <div class="mwin" id="${id}-win">${modelCanvas(sc.model, t, sc.spin, { ...sc, decal: decalOf(sc.decal, ICONS, brand), colors: brand.colors })}</div>
        ${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'model', ...tone(sc) });
    } else if (sc.kind === 'anim') {
      // A Lottie animation (a .json asset) in the model window; templates/lottie.mjs seeks it with the page clock.
      const t = timing?.scenes.find((x) => x.id === id) || { start: 0, end: 0 };
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="mod">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd vt" data-lint>${h(sc.title)}</div>
        <div class="mwin awin" id="${id}-win">${lottieBox(sc.lottie, t, { loop: sc.loop !== false, fit: sc.fit })}</div>
        ${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'anim', ...tone(sc) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}">${sc.image ? `<img class="ctabg" src="assets/${encodeURIComponent(sc.image)}" alt="">` : ''}<div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const hasVideo = scenes.some((s) => s.kind === 'video');
  const hasDarkTitle = scenes.some((s) => s.kind === 'title' && s.dark);
  const hasFlash = scenes.some((s) => s.kind === 'flash');
  const hasModel = scenes.some((s) => s.kind === 'model' || s.kind === 'anim');
  const ctaBg = script.scenes.some((s) => s.kind === 'cta' && s.image);
  // The model window: wide in landscape, square in portrait, between the title and the content area's bottom.
  const mwin = port ? [880, short ? 640 : 860] : land ? [1240, 560] : [820, 470];
  // A dark title has its own rules (tdark); these cover the themed body scenes.
  const hasDark = script.scenes.some((s) => s.kind !== 'title' && s.theme === 'dark'), hasAcc = script.scenes.some((s) => s.theme === 'accent');
  // Stage sizes per frame shape: landscape gets the large layout, square and 4:5 a compact one, 2:3 a shorter stack.
  const stageSicon = port ? (short ? [320, 358] : [420, 460]) : land ? [380, 420] : [300, 336];
  // A landscape row keeps one line of nodes: the type steps down as the row fills (4 nodes = 7 children, 5 = 9).
  // A square frame has no room for 4 nodes in a row, so they stack.
  const stageNodes = land ? `
.node{min-width:0;flex:0 1 auto;text-align:center;font-size:${px(54)};padding:${px(38)} ${px(46)}}.arr{width:${px(80)}}
.nodes:has(> :nth-child(7)) .node{font-size:${px(48)};padding:${px(34)} ${px(40)}}
.nodes:has(> :nth-child(9)) .node{font-size:${px(42)};padding:${px(30)} ${px(32)}}.nodes:has(> :nth-child(9)) .arr{width:${px(56)}}`
    : port ? `
.node{min-width:${px(620)};text-align:center;font-size:${px(short ? 40 : 48)};padding:${px(short ? 22 : 30)} ${px(40)}}`
      : tight ? '\n.node{text-align:center}' : `
.node{min-width:0;text-align:center;font-size:${px(34)};padding:${px(22)} ${px(24)}}.arr{width:${px(50)}}
.nodes:has(> :nth-child(7)){flex-direction:column;gap:${px(4)}}.nodes:has(> :nth-child(7)) .node{min-width:${px(420)};font-size:${px(30)};padding:${px(12)} ${px(30)}}
.nodes:has(> :nth-child(7)) .arr{width:${px(30)};height:${px(22)};transform:rotate(90deg)}.diag:has(.nodes > :nth-child(7)){gap:${px(32)}}`;
  const iconBox = port ? { l: 290, t: 330, w: 500 } : land ? { l: 230, t: 270, w: 470 } : { l: 330, t: 150, w: 420 };
  const css = `
.ttl,.cta{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(110)} ${padX(110)};gap:${px(26)}}
.tt{font-size:${px(port ? 120 : 110)}}.tsub{font-size:${px(44)};color:var(--muted)}
.tline{width:${px(360)};height:${px(20)};overflow:visible}.tline path{fill:none;stroke:var(--secondary);stroke-width:10;stroke-linecap:round}
.step{position:absolute;inset:0;display:flex;flex-direction:${port ? 'column' : 'row'};align-items:center;padding:${px(port ? 110 : 90)} ${padX(110)};gap:${px(port ? 40 : 60)}}
.sicon{flex:none;width:${px(port ? 520 : land ? 520 : 440)};height:${px(port ? 520 : land ? 560 : 440)}}
.stext{display:flex;flex-direction:column;gap:${px(20)};${port ? 'text-align:center;align-items:center' : ''}}
.snum{font-weight:800;font-size:${px(34)};letter-spacing:.14em;text-transform:uppercase;color:var(--primary2)}.snum span{color:var(--muted)}
.stt{font-size:${px(port ? 92 : 80)}}.stx{font-size:${px(42)};color:var(--muted);line-height:1.35;max-width:${px(900)}}
.prog{position:absolute;left:${padX(bugClear ? 300 : 110)};right:${padX(110)};top:${px(port ? 110 : bugClear ? 66 : 64)};height:${px(10)};border-radius:6px;background:rgba(15,23,42,.08);overflow:hidden}
.prog i{display:block;height:100%;width:100%;background:var(--primary2);transform-origin:0 50%}
#xicon{position:absolute;left:${px(iconBox.l)};top:${px(iconBox.t)};width:${px(iconBox.w)};height:${px(iconBox.w * 1.12)};overflow:visible;opacity:0;z-index:5}
#xshape{fill:none;stroke:var(--primary);stroke-width:4;stroke-linejoin:round}#xfill{fill:var(--secondary)}
.diag{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:${px(tight ? 36 : 50)};padding:${px(90)} ${padX(90)};text-align:center}
.dt{font-size:${px(port ? 88 : 76)}}
.nodes{display:flex;flex-direction:${stack ? 'column' : 'row'};align-items:center;gap:${px(tight ? 8 : 14)}}
.node{min-width:${px(port ? 520 : tight ? 460 : 250)};padding:${tight ? `${px(20)} ${px(30)}` : `${px(30)} ${px(34)}`};border-radius:${px(24)};background:#fff;border:${px(4)} solid rgba(15,23,42,.1);font-weight:700;font-size:${px(tight ? 34 : 38)};box-shadow:0 ${px(14)} ${px(30)} rgba(15,23,42,.08)}
.node.on{border-color:var(--primary2);background:var(--primary2);color:#fff}
.arr{width:${px(tight ? 40 : stack ? 60 : 90)};height:${px(tight ? 28 : 36)};overflow:visible;${stack ? 'transform:rotate(90deg)' : ''}}.arr path{fill:none;stroke:var(--primary2);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}${!stage && !land && !stack ? `
.node{min-width:0}
.nodes:has(> :nth-child(7)){flex-direction:column;gap:${px(4)}}.nodes:has(> :nth-child(7)) .node{min-width:${px(420)};font-size:${px(30)};padding:${px(12)} ${px(30)}}
.nodes:has(> :nth-child(7)) .arr{width:${px(30)};height:${px(22)};transform:rotate(90deg)}` : ''}
.cta{align-items:flex-start}.ctat{font-size:${px(port ? 116 : 100)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}${ctaBg ? '\n' + CTA_BG_CSS : ''}${hasVideo ? `
.vid{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:${px(26)};padding:${px(port ? 130 : 60)} ${padX(110)} ${px(port ? 270 : 170)};text-align:center}
.vt{font-size:${px(port ? 80 : 64)}}
.vwin{flex:none;line-height:0;border-radius:${px(22)};overflow:hidden;background:#000;box-shadow:0 ${px(24)} ${px(60)} rgba(15,23,42,.3)}
.vwin video{display:block;width:auto;height:auto;max-width:${px(land ? 1320 : 900)};max-height:${px(port ? 900 : land ? 600 : 560)}}` : ''}${hasModel ? `
.mod{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:${px(18)};padding:${px(A.top)} ${padX(110)} ${px(A.bottom)};text-align:center}
.mod .vt{font-size:${px(port ? 80 : 64)}}
.mwin{flex:none;width:${px(mwin[0])};height:${px(mwin[1])};max-width:100%}.m3c{display:block;width:100%;height:100%}.awin{position:relative}.lot{position:absolute;inset:0}.lot svg{display:block;width:100%;height:100%}` : ''}${hasDarkTitle ? `
.tdark{align-items:center;text-align:center}.tdark .tt{color:var(--on);font-size:${px(port ? 140 : 150)}}.tdark .tsub{color:var(--on);opacity:.75}` : ''}${hasFlash ? `
.flash{position:absolute;left:${padX(flashSide)};right:${padX(flashSide)};top:${px(A.top)};bottom:${px(A.bottom)}}
.flk{position:absolute;left:0;right:0;top:0;text-align:center}
.fl,.flw{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center}.fl{opacity:0}
.fi{font-family:var(--display);font-weight:800;letter-spacing:-.03em;line-height:1.02;max-width:100%;overflow-wrap:break-word}
.flt{color:var(--primary2)}` : ''}${hasDark ? `
.dark .flt{color:var(--secondary)}
.dark .snum{color:var(--secondary)}.dark .snum span{color:var(--on);opacity:.6}.dark .stext .stx,.dark .diag .stx{color:var(--on);opacity:.75}.dark .prog{background:rgba(255,255,255,.14)}
.dark .node{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.22);color:var(--on)}.dark .node.on{background:var(--secondary);border-color:var(--secondary);color:var(--ink)}.dark .arr path{stroke:var(--secondary)}
#xicon.xdark #xshape{stroke:var(--on)}#xicon.xdark #xfill{fill:var(--secondary)}` : ''}${hasAcc ? `${ACCENT_CSS}
.acc .flt{color:var(--ink)}.acc .snum,.acc .snum span{color:var(--ink)}.acc .stext .stx,.acc .diag .stx{color:var(--ink);opacity:.8}.acc .prog{background:rgba(15,23,42,.12)}.acc .prog i{background:var(--ink)}
.acc .node{border-color:rgba(15,23,42,.18)}.acc .node.on{background:var(--ink);border-color:var(--ink);color:var(--on)}.acc .arr path{stroke:var(--ink)}
#xicon.xaccent #xshape{stroke:var(--ink)}#xicon.xaccent #xfill{fill:var(--bg)}
.tacc{align-items:center;text-align:center}.tacc .tt{font-size:${px(port ? 140 : 150)}}.tacc .tsub{color:var(--ink);opacity:.75}.tacc .tline path{stroke:var(--ink)}` : ''}${stage ? `
.prog{display:none}
.sicon{width:${px(stageSicon[0])};height:${px(stageSicon[1])}}
#xshape{stroke:var(--ink);stroke-width:2.2}#xfill{fill:var(--secondary);fill-opacity:.3}${hasDark ? `
#xicon.xdark #xshape{stroke:var(--secondary)}#xicon.xdark #xfill{fill-opacity:0}` : ''}
.node{box-shadow:none;border-width:${px(2)}}
.step{padding:${px(A.top)} ${padX(port ? 90 : 120)} ${px(A.bottom)};gap:${px(port ? 44 : land ? 70 : 44)}}
.snum{font-size:${px(land || port ? 42 : 34)}}.stt{font-size:${px(land || port ? 108 : 76)}}.stext .stx{font-size:${px(land ? 50 : port ? 46 : 40)};max-width:${px(1100)}}
.diag{padding:${px(A.top)} ${padX(120)} ${px(A.bottom)};gap:${px(tight ? 36 : 56)}}.dt{font-size:${px(port ? 100 : land ? 96 : 76)}}
.nodes{max-width:100%;gap:${px(tight ? 8 : 16)}}${stageNodes}
.diag .stx{font-size:${px(land ? 50 : 44)};max-width:${px(1300)}}${hasVideo ? `
.vfull{background:#000}
.vbg{position:absolute;inset:0;overflow:hidden}.vbg video{display:block;width:100%;height:100%;object-fit:cover}
.vshade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,0) 24%,rgba(0,0,0,0) 46%,rgba(0,0,0,.72) 100%)}
.vcap{position:absolute;left:${padX(110)};right:${padX(110)};bottom:${px(port ? 300 : 200)};display:flex;flex-direction:column;gap:${px(14)}}
.vcap .vt{font-size:${px(port ? 86 : 80)};color:#fff}.vcap .stx{color:rgba(255,255,255,.85);max-width:${px(1100)}}` : ''}` : ''}`;
  const firstIcon = scenes.find((s) => s.icon)?.icon || ICONS.circle;
  const body = blocks.join('\n') +`<svg id="xicon" viewBox="0 0 100 112" aria-hidden="true"><path id="xshape" d="${firstIcon}"/><path id="xfill" d="${firstIcon}"/></svg>`;
  const js = `
let iconOn = false, iconShown = false;
const KINDS = {
  title(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.tt'), s + 0.15, { d: 0.7 }); fadeUp(g.querySelector('.tsub'), s + 0.5);
    draw($(sc.id + '-tl'), s + 0.6, 0.8);
  },
  step(sc, s, e, c) {
    const next = D.scenes[c.i + 1];
    if (!iconOn) { tl.fromTo('#xicon', { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, s - 0.1); iconOn = true; }
    if (!iconShown) {
      // Park the shared icon exactly where this layout reserved room for it.
      const box = $('g-' + sc.id).querySelector('.sicon');
      gsap.set('#xicon', { left: box.offsetLeft + box.parentElement.offsetLeft, top: box.offsetTop + box.parentElement.offsetTop, width: box.offsetWidth, height: box.offsetHeight });
      tl.set(['#xshape', '#xfill'], { attr: { d: sc.icon } }, s - 0.15)
        .fromTo('#xshape', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0, immediateRender: false }, s)
        .set('#xshape', { strokeDasharray: 'none' }, s + 1.1)
        .fromTo('#xfill', { opacity: 0 }, { opacity: 1, duration: 0.5, immediateRender: false }, s + 0.6);
      iconShown = true;
    } else {
      tl.to(['#xshape', '#xfill'], { morphSVG: sc.icon, duration: 0.8, ease: XIO }, s - 0.15);
    }
    tl.fromTo('#xicon', { scale: 0.92, rotation: -4 }, { scale: 1, rotation: 0, duration: 0.8, transformOrigin: '50% 50%', immediateRender: false }, s);${stepTheme ? `
    // The shared icon takes the colours of a themed step's background.
    tl.set('#xicon', { attr: { class: sc.theme ? 'x' + sc.theme : '' } }, s - 0.15);` : ''}
    if (!next || next.kind !== 'step') { tl.to('#xicon', { opacity: 0, duration: 0.3 }, e - 0.2); iconOn = false; }
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.snum'), s + 0.1, { y: 20 }); fadeUp(g.querySelector('.stt'), s + 0.2); fadeUp(g.querySelector('.stx'), cue(sc, 0.35));
    tl.fromTo($(sc.id + '-prog'), { scaleX: sc.frac[0] }, { scaleX: sc.frac[1], duration: 0.9, ease: XIO, immediateRender: false }, s + 0.2);
  },
  diagram(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.dt'), s + 0.05);
    const span = Math.max(0.5, (e - s - 1.2) / Math.max(1, sc.n));
    // The highlight moves from node to node over 0.3 s; the class swap alone changed it in one frame.
    const look = (el, cls) => { const was = el.className; el.className = cls; const cs = getComputedStyle(el); const v = { backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor, color: cs.color }; el.className = was; return v; };
    const n0 = $(sc.id + '-n0'), off = n0 && look(n0, 'node'), on = n0 && look(n0, 'node on');
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.4 + k * span, d = 0.3;
      if (k) draw($(sc.id + '-a' + k), at - 0.3, 0.4);
      pop($(sc.id + '-n' + k), at, { from: 0.8 });
      tl.set($(sc.id + '-n' + k), { attr: { class: 'node on' } }, at + 0.15);
      tl.fromTo($(sc.id + '-n' + k), off, { ...on, duration: d, ease: XIO, immediateRender: false }, at + 0.15);
      if (k) {
        tl.set($(sc.id + '-n' + (k - 1)), { attr: { class: 'node' } }, at + 0.15);
        tl.fromTo($(sc.id + '-n' + (k - 1)), on, { ...off, duration: d, ease: XIO, immediateRender: false }, at + 0.15);
      }
    }
    fadeUp(g.querySelector('.stx'), cue(sc, 0.7));
  },
${hasFlash ? `  flash(sc, s, e) {
    const g = $('g-' + sc.id), beats = sc.n + (sc.title ? 1 : 0), T = [];
    fadeUp(g.querySelector('.flk'), s + 0.05, { y: 20 });
    // One beat per item (and one for the title): on the word that starts the item when the voice says it, else spread
    // over the voice line; at least 0.3 s apart and inside the scene.
    const ws = words(sc.id), key = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
    let from = 0;
    for (let k = 0; k < beats; k++) {
      const hit = k < sc.n && sc.heads[k] ? ws.findIndex((w, i) => i >= from && key(w.w) === sc.heads[k]) : -1;
      if (hit >= 0) from = hit + 1;
      // When the items followed the spoken words, the title lands on its own first word if the voice says it after the
      // items, else once the line is over.
      const said = k === sc.n && from > 0 && sc.titleHead ? ws.findIndex((w, i) => i >= from && key(w.w) === sc.titleHead) : -1;
      const t = said >= 0 ? ws[said].start - 0.08 : k === sc.n && from > 0 && ws.length ? Math.min(ws[ws.length - 1].end + 0.15, e - 0.6) : hit >= 0 ? ws[hit].start - 0.08 : cue(sc, k / beats);
      T.push(Math.max(t, k ? T[k - 1] + 0.3 : s + 0.05));
    }
    if (T[beats - 1] > e - 0.5) T.forEach((t, k) => { T[k] = s + 0.05 + (k * (e - s - 0.55)) / Math.max(1, beats - 1); });
    for (let k = 0; k < sc.n; k++) {
      const el = $(sc.id + '-f' + k);
      // The entrance must end before the next beat: a tween still running after the hide below would paint the item back.
      const d = Math.max(0.05, Math.min(${focus ? '0.3' : '0.2'}, (k + 1 < beats ? T[k + 1] : e) - T[k] - 0.05));
      tl.fromTo(el, ${focus ? "{ opacity: 0, scale: 1.06, filter: 'blur(14px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: d, ease: EXO, immediateRender: false }" : '{ opacity: 0, scale: 1.1 }, { opacity: 1, scale: 1, duration: d, ease: X, immediateRender: false }'}, T[k]);
      if (k + 1 < beats) tl.set(el, { opacity: 0 }, T[k + 1]);
    }
    if (sc.title) fadeUp($(sc.id + '-ft'), T[sc.n], { y: 24, d: 0.5 });
  },
` : ''}${hasVideo && stage ? `  video(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.35); fadeUp(g.querySelector('.vt'), s + 0.45, { d: 0.7 }); fadeUp(g.querySelector('.stx'), cue(sc, 0.5));
  },
` : hasVideo ? `  video(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.vt'), s + 0.1, { d: 0.6 });
    pop($(sc.id + '-win'), s + 0.2, { from: 0.92 }); fadeUp(g.querySelector('.stx'), cue(sc, 0.6));
  },
` : ''}${hasModel ? `  anim(sc, s) { KINDS.model(sc, s); },
  model(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.vt'), s + 0.1, { d: 0.6 });
    pop($(sc.id + '-win'), s + 0.15, { from: 0.85 }); fadeUp(g.querySelector('.stx'), cue(sc, 0.55));
  },
` : ''}  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body, scenes, js };
}
