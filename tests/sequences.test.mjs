import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { ffmpegReport } from '../engine/media.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, deleteProject } from '../engine/jobs.mjs';
import {
  createSequence, updateSequence, deleteSequence, loadSequence, getSequenceStatus, setSequenceStatus, sequencePlan, joinCaptions, checkParts,
  TRANSITIONS, transitionList,
} from '../engine/sequences.mjs';

/* ---------- fixtures: a project with finished and unfinished jobs ---------- */
const P = 'zz-test-seq';
const LAND = { width: 1920, height: 1080 };
const PORT = { width: 1080, height: 1920 };

function job(project, id, { template = 'explainer', format = '16:9', duration = 30, status = 'done', size = LAND } = {}) {
  saveBrief(validateBrief({ id, project, template, format, duration, director: 'seat', message: 'm' }));
  setStatus(project, id, { status, outputs: status === 'done' ? { final: 'final.mp4', ...size, fps: 30, duration: 10 } : null }, 'test');
  if (status === 'done') fs.writeFileSync(jobFile(project, id, 'final.mp4'), '');
}

function fixture(t, project = P) {
  t.after(() => ['briefs', 'out', 'sequences'].forEach((k) => fs.rmSync(path.join(DIRS[k], project), { recursive: true, force: true })));
  job(project, 'intro');
  job(project, 'demo');
  job(project, 'draft-16x9', { status: 'awaiting_review' });
  job(project, 'promo-9x16', { template: 'promo', format: '9:16', duration: 15, size: PORT });
}

const seq = (over = {}) => ({ id: 'launch', project: P, title: 'Launch', format: '16:9', transition: 'cut', parts: ['intro', 'demo'], ...over });

/* ---------- validation ---------- */
test('a sequence takes 2-12 finished parts and a known transition', (t) => {
  fixture(t);
  assert.throws(() => createSequence(seq({ parts: ['intro'] })), /needs 2-12 parts/);
  assert.throws(() => createSequence(seq({ parts: Array(13).fill('intro') })), /needs 2-12 parts/);
  assert.throws(() => createSequence(seq({ transition: 'wipe' })), /transition must be one of: cut, fade, dip-black/);
  assert.throws(() => createSequence(seq({ parts: ['intro', '../x'] })), /Part 2: Invalid part/);
  assert.throws(() => createSequence(seq({ id: '../x' })), /Invalid sequence/);
  const made = createSequence(seq({ parts: Array(12).fill('intro') }), 'anna');
  assert.equal(made.createdBy, 'anna');
  assert.equal(loadSequence(P, 'launch').parts.length, 12);
});

test('the same part may appear twice', (t) => {
  fixture(t);
  assert.deepEqual(createSequence(seq({ parts: ['intro', 'demo', 'intro'] })).parts, ['intro', 'demo', 'intro']);
});

test('missing and wrong-format parts are refused; unfinished parts only at render', (t) => {
  fixture(t);
  assert.throws(() => createSequence(seq({ parts: ['intro', 'nope'] })), (e) => e.code === 409 && /nope: no such job/.test(e.message));
  assert.throws(() => createSequence(seq({ parts: ['intro', 'promo-9x16'] })), /promo-9x16 is 1080x1920, this sequence is 16:9 \(1920x1080\)/);
  assert.ok(!fs.existsSync(path.join(DIRS.sequences, P, 'launch.json')), 'a refused sequence writes no file');
  // A draft sequence: created with unfinished parts, refused at render (checkParts) with the parts named.
  assert.throws(() => checkParts(P, '16:9', ['intro', 'draft-16x9']), /draft-16x9: not rendered \(awaiting_review\)/);
  fs.unlinkSync(jobFile(P, 'demo', 'final.mp4'));
  assert.throws(() => checkParts(P, '16:9', ['intro', 'demo']), /demo: not rendered \(done\)/);
  assert.deepEqual(createSequence(seq({ parts: ['intro', 'draft-16x9', 'demo'] })).parts, ['intro', 'draft-16x9', 'demo']);
});

test('sequence ids and job ids never collide, both ways', (t) => {
  fixture(t);
  assert.throws(() => createSequence(seq({ id: 'intro' })), (e) => e.code === 409 && /intro is already a job id/.test(e.message));
  createSequence(seq());
  assert.throws(() => createSequence(seq()), /already exists/);
  assert.throws(() => saveBrief(validateBrief({ id: 'launch', project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' })),
    (e) => e.code === 409 && /launch is already a sequence id/.test(e.message));
});

/* ---------- editing and deleting ---------- */
test('a title edit keeps the render; a parts edit makes it stale', (t) => {
  fixture(t);
  createSequence(seq());
  setSequenceStatus(P, 'launch', { status: 'done', outputs: { final: 'final.mp4' } }, 'test');
  fs.writeFileSync(jobFile(P, 'launch', 'final.mp4'), '');

  assert.deepEqual(updateSequence(P, 'launch', { title: 'Launch v2' }).changed, ['title']);
  assert.equal(getSequenceStatus(P, 'launch').status, 'done');

  const res = updateSequence(P, 'launch', { parts: ['demo', 'intro'], transition: 'fade' }, 'bob');
  assert.deepEqual(res.changed, ['parts', 'transition']);
  const st = getSequenceStatus(P, 'launch');
  assert.equal(st.status, 'draft');
  assert.equal(st.history.at(-1).by, 'bob');
  assert.ok(!fs.existsSync(jobFile(P, 'launch', 'final.mp4')), 'the stale video is removed');
  assert.equal(loadSequence(P, 'launch').title, 'Launch v2');

  assert.throws(() => updateSequence(P, 'launch', { id: 'other' }), /id of a sequence cannot change/);
  setSequenceStatus(P, 'launch', { status: 'rendering' }, 'test');
  assert.throws(() => updateSequence(P, 'launch', { title: 'x' }), (e) => e.code === 409);
  assert.throws(() => deleteSequence(P, 'launch'), (e) => e.code === 409);
});

test('deleting a sequence moves its file and output to trash', (t) => {
  fixture(t);
  let trashed = null;
  t.after(() => trashed && fs.rmSync(path.join(DIRS.trash, trashed), { recursive: true, force: true }));
  createSequence(seq());
  setSequenceStatus(P, 'launch', { status: 'done' }, 'test');
  const res = deleteSequence(P, 'launch');
  trashed = res.trash;
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'sequence.json')));
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'out', 'status.json')));
  assert.ok(!fs.existsSync(path.join(DIRS.sequences, P, 'launch.json')));
  assert.ok(!fs.existsSync(path.join(DIRS.out, P, 'launch')));
  assert.throws(() => deleteSequence(P, 'launch'), /Unknown sequence/);
});

test('deleting a project moves its sequences to trash too', (t) => {
  const id = 'zz-test-seqdel';
  let trashed = null;
  t.after(() => {
    fs.rmSync(path.join(DIRS.profiles, id), { recursive: true, force: true });
    if (trashed) fs.rmSync(path.join(DIRS.trash, trashed), { recursive: true, force: true });
  });
  createProject({ id, name: 'Delete me' });
  fixture(t, id);
  createSequence({ ...seq(), project: id });
  setSequenceStatus(id, 'launch', { status: 'rendering' }, 'test');
  assert.throws(() => deleteProject(id, id), /Wait until these jobs finish: launch/);

  setSequenceStatus(id, 'launch', { status: 'done' }, 'test');
  const res = deleteProject(id, id);
  trashed = res.trash;
  assert.deepEqual(res.moved, ['out', 'briefs', 'sequences', 'profiles']);
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'sequences', 'launch.json')));
  assert.ok(!fs.existsSync(path.join(DIRS.sequences, id)));
});

/* ---------- ffmpeg arguments (pure, no ffmpeg run) ---------- */
const render = { fps: 30, crf: 18, size: LAND, out: 'final.part.mp4' };
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

test('a cut concatenates parts and gives a silent part its own silence', () => {
  const { args, starts, duration } = sequencePlan({
    ...render, transition: 'cut',
    parts: [{ id: 'a', file: 'a.mp4', duration: 10, hasAudio: true }, { id: 'b', file: 'b.mp4', duration: 5.5, hasAudio: false }],
  });
  assert.deepEqual(args.slice(0, 11), ['-y', '-i', 'a.mp4', '-i', 'b.mp4', '-f', 'lavfi', '-t', '5.500', '-i', 'anullsrc=r=48000:cl=stereo']);
  const g = graphOf(args);
  assert.match(g, /\[0:a\]aresample=48000/);
  assert.match(g, /\[2:a\]aresample=48000[^;]*atrim=0:5\.500[^;]*\[a1\]/, 'part b takes its sound from the silent input');
  assert.ok(!g.includes('[1:a]'));
  assert.match(g, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[v\]\[a\]$/);
  assert.deepEqual(starts, [0, 10]);
  assert.equal(duration, 15.5);
  for (const pair of [['-crf', '18'], ['-r', '30'], ['-pix_fmt', 'yuv420p'], ['-c:a', 'aac'], ['-ar', '48000']]) {
    assert.equal(args[args.indexOf(pair[0]) + 1], pair[1], pair[0]);
  }
  assert.equal(args.at(-1), 'final.part.mp4');
});

test('a fade overlaps neighbours at offsets from the probed durations', () => {
  const parts = [10, 5, 8].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const { args, starts, duration } = sequencePlan({ ...render, transition: 'fade', parts });
  const g = graphOf(args);
  assert.ok(g.includes('[v0][v1]xfade=transition=fade:duration=0.4:offset=9.6[vx1]'));
  assert.ok(g.includes('[vx1][v2]xfade=transition=fade:duration=0.4:offset=14.2[v]'));
  assert.ok(g.includes('[a0][a1]acrossfade=d=0.4[ax1]'));
  assert.ok(g.includes('[ax1][a2]acrossfade=d=0.4[a]'));
  assert.ok(!g.includes('concat='));
  assert.ok(!args.includes('lavfi'), 'no silence needed when every part has sound');
  assert.deepEqual(starts, [0, 9.6, 14.2]);
  assert.equal(duration, 22.2);
  assert.throws(() => sequencePlan({ ...render, transition: 'fade', parts: [parts[0], { ...parts[1], duration: 0.3 }] }), /p1 is 0\.3 s, too short for a crossfade transition/);
  // A last part needs room for one fade only, a middle part for both of its joins.
  assert.ok(sequencePlan({ ...render, transition: 'fade', parts: [parts[0], { ...parts[1], duration: 0.8 }] }).duration);
  assert.throws(() => sequencePlan({ ...render, transition: 'fade', parts: [parts[0], { ...parts[1], duration: 0.8 }, parts[2]] }), /p1 is 0\.8 s, too short for a crossfade and a crossfade transition/);
  assert.throws(() => sequencePlan({ ...render, transition: 'wipe', parts }), /Unknown transition: wipe/);
});

test('each join takes its own transition: xfade where it has one, a plain concat where it is a cut', () => {
  const parts = [10, 5, 8, 6].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const { args, starts, duration, transitions } = sequencePlan({ ...render, transition: 'cut', transitions: ['fade', 'cut', 'dip-black'], parts });
  const g = args[args.indexOf('-filter_complex') + 1];
  assert.deepEqual(transitions, ['fade', 'cut', 'dip-black']);
  assert.ok(g.includes('[v0][v1]xfade=transition=fade:duration=0.4:offset=9.6[vx1]'));
  assert.ok(g.includes('[vx1][v2]concat=n=2:v=1:a=0,settb=AVTB[vx2]') && g.includes('[ax1][a2]concat=n=2:v=0:a=1[ax2]'));
  assert.ok(g.includes('[vx2][v3]xfade=transition=custom:expr=') && g.includes(':duration=0.6:offset=22[v]'));
  assert.deepEqual(starts, [0, 9.6, 14.6, 22]);
  assert.equal(duration, 28);
  // A short list falls back to the default for the joins it does not name; a part between two fades needs room for both.
  assert.deepEqual(sequencePlan({ ...render, transition: 'fade', transitions: ['cut'], parts }).transitions, ['cut', 'fade', 'fade']);
  assert.throws(() => sequencePlan({ ...render, transition: 'cut', transitions: ['dip-black', 'dip-black'], parts: [parts[0], { ...parts[1], duration: 1.2 }, parts[2]] }), /p1 is 1\.2 s, too short for a dip to black and a dip to black transition/);
});

test('a sequence keeps one transition per join; a bad one is named', (t) => {
  fixture(t);
  assert.throws(() => createSequence(seq({ parts: ['intro', 'demo', 'intro'], transitions: ['fade', 'wobble'] })), /transitions\[1\] must be one of/);
  assert.throws(() => createSequence(seq({ transitions: 'fade' })), /transitions must be a list/);
  const made = createSequence(seq({ parts: ['intro', 'demo', 'intro'], transition: 'cut', transitions: ['spin'] }));
  assert.deepEqual(made.transitions, ['spin', 'cut'], 'a short list is filled from the default');
  assert.deepEqual(createSequence(seq({ id: 'plain' })).transitions, ['cut', 'cut'].slice(0, 1));
  const res = updateSequence(P, 'launch', { transitions: ['spin', 'flash'] });
  assert.deepEqual(res.changed, ['transitions']);
  assert.deepEqual(loadSequence(P, 'launch').transitions, ['spin', 'flash']);
});

test('every preset but cut is an xfade of its own length, with a matching acrossfade', () => {
  const two = [10, 5].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  for (const [id, t] of Object.entries(TRANSITIONS)) {
    const { args, starts, duration } = sequencePlan({ ...render, transition: id, parts: two });
    const g = args[args.indexOf('-filter_complex') + 1];
    if (!t.xfade) { assert.ok(g.includes('concat=n=2'), id); assert.deepEqual(starts, [0, 10]); continue; }
    const x = t.custom ? `custom:expr='` : `${t.xfade}:duration=${t.seconds}:offset=${10 - t.seconds}[v]`;
    assert.ok(g.includes(`[v0][v1]xfade=transition=${x}`), id);
    if (t.custom) {
      const expr = /expr='([^']*)'/.exec(g)[1];
      assert.ok(expr.length && !expr.includes('ld(') && !expr.includes('st('), `${id}: no shared registers in a custom expression`);
      assert.ok(g.includes(`':duration=${t.seconds}:offset=${10 - t.seconds}[v]`), id);
    }
    assert.ok(g.includes(`[a0][a1]acrossfade=d=${t.seconds}[a]`), id);
    assert.deepEqual(starts, [0, 10 - t.seconds]);
    assert.equal(duration, Math.round((15 - t.seconds) * 1000) / 1000);
  }
  assert.deepEqual(transitionList().map((t) => t.id), Object.keys(TRANSITIONS));
});

test('a dip to black goes down over the first half and up over the second, black only in the middle', async () => {
  const two = [1, 1].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const { args } = sequencePlan({ ...render, transition: 'dip-black', parts: two });
  const expr = /expr='([^']*)'/.exec(args[args.indexOf('-filter_complex') + 1])[1];
  const white = 'color=c=white:s=64x36:r=30:d=1';
  const log = await ffmpegReport(['-f', 'lavfi', '-i', white, '-f', 'lavfi', '-i', white, '-filter_complex',
    `[0]format=yuv420p[a];[1]format=yuv420p[b];[a][b]xfade=transition=custom:expr='${expr}':duration=0.6:offset=0.4,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    '-f', 'null', '-'], { timeoutMs: 60000 });
  const y = [...log.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  assert.equal(y.length, 42);
  // 0.4 s of white, the 0.6 s dip (frames 12-29), then white again.
  assert.ok(y[0] > 230 && y.at(-1) > 230, 'white on both sides');
  assert.ok(Math.min(...y) < 20, 'black in the middle');
  assert.ok(y.filter((v) => v < 20).length <= 3, `black for at most 3 frames, not held: ${y.join(' ')}`);
  assert.ok(y[16] > 60 && y[16] < 200, `a quarter of the way in, half way down: ${y[16]}`);
});

test('a film dissolve out of an evenly dark part turns over several frames, not in one jump', async () => {
  const two = [1, 1].map((d, i) => ({ id: `p${i}`, file: `p${i}.mp4`, duration: d, hasAudio: true }));
  const { args } = sequencePlan({ ...render, transition: 'luma-fade', parts: two });
  const expr = /expr='([^']*)'/.exec(args[args.indexOf('-filter_complex') + 1])[1];
  const log = await ffmpegReport(['-f', 'lavfi', '-i', 'color=c=0x262524:s=64x36:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=white:s=64x36:r=30:d=1', '-filter_complex',
    `[0]format=yuv420p[a];[1]format=yuv420p[b];[a][b]xfade=transition=custom:expr='${expr}':duration=0.6:offset=0.4,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
    '-f', 'null', '-'], { timeoutMs: 60000 });
  const y = [...log.matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
  const total = y.at(-1) - y[0], steps = y.slice(1).map((v, i) => v - y[i]);
  assert.ok(total > 150, `dark to white: ${y[0]} to ${y.at(-1)}`);
  // The old 0.15 edge turned an even dark frame over in two frames, about half the change in each.
  assert.ok(Math.max(...steps) < total / 4, `largest step ${Math.max(...steps).toFixed(1)} of ${total.toFixed(1)}: ${y.map((v) => v.toFixed(0)).join(' ')}`);
});

test('captions are shifted to where each part plays and clipped to its length', () => {
  const a = '1\n00:00:00,500 --> 00:00:02,000\nHello\n\n2\n00:00:09,000 --> 00:00:12,000\nLate cue\n\n3\n00:00:11,000 --> 00:00:12,000\nGone\n';
  const b = '1\r\n00:00:01,000 --> 00:00:03,250\r\nWorld\r\n';
  const srt = joinCaptions([{ srt: a, start: 0, duration: 10 }, { srt: '', start: 10, duration: 4 }, { srt: b, start: 13.6, duration: 5 }]);
  assert.equal(srt, '1\n00:00:00,500 --> 00:00:02,000\nHello\n\n2\n00:00:09,000 --> 00:00:10,000\nLate cue\n\n3\n00:00:14,600 --> 00:00:16,850\nWorld\n');
  assert.equal(joinCaptions([{ srt: '', start: 0, duration: 3 }]), '');
  // A crossfade overlaps two parts (the next starts 0.5 s before this one ends): the last caption stops where the next
  // part starts, so two captions never show at once.
  const end = '1\n00:00:08,000 --> 00:00:10,000\nLast words\n';
  const first = '1\n00:00:00,000 --> 00:00:01,000\nNext part\n';
  assert.equal(joinCaptions([{ srt: end, start: 0, duration: 10 }, { srt: first, start: 9.5, duration: 5 }]),
    '1\n00:00:08,000 --> 00:00:09,500\nLast words\n\n2\n00:00:09,500 --> 00:00:10,500\nNext part\n');
});
