import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, testFiles, impacted } from './impact.mjs';

const mods = buildGraph();
const pick = (...files) => impacted(files, { mods, byLine: false });

test('docs pick no test, package.json or config picks every test', () => {
  assert.equal(pick('README.md', '.ai/docs/conventions.md').tests.size, 0);
  const all = pick('package.json');
  assert.match(all.all, /package\.json/);
  assert.equal(all.tests.size, testFiles(mods).length);
  assert.ok(pick('config/studio.json').all);
});

test('a test file picks itself; a module picks the tests that reach what it declares', () => {
  assert.deepEqual([...pick('tests/marks.test.mjs').tests.keys()], ['tests/marks.test.mjs']);
  const tts = pick('engine/tts.mjs').tests;
  assert.ok(tts.has('tests/voice-lang.test.mjs'));
  assert.ok(!tts.has('tests/icons.test.mjs'), 'icons never reach the voice');
});

test('a template folder picks the tests that name it or render every template', () => {
  const t = pick('templates/data-story/beats.json').tests;
  assert.ok(t.has('tests/data-charts.test.mjs'));
  for (const n of [1, 2, 3]) assert.ok(t.has(`tests/playcheck-templates-${n}.test.mjs`));
  assert.ok(!t.has('tests/keys.test.mjs'));
});

test('a data file the code reads picks the tests of the code that names it', () => {
  assert.ok(pick('server/worker/director-quick.md').tests.has('tests/worker-prompt.test.mjs'));
  assert.ok(pick('.claude/skills/studio/SKILL.md').tests.has('tests/worker-prompt.test.mjs'), 'a kit file a test reads by path.join');
});

test('the links the import graph cannot see: shared template modules, spawned entry points, listTemplates', () => {
  const kit = pick('templates/kit.mjs').tests;
  for (const n of [1, 2, 3]) assert.ok(kit.has(`tests/playcheck-templates-${n}.test.mjs`), 'the every-template sweeps');
  assert.ok(kit.has('tests/motion-presets.test.mjs'));
  const server = pick('server/server.mjs').tests;
  assert.ok(server.has('tests/server-hardening.test.mjs'), 'a test that spawns path.join(ROOT, "server", "server.mjs")');
  assert.ok(pick('engine/banner.mjs').tests.has('tests/server-banner.test.mjs'), 'reached through the spawned server');
  const beats = pick('templates/before-after/beats.json').tests;
  for (const t of ['templates', 'help', 'mix', 'engine']) assert.ok(beats.has(`tests/${t}.test.mjs`), `${t}: loops over listTemplates()`);
});
