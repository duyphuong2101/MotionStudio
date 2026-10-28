import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson, readJson } from '../engine/core.mjs';
import {
  validateBrief, saveBrief, updateBrief, loadBrief, setStatus, getStatus, jobFile, briefFile, createProject, loadTemplate, listTemplates, humanEdit,
} from '../engine/jobs.mjs';
import { directorContext } from '../engine/context.mjs';
import { addNote } from '../engine/notes.mjs';
import { validateOutline, expandOutline, quickRules } from '../engine/quick.mjs';
import { LOOK_NAMES } from '../engine/looks.mjs';
import { ICON_NAMES } from '../motion-kit/icons.mjs';

const { beats: EX } = loadTemplate('explainer');
const P = 'zz-test-quick-brief';
const SOURCE = {
  name: 'MegaMax Classic',
  bullets: [
    { text: 'MegaMax Classic is back', ref: 'https://example.com/megamax' },
    { text: 'Up to 12 hours dry', ref: 'https://example.com/megamax' },
    { text: 'Free shipping on every order over $30', ref: 'https://example.com/shipping' },
  ],
  facts: [{ text: '30-day returns, no questions', ref: 'brief.facts[0]' }],
};
const OUTLINE = () => ({
  mood: 'energetic',
  headline: { text: 'MegaMax Classic is back', source: 'bullets[0]' },
  points: [
    { label: 'Absorbency', text: 'Up to 12 hours dry', source: 'bullets[1]' },
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
  ],
  cta: { text: 'Try it today', button: 'Shop now' },
});
const base = (extra = {}) => ({ id: 'q', project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'Show what is new in MegaMax Classic', ...extra });
const quickNames = () => listTemplates().filter((b) => b.quick).map((b) => b.id).join(', ');
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: 'pipe' });

function seed(t, id, extra = {}) {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  if (!fs.existsSync(path.join(DIRS.profiles, P))) createProject({ id: P, name: 'Quick Brief Test' });
  saveBrief(validateBrief(base({ id, ...extra })));
}
// A scripted job: source.json, and the expanded outline as script.json with a person's title edit on point-1.
function scripted(id) {
  writeJson(jobFile(P, id, 'source.json'), { ...SOURCE, locks: {} });
  const first = { ...expandOutline(OUTLINE(), EX).script, locks: {} };
  const edited = structuredClone(first);
  edited.scenes[1].title = 'Dry all day';
  const doc = humanEdit('script', first, edited, 'person').doc;
  writeJson(jobFile(P, id, 'script.json'), doc);
  setStatus(P, id, { status: 'scripted', step: 5 }, 'test');
  return doc;
}

/* ---------- the brief flag ---------- */

test('validateBrief takes quick: true on a template with a quick block; without it the brief has no quick key', () => {
  assert.equal(validateBrief(base({ quick: true })).quick, true);
  assert.equal('quick' in validateBrief(base()), false);
  assert.equal('quick' in validateBrief(base({ quick: false })), false, 'false is the same as absent');
  assert.throws(() => validateBrief(base({ quick: 'yes' })), (e) => e.code === 400 && e.message === 'quick must be true or false');
});

test('quick is refused on a template without a quick block and with a mix, with the fix in the message', () => {
  const { beats: th } = loadTemplate('talking-head');
  assert.equal(th.quick, undefined);
  const talking = base({ template: 'talking-head', format: th.formats[0], duration: th.durations[0] });
  validateBrief(talking);
  assert.throws(() => validateBrief({ ...talking, quick: true }), (e) => e.code === 400
    && e.message === `Template talking-head has no quick mode yet; quick mode works with ${quickNames()}`);
  const mixed = base({ mix: ['data-story'] });
  validateBrief(mixed);
  assert.throws(() => validateBrief({ ...mixed, quick: true }), (e) => e.code === 400
    && e.message === 'Quick mode does not take a mix: untick the mixed templates or Quick video');
});

test('ticking quick on a scripted job sends it back from step 3: the script moves aside, the source stays, locks carry', (t) => {
  seed(t, 'toggle');
  const before = scripted('toggle');
  const r = updateBrief(P, 'toggle', { ...loadBrief(P, 'toggle'), quick: true }, { by: 'tester' });
  assert.deepEqual([r.changed, r.newScript, r.requeued, r.rePrepare], [['quick'], true, true, false]);
  assert.equal(readJson(briefFile(P, 'toggle')).quick, true);
  assert.equal(fs.existsSync(jobFile(P, 'toggle', 'script.json')), false);
  assert.deepEqual(readJson(jobFile(P, 'toggle', 'script.prev.json')), before);
  assert.ok(fs.existsSync(jobFile(P, 'toggle', 'source.json')), 'source.json is kept');
  assert.deepEqual(Object.keys(readJson(jobFile(P, 'toggle', 'script.locks.json')).locks), ['scene:point-1.title']);
  const st = getStatus(P, 'toggle');
  assert.deepEqual([st.status, st.step, st.dirty_from], ['dirty', 3, 3]);
  assert.deepEqual([st.history.at(-1).event, st.history.at(-1).by],
    ['brief edited in UI: quick; script moved to script.prev.json; locks carried: scene:point-1.title', 'tester']);
});

test('saving a brief with its quick choice unchanged changes nothing; before the Director runs only the brief changes', (t) => {
  seed(t, 'same');
  assert.deepEqual(updateBrief(P, 'same', { ...loadBrief(P, 'same'), quick: false }).changed, [], 'absent and false are one choice');
  const r = updateBrief(P, 'same', { ...loadBrief(P, 'same'), quick: true });
  assert.deepEqual([r.changed, r.requeued], [['quick'], false]);
  assert.equal(getStatus(P, 'same').status, 'queued');
  assert.deepEqual(updateBrief(P, 'same', { ...loadBrief(P, 'same'), quick: true }).changed, []);
});

/* ---------- the quick context ---------- */

test('a quick brief gets the quick context: no template rules, each outline field with the explainer limit, a valid example', (t) => {
  seed(t, 'ctx', { quick: true });
  const ctx = directorContext(P, 'ctx');
  assert.deepEqual(Object.keys(ctx), ['brief', 'status', 'brand', 'voiceNotes', 'quick']);
  assert.deepEqual(ctx.brief, { id: 'ctx', project: P, template: 'explainer', format: '16:9', duration: 30, message: 'Show what is new in MegaMax Classic', quick: true },
    'only what the person filled in');
  assert.deepEqual(ctx.status, { status: 'queued', step: 1, dirty_from: null });
  assert.deepEqual(ctx.brand, { name: 'Quick Brief Test', voice: { lang: 'en' } });
  const q = ctx.quick;
  assert.deepEqual([q.template, q.points, q.cta, q.moods], ['explainer', [2, 5], 'optional', LOOK_NAMES]);
  assert.deepEqual(q.fields, {
    mood: 'optional: one of moods, default calm',
    lang: 'optional: language code, default the brief\'s',
    'headline.text': 'required: max 44 chars (~7 words)',
    'headline.say': 'optional spoken line: max 34 words, default the text',
    'headline.source': 'optional: bullets[n] or facts[n]',
    'points[].label': 'required: max 44 chars (~7 words)',
    'points[].text': 'required: max 110 chars (~18 words)',
    'points[].say': 'optional spoken line: max 34 words, default the text',
    'points[].icon': 'optional: one of icons, default matched',
    'points[].source': 'required: bullets[n] or facts[n]',
    'cta.text': 'required: max 44 chars (~7 words)',
    'cta.button': 'required: max 24 chars (~4 words)',
    'cta.say': 'optional spoken line: max 34 words, default the text',
    'cta.source': 'optional: bullets[n] or facts[n]',
  });
  assert.deepEqual(q.icons, { brand: [], builtIn: ICON_NAMES.join(', ') });
  assert.deepEqual(q.shape, {
    mood: 'calm',
    headline: { text: 'The news in one line', say: 'The headline as it is spoken.', source: 'bullets[0]' },
    points: [1, 2].map((n) => ({ label: `Point ${n}`, text: 'What it means to the viewer', say: 'One short spoken sentence.', source: `bullets[${n}]` })),
    cta: { text: 'What to do next', button: 'Shop now', say: 'Ask the viewer to act.' },
  });
  assert.match(q.rule, /never shortens text/);
});

test('the example outline of every template with a quick block passes its own outline check', () => {
  const quick = listTemplates().filter((b) => b.quick);
  assert.ok(quick.length);
  for (const b of quick) assert.deepEqual(validateOutline(quickRules(b).shape, b, { source: SOURCE }), { errors: [], warnings: [] }, b.id);
});

test('the quick context carries the source, the last outline, the lock keys and pinned notes once they exist', (t) => {
  seed(t, 'later', { quick: true });
  scripted('later');
  writeJson(jobFile(P, 'later', 'outline.json'), OUTLINE());
  writeJson(jobFile(P, 'later', 'timing.json'), { duration: 12, scenes: [{ id: 'open', start: 0, end: 4 }, { id: 'point-1', start: 4, end: 8 }, { id: 'close', start: 8, end: 12 }], words: [] });
  setStatus(P, 'later', { status: 'dirty', dirty_from: 4, step: 4 }, 'test');
  addNote(P, 'later', { t: 5, text: 'Say the hours first' });
  const ctx = directorContext(P, 'later');
  assert.deepEqual(ctx.source, readJson(jobFile(P, 'later', 'source.json')));
  assert.deepEqual(ctx.outline, OUTLINE());
  assert.deepEqual(ctx.locks, ['scene:point-1.title']);
  assert.deepEqual(ctx.notes, [{ t: 5, scene: 'point-1', text: 'Say the hours first' }]);
  assert.match(ctx.notesRule, /never a source/);
  assert.deepEqual(ctx.status, { status: 'dirty', step: 4, dirty_from: 4 });
  assert.equal('template' in ctx, false);
});

test('a quick job with a draft scene gets the full context with the template rules and the drafts', (t) => {
  seed(t, 'drafted', { quick: true });
  const doc = scripted('drafted');
  doc.scenes.splice(2, 0, { id: 'step-x', kind: 'step', source: 'bullets[1]', draft: { note: 'Add the night use', by: 'person' } });
  writeJson(jobFile(P, 'drafted', 'script.json'), doc);
  const ctx = directorContext(P, 'drafted');
  assert.equal('quick' in ctx, false);
  assert.equal(ctx.template.id, 'explainer');
  assert.deepEqual(ctx.drafts.map((d) => [d.id, d.position]), [['step-x', 3]]);
  assert.match(ctx.layoutRule, /3 scenes in a row the same kind/);
});

test('the quick context is under 4 KB as cli context prints it, and a fraction of the full context of the same brief', (t) => {
  seed(t, 'size-quick', { quick: true });
  seed(t, 'size-full');
  const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
  const quick = directorContext(P, 'size-quick');
  const full = directorContext(P, 'size-full');
  const printed = Buffer.byteLength(cli('context', P, 'size-quick'));
  const printedFull = Buffer.byteLength(cli('context', P, 'size-full'));
  t.diagnostic(`quick context: ${bytes(quick)} B compact, ${printed} B as printed; full context: ${bytes(full)} B compact, ${printedFull} B as printed`);
  assert.ok(printed < 4096, `cli context prints ${printed} B for a quick brief`);
  assert.ok(bytes(quick) * 2 < bytes(full), `quick ${bytes(quick)} B vs full ${bytes(full)} B`);
});
