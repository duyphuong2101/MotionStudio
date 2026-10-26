import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrand } from '../engine/brand.mjs';
import { mixFilter } from '../engine/pipeline.mjs';
import { ffmpeg } from '../engine/media.mjs';

const base = {
  name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

// The graph every render used before ducking existed; duck off must keep it byte for byte.
const PLAIN = '[1:a]aresample=48000,apad,atrim=0:10.000[s1];[s1]anull[v];[2:a]aresample=48000,apad,atrim=0:10.000,volume=-18dB,afade=t=out:st=8.500:d=1.5[m];[v][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]';
const DUCKED = '[1:a]aresample=48000,apad,atrim=0:10.000[s1];[s1]anull[v];[2:a]aresample=48000,apad,atrim=0:10.000,volume=-18dB,afade=t=out:st=8.500:d=1.5[m];[v]asplit=2[vm][vk];[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[md];[vm][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]';

test('brand music.duck accepts true or false and is kept only when on', () => {
  assert.equal(validateBrand({ ...base, music: { gainDb: -18, duck: true } }).music.duck, true);
  assert.deepEqual(validateBrand({ ...base, music: { gainDb: -18, duck: false } }).music, { file: null, gainDb: -18 });
  assert.deepEqual(validateBrand({ ...base, music: { gainDb: -18 } }).music, { file: null, gainDb: -18 });
});

test('brand music.duck refuses anything but a boolean', () => {
  for (const duck of ['yes', 1, 'true', {}]) assert.throws(() => validateBrand({ ...base, music: { gainDb: -18, duck } }), /music.duck must be true or false/, String(duck));
});

test('the mix without duck is the constant-level graph', () => {
  assert.equal(mixFilter({ speech: 1, music: true, duration: 10 }), PLAIN);
  assert.equal(mixFilter({ speech: 1, music: true, duration: 10, gainDb: -18, duck: false }), PLAIN);
});

test('duck puts sidechaincompress on the music, keyed by the speech mix', () => {
  assert.equal(mixFilter({ speech: 1, music: true, duration: 10, gainDb: -18, duck: true }), DUCKED);
  const two = mixFilter({ speech: 2, music: true, duration: 4, gainDb: -12, duck: true });
  assert.match(two, /\[s1\]\[s2\]amix=inputs=2:duration=first:normalize=0\[v\];\[3:a\]aresample/);
  assert.match(two, /volume=-12dB/);
  assert.match(two, /\[v\]asplit=2\[vm\]\[vk\];\[m\]\[vk\]sidechaincompress/);
});

test('duck needs both speech and music', () => {
  const voiceOnly = mixFilter({ speech: 1, duration: 5, duck: true });
  const musicOnly = mixFilter({ music: true, duration: 5, duck: true });
  assert.equal(voiceOnly, '[1:a]aresample=48000,apad,atrim=0:5.000[s1];[s1]anull[v];[v]loudnorm=I=-14:TP=-1.5:LRA=11[a]');
  assert.equal(musicOnly, '[1:a]aresample=48000,apad,atrim=0:5.000,volume=-18dB,afade=t=out:st=3.500:d=1.5[m];[m]loudnorm=I=-14:TP=-1.5:LRA=11[a]');
  for (const f of [voiceOnly, musicOnly]) assert.ok(!f.includes('sidechaincompress'));
});

test('ffmpeg runs the ducked graph on mono speech and stereo music', async () => {
  await ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*110*t)|sin(2*PI*110*t):d=3:s=44100',
    '-filter_complex', mixFilter({ speech: 1, music: true, duration: 3, duck: true }),
    '-map', '[a]', '-t', '3', '-f', 'null', '-',
  ], { timeoutMs: 60000 });
});
