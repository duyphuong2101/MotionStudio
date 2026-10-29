// Lottie: the upload check, the sample animation, the explainer anim kind and the page's seek hook, and in Chrome a
// frame that moves with the clock and renders the same twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { isLottie, sampleLottie, lottieSeconds } from '../engine/lottie.mjs';
import { cleanAssetName, saveAsset } from '../engine/assets.mjs';
import { loadTemplate, listAssets } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { loadStudioConfig, DIRS } from '../engine/core.mjs';
import { openComposition } from '../engine/media.mjs';
import { copyLottie } from '../engine/vendor.mjs';
import { lottieBox, hasLotties, LOTTIE_JS } from '../templates/lottie.mjs';
import { build as explainer } from '../templates/explainer/template.mjs';

const { beats } = loadTemplate('explainer');
const BRAND = { name: 'L Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };

test('isLottie accepts a Lottie export and refuses other JSON', () => {
  const s = sampleLottie();
  assert.ok(isLottie(s));
  assert.ok(lottieSeconds(JSON.parse(s.toString())) > 1.9);
  for (const bad of ['{}', '[]', 'nope', '{"v":"5","fr":30}', '{"v":"5","fr":30,"op":0,"layers":[]}', JSON.stringify({ v: '5', fr: 30, ip: 0, op: 60, layers: [] })]) assert.equal(isLottie(Buffer.from(bad)), false, bad);
  assert.equal(cleanAssetName('hero anim.json'), 'hero-anim.json');
});

test('a .json upload must be a Lottie animation and is listed with the brand assets', (t) => {
  const project = `zz-lottie-${process.pid}`;
  const dir = path.join(DIRS.profiles, project);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => saveAsset(project, 'config.json', Buffer.from('{"keyEnv":"X"}')), /not a Lottie animation/);
  assert.deepEqual(saveAsset(project, 'spin.json', sampleLottie()), { name: 'spin.json', bytes: sampleLottie().length });
  assert.deepEqual(listAssets(project), ['spin.json']);

  // An expression runs through eval() in a full lottie-web build, and an outside picture is fetched at render:
  // both are refused. Keyframe easing's x (an array) and an embedded data: picture are fine.
  const base = JSON.parse(sampleLottie().toString());
  const withExpr = structuredClone(base);
  withExpr.layers[0].ks.o = { a: 0, k: 100, x: "fetch('/api/director/run')" };
  assert.throws(() => saveAsset(project, 'expr.json', Buffer.from(JSON.stringify(withExpr))), /expressions/);
  const linked = { ...base, assets: [{ id: 'img_0', w: 10, h: 10, u: 'images/', p: 'img_0.png', e: 0 }] };
  assert.throws(() => saveAsset(project, 'linked.json', Buffer.from(JSON.stringify(linked))), /outside the file/);
  const remote = { ...base, assets: [{ id: 'img_0', w: 10, h: 10, u: '', p: 'https://example.com/a.png', e: 1 }] };
  assert.throws(() => saveAsset(project, 'remote.json', Buffer.from(JSON.stringify(remote))), /outside the file/);
  assert.deepEqual(listAssets(project), ['spin.json'], 'refused files are never written');
  const embedded = { ...base, assets: [{ id: 'img_0', w: 1, h: 1, u: '', p: 'data:image/png;base64,iVBORw0KGgo=', e: 1 }] };
  assert.equal(saveAsset(project, 'embedded.json', Buffer.from(JSON.stringify(embedded))).name, 'embedded.json');
});

test('the explainer anim kind checks its file and draws a seeked Lottie box with the player', () => {
  const sc = (extra) => ({ scenes: [{ id: 't', kind: 'title', vo: 'Hi.', title: 'Hi' }, { id: 'a', kind: 'anim', vo: 'Watch.', title: 'Watch', lottie: 'spin.json', source: 'bullets[0]', ...extra }] });
  const errs = (extra, assets = ['spin.json']) => validateScript(sc(extra), beats, { assets }).errors;
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ loop: false, fit: 'cover', theme: 'dark' }), []);
  assert.match(errs({ lottie: 'spin.mp4' }).join(), /a: lottie must be a \.json Lottie file/);
  assert.match(errs({}, []).join(), /a: lottie "spin\.json" is not in the project assets/);
  assert.match(errs({ fit: 'stretch' }).join(), /a: fit must be contain\|cover/);
  assert.equal(lottieBox('a b.json', { start: 1, end: 3 }), '<div class="lot" data-lottie="assets/a%20b.json" data-start="1" data-end="3" data-fit="contain"></div>');
  assert.equal(lottieBox('a.json', { start: 1, end: 3 }, { loop: false, fit: 'cover' }), '<div class="lot" data-lottie="assets/a.json" data-start="1" data-end="3" data-once="1" data-fit="cover"></div>');
  assert.ok(hasLotties(lottieBox('a.json', { start: 0, end: 1 })) && !hasLotties('<div data-model="x"></div>'));
  const script = { lang: 'en', ...sc({}) };
  const timing = estimateTiming(script, loadStudioConfig().timing, 'en', beats.pace);
  const html = explainer({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') });
  assert.match(html, /vendor\/lottie\.min\.js/);
  assert.match(html, /__drawLotties/);
  assert.match(html, /lottiesLoaded/);
  assert.ok(html.includes(LOTTIE_JS.trim().slice(0, 40)));
  assert.match(html, /id="g-a"/);
  // A page without an anim scene carries no player.
  const plain = explainer({ brief: { format: '16:9' }, brand: BRAND, script: { lang: 'en', scenes: [script.scenes[0]] }, timing: estimateTiming({ scenes: [script.scenes[0]] }, loadStudioConfig().timing, 'en', beats.pace), size: sizeFor(beats, '16:9') });
  assert.doesNotMatch(plain, /lottie/);
});

// Real Chrome: the animation stands at the scene's own time, moves between two times, and renders the same twice.
test('a Lottie scene is a pure function of the clock', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-lottie-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor')); fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  copyLottie(dir);
  fs.writeFileSync(path.join(dir, 'assets', 'spin.json'), sampleLottie());
  const script = { lang: 'en', scenes: [
    { id: 'intro', kind: 'title', vo: 'Meet it.', title: 'Meet it' },
    { id: 'a', kind: 'anim', vo: 'Here it turns, a full circle in two seconds, then again.', title: 'It turns', lottie: 'spin.json', source: 'bullets[0]' },
  ] };
  assert.deepEqual(validateScript(script, beats, { assets: ['spin.json'] }).errors, []);
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const size = sizeFor(beats, '16:9');
  fs.writeFileSync(path.join(dir, 'index.html'), explainer({ brief: { format: '16:9' }, brand: BRAND, script, timing, size }), 'utf8');
  const s0 = timing.scenes.find((s) => s.id === 'a').start;
  const runs = [];
  for (let run = 0; run < 2; run++) {
    let opened;
    try { opened = await openComposition(path.join(dir, 'index.html'), { channel: cfg.engine.chromeChannel, ...size }); } catch (err) {
      if (/Composition|render script|lottie|animation|vendor/i.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      const shots = [];
      for (const u of [0.5, 1.0, 0.5]) {
        await pg.evaluate((x) => window.seek(x), s0 + u);
        shots.push(crypto.createHash('sha1').update(await pg.screenshot({ clip: { x: 300, y: 200, width: 1300, height: 700 } })).digest('hex'));
      }
      assert.notEqual(shots[0], shots[1], 'the animation moved between two times');
      assert.equal(shots[0], shots[2], 'seeking back gives the same frame');
      runs.push(shots.join());
    } finally { await browser.close(); }
  }
  assert.equal(runs[0], runs[1], 'two renders give the same frames');
});
