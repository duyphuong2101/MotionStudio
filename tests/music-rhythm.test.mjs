import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition } from '../engine/media.mjs';
import { findDrops, dropShift, pulseTimes, DROP_MAX_DELAY } from '../engine/beats.mjs';
import { finalMixArgs } from '../engine/pipeline.mjs';
import { validateScript } from '../engine/script.mjs';
import { validateBrief } from '../engine/jobs.mjs';
import { page } from '../templates/kit.mjs';
import { PULSE } from '../templates/pulse.mjs';

const RATE = 11025;
// Deterministic noise at `amp` for `sec` seconds.
function noise(sec, amp, seed = 1) {
  const out = new Float32Array(Math.round(sec * RATE));
  let x = seed;
  for (let i = 0; i < out.length; i++) { x = (x * 1103515245 + 12345) % 2147483648; out[i] = amp * ((x / 2147483648) * 2 - 1); }
  return out;
}
const join = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test('a drop is where the music gets much louder and stays loud; a steady track has none', () => {
  const track = join(noise(8, 0.03), noise(8, 0.5, 7));
  const [d] = findDrops(track, RATE);
  assert.ok(Math.abs(d.at - 8) <= 0.2, `drop at ${d.at}`);
  assert.ok(d.rise > 20);
  assert.equal(findDrops(track, RATE, { period: 0.5, offset: 0.13 })[0].at, 8.13, 'on the nearest beat');
  assert.deepEqual(findDrops(noise(16, 0.3), RATE), []);
  // A quiet bump in a quiet track is no drop: the loud side must reach the track's median.
  assert.deepEqual(findDrops(join(noise(8, 0.4), noise(4, 0.001), noise(4, 0.01), noise(8, 0.4)), RATE).filter((x) => Math.abs(x.at - 12) < 1), []);
});

test('dropShift moves the music forward, or starts it a little late, so the drop meets the scene', () => {
  const drops = [{ at: 30, rise: 12 }, { at: 9, rise: 8 }];
  assert.deepEqual(dropShift(drops, 10, 120), { at: 30, shift: 20 });
  assert.deepEqual(dropShift([{ at: 9 }], 10, 120), { at: 9, shift: -1 });
  assert.equal(dropShift([{ at: 2 }], 10, 120), null, `more than ${DROP_MAX_DELAY} s late`);
  assert.equal(dropShift([{ at: 30 }], 1, 30), null, 'a track too short to play from that far in');
});

test('pulse times: beats at least about a second apart, moved with the music; drops are the hits', () => {
  const grid = { period: 0.5, offset: 0.1 };
  assert.deepEqual(pulseTimes(grid, [], 4), { beats: [0.1, 1.1, 2.1, 3.1], hits: [] });
  assert.deepEqual(pulseTimes({ period: 1.2, offset: 0 }, [], 4).beats, [1.2, 2.4, 3.6]);
  // Played from 0.6 s into the track: every beat comes 0.6 s earlier (mod the pulse step).
  assert.deepEqual(pulseTimes(grid, [{ at: 2.6 }], 4, 0.6), { beats: [0.5, 1.5, 2.5, 3.5], hits: [2] });
  // Started 2 s late: no beat before the music.
  assert.deepEqual(pulseTimes(grid, [], 5, -2).beats, [2.1, 3.1, 4.1]);
  assert.deepEqual(pulseTimes(null, [{ at: 3 }], 5), { beats: [], hits: [3] });
});

test('the final mix moves the music: a seek on the input, inside a loop, or a late start', () => {
  const base = { video: 'v.mp4', final: 'f.mp4', speech: ['voice.wav'], music: 'm.mp3', brand: { music: { gainDb: -18 } }, duration: 20 };
  const fwd = finalMixArgs({ ...base, musicSeconds: 120, musicShift: 12.5 }).args;
  assert.deepEqual(fwd.slice(fwd.indexOf('m.mp3') - 3, fwd.indexOf('m.mp3') + 1), ['-ss', '12.5', '-i', 'm.mp3']);
  const looped = finalMixArgs({ ...base, musicSeconds: 15, musicShift: 8 }).args;
  const graph = looped[looped.indexOf('-filter_complex') + 1];
  assert.match(graph, /atrim=start=8:end=[\d.]+,asetpts=PTS-STARTPTS\[c0\]/);
  assert.ok(!looped.includes('-ss'));
  const late = finalMixArgs({ ...base, musicSeconds: 120, musicShift: -1.5 }).args;
  assert.match(late[late.indexOf('-filter_complex') + 1], /adelay=1500:all=1.*afade=t=in:st=1\.5:d=0\.2/);
  const none = finalMixArgs({ ...base, musicSeconds: 120 }).args;
  assert.deepEqual(finalMixArgs({ ...base, musicSeconds: 120, musicShift: 0 }).args, none);
  assert.ok(!none.includes('-ss'));
  // A shift past the track's end is ignored.
  assert.deepEqual(finalMixArgs({ ...base, musicSeconds: 120, musicShift: 119.5 }).args, none);
});

test('a brief keeps beatPulse; a script takes one drop', () => {
  const brief = { id: 'j', project: 'p', template: 'explainer', format: '16:9', duration: 30, message: 'Hello' };
  const ok = (b) => { try { return validateBrief(b); } catch (e) { return e; } };
  const kept = ok({ ...brief, beatPulse: true });
  if (!(kept instanceof Error)) assert.equal(kept.beatPulse, true);
  const off = ok(brief);
  if (!(off instanceof Error)) assert.ok(!('beatPulse' in off));
  const bad = ok({ ...brief, beatPulse: 'yes' });
  assert.ok(bad instanceof Error && /beatPulse must be true or false/.test(bad.message));
  const beats = { sequence: [{ kind: ['x'], min: 1, max: 5 }], fields: { x: { required: [], optional: ['vo'] } }, limits: { voWords: 40 } };
  const v = (scenes) => validateScript({ scenes }, beats);
  assert.deepEqual(v([{ id: 'a', kind: 'x', vo: 'Hi' }, { id: 'b', kind: 'x', vo: 'Hi', drop: true }]).errors, []);
  assert.match(v([{ id: 'a', kind: 'x', vo: 'Hi', drop: true }, { id: 'b', kind: 'x', vo: 'Hi', drop: true }]).errors.join(), /only one scene can take the music's drop; a, b/);
  assert.match(v([{ id: 'a', kind: 'x', vo: 'Hi', drop: 'yes' }]).errors.join(), /drop must be true/);
});

const BRAND = {
  name: 'Pulse Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};
function args(pulse) {
  const ids = ['a', 'b'];
  return {
    brand: BRAND, script: { scenes: ids.map((id) => ({ id, kind: 'x', vo: 'Hello' })) }, size: { width: 640, height: 360 }, title: 't',
    timing: { duration: 4, lang: 'en', scenes: ids.map((id, i) => ({ id, start: i * 2, end: i * 2 + 2 })), words: [], ...(pulse ? { pulse } : {}) }, js: 'const KINDS = {};',
    // Scene b holds a full-frame picture: it takes the drops only.
    body: ids.map((id) => `<div class="sc fill" id="g-${id}">${id === 'b' ? '<img alt="" style="position:absolute;inset:0;width:640px;height:360px">' : ''}<div style="position:absolute;left:60px;top:120px;font-size:64px">Scene ${id}</div></div>`).join(''),
    scenes: ids.map((id) => ({ id, kind: 'x' })),
  };
}

test('a page pulses only when prepare timed a pulse; in Chrome a beat swells softly, a picture scene takes only the drop', { timeout: 240000 }, async (t) => {
  const plain = page(args(null));
  assert.equal(page(args({ beats: [], hits: [] })), plain);
  for (const w of ['drawPulse', 'pulsefx']) assert.ok(!plain.includes(w));
  const html = page(args({ beats: [1, 3], hits: [2] }));
  assert.ok(html.includes('drawPulse(t);') && html.includes('id="pulsefx"'));
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pulse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const file = path.join(dir, 'p.html');
  fs.writeFileSync(file, html, 'utf8');
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
    if (/Composition|render script/.test(err.message)) throw err;
    t.skip(`Chrome is not available: ${err.message}`); return;
  }
  const { browser, page: pg } = opened;
  try {
    const at = (x) => pg.evaluate(async (s) => { await window.seek(s); return [document.getElementById('g-a').style.scale, document.getElementById('g-b').style.scale, +getComputedStyle(document.getElementById('pulsefx')).opacity]; }, x);
    assert.deepEqual(await at(1), [String(1 + PULSE.beat), '', 0], 'a beat peaks on its time, without a flash, and never on a picture');
    assert.deepEqual(await at(1 - PULSE.beatUp / 2), [String(1 + PULSE.beat / 2), '', 0], 'it rises over a few frames, no jump');
    assert.deepEqual(await at(1.6), ['', '', 0], 'and is gone before the next');
    const [, b, flash] = await at(2);
    assert.equal(b, String(1 + PULSE.hit), 'the drop reaches the picture scene too');
    assert.ok(Math.abs(flash - PULSE.flash) < 0.01, `the drop flashes: ${flash}`);
    await at(3.9);
    assert.deepEqual(await at(2), [(1 + PULSE.hit).toFixed(4), (1 + PULSE.hit).toFixed(4), flash].map((v, i) => (i < 2 ? String(+v) : v)), 'the same from the end');
  } finally { await browser.close(); }
});

test('a long quiet intro before the beat still reads the right tempo', async () => {
  const { beatGrid, onsetEnvelope } = await import('../engine/beats.mjs');
  // 30 s of a soft pad, then a 120 BPM kick: the fit starts at the first clear onset and widens step by step.
  const n = 50 * RATE, s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    s[i] = 0.05 * Math.sin(2 * Math.PI * 220 * t) + (t >= 30 ? 0.75 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-14 * (t % 0.5)) : 0);
  }
  const g = beatGrid(onsetEnvelope(s), 256 / RATE, 128 / RATE);
  assert.ok(g && Math.abs(g.bpm - 120) < 0.3, `tempo ${g?.bpm}`);
});
