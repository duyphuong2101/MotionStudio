// A 3D product tour: one model canvas (templates/model3d.mjs `tourCanvas`) fills the frame for the whole video
// while the camera glides from step to step with no cut; each step is a caption over it, and the parts it names
// come out of the model. The title opens over the model rising in; the call to action closes on the brand colour.
import { page, geometry, h, hasLogoBug, contentArea, themeClass, ACCENT_CSS } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { tourCanvas } from '../model3d.mjs';
import { iconSet } from '../../motion-kit/icons.mjs';
import { decalOf, CTA_BG_CSS } from '../explainer/template.mjs';

export function build(args) {
  return page({ ...args, title: 'product-tour', ...parts(args), layers: false });
}

/** css, body, scenes and js for page(). */
export function parts({ brand, script, timing, size, icons }) {
  const ICONS = iconSet(icons);
  const g = geometry(size);
  const { px, padX, port, land, short } = g;
  const A = contentArea(brand, g);
  const tById = Object.fromEntries((timing?.scenes || []).map((s) => [s.id, s]));
  const at = (id) => tById[id] || { start: 0, end: 0 };
  // The rules require a title with the model first and 1-8 steps, so these always exist after validation.
  const scenesIn = script.scenes;
  const model = scenesIn.find((s) => s.model).model;
  const steps = scenesIn.filter((s) => s.kind === 'step');
  const first = scenesIn[0], lastStep = steps[steps.length - 1];
  // The camera's stops: the title holds the first step's pose, so the model is already in place when it is named.
  // Under the title the model sits low; at a step it moves right of the caption (landscape) or above it (portrait, square).
  const titleOff = [0, port ? 0.1 : 0.14], stepOff = land ? [0.2, 0.02] : port ? [0, -0.14] : [0, -0.12];
  const stops = [{ t: at(first.id).start, view: steps[0]?.view, explode: [], gap: steps[0]?.gap, offset: titleOff }, ...steps.map((s) => ({ t: at(s.id).start, view: s.view, explode: s.explode, gap: s.gap, offset: stepOff }))];
  const canvas = `<div class="tour-stage">${tourCanvas(model, { start: at(first.id).start, end: at(lastStep.id).end }, stops, { decal: decalOf(first.decal, ICONS, brand), env: first.env, colors: brand.colors })}</div>`;
  const scenes = [];
  const blocks = [];
  let n = 0;
  for (const sc of scenesIn) {
    const id = sc.id;
    if (sc.kind === 'title') {
      const dk = sc.theme === 'dark', acc = sc.theme === 'accent';
      // A themed title keeps the model visible: the theme colour is a plate behind the text, not the whole frame.
      blocks.push(`<div class="sc fill${dk || acc ? `${themeClass(sc)} tplate` : ''}" id="g-${id}"><div class="ttl">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd tt" data-lint>${h(sc.title)}</div>${sc.subtitle ? `<div class="tsub" data-lint>${h(sc.subtitle)}</div>` : ''}
        <div class="tline" id="${id}-tl"></div></div></div>`);
      scenes.push(dk ? { id, kind: 'title', dark: true } : { id, kind: 'title' });
    } else if (sc.kind === 'step') {
      n += 1;
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="cap"><div class="kick" data-lint>${h(sc.kicker || `${String(n).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`)}</div>
        <div class="hd st" data-lint>${h(sc.title)}</div>${sc.text ? `<div class="stx" data-lint>${h(sc.text)}</div>` : ''}
        <div class="dots">${steps.map((_, k) => `<i${k === n - 1 ? ' class="on"' : ''}></i>`).join('')}</div></div></div>`);
      scenes.push({ id, kind: 'step' });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}">${sc.image ? `<img class="ctabg" src="assets/${encodeURIComponent(sc.image)}" alt="">` : ''}<div class="cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  // The caption sits in the lower third in landscape and square; in portrait it sits in the lower half, above the
  // subtitles, with the model framed in the upper part.
  const capW = land ? 700 : port ? 900 : 860;
  const capBottom = A.bottom + (port ? 60 : 40);
  const css = `
.tour-stage{position:absolute;inset:0;z-index:0}
.tour-stage canvas{position:absolute;inset:0;width:100%;height:100%}
.sc{z-index:1}
.ttl{position:absolute;left:${padX(100)};right:${padX(100)};top:${px(port ? 150 : 90)};display:flex;flex-direction:column;gap:${px(18)};align-items:center;text-align:center}
.kick{font-size:${px(port ? 30 : 26)};font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--primary2)}
.hd{font-family:var(--display);font-weight:700;letter-spacing:-.015em;line-height:1.05}
.tt{font-size:${px(port ? 84 : land ? 88 : 76)};max-width:${px(port ? 900 : 1300)}}
.tsub{font-size:${px(port ? 40 : 36)};color:var(--muted);max-width:${px(port ? 820 : 1100)}}
.tline{width:${px(160)};height:${px(6)};border-radius:${px(3)};background:var(--secondary);transform:scaleX(0)}
.cap{position:absolute;left:${padX(port ? 90 : 110)};bottom:${px(capBottom)};width:${px(capW)};display:flex;flex-direction:column;gap:${px(14)};${port ? '' : 'text-align:left'}}
.st{font-size:${px(port ? 64 : land ? 66 : 58)}}
.stx{font-size:${px(port ? 34 : 32)};line-height:1.35;color:var(--muted);max-width:${px(capW)}}
.dots{display:flex;gap:${px(10)};margin-top:${px(8)}}.dots i{display:block;width:${px(14)};height:${px(6)};border-radius:${px(3)};background:var(--primary);opacity:.25}.dots i.on{width:${px(40)};opacity:1;background:var(--secondary)}
.cta{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${px(26)};text-align:center;padding:0 ${padX(120)}}
.clogo{height:${px(port ? 120 : 96)};display:flex;align-items:center;margin-bottom:${px(10)}}.clogo img,.clogo svg{height:100%;width:auto}
.ctat{font-size:${px(port ? 84 : 88)};max-width:${px(port ? 900 : 1300)}}
.btn{font-size:${px(port ? 40 : 36)};font-weight:700;background:var(--secondary);color:var(--ink);padding:${px(22)} ${px(54)};border-radius:${px(999)}}
.curl{font-size:${px(30)};opacity:.75;letter-spacing:.06em}
${short ? '.tt{font-size:' + px(72) + '}.st{font-size:' + px(52) + '}' : ''}${ACCENT_CSS}${scenesIn.some((s) => s.kind === 'cta' && s.image) ? '\n' + CTA_BG_CSS : ''}${scenesIn.some((s) => s.kind === 'title' && ['dark', 'accent'].includes(s.theme)) ? `
.sc.tplate{background:transparent}.tplate .ttl{left:50%;right:auto;transform:translateX(-50%);width:max-content;max-width:${px(port ? 940 : 1400)};padding:${px(36)} ${px(56)};border-radius:${px(28)}}
.dark.tplate .ttl{background:var(--primary)}.dark.tplate .tsub{color:var(--on);opacity:.75}.acc.tplate .ttl{background:var(--secondary)}` : ''}`;
  const js = `
const KINDS = {
  title(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.35); fadeUp(g.querySelector('.tt'), s + 0.5, { d: 0.8, y: 30 }); fadeUp(g.querySelector('.tsub'), s + 0.8);
    tl.fromTo($(sc.id + '-tl'), { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: XIO, immediateRender: false }, s + 1.0);
  },
  step(sc, s, e) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.25); fadeUp(g.querySelector('.st'), s + 0.35, { d: 0.6, y: 26 }); fadeUp(g.querySelector('.stx'), cue(sc, 0.45));
    fadeUp(g.querySelector('.dots'), s + 0.3, { y: 10 });
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: canvas + blocks.join('\n'), scenes, js };
}
