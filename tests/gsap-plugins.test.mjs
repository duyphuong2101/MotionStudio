// Opt-in GSAP plugins: brand.reveal (SplitText), brand.ease (CustomEase) and brand.confetti (Physics2D). A page whose
// brand asks for none of them is the page it was (the pinned page tests hold that); one that asks gets the plugin,
// and in Chrome the effect plays the same forwards and after a jump back.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { openComposition, lintInPage } from '../engine/media.mjs';
import { playCheck, PLAY_DEFAULTS } from '../engine/playcheck.mjs';
import { MOTION_PROFILES, EASES, brandEase, motionProfile, validateBrand } from '../engine/brand.mjs';
import { GSAP_FILES } from '../engine/vendor.mjs';
import { revealable } from '../templates/kit.mjs';
import { MOTION_OPTIONS } from '../ui/shots.js';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

const cfg = loadStudioConfig();
const BRAND = {
  name: 'Plug Co', logo: null, logoDark: null, logoText: 'Plug', site: '',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Arial', body: 'Arial', googleFonts: '' },
  voice: { tts: 'none', voice: '', speed: 1, lang: 'en' }, music: { file: null, gainDb: -18 }, sources: { allowedHosts: [] },
};
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };

async function samplePage(brand, tid = 'explainer', format = '16:9') {
  const { dir, beats } = loadTemplate(tid);
  const script = sampleScript(beats);
  const tight = motionProfile(brand).tight;
  const timing = estimateTiming(script, { ...TIMING, ...(tight ? { tight: cfg.timing.tight } : {}) }, 'en', beats.pace || null, null, null, tight);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  return { html: build({ brief: { format }, brand, script, timing, size: sizeFor(beats, format), icons: {} }), size: sizeFor(beats, format) };
}

test('brand.reveal, brand.ease and brand.confetti are checked and stored only when on', () => {
  const v = (o) => validateBrand({ ...BRAND, ...o });
  assert.equal(v({ reveal: 'chars' }).reveal, 'chars');
  assert.equal(v({ reveal: 'lines' }).reveal, 'lines');
  assert.equal('reveal' in v({ reveal: 'words' }), false, 'words is the default and not stored');
  assert.throws(() => v({ reveal: 'letters' }), /reveal must be words or one of chars, lines/);
  assert.equal(v({ ease: 'spring' }).ease, 'spring');
  assert.equal(v({ ease: ' M0,0 C0.3,0 0.2,1 1,1 ' }).ease, 'M0,0 C0.3,0 0.2,1 1,1');
  assert.equal('ease' in v({ ease: 'profile' }), false);
  for (const bad of ['bounce', 'M0,0 C0.3,0 0.2,1 0.9,0.9', 'M0,0 C0.3,0 0.2,1 1,1;alert(1)', `M0,0 ${'L0.5,0.5 '.repeat(80)}L1,1`]) {
    assert.throws(() => v({ ease: bad }), /ease must be snappy, soft, spring or a curve/, bad.slice(0, 40));
  }
  assert.equal(v({ confetti: true }).confetti, true);
  assert.equal('confetti' in v({ confetti: false }), false);
  assert.throws(() => v({ confetti: 'yes' }), /confetti must be true or false/);
  // The spring preset: a path from 0,0 to 1,1 that overshoots by about a tenth and settles.
  const ys = EASES.spring.split(/[ ML]+/).filter(Boolean).map((p) => +p.split(',')[1]);
  assert.ok(Math.max(...ys) > 1.05 && Math.max(...ys) < 1.2, `peak ${Math.max(...ys)}`);
  assert.ok(Math.abs(ys.at(-2) - 1) < 0.01, 'settled before the end');
  assert.equal(brandEase('spring'), EASES.spring);
});

test('the Brand tab shows the heading reveal exactly for the motion styles the kit reveals with', () => {
  for (const o of MOTION_OPTIONS) assert.equal(!!o.reveal, revealable(MOTION_PROFILES[o.id]), o.id);
  for (const f of ['SplitText.min.js', 'CustomEase.min.js', 'Physics2DPlugin.min.js']) assert.ok(GSAP_FILES.includes(f), `${f} is copied into every job`);
});

test('a page loads a plugin only when its brand asks, and reveal skips the profiles that reveal on their own', async () => {
  const plain = (await samplePage(BRAND)).html;
  assert.ok(!/SplitText|CustomEase|Physics2D/.test(plain), 'no opt-in plugin in a plain page');
  const all = (await samplePage({ ...BRAND, reveal: 'chars', ease: 'snappy', confetti: true })).html;
  for (const p of ['SplitText', 'CustomEase', 'Physics2DPlugin']) assert.ok(all.includes(`<script src="vendor/${p}.min.js"></script>`), p);
  assert.ok(all.includes('gsap.registerPlugin(SplitText, CustomEase, Physics2DPlugin);') && all.includes("CustomEase.create('brand', D.ease);"));
  assert.ok(all.includes("const X = 'brand'"), 'the brand curve is the default ease');
  const cine = (await samplePage({ ...BRAND, motion: 'cinematic', reveal: 'chars' })).html;
  assert.ok(!cine.includes('SplitText'), 'cinematic reveals headings word by word on its own');
});

// Real Chrome: the explainer sample with every plugin on. Headings come in by character (then by line), the brand
// curve overshoots, confetti flies from the call-to-action button, and the page lints and plays through clean.
test('in Chrome: characters and lines reveal, the spring curve, confetti that lands the same after a jump', { timeout: 300000 }, async (t) => {
  if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
  const folder = await chromeFolder(t, 'ms-plugins-');
  for (const reveal of ['chars', 'lines']) {
    const brand = { ...BRAND, reveal, ease: 'spring', confetti: true };
    const { html, size } = await samplePage(brand);
    const file = folder.write(`${reveal}.html`, html);
    const { browser, page, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size });
    try {
      const first = info.scenes[0];
      const parts = await page.evaluate((cls) => {
        const hd = document.querySelector('#stage .sc .hd');
        return { pieces: hd.querySelectorAll('.' + cls).length, masks: hd.querySelectorAll('.kitline-mask').length, text: hd.textContent.replace(/\s+/g, ' ').trim() };
      }, reveal === 'chars' ? 'rc' : 'kitline');
      assert.ok(parts.pieces > (reveal === 'chars' ? 4 : 0), `${reveal}: ${parts.pieces} pieces`);
      if (reveal === 'lines') assert.equal(parts.masks, parts.pieces, 'each line rises out of its own mask');
      assert.ok(parts.text.length > 2, 'the heading text is still there');
      // Early in the reveal some pieces are still hidden or low; by the scene's still every piece is in place.
      const state = (at) => page.evaluate(async ([x, cls]) => {
        await window.seek(x);
        return [...document.querySelector('#stage .sc .hd').querySelectorAll('.' + cls)].map((p) => [+getComputedStyle(p).opacity, new DOMMatrix(getComputedStyle(p).transform).f]);
      }, [at, reveal === 'chars' ? 'rc' : 'kitline']);
      const early = await state(first.start + 0.12), done = await state(info.stills[0].t);
      assert.ok(early.some(([o, y]) => o < 0.5 || Math.abs(y) > 1), `${reveal}: something is still on its way in early`);
      assert.ok(done.every(([o, y]) => o > 0.99 && Math.abs(y) < 0.5), `${reveal}: all in by the still ${JSON.stringify(done.slice(0, 3))}`);

      const peak = await page.evaluate(() => { const e = gsap.parseEase('brand'); let m = 0; for (let k = 0; k <= 100; k++) m = Math.max(m, e(k / 100)); return m; });
      assert.ok(peak > 1.05, `the spring curve overshoots: ${peak}`);

      const cta = info.scenes.find((s) => s.kind === 'cta');
      assert.ok(cta, 'the sample has a call to action');
      const pieces = (at) => page.evaluate(async (x) => {
        await window.seek(x);
        return [...document.querySelectorAll('.cft i')].map((p) => [+(+getComputedStyle(p).opacity).toFixed(3), getComputedStyle(p).transform]);
      }, at);
      const before = await pieces(cta.start + 0.02);
      assert.equal(before.length, 42);
      assert.ok(before.every(([o]) => o === 0), 'no confetti before the button lands');
      let burst = null;
      for (let x = cta.start; x < cta.end && burst === null; x += 0.05) if ((await pieces(x)).some(([o]) => o > 0)) burst = x;
      assert.ok(burst !== null && burst < cta.end - 1, `the burst starts at ${burst} in a scene of ${cta.start}-${cta.end}`);
      const mid = burst + 0.6;
      const flying = await pieces(mid);
      assert.ok(flying.filter(([o, m]) => o > 0 && m !== 'none').length > 30, 'the burst is in the air');
      await pieces(cta.end - 0.1);
      assert.deepEqual(await pieces(mid), flying, 'a jump back lands every piece where it was');

      for (const st of info.stills) {
        await page.evaluate((at) => window.seek(at), st.t);
        assert.deepEqual(await page.evaluate(lintInPage, cfg.lint.safeArea), [], `${reveal} ${st.id}`);
      }
      const { findings } = await playCheck(page, info, { ...PLAY_DEFAULTS, step: 1 / 6, safeArea: cfg.lint.safeArea });
      assert.deepEqual(findings.filter((f) => f.level === 'error'), [], reveal);
    } finally {
      await browser.close();
    }
  }
});
