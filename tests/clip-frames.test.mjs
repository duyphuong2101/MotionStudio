import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, jobDir, createProject, loadTemplate } from '../engine/jobs.mjs';
import { prepare, approve, render, sizeFor, benchJob, benchCounts } from '../engine/pipeline.mjs';
import { ffmpeg, ffmpegReport, openComposition, injectScript, BT709_VF, BT709_TAGS } from '../engine/media.mjs';
import { cutClipFrames, CLIP_FPS } from '../engine/frames.mjs';

test('benchCounts tries each Chrome count once, within the render limits', () => {
  assert.deepEqual(benchCounts([2, 4, 6, 8], 300, 30, 16), [2, 4, 6, 8]);
  assert.deepEqual(benchCounts([2, 4, 6, 8], 300, 30, 8), [2, 4], 'half the CPU threads');
  assert.deepEqual(benchCounts([8, 2, 6], 90, 30, 16), [2, 3], 'one second of video per Chrome');
  assert.deepEqual(benchCounts([4], 300, 30, 16), [4]);
});

test('injectScript puts a render script after the markup and before the page scripts', () => {
  const page = '<body><div id="stage"><video src="clips/a.mp4"></video></div>\n<script src="vendor/gsap.min.js"></script>\n<script>run()</script></body>';
  const out = injectScript(page, 'swap()');
  assert.ok(out.indexOf('swap()') > out.indexOf('</video>') && out.indexOf('swap()') < out.indexOf('vendor/gsap.min.js'));
  assert.equal(out.replace('<script>\nswap()\n</script>\n', ''), page);
  assert.equal(injectScript('<body><script>run()</script></body>', 'swap()'), null, 'a page without the library script has no place');
});

test('cutClipFrames: no clips folder gives no script', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-clipframes-'));
  try {
    assert.equal(await cutClipFrames(dir, 10), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Real ffmpeg: a saturated green clip encoded the way the engine encodes (BT.709 TV range) keeps its colour as a
// cut JPEG frame read as JFIF (BT.601 full range, how Chrome reads it). A grey ramp cannot show a matrix mix-up.
test('cut clip frames keep the clip colour: BT.709 TV range converted for JPEG', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-clipcolour-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'clips'));
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=0x22a35a:s=64x64:r=${CLIP_FPS}:d=0.2`, '-vf', BT709_VF, '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-qp', '0', ...BT709_TAGS, path.join(dir, 'clips', 'green.mp4')], { timeoutMs: 60000 });
  await cutClipFrames(dir, 1);
  const raw = path.join(dir, 'px.rgb');
  await ffmpeg(['-y', '-i', path.join(dir, 'frames', 'green', '00001.jpg'), '-vf', 'format=rgb24,crop=1:1:32:32', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw], { timeoutMs: 60000 });
  const [r, g, b] = fs.readFileSync(raw);
  for (const [got, want, ch] of [[r, 0x22, 'r'], [g, 0xa3, 'g'], [b, 0x5a, 'b']]) assert.ok(Math.abs(got - want) <= 7, `${ch}: ${got} for ${want} (rgb ${r},${g},${b})`);
});

// Real ffmpeg + Chrome: a 1 s clip whose frame k has brightness 8k, so the frame on screen can be read back.
test('a render shows clip frames cut ahead: the same frame the browser decodes, then frames/ is gone', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const cfg = loadStudioConfig();
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-clipframes';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Clip Frames' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=${CLIP_FPS}:d=1,format=yuv420p,geq=lum='N*8':cb=128:cr=128`,
    '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', path.join(DIRS.profiles, P, 'assets', 'ramp.mp4')], { timeoutMs: 60000 });

  const ID = 'ramp-16x9';
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 15, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'x', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [
    { id: 'title', kind: 'title', vo: 'A ramp.', title: 'Ramp' },
    { id: 'ramp', kind: 'video', vo: 'Each frame of this clip is a little brighter than the one before.', title: 'Ramp', video: 'ramp.mp4', in: 0, out: 1, source: 'bullets[0]' },
  ] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  const scene = readJson(jobFile(P, ID, 'timing.json')).scenes.find((s) => s.id === 'ramp');

  const html = fs.readFileSync(jobFile(P, ID, 'index.html'), 'utf8');
  const inject = await cutClipFrames(jobDir(P, ID), st.duration);
  assert.ok(inject.endsWith(`({"fps":${CLIP_FPS},"clips":{"ramp":30}});`), inject.slice(-80));
  const { beats } = loadTemplate('explainer');
  // Brightness at the clip's centre after seeking the page to `x`, read through a canvas (same origin).
  const look = (page, x) => page.evaluate(async (tm) => {
    await window.seek(tm);
    const el = document.querySelector('[data-clip="ramp"]');
    const w = el.naturalWidth || el.videoWidth, h = el.naturalHeight || el.videoHeight;
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d'); ctx.drawImage(el, w / 2, h / 2, 1, 1, 0, 0, 1, 1);
    return { tag: el.tagName, lum: ctx.getImageData(0, 0, 1, 1).data[1] };
  }, x);
  const ks = [0, 5, 12, 20, 29];
  const read = async (q) => {
    const { browser, page } = await openComposition(jobFile(P, ID, 'index.html'), { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9'), inject: q });
    try {
      const out = [];
      for (const k of ks) out.push(await look(page, scene.start + (k + 0.5) / CLIP_FPS));
      out.push(await look(page, scene.end - 0.05));
      return out;
    } finally {
      await browser.close();
    }
  };
  const video = await read(''), frames = await read(inject);
  assert.ok(video.every((r) => r.tag === 'VIDEO'), 'the preview keeps the <video>');
  assert.ok(frames.every((r) => r.tag === 'IMG'), 'a render swaps it for cut frames');
  for (let i = 0; i < video.length; i++) {
    assert.ok(Math.abs(video[i].lum - frames[i].lum) <= 4, `frame ${ks[i] ?? 'held'}: video ${video[i].lum}, cut frame ${frames[i].lum}`);
  }
  for (let i = 1; i < ks.length; i++) assert.ok(frames[i].lum > frames[i - 1].lum + 20, `frames rise: ${frames.map((f) => f.lum)}`);
  assert.ok(Math.abs(frames.at(-1).lum - frames[ks.length - 1].lum) <= 2, 'a scene longer than its clip holds the last frame');

  // The benchmark renders the same way into a temp folder and leaves the job as it was.
  const before = fs.readFileSync(jobFile(P, ID, 'status.json'), 'utf8');
  const bench = await benchJob(P, ID, { seconds: 2, workers: [1, 2, 2] });
  assert.deepEqual(bench.results.map((r) => r.workers), [1, 2]);
  assert.equal(bench.frames, 2 * loadStudioConfig().render.fps);
  assert.ok(bench.results.every((r) => r.seconds > 0 && r.fps > 0));
  assert.equal(fs.readFileSync(jobFile(P, ID, 'status.json'), 'utf8'), before);
  assert.ok(!fs.existsSync(jobFile(P, ID, 'frames')) && !fs.existsSync(jobFile(P, ID, 'video.mp4')));

  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.equal(done.status, 'done');
  assert.equal(done.outputs.qa.errors, 0, JSON.stringify(done.outputs.qa.findings));
  assert.ok(!fs.existsSync(jobFile(P, ID, 'frames')), 'the cut frames are removed after the render');
  assert.equal(fs.readFileSync(jobFile(P, ID, 'index.html'), 'utf8'), html, 'the approved page file is never changed');
  assert.match(await ffmpegReport(['-i', jobFile(P, ID, 'final.mp4'), '-frames:v', '1', '-f', 'null', '-']), /Video: h264.*yuv420p\(tv, bt709[,)]/, 'the MP4 is tagged BT.709');
});

test('a talking-head clip is swapped for cut frames too, keeping its id for the tweens', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const cfg = loadStudioConfig();
  try { await (await chromium.launch({ channel: cfg.engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-clipframes-th';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Clip Frames TH' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(DIRS.profiles, P, 'assets', 'talk.mp4')], { timeoutMs: 60000 });
  const ID = 'talk';
  saveBrief(validateBrief({ project: P, id: ID, template: 'talking-head', format: '16:9', duration: 10, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'x', url: '', bullets: [{ text: 'A talk.' }] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [{ id: 'sp', kind: 'clip', asset: 'talk.mp4', in: 0, out: 3, text: 'Here is the dashboard.', zoom: 'in' }] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  const inject = await cutClipFrames(jobDir(P, ID), st.duration);
  const { browser, page } = await openComposition(jobFile(P, ID, 'index.html'), { channel: cfg.engine.chromeChannel, width: 1920, height: 1080, inject });
  try {
    const at = (x) => page.evaluate(async (tm) => {
      await window.seek(tm);
      const el = document.getElementById('sp-v');
      return { tag: el.tagName, src: el.getAttribute('src'), fit: getComputedStyle(el).objectFit, scale: new DOMMatrix(getComputedStyle(el).transform).a };
    }, x);
    const s = readJson(jobFile(P, ID, 'timing.json')).scenes[0].start;
    const file = (x) => `frames/sp/${String(Math.floor((x - s + 0.001) * CLIP_FPS) + 1).padStart(5, '0')}.jpg`;
    const a = await at(s + 1.02), b = await at(s + 2.52);
    assert.equal(a.tag, 'IMG');
    assert.equal(a.fit, 'contain', 'the template rule for its clip covers the stand-in');
    assert.equal(a.src, file(s + 1.02));
    assert.equal(b.src, file(s + 2.52));
    assert.ok(b.scale > a.scale && b.scale > 1, `the zoom tween drives the stand-in: ${a.scale} → ${b.scale}`);
    assert.deepEqual(await page.evaluate(() => window.__frameErrors), []);
  } finally {
    await browser.close();
  }
});
