// Remotion import: a tiny fake Remotion project (tests/fixtures/remotion-sample) read as text, mapped to a brief, its
// public/ PNG saved into a throwaway project. The copy each test makes adds what git cannot hold: the PNG, a
// node_modules folder and two links (junctions on Windows) to a folder outside the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DIRS, ROOT, within, loadStudioConfig } from '../engine/core.mjs';
import { createProject, getStatus, loadBrief, validateBrief } from '../engine/jobs.mjs';
import {
  REMOTION_CAPS, remotionRoot, readSources, readRemotion, remotionBrief, importRemotion, nearestFormat, evalNumber, cleanText, jobIdFor,
} from '../engine/remotion.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/remotion-sample/', import.meta.url));
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PROJECT = 'zz-test-remotion';
const EXPLAINER = ['16:9', '1:1', '9:16', '4:5', '2:3', '21:9'];

/** A copy of the fixture with its PNG, a node_modules folder, and links from src/ and public/ to a folder outside it. */
function sample(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-remotion-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'project'), outside = path.join(base, 'outside');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'public', 'logo.png'), PNG);
  fs.mkdirSync(path.join(dir, 'node_modules', 'remotion'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'remotion', 'index.tsx'), 'export const X = () => <h1>Library text must stay out</h1>;\n');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'Evil.tsx'), 'export const E = () => <h1>Outside text must stay out</h1>;\n');
  fs.writeFileSync(path.join(outside, 'secret.png'), PNG);
  let linked = true;
  try {
    fs.symlinkSync(outside, path.join(dir, 'src', 'linked-src'), 'junction');
    fs.symlinkSync(outside, path.join(dir, 'public', 'linked'), 'junction');
  } catch { linked = false; }
  return { base, dir, linked };
}

const cleanProject = () => { for (const k of ['profiles', 'briefs', 'out']) fs.rmSync(within(DIRS[k], PROJECT), { recursive: true, force: true }); };

test('only source files inside the folder are read: no node_modules, no links, name order', (t) => {
  const { dir, linked } = sample(t);
  const r = readSources(remotionRoot(dir));
  assert.deepEqual(r.files.map((f) => f.rel), ['package.json', 'src/Outro.tsx', 'src/Root.tsx', 'src/Title.tsx', 'src/Video.tsx', 'src/constants.ts', 'src/data.json', 'src/index.ts']);
  assert.equal(r.capped, false);
  if (linked) assert.deepEqual(r.skipped, ['public/linked: a link, not followed', 'src/linked-src: a link, not followed']);
  else t.diagnostic('links could not be made here: the link checks did not run');
  const all = JSON.stringify(readRemotion(dir));
  assert.ok(!all.includes('Library text') && !all.includes('Outside text'), 'nothing from node_modules or a linked folder');
});

test('both compositions are read with size, fps, frames (from a constant) and default props', (t) => {
  const r = readRemotion(sample(t).dir);
  assert.deepEqual(r.compositions.map(({ id, file, width, height, fps, frames, seconds }) => ({ id, file, width, height, fps, frames, seconds })), [
    { id: 'LaunchVideo', file: 'src/Root.tsx', width: 1920, height: 1080, fps: 30, frames: 270, seconds: 9 },
    { id: 'LaunchSquare', file: 'src/Root.tsx', width: 1080, height: 1080, fps: 30, frames: 150, seconds: 5 },
  ]);
  assert.deepEqual(r.compositions[0].props, { title: 'Ship videos faster', speed: 2 });
});

test('sequences become scenes with their start and length in seconds; a Series plays its sequences in turn', (t) => {
  const r = readRemotion(sample(t).dir);
  assert.deepEqual(r.scenes.map(({ name, tag, from, seconds, file }) => [name, tag, from, seconds, file]), [
    ['Outro', 'Sequence', 1, 1.5, 'src/Outro.tsx'],
    ['Intro', 'Series.Sequence', 0, 3, 'src/Video.tsx'],
    ['Kits', 'Series.Sequence', 3, 2, 'src/Video.tsx'],
    ['Render', 'Series.Sequence', 5, 4, 'src/Video.tsx'],
  ]);
  assert.deepEqual(r.scenes[2].texts, ['Brand kits in one click']);
  assert.deepEqual(r.scenes[3].texts, ['Render on your own machine', 'Approve every storyboard first']);
});

test('visible text and text props are found once each, with their file; comments, code and paths are not', (t) => {
  const r = readRemotion(sample(t).dir);
  assert.deepEqual(r.texts, [
    { file: 'src/Outro.tsx', text: 'Try it on your next launch' },
    { file: 'src/Root.tsx', text: 'Ship videos faster' },
    { file: 'src/Video.tsx', text: 'Brand kits in one click' },
    { file: 'src/Video.tsx', text: 'Render on your own machine' },
    { file: 'src/Video.tsx', text: 'Approve every storyboard first' },
    { file: 'src/data.json', text: 'Approve in the browser' },
  ]);
  assert.deepEqual(r.refs.map((x) => x.ref), ['../outside.png', 'notes.txt', 'linked/secret.png', 'https://example.com/clip.mp4', 'logo.png']);
});

test('the brief: nearest format, length inside the template range, facts that name their file, scenes in the notes', (t) => {
  const r = readRemotion(sample(t).dir);
  const { brief, facts } = remotionBrief(r, { project: PROJECT, by: 'tester' });
  assert.deepEqual([brief.id, brief.template, brief.format, brief.duration, brief.subject, brief.createdBy], ['remotion-launchvideo', 'explainer', '16:9', 15, 'LaunchVideo', 'tester']);
  const lines = brief.facts.split('\n');
  assert.equal(lines[0], 'Remotion src/Outro.tsx: "Try it on your next launch"');
  assert.ok(lines.every((l) => /^Remotion src\/[\w.]+: ".+"$/.test(l)), lines.join('\n'));
  assert.deepEqual(facts, { lines: 6, dropped: 0 });
  assert.match(brief.notes, /nothing was run/);
  assert.match(brief.notes, /Composition LaunchVideo 1920x1080 at 30 fps, 9 s\./);
  assert.match(brief.notes, /explainer makes 15-150 s, so the brief asks 15 s\./);
  assert.match(brief.notes, /1\. Outro 1-2\.5 s \(src\/Outro\.tsx\): "Try it on your next launch"; 2\. Intro 0-3 s \(src\/Video\.tsx\); 3\. Kits 3-5 s \(src\/Video\.tsx\): "Brand kits in one click"; 4\. Render 5-9 s/);
  assert.match(brief.notes, /Other compositions: LaunchSquare 1080x1080 at 30 fps, 5 s\./);
  assert.doesNotThrow(() => validateBrief(brief));
  const square = remotionBrief(r, { project: PROJECT, composition: 'LaunchSquare', template: 'code-story' }).brief;
  assert.deepEqual([square.id, square.format, square.duration], ['remotion-launchsquare', '1:1', 10]);
  assert.throws(() => remotionBrief(r, { project: PROJECT, composition: 'Nope' }), /No composition Nope in this project\. Found: LaunchVideo, LaunchSquare/);
});

test('format, numbers, text and ids', () => {
  assert.equal(nearestFormat(1080, 1920, EXPLAINER), '9:16');
  assert.equal(nearestFormat(2560, 1080, EXPLAINER), '21:9');
  assert.equal(nearestFormat(1000, 1000, ['9:16', '1:1', '4:5', '2:3']), '1:1');
  assert.equal(nearestFormat(null, null, EXPLAINER), '16:9');
  assert.equal(nearestFormat(undefined, 1080, ['9:16', '1:1']), '9:16');
  assert.equal(evalNumber('9 * FPS', { FPS: 30 }), 270);
  assert.equal(evalNumber('90 + 60'), 150);
  assert.equal(evalNumber('fps / 2', { fps: 30 }), 15);
  assert.equal(evalNumber('unknown * 2'), null);
  assert.equal(evalNumber('Math.round(3)'), null);
  assert.equal(evalNumber(''), null);
  for (const no of ['logo.png', 'https://example.com/a', '#0f172a', 'x', '42', 'src/intro']) assert.equal(cleanText(no), null, no);
  assert.equal(cleanText('  Fast &amp;\n local  '), 'Fast & local');
  const long = cleanText('word '.repeat(60));
  assert.ok(long.length === REMOTION_CAPS.textChars && long.endsWith('…'));
  assert.equal(jobIdFor('Launch Video!'), 'remotion-launch-video');
  assert.equal(jobIdFor(''), 'remotion-import');
  assert.equal(jobIdFor('x'.repeat(90)).length, 64);
});

test('caps: files, bytes, file size, depth, texts and the facts field', (t) => {
  const { dir } = sample(t);
  const root = remotionRoot(dir);
  const few = readSources(root, { ...REMOTION_CAPS, files: 2 });
  assert.deepEqual([few.files.length, few.capped], [2, true]);
  assert.equal(readSources(root, { ...REMOTION_CAPS, bytes: 200 }).capped, true);
  assert.ok(readSources(root, { ...REMOTION_CAPS, fileBytes: 100 }).skipped.includes('src/Root.tsx: larger than 100 bytes'));
  const flat = readSources(root, { ...REMOTION_CAPS, depth: 0 });
  assert.deepEqual(flat.files.map((f) => f.rel), ['package.json']);
  assert.ok(flat.skipped.includes('src: deeper than 0 folders'));
  const r = readRemotion(dir, { ...REMOTION_CAPS, texts: 2 });
  assert.deepEqual([r.texts.length, r.textsCapped], [2, true]);
  const many = { ...r, compositions: [], scenes: [], texts: Array.from({ length: 30 }, (_, i) => ({ file: 'src/X.tsx', text: `${'long line '.repeat(15)}${i}` })) };
  const { brief, facts } = remotionBrief(many, { project: PROJECT });
  assert.ok(brief.facts.length <= 2000 && facts.dropped > 0 && facts.lines + facts.dropped === 30, `${brief.facts.length} chars, ${facts.lines} kept`);
  assert.match(brief.notes, /No <Composition> found/);
  assert.doesNotThrow(() => validateBrief(brief));
});

test('a missing folder, a file, no folder at all and an unknown project are refused', (t) => {
  const { base, dir } = sample(t);
  assert.throws(() => readRemotion(path.join(base, 'nope')), (e) => e.code === 404 && /No folder at/.test(e.message));
  assert.throws(() => readRemotion(path.join(dir, 'package.json')), (e) => e.code === 400 && /is not a folder/.test(e.message));
  assert.throws(() => readRemotion(''), /Name the Remotion project folder/);
  assert.throws(() => importRemotion('zz-test-remotion-none', dir), (e) => e.code === 404 && /Unknown project/.test(e.message));
  assert.throws(() => importRemotion('../x', dir), /Invalid project/);
});

test('import-remotion saves the referenced PNG, reports the rest, and writes a queued brief', (t) => {
  const { dir, linked } = sample(t);
  cleanProject();
  createProject({ id: PROJECT, name: 'Remotion Test' });
  t.after(cleanProject);
  const r = importRemotion(PROJECT, dir, { by: 'tester' });
  assert.deepEqual(loadBrief(PROJECT, 'remotion-launchvideo'), r.brief);
  assert.equal(getStatus(PROJECT, 'remotion-launchvideo').status, 'queued');
  assert.deepEqual(r.assets.saved.map((a) => a.name), ['logo.png']);
  assert.ok(fs.readFileSync(within(DIRS.profiles, PROJECT, 'assets', 'logo.png')).equals(PNG));
  assert.ok(!fs.existsSync(within(DIRS.profiles, PROJECT, 'assets', 'secret.png')), 'nothing from behind a link');
  const why = Object.fromEntries(r.assets.skipped.map((s) => [s.ref, s.reason]));
  assert.match(why['../outside.png'], /leaves public/);
  assert.match(why['notes.txt'], /\.txt is not allowed/);
  assert.match(why['https://example.com/clip.mp4'], /remote file, not downloaded/);
  assert.match(why['linked/secret.png'], linked ? /outside the project folder/ : /not found in public/);
  assert.match(r.brief.notes, /Assets saved in the brand: logo\.png\./);
  assert.throws(() => importRemotion(PROJECT, dir), (e) => e.code === 409 && /already exists\. Pick another id with --job/.test(e.message));
  // The CLI: flags are not read as the folder, and the identical logo.png already in the brand is reused.
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), 'import-remotion', PROJECT, dir, '--job', 'square-cut', '--composition', 'LaunchSquare', '--template', 'code-story', '--by', 'tester'],
    { cwd: ROOT, shell: false, windowsHide: true, timeout: 60000, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /zz-test-remotion\/square-cut: queued brief, code-story 1:1, 10 s/);
  assert.match(cli.stdout, /asset logo\.png \(already in the brand\) from logo\.png/);
  assert.match(cli.stdout, /not imported \.\.\/outside\.png \(src\/Outro\.tsx\): a path that leaves public\//);
  assert.equal(loadBrief(PROJECT, 'square-cut').createdBy, 'tester');
});

test("import-remotion is a person's command: in the CLI help, not in the Director's allowlist", () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), 'help'], { cwd: ROOT, shell: false, windowsHide: true, timeout: 30000, encoding: 'utf8' });
  assert.match(help.stdout, /node engine\/cli\.mjs import-remotion <project> <dir> \[--job <id>\] \[--template <id>\]/);
  const { allowedTools } = loadStudioConfig().director;
  assert.ok(allowedTools.every((x) => !x.includes('import-remotion') && !/cli\.mjs \*\)$/.test(x)), allowedTools.join(', '));
});
