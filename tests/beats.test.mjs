import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onsetEnvelope, beatGrid, detectBeats, beatSnap } from '../engine/beats.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { validateBrief } from '../engine/jobs.mjs';
import { MUSIC, musicPath } from '../engine/library.mjs';

/** Clicks every `period` s from `offset`, over a quiet deterministic hiss (a small LCG, not Math.random). */
function clicks(period, offset, seconds = 20, rate = 11025) {
  const s = new Float32Array(seconds * rate);
  let seed = 7;
  for (let i = 0; i < s.length; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; s[i] = ((seed / 2147483648) - 0.5) * 0.01; }
  for (let t = offset; t < seconds; t += period) {
    const at = Math.round(t * rate);
    for (let j = 0; j < 400 && at + j < s.length; j++) s[at + j] += Math.sin(j * 0.6) * Math.exp(-j / 80) * 0.8;
  }
  return s;
}

test('a click track gives back its tempo and where its beats fall', () => {
  const g = beatGrid(onsetEnvelope(clicks(0.5, 0.1)), 256 / 11025, 256 / 11025);
  assert.ok(Math.abs(g.bpm - 120) < 3, `bpm ${g.bpm}`);
  const phase = ((g.offset - 0.1) % 0.5 + 0.5) % 0.5;
  assert.ok(Math.min(phase, 0.5 - phase) < 0.025, `offset ${g.offset}`);
  assert.equal(beatGrid(new Float64Array(2000), 0.0232), null, 'silence has no beat');
});

test('a real file is decoded and its beat found', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-beat-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'clicks.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*1000*t)*exp(-60*mod(t,0.6))':s=44100:d=20", file], { timeoutMs: 30000 });
  const g = await detectBeats(file);
  assert.ok(g && Math.abs(g.bpm - 100) < 3, `expected about 100 bpm, got ${JSON.stringify(g)}`);
  assert.equal(g.source, 'detected');
});

test('the steady-tech built-in track beats where the library says', async (t) => {
  const m = MUSIC.find((x) => x.id === 'steady-tech');
  if (!fs.existsSync(musicPath(m.id))) { t.skip('built-in music not generated on this machine yet'); return; }
  const g = await detectBeats(musicPath(m.id));
  assert.ok(g, 'a beat is found');
  const ratio = g.period / m.beat;
  assert.ok([0.5, 1, 2].some((r) => Math.abs(ratio - r) < 0.05), `library beat ${m.beat}s, detected ${g.period}s`);
});

test('snapping only stretches a scene to the next beat, never past the limit', () => {
  const snap = beatSnap({ period: 0.5, offset: 0.1 }, 0.75);
  assert.equal(snap(2.05), 2.1);
  assert.equal(snap(2.1), 2.1, 'already on a beat');
  assert.equal(snap(2.11), 2.6);
  assert.equal(beatSnap({ period: 2, offset: 0 }, 0.75)(2.1), 2.1, 'a beat too far away leaves the scene alone');
});

test('estimated timing ends every scene on a beat; fixed footage keeps its length', () => {
  const cfg = { wordsPerSecond: { default: 2.6 }, leadIn: 0.2, tailOut: 0.5, lastSceneHold: 1, minScene: 2.2 };
  const script = { scenes: [{ id: 'a', vo: 'one two three four five' }, { id: 'b', vo: 'six seven' }, { id: 'c', vo: 'eight nine ten' }] };
  const plain = estimateTiming(script, cfg);
  const snapped = estimateTiming(script, cfg, 'en', null, { b: 3.33 }, beatSnap({ period: 0.5, offset: 0 }));
  for (const sc of snapped.scenes.filter((s) => s.id !== 'b')) assert.equal(Math.round(sc.end * 1000) % 500, 0, `${sc.id} ends on a beat`);
  assert.ok(snapped.scenes[0].end >= plain.scenes[0].end, 'a scene only grows');
  assert.ok(Math.abs((snapped.scenes[1].end - snapped.scenes[1].start) - 3.33) < 0.001, 'footage keeps its length');
});

test('cutOnBeat is a yes/no brief option', () => {
  const b = { id: 'x', project: 'p', template: 'lifestyle', format: '9:16', duration: 20, message: 'm' };
  assert.equal(validateBrief(b).cutOnBeat, false);
  assert.equal(validateBrief({ ...b, cutOnBeat: true }).cutOnBeat, true);
  assert.throws(() => validateBrief({ ...b, cutOnBeat: 'yes' }), /cutOnBeat must be true or false/);
});
