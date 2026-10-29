import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { validateBrand, WIPES } from '../engine/brand.mjs';
import { openComposition, usesGl } from '../engine/media.mjs';
import { DIRS } from '../engine/core.mjs';
import { saveAsset } from '../engine/assets.mjs';
import { validateScript } from '../engine/script.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleGlb, isGlb } from '../engine/glb.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { page } from '../templates/kit.mjs';
import { glLayers, glData, SCALE, WIPE_WINDOW } from '../templates/gl.mjs';
import { build as explainer } from '../templates/explainer/template.mjs';

const BRAND = {
  name: 'GL Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

function args(brand, n = 2, extra = {}) {
  const ids = ['a', 'b', 'c'].slice(0, n);
  const scenes = ids.map((id, i) => ({ id, start: i * 2, end: i * 2 + 2 }));
  return {
    brand, script: { scenes: ids.map((id) => ({ id, kind: 'x', vo: 'Hello' })) }, size: { width: 640, height: 360 }, title: 't',
    timing: { duration: n * 2, lang: 'en', scenes, words: [] }, js: 'const KINDS = {};',
    body: ids.map((id) => `<div class="sc fill" id="g-${id}"></div>`).join(''), scenes: ids.map((id) => ({ id, kind: 'x' })), ...extra,
  };
}

test('brand keeps a WebGL backdrop and cut wipe; none or an unknown one is named', () => {
  assert.equal(validateBrand({ ...BRAND, backdrop: 'shapes', wipe: 'liquid' }).backdrop, 'shapes');
  assert.equal(validateBrand({ ...BRAND, backdrop: 'shapes', wipe: 'liquid' }).wipe, 'liquid');
  const none = validateBrand({ ...BRAND, backdrop: 'none', wipe: 'none' });
  assert.ok(!('backdrop' in none) && !('wipe' in none));
  assert.throws(() => validateBrand({ ...BRAND, backdrop: 'plasma' }), /backdrop must be none or one of mesh, aurora, flow, shapes/);
  assert.throws(() => validateBrand({ ...BRAND, wipe: 'zoom' }), /wipe must be none or one of liquid/);
  for (const w of WIPES) assert.equal(validateBrand({ ...BRAND, wipe: w }).wipe, w);
});

test('every wipe has a canvas scale, its own window per cut, and a choice in the Brand tab', () => {
  const ui = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  for (const w of WIPES) {
    assert.ok(SCALE[w] > 0 && WIPE_WINDOW[w], w);
    assert.deepEqual(glData({ wipe: w }, BRAND.colors, [4]).cuts, [[4, ...WIPE_WINDOW[w]]], w);
    assert.ok(ui.includes(`['${w}', '`), `the Brand tab offers ${w}`);
  }
  assert.deepEqual(glData({ wipe: 'glitch' }, BRAND.colors, [2, 2.4]).cuts, [[2, 0.3, 0.2], [2.4, 0.2, 0.3]]);
});

// Real Chrome on SwiftShader: each new wipe compiles, covers the middle of the frame at the cut (in primary, a flash in
// white), is gone mid-scene, and draws the same frame twice.
test('every wipe covers the cut and is gone mid-scene', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-wipes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  for (const w of WIPES.filter((x) => x !== 'liquid')) {
    const file = path.join(dir, `${w}.html`);
    fs.writeFileSync(file, page(args({ ...BRAND, wipe: w }, 3)), 'utf8');
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
      if (/Composition|render script|WebGL|shader/.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      const px = () => pg.evaluate(() => {
        const src = document.getElementById('glw'), c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0); return [...x.getImageData(src.width >> 1, src.height >> 1, 1, 1).data];
      });
      const want = w === 'flash' ? [255, 255, 255] : [0x1e, 0x29, 0x3b];
      for (const cut of [2, 4]) {
        await pg.evaluate((x) => window.seek(x), cut - 0.01);
        const got = await px();
        assert.ok(got[3] > 250 && got.slice(0, 3).every((v, i) => Math.abs(v - want[i]) < 12), `${w} covers the cut at ${cut} s: ${got}`);
      }
      await pg.evaluate(() => window.seek(3));
      assert.equal((await px())[3], 0, `${w}: no wipe in the middle of a scene`);
      // Mid-wipe, twice: the same pixels.
      const shot = async () => { await pg.evaluate(() => window.seek(4.12)); return crypto.createHash('sha1').update(await pg.screenshot()).digest('hex'); };
      assert.equal(await shot(), await shot(), `${w} draws the same frame again`);
    } finally { await browser.close(); }
  }
});

test('WebGL code reaches a page only when the brand asks; a wipe needs a cut; an overlay gets none', () => {
  const plain = page(args(BRAND));
  assert.ok(!usesGl(plain) && !plain.includes('GL.draw') && !plain.includes('webgl'));
  const gl = page(args({ ...BRAND, backdrop: 'mesh', wipe: 'liquid' }));
  assert.ok(usesGl(gl));
  assert.match(gl, /<canvas id="glb" data-gl width="320" height="180"><\/canvas>/);
  assert.match(gl, /<canvas id="glw" data-gl width="320" height="180"><\/canvas>/);
  // The backdrop replaces the particles, and seek paints the layers.
  assert.match(gl, /window\.seek = \(t\) => \{[^\n]* GL\.draw\(t\);/);
  assert.doesNotMatch(gl, /drawBg\(t\);/);
  assert.ok(!gl.includes('const SOLIDS'), 'the 3D solids only ship with the shapes backdrop');
  assert.ok(page(args({ ...BRAND, backdrop: 'shapes' })).includes('const SOLIDS'));
  assert.equal(glLayers({ wipe: 'liquid' }, false, 1), null);
  assert.equal(glLayers({ backdrop: 'mesh' }, true, 3), null);
  assert.ok(!usesGl(page(args({ ...BRAND, backdrop: 'mesh' }, 2, { transparent: true }))));
});

// Real Chrome on SwiftShader: the same frame twice, the backdrop drawn, and the wipe covering the frame at the cut.
test('WebGL layers draw the same frame on every render and the wipe covers the cut', { timeout: 180000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-gl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, page(args({ ...BRAND, backdrop: 'shapes', wipe: 'liquid' }, 3)), 'utf8');
  const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
  const shots = [];
  for (let run = 0; run < 2; run++) {
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
      if (/Composition|render script|WebGL|shader/.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      const at = async (s) => { await pg.evaluate((x) => window.seek(x), s); return pg.screenshot(); };
      shots.push(sha(await at(1.3)) + sha(await at(3.0)));
      if (run) continue;
      // The pixel in the middle of a layer canvas, read back through a 2D canvas (the layers keep their buffer).
      const px = (id) => pg.evaluate((id) => {
        const src = document.getElementById(id), c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0); return [...x.getImageData(src.width >> 1, src.height >> 1, 1, 1).data];
      }, id);
      await pg.evaluate(() => window.seek(4 - 0.01));
      const [r, g, b, a] = await px('glw');
      assert.ok(a > 250 && Math.abs(r - 0x1e) < 12 && Math.abs(g - 0x29) < 12 && Math.abs(b - 0x3b) < 12, `the wipe covers the cut in primary: ${[r, g, b, a]}`);
      await pg.evaluate(() => window.seek(3));
      assert.equal((await px('glw'))[3], 0, 'no wipe in the middle of a scene');
      const bg = await px('glb');
      assert.ok(bg[3] === 255 && bg.slice(0, 3).some((v, i) => Math.abs(v - [0xf8, 0xfa, 0xfc][i]) > 3), `the backdrop tints the background: ${bg}`);
    } finally { await browser.close(); }
  }
  assert.equal(shots[0], shots[1], 'two renders give the same frames');
});

const PROJECT = 'zz-test-gl';
test.after(() => fs.rmSync(path.join(DIRS.profiles, PROJECT), { recursive: true, force: true }));

test('a .glb asset uploads only when it is a glTF 2.0 binary, and a model scene must name one', () => {
  assert.ok(isGlb(sampleGlb()));
  assert.equal(saveAsset(PROJECT, 'Product Shot.glb', sampleGlb()).name, 'Product-Shot.glb');
  assert.throws(() => saveAsset(PROJECT, 'fake.glb', Buffer.from('not a model at all, just text')), /does not look like a real \.glb/);
  const { beats } = loadTemplate('explainer');
  const errs = (sc) => validateScript({ scenes: [{ id: 't', kind: 'title', vo: 'Hi.', title: 'Hi' }, { id: 'm', kind: 'model', vo: 'Look.', title: 'Look', source: 'bullets[0]', ...sc }] }, beats, { assets: ['a.glb', 'b.png'] }).errors;
  assert.deepEqual(errs({ model: 'a.glb', spin: 'orbit' }), []);
  assert.match(errs({ model: 'b.png' }).join(), /model must be a \.glb file/);
  assert.match(errs({ model: 'zz.glb' }).join(), /model "zz.glb" is not in the project assets/);
  assert.match(errs({ model: 'a.glb', spin: 'fly' }).join(), /spin/);
});

// Real Chrome: the explainer's model scene loads three.js and the model, then draws the same frame on every render.
test('a model scene draws its .glb at every seek, the same on every render', { timeout: 180000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-model-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor')); fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  copyThree(dir);
  fs.writeFileSync(path.join(dir, 'assets', 'model.glb'), sampleGlb());
  const { beats } = loadTemplate('explainer');
  const script = { lang: 'en', scenes: [
    { id: 'intro', kind: 'title', vo: 'Meet it.', title: 'Meet it' },
    { id: 'look', kind: 'model', vo: 'Here it is from every side.', title: 'A closer look', model: 'model.glb', spin: 'turn', source: 'bullets[0]' },
  ] };
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const size = sizeFor(beats, '16:9');
  const html = explainer({ brief: { format: '16:9' }, brand: BRAND, script, timing, size });
  assert.ok(usesGl(html) && html.includes('<script type="importmap">'));
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  const sc = timing.scenes[1], mid = (sc.start + sc.end) / 2;
  const frames = [];
  for (let run = 0; run < 2; run++) {
    let opened;
    try { opened = await openComposition(path.join(dir, 'index.html'), { channel: cfg.engine.chromeChannel, ...size }); } catch (err) {
      if (/Composition|render script|model|WebGL|three/i.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      await pg.evaluate((x) => window.seek(x), mid);
      // Opaque pixels across the middle row of the model's canvas, where the turning torus is.
      const hit = await pg.evaluate(() => {
        const src = document.querySelector('canvas[data-model]'), c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0);
        const row = x.getImageData(0, src.height >> 1, src.width, 1).data;
        let n = 0; for (let i = 3; i < row.length; i += 4) if (row[i] > 200) n++;
        return n;
      });
      assert.ok(hit > 20, `the model is drawn: ${hit} opaque pixels across the middle row`);
      frames.push(crypto.createHash('sha1').update(await pg.screenshot()).digest('hex'));
    } finally { await browser.close(); }
  }
  assert.equal(frames[0], frames[1], 'two renders give the same frame');
});
