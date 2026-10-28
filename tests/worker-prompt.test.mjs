import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ROOT, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, briefFile } from '../engine/jobs.mjs';
import { transcriptFile, stamp } from '../engine/stt.mjs';
import { systemPrompt, contextMessage } from '../server/worker/prompt.mjs';

globalThis.fetch = () => { throw new Error('tests make no network call'); };

const RULES = fs.readFileSync(path.join(ROOT, 'server', 'worker', 'director-prompt.md'), 'utf8');
const BEGIN = '<!-- BEGIN:DIRECTOR-RULES (generated from server/worker/director-prompt.md) -->';
const END = '<!-- END:DIRECTOR-RULES -->';
const d = (api) => ({ ...loadStudioConfig().director, jobTimeoutMinutes: 15, api });
const API = { maxTurnsPerJob: 40, maxImagesPerJob: 8, maxPrepareRounds: 3 };

test('the studio skill carries the shared rules byte for byte between the markers', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'studio', 'SKILL.md'), 'utf8');
  const start = skill.indexOf(BEGIN), end = skill.indexOf(END);
  assert.ok(start >= 0 && end > start, 'both markers, in order');
  assert.equal(skill.slice(start + BEGIN.length, end), `\n${RULES.trimEnd()}\n`, 'run node .ai/scripts/sync-director-prompt.js');
});

test('Cursor, Copilot and Antigravity get the studio skill byte for byte, and each /studio entry points at it', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'studio', 'SKILL.md'), 'utf8');
  for (const dir of ['.cursor', '.agents']) {
    const copy = fs.readFileSync(path.join(ROOT, dir, 'skills', 'studio', 'SKILL.md'), 'utf8');
    assert.equal(copy, skill, `${dir}/skills/studio/SKILL.md: run node .ai/scripts/sync-director-prompt.js`);
  }
  assert.ok(!/--by claude-seat/.test(skill), 'the skill takes --by <actor>, not a fixed seat name');
  const entries = {
    '.cursor/commands/studio.md': ['.cursor/skills/studio/SKILL.md', 'cursor-agent'],
    '.github/prompts/studio.prompt.md': ['.agents/skills/studio/SKILL.md', 'copilot-agent'],
    '.agents/workflows/studio.md': ['.agents/skills/studio/SKILL.md', 'antigravity-agent'],
  };
  for (const [file, [target, actor]] of Object.entries(entries)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(text.includes(target) && text.includes(actor), `${file} names ${target} and ${actor}`);
    assert.ok(skill.includes(`\`${actor}\``), `the skill lists ${actor}`);
    assert.match(text, /Never run `approve`, `render`, `sequence`/, file);
  }
});

test('the shared rules name actions, not Claude Code commands or tools', () => {
  for (const s of ['node engine/cli.mjs', 'claude-seat', 'WebFetch', '/studio', 'read_image', 'write_draft', 'out/<project>']) {
    assert.ok(!RULES.includes(s), s);
  }
  for (const verb of ['fetch the brief page', 'write the source draft', 'commit the source', 'build the storyboard', 'read each still', 'fail the job with']) {
    assert.ok(RULES.toLowerCase().includes(verb), verb);
  }
});

test('without vision the prompt says it cannot see images and offers no read_image', () => {
  const p = systemPrompt({ vision: false });
  assert.match(p, /cannot see images/);
  assert.ok(!p.includes('read_image'));
});

test('with vision the prompt names read_image and the image cap', () => {
  const p = systemPrompt({ provider: { label: 'OpenAI' }, d: d(API), vision: true });
  assert.match(p, /read_image/);
  assert.match(p, /at most 8 images per job/);
  assert.match(p, /running on OpenAI/);
});

test('the API header takes its numbers from the config passed in and ends with the shared rules', () => {
  const p = systemPrompt({ d: d(API) });
  for (const s of ['never render', 'at most 2 fix rounds', 'at most 3 times per job', 'At most 40 turns and 15 minutes']) assert.ok(p.includes(s), s);
  for (const tool of ['claim', 'fetch_page', 'read_job_file', 'write_draft', 'commit', 'prepare', 'fail', 'done']) assert.ok(p.includes(`\`${tool}\``), tool);
  assert.ok(p.endsWith(`\n${RULES.trimEnd()}\n`));
  const q = systemPrompt({ d: d({ ...API, maxPrepareRounds: 5, maxTurnsPerJob: 12 }) });
  assert.ok(q.includes('at most 4 fix rounds') && q.includes('At most 12 turns'));
});

test('without a director.api block the header uses the plan defaults', () => {
  const p = systemPrompt({ d: d(undefined) });
  assert.ok(p.includes('at most 2 fix rounds') && p.includes('At most 40 turns'));
});

/* ---------- contextMessage on a temp job ---------- */
const P = 'zz-test-worker-prompt';
const ID = 'promo';
const brief = { id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url: '' };

function seed(t) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Worker prompt' });
  writeJson(briefFile(P, ID), validateBrief(brief));
}

test('contextMessage names the job and carries the director context as JSON', (t) => {
  seed(t);
  const m = contextMessage(P, ID);
  assert.ok(m.startsWith(`Job ${P}/${ID}. Context:\n`));
  const ctx = JSON.parse(m.slice(m.indexOf('\n') + 1));
  for (const k of ['brief', 'template', 'urlCheck']) assert.ok(k in ctx, k);
  assert.equal(ctx.brief.id, ID);
  assert.equal(ctx.urlCheck, null);
});

test('contextMessage cuts a transcript to its first 400 segments', (t) => {
  seed(t);
  const asset = path.join(DIRS.profiles, P, 'assets', 'talk.mp4');
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(asset, Buffer.alloc(64));
  const segments = Array.from({ length: 500 }, (_, i) => ({ start: i, end: i + 1, text: `s${i}` }));
  fs.mkdirSync(path.dirname(transcriptFile(P, 'talk.mp4')), { recursive: true });
  writeJson(transcriptFile(P, 'talk.mp4'), { asset: 'talk.mp4', stamp: stamp(asset), duration: 500, lang: 'en', segments, words: [] });
  const tr = JSON.parse(contextMessage(P, ID).split('\n').slice(1).join('\n')).transcripts['talk.mp4'];
  assert.equal(tr.segments.length, 400);
  assert.equal(tr.segments.at(-1).text, 's399');
  assert.equal(tr.segmentsTotal, 500);
});
