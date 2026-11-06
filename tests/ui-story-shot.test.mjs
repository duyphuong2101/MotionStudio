import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { openComposition } from '../engine/media.mjs';
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

test('a shot cue must be one word of the scene voice line', () => {
  const b = rules('ui-story');
  const with3 = (cue, vo = 'Ship now, or skip a shipment.') => {
    const s = uiStoryScript(b, [shot(), shot({ cue })]);
    s.scenes[2].vo = vo;
    return validateScript(s, b, { assets: ASSETS }).errors;
  };
  assert.deepEqual(with3('skip'), []);
  assert.deepEqual(with3('Skip,'), [], 'case and punctuation do not matter');
  assert.deepEqual(with3('cancel'), ['orders.shots[1]: cue "cancel" is not a word of the voice line']);
  assert.deepEqual(with3('two words'), ['orders.shots[1]: cue must be one word of the voice line']);
});

// NSC award film, 2026-10-26: shots split the scene evenly, so a "skip" click came at a fixed third, not on the word.
test('a cued shot starts as the voice says its word; uncued shots share the gaps; no cue keeps the even slots', async (t) => {
  const { dir, beats } = loadTemplate('ui-story');
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const vo = 'Customers manage Auto-Ship themselves: ship now, edit a shipment, or skip one, and create a new one from a past order.';
  const make = (shots) => { const s = uiStoryScript(beats, shots); s.scenes[2].vo = vo; return s; };
  const plain = make([shot(), shot(), shot()]);
  const cued = make([shot(), shot({ cue: 'skip' }), shot({ cue: 'create' })]);
  const page = (script) => build({ brief: { format: '16:9' }, brand: BRAND, script, timing: estimateTiming(script, cfg.timing, 'en', beats.pace), size: sizeFor(beats, '16:9') });
  const a = page(plain), b = page(cued);
  assert.ok(!a.includes('const ws = words(sc.id), T = [];') && a.includes('const t0 = s + 0.15 + slot * k'), 'no cue: the even slots, unchanged');
  assert.ok(b.includes('const ws = words(sc.id), T = [];') && b.includes('const t0 = T[k]'));
  assert.match(b, /"cue":"skip"/);
  // Run the scheduling in Node on the estimated words: the cued shots land just before their words.
  const timing = estimateTiming(cued, cfg.timing, 'en', beats.pace);
  const sc = timing.scenes.find((x) => x.id === 'orders'), ws = timing.words.filter((w) => w.scene === 'orders');
  const body = b.slice(b.indexOf('const ws = words(sc.id), T = [];'), b.indexOf('sc.shots.forEach((sh, k) => {\n      const t0'));
  const T = new Function('sc', 's', 'e', 'n', 'words', `${body}; return T;`)({ shots: [{}, { cue: 'skip' }, { cue: 'create' }] }, sc.start, sc.end, 3, () => ws);
  const at = (w) => ws.find((x) => x.w.toLowerCase().replace(/[^a-z0-9]/g, '') === w).start;
  assert.equal(T[0], sc.start + 0.15);
  assert.ok(Math.abs(T[1] - (at('skip') - 0.3)) < 1e-9, `skip shot at ${T[1]}, word at ${at('skip')}`);
  // Every shot keeps 1.2 s (here "skip" and "create" are 1.15 s apart, so it starts 0.05 s after its word's mark), and
  // the last one keeps 1.2 s before the scene ends.
  assert.ok(Math.abs(T[2] - Math.min(Math.max(at('create') - 0.3, T[1] + 1.2), sc.end - 1.2)) < 1e-9, `create shot at ${T[2]}, word at ${at('create')}`);
  assert.ok(T[1] - T[0] >= 1.2 - 1e-9 && T[2] - T[1] >= 1.2 - 1e-9, `every shot gets 1.2 s: ${T}`);
});

// NSC award film, 2026-10-26: with the corner logo off, the title card drew the logo; the film wants it only at the end.
test('a ui-story title card may leave the brand logo off; by default it keeps it', async () => {
  const { dir, beats } = loadTemplate('ui-story');
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const brand = { ...BRAND, logo: 'logo.svg' };
  const page = (more) => { const s = uiStoryScript(beats); Object.assign(s.scenes[0], more); return build({ brief: { format: '16:9' }, brand, script: s, timing: estimateTiming(s, cfg.timing, 'en', beats.pace), size: sizeFor(beats, '16:9') }); };
  const intro = (html) => html.slice(html.indexOf('id="g-intro"'), html.indexOf('</div>', html.indexOf('class="t"')));
  assert.match(intro(page({})), /brandlogo/);
  assert.doesNotMatch(intro(page({ logo: false })), /brandlogo/);
  const s = uiStoryScript(beats); s.scenes[0].logo = 'no';
  assert.ok(validateScript(s, beats, { assets: ASSETS }).errors.includes('intro: logo must be true or false'));
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

// NSC a3, 2026-10-26: after a step or flash scene the drawn app window showed empty for about 0.3 s before the first
// screenshot faded in. The screenshot is now in the window from the moment it appears.
test('a shot scene after a non-ui scene has its screenshot in the window from the start', { timeout: 120000 }, async (t) => {
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-shotin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  // The screenshot the page loads (a missing asset is a page error): one grey pixel is enough.
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'csr-orders.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4ceMGAAWEAsGjyhVlAAAAAElFTkSuQmCC', 'base64'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const c = composeBeats(rules('explainer'), [rules('ui-story')]);
  const script = { app: APP, scenes: [scene(c, 'title', 't'), scene(c, 'step', 's1'), scene(c, 'ui-story.shot', 'orders', { shots: [shot(), shot({ focus: null, cursor: null, click: false })] }), scene(c, 'cta', 'c')] };
  const timing = estimateTiming(script, cfg.timing, 'en', c.pace);
  const file = path.join(dir, 'shot.html');
  fs.writeFileSync(file, await buildMixed({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(c, '16:9') }, c));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(c, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const s = timing.scenes.find((x) => x.id === 'orders').start;
    // Both the screenshot layer and the first screenshot in it are up as the window comes in.
    const at = (v) => opened.page.evaluate((x) => { window.seek(x); return ['shots', 'shot-orders-0'].map((id) => Number(getComputedStyle(document.getElementById(id)).opacity)); }, v);
    assert.deepEqual(await at(s + 0.02), [1, 1], 'the screenshot is in the window from the start');
  } finally { await opened.browser.close(); }
});

test('a shot scene tilt must be none, left or right', () => {
  const b = rules('ui-story');
  const s = uiStoryScript(b); s.scenes[2].tilt = 'up';
  assert.ok(validateScript(s, b, { assets: ASSETS }).errors.includes('orders: tilt must be none|left|right'));
  s.scenes[2].tilt = 'left';
  assert.deepEqual(validateScript(s, b, { assets: ASSETS }).errors, []);
});

test('a tilted shot turns the window in depth, then toward flat; the next scene is flat again', { timeout: 120000 }, async (t) => {
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-tilt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'csr-orders.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4ceMGAAWEAsGjyhVlAAAAAElFTkSuQmCC', 'base64'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const { dir: tdir, beats } = loadTemplate('ui-story');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const script = uiStoryScript(beats, [shot()]);
  script.scenes.splice(3, 0, scene(beats, 'shot', 'flat', { shots: [shot()] }));
  script.scenes[2].tilt = 'left';
  script.scenes[2].vo = 'A longer line, so the window has time to turn slowly toward flat.';
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const file = path.join(dir, 'tilt.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') }));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const sc = (id) => timing.scenes.find((x) => x.id === id);
    const turn = (v) => opened.page.evaluate((x) => { window.seek(x); return window.gsap.getProperty('#app', 'rotationY'); }, v);
    const o = sc('orders'), f = sc('flat');
    const early = await turn(o.start + 0.8), late = await turn(o.end - 0.1);
    assert.ok(early > 10, `the window comes in turned (${early})`);
    assert.ok(late > 0 && late < early, `it turns toward flat (${late})`);
    assert.equal(Math.round(await turn(f.start + 1)), 0, 'the next scene is flat');
  } finally { await opened.browser.close(); }
});

// With a brand safe area (2026-11-03) the app window fits between the logo bug and the subtitles, centred, in an
// #appfit wrapper scaled by CSS (GSAP animates #app itself); without one the window and its markup are unchanged.
test('a brand safe area fits the ui-story window under the logo bug', async () => {
  const { parts } = await import('../templates/ui-story/template.mjs');
  const { validateBrand } = await import('../engine/brand.mjs');
  const base = { name: 'N', logo: 'a.svg', logoBug: true, colors: { primary: '#262524', primary2: '#3a3937', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5b58', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };
  const args = { script: { scenes: [{ id: 'a', kind: 'ui' }] }, icons: {} };
  const fit = parts({ ...args, brand: validateBrand({ ...base, safeArea: 7 }) });
  assert.match(fit.css, /#appfit\{position:absolute;left:335px;top:138px;width:1500px;height:878px;transform:scale\(0\.834\);transform-origin:0 0\}\n#app\{[^}]*left:0px;top:0px;/);
  assert.ok(fit.body.includes('<div id="appfit"><div id="app">'));
  const plain = parts({ ...args, brand: validateBrand(base) });
  assert.ok(!plain.css.includes('#appfit') && !plain.body.includes('appfit'));
  assert.match(plain.css, /#app\{[^}]*left:270px;top:30px;/);
});
