// Scene import (plan scene-script, part A): the HUY example script with CLIP lines added (tests/fixtures), parsed,
// mapped onto explainer video scenes, written as a scripted job with every field locked, kept through a Director
// commit; the CLI on real clips; a two-scene import built into a storyboard with Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIRS, ROOT, within, readJson, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, getStatus, loadBrief, jobFile, mergeRespectingLocks, loadTemplate } from '../engine/jobs.mjs';
import { commit, prepare } from '../engine/pipeline.mjs';
import { ffmpeg } from '../engine/media.mjs';
import {
  parseSceneScript, mapSceneScript, sceneScriptToJob, importSceneScript, sceneBeats, lockAll, parseSeconds, parseFormat, scriptJobId,
  SCENE_SCRIPT_RECORD,
} from '../engine/scenescript.mjs';
import { hasChrome } from './helpers/chrome-folder.mjs';

const HUY = fs.readFileSync(fileURLToPath(new URL('./fixtures/scene-script-huy.txt', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
// What the explainer contract asks on top of the script as written: a shorter title with a voice line for the
// opening card, and a voice line and a button for the end card. Every other word is the person's own.
const HUY_FIXED = HUY
  .replace('The Drill Works Perfectly Until It Touches Wood\n', 'The Drill Stops When It Touches Wood\nVOICE: Why does a good drill stop on wood?\n')
  .replace('ONE SYMPTOM. MULTIPLE POSSIBLE CAUSES.\n', 'ONE SYMPTOM. MULTIPLE POSSIBLE CAUSES.\nVOICE: Một triệu chứng, nhiều nguyên nhân.\nBUTTON: Watch episode 2\n');
// The clips' probed lengths and sound (c4 has none).
const MEDIA = {
  'c1.mp4': { duration: 5, hasAudio: true }, 'c2.mp4': { duration: 8, hasAudio: true }, 'c3a.mp4': { duration: 4, hasAudio: true },
  'c3b.mp4': { duration: 6, hasAudio: true }, 'c4.mp4': { duration: 10, hasAudio: false }, 'c5a.mp4': { duration: 6, hasAudio: true },
  'c5b.mp4': { duration: 6, hasAudio: true }, 'c6.mp4': { duration: 3.5, hasAudio: true },
};
const ASSETS = [...Object.keys(MEDIA), 'p1.jpg', 'p2.jpg'];
const P = 'zz-test-scene-script';
const map = (text, opts = {}) => mapSceneScript(parseSceneScript(text), {
  beats: sceneBeats(), assets: ASSETS, media: MEDIA, timing: loadStudioConfig().timing, lang: 'en', file: 'script.txt', project: P, ...opts,
});
const clean = (p = P) => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(within(DIRS[k], p), { recursive: true, force: true }));
const cli = (args, timeout = 120000) => spawnSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT, shell: false, windowsHide: true, timeout, encoding: 'utf8' });

test('the HUY script parses: header, six scenes with spans, clips, voice, on-screen text, notes, end card and the closing section', () => {
  const doc = parseSceneScript(HUY);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(doc.header, {
    videoId: 'HUY-DRILL-001', title: 'The Drill Works Perfectly Until It Touches Wood', duration: 45, format: '9:16',
    other: { 'MAIN CHARACTER': 'CHAR-01 — HUY', STYLE: 'Photorealistic technical repair short film.' }, notes: [],
  });
  assert.deepEqual(doc.scenes.map((s) => [s.n, s.title, s.from, s.to]), [
    [1, 'THE MYSTERY', 0, 4], [2, 'INITIAL INVESTIGATION', 4, 10], [3, 'DIAGNOSTIC TEST', 10, 19],
    [4, 'VERIFIED REPAIR', 19, 31], [5, 'FINAL TEST', 31, 41], [6, 'ENDING', 41, 45],
  ]);
  assert.ok(doc.scenes.every((s) => !s.errors.length), JSON.stringify(doc.scenes.map((s) => s.errors)));
  assert.deepEqual(doc.scenes[2].clips, [{ name: 'c3a.mp4', in: 0, out: 4 }, { name: 'c3b.mp4', in: 0, out: 5 }]);
  assert.deepEqual(doc.scenes[1].clips, [{ name: 'c2.mp4', in: 1, out: 7 }]);
  assert.deepEqual(doc.scenes[4].clips, [{ name: 'c5a.mp4' }, { name: 'c5b.mp4' }]);
  assert.deepEqual([doc.scenes[2].voice, doc.scenes[2].onScreen], ['Huy đo điện áp pin khi có tải.', 'Voltage drops under load']);
  assert.equal(doc.scenes[5].voice, 'Máy không yếu. Nguồn điện mới là vấn đề.', 'Optional Vietnamese dialogue + a quoted line is the voice, quotes off');
  assert.deepEqual(doc.scenes[0].notes, [
    'Huy holds a cordless drill in a realistic Vietnamese workshop. He activates the drill without a load. The motor spins normally.',
    "Camera: Close-up of the rotating chuck, followed by a close-up of Huy's face.",
  ]);
  assert.deepEqual(doc.endCard, { text: 'ONE SYMPTOM. MULTIPLE POSSIBLE CAUSES.', voice: '', button: '', notes: [], errors: [], scene: 6 });
  assert.deepEqual(doc.sections.map((s) => [s.title, s.lines.length]), [['IMPORTANT TECHNICAL RULE', 1]]);
  assert.equal(scriptJobId(doc.header), 'huy-drill-001');
});

test('times, formats and ids', () => {
  assert.deepEqual(['4', '4.5', '4s', '0:04', '1:02.5', '0:60', 'x', ''].map(parseSeconds), [4, 4.5, 4, 4, 62.5, null, null, null]);
  assert.deepEqual(['Vertical 9:16', '16x9', 'Square', 'landscape', 'tall'].map(parseFormat), ['9:16', '16:9', '1:1', '16:9', null]);
  assert.equal(scriptJobId({ title: 'Máy khoan đứng!' }), 'may-khoan-dung');
  assert.equal(scriptJobId({}), 'scene-script');
});

test('the HUY script as written: the title card and the end card say what explainer needs, the scenes map clean', () => {
  const m = map(HUY);
  const rows = Object.fromEntries(m.rows.map((r) => [r.at, r]));
  assert.deepEqual(rows['Title card'].errors, [
    'Title card: explainer opens on a title card with a voice line: add a VOICE: line under TITLE, before SCENE 1',
    'Title card: TITLE is 47 characters, limit 44 (title card title): cut 3',
  ]);
  assert.deepEqual(rows['End card'].errors, [
    'End card: the closing card (explainer cta) needs a voice line: add a VOICE: line under End card',
    'End card: the closing card (explainer cta) needs a button: add a BUTTON: line under End card, e.g. BUTTON: Watch episode 2',
  ]);
  for (let n = 1; n <= 6; n++) assert.deepEqual(rows[`Scene ${n}`].errors, [], `Scene ${n}`);
  assert.equal(m.errors.length, 4);
  assert.throws(() => sceneScriptToJob(parseSceneScript(HUY), { project: 'zz-test-scene-script-none' }), (e) => e.code === 404 && /Unknown project/.test(e.message));
});

test('the HUY script with its voice lines and button: explainer video scenes that hold each span', () => {
  const m = map(HUY_FIXED);
  assert.deepEqual(m.errors, []);
  const s = m.script.scenes;
  assert.deepEqual(s.map((x) => [x.id, x.kind]), [
    ['title', 'title'], ['scene-1', 'video'], ['scene-2', 'video'], ['scene-3a', 'video'], ['scene-3b', 'video'], ['scene-4', 'video'],
    ['scene-5a', 'video'], ['scene-5b', 'video'], ['scene-6', 'video'], ['end', 'cta'],
  ]);
  assert.deepEqual(s[0], { id: 'title', kind: 'title', title: 'The Drill Stops When It Touches Wood', vo: 'Why does a good drill stop on wood?', source: 'bullets[0]' });
  // Longer than the span: cut at out. Shorter: the last clip holds its last frame. Several clips share the span.
  assert.deepEqual(s[1], { id: 'scene-1', kind: 'video', title: 'THE MYSTERY', video: 'c1.mp4', in: 0, out: 4, sound: true, source: 'facts[0]' });
  assert.deepEqual([s[2].in, s[2].out, s[2].hold], [1, 7, undefined]);
  assert.deepEqual(s[3], { id: 'scene-3a', kind: 'video', title: 'Voltage drops under load', vo: 'Huy đo điện áp pin khi có tải.', video: 'c3a.mp4', in: 0, out: 4, sound: true, source: 'facts[2]' });
  assert.deepEqual([s[4].title, s[4].vo, s[4].out, s[4].source], ['Voltage drops under load', undefined, 5, 'facts[2]']);
  assert.deepEqual([s[5].sound, s[5].hold, s[5].out], [undefined, undefined, 10], 'a silent clip sets no length, so it keeps no hold');
  assert.deepEqual([s[6].out, s[7].out], [6, 4]);
  assert.deepEqual([s[8].in, s[8].out, s[8].hold, s[8].vo], [0, 3, 1, 'Máy không yếu. Nguồn điện mới là vấn đề.']);
  assert.deepEqual(s[9], { id: 'end', kind: 'cta', title: 'ONE SYMPTOM. MULTIPLE POSSIBLE CAUSES.', vo: 'Một triệu chứng, nhiều nguyên nhân.', button: 'Watch episode 2', source: 'facts[6]' });
  assert.equal(m.script.generated, 'scene-script');
  assert.equal(m.source.facts.length, 7);
  assert.deepEqual(m.source.facts[2], { text: 'Scene 3 — DIAGNOSTIC TEST. On screen: Voltage drops under load. Voice: "Huy đo điện áp pin khi có tải."', ref: 'script.txt, scene 3' });
  assert.deepEqual(m.source.bullets, [{ text: 'The Drill Stops When It Touches Wood', ref: 'script.txt, TITLE' }]);
  assert.deepEqual([m.brief.id, m.brief.template, m.brief.mix, m.brief.format, m.brief.duration, m.brief.subject], ['huy-drill-001', 'explainer', [], '9:16', 45, 'HUY-DRILL-001']);
  assert.deepEqual(m.notes, ['Scene 1: c1.mp4 ends at 4 s to fit the 4 s span', 'Scene 5: c5b.mp4 ends at 4 s to fit the 10 s span']);
  assert.deepEqual(m.warnings, [
    "Scene 4: c4.mp4 has no sound, so its scene follows the voice line, not the 12 s span (a clip sets its scene's length only through its own sound)",
    'Scene 6: the voice line takes about 4.2 s, its clip 3 s: the scene runs on until the voice ends, past its span',
  ]);
  assert.deepEqual(m.record.scenes[2].ids, ['scene-3a', 'scene-3b']);
});

test('each error names its scene', () => {
  const head = 'TITLE: Test film\nVOICE: A short opening line.\nFORMAT: 16:9\n';
  const cases = [
    ['SCENE 1 — NOTHING (0–4 seconds)\nVOICE: no picture here.', 'Scene 1 has no CLIP or IMAGE: add the clip or picture it shows'],
    ['SCENE 1 — MISSING (0–4 seconds)\nCLIP: nope.mp4', 'Scene 1: nope.mp4 is not in the project assets: upload it, then check again'],
    ['SCENE 1 — A (0–4 seconds)\nCLIP: c1.mp4\nSCENE 2 — NO SPAN\nCLIP: c2.mp4', 'Scene 2: add its seconds to the SCENE line, e.g. (0–4 seconds)'],
    ['SCENE 1 — PAST (0–4 seconds)\nCLIP: c1.mp4 0:00-0:09', 'Scene 1: c1.mp4 is 5 s long, its range ends at 9 s'],
    ['SCENE 1 — SHORT (0–12 seconds)\nCLIP: c1.mp4', 'Scene 1: the clips run 5 s of a 12 s span, and a clip holds its last frame at most 4 s: add 3 s of clip'],
    ['SCENE 1 — LONG (0–4 seconds)\nCLIP: c1.mp4\nON SCREEN: This line on screen is far too long for the title', 'Scene 1: ON SCREEN is 49 characters, limit 44 (video scene title): cut 5'],
    ['SCENE 1 — ONE (0–4 seconds)\nIMAGE: p1.jpg\nVOICE: One picture.', 'Scene 1: IMAGE shows one picture, and no scene kind that mixes into explainer shows one picture (lifestyle photo does not mix): use IMAGES: with 2-4 pictures, or a CLIP'],
    ['SCENE 1 — QUIET (0–4 seconds)\nIMAGES: p1.jpg, p2.jpg', 'Scene 1: a picture scene (lifestyle gallery) needs a voice line: add a VOICE: line'],
    ['SCENE 1 — BTN (0–4 seconds)\nCLIP: c1.mp4\nBUTTON: Buy', 'Scene 1: BUTTON: belongs under End card'],
    ['SCENE 1 — BACK (0–4 seconds)\nCLIP: c1.mp4 0:05-0:02', 'Scene 1: c1.mp4 0:05-0:02 is not a range: write start-end in seconds or m:ss, e.g. 0:00-0:04'],
    ['SCENE 1 — TWICE (0–4 seconds)\nCLIP: c1.mp4\nVOICE: one.\nVOICE: two.', 'Scene 1 has two VOICE lines: keep one'],
  ];
  for (const [body, want] of cases) {
    const m = map(head + body);
    assert.ok(m.errors.includes(want), `${want}\n got: ${m.errors.join(' | ')}`);
    assert.ok(m.errors.every((e) => /^Scene \d/.test(e)), m.errors.join(' | '));
  }
  assert.throws(() => parseSceneScript(''), (e) => e.code === 400 && /Paste the scene script/.test(e.message));
  assert.throws(() => parseSceneScript('x'.repeat(64 * 1024 + 1)), (e) => e.code === 413);
  assert.deepEqual(parseSceneScript('TITLE: no scenes').errors, ['No SCENE lines found: start each scene with SCENE 1 — TITLE (0–4 seconds)']);
});

test('IMAGES make a lifestyle gallery scene through the mix', () => {
  const m = map('TITLE: Pictures\nVOICE: Two prints.\nFORMAT: 9:16\nSCENE 1 — PRINTS (0–4 seconds)\nIMAGES: p1.jpg, p2.jpg\nVOICE: Here they are.\nSCENE 2 — CLIP (4–8 seconds)\nCLIP: c1.mp4 0:01-0:05');
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.brief.mix, ['lifestyle']);
  assert.deepEqual(m.script.scenes[1], { id: 'scene-1', kind: 'lifestyle.gallery', title: 'PRINTS', vo: 'Here they are.', photos: [{ asset: 'p1.jpg' }, { asset: 'p2.jpg' }], source: 'facts[0]' });
});

test('every imported field is locked: a Director draft that rewrites, reorders, drops, adds and restyles changes nothing', () => {
  const m = map(HUY_FIXED);
  const { beats } = loadTemplate('explainer');
  const locked = lockAll(m.script, beats, 'tester');
  for (const k of ['scenes', 'look', 'scene:scene-1.title', 'scene:scene-1.kind', 'scene:scene-1.vo', 'scene:scene-4.hold', 'scene:end.button', 'scene:title.theme']) assert.ok(locked.locks[k], k);
  const draft = {
    template: 'explainer', look: 'bold',
    scenes: [
      { id: 'scene-1', kind: 'video', title: 'Rewritten', vo: 'New words.', video: 'c1.mp4', in: 1, out: 2, text: 'Added text', hold: 3, source: 'facts[0]' },
      { id: 'title', kind: 'title', title: 'Another title', vo: 'Other words.', theme: 'dark', source: 'bullets[0]' },
      { id: 'extra', kind: 'step', title: 'Added', vo: 'Added.', icon: 'bolt', source: 'facts[1]' },
    ],
  };
  const { doc } = mergeRespectingLocks('script', locked, draft);
  assert.deepEqual(doc.scenes, locked.scenes);
  assert.equal(doc.look, undefined);
});

test('the job is written scripted with every field locked, kept through a Director commit, and not written twice', (t) => {
  clean();
  t.after(() => clean());
  createProject({ id: P, name: 'Scene Script Test' });
  for (const a of ASSETS) fs.writeFileSync(within(DIRS.profiles, P, 'assets', a), '');
  const r = sceneScriptToJob(parseSceneScript(HUY_FIXED), { project: P, by: 'tester', media: MEDIA, file: 'script.txt' });
  const ID = 'huy-drill-001';
  assert.deepEqual(loadBrief(P, ID), r.brief);
  const st = getStatus(P, ID);
  assert.deepEqual([st.status, st.step, st.dirty_from], ['scripted', 5, null]);
  assert.match(st.history.at(-1).event, /^script\.json imported from the scene script script\.txt: 10 scenes, every field locked, \d+ warning\(s\)$/);
  assert.equal(st.history.at(-1).by, 'tester');
  const script = readJson(jobFile(P, ID, 'script.json'));
  assert.equal(script.generated, 'scene-script');
  assert.equal(script.locks['scene:scene-6.hold'].by, 'tester');
  const source = readJson(jobFile(P, ID, 'source.json'));
  assert.deepEqual(Object.keys(source.locks).sort(), ['bullets', 'facts', 'name']);
  const record = readJson(jobFile(P, ID, SCENE_SCRIPT_RECORD));
  assert.equal(record.file, 'script.txt');
  assert.equal(record.scenes[0].notes.length, 2);
  assert.deepEqual(record.sections.map((s) => s.title), ['IMPORTANT TECHNICAL RULE']);
  assert.ok(r.warnings.some((w) => /scene-3a: the clip plays its own sound under the voice line/.test(w)), r.warnings.join(' | '));

  // A Director run on this job commits a draft of its own: the merge keeps the person's script as imported.
  writeJson(jobFile(P, ID, 'script.draft.json'), { template: 'explainer', look: 'energetic', scenes: [{ id: 'title', kind: 'title', title: 'Director title', vo: 'Director words.', source: 'bullets[0]' }] });
  const c = commit(P, ID, 'script', 'director');
  assert.ok(c.kept.includes('scenes') && c.kept.includes('look') && c.kept.includes('scene:title.title'), c.kept.join(', '));
  const after = readJson(jobFile(P, ID, 'script.json'));
  assert.deepEqual(after.scenes, script.scenes);
  assert.equal(after.look, undefined);

  assert.throws(() => sceneScriptToJob(parseSceneScript(HUY_FIXED), { project: P, media: MEDIA }), (e) => e.code === 409 && /already exists\. Pick another job id/.test(e.message));
  assert.throws(() => sceneScriptToJob(parseSceneScript(HUY), { project: P, job: 'other', media: MEDIA }), (e) => e.code === 400 && /^The scene script has 4 problem\(s\):\n- Title card:/.test(e.message));
  assert.ok(!fs.existsSync(within(DIRS.briefs, P, 'other.json')), 'a refused import writes nothing');
});

/** Two clips with sound made by ffmpeg: a.mp4 3 s, b.mp4 5 s. */
async function makeClips(project) {
  for (const [name, d] of [['a.mp4', 3], ['b.mp4', 5]]) {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${d}`, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${d}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', within(DIRS.profiles, project, 'assets', name)], { timeoutMs: 60000 });
  }
}
const TWO = 'TITLE: Two clip test\nVOICE: Two short clips.\nFORMAT: 16:9\n\nSCENE 1 — FIRST (0–4 seconds)\nCLIP: a.mp4 0:00-0:03\nVOICE: The first clip.\n\nSCENE 2 — SECOND (4–7 seconds)\nCLIP: b.mp4 0:01-0:04\nVOICE: The second clip.\n';

test('import-script: a person\'s command on real clips, in the help and not in the Director\'s allowlist', { timeout: 180000 }, async (t) => {
  const p = `${P}-cli`;
  clean(p);
  t.after(() => clean(p));
  createProject({ id: p, name: 'Scene Script CLI' });
  await makeClips(p);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-scene-script-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'two.txt');
  fs.writeFileSync(file, TWO);
  const check = await importSceneScript(p, TWO, { check: true, file: 'two.txt' });
  assert.deepEqual([check.errors, check.id, check.exists], [[], 'two-clip-test', false]);
  assert.deepEqual(check.rows[1].parts, [{ id: 'scene-1', kind: 'video', assets: ['a.mp4'], in: 0, out: 3, hold: 1, sound: true }]);
  assert.ok(!fs.existsSync(within(DIRS.briefs, p, 'two-clip-test.json')), 'a check writes nothing');
  const run = cli(['import-script', p, file, '--job', 'two-cut', '--by', 'tester']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /zz-test-scene-script-cli\/two-cut: scripted, explainer 16:9, 15 s, 3 scenes locked as written/);
  assert.match(run.stdout, /Scene 1: scene-1 a\.mp4 0-3 s, hold 1 s/);
  assert.match(run.stdout, /Scene 2: scene-2 b\.mp4 1-4 s/);
  assert.equal(getStatus(p, 'two-cut').status, 'scripted');
  const missing = cli(['import-script', p, path.join(dir, 'nope.txt')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Error: No file at/);
  const help = cli(['help'], 30000);
  assert.match(help.stdout, /node engine\/cli\.mjs import-script <project> <file\.txt> \[--job <id>\] \[--by name\]/);
  const { allowedTools } = loadStudioConfig().director;
  assert.ok(allowedTools.every((x) => !x.includes('import-script') && !/cli\.mjs \*\)$/.test(x)), allowedTools.join(', '));
});

test('a two-scene import builds a storyboard: each clip scene lasts its span', { timeout: 600000 }, async (t) => {
  if (!(await hasChrome(loadStudioConfig().engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
  const p = `${P}-build`;
  clean(p);
  t.after(() => clean(p));
  createProject({ id: p, name: 'Scene Script Build' });
  const brandFile = within(DIRS.profiles, p, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  await makeClips(p);
  const r = await importSceneScript(p, TWO, { by: 'tester', file: 'two.txt' });
  const ID = r.brief.id;
  const st = await prepare(p, ID, 'tester');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  assert.equal(st.lint.errors, 0);
  const timing = readJson(jobFile(p, ID, 'timing.json'));
  const len = (id) => { const s = timing.scenes.find((x) => x.id === id); return s.end - s.start; };
  assert.ok(Math.abs(len('scene-1') - 4) < 0.01, `scene-1 lasts ${len('scene-1')} s, its span 4 s (3 s clip + 1 s hold)`);
  assert.ok(Math.abs(len('scene-2') - 3) < 0.01, `scene-2 lasts ${len('scene-2')} s, its span 3 s`);
  assert.deepEqual(timing.videos.map((v) => [v.id, v.sound]), [['scene-1', true], ['scene-2', true]]);
});
