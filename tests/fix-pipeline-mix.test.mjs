import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStudioConfig } from '../engine/core.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { finalMixArgs, lengthFindings, loudnessExpect, voiceHolds } from '../engine/pipeline.mjs';
import { loopMusic } from '../engine/sequences.mjs';

const base = { video: 'video.mp4', final: 'final.mp4', duration: 30, brand: { music: { file: 'm.wav' } } };
const inputsOf = (args) => args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

test('music shorter than the film loops by crossfade, one input per copy after speech and cut sounds', () => {
  const { args } = finalMixArgs({ ...base, speech: ['voice.wav'], sfx: ['sfx.wav'], music: 'm.wav', musicSeconds: 12 });
  const loop = loopMusic(3, 12, 30);
  assert.ok(loop.copies > 1);
  assert.deepEqual(inputsOf(args), ['video.mp4', 'voice.wav', 'sfx.wav', ...Array(loop.copies).fill('m.wav')]);
  const g = graphOf(args);
  assert.ok(g.includes(`${loop.graph};[loop]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:30.000,volume=-14.99dB,`), 'the music chain reads [loop], not one input');
  assert.ok(g.startsWith('[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:30.000[s1];'), 'speech keeps input 1');
  assert.ok(g.includes('[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:30.000[e0]'), 'cut sounds keep input 2');
  assert.ok(g.includes('[3:a]aresample=48000,atrim=0:8.000[c0]'), 'the first copy is input 3');
});

test('music as long as the film, or of unknown length, mixes exactly as before', () => {
  const plain = finalMixArgs({ ...base, speech: ['voice.wav'], music: 'm.wav' });
  assert.deepEqual(finalMixArgs({ ...base, speech: ['voice.wav'], music: 'm.wav', musicSeconds: 45 }), plain);
  assert.deepEqual(inputsOf(plain.args), ['video.mp4', 'voice.wav', 'm.wav']);
  assert.ok(!graphOf(plain.args).includes('[loop]'));
});

test('QA is told cut sounds alone are not loudness-normalised', () => {
  const alone = finalMixArgs({ ...base, brand: {}, sfx: ['sfx.wav'] });
  assert.deepEqual(loudnessExpect(alone.label), { normalised: false });
  for (const label of ['voice+sfx', 'sfx+music', 'music', 'silent']) assert.deepEqual(loudnessExpect(label), {}, label);
});

test('a video well under the brief length gets a warning; over it stays an error', () => {
  const cfg = { maxOverrun: 0.1 };
  assert.deepEqual(lengthFindings(20, 30, cfg), [{ level: 'warning', el: 'script', msg: 'video is 20s, brief asks 30s: lengthen the voice lines or add a scene' }]);
  assert.equal(lengthFindings(34, 30, cfg)[0].level, 'error');
  assert.deepEqual(lengthFindings(23, 30, cfg), [], 'at 75% or more no finding');
  assert.deepEqual(lengthFindings(10, undefined, cfg), [], 'a brief without a length');
});

const timingCfg = loadStudioConfig().timing;
const script = () => ({ scenes: [
  { id: 'intro', kind: 'title', vo: 'Here is the product.' },
  { id: 'demo', kind: 'step', vo: 'This line keeps talking well after the short screen recording with its own sound has ended.', video: 'rec.mp4', sound: true },
  { id: 'end', kind: 'cta', vo: 'Try it.' },
] });

test('a voice line longer than its sound clip holds the scene until the line and its tail are done', () => {
  const fixed = { demo: 1.5 };
  const first = estimateTiming(script(), timingCfg, 'en', null, fixed);
  const spill = first.words.filter((w) => w.scene === 'demo').at(-1).end;
  assert.ok(spill > first.scenes[1].end, 'without the hold the voice runs into the next scene');
  const held = voiceHolds(first, fixed, script(), { cfg: timingCfg });
  assert.ok(held.demo > fixed.demo);
  const again = estimateTiming(script(), timingCfg, 'en', null, held);
  const demo = again.scenes.find((s) => s.id === 'demo');
  assert.ok(again.words.filter((w) => w.scene === 'demo').every((w) => w.end <= demo.end - timingCfg.tailOut + 1e-6), 'every word ends a tail before the cut');
  assert.equal(again.scenes[0].end, first.scenes[0].end, 'earlier scenes keep their timing');
});

test('voiceHolds leaves clips alone when their line fits, or when they have no line', () => {
  const s = script();
  s.scenes[1].vo = 'Short.';
  const fixed = { demo: 6 };
  assert.equal(voiceHolds(estimateTiming(s, timingCfg, 'en', null, fixed), fixed, s, { cfg: timingCfg }), null);
  s.scenes[1].vo = '';
  assert.equal(voiceHolds(estimateTiming(s, timingCfg, 'en', null, { demo: 1 }), { demo: 1 }, s, { cfg: timingCfg }), null);
  assert.equal(voiceHolds(estimateTiming(s, timingCfg, 'en'), null, s, { cfg: timingCfg }), null);
});
