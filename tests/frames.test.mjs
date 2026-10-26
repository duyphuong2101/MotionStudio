import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig } from '../engine/core.mjs';
import { renderWorkers, splitFrames, MAX_WORKERS } from '../engine/frames.mjs';

test('splitFrames covers every frame once, in order, in near-equal runs', () => {
  for (const [frames, workers] of [[60, 4], [10, 4], [7, 3], [3, 8], [1, 4], [900, 1]]) {
    const runs = splitFrames(frames, workers);
    assert.equal(runs[0].from, 0);
    assert.equal(runs.at(-1).to, frames);
    runs.forEach((r, i) => { assert.ok(r.to > r.from); if (i) assert.equal(r.from, runs[i - 1].to); });
    assert.equal(runs.length, Math.min(workers, frames));
    const lens = runs.map((r) => r.to - r.from);
    assert.ok(Math.max(...lens) - Math.min(...lens) <= 1, `${frames}/${workers}: ${lens}`);
  }
  assert.deepEqual(splitFrames(0, 4), []);
});

test('renderWorkers honours the config, the CPU and one second per Chrome', () => {
  assert.equal(renderWorkers(4, 900, 30, 16), 4);
  assert.equal(renderWorkers(undefined, 900, 30, 16), 4, 'default 4');
  assert.equal(renderWorkers(64, 9000, 30, 64), MAX_WORKERS);
  assert.equal(renderWorkers(8, 900, 30, 6), 3, 'half the CPU threads');
  assert.equal(renderWorkers(4, 60, 30, 16), 2, 'a 2 s video gets 2 Chromes');
  assert.equal(renderWorkers(4, 20, 30, 16), 1);
  assert.equal(renderWorkers(1, 900, 30, 16), 1);
  assert.equal(renderWorkers(0, 900, 30, 16), 1);
  assert.equal(renderWorkers(4, 900, 30, 1), 1);
});

// Real Chrome + ffmpeg, lossless: three Chromes joined must give the same frames, in the same order, as one tab.
test('a parallel render joins to exactly the frames of a single-Chrome render', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const channel = loadStudioConfig().engine.chromeChannel;
  try { await (await chromium.launch({ channel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const { ffmpeg } = await import('../engine/media.mjs');
  const { renderFrames, openWorkers } = await import('../engine/frames.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-frames-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body style="margin:0"><div id="b" style="width:64px;height:64px"></div><script>
window.__studio = { width: 64, height: 64, duration: 2 };
window.seek = (t) => { const f = Math.round(t * 30); document.getElementById('b').style.background = 'rgb(' + (f * 37) % 256 + ',' + (f * 11) % 256 + ',' + (f * 3) % 256 + ')'; };
window.__ready = true;
</script></body></html>`);
  const hashes = async (tabs, name) => {
    const { pages, close } = await openWorkers(path.join(dir, 'index.html'), { channel, width: 64, height: 64, count: tabs });
    assert.equal(pages.length, tabs);
    let count = 0;
    try {
      await renderFrames(pages, {
        frames: 60, fps: 30, input: 'png', shoot: (p) => p.screenshot({ type: 'png' }),
        encode: (file) => ['-c:v', 'ffv1', '-r', '30', file], out: path.join(dir, name), timeoutMs: 60000, onFrame: () => count++,
      });
    } finally {
      await close();
    }
    assert.equal(count, 60);
    const md5 = path.join(dir, `${name}.md5`);
    await ffmpeg(['-y', '-i', path.join(dir, name), '-f', 'framemd5', md5], { timeoutMs: 60000 });
    return fs.readFileSync(md5, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').at(-1).trim());
  };
  const one = await hashes(1, 'one.mkv');
  const three = await hashes(3, 'three.mkv');
  assert.equal(one.length, 60);
  assert.ok(new Set(one).size > 30, 'frames differ from each other');
  assert.deepEqual(three, one);
});

// Real Chrome + ffmpeg, the render's own JPEG capture and encode: brand colours must come back as they were drawn
// when a player decodes the MP4 as BT.709. Untagged BT.601 output turned #22a35a into 25 146 89.
test('rendered colours survive the encode: BT.709 conversion and tags, also across joined segments', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const channel = loadStudioConfig().engine.chromeChannel;
  try { await (await chromium.launch({ channel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const { ffmpeg, ffmpegReport, BT709_VF, BT709_TAGS } = await import('../engine/media.mjs');
  const { renderFrames, openWorkers } = await import('../engine/frames.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-colour-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const COLOURS = [[230, 57, 70], [29, 111, 216], [34, 163, 90], [242, 183, 5]];
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body style="margin:0"><div id="b" style="width:320px;height:180px"></div><script>
const C = ${JSON.stringify(COLOURS)};
window.__studio = { width: 320, height: 180, duration: 2 };
window.seek = (t) => { const c = C[Math.min(3, Math.floor(t * 2))]; document.getElementById('b').style.background = 'rgb(' + c + ')'; };
window.__ready = true;
</script></body></html>`);
  const { pages, close } = await openWorkers(path.join(dir, 'index.html'), { channel, width: 320, height: 180, count: 2 });
  const out = path.join(dir, 'out.mp4');
  try {
    await renderFrames(pages, {
      frames: 60, fps: 30, input: 'mjpeg', shoot: (p) => p.screenshot({ type: 'jpeg', quality: 92 }), filterArgs: ['-vf', BT709_VF],
      encode: (file) => ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-crf', '18', '-r', '30', file], out, timeoutMs: 60000,
    });
  } finally {
    await close();
  }
  assert.match(await ffmpegReport(['-i', out, '-frames:v', '1', '-f', 'null', '-']), /Video: h264.*yuv420p\(tv, bt709[,)]/);
  for (const [i, want] of COLOURS.entries()) {
    const raw = path.join(dir, `c${i}.raw`);
    await ffmpeg(['-y', '-ss', String(i * 0.5 + 0.25), '-i', out, '-frames:v', '1', '-vf', 'crop=8:8:156:86,scale=1:1:in_color_matrix=bt709:in_range=tv,format=rgb24', '-f', 'rawvideo', raw], { timeoutMs: 30000 });
    const got = [...fs.readFileSync(raw)];
    assert.ok(got.every((v, k) => Math.abs(v - want[k]) <= 4), `rgb(${want}) came back as rgb(${got})`);
  }
});
