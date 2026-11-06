import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg, probeMedia } from '../engine/media.mjs';
import { sceneFrames, sceneClipArgs, timelineXml } from '../engine/export.mjs';
import { musicStemArgs } from '../engine/pipeline.mjs';

const timing = { duration: 4, scenes: [{ id: 'intro', start: 0, end: 1.32 }, { id: 'b&c', start: 1.32, end: 2.71 }, { id: 'end', start: 2.71, end: 4 }] };

test('scenes become whole frames, end to end, covering the video', () => {
  const s = sceneFrames(timing, 30);
  assert.deepEqual(s.map((x) => [x.name, x.from, x.frames]), [['01-intro.mp4', 0, 40], ['02-b&c.mp4', 40, 41], ['03-end.mp4', 81, 39]]);
  assert.equal(s.reduce((n, x) => n + x.frames, 0), 120);
  for (let i = 1; i < s.length; i++) assert.equal(s[i].from, s[i - 1].from + s[i - 1].frames);
});

test('timeline.xml: scene clips on V1 in order, one audio track per stem, names escaped', () => {
  const scenes = sceneFrames(timing, 30);
  const x = timelineXml({ title: 'A <b> & "c"', fps: 30, width: 1080, height: 1920, total: 120, scenes, stems: ['voice.wav', 'music.wav'], dir: path.join(os.tmpdir(), 'ex port') });
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE xmeml>\n<xmeml version="5">/);
  assert.match(x, /<name>A &lt;b&gt; &amp; &quot;c&quot;<\/name><duration>120<\/duration>/);
  assert.equal((x.match(/<clipitem id="clip-v/g) || []).length, 3);
  assert.equal((x.match(/<clipitem id="clip-a/g) || []).length, 2);
  assert.match(x, /<name>02-b&amp;c\.mp4<\/name><duration>41<\/duration>.*?<start>40<\/start><end>81<\/end><in>0<\/in><out>41<\/out>/s);
  assert.match(x, /<pathurl>file:\/\/localhost\/[^<]*ex%20port\/scenes\/01-intro\.mp4<\/pathurl>/);
  assert.match(x, /<name>music\.wav<\/name>.*?<channelcount>2<\/channelcount>/s);
  assert.ok(!/[<&](?!\/?[a-zA-Z!?]|amp;|lt;|gt;|quot;)/.test(x), 'no raw & or < in text');
});

test('a scene clip is frame exact and silent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-export-'));
  try {
    const video = path.join(dir, 'video.mp4');
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    for (const s of sceneFrames(timing, 30)) {
      const out = path.join(dir, s.name);
      await ffmpeg(sceneClipArgs(video, s, 30, out));
      const info = await probeMedia(out);
      assert.ok(Math.abs(info.duration - s.frames / 30) < 0.04, `${s.name}: ${info.duration} s for ${s.frames} frames`);
      assert.equal(info.hasAudio, false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the music stem is the brand track as the mix places it, not loudness-normalised', async () => {
  const brand = { music: { file: 'library:calm-pad', gainDb: -18 } };
  const args = await musicStemArgs('demo', brand, { duration: 20, musicShift: 2.5, out: 'music.wav' });
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.ok(!graph.includes('loudnorm'), graph);
  assert.match(graph, /\[m\]anull\[a\]$/);
  assert.match(graph, /volume=-14\.99dB/, 'at the brand level plus the stereo lift, as in the mix');
  assert.ok(args.includes('-ss') || graph.includes('atrim=start=2.5'), 'moved by the drop shift');
  assert.equal(await musicStemArgs('demo', { music: {} }, { duration: 5, out: 'm.wav' }), null);
});
