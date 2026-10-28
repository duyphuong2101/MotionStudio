import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ROOT, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject, validateBrief, briefFile } from '../engine/jobs.mjs';
import { transcriptFile, stamp } from '../engine/stt.mjs';
import { systemPrompt, contextMessage, jobPrompt } from '../server/worker/prompt.mjs';

globalThis.fetch = () => { throw new Error('tests make no network call'); };

const rulesText = (file) => fs.readFileSync(path.join(ROOT, 'server', 'worker', file), 'utf8');
const RULES = rulesText('director-prompt.md');
const SCRIPT = rulesText('director-script.md');
const QUICK = rulesText('director-quick.md');
// The marker pairs .ai/scripts/sync-director-prompt.js writes, in the skill's order.
const BLOCKS = [['DIRECTOR-RULES', 'director-prompt.md', RULES], ['DIRECTOR-SCRIPT', 'director-script.md', SCRIPT], ['DIRECTOR-QUICK', 'director-quick.md', QUICK]]
  .map(([name, file, text]) => ({ begin: `<!-- BEGIN:${name} (generated from server/worker/${file}) -->`, end: `<!-- END:${name} -->`, text }));
const SKILL = () => fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'studio', 'SKILL.md'), 'utf8');
const d = (api) => ({ ...loadStudioConfig().director, jobTimeoutMinutes: 15, api });
const API = { maxTurnsPerJob: 40, maxImagesPerJob: 8, maxPrepareRounds: 3 };
const tail = (...texts) => `\n${texts.map((s) => s.trimEnd()).join('\n\n')}\n`;

test('the studio skill carries the shared, script and quick rules byte for byte between their markers, in that order', () => {
  const skill = SKILL();
  let after = 0;
  for (const { begin, end, text } of BLOCKS) {
    const start = skill.indexOf(begin), stop = skill.indexOf(end);
    assert.ok(start >= after && stop > start, `${begin} and ${end}, in order`);
    assert.equal(skill.slice(start + begin.length, stop), `\n${text.trimEnd()}\n`, 'run node .ai/scripts/sync-director-prompt.js');
    after = stop;
  }
});

test('the skill branches on the quick block and maps the outline actions to the CLI', () => {
  const skill = SKILL();
  assert.ok(skill.includes('| write the outline draft | write `out/<project>/<job>/outline.draft.json` |'));
  assert.ok(skill.includes('| commit the outline | `node engine/cli.mjs commit <project> <job> outline --by <actor>` |'));
  assert.match(skill, /If the context has a `quick` block: follow "Outline \(step 4\)" below.*Otherwise: follow "Script \(step 4\)" below/);
  assert.ok(skill.includes('## Outside the seat') && !skill.includes('## Outside Claude Code'));
});

test('AGENTS.md sends a plain Director request from any agent to the skill', () => {
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(text.includes('run the Motion Studio director on `<project>/<job>`'));
  assert.ok(text.includes('.agents/skills/studio/SKILL.md') && text.includes('`<tool>-agent`'));
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

test('the shared, script and quick rules name actions, not Claude Code commands or tools', () => {
  for (const [file, text] of [['shared', RULES], ['script', SCRIPT], ['quick', QUICK]]) {
    for (const s of ['node engine/cli.mjs', 'claude-seat', 'WebFetch', '/studio', 'read_image', 'write_draft', 'out/<project>']) {
      assert.ok(!text.includes(s), `${file}: ${s}`);
    }
  }
  for (const verb of ['fetch the brief page', 'write the source draft', 'commit the source', 'build the storyboard', 'read each still', 'fail the job with']) {
    assert.ok(RULES.toLowerCase().includes(verb), verb);
  }
  for (const verb of ['write the script draft', 'commit the script']) assert.ok(SCRIPT.toLowerCase().includes(verb), verb);
  for (const verb of ['write the outline draft', 'commit the outline', 'read a job file']) assert.ok(QUICK.toLowerCase().includes(verb), verb);
});

test('the quick rules hold the outline rules and none of the script rules, and the reverse', () => {
  for (const s of ['## Outline (step 4)', 'quick.fields', 'never shortens', 'Never invent a claim', 'cut 11']) assert.ok(QUICK.includes(s), s);
  for (const s of ['## Script (step 4)', '## Mixed briefs', 'layoutRule', 'carriedLocks']) {
    assert.ok(SCRIPT.includes(s), s);
    assert.ok(!QUICK.includes(s) && !RULES.includes(s), `only the script rules hold ${s}`);
  }
  assert.ok(!SCRIPT.includes('## Outline (step 4)') && !RULES.includes('## Outline (step 4)'));
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

test('the API header takes its numbers from the config passed in and ends with the shared and script rules', () => {
  const p = systemPrompt({ d: d(API) });
  for (const s of ['never render', 'at most 2 fix rounds', 'at most 3 times per job', 'At most 40 turns and 15 minutes']) assert.ok(p.includes(s), s);
  for (const tool of ['claim', 'fetch_page', 'read_job_file', 'write_draft', 'commit', 'prepare', 'fail', 'done']) assert.ok(p.includes(`\`${tool}\``), tool);
  assert.ok(p.endsWith(tail(RULES, SCRIPT)));
  assert.ok(!p.includes(QUICK.trimEnd()) && !p.includes('kind `outline`'));
  const q = systemPrompt({ d: d({ ...API, maxPrepareRounds: 5, maxTurnsPerJob: 12 }) });
  assert.ok(q.includes('at most 4 fix rounds') && q.includes('At most 12 turns'));
});

test('without a director.api block the header uses the plan defaults', () => {
  const p = systemPrompt({ d: d(undefined) });
  assert.ok(p.includes('at most 2 fix rounds') && p.includes('At most 40 turns'));
});

test('the quick prompt ends with the shared and quick rules, names the outline tools and never the script rules', () => {
  const p = systemPrompt({ d: d(API), quick: true });
  assert.ok(p.endsWith(tail(RULES, QUICK)));
  assert.ok(!p.includes(SCRIPT.trimEnd()) && !p.includes('## Mixed briefs') && !p.includes('## Script (step 4)'));
  for (const s of ['`write_draft` with kind `outline`', '`commit` with kind `outline`', '`warnings` and `notes`', 'the `quick` block', '`outline.json`']) assert.ok(p.includes(s), s);
  assert.ok(!p.includes('kind `script`') && !p.includes('layoutRule'));
  assert.ok(p.length < systemPrompt({ d: d(API) }).length, 'the quick prompt is the shorter one');
});

/* ---------- contextMessage on a temp job ---------- */
const P = 'zz-test-worker-prompt';
const ID = 'promo';
const brief = { id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm', url: '' };

function seed(t, over = {}) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Worker prompt' });
  writeJson(briefFile(P, ID), validateBrief({ ...brief, ...over }));
}

test('jobPrompt picks the rules from the job: script rules for a plain brief, quick rules for a quick brief', (t) => {
  seed(t);
  const plain = jobPrompt(P, ID, { d: d(API) });
  assert.ok(plain.system.endsWith(tail(RULES, SCRIPT)));
  assert.ok('template' in JSON.parse(plain.context.slice(plain.context.indexOf('\n') + 1)));
  writeJson(briefFile(P, ID), validateBrief({ ...brief, quick: true }));
  const quick = jobPrompt(P, ID, { d: d(API), provider: { label: 'OpenAI' } });
  assert.ok(quick.system.endsWith(tail(RULES, QUICK)) && quick.system.includes('running on OpenAI'));
  const ctx = JSON.parse(quick.context.slice(quick.context.indexOf('\n') + 1));
  assert.ok('quick' in ctx && !('template' in ctx));
  assert.ok(quick.context.startsWith(`Job ${P}/${ID}. Context:\n`));
});

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
