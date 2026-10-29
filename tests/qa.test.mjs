import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLoudness, parseBlack, parseFreeze, parseJumps, parseSrt, checkCaptions, judge, runQa, QA_RULES } from '../engine/qa.mjs';
import { cuesOf, wrapCue, toSrt, CUE_LINE } from '../engine/timing.mjs';
import { ffmpeg } from '../engine/media.mjs';

const SUMMARY = `[Parsed_ebur128_1 @ 0000] Summary:

  Integrated loudness:
    I:         -14.3 LUFS
    Threshold: -24.6 LUFS

  Loudness range:
    LRA:         3.1 LU

  True peak:
    Peak:       -1.4 dBFS`;

test('ffmpeg reports are read: loudness summary, black and freeze segments', () => {
  assert.deepEqual(parseLoudness(`noise I: -99 LUFS\n${SUMMARY}`), { integrated: -14.3, range: 3.1, truePeak: -1.4 });
  assert.equal(parseLoudness('no summary here'), null);
  assert.deepEqual(parseBlack('[blackdetect @ 1] black_start:0 black_end:1.0333 black_duration:1.03\n[blackdetect @ 1] black_start:5.5 black_end:6 black_duration:0.5'),
    [{ start: 0, end: 1.03 }, { start: 5.5, end: 6 }]);
  const freeze = '[freezedetect @ 1] lavfi.freezedetect.freeze_start: 1.2\nlavfi.freezedetect.freeze_duration: 3\n[freezedetect @ 1] lavfi.freezedetect.freeze_end: 4.2\n[freezedetect @ 1] lavfi.freezedetect.freeze_start: 9';
  assert.deepEqual(parseFreeze(freeze, 10), [{ start: 1.2, end: 4.2 }, { start: 9, end: 10 }], 'a freeze open at the end closes at the duration');
});

test('captions: valid cues pass; overlap, reversal, overrun, long and broken cues are named', () => {
  const ok = '1\n00:00:00,200 --> 00:00:01,500\nHello there.\n\n2\n00:00:01,600 --> 00:00:03,000\nSecond line\nwraps here.\n';
  assert.equal(parseSrt(ok).length, 2);
  assert.deepEqual(checkCaptions(ok, 3).issues, []);
  const bad = [
    '1\n00:00:01,000 --> 00:00:00,500\nBackwards',
    '2\n00:00:00,400 --> 00:00:02,000\nOverlaps the first',
    `3\n00:00:02,000 --> 00:00:09,000\n${'x'.repeat(QA_RULES.cueMaxChars + 1)}`,
    '4\nnot a time line\ntext',
  ].join('\n\n');
  const issues = checkCaptions(bad, 5).issues.join(' | ');
  for (const want of ['cue 1 ends before it starts', 'cue 2 overlaps', 'cue 3 runs past the end', 'cue 3 is 85 characters', 'cue 4 is not valid SRT']) assert.match(issues, new RegExp(want));
});

test('the verdict: wrong length or no audio fails; loudness, black, freeze and platform warn', () => {
  const base = { probe: { duration: 20, hasAudio: true, hasVideo: true }, loudness: { integrated: -14.2, range: 4, truePeak: -1.6 }, black: [], freeze: [], captions: { cues: 3, issues: [] } };
  const expect = { width: 1920, height: 1080, fps: 30, duration: 20, silent: false, format: '16:9', platformFormats: ['16:9'] };
  assert.deepEqual(judge(base, expect), { passed: true, errors: 0, warnings: 0, findings: [] });

  const r = judge({
    ...base, probe: { duration: 18, hasAudio: false, hasVideo: true }, loudness: { integrated: -20, range: 4, truePeak: -0.2 },
    black: [{ start: 0, end: 0.3 }, { start: 10, end: 11 }], freeze: [{ start: 2, end: 6 }], captions: { cues: 1, issues: ['cue 1 has no text'] },
  }, { ...expect, platformFormats: ['9:16'] });
  assert.equal(r.passed, false);
  assert.deepEqual(r.findings.map((x) => `${x.level}:${x.check}`), [
    'error:length', 'error:audio', 'warning:loudness', 'warning:loudness', 'warning:black', 'warning:freeze', 'warning:platform', 'warning:captions',
  ], 'a 0.3 s black flash is ignored, a 1 s one is not');
  assert.equal(judge({ ...base, loudness: { integrated: null, range: 0, truePeak: null } }, { ...expect, silent: true }).warnings, 0, 'a silent video is not judged on loudness');
  // The picture: a file without video, or at another size than its format, fails.
  assert.deepEqual(judge({ ...base, probe: { ...base.probe, hasVideo: false } }, expect).findings.map((x) => x.check), ['video']);
  const small = judge({ ...base, probe: { ...base.probe, width: 1280, height: 720 } }, expect);
  assert.deepEqual([small.passed, small.findings[0].msg], [false, 'the picture is 1280x720, the format is 1920x1080']);
  assert.equal(judge({ ...base, probe: { ...base.probe, width: 1920, height: 1080 } }, expect).passed, true);
});

test('hard cuts: scdet hits are read, hits a frame apart are one cut, a low score is no cut', () => {
  const log = '[scdet @ 1] lavfi.scd.score: 20.053, lavfi.scd.time: 176.533333\n[scdet @ 1] lavfi.scd.score: 13.529, lavfi.scd.time: 176.566667\n[scdet @ 1] lavfi.scd.score: 69.416, lavfi.scd.time: 129.2';
  assert.deepEqual(parseJumps(log), [{ t: 176.53, score: 20.1 }, { t: 176.57, score: 13.5 }, { t: 129.2, score: 69.4 }]);
  const base = { probe: { duration: 200, hasAudio: true, hasVideo: true }, loudness: { integrated: -14, range: 4, truePeak: -1.6 }, black: [], freeze: [], captions: null };
  const expect = { width: 1920, height: 1080, fps: 30, duration: 200, silent: false };
  const r = judge({ ...base, jumps: [{ t: 129.2, score: 69.4 }, { t: 176.53, score: 20.1 }, { t: 176.57, score: 13.5 }, { t: 180, score: QA_RULES.cutJump - 1 }] }, expect);
  assert.deepEqual(r.findings.map((x) => `${x.level}:${x.check}`), ['warning:cut', 'warning:cut']);
  assert.match(r.findings[0].msg, /at 129\.2 s/);
  assert.equal(r.passed, true, 'a hard cut warns, it never fails QA');
  assert.equal(judge(base, expect).warnings, 0, 'a receipt from before the cut check has no jumps');
});

test('QA on a real file warns on a one-frame cut and not on the same change as a fade', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-qa-cut-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = async (name, join) => {
    const file = path.join(dir, name);
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=0x262524:s=320x180:r=30:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-filter_complex', `[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]${join},format=yuv420p[v]`,
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file], { timeoutMs: 60000 });
    return file;
  };
  const expect = { width: 320, height: 180, fps: 30, silent: false };
  const hard = await runQa(await make('hard.mp4', 'concat=n=2:v=1:a=0'), { ...expect, duration: 4 });
  assert.ok(hard.measured.jumps.some((j) => Math.abs(j.t - 2) < 0.1), `a jump at 2 s, got ${JSON.stringify(hard.measured.jumps)}`);
  assert.ok(hard.findings.some((f) => f.check === 'cut'));
  const soft = await runQa(await make('soft.mp4', 'xfade=transition=fade:duration=0.6:offset=1.4'), { ...expect, duration: 3.4 });
  assert.deepEqual(soft.measured.jumps, [], 'a 0.6 s fade is no hard cut');
});

test('captions are cut into readable cues of at most two lines, never longer than the scene', () => {
  assert.equal(wrapCue('Short line.'), 'Short line.');
  const two = wrapCue('Every claim on screen comes from the page or the facts in the brief.');
  assert.equal(two.split('\n').length, 2);
  assert.ok(two.split('\n').every((l) => l.length <= CUE_LINE));

  const text = 'Motion Studio turns a short brief into a finished brand video. A person approves every storyboard before anything renders, and the render adds captions and music.';
  const words = text.split(' ').map((w, i) => ({ w, start: 0.2 + i * 0.35, end: 0.2 + i * 0.35 + 0.3 }));
  const cues = cuesOf(words, 12);
  assert.ok(cues.length >= 2, 'a long line becomes several cues');
  assert.ok(cues.every((c) => c.text.replace('\n', ' ').length <= CUE_LINE * 2));
  assert.equal(cues[0].text.replace('\n', ' '), 'Motion Studio turns a short brief into a finished brand video.', 'a sentence end closes a cue');
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, 'cues do not overlap');
  assert.ok(cues.at(-1).end <= 12);

  const srt = toSrt({ scenes: [{ id: 'a', start: 0, end: 12 }, { id: 'b', start: 12, end: 14 }], words: words.map((w) => ({ ...w, scene: 'a' })) },
    { scenes: [{ id: 'a', vo: text }, { id: 'b', vo: '' }] });
  assert.deepEqual(checkCaptions(srt, 14).issues, [], 'a scene with no voice line adds no empty cue');
});

test('QA on a real file finds the black opening and the frozen middle', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-qa-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'clip.mp4');
  await ffmpeg(['-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:r=30:d=3.5',
    '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file], { timeoutMs: 60000 });
  const r = await runQa(file, { width: 320, height: 240, fps: 30, duration: 6, silent: false, format: '4:3' }, '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
  assert.equal(r.measured.black[0].start, 0);
  assert.ok(Math.abs(r.measured.black[0].end - 1) < 0.1, `black ends near 1 s, got ${r.measured.black[0].end}`);
  assert.ok(r.measured.freeze.some((z) => z.end - z.start >= 3), `a freeze of 3 s or more, got ${JSON.stringify(r.measured.freeze)}`);
  assert.equal(typeof r.measured.loudness.integrated, 'number');
  assert.equal(r.measured.captions.cues, 1);
  assert.ok(r.findings.some((f) => f.check === 'black') && r.findings.some((f) => f.check === 'freeze'));
  assert.equal(r.passed, true, 'warnings alone do not fail QA');
});
