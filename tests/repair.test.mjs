import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ROOT, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, getStatus, jobFile, loadTemplate, mergeRespectingLocks } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { commit } from '../engine/pipeline.mjs';
import { ICON_KEYWORDS, matchIcon, nearestIcon } from '../engine/icon-match.mjs';
import { repairScript } from '../engine/repair.mjs';
import { ICON_NAMES, BASE_ICONS } from '../motion-kit/icons.mjs';
import { toolsFor } from '../server/worker/tools.mjs';

globalThis.fetch = () => { throw new Error('tests make no network call'); };

const beats = loadTemplate('explainer').beats;
const BODY = beats.sequence[1].kind.join('|');
const lock = { by: 'ana', at: 't0', note: '' };
const step = (id, more = {}) => ({ id, kind: 'step', vo: 'Then you ask.', title: 'Ask', icon: 'chat', source: 'bullets[0]', ...more });
const script = (...more) => ({ lang: 'en', scenes: [{ id: 'intro', kind: 'title', vo: 'How it works.', title: 'How it works' }, step('s1'), ...more] });
const repair = (doc, opts) => repairScript(doc, beats, opts);

/* ---------- icon matching ---------- */

test('the keyword table covers every built-in icon, names only built-ins and gives no word to two icons', () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'motion-kit', 'icon-list.json'), 'utf8'));
  const names = [...Object.keys(BASE_ICONS), ...Object.values(list.groups).flatMap((g) => Object.keys(g))];
  for (const n of names) assert.ok(ICON_KEYWORDS[n]?.length, `${n} has keywords`);
  for (const n of ICON_NAMES) assert.ok(ICON_KEYWORDS[n], `${n} has keywords`);
  for (const n of Object.keys(ICON_KEYWORDS)) assert.ok(ICON_NAMES.includes(n), `${n} is a built-in icon`);
  const owner = new Map();
  for (const [n, words] of Object.entries(ICON_KEYWORDS)) {
    for (const w of words) {
      assert.ok(!owner.has(w), `"${w}" is under ${owner.get(w)} and ${n}`);
      owner.set(w, n);
    }
  }
});

test('matchIcon reads keywords, lets a named brand icon win and answers null for no match', () => {
  assert.equal(matchIcon('free shipping on every order'), 'truck');
  assert.equal(matchIcon('30-day returns'), 'return');
  assert.equal(matchIcon('MegaMax tag', ICON_NAMES, ['megamax']), 'megamax');
  assert.equal(matchIcon('Mega Max tag', ICON_NAMES, ['mega-max']), 'mega-max');
  assert.equal(matchIcon('MegaMax tag'), 'tag');
  assert.equal(matchIcon(['Secure', 'checkout']), 'cart', 'a tie goes to the earlier table entry');
  assert.equal(matchIcon('nothing here zzz'), null);
  assert.equal(matchIcon('free shipping', ['star', 'chat']), null, 'only icons in the list');
});

test('nearestIcon: close spelling, then keywords, then the fallback, then the first built-in', () => {
  assert.equal(nearestIcon('trucks'), 'truck');
  assert.equal(nearestIcon('Thumbs Up'), 'thumbs-up');
  assert.equal(nearestIcon('shopping-cart'), 'cart');
  assert.equal(nearestIcon('settings'), 'gear');
  assert.equal(nearestIcon('megamaxx', [...ICON_NAMES, 'megamax']), 'megamax');
  assert.equal(nearestIcon('xyz', ICON_NAMES, 'star'), 'star');
  assert.equal(nearestIcon('xyz', ICON_NAMES, 'not-an-icon'), ICON_NAMES[0]);
  assert.equal(nearestIcon('', ICON_NAMES, 'chat'), 'chat');
});

test('icon matching is deterministic: the same input gives the same answer', () => {
  for (const w of ['trucks', 'delivery van', 'xyz', 'Secure checkout', 'MegaMax tag']) {
    assert.equal(nearestIcon(w, ICON_NAMES, 'star'), nearestIcon(w, ICON_NAMES, 'star'), w);
    assert.equal(matchIcon(w, ICON_NAMES, ['megamax']), matchIcon(w, ICON_NAMES, ['megamax']), w);
  }
});

/* ---------- repairs ---------- */

test('a clean draft gives no repairs and the same document', () => {
  const draft = script();
  const { doc, repairs } = repair(draft);
  assert.deepEqual(repairs, []);
  assert.equal(JSON.stringify(doc), JSON.stringify(draft));
  assert.notEqual(doc, draft, 'a copy, never the draft itself');
});

test('an unknown icon becomes the nearest icon, or the kind default when nothing is near', () => {
  const draft = script(step('s2', { icon: 'trucks' }), step('s3', { icon: 'qqqq' }));
  const { doc, repairs } = repair(draft);
  assert.deepEqual(repairs, ['s2: icon "trucks" is not an icon; using truck', `s3: icon "qqqq" is not an icon; using ${beats.defaults.step.icon}`]);
  assert.deepEqual(doc.scenes.map((s) => s.icon).slice(1), ['chat', 'truck', beats.defaults.step.icon]);
  assert.equal(draft.scenes[2].icon, 'trucks', 'the draft itself is unchanged');
  assert.deepEqual(validateScript(doc, beats).errors, []);
  assert.deepEqual(repair(script(step('s2', { icon: 'megamaxx' })), { icons: [...ICON_NAMES, 'megamax'] }).repairs, ['s2: icon "megamaxx" is not an icon; using megamax']);
});

test('an off-list enum value is removed so the default applies; a required one stays an error', () => {
  const { doc, repairs } = repair(script(step('s2', { theme: 'blue', pace: 'fast' })));
  assert.deepEqual(repairs, ['s2: pace "fast" is not quick|normal|focus; removed', 's2: theme "blue" is not light|dark|accent; removed']);
  assert.ok(!('theme' in doc.scenes[2]) && !('pace' in doc.scenes[2]));
  assert.deepEqual(validateScript(doc, beats).errors, []);
  const strict = { sequence: [{ kind: ['a'], min: 1, max: 1 }], fields: { a: { required: ['vo', 'mode'], optional: [] } }, limits: { voWords: 10 }, enums: { mode: ['x', 'y'] } };
  const kept = repairScript({ scenes: [{ id: 'a1', kind: 'a', vo: 'Hi.', mode: 'z' }] }, strict);
  assert.deepEqual(kept.repairs, []);
  assert.equal(kept.doc.scenes[0].mode, 'z');
});

test('scenes over a slot maximum are dropped, the later ones, unless a later slot takes their kind', () => {
  const body = Array.from({ length: 12 }, (_, i) => step(`s${i + 1}`)).slice(1);
  const cta = { id: 'end', kind: 'cta', vo: 'Try it.', title: 'Try it', button: 'Start' };
  const { doc, repairs } = repair(script(...body, cta));
  assert.deepEqual(repairs, [`dropped 2 scene(s) over the 10 of kind ${BODY} the template takes: s11, s12`]);
  assert.deepEqual(doc.scenes.map((s) => s.id), ['intro', ...Array.from({ length: 10 }, (_, i) => `s${i + 1}`), 'end']);
  assert.deepEqual(validateScript(doc, beats).errors, []);
  const twoTitles = repair({ scenes: [{ id: 't1', kind: 'title', vo: 'A.', title: 'A' }, { id: 't2', kind: 'title', vo: 'B.', title: 'B' }, step('s1')] });
  assert.deepEqual(twoTitles.repairs, ['dropped 1 scene(s) over the 1 of kind title the template takes: t2']);
  const later = { sequence: [{ kind: ['a'], min: 1, max: 1 }, { kind: ['b'], min: 0, max: 1 }, { kind: ['a'], min: 0, max: 1 }], fields: { a: { required: ['vo'], optional: [] }, b: { required: ['vo'], optional: [] } }, limits: { voWords: 10 } };
  assert.deepEqual(repairScript({ scenes: [{ id: 'a1', kind: 'a', vo: 'x' }, { id: 'a2', kind: 'a', vo: 'y' }] }, later).repairs, []);
});

test('missing, invalid and duplicate scene ids become <kind>-<n>, never an id another scene holds', () => {
  const draft = script(step('Step 3!'), step(undefined), step('s1'));
  delete draft.scenes[3].id;
  const { doc, repairs } = repair(draft);
  assert.deepEqual(repairs, ['scene 3: id "Step 3!" is now step-3', 'scene 4: missing id is now step-4', 'scene 5: duplicate id "s1" is now step-5']);
  assert.deepEqual(doc.scenes.map((s) => s.id), ['intro', 's1', 'step-3', 'step-4', 'step-5']);
  assert.deepEqual(validateScript(doc, beats).errors, []);
  const taken = { scenes: [{ id: 'intro', kind: 'title', vo: 'Hi.', title: 'Hi' }, step(undefined), step('step-2')] };
  delete taken.scenes[1].id;
  assert.deepEqual(repair(taken).repairs, ['scene 2: missing id is now step-3']);
});

test('words are never changed: ends are trimmed silently and an over-limit title stays an error with its cut', () => {
  const { doc, repairs } = repair(script(step('s2', { title: '  Approve  ', vo: ' Then you approve. ' })));
  assert.deepEqual(repairs, []);
  assert.deepEqual([doc.scenes[2].title, doc.scenes[2].vo], ['Approve', 'Then you approve.']);
  const long = repair(script(step('s2', { title: 'x'.repeat(50) })));
  assert.equal(long.doc.scenes[2].title, 'x'.repeat(50));
  assert.deepEqual(validateScript(long.doc, beats).errors, ['s2: title is 50 chars, limit 44: cut 6']);
});

test('a locked field is left to the merge: the person\'s valid icon and theme come back, unreported', () => {
  const existing = { ...script(step('s2', { icon: 'shield', theme: 'dark' })), locks: { 'scene:s2.icon': lock, 'scene:s2.theme': lock } };
  const draft = script(step('s2', { icon: 'unicorn', theme: 'blue' }), step('s3', { icon: 'trucks' }));
  const { doc: fixed, repairs } = repair(draft, { existing });
  assert.deepEqual(repairs, ['s3: icon "trucks" is not an icon; using truck']);
  assert.deepEqual([fixed.scenes[2].icon, fixed.scenes[2].theme], ['unicorn', 'blue']);
  const { doc, kept } = mergeRespectingLocks('script', existing, fixed);
  assert.deepEqual(kept.sort(), ['scene:s2.icon', 'scene:s2.theme']);
  assert.deepEqual([doc.scenes[2].icon, doc.scenes[2].theme], ['shield', 'dark']);
  assert.deepEqual(validateScript(doc, beats).errors, []);
});

test('a locked scene order leaves ids and scene counts to the merge', () => {
  const existing = { ...script(), locks: { scenes: lock } };
  const draft = script(step('s1'));
  assert.deepEqual(repair(draft, { existing }).repairs, []);
});

/* ---------- commit ---------- */

const P = 'zz-test-repair';
const ID = 'repair-16x9';
function seedJob(t) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  setStatus(P, ID, { status: 'scripting', step: 3 }, 'test');
}

test('a commit reports its repairs in the result and in status.history, and writes the repaired script', (t) => {
  seedJob(t);
  writeJson(jobFile(P, ID, 'script.draft.json'), script(step('s2', { icon: 'trucks', theme: 'blue' })));
  const r = commit(P, ID, 'script', 'director');
  const repairs = ['s2: icon "trucks" is not an icon; using truck', 's2: theme "blue" is not light|dark|accent; removed'];
  assert.deepEqual(r, { kept: [], repairs });
  const saved = readJson(jobFile(P, ID, 'script.json'));
  assert.equal(saved.scenes[2].icon, 'truck');
  assert.ok(!('theme' in saved.scenes[2]));
  const st = getStatus(P, ID);
  assert.equal(st.status, 'scripted');
  assert.equal(st.history.at(-1).event, `script.json committed, repaired: ${repairs.join('; ')}`);
  writeJson(jobFile(P, ID, 'script.draft.json'), script());
  assert.deepEqual(commit(P, ID, 'script', 'director'), { kept: [], repairs: [] });
  assert.equal(getStatus(P, ID).history.at(-1).event, 'script.json committed');
});

test('an invalid draft is refused with the cut and the repairs, and writes nothing', (t) => {
  seedJob(t);
  writeJson(jobFile(P, ID, 'script.draft.json'), script(step('s2', { icon: 'trucks', title: 'x'.repeat(50) })));
  assert.throws(() => commit(P, ID, 'script', 'director'), (e) => e.code === 400
    && e.message.includes('s2: title is 50 chars, limit 44: cut 6')
    && e.message.includes('Repaired before this check (fix these in the draft too):\n- s2: icon "trucks" is not an icon; using truck'));
  assert.ok(!fs.existsSync(jobFile(P, ID, 'script.json')));
  assert.equal(getStatus(P, ID).status, 'scripting');
});

test('the API worker\'s commit result lists the repairs, and leaves them out when there are none', async (t) => {
  seedJob(t);
  const commitTool = toolsFor({ project: P, job: ID, by: 'director-test', g: loadStudioConfig().director.api, runPrepare: async () => {} }).find((x) => x.name === 'commit');
  writeJson(jobFile(P, ID, 'script.draft.json'), script(step('s2', { icon: 'trucks' })));
  assert.deepEqual(await commitTool.run({ kind: 'script' }), { status: 'scripted', kept: [], repairs: ['s2: icon "trucks" is not an icon; using truck'] });
  writeJson(jobFile(P, ID, 'script.draft.json'), script());
  assert.deepEqual(await commitTool.run({ kind: 'script' }), { status: 'scripted', kept: [] });
});
