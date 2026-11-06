import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition, ffmpeg } from '../engine/media.mjs';
import { CUT_KINDS, CAMERA_MOVES, cameraOf, cameraProblem, directionProblems, pictureCopies } from '../engine/direction.mjs';
import { page } from '../templates/kit.mjs';
import { cutPlan, cutPlanData, BLEND_BEFORE } from '../templates/blend.mjs';

const BRAND = {
  name: 'Direct Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

// Three 2 s scenes; scene b holds a full-frame picture. `own` sets each scene's direction fields.
function args(brand, own = {}, extra = {}) {
  const ids = ['a', 'b', 'c'];
  return {
    brand, script: { scenes: ids.map((id) => ({ id, kind: 'x', vo: 'Hello', ...own[id] })) }, size: { width: 640, height: 360 }, title: 't',
    timing: { duration: 6, lang: 'en', scenes: ids.map((id, i) => ({ id, start: i * 2, end: i * 2 + 2 })), words: [] }, js: 'const KINDS = {};',
    body: ids.map((id, i) => `<div class="sc fill${i === 1 ? ' dark' : ''}" id="g-${id}">${id === 'b' ? '<img src="pic.png" alt="" style="position:absolute;left:0;top:0;width:640px;height:360px;object-fit:cover">' : ''}<div class="hd" style="position:absolute;left:60px;top:120px;font-size:64px">Scene ${id.toUpperCase()}</div></div>`).join(''),
    scenes: ids.map((id) => ({ id, kind: 'x' })), ...extra,
  };
}

test('direction fields: cut, camera and grade are checked; the first scene has no cut', () => {
  assert.deepEqual(directionProblems({ id: 'b', cut: 'whip', camera: 'push-in', grade: 'mono' }), { errors: [], warnings: [] });
  assert.deepEqual(directionProblems({ id: 'b', camera: { from: { zoom: 1.2, x: 0.3 }, to: { zoom: 1 } } }).errors, []);
  assert.match(directionProblems({ id: 'b', cut: 'spin' }).errors[0], /cut must be one of whip, zoom, warp, split, fade, cut/);
  assert.match(directionProblems({ id: 'b', camera: 'orbit' }).errors[0], /camera must be one of push-in/);
  assert.match(directionProblems({ id: 'b', camera: { to: { zoom: 2 } } }).errors[0], /camera.to.zoom must be 1 to 1.6/);
  assert.match(directionProblems({ id: 'b', camera: { to: { tilt: 1 } } }).errors[0], /not a camera field/);
  assert.match(directionProblems({ id: 'b', grade: 'sepia' }).errors[0], /grade must be one of none, warm/);
  assert.match(directionProblems({ id: 'a', cut: 'fade' }, { first: true }).warnings[0], /first scene has no cut/);
  for (const m of Object.keys(CAMERA_MOVES)) assert.equal(cameraProblem(m), null);
  assert.deepEqual(cameraOf('push-in'), [1, 0.5, 0.5, 1.18, 0.5, 0.5]);
  assert.deepEqual(cameraOf({ to: { zoom: 1.3, y: 0.2 } }), [1, 0.5, 0.5, 1.3, 0.5, 0.2]);
  assert.equal(cameraOf({ to: { zoom: 9 } }), null);
});

test('a scene grade gets its own copy of each picture; logos, screens and models stay as they are', () => {
  const script = { scenes: [
    { id: 'a', asset: 'p.jpg' },
    { id: 'b', image: 'p.jpg', grade: 'mono' },
    { id: 'c', shots: [{ asset: 's.png' }], photos: [{ asset: 's.png' }, { asset: 'q.webp' }], grade: 'none' },
    { id: 'd', model: 'm.glb', asset: 'logo.png', grade: 'warm' },
  ] };
  const { pageScript, copies } = pictureCopies(script, { brandOwn: new Set(['logo.png', 'theme.mp3']) });
  assert.deepEqual(Object.fromEntries(copies), {
    'logo.png': { src: 'logo.png', grade: 'none' }, 'p.jpg': { src: 'p.jpg', grade: 'brand' }, 'g-mono-p.jpg': { src: 'p.jpg', grade: 'mono' },
    's.png': { src: 's.png', grade: 'none' }, 'g-none-q.webp': { src: 'q.webp', grade: 'none' }, 'm.glb': { src: 'm.glb', grade: 'none' },
  });
  assert.equal(pageScript.scenes[1].image, 'g-mono-p.jpg');
  assert.deepEqual(pageScript.scenes[2].photos.map((p) => p.asset), ['s.png', 'g-none-q.webp']);
  assert.equal(pageScript.scenes[3].asset, 'logo.png');
  assert.equal(script.scenes[1].image, 'p.jpg', 'the script itself is untouched');
  // Without scene grades the page reads the script as it is.
  const plain = { scenes: [{ id: 'a', asset: 'p.jpg' }] };
  assert.equal(pictureCopies(plain).pageScript, plain);
});

test('a cut plan: own cuts first, then the brand blend, the brand wipe, a crossfade', () => {
  const sc = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const s = (b, c) => ({ scenes: [{ id: 'a' }, { id: 'b', cut: b }, { id: 'c', cut: c }] });
  assert.equal(cutPlan(BRAND, s(), sc, false), null);
  assert.equal(cutPlan(BRAND, s('whip'), sc, true), null, 'none on an overlay');
  assert.deepEqual(cutPlan(BRAND, s('whip'), sc, false), ['whip', 'fade']);
  assert.deepEqual(cutPlan({ ...BRAND, blend: 'zoom' }, s(undefined, 'cut'), sc, false), ['zoom', 'cut']);
  assert.deepEqual(cutPlan({ ...BRAND, wipe: 'iris' }, s('split'), sc, false), ['split', 'wipe']);
  assert.deepEqual(cutPlanData(['whip', 'cut'], [2, 4]).cuts, [[2, BLEND_BEFORE, 0.25, 'whip'], [4, 0, 0, 'cut']]);
  for (const k of CUT_KINDS) assert.ok(cutPlan(BRAND, s(k), sc, false));
});

test('pages: no direction leaves the page as it was; a plan and a camera write only what they use', () => {
  const plain = page(args(BRAND));
  for (const w of ['camFind', 'drawCam', 'cams', 'drawBlend', "T === '"]) assert.ok(!plain.includes(w), `no ${w} on a plain page`);
  assert.equal(page(args(BRAND, { b: { grade: 'mono' } })), plain, 'a scene grade is prepare-only');
  const blendOnly = page(args({ ...BRAND, blend: 'warp' }));
  assert.ok(!blendOnly.includes("T === '"), 'a brand blend alone keeps its single drawing');
  const plan = page(args(BRAND, { b: { cut: 'whip' }, c: { cut: 'cut' } }));
  assert.ok(plan.includes("if (T === 'whip')") && plan.includes('blf-whip-o') && !plan.includes("T === 'warp'"));
  const wiped = page(args({ ...BRAND, wipe: 'liquid' }, { b: { cut: 'zoom' } }));
  assert.ok(wiped.includes('id="glw"'), 'the brand wipe stays on the cut without its own');
  assert.match(wiped, /"gl":\{[^}]*"wipe":"liquid".*?"cuts":\[\[4,/, 'the wipe draws only over the second cut');
  const cam = page(args(BRAND, { b: { camera: 'pan-right' } }));
  assert.ok(cam.includes('camFind();') && cam.includes('drawCam(t);') && cam.includes('"cams":{"b":[1.15,0.25,0.5,1.15,0.75,0.5]}'));
});

// Real Chrome: a whip mixes both scenes at its cut, a hard cut never does, and the camera moves the picture while the
// frame stays the same however it was reached.
test('in Chrome: a whip cut, a hard cut and a camera pan', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-direct-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', path.join(dir, 'pic.png')]);
  const file = path.join(dir, 'p.html');
  fs.writeFileSync(file, page(args(BRAND, { b: { cut: 'whip', camera: 'pan-right' }, c: { cut: 'cut' } })), 'utf8');
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
    if (/Composition|render script/.test(err.message)) throw err;
    t.skip(`Chrome is not available: ${err.message}`); return;
  }
  const { browser, page: pg } = opened;
  try {
    const shown = (at) => pg.evaluate(async (x) => {
      await window.seek(x);
      return ['a', 'b', 'c'].filter((id) => {
        const g = document.getElementById('g-' + id);
        let op = getComputedStyle(g).visibility === 'visible' ? 1 : 0;
        for (let n = g; n && n.id !== 'stage'; n = n.parentElement) op *= +getComputedStyle(n).opacity;
        const r = g.getBoundingClientRect(), w = Math.max(0, Math.min(r.right, 640) - Math.max(r.left, 0));
        return op > 0.01 && w > 0.05 * 640;
      });
    }, at);
    assert.deepEqual(await shown(2.02), ['a', 'b'], 'the whip shows both scenes at its cut');
    assert.deepEqual(await shown(3.9), ['b']);
    assert.deepEqual(await shown(3.999), ['b'], 'a hard cut: the old scene alone just before it');
    assert.deepEqual(await shown(4.001), ['c'], 'and the new one alone just after');
    const cam = (at) => pg.evaluate(async (x) => { await window.seek(x); const im = document.querySelector('#g-b img'); return [im.style.scale, im.style.translate, window.__camMissing.length]; }, at);
    assert.deepEqual(await cam(2), ['1.15', '24px', 0], 'the pan starts left of centre');
    assert.deepEqual(await cam(4), ['1.15', '-24px', 0], 'and ends right of it');
    const mid = await cam(3);
    assert.equal(mid[1], '0px');
    await pg.evaluate(() => window.seek(5.5));
    assert.deepEqual(await cam(3), mid, 'the same framing from the end');
  } finally { await browser.close(); }
});

test('the Script tab offers every cut, camera move and scene grade the engine takes', async () => {
  const { CUT_OPTIONS, CAMERA_OPTIONS, SCENE_GRADE_OPTIONS } = await import('../ui/shots.js');
  const { SCENE_GRADES } = await import('../engine/direction.mjs');
  assert.deepEqual(CUT_OPTIONS.map(([v]) => v), CUT_KINDS);
  assert.deepEqual(CAMERA_OPTIONS.map(([v]) => v), Object.keys(CAMERA_MOVES));
  assert.deepEqual(SCENE_GRADE_OPTIONS.map(([v]) => v), SCENE_GRADES);
});
