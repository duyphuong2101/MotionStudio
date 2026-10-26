// product-demo in 16:9, 1:1, 9:16 and 4:5, with an optional 3D model in the hero; social-teaser keeps its 9:16 rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { UNDER_BUG, contentArea, geometry } from '../templates/kit.mjs';
import { SPINS, MODEL_HEAD, MODEL_WAIT, MODEL_JS } from '../templates/model3d.mjs';
import { build, fitRows } from '../templates/product-demo/template.mjs';
import { build as frozen } from './fixtures/product-demo-9x16.mjs';

const BRAND = {
  name: 'Demo Co', logoText: 'Demo',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};
const BUG = { ...BRAND, logo: 'l.svg', logoDark: 'd.svg', logoBug: true };
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
const beats = loadTemplate('product-demo').beats;
const ASSETS = ['pack.png', 'model.glb'];

const benefit = (n) => ({ id: `b${n}`, kind: 'benefit', vo: 'Guards on both sides.', kicker: 'Leak guards', text: 'Tall guards keep it in', chip: 'Peace of mind', icon: n % 2 ? 'shield' : 'drop', decor: 'waves', source: 'bullets[1]' });
const script = (hero = {}, benefits = 3) => ({
  lang: 'en',
  scenes: [
    { id: 'hero', kind: 'hero', vo: 'Meet the product.', title: 'MegaMax Night', subtitle: 'Dry all night', packLine: '12 pads', source: 'facts[0]', ...hero },
    { id: 's1', kind: 'stat', vo: 'Twelve hours of protection.', kicker: 'Absorbency', stat: { value: 12, unit: 'h' }, text: 'of protection', chip: 'Up to 12 hours', icon: 'drop', source: 'bullets[0]' },
    ...Array.from({ length: benefits - 1 }, (_, k) => benefit(k + 1)),
    { id: 'cta', kind: 'cta', vo: 'Try a sample.', title: 'Try a sample', button: 'Get it', url: 'example.com', source: 'facts[1]' },
  ],
});
const page = (brand, sc, format) => build({ brief: { format }, brand, script: sc, timing: estimateTiming(sc, TIMING, 'en'), size: sizeFor(beats, format) });
// One declaration of a rule in the page's css, in px.
const prop = (html, sel, name) => {
  const rule = html.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')}\\{([^}]*)\\}`));
  assert.ok(rule, `${sel} is in the css`);
  return Number(rule[1].match(new RegExp(`(?:^|;)${name}:(-?[\\d.]+)px`))[1]);
};

test('a 9:16 page without a 3D model builds byte for byte as before the new formats', () => {
  const brands = [BRAND, { ...BRAND, subtitles: { style: 'classic' } }, { ...BUG, subtitles: { style: 'pop', size: 80 } }, { ...BRAND, shine: true, leaks: true }];
  const scripts = [script(), script({ asset: 'pack.png' }, 2), script({ title: 'Save [[circle:40%]]' }, 3)];
  for (const brand of brands) {
    for (const sc of scripts) {
      const timing = estimateTiming(sc, TIMING, 'en');
      const before = frozen({ brand, script: sc, timing });
      assert.equal(build({ brand, script: sc, timing }), before, 'no size given');
      assert.equal(build({ brief: { format: '9:16' }, brand, script: sc, timing, size: sizeFor(beats, '9:16') }), before, '9:16 size');
    }
  }
});

test('landscape puts the pack beside the text; portrait, square and 4:5 stack the text under it', () => {
  for (const format of beats.formats) {
    const html = page(BRAND, script(), format);
    const packLeft = prop(html, '.packw', 'left'), packTop = prop(html, '.packw', 'top'), pack = prop(html, '.packw', 'width');
    if (format === '16:9') assert.ok(packLeft + pack <= prop(html, '.herotext', 'left'), `${format}: the text starts right of the pack`);
    else assert.ok(packTop + pack <= prop(html, '.herotext', 'top'), `${format}: the text starts under the pack`);
  }
});

test('in 16:9, 1:1 and 4:5 every scene sits centred between the corner logo and the caption band', () => {
  for (const format of ['16:9', '1:1', '4:5']) {
    for (const brand of [BRAND, { ...BUG, subtitles: { style: 'pop', size: 80 } }]) {
      const size = sizeFor(beats, format), A = contentArea(brand, geometry(size));
      const top = A.top, bottom = size.height - A.bottom, mid = (top + bottom) / 2;
      const html = page(brand, script(), format);
      const near = (v, what, tol = 40) => assert.ok(Math.abs(v - mid) <= tol, `${format}: ${what} at ${v}, centre ${mid}`);
      const packTop = prop(html, '.packw', 'top'), pack = prop(html, '.packw', 'width');
      assert.ok(packTop >= top, `${format}: pack under the logo line`);
      if (format === '16:9') {
        assert.ok(pack >= 0.55 * size.height || pack >= (bottom - top) / 1.09 - 1, `${format}: a large pack (${pack})`);
        near(packTop + pack / 2, 'pack centre');
        assert.equal(prop(html, '.herotext', 'top') + prop(html, '.herotext', 'height') / 2, packTop + pack / 2, `${format}: the title centres on the pack`);
        near(prop(html, '.ring', 'top') + prop(html, '.ring', 'width') / 2, 'ring centre', 1);
        near(prop(html, '.ctatext', 'top') + prop(html, '.ctatext', 'height') / 2, 'card centre', 1);
      } else {
        // Stacked: the hero text and the stat text reach the lower half of the area.
        assert.ok(prop(html, '.herotext', 'top') > mid && prop(html, '.btxt', 'top') > mid, `${format}: text under the visual`);
      }
      // The stat block: kicker at its top, the text under the number (or the ring) ends no lower than the band.
      assert.ok(prop(html, '.kicker', 'top') >= top && prop(html, '.kicker', 'top') < mid, `${format}: kicker in the upper half`);
      assert.match(html, /\.g:has\(> \.decor\) > \.kicker\{top:\d+px\}/, `${format}: a benefit centres its own text`);
    }
  }
});

test('in every format the rows start under the corner logo and the text column ends inside the frame', () => {
  for (const format of beats.formats) {
    const { width } = sizeFor(beats, format);
    const html = page(BUG, script(), format);
    for (const sel of ['.packw', '.kicker']) assert.ok(prop(html, sel, 'top') >= UNDER_BUG, `${format}: ${sel} under the logo`);
    for (const sel of ['.btxt', '.ctatext']) assert.ok(prop(html, sel, 'left') + prop(html, sel, 'width') <= width - 48, `${format}: ${sel} inside the safe area`);
  }
});

test('with subtitles every text row starts above the caption band; without them nothing moves', () => {
  for (const format of beats.formats) {
    const size = sizeFor(beats, format);
    for (const subtitles of [{ style: 'classic' }, { style: 'pop', size: 80 }]) {
      const brand = { ...BRAND, subtitles };
      assert.equal(fitRows(brand, false, size).y(1234), 1234, `${format}: no subtitles, no squeeze`);
      assert.ok(fitRows(brand, true, size).s(100) <= 100, `${format}: the type never grows`);
      const band = size.height - contentArea(brand, geometry(size)).bottom;
      const html = page(brand, script(), format);
      for (const sel of ['.herotext', '.btxt', '.ctatext']) assert.ok(prop(html, sel, 'top') < band, `${format} ${subtitles.style}: ${sel} above the band`);
    }
  }
  // Without a size, fitRows is the 9:16 fit it always was.
  const classic = { ...BRAND, subtitles: { style: 'classic' } };
  assert.equal(fitRows(classic, true).y(1620), fitRows(classic, true, sizeFor(beats, '9:16')).y(1620));
});

test('a hero with a 3D model shows it in the pack window and loads three.js; without one the page has no model code', () => {
  for (const format of beats.formats) {
    const html = page(BRAND, script({ asset: 'pack.png', model: 'model.glb', spin: 'orbit' }), format);
    assert.match(html, /<div class="packw" id="hero-pack" data-lint><canvas class="m3c"[^>]* data-model="assets\/model\.glb"[^>]* data-spin="orbit"/, format);
    assert.ok(html.includes(MODEL_HEAD) && html.includes(MODEL_WAIT) && html.includes(MODEL_JS), `${format}: three.js is wired`);
    // A fixed square, centred on the pack window and larger than it, so its size is final before three.js reads it.
    const pack = prop(html, '.packw', 'width'), box = prop(html, '.m3c', 'width');
    assert.equal(prop(html, '.m3c', 'height'), box, `${format}: square canvas`);
    assert.ok(box > pack && Math.abs(prop(html, '.m3c', 'left') * 2 + box - pack) <= 1 && prop(html, '.m3c', 'top') === prop(html, '.m3c', 'left'), `${format}: centred on the pack`);
    assert.ok(html.includes('.g:has(.m3c) > .shadow{display:none}'), `${format}: the model draws its own contact shadow`);
    assert.ok(html.includes('tl.fromTo(pack, { opacity: 0 }, { opacity: 1, duration: 0.8 }, s)'), `${format}: the model window only fades in`);
    assert.ok(!html.includes('class="packimg"') && !html.includes("el('sweep')"), `${format}: no pack image or sweep`);
    const plain = page(BRAND, script(), format);
    assert.ok(!plain.includes('data-model') && !plain.includes('importmap') && !plain.includes('.m3c'), `${format}: no model code`);
  }
});

test('product-demo takes 2-5 benefits, 10-60 s, a .glb model from the assets and a spin from model3d', () => {
  assert.deepEqual(beats.durations, [10, 60]);
  assert.deepEqual(beats.enums.spin, SPINS, 'beats.json lists every spin model3d draws');
  assert.deepEqual(validateScript(script({ model: 'model.glb', spin: 'hero' }, 5), beats, { assets: ASSETS }).errors, []);
  assert.ok(validateScript(script({}, 6), beats, { assets: ASSETS }).errors.some((e) => e.includes('unexpected scene')));
  assert.ok(validateScript(script({}, 1), beats, { assets: ASSETS }).errors.some((e) => e.includes('expected 2-5')));
  const errs = (hero) => validateScript(script(hero), beats, { assets: ASSETS }).errors.join(' | ');
  assert.match(errs({ model: 'pack.png' }), /model must be a \.glb file/);
  assert.match(errs({ model: 'other.glb' }), /model "other\.glb" is not in the project assets/);
  assert.match(errs({ model: 'model.glb', spin: 'wobble' }), /spin must be turn\|orbit\|hero/);
});

test('social-teaser keeps its 9:16 format, its own limits and no 3D model', () => {
  const teaser = loadTemplate('social-teaser').beats;
  assert.deepEqual(teaser.formats, ['9:16']);
  assert.equal(teaser.sizes, undefined);
  assert.deepEqual(teaser.durations, [6, 15]);
  assert.equal(teaser.limits.voWords, 14);
  assert.deepEqual(teaser.sequence[1], { kind: ['stat', 'benefit'], min: 1, max: 1 });
  assert.ok(!teaser.fields.hero.optional.includes('model'));
  assert.deepEqual(sizeFor(teaser, '9:16'), { width: 1080, height: 1920 });
});
