// product-tour: one model canvas for the whole video with a stop per step; the script check on the step fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { build } from '../templates/product-tour/template.mjs';
import { tourCanvas, VIEW_RANGE, PATH_POSES } from '../templates/model3d.mjs';

const { beats } = loadTemplate('product-tour');
const BRAND = { name: 'Tour Co', logoText: 'Tour', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
const step = (id, extra) => ({ id, kind: 'step', vo: 'One stop of the tour.', title: 'A stop', model: 'pack.glb', source: 'bullets[0]', ...extra });
const script = { lang: 'en', scenes: [
  { id: 'open', kind: 'title', vo: 'Meet it.', title: 'Meet it', model: 'pack.glb' },
  step('front', { view: { azimuth: -30, zoom: 1.2 }, explode: ['front'], gap: 0.6 }),
  step('back', { view: { azimuth: 150, elevation: 20 } }),
  step('top', { view: { elevation: 55 }, explode: ['front', 'back'] }),
  { id: 'cta', kind: 'cta', vo: 'Shop now.', title: 'Shop now', button: 'Shop' },
] };

test('the product-tour rules match the model renderer', () => {
  assert.deepEqual(beats.data.step.view, VIEW_RANGE);
  assert.ok(beats.fields.step.required.includes('model') && beats.fields.title.required.includes('model'));
  assert.equal(beats.data.step.path, undefined, 'a tour step has one pose; the tour itself is the path');
  assert.ok(PATH_POSES[1] >= 2);
});

test('a tour script checks each step like a model scene', () => {
  const errs = (extra) => validateScript({ ...script, scenes: script.scenes.map((s) => (s.id === 'back' ? { ...s, ...extra } : s)) }, beats, { assets: ['pack.glb'] }).errors;
  assert.deepEqual(errs({}), []);
  assert.match(errs({ view: { zoom: 2 } }).join(), /back: view\.zoom must be a number from 0\.6 to 1\.6/);
  assert.match(errs({ explode: [] }).join(), /back: explode must list 1-6 part names/);
  assert.match(errs({ gap: 0 }).join(), /back: gap must be a number from 0\.1 to 1/);
  assert.match(errs({ model: 'other.glb' }).join(), /back: model "other\.glb" is not in the project assets/);
});

test('tourCanvas writes one canvas with a stop per step, poses clamped and parts filtered', () => {
  const c = tourCanvas('p.glb', { start: 1, end: 9 }, [{ t: 1, view: { azimuth: -400 }, explode: ['a', 'bad name'], gap: 3 }, { t: 4.5 }, { t: 7, view: { elevation: 10, zoom: 0.2 }, explode: ['b'], offset: [2, -0.2] }]);
  assert.match(c, /^<canvas class="m3c tour" data-gl data-model="assets\/p\.glb" data-start="1" data-end="9" data-spin="tour" data-steps="/);
  const steps = JSON.parse(c.match(/data-steps="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(steps, [
    { t: 1, pose: [-180, null, null], parts: ['a'], gap: 1, offset: [0, 0] },
    { t: 4.5, pose: [null, null, null], parts: [], gap: 0.45, offset: [0, 0] },
    { t: 7, pose: [null, 10, 0.6], parts: ['b'], gap: 0.45, offset: [0.34, -0.2] },
  ]);
  assert.doesNotMatch(c.match(/data-steps="([^"]*)"/)[1], /[<>"]/, 'the JSON is escaped inside the attribute');
});

test('the page holds one canvas across the title and every step, and a caption block per scene', () => {
  const timing = estimateTiming(script, TIMING, 'en', beats.pace);
  for (const format of beats.formats) {
    const html = build({ brief: { format }, brand: BRAND, script, timing, size: sizeFor(beats, format) });
    assert.equal((html.match(/<canvas class="m3c tour"/g) || []).length, 1, `${format}: one tour canvas`);
    const first = timing.scenes[0], last = timing.scenes.find((s) => s.id === 'top');
    assert.match(html, new RegExp(`data-start="${first.start}" data-end="${last.end}"`), `${format}: the canvas spans the title to the last step`);
    for (const sc of script.scenes) assert.ok(html.includes(`id="g-${sc.id}"`), `${format}: ${sc.id} drawn`);
    const steps = JSON.parse(html.match(/data-steps="([^"]+)"/)[1].replace(/&quot;/g, '"'));
    assert.equal(steps.length, 4, 'the title holds the first step pose, then one stop per step');
    assert.deepEqual(steps[0].pose, steps[1].pose);
    assert.deepEqual(steps[0].parts, []);
    assert.deepEqual(steps[3].parts, ['front', 'back']);
    assert.notDeepEqual(steps[0].offset, steps[1].offset, 'the model moves from under the title to beside the caption');
    assert.match(html, /window\.seek = /);
    assert.match(html, /three\.module\.js/, `${format}: three is loaded`);
  }
});

test('a cta may set a background photo; a page without one has no trace of it', () => {
  const timing = estimateTiming(script, TIMING, 'en', beats.pace);
  const size = sizeFor(beats, '16:9');
  const plain = build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size });
  assert.doesNotMatch(plain, /ctabg/);
  const withBg = { ...script, scenes: script.scenes.map((s) => (s.kind === 'cta' ? { ...s, image: 'pack shot.png' } : s)) };
  assert.deepEqual(validateScript(withBg, beats, { assets: ['pack.glb', 'pack shot.png'] }).errors, []);
  assert.match(validateScript(withBg, beats, { assets: ['pack.glb'] }).errors.join(), /cta: image "pack shot\.png" is not in the project assets/);
  const html = build({ brief: { format: '16:9' }, brand: BRAND, script: withBg, timing, size });
  assert.ok(html.includes('<img class="ctabg" src="assets/pack%20shot.png" alt="">'), 'the photo sits behind the cta, its name escaped');
  assert.ok(html.includes('.ctabg{position:absolute'), 'its css is written');
});

test('a dark or accent title keeps the model in view: the theme is a plate behind the text', () => {
  const timing = estimateTiming(script, TIMING, 'en', beats.pace);
  const size = sizeFor(beats, '16:9');
  const plain = build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size });
  assert.doesNotMatch(plain, /tplate/, 'a title without a theme is the page it was');
  for (const theme of ['dark', 'accent']) {
    const themed = { ...script, scenes: script.scenes.map((s) => (s.kind === 'title' ? { ...s, theme } : s)) };
    const html = build({ brief: { format: '16:9' }, brand: BRAND, script: themed, timing, size });
    assert.match(html, new RegExp(`class="sc fill ${theme === 'dark' ? 'dark' : 'acc'} tplate"`));
    assert.ok(html.includes('.sc.tplate{background:transparent}'), `${theme}: the frame stays clear over the model`);
  }
});
