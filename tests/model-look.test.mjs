// The model look: pack-glb finishes (matte, satin, gloss with a clear coat), and a model scene's opt-in bloom and
// focus drawn through three's own passes, with the canvas still clear around the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { openComposition } from '../engine/media.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { packGlb, glbJson, FINISHES } from '../engine/pack-glb.mjs';
import { modelCanvas, tourCanvas, BLOOM_RANGE } from '../templates/model3d.mjs';
import { build } from '../templates/explainer/template.mjs';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

const cfg = loadStudioConfig();
// A 4x4 PNG is enough for the box's texture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DAwMDAxAADAA4DAQEKnJ2vAAAAAElFTkSuQmCC', 'base64');

test('pack-glb finishes: satin stays the default look, gloss adds a clear coat, a wrong name is refused', () => {
  assert.deepEqual(packGlb({ front: PNG, aspect: 1 }), packGlb({ front: PNG, aspect: 1, finish: 'satin' }), 'the default is satin, byte for byte');
  const rough = (finish) => glbJson(packGlb({ front: PNG, aspect: 1, finish })).materials.map((m) => m.pbrMetallicRoughness.roughnessFactor);
  assert.deepEqual(rough('satin'), [0.45, 0.45, 0.6], 'the look every pack had before');
  assert.deepEqual(rough('matte'), [FINISHES.matte.face, FINISHES.matte.face, FINISHES.matte.rim]);
  const gloss = glbJson(packGlb({ front: PNG, aspect: 1, finish: 'gloss' }));
  assert.deepEqual(gloss.extensionsUsed, ['KHR_materials_clearcoat']);
  assert.ok(gloss.materials.every((m) => m.extensions.KHR_materials_clearcoat.clearcoatFactor === 1));
  assert.ok(!('extensionsUsed' in glbJson(packGlb({ front: PNG, aspect: 1 }))));
  assert.throws(() => packGlb({ front: PNG, aspect: 1, finish: 'shiny' }), /finish takes matte, satin, gloss/);
});

test('bloom and focus: written on the canvas only when asked, checked against the shared range', () => {
  const t = { start: 1, end: 5 };
  assert.ok(!/data-bloom|data-focus/.test(modelCanvas('a.glb', t, 'turn', {})), 'a plain canvas is unchanged');
  assert.match(modelCanvas('a.glb', t, 'turn', { bloom: 0.4, focus: true }), / data-bloom="0.4" data-focus="on">/);
  assert.match(modelCanvas('a.glb', t, 'turn', { bloom: 7 }), / data-bloom="1">/, 'clamped to the range');
  assert.ok(!modelCanvas('a.glb', t, 'turn', { bloom: 0, focus: 'yes' }).includes('data-'.concat('bloom')), 'zero is off');
  assert.match(tourCanvas('a.glb', t, [{ t: 1 }], { bloom: 0.5, focus: true }), / data-bloom="0.5" data-focus="on">/);
  for (const id of ['explainer', 'product-tour']) {
    const { beats } = loadTemplate(id);
    const kind = id === 'explainer' ? 'model' : 'title';
    assert.deepEqual(beats.data[kind].bloom, BLOOM_RANGE, `${id}: beats data.${kind}.bloom equals BLOOM_RANGE`);
    assert.deepEqual(beats.enums.focus, [true, false]);
  }
  const { beats } = loadTemplate('explainer');
  // The composer module is written only into a page that uses bloom or focus, so other pages (and their offline
  // copies) carry none of the post-processing code.
  const page = (extra) => {
    const script = { lang: 'en', scenes: [{ id: 'm', kind: 'model', vo: 'A model.', title: 'M', model: 'a.glb', source: 'bullets[0]', ...extra }] };
    return build({ brief: { format: '16:9' }, brand: { name: 'B', logoText: 'B', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } },
      script, timing: { duration: 4, lang: 'en', words: [], scenes: [{ id: 'm', start: 0, end: 4 }] }, size: sizeFor(beats, '16:9'), icons: {} });
  };
  assert.ok(!page({}).includes('window.__modelPost =') && !page({}).includes('EffectComposer'));
  assert.ok(page({ bloom: 0.4 }).includes('window.__modelPost =') && page({ focus: true }).includes("from './vendor/BokehPass.js'"));
  const base = { scenes: [{ id: 't', kind: 'title', vo: 'v', title: 'T' }, { id: 'm', kind: 'model', vo: 'v', title: 'M', model: 'a.glb', source: 'bullets[0]' }] };
  const errs = (p) => validateScript({ scenes: [base.scenes[0], { ...base.scenes[1], ...p }] }, beats, { assets: ['a.glb'] }).errors.join(' | ');
  assert.equal(errs({ bloom: 0.4, focus: true }), '');
  assert.match(errs({ bloom: 1.5 }), /bloom must be a number from 0 to 1/);
  assert.match(errs({ focus: 'yes' }), /focus must be true\|false/);
});

test('the job vendor folder holds the composer and passes, linked flat, the Bokeh shader keeping alpha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-vendor-look-'));
  try {
    copyThree(dir);
    const v = path.join(dir, 'vendor');
    for (const f of ['EffectComposer.js', 'RenderPass.js', 'UnrealBloomPass.js', 'BokehPass.js', 'OutputPass.js', 'BokehShader.js']) assert.ok(fs.existsSync(path.join(v, f)), f);
    for (const f of fs.readdirSync(v)) {
      for (const m of fs.readFileSync(path.join(v, f), 'utf8').matchAll(/from\s*'(\.[^']+)'/g)) assert.ok(fs.existsSync(path.join(v, m[1])), `${f} imports ${m[1]}`);
    }
    assert.ok(!/gl_FragColor\.a = 1\.0;/.test(fs.readFileSync(path.join(v, 'BokehShader.js'), 'utf8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Real Chrome on SwiftShader: with bloom and focus on, the canvas corner stays clear (no veil over the scene behind),
// the model is drawn, and a jump back gives the same pixels as the first visit.
test('in Chrome: bloom and focus keep the canvas clear around the model and play the same after a jump', { timeout: 300000 }, async (t) => {
  if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
  const folder = await chromeFolder(t, 'ms-look-');
  const { beats } = loadTemplate('explainer');
  const script = { lang: 'en', scenes: [{ id: 'm', kind: 'model', vo: 'Here is the product, turning slowly in studio light.', title: 'The product', model: 'torus.glb', bloom: 0.7, focus: true, source: 'bullets[0]' }] };
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const brand = { name: 'Look Co', logoText: 'Look', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };
  const file = folder.write('look.html', build({ brief: { format: '16:9' }, brand, script, timing, size: sizeFor(beats, '16:9'), icons: {} }));
  const { browser, page, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') });
  try {
    const s = info.scenes[0];
    // The model canvas read back through a 2D canvas: alpha at a corner and at the centre, and a sample of pixels.
    const look = (at) => page.evaluate(async (x) => {
      await window.seek(x);
      const cv = document.querySelector('canvas[data-model]'), c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
      const px = (u, v) => [...g.getImageData(Math.floor(u * (c.width - 1)), Math.floor(v * (c.height - 1)), 1, 1).data];
      const sample = []; for (let k = 1; k < 10; k++) sample.push(...px(k / 10, 0.3 + k / 30));
      return { corner: px(0.02, 0.02)[3], centre: px(0.5, 0.5)[3], sample, bloom: cv.dataset.bloom, focus: cv.dataset.focus };
    }, at);
    const a = await look(s.start + 1.5);
    assert.equal(a.bloom, '0.7');
    assert.equal(a.focus, 'on');
    assert.equal(a.corner, 0, 'the canvas corner stays clear');
    assert.ok(a.centre > 200, `the model is drawn (alpha ${a.centre})`);
    await look(s.end - 0.2);
    assert.deepEqual((await look(s.start + 1.5)).sample, a.sample, 'a jump back draws the same pixels');
  } finally {
    await browser.close();
  }
});
