import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, readJson, writeJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { ffmpeg, probeMedia } from '../engine/media.mjs';
import { mixFilter } from '../engine/pipeline.mjs';
import {
  createSequence, updateSequence, loadSequence, getSequenceStatus, setSequenceStatus, sequencePlan, musicBedPlan, loopMusic, previewSequence, renderSequence, sequenceStatusView, versionBase, nextVersionFile,
} from '../engine/sequences.mjs';

const LAND = { width: 1920, height: 1080 };
const clean = (t, project) => t.after(() => ['profiles', 'briefs', 'sequences', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], project), { recursive: true, force: true })));

function doneJob(project, id) {
  saveBrief(validateBrief({ id, project, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  setStatus(project, id, { status: 'done', outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: 10 } }, 'test');
}

/* ---------- validation and storage ---------- */
test('musicBed must be a boolean and is stored only when on', (t) => {
  const P = 'zz-test-seqbed';
  clean(t, P);
  for (const id of ['intro', 'demo']) { doneJob(P, id); fs.writeFileSync(jobFile(P, id, 'final.mp4'), ''); }
  const seq = (over) => ({ id: 'film', project: P, format: '16:9', transition: 'cut', parts: ['intro', 'demo'], ...over });
  for (const musicBed of ['yes', 1, 'true', {}]) assert.throws(() => createSequence(seq({ musicBed })), /musicBed must be true or false/, String(musicBed));
  assert.ok(!('musicBed' in createSequence(seq({ id: 'off', musicBed: false }))), 'off is the default and is not written');
  assert.ok(!('musicBed' in createSequence(seq({ id: 'unset' }))));
  assert.equal(createSequence(seq()).musicBed, undefined);
  assert.equal(updateSequence(P, 'film', { musicBed: false }).changed.length, 0, 'false on a sequence without the field is no change');
});

test('turning musicBed on or off makes the old render stale', (t) => {
  const P = 'zz-test-seqbed2';
  clean(t, P);
  for (const id of ['intro', 'demo']) { doneJob(P, id); fs.writeFileSync(jobFile(P, id, 'final.mp4'), ''); }
  createSequence({ id: 'film', project: P, format: '16:9', transition: 'cut', parts: ['intro', 'demo'] });
  const rendered = () => { setSequenceStatus(P, 'film', { status: 'done', outputs: { final: 'final.mp4' } }, 'test'); fs.writeFileSync(jobFile(P, 'film', 'final.mp4'), ''); };
  rendered();
  assert.deepEqual(updateSequence(P, 'film', { musicBed: true }).changed, ['musicBed']);
  assert.equal(loadSequence(P, 'film').musicBed, true);
  assert.equal(getSequenceStatus(P, 'film').status, 'draft');
  assert.ok(!fs.existsSync(jobFile(P, 'film', 'final.mp4')));
  rendered();
  assert.deepEqual(updateSequence(P, 'film', { musicBed: false }).changed, ['musicBed']);
  assert.ok(!('musicBed' in loadSequence(P, 'film')));
  assert.equal(getSequenceStatus(P, 'film').status, 'draft');
  assert.throws(() => updateSequence(P, 'film', { musicBed: 'on' }), /musicBed must be true or false/);
});

/* ---------- ffmpeg arguments (pure) ---------- */
const render = { fps: 30, crf: 18, size: LAND, out: 'final.part.mp4' };
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

test('a music bed lays each part speech at its start in the joined film over one ducked music track', () => {
  const parts = [10, 5, 8].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const plan = sequencePlan({ ...render, transition: 'fade', parts });
  assert.deepEqual(plan.starts, [0, 9.6, 14.2]);
  // Part 1 has no speech files: its span is music only. Part 2 has a voice-over and footage sound.
  const speech = [{ file: 'p0/voice.wav', start: plan.starts[0] }, { file: 'p2/voice.wav', start: plan.starts[2] }, { file: 'p2/footage.wav', start: plan.starts[2] }];
  const args = musicBedPlan({ video: 'joined.mp4', speech, music: 'bed.wav', duration: plan.duration, gainDb: -16, duck: true, out: 'final.part.mp4' });
  const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
  assert.deepEqual(inputs, ['joined.mp4', 'p0/voice.wav', 'p2/voice.wav', 'p2/footage.wav', 'bed.wav'], 'one music input, after the speech');
  assert.equal(graphOf(args), '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0:all=1,apad,atrim=0:22.200[s1];'
    + '[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=14200:all=1,apad,atrim=0:22.200[s2];'
    + '[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=14200:all=1,apad,atrim=0:22.200[s3];'
    + '[s1][s2][s3]amix=inputs=3:duration=first:normalize=0[v];'
    + '[4:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:22.200,volume=-12.99dB,afade=t=in:st=0:d=0.5,afade=t=out:st=20.200:d=2[m];'
    + '[v]asplit=2[vm][vk];[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[md];'
    + '[vm][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]');
  assert.deepEqual(args.slice(args.indexOf('-map')), ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', '22.200', '-movflags', '+faststart', 'final.part.mp4']);
});

test('a music bed without duck mixes at a constant level; without music it is the placed speech alone', () => {
  const plain = graphOf(musicBedPlan({ video: 'j.mp4', speech: [{ file: 'v.wav', start: 4.5 }], music: 'm.wav', duration: 10, out: 'o.mp4' }));
  assert.ok(plain.includes('adelay=4500:all=1') && plain.includes('volume=-14.99dB') && !plain.includes('sidechaincompress'));
  const voiceOnly = musicBedPlan({ video: 'j.mp4', speech: [{ file: 'v.wav', start: 0 }], duration: 10, out: 'o.mp4' });
  assert.equal(voiceOnly.filter((a) => a === '-i').length, 2);
  assert.equal(graphOf(voiceOnly), '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0:all=1,apad,atrim=0:10.000[s1];[s1]anull[v];[v]loudnorm=I=-14:TP=-1.5:LRA=11[a]');
});

test('a 120 s track under a 200 s film loops once: cut before its fade-out, crossfaded into a copy past its fade-in', () => {
  const speech = [{ file: 'a/voice.wav', start: 0 }, { file: 'b/voice.wav', start: 66.6 }, { file: 'c/voice.wav', start: 133.2 }];
  const args = musicBedPlan({ video: 'j.mp4', speech, music: 'calm-pad.wav', musicSeconds: 120, cycle: 16, duration: 200, duck: true, out: 'o.mp4' });
  const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
  assert.deepEqual(inputs, ['j.mp4', 'a/voice.wav', 'b/voice.wav', 'c/voice.wav', 'calm-pad.wav', 'calm-pad.wav'], 'the track once per copy, after the speech');
  assert.equal(graphOf(args), '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0:all=1,apad,atrim=0:200.000[s1];'
    + '[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=66600:all=1,apad,atrim=0:200.000[s2];'
    + '[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=133200:all=1,apad,atrim=0:200.000[s3];'
    + '[s1][s2][s3]amix=inputs=3:duration=first:normalize=0[v];'
    + '[4:a]aresample=48000,atrim=0:116.000[c0];[5:a]aresample=48000,atrim=start=2.000:end=116.000,asetpts=PTS-STARTPTS[c1];'
    + '[c0][c1]acrossfade=d=2[loop];'
    + '[loop]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:200.000,volume=-14.99dB,afade=t=in:st=0:d=0.5,afade=t=out:st=198.000:d=2[m];'
    + '[v]asplit=2[vm][vk];[m][vk]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[md];'
    + '[vm][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]');
});

test('loopMusic repeats as often as the film needs and jumps back whole chord cycles', () => {
  assert.equal(loopMusic(1, 120, 120), null, 'a track as long as the film is not looped');
  assert.equal(loopMusic(1, 7, 60), null, 'a track too short to crossfade is not looped');
  assert.equal(loopMusic(1, 10, 600), null, 'a jingle under a long film would need hundreds of inputs: not looped');
  assert.equal(loopMusic(1, 10, 60).copies, 28, 'up to MAX_LOOP_COPIES copies still loop');
  // 100 s track: copies end at 96 s; the crossfade starts at 94 s, so a 16 s cycle starts later copies at 94 - 80 = 14 s.
  const cyc = loopMusic(2, 100, 300, 16);
  assert.equal(cyc.copies, 4);
  assert.match(cyc.graph, /^\[2:a\]aresample=48000,atrim=0:96\.000\[c0\];\[3:a\]/);
  assert.match(cyc.graph, /\[5:a\]aresample=48000,atrim=start=14\.000:end=96\.000,asetpts=PTS-STARTPTS\[c3\]/);
  assert.match(cyc.graph, /\[c0\]\[c1\]acrossfade=d=2\[x1\];\[x1\]\[c2\]acrossfade=d=2\[x2\];\[x2\]\[c3\]acrossfade=d=2\[loop\]$/);
  // Without a cycle (an uploaded track) later copies start 2 s in: 96 + 3 × 92 covers 300 s.
  const free = loopMusic(2, 100, 300);
  assert.equal(free.copies, 4);
  assert.match(free.graph, /\[3:a\]aresample=48000,atrim=start=2\.000:end=96\.000/);
});

test('ffmpeg keeps a looped 12 s track sounding through a 30 s bed', { timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-bed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'bed.wav');
  // A track shaped like the built-in ones: 2 s fade-in, 3 s fade-out at its end.
  const track = 'aevalsrc=0.3*sin(2*PI*220*t):d=12:s=48000,afade=t=in:d=2,afade=t=out:st=9:d=3';
  const loop = loopMusic(1, 12, 30);
  await ffmpeg([
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    ...Array.from({ length: loop.copies }, () => ['-f', 'lavfi', '-i', track]).flat(),
    '-filter_complex', mixFilter({ music: true, duration: 30, fadeIn: 0.5, fadeOut: 2, loopGraph: loop.graph }),
    '-map', '[a]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-t', '30', out,
  ], { timeoutMs: 60000 });
  const buf = fs.readFileSync(out);
  const at = buf.indexOf('data') + 8;
  const rms = (s) => { let sum = 0; for (let i = s * 48000; i < (s + 1) * 48000; i++) sum += (buf.readInt16LE(at + i * 2) / 32768) ** 2; return Math.sqrt(sum / 48000); };
  const levels = Array.from({ length: 26 }, (_, i) => rms(i + 1));
  const top = Math.max(...levels);
  levels.forEach((l, i) => assert.ok(l > top * 0.5, `second ${i + 1} sounds (${l.toFixed(3)} of ${top.toFixed(3)})`));
});

test('without musicBed the join arguments are the ones every sequence used before', () => {
  const parts = [{ id: 'a', file: 'a.mp4', duration: 10, hasAudio: true }, { id: 'b', file: 'b.mp4', duration: 5.5, hasAudio: true }];
  const chain = (i, d) => `[${i}:v]fps=30,trim=duration=${d},setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,format=yuv420p,settb=AVTB[v${i}];`
    + `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d},asetpts=PTS-STARTPTS[a${i}]`;
  assert.deepEqual(sequencePlan({ ...render, transition: 'cut', parts }).args, [
    '-y', '-i', 'a.mp4', '-i', 'b.mp4',
    '-filter_complex', `${chain(0, '10.000')};${chain(1, '5.500')};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', 'final.part.mp4',
  ]);
});

/* ---------- real ffmpeg ---------- */
// Two silent 2 s parts, a voice-over on the first only, and an uploaded track as the brand music: with the bed on,
// the preview and the render get a sound track although no part's final.mp4 has one.
test('preview and render lay the music bed under silent parts', { timeout: 300000 }, async (t) => {
  const P = 'zz-test-seqbed-ff';
  clean(t, P);
  createProject({ id: P, name: 'Bed Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), music: { file: 'bed.wav', gainDb: -18, duck: true } });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*220*t)|sin(2*PI*220*t):d=6:s=48000', path.join(DIRS.profiles, P, 'assets', 'bed.wav')], { timeoutMs: 60000 });
  for (const [id, color] of [['one', 'blue'], ['two', 'orange']]) {
    doneJob(P, id);
    await ffmpeg(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', jobFile(P, id, 'final.mp4')], { timeoutMs: 60000 });
    setStatus(P, id, { outputs: { final: 'final.mp4', ...LAND, fps: 30, duration: 2 } }, 'test');
  }
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=24000', '-ac', '1', jobFile(P, 'one', 'voice.wav')], { timeoutMs: 60000 });
  createSequence({ id: 'film', project: P, format: '16:9', transition: 'fade', parts: ['one', 'two'], musicBed: true });

  const pv = (await previewSequence(P, 'film', 'test')).preview;
  assert.equal(pv.error, null);
  const preview = await probeMedia(jobFile(P, 'film', 'preview.mp4'));
  assert.ok(preview.hasAudio, 'the preview has the bed');
  assert.ok(Math.abs(preview.duration - 3.6) < 0.1, `preview lasts ${preview.duration}`);

  const st = await renderSequence(P, 'film', 'test');
  assert.equal(st.status, 'done');
  assert.equal(st.outputs.musicBed, true);
  // Each render is its own version, named after the title or, as here, the id.
  assert.equal(st.outputs.final, 'film v1.mp4');
  assert.equal(st.outputs.version, 1);
  const final = await probeMedia(jobFile(P, 'film', 'film v1.mp4'));
  assert.ok(final.hasAudio && final.hasVideo);
  assert.ok(Math.abs(final.duration - 3.6) < 0.1, `final lasts ${final.duration}`);
  assert.deepEqual(fs.readdirSync(path.dirname(jobFile(P, 'film', 'film v1.mp4'))).filter((f) => f.includes('.part')), [], 'no scratch file is left');
  // An open file is never replaced: the next render is v2 and v1 stays.
  const again = await renderSequence(P, 'film', 'test');
  assert.equal(again.outputs.final, 'film v2.mp4');
  assert.ok(fs.existsSync(jobFile(P, 'film', 'film v1.mp4')) && fs.existsSync(jobFile(P, 'film', 'film v2.mp4')));
  assert.equal(sequenceStatusView(P, 'film').stale, false);
});

test('a render file is named after the sequence title with a version, safe on every file system', () => {
  assert.equal(versionBase({ id: 'award-film', title: 'Digital Commerce_NSC Project Awards 2026' }), 'Digital Commerce_NSC Project Awards 2026');
  assert.equal(versionBase({ id: 'award-film', title: '' }), 'award-film');
  assert.equal(versionBase({ id: 'f', title: '../Q3: "best" / film...' }), 'Q3 best film');
  assert.equal(versionBase({ id: 'f', title: '***' }), 'f');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-ver-'));
  try {
    assert.deepEqual(nextVersionFile(dir, 'Film'), { file: 'Film v1.mp4', version: 1 });
    for (const f of ['Film v1.mp4', 'Film v9.mp4', 'Film v10.mp4', 'Film vx.mp4', 'Other v40.mp4', 'final.mp4']) fs.writeFileSync(path.join(dir, f), '');
    assert.deepEqual(nextVersionFile(dir, 'Film'), { file: 'Film v11.mp4', version: 11 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// NSC award film, 2026-10-26: v8 existed, the folder was emptied, and the next render came out as "v1". The recorded last
// version (`lastVersion` in the sequence status) is the floor, so a number never comes back.
test('the next version never goes below the last recorded one, even when the folder lost its files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-ver2-'));
  try {
    assert.deepEqual(nextVersionFile(dir, 'Film', 9), { file: 'Film v10.mp4', version: 10 });
    fs.writeFileSync(path.join(dir, 'Film v12.mp4'), '');
    assert.deepEqual(nextVersionFile(dir, 'Film', 9), { file: 'Film v13.mp4', version: 13 }, 'a higher file wins over the floor');
    assert.deepEqual(nextVersionFile(dir, 'Film', 0), { file: 'Film v13.mp4', version: 13 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// A pad (2026-11-03): silent black before the first part and after the last, so a player can switch in and out
// cleanly. The parts start later by the head, the picture fades in and out, and the music bed stays silent there.
test('a sequence pad adds black and silence either side, and the music bed keeps off it', () => {
  const parts = [10, 8].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const plan = sequencePlan({ ...render, transition: 'fade', parts, pad: { head: 2, tail: 3 } });
  assert.deepEqual(plan.starts, [2, 11.6]);
  assert.equal(plan.duration, 22.6);
  const steps = graphOf(plan.args).split(';');
  assert.ok(steps.some((s) => s.endsWith('[vj]')) && steps.some((s) => s.endsWith('[aj]')), 'the join ends in [vj]/[aj]');
  assert.equal(steps.at(-2), '[vj]tpad=start_duration=2:stop_duration=3:color=black,fade=t=in:st=2:d=0.8,fade=t=out:st=18.800:d=0.8[v]');
  assert.equal(steps.at(-1), '[aj]adelay=2000:all=1,apad,atrim=0:22.600,afade=t=out:st=18.800:d=0.8[a]');
  const bed = graphOf(musicBedPlan({ video: 'j.mp4', speech: [{ file: 'v.wav', start: 2 }], music: 'm.wav', duration: plan.duration, out: 'o.mp4', gainDb: -16, pad: plan.pad }));
  assert.ok(bed.includes('[2:a]aresample=48000,aformat=channel_layouts=stereo,adelay=2000:all=1,apad,atrim=0:22.600,volume=-12.99dB,afade=t=in:st=2:d=0.5,afade=t=out:st=17.600:d=2[m]'), bed);
  // No pad: the plan reads as before.
  const plain = sequencePlan({ ...render, transition: 'fade', parts });
  assert.deepEqual(plain.starts, [0, 9.6]);
  assert.ok(!graphOf(plain.args).includes('tpad'));
  assert.deepEqual(plan.pad, { head: 2, tail: 3 });
});

test('pad is validated and stored only when set', (t) => {
  const P = 'zz-test-seqpad';
  clean(t, P);
  for (const id of ['intro', 'demo']) { doneJob(P, id); fs.writeFileSync(jobFile(P, id, 'final.mp4'), ''); }
  const seq = (over) => ({ id: 'film', project: P, format: '16:9', transition: 'cut', parts: ['intro', 'demo'], ...over });
  assert.throws(() => createSequence(seq({ pad: { head: 9 } })), /pad.head and pad.tail must be 0-5 seconds/);
  assert.throws(() => createSequence(seq({ pad: 'x' })), /pad.head and pad.tail/);
  assert.deepEqual(createSequence(seq({ pad: { head: 1.5 } })).pad, { head: 1.5, tail: 0 });
  assert.ok(!('pad' in createSequence(seq({ id: 'none', pad: { head: 0, tail: 0 } }))));
  assert.deepEqual(updateSequence(P, 'film', { pad: { head: 1, tail: 2 } }).changed, ['pad']);
  assert.deepEqual(loadSequence(P, 'film').pad, { head: 1, tail: 2 });
});
