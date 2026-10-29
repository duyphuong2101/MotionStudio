import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrand } from '../engine/brand.mjs';
import { mixFilter } from '../engine/pipeline.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, ffmpegReport } from '../engine/media.mjs';

const base = {
  name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

// The constant-level graph; duck off must keep it byte for byte. Speech goes to both sides at full level, music
// keeps its stereo, 3 dB up to match the old mono mix's sum of a centred track's two sides.
const PLAIN = '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:10.000[s1];[s1]anull[v];[2:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:10.000,volume=-14.99dB,afade=t=out:st=8.500:d=1.5[m];[v][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]';
const DUCKED = '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:10.000[s1];[s1]anull[v];[2:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:10.000,volume=-14.99dB,afade=t=out:st=8.500:d=1.5[m];[v]asplit=2[vm][vk];[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[md];[vm][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]';

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
  assert.match(two, /volume=-8\.99dB/, 'the brand gain plus the 3 dB the mono mix used to add to centred music');
  assert.match(two, /\[v\]asplit=2\[vm\]\[vk\];\[m\]\[vk\]sidechaincompress/);
});

test('duck needs both speech and music', () => {
  const voiceOnly = mixFilter({ speech: 1, duration: 5, duck: true });
  const musicOnly = mixFilter({ music: true, duration: 5, duck: true });
  assert.equal(voiceOnly, '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:5.000[s1];[s1]anull[v];[v]loudnorm=I=-14:TP=-1.5:LRA=11[a]');
  assert.equal(musicOnly, '[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:5.000,volume=-14.99dB,afade=t=out:st=3.500:d=1.5[m];[m]loudnorm=I=-14:TP=-1.5:LRA=11[a]');
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

// Real ffmpeg: the mix is stereo, a wide track keeps its sides apart, and a centred track sits against the voice
// where the old mono mix put it (7.9 dB voice over music at the default -18 dB gain, measured before the change).
test('the final mix is stereo: music keeps its sides, the voice-to-music balance is the old one', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-stereo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const voice = path.join(dir, 'voice.wav'), centred = path.join(dir, 'c.wav'), wide = path.join(dir, 'w.wav'), out = path.join(dir, 'o.wav');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=1000:d=4:sample_rate=24000', '-af', 'volume=0.3', '-ac', '1', voice], { timeoutMs: 60000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=300:d=4:sample_rate=44100', '-ac', '2', centred], { timeoutMs: 60000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=300:d=4:sample_rate=44100', '-f', 'lavfi', '-i', 'sine=f=500:d=4:sample_rate=44100',
    '-filter_complex', '[0][1]join=inputs=2:channel_layout=stereo', wide], { timeoutMs: 60000 });
  const band = async (ch, hz) => Number(/mean_volume: (-?[\d.]+) dB/.exec(await ffmpegReport(['-i', out, '-af', `pan=mono|c0=${ch},bandpass=f=${hz}:w=40,volumedetect`, '-f', 'null', '-']))[1]);
  const mix = (music) => ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-i', voice, '-i', music,
    '-filter_complex', mixFilter({ speech: 1, music: true, duration: 4, gainDb: -18, fadeOut: 0.5 }), '-map', '[a]', '-ar', '48000', '-t', '4', out], { timeoutMs: 60000 });
  await mix(centred);
  assert.match(await ffmpegReport(['-i', out, '-f', 'null', '-', '-t', '0.1']), /Audio: [^,]+, 48000 Hz, stereo/);
  const balance = (await band('c0', 1000)) - (await band('c0', 300));
  assert.ok(Math.abs(balance - 7.9) < 0.8, `voice over centred music ${balance.toFixed(1)} dB`);
  await mix(wide);
  assert.ok((await band('c1', 500)) - (await band('c1', 300)) > 20, 'the right side carries the right-only tone, not the left one');
});
