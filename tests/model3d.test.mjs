import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition } from '../engine/media.mjs';
import { validateScript } from '../engine/script.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleGlb } from '../engine/glb.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { modelCanvas, SPINS, VIEW_RANGE } from '../templates/model3d.mjs';
import { build as explainer } from '../templates/explainer/template.mjs';

const { beats } = loadTemplate('explainer');
const T = { start: 1, end: 3 };

test('the explainer rules and the model renderer agree on spins and view ranges', () => {
  assert.deepEqual(beats.enums.spin, SPINS);
  assert.deepEqual(beats.data.model.view, VIEW_RANGE);
  assert.deepEqual(beats.enums.env, ['studio', 'none']);
  assert.deepEqual(beats.enums.shadow, [true, false]);
});

test('a model scene checks its view, shadow and env', () => {
  const errs = (sc) => validateScript({ scenes: [{ id: 't', kind: 'title', vo: 'Hi.', title: 'Hi' }, { id: 'm', kind: 'model', vo: 'Look.', title: 'Look', source: 'bullets[0]', model: 'a.glb', ...sc }] }, beats, { assets: ['a.glb'] }).errors;
  assert.deepEqual(errs({ spin: 'reveal', view: { azimuth: -180, elevation: 60, zoom: 0.6 }, shadow: false, env: 'none' }), []);
  assert.deepEqual(errs({ spin: 'detail', view: { zoom: 1.6 }, shadow: true, env: 'studio' }), []);
  assert.match(errs({ view: { azimuth: 181 } }).join(), /m: view\.azimuth must be a number from -180 to 180/);
  assert.match(errs({ view: { elevation: -31 } }).join(), /m: view\.elevation must be a number from -30 to 60/);
  assert.match(errs({ view: { zoom: '1' } }).join(), /m: view\.zoom must be a number from 0\.6 to 1\.6/);
  assert.match(errs({ view: { tilt: 3 } }).join(), /m: view must be \{ "azimuth"/);
  assert.match(errs({ view: [30, 12] }).join(), /m: view must be/);
  assert.match(errs({ shadow: 'false' }).join(), /m: shadow must be true\|false/);
  assert.match(errs({ env: 'hdr' }).join(), /m: env must be studio\|none/);
  assert.match(errs({ spin: 'fly' }).join(), /m: spin must be turn\|orbit\|hero\|reveal\|detail/);
});

test('a model canvas writes only the view, shadow and env a scene changes, numbers clamped', () => {
  const plain = '<canvas class="m3c" data-gl data-model="assets/m.glb" data-start="1" data-end="3" data-spin="turn"></canvas>';
  assert.equal(modelCanvas('m.glb', T, 'turn'), plain, 'a scene without the new fields keeps its markup');
  assert.equal(modelCanvas('m.glb', T, 'turn', { shadow: true, env: 'studio', view: {} }), plain, 'the defaults write nothing');
  assert.match(modelCanvas('m.glb', T, 'detail', { view: { azimuth: -400, elevation: 12.5, zoom: 2 }, shadow: false, env: 'none' }),
    / data-spin="detail" data-az="-180" data-el="12.5" data-zoom="1.6" data-shadow="off" data-env="none"><\/canvas>$/);
  assert.match(modelCanvas('m.glb', T, 'reveal', { view: { elevation: -90, zoom: 0.1 } }), / data-spin="reveal" data-el="-30" data-zoom="0.6"><\/canvas>$/);
  // Text, null and unknown values never reach the markup.
  assert.equal(modelCanvas('m.glb', T, 'fly', { view: { azimuth: '"><script>', zoom: null }, shadow: 'off', env: '"x' }), plain);
  assert.match(modelCanvas('a "b".glb', T, 'turn'), /data-model="assets\/a%20%22b%22\.glb"/);
});

// Real Chrome on SwiftShader: the studio light and the contact shadow draw, every spin gives the same frame twice.
test('a lit model scene draws its shadow and the same frames on every render', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-model3d-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor')); fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  copyThree(dir);
  fs.writeFileSync(path.join(dir, 'assets', 'model.glb'), sampleGlb());
  const vo = 'Here it is from every side.';
  const m = (id, extra) => ({ id, kind: 'model', vo, title: 'A closer look', model: 'model.glb', source: 'bullets[0]', ...extra });
  // Two scenes alike but for the shadow, seen from above so the ground beside the model shows; then the new spins.
  const above = { elevation: 60 };
  const script = { lang: 'en', scenes: [
    { id: 'intro', kind: 'title', vo: 'Meet it.', title: 'Meet it' },
    m('lit', { spin: 'turn', view: above }), m('flat', { spin: 'turn', view: above, shadow: false }),
    m('rise', { spin: 'reveal', view: { azimuth: -40, elevation: 25 } }), m('close', { spin: 'detail', env: 'none' }),
  ] };
  assert.deepEqual(validateScript(script, beats, { assets: ['model.glb'] }).errors, []);
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const size = sizeFor(beats, '16:9');
  fs.writeFileSync(path.join(dir, 'index.html'), explainer({ brief: { format: '16:9' }, brand: { name: 'M Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } }, script, timing, size }), 'utf8');
  const at = (id, u) => timing.scenes.find((s) => s.id === id).start + u;
  const runs = [], cover = {};
  for (let run = 0; run < 2; run++) {
    let opened;
    try { opened = await openComposition(path.join(dir, 'index.html'), { channel: cfg.engine.chromeChannel, ...size }); } catch (err) {
      if (/model|WebGL|three|vendor/i.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      // Pixels the model's canvas covers at all (alpha > 8): the shadow on the clear ground adds to the model's own.
      const covered = (i) => pg.evaluate((i) => {
        const src = document.querySelectorAll('canvas[data-model]')[i], c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0);
        const px = x.getImageData(0, 0, src.width, src.height).data;
        let n = 0; for (let k = 3; k < px.length; k += 4) if (px[k] > 8) n++;
        return n;
      }, i);
      const hashes = [];
      for (const [id, u, i] of [['lit', 1.5, 0], ['flat', 1.5, 1], ['rise', 0.3, 2], ['rise', 1.5, 2], ['close', 2.5, 3]]) {
        await pg.evaluate((x) => window.seek(x), at(id, u));
        hashes.push(crypto.createHash('sha1').update(await pg.screenshot()).digest('hex'));
        if (!run && u === 1.5 && id !== 'rise') cover[id] = await covered(i);
      }
      runs.push(hashes.join());
    } finally { await browser.close(); }
  }
  assert.ok(cover.flat > 2000, `the model is drawn: ${cover.flat} pixels`);
  assert.ok(cover.lit > cover.flat + 1000, `the shadow shows beside the model: ${cover.lit} pixels with it, ${cover.flat} without`);
  assert.equal(runs[0], runs[1], 'two renders give the same frames');
});
