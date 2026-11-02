import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { voicedSpans, measureFilter, parseEbur128, matchGains, clipGains, measureLoudness, LOUDNESS_DEFAULTS } from '../engine/loudness.mjs';
import { footageArgs } from '../engine/pipeline.mjs';
import { ffmpeg, probeMedia } from '../engine/media.mjs';
import { pacing } from '../engine/review.mjs';

const SUMMARY = (i, p) => `[Parsed_ebur128_1 @ 0000] Summary:

  Integrated loudness:
    I:         ${i} LUFS
    Threshold: -32.1 LUFS

  Loudness range:
    LRA:         3.1 LU

  True peak:
    Peak:       ${p} dBFS
`;

test('word times merge into voiced spans, clipped to the clip', () => {
  const words = [{ start: 1.4, end: 1.7 }, { start: 0.1, end: 0.4 }, { start: 0.6, end: 0.9 }, { start: 2.9, end: 3.4 }];
  assert.deepEqual(voicedSpans(words, 3), [[0.1, 0.9], [1.4, 1.7], [2.9, 3]]);
  assert.deepEqual(voicedSpans([{ start: -0.2, end: 0.3 }, { start: 5, end: 6 }], 3), [[0, 0.3]]);
  assert.deepEqual(voicedSpans(undefined), []);
});

test('the measure chain keeps only the spans, downmixed as footage.wav is', () => {
  assert.equal(measureFilter([]), 'aformat=sample_rates=48000:channel_layouts=mono,ebur128=peak=true:framelog=verbose');
  assert.equal(measureFilter([[0.1, 0.9], [1.2, 1.5]]),
    "aformat=sample_rates=48000:channel_layouts=mono,aselect='between(t,0.1,0.9)+between(t,1.2,1.5)',ebur128=peak=true:framelog=verbose");
});

test('ebur128 summary gives integrated loudness and true peak; silence gives none', () => {
  const frames = 't: 0.4 TARGET:-23 LUFS M: -20.0 S:-120.7 I: -19.0 LUFS LRA: 0.0 LU\n';
  assert.deepEqual(parseEbur128(frames + SUMMARY('-22.8', '-3.4')), { lufs: -22.8, peak: -3.4 });
  assert.deepEqual(parseEbur128(SUMMARY('-70.0', '-inf')), { lufs: null, peak: null });
  assert.deepEqual(parseEbur128(SUMMARY('nan', '-1.0')), { lufs: null, peak: -1 });
  assert.deepEqual(parseEbur128('no summary'), { lufs: null, peak: null });
});

test('a clip louder than the voice is turned down to it', () => {
  const r = matchGains([{ id: 'king', lufs: -18.7, peak: -2 }], -22.8);
  assert.equal(r.against, 'voice');
  assert.equal(r.target, -22.8);
  assert.equal(r.clips[0].gainDb, -4.1);
});

test('a clip within the tolerance keeps its level', () => {
  const r = matchGains([{ id: 'a', lufs: -23.6, peak: -6 }, { id: 'b', lufs: -21.9, peak: -6 }], -22.8);
  assert.deepEqual(r.clips.map((c) => c.gainDb), [0, 0]);
});

test('gains are clamped to the configured maximum', () => {
  const r = matchGains([{ id: 'loud', lufs: -2, peak: 0 }, { id: 'quiet', lufs: -45, peak: -30 }], -22, { maxGainDb: 12 });
  assert.deepEqual(r.clips.map((c) => c.gainDb), [-12, 12]);
  assert.equal(LOUDNESS_DEFAULTS.maxGainDb, 12);
});

test('a raise stops before the clip peaks above -1 dBFS', () => {
  const r = matchGains([{ id: 'q', lufs: -30, peak: -4 }], -22);
  assert.equal(r.clips[0].gainDb, 3);
  assert.equal(matchGains([{ id: 'hot', lufs: -30, peak: 0 }], -22).clips[0].gainDb, 0);
});

test('with no voice-over the clips meet at their median', () => {
  const r = matchGains([{ id: 'a', lufs: -20, peak: -6 }, { id: 'b', lufs: -26, peak: -9 }, { id: 'c', lufs: -23.5, peak: -9 }]);
  assert.equal(r.against, 'clips');
  assert.equal(r.target, -23.5);
  assert.deepEqual(r.clips.map((c) => c.gainDb), [-3.5, 2.5, 0]);
});

test('one clip and no voice-over, or a clip that could not be measured, keeps its level', () => {
  const one = matchGains([{ id: 'a', lufs: -15, peak: -3 }]);
  assert.equal(one.against, null);
  assert.equal(one.clips[0].gainDb, 0);
  assert.equal(matchGains([{ id: 'a', lufs: null, peak: null }], -22).clips[0].gainDb, 0);
});

test('nothing is measured when the match is off or there is nothing to match', async () => {
  const missing = { id: 'x', file: path.join(os.tmpdir(), 'ms-no-such-clip.wav'), from: 0, seconds: 2 };
  assert.equal(await clipGains([missing, { ...missing, id: 'y' }], { file: missing.file, words: [] }, { match: false }), null);
  assert.equal(await clipGains([missing], null), null);
  assert.equal(await clipGains([], { file: missing.file, words: [] }), null);
});

test('footage.wav args carry no volume without a gain, and carry volume with one', () => {
  const clip = { id: 'a', file: 'a.mp4', from: 1, seconds: 2 };
  const timing = { scenes: [{ id: 'a', start: 0.5, end: 2.5 }], duration: 3 };
  const today = ['-y', '-ss', '1', '-t', '2', '-i', 'a.mp4', '-filter_complex',
    '[0:a]aresample=48000,afade=t=in:d=0.08,afade=t=out:st=1.880:d=0.12,adelay=500:all=1,asetpts=N/SR/TB[a0];[a0]amix=inputs=1:duration=longest:normalize=0,apad,atrim=0:3[out]',
    '-map', '[out]', '-ac', '1', '-ar', '48000', 'out.wav'];
  assert.deepEqual(footageArgs([clip], timing, 'out.wav'), today);
  assert.deepEqual(footageArgs([{ ...clip, gainDb: 0 }], timing, 'out.wav'), today);
  assert.match(footageArgs([{ ...clip, gainDb: -4.5 }], timing, 'out.wav')[8], /^\[0:a\]aresample=48000,volume=-4\.5dB,afade=t=in/);
});

test('a clip cut from the middle of an mp4 keeps its silence before the scene in footage.wav (real ffmpeg)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-delay-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clip = path.join(tmp, 'clip.mp4'), out = path.join(tmp, 'footage.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest', clip], { timeoutMs: 60000 });
  const c = { id: 'bite', file: clip, from: 4.23, seconds: 5, hasAudio: true };
  await ffmpeg(footageArgs([c], { scenes: [{ id: 'bite', start: 20, end: 25 }], duration: 30 }, out), { timeoutMs: 60000 });
  assert.ok(Math.abs((await probeMedia(out)).duration - 30) < 0.05, 'footage.wav lasts the whole video');
  assert.equal((await measureLoudness(out, { spans: [[0, 19.5]] })).lufs, null, 'silent before the scene');
  assert.ok((await measureLoudness(out, { spans: [[20.5, 24.5]] })).lufs > -30, 'the clip sound sits in its scene');
});

test('the pacing row of a sounding clip carries its loudness gain', () => {
  const timing = { duration: 4, scenes: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 4 }], words: [],
    videos: [{ id: 'a', seconds: 2, sound: true, gainDb: -4.1, lufs: -18.7, peak: -2 }, { id: 'b', seconds: 2, sound: false }] };
  const rows = pacing(timing, { scenes: [] }).scenes;
  assert.equal(rows[0].gainDb, -4.1);
  assert.equal('gainDb' in rows[1], false);
});

test('a loud clip lands within 1 dB of the voice-over in footage.wav (real ffmpeg)', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-loud-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const voice = path.join(tmp, 'voice.wav'), clip = path.join(tmp, 'clip.wav'), out = path.join(tmp, 'footage.wav');
  // Speech-like bursts with pauses; the clip's last second is a loud tone outside its words (music under a bite).
  await ffmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='0.08*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))*gt(mod(t,1),0.3)':d=4:s=48000", voice], { timeoutMs: 60000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,2),0.25*sin(2*PI*300*t)*(0.6+0.4*sin(2*PI*3*t))*gt(mod(t,0.5),0.15),0.9*sin(2*PI*80*t))':d=3:s=48000", clip], { timeoutMs: 60000 });
  const c = { id: 'bite', file: clip, from: 0, seconds: 3, words: [{ start: 0, end: 2 }], hasAudio: true };
  const res = await clipGains([c], { file: voice, words: [{ start: 0, end: 4 }] });
  const target = res.target;
  assert.equal(res.against, 'voice');
  assert.ok(res.clips[0].lufs - target > 8, `clip ${res.clips[0].lufs} vs voice ${target}`);
  // The loud tone after the words is not counted.
  assert.ok((await measureLoudness(clip)).lufs > res.clips[0].lufs + 3);
  const gainDb = res.clips[0].gainDb;
  assert.ok(gainDb < -8 && gainDb > -12, `gain ${gainDb}`);
  await ffmpeg(footageArgs([{ ...c, gainDb }], { scenes: [{ id: 'bite', start: 0.5, end: 3.5 }], duration: 4 }, out), { timeoutMs: 60000 });
  const heard = await measureLoudness(out, { spans: [[0.6, 2.5]] });
  assert.ok(Math.abs(heard.lufs - target) <= 1, `footage ${heard.lufs} vs voice ${target}`);
});
