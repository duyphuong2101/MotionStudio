import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson } from '../engine/core.mjs';
import { ffmpeg, probeMedia, videoInfo } from '../engine/media.mjs';
import {
  validateClipOptions, clipName, cutTimes, shotsFromCuts, lastCrop, barsFrom, maskFrame, maskExpr, maskArgs, clipGraph, clipArgs, tempo, searchWords,
  footageDir, footageImage, clipSidecar, analyseFootage, findWords, makeClip, previewFrame, forgetFootage, rhythmOf,
} from '../engine/footage.mjs';

test('the cut rhythm of an analysed video: shots, average and median shot, cuts a minute', () => {
  const doc = { shots: [{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 6 }, { start: 6, end: 12 }] };
  assert.deepEqual(rhythmOf(doc), { shots: 4, averageShot: 3, medianShot: 2.5, cutsPerMinute: 15 });
  assert.deepEqual(rhythmOf({ shots: doc.shots.slice(0, 3) }), { shots: 3, averageShot: 2, medianShot: 2, cutsPerMinute: 20 });
  assert.equal(rhythmOf({ shots: [{ start: 0, end: 15 }] }), null, 'one shot has no rhythm');
  assert.equal(rhythmOf(null), null);
});

const INFO = { duration: 10, width: 1920, height: 1080, hasAudio: true };
const opts = (o = {}) => validateClipOptions({ in: 1, out: 4, ...o }, INFO, 120);

test('clip options get defaults and their stored shape', () => {
  assert.deepEqual(opts(), {
    in: 1, out: 4, crop: null, band: null, fill: 'cover', blurRegions: [], keep: null, gainDb: 0, mute: false, speed: 1, width: 1920, height: 1080,
  });
  const o = opts({ in: '2.5', out: '10.03', band: { bottom: '12' }, gainDb: -4.5, mute: true, width: 1080, height: 1920, fill: 'blur-fill' });
  assert.equal(o.in, 2.5);
  assert.equal(o.out, 10, 'an out a hair past the end is clamped to the end');
  assert.deepEqual(o.band, { top: 0, bottom: 12 });
  assert.equal(o.gainDb, -4.5);
  assert.equal(opts({ band: { top: 0, bottom: 0 } }).band, null, 'an empty band is no crop');
});

test('clip options outside the source are refused with a message that says what to fix', () => {
  const bad = [
    [{ in: -1 }, /in must be between 0 and 10/], [{ in: 10 }, /in must be between/], [{ out: 1 }, /out must come after in/],
    [{ out: 11 }, /past the end/], [{ in: 'x' }, /in must be a number/], [{ out: '' }, /out must be a number/], [{ in: true }, /in must be a number/],
    [{ out: 1.1 }, /at least 0.2 s/], [{ fill: 'stretch' }, /fill must be cover or blur-fill/],
    [{ crop: { x: 100, y: 0, w: 1900, h: 1080 } }, /crop must lie inside the 1920x1080 frame/],
    [{ crop: { x: 0, y: 0, w: 4, h: 1080 } }, /at least 8 px/],
    [{ blurRegions: [{ x: 0, y: 1000, w: 100, h: 100 }] }, /blur region 1 must lie inside/],
    [{ blurRegions: Array.from({ length: 9 }, () => ({ x: 0, y: 0, w: 10, h: 10 })) }, /At most 8 blur regions/],
    [{ blurRegions: 'all' }, /list of rectangles/],
    [{ keep: { cx: 2000, cy: 500, rx: 100, ry: 100 } }, /kept ellipse/], [{ keep: { cx: 960, cy: 500, rx: 2, ry: 100 } }, /kept ellipse/],
    [{ gainDb: 13 }, /Gain must be from -24 to \+12 dB/], [{ gainDb: -25 }, /Gain/], [{ speed: 5 }, /Speed must be from 0.25 to 4/], [{ speed: 0.1 }, /Speed/], [{ speed: 'fast' }, /speed must be a number/],
    [{ band: { bottom: 50 } }, /percentages from 0 to 45/], [{ width: 1919 }, /width must be an even number/], [{ height: 4000 }, /height/],
  ];
  for (const [o, re] of bad) assert.throws(() => opts(o), re, JSON.stringify(o));
  assert.throws(() => validateClipOptions({ in: 0, out: 130 }, { ...INFO, duration: 200 }, 120), /at most 120 s/);
});

test('clip names are clean .mp4 asset names', () => {
  assert.equal(clipName('Hero cut'), 'Hero-cut.mp4');
  assert.equal(clipName('intro.MP4'), 'intro.mp4');
  assert.equal(clipName('show.mov'), 'show.mp4');
  assert.equal(clipName('../../evil'), 'evil.mp4');
  assert.equal(clipName('setup.exe'), 'setup.exe.mp4');
  assert.throws(() => clipName('   '), /Give the clip a file name/);
});

test('scene cuts become shots; cuts too close together or to the end are ignored', () => {
  const log = '[Parsed_showinfo_1] n:   0 pts:  60060 pts_time:2.002 duration:...\n[Parsed_showinfo_1] n:   1 pts: 63000 pts_time:2.3 ...\n x pts_time:7.7';
  assert.deepEqual(cutTimes(log), [2.002, 2.3, 7.7]);
  assert.deepEqual(shotsFromCuts(cutTimes(log), 8, 0.6), [
    { n: 1, start: 0, end: 2.002, mid: 1.001 }, { n: 2, start: 2.002, end: 8, mid: 5.001 },
  ]);
  assert.deepEqual(shotsFromCuts([], 0.4, 0.6), [{ n: 1, start: 0, end: 0.4, mid: 0.2 }]);
  assert.deepEqual(shotsFromCuts([0.3, 3], 6, 0.6).map((s) => s.start), [0, 3]);
});

test('letterbox bars: the black or white detection that removes more, within sane limits', () => {
  const log = '[Parsed_cropdetect_0] x1:0 ... crop=1920:1080:0:0\n[Parsed_cropdetect_0] ... crop=1920:800:0:140';
  assert.deepEqual(lastCrop(log), { w: 1920, h: 800, x: 0, y: 140 });
  assert.equal(lastCrop('nothing here'), null);
  const full = { w: 1920, h: 1080, x: 0, y: 0 };
  assert.equal(barsFrom(full, full, 1920, 1080), null, 'no bars');
  assert.deepEqual(barsFrom(full, { w: 1920, h: 800, x: 0, y: 140 }, 1920, 1080), {
    color: 'white', crop: { w: 1920, h: 800, x: 0, y: 140 }, top: 140, bottom: 140, left: 0, right: 0,
  });
  assert.equal(barsFrom({ w: 1920, h: 300, x: 0, y: 390 }, null, 1920, 1080), null, 'a dark scene is not a letterbox');
  assert.equal(barsFrom({ w: 1920, h: 1080, x: 10, y: 0 }, null, 1920, 1080), null, 'a crop outside the frame is ignored');
});

test('the blur mask: feathered rectangles (no fade at the frame edge) times the kept ellipse', () => {
  assert.equal(
    maskExpr(maskFrame(opts({ blurRegions: [{ x: 0, y: 0, w: 1920, h: 800 }], keep: { cx: 960, cy: 500, rx: 300, ry: 400 } }), INFO)),
    '255*clip((800-Y)/30\\,0\\,1)*clip((hypot((X-960)/300\\,(Y-500)/400)-0.92)/0.12\\,0\\,1)',
  );
  assert.equal(
    maskExpr(maskFrame(opts({ blurRegions: [{ x: 10, y: 20, w: 100, h: 50 }, { x: 0, y: 0, w: 1920, h: 1080 }] }), INFO)),
    '255*max(clip((min(min(min(X-10\\,110-X)\\,Y-20)\\,70-Y))/30\\,0\\,1)\\,1)*1',
  );
  assert.equal(maskExpr({ W: 64, H: 64, blurRegions: [], keep: { cx: 1, cy: 2, rx: 30, ry: 40 } }), '255*1*clip((hypot((X-1)/30\\,(Y-2)/40)-0.92)/0.12\\,0\\,1)');
  assert.deepEqual(maskArgs({ W: 64, H: 48, blurRegions: [], keep: { cx: 1, cy: 2, rx: 30, ry: 40 } }, 'm.png').slice(0, 5), ['-y', '-f', 'lavfi', '-i', 'color=black:s=64x48,format=gray']);
  assert.equal(maskFrame(opts(), INFO), null, 'nothing to blur, no mask');
});

test('with a crop the mask lives in the cropped frame, so the blur never samples the bars', () => {
  const o = opts({ crop: { x: 0, y: 140, w: 1920, h: 800 }, blurRegions: [{ x: 0, y: 0, w: 400, h: 300 }], keep: { cx: 960, cy: 100, rx: 300, ry: 200 } });
  assert.deepEqual(maskFrame(o, INFO), { W: 1920, H: 800, blurRegions: [{ x: 0, y: 0, w: 400, h: 160 }], keep: { cx: 960, cy: -40, rx: 300, ry: 200 } });
  assert.ok(maskExpr(maskFrame(o, INFO)).includes('(Y+40)/200'), 'a centre above the crop stays valid ffmpeg');
  assert.equal(maskFrame(opts({ crop: { x: 0, y: 140, w: 1920, h: 800 }, blurRegions: [{ x: 0, y: 0, w: 400, h: 100 }] }), INFO), null, 'a region only on the bars blurs nothing');
  assert.ok(clipGraph(o, INFO).startsWith('[0:v]crop=1920:800:0:140,split[src][soft];[soft]boxblur=24:3[bl]'));
});

test('clip graphs: cover with a caption band, blur-fill, masked blur, sound', () => {
  assert.equal(clipGraph(opts({ band: { bottom: 12 } }), INFO),
    '[0:v]crop=iw:ih*0.88:0:ih*0,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,format=yuv420p[v];[0:a:0]volume=0dB[a]');
  const vertical = { duration: 10, width: 1080, height: 1920, hasAudio: false };
  assert.equal(clipGraph(validateClipOptions({ in: 0, out: 2, fill: 'blur-fill', crop: { x: 0, y: 100, w: 1080, h: 1600 } }, vertical, 120), vertical), [
    '[0:v]crop=1080:1600:0:100,split[a][b]',
    '[a]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=45,eq=brightness=-0.2:saturation=0.85[bg]',
    '[b]scale=1920:1080:force_original_aspect_ratio=decrease[fg]',
    '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]',
  ].join(';'));
  const masked = clipGraph(opts({ keep: { cx: 960, cy: 500, rx: 300, ry: 400 }, gainDb: -4.5 }), INFO);
  assert.ok(masked.startsWith('[0:v]split[src][soft];[soft]boxblur=24:3[bl];[bl][1:v]alphamerge[bm];[src][bm]overlay=0:0:shortest=1[sharp];[sharp]scale='), masked);
  assert.ok(masked.endsWith('[0:a:0]volume=-4.5dB[a]'));
  assert.ok(!clipGraph(opts({ mute: true }), INFO).includes('[a]'), 'muted: no audio chain');
});

// A faster clip: setpts drops frames and atempo keeps the pitch; the output lasts the span over the speed (11 s at 2x is 5.5 s).
test('clip speed: setpts and atempo in the graph, the output length divided by the speed', () => {
  assert.equal(tempo(1), '');
  assert.equal(tempo(2), ',atempo=2');
  assert.equal(tempo(4), ',atempo=2,atempo=2');
  assert.equal(tempo(3), ',atempo=2,atempo=1.5');
  assert.equal(tempo(0.25), ',atempo=0.5,atempo=0.5');
  const fast = opts({ in: 1, out: 10, speed: 2 });
  assert.ok(clipGraph(fast, INFO).includes('crop=1920:1080,setpts=PTS/2,setsar=1,format=yuv420p[v]'));
  assert.ok(clipGraph(fast, INFO).endsWith('[0:a:0]volume=0dB,atempo=2[a]'));
  const a = clipArgs(fast, INFO, { src: 's.mp4', out: 'o.mp4' });
  assert.deepEqual(a.slice(0, 6), ['-y', '-ss', '1', '-t', '9', '-i'], 'the source span is read in full');
  assert.equal(a[a.lastIndexOf('-t') + 1], '4.5', 'the output lasts half the span');
  assert.ok(!clipGraph(opts(), INFO).includes('setpts') && !clipGraph(opts(), INFO).includes('atempo'), 'speed 1 changes nothing');
});

test('clip arguments: seek, encode settings, sound or -an, one-frame preview', () => {
  const a = clipArgs(opts({ gainDb: 2 }), INFO, { src: 's.mp4', out: 'o.mp4' });
  assert.deepEqual(a.slice(0, 7), ['-y', '-ss', '1', '-t', '3', '-i', 's.mp4']);
  assert.ok(a.join(' ').includes('-map [v] -map [a] -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -g 15 -c:a aac -b:a 192k -ar 48000 -t 3'));
  const m = clipArgs(opts({ mute: true, keep: { cx: 9, cy: 9, rx: 9, ry: 9 } }), INFO, { src: 's.mp4', mask: 'm.png', out: 'o.mp4' });
  assert.ok(m.join(' ').includes('-i s.mp4 -loop 1 -i m.png') && m.includes('-an') && !m.includes('[a]'));
  const f = clipArgs(opts(), INFO, { src: 's.mp4', out: 'p.jpg', frame: true });
  assert.ok(!f.includes('-t') && f.join(' ').endsWith('-frames:v 1 -q:v 3 p.jpg') && !f.join(' ').includes('volume'));
});

test('transcript search ignores accents and punctuation and lists hits with their segment', () => {
  const doc = {
    segments: [{ start: 0, end: 3, text: 'Xin chào, Việt Nam!' }, { start: 3, end: 6, text: 'The award goes to NSC.' }],
    words: [['Xin', 0, 0.5], ['chào,', 0.5, 1], ['Việt', 1, 1.5], ['Nam!', 1.5, 2], ['The', 3, 3.3], ['award', 3.3, 3.8], ['goes', 3.8, 4.2], ['to', 4.2, 4.4], ['NSC.', 4.4, 5]]
      .map(([w, start, end]) => ({ w, start, end })),
  };
  const r = searchWords(doc, 'viet  nam', 50);
  assert.equal(r.total, 1);
  assert.deepEqual(r.hits[0], { start: 1, end: 2, text: 'Xin chào, Việt Nam! The award goes to NSC.', segment: { start: 0, end: 3 } });
  assert.equal(searchWords(doc, 'awa', 50).hits[0].start, 3.3, 'the last word may be a prefix');
  assert.equal(searchWords(doc, 'award goes to nsc', 50).hits[0].end, 5);
  assert.equal(searchWords(doc, 'aw goes', 50).total, 0, 'only the last word is a prefix');
  assert.equal(searchWords(doc, 'the', 0).total, 1, 'the count goes on past the cap');
  assert.throws(() => searchWords(doc, ' ,. ', 50), /Type a word or phrase/);
});

test('footage paths refuse traversal and unknown image names', () => {
  assert.throws(() => footageDir('zz-x', '../secret.mp4'), /Invalid asset name/);
  assert.throws(() => footageDir('../x', 'a.mp4'), /Invalid project/);
  assert.throws(() => footageImage('zz-x', 'a.mp4', '../shots.json'), /Invalid image name/);
  assert.throws(() => footageImage('zz-x', 'a.mp4', 'shots.json'), /Invalid image name/);
  assert.ok(footageImage('zz-x', 'a.mp4', '12.jpg').endsWith(path.join('_footage', 'zz-x', 'a.mp4', 'thumbs', '12.jpg')));
  assert.ok(footageImage('zz-x', 'a.mp4', 'preview.jpg').endsWith(path.join('a.mp4', 'preview.jpg')));
  assert.throws(() => clipSidecar('zz-x', '..'), /Invalid clip name/);
});

test('a rotated phone video reports its upright size', () => {
  const report = 'Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 29.97 fps, 30 tbr\n    Side data:\n      displaymatrix: rotation of -90.00 degrees';
  assert.deepEqual(videoInfo(report), { width: 1080, height: 1920, fps: 29.97 });
  assert.deepEqual(videoInfo('Stream #0:0: Video: h264, yuv420p, 640x360, 25 fps'), { width: 640, height: 360, fps: 25 });
  assert.deepEqual(videoInfo('Stream #0:0: Audio: aac'), { width: null, height: null, fps: null });
});

/* ---------- real ffmpeg on generated footage ---------- */

const P = 'zz-test-footage';
const ASSETS = path.join(DIRS.profiles, P, 'assets');

test('real footage: a hard cut is found, white bars detected, clips and sidecars written', { timeout: 240000 }, async (t) => {
  t.after(() => {
    fs.rmSync(path.join(DIRS.profiles, P), { recursive: true, force: true });
    fs.rmSync(path.join(DIRS.out, '_footage', P), { recursive: true, force: true });
  });
  fs.mkdirSync(ASSETS, { recursive: true });
  // 4 s: red for 2 s, then blue, inside white letterbox bars (30 px top and bottom), with a tone.
  const src = (c) => `color=c=${c}:s=320x180:r=30:d=2,pad=320:240:0:30:white`;
  await ffmpeg(['-y', '-f', 'lavfi', '-i', src('red'), '-f', 'lavfi', '-i', src('blue'), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=48000',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(ASSETS, 'cut.mp4')], { timeoutMs: 60000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=s=1080x1920:r=30:d=1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(ASSETS, 'phone.mp4')], { timeoutMs: 60000 });

  const doc = await analyseFootage(P, 'cut.mp4');
  assert.equal(doc.shots.length, 2, JSON.stringify(doc.shots));
  assert.ok(Math.abs(doc.shots[1].start - 2) < 0.1, `cut at ${doc.shots[1].start}`);
  assert.deepEqual([doc.width, doc.height, doc.hasAudio], [320, 240, true]);
  assert.equal(doc.bars?.color, 'white');
  assert.deepEqual([doc.bars.top, doc.bars.bottom], [30, 30]);
  for (const s of doc.shots) assert.ok(fs.existsSync(footageImage(P, 'cut.mp4', s.thumb)), s.thumb);
  assert.equal((await analyseFootage(P, 'cut.mp4')).madeAt, doc.madeAt, 'cached while the file is unchanged');
  assert.throws(() => findWords(P, 'cut.mp4', 'hello'), /no transcript yet/);

  const clip = await makeClip(P, 'phone.mp4', { in: 0, out: 1, fill: 'blur-fill', name: 'phone wide', gainDb: 3 }, { by: 'test' });
  assert.equal(clip.name, 'phone-wide.mp4');
  const info = await probeMedia(path.join(ASSETS, 'phone-wide.mp4'));
  assert.deepEqual([info.width, info.height, info.hasAudio], [1920, 1080, false]);
  assert.ok(Math.abs(info.duration - 1) < 0.1, `clip is ${info.duration} s`);
  const side = readJson(clipSidecar(P, 'phone-wide.mp4'));
  assert.equal(side.source, 'phone.mp4');
  assert.deepEqual([side.in, side.out, side.fill, side.sound, side.by], [0, 1, 'blur-fill', false, 'test']);
  await assert.rejects(makeClip(P, 'phone.mp4', { in: 0, out: 1, name: 'phone-wide.mp4' }), /already exists/);
  await assert.rejects(makeClip(P, 'phone.mp4', { in: 0, out: 1, name: 'phone.mp4', replace: true }), /cannot replace its own source/);

  // Bars crop, masked blur (kept ellipse), caption band and gain on the sound clip; then a preview frame of the same options.
  const masked = { in: 0.5, out: 3.5, crop: doc.bars.crop, band: { bottom: 12 }, keep: { cx: 160, cy: 120, rx: 60, ry: 80 }, gainDb: -6, width: 640, height: 360, name: 'cut-soft' };
  await makeClip(P, 'cut.mp4', masked);
  const m = await probeMedia(path.join(ASSETS, 'cut-soft.mp4'));
  assert.deepEqual([m.width, m.height, m.hasAudio], [640, 360, true]);
  const frame = await previewFrame(P, 'cut.mp4', masked);
  assert.equal(frame.image, 'preview.jpg');
  assert.ok(fs.statSync(footageImage(P, 'cut.mp4', 'preview.jpg')).size > 1000);
  assert.ok(!fs.existsSync(path.join(footageDir(P, 'cut.mp4'), 'work-clip')), 'scratch folders are removed');

  forgetFootage(P, 'phone-wide.mp4');
  assert.ok(!fs.existsSync(clipSidecar(P, 'phone-wide.mp4')));
});
