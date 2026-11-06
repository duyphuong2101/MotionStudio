import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ffmpegPath from 'ffmpeg-static';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition, ffmpeg } from '../engine/media.mjs';
import { toTensorData, toAlpha, makeCutout, matteStatus, MATTE_DEFAULTS } from '../engine/matte.mjs';
import { directionProblems, cutoutPicture } from '../engine/direction.mjs';
import { page } from '../templates/kit.mjs';

const px = (file, x, y) => {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `format=rgba,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-'], { timeout: 30000, windowsHide: true });
  return [...r.stdout.subarray(0, 4)];
};

test('model input and output: ImageNet normalisation, a map stretched (or sigmoided) to 0-255', () => {
  const t = toTensorData(Uint8Array.from([255, 0, 128]), 1);
  assert.equal(t.length, 3);
  assert.ok(Math.abs(t[0] - (1 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(t[1] - (0 - 0.456) / 0.224) < 1e-6);
  // Planar: channel 0 of every pixel first.
  const two = toTensorData(Uint8Array.from([255, 0, 0, 0, 0, 0]), 1, [0, 0, 0], [1, 1, 1]);
  assert.deepEqual([...two], [1, 0, 0]);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  assert.ok(near([...toAlpha(Float32Array.from([0.2, 0.6, 0.4]))], [0, 255, 128]));
  // Logits: a sigmoid first, then the stretch.
  assert.ok(near([...toAlpha(Float32Array.from([-6, 6, 0]))], [0, 255, 128]));
  assert.deepEqual([...toAlpha(Float32Array.from([0.5, 0.5]))], [0, 0], 'a flat map is no subject');
});

test('without the model a cut-out is unavailable and says why; a model path outside the project is refused', () => {
  const st = matteStatus({ ...MATTE_DEFAULTS, model: 'models/matte/none-here.onnx' });
  assert.equal(st.available, false);
  assert.match(st.reason, /none-here\.onnx is missing/);
  assert.match(matteStatus({ ...MATTE_DEFAULTS, model: '../outside.onnx' }).reason, /inside the project folder/);
});

test('a cut-out keeps the subject and clears the rest, at the picture size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cut-'));
  try {
    const src = path.join(dir, 'p.jpg');
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0x3366cc:s=96x64', '-frames:v', '1', src]);
    const out = path.join(dir, 'cut.png');
    // A stand-in model: the left half is subject.
    const segment = (rgb, S) => Float32Array.from({ length: S * S }, (_, i) => ((i % S) < S / 2 ? 0.95 : 0.02));
    await makeCutout(src, out, { opts: { ...MATTE_DEFAULTS, size: 32 }, segment });
    const left = px(out, 5, 30), right = px(out, 90, 30);
    assert.equal(left[3], 255, `left is subject: ${left}`);
    assert.ok(Math.abs(left[0] - 0x33) <= 3 && Math.abs(left[2] - 0xcc) <= 3, `the subject keeps its colours: ${left}`);
    assert.equal(right[3], 0, `right is cleared: ${right}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cutout: needs a still picture in the scene; the picture is image, else asset, else the first photo', () => {
  assert.equal(cutoutPicture({ image: 'a.jpg', asset: 'b.png' }), 'a.jpg');
  assert.equal(cutoutPicture({ asset: 'v.mp4', photos: [{ asset: 'c.webp' }] }), 'c.webp');
  assert.equal(cutoutPicture({ asset: 'logo.svg' }), null);
  assert.deepEqual(directionProblems({ id: 'a', cutout: true, image: 'a.jpg' }).errors, []);
  assert.match(directionProblems({ id: 'a', cutout: true, asset: 'v.mp4' }).errors[0], /cutout needs a \.png, \.jpg or \.webp picture/);
  assert.match(directionProblems({ id: 'a', cutout: 'yes', image: 'a.jpg' }).errors[0], /cutout must be true/);
});

const BRAND = {
  name: 'Cut Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};
function args(scene) {
  return {
    brand: BRAND, script: { scenes: [{ id: 'a', kind: 'x', vo: 'Hello', ...scene }] }, size: { width: 640, height: 360 }, title: 't',
    timing: { duration: 3, lang: 'en', scenes: [{ id: 'a', start: 0, end: 3 }], words: [] }, js: 'const KINDS = {};',
    body: '<div class="sc fill" id="g-a"><img id="a-img" src="assets/pic.png" alt="" style="position:absolute;left:0;top:0;width:640px;height:360px;object-fit:cover"><div class="hd" id="a-hd" style="position:absolute;left:60px;top:120px;font-size:64px">Behind</div></div>',
    scenes: [{ id: 'a', kind: 'x' }],
  };
}

test('pages: a cut-out only where prepare made one; in Chrome it sits over the heading and follows the picture', { timeout: 240000 }, async (t) => {
  const plain = page(args({ cutout: true }));
  assert.ok(!plain.includes('cutFind'), 'no cut-out file, no cut-out code (the model was missing)');
  const html = page(args({ cutout: true, cutoutFile: 'cut-a.png', camera: { from: { zoom: 1 }, to: { zoom: 1.5, x: 0.2 } } }));
  assert.ok(html.includes('cutFind();') && html.includes('drawCutout();') && html.includes('"cutouts":{"a":"assets/cut-a.png"}'));
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cutpage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', path.join(dir, 'assets', 'pic.png')]);
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red@0.0:s=640x360,format=rgba', '-frames:v', '1', path.join(dir, 'assets', 'cut-a.png')]);
  const file = path.join(dir, 'p.html');
  fs.writeFileSync(file, html, 'utf8');
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
    if (/Composition|render script/.test(err.message)) throw err;
    t.skip(`Chrome is not available: ${err.message}`); return;
  }
  const { browser, page: pg } = opened;
  try {
    const at = (x) => pg.evaluate(async (s) => {
      await window.seek(s);
      const c = document.querySelector('#g-a img.cutout'), o = document.getElementById('a-img'), hd = document.getElementById('a-hd');
      const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v)); };
      const mid = r(hd);
      // elementFromPoint skips pointer-events: none, which the cut-out has: let it be hit for the check.
      c.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(mid[0] + 10, mid[1] + mid[3] / 2);
      c.style.pointerEvents = '';
      return { cut: r(c), pic: r(o), top: top === c, missing: window.__cutMissing.length };
    }, x);
    for (const x of [0, 1.5, 2.9]) {
      const s = await at(x);
      assert.deepEqual(s.cut, s.pic, `at ${x} s the cut-out covers the picture exactly`);
      assert.equal(s.top, true, `at ${x} s the cut-out is over the heading`);
      assert.equal(s.missing, 0);
    }
    assert.ok((await at(2.9)).pic[2] > 640 * 1.4, 'the camera zoomed the picture, and the cut-out with it');
  } finally { await browser.close(); }
});
