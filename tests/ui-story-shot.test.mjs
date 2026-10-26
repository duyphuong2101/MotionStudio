import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTemplate } from '../engine/jobs.mjs';
import { loadStudioConfig } from '../engine/core.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { composeBeats, buildMixed } from '../engine/mix.mjs';
import { camera } from '../templates/kit.mjs';

const rules = (id) => loadTemplate(id).beats;
const cfg = loadStudioConfig();
const BRAND = { name: 'Shot Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
const ASSETS = ['csr-orders.png', 'csr-dashboard.png'];
const APP = { name: 'Console', nav: [{ label: 'Orders', icon: 'cart' }] };

const scene = (beats, kind, id, more = {}) => ({ id, kind, vo: 'One short line.', source: 'facts[0]', ...beats.defaults[kind], ...more });
const shot = (more = {}) => ({ asset: 'csr-orders.png', focus: { x: 288, y: 216, w: 1600, h: 660 }, cursor: { x: 1822, y: 296 }, click: true, highlight: true, ...more });
const uiStoryScript = (b, shots = [shot()]) => ({ app: APP, scenes: [
  scene(b, 'title', 'intro'), scene(b, 'ui', 'dash'), scene(b, 'shot', 'orders', { shots }), scene(b, 'cta', 'end'),
] });

test('a ui-story shot scene with a project screenshot passes the rules', () => {
  const b = rules('ui-story');
  assert.deepEqual(validateScript(uiStoryScript(b), b, { assets: ASSETS }).errors, []);
});

test('a shot whose screenshot is not in the project assets is an error', () => {
  const b = rules('ui-story');
  const { errors } = validateScript(uiStoryScript(b, [shot({ asset: 'missing.png' })]), b, { assets: ASSETS });
  assert.deepEqual(errors, ['orders.shots[0]: asset "missing.png" is not in the project assets']);
});

test('a shot focus outside the 1920x1080 screenshot is an error', () => {
  const b = rules('ui-story');
  const { errors } = validateScript(uiStoryScript(b, [shot({ focus: { x: 1800, y: 0, w: 400, h: 300 } })]), b, { assets: ASSETS });
  assert.ok(errors.some((e) => e.startsWith('orders.shots[0]: focus must be {x,y,w,h} inside 1920x1080')), errors.join('; '));
});

test('a shot scene needs at least one shot and at most four', () => {
  const b = rules('ui-story');
  assert.ok(validateScript(uiStoryScript(b, []), b, { assets: ASSETS }).errors.includes('orders: shots is required'));
  assert.ok(validateScript(uiStoryScript(b, Array(5).fill(shot())), b, { assets: ASSETS }).errors.includes('orders: at most 4 shots per scene'));
});

test('ui-story adds ui-story.shot to a mix and its shots follow ui-story rules there', () => {
  const c = composeBeats(rules('explainer'), [rules('ui-story')]);
  assert.ok(c.sequence[1].kind.includes('ui-story.shot'));
  const script = { app: APP, scenes: [scene(c, 'title', 't'), scene(c, 'ui-story.shot', 'orders', { shots: [shot({ asset: 'gone.png' })] }), scene(c, 'cta', 'c')] };
  assert.deepEqual(validateScript(script, c, { assets: ASSETS }).errors, ['orders.shots[0]: asset "gone.png" is not in the project assets']);
});

test('a ui-story page with a shot draws the screenshot inside the window with its camera', async () => {
  const { dir, beats } = loadTemplate('ui-story');
  const script = uiStoryScript(beats);
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const html = build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') });
  assert.ok(html.includes('<img class="shimg" id="shot-orders-0" src="assets/csr-orders.png" alt="">'));
  assert.ok(html.includes("['title', 'ui', 'beat', 'cta', 'shot']"));
  assert.ok(html.includes(`"cam":${JSON.stringify(camera(shot().focus))}`));
  assert.ok(html.includes('<div class="ui-cap" data-lint>In the app · The real screen</div>'));
});

test('a mixed page with ui-story.shot builds once, with no element id twice', async () => {
  const c = composeBeats(rules('explainer'), [rules('ui-story')]);
  const script = { app: APP, scenes: [
    scene(c, 'title', 't'), scene(c, 'step', 's1'), scene(c, 'ui-story.ui', 'dash'),
    scene(c, 'ui-story.shot', 'orders', { shots: [shot(), shot({ asset: 'csr-dashboard.png', focus: null, cursor: null, click: false })] }), scene(c, 'cta', 'c'),
  ] };
  assert.deepEqual(validateScript(script, c, { assets: ASSETS }).errors, []);
  const timing = estimateTiming(script, cfg.timing, 'en', c.pace);
  const html = await buildMixed({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(c, '16:9') }, c);
  assert.equal(html.split('window.seek = ').length, 2);
  assert.ok(html.includes('"id":"orders","kind":"shot"') && html.includes('.t-ui-story #shots{'));
  assert.ok(html.includes('src="assets/csr-dashboard.png"'));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no element id twice');
});
