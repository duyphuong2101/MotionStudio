// A Lottie scene: a .json animation (the brand's own After Effects or LottieFiles export, a brand asset) played by
// lottie-web's SVG renderer inside a box the template places. Every frame is a pure function of seek(t): the page
// seeks the animation to the scene's own time with goToAndStop, never plays it. The player is vendored flat into the
// job's vendor/ like three (engine/vendor.mjs copyLottie).
import { escapeHtml as h } from '../engine/core.mjs';

export const LOTTIE_FITS = ['contain', 'cover'];

/**
 * The box a template puts where the animation shows; the scene's start and end come from the timing. `loop`
 * (default true) repeats a short animation to the scene's end; `fit` is contain (default) or cover.
 */
export const lottieBox = (name, t, { loop = true, fit = 'contain' } = {}) =>
  `<div class="lot" data-lottie="${h(`assets/${encodeURIComponent(name)}`)}" data-start="${t.start}" data-end="${t.end}"${loop ? '' : ' data-once="1"'} data-fit="${LOTTIE_FITS.includes(fit) ? fit : 'contain'}"></div>`;

export const hasLotties = (body) => /<div [^>]*data-lottie=/.test(body);

/** Waited for before build(): resolves once every animation is loaded, or rejects naming the file. */
export const LOTTIE_WAIT = `
const lottiesLoaded = new Promise((ok, no) => { window.__lottiesOk = ok; window.__lottiesFail = no; });`;

// Each box loads its file once and is seeked by time: from its scene start, in milliseconds, looped unless
// data-once, held on its last frame after. Subframe rendering keeps the SVG exact at any time.
export const LOTTIE_JS = String.raw`
<script src="vendor/lottie.min.js"></script>
<script>
(() => {
  const boxes = [...document.querySelectorAll('div[data-lottie]')];
  const anims = [];
  Promise.all(boxes.map((el) => new Promise((ok, no) => {
    const ds = el.dataset, name = decodeURIComponent(ds.lottie.replace(/^assets\//, ''));
    const anim = lottie.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: false, path: ds.lottie, rendererSettings: { preserveAspectRatio: ds.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet', progressiveLoad: false } });
    anim.setSubframe(true);
    anim.addEventListener('DOMLoaded', () => {
      const start = +ds.start, end = +ds.end, ms = anim.getDuration(false) * 1000, once = ds.once === '1';
      let shown = NaN;
      anims.push((t) => {
        const c = Math.min(end, Math.max(start, t)), u = (c - start) * 1000;
        const at = once ? Math.min(u, ms - 1) : u % ms;
        if (at !== shown) { shown = at; anim.goToAndStop(at, false); }
      });
      ok();
    });
    anim.addEventListener('data_failed', () => no(new Error('The animation ' + name + ' could not be loaded')));
    anim.addEventListener('error', (e) => no(new Error('The animation ' + name + ' failed: ' + (e && e.message || e))));
  }))).then(() => { window.__drawLotties = (t) => anims.forEach((f) => f(t)); anims.forEach((f) => f(0)); window.__lottiesOk(); }, (err) => window.__lottiesFail(err));
})();
</script>`;
