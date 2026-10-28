import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DIRS, ROOT, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, getStatus, jobFile, briefFile, loadTemplate, listTemplates, humanEdit } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { pacing } from '../engine/review.mjs';
import { commit, sizeFor } from '../engine/pipeline.mjs';
import { validateOutline, expandOutline, OUTLINE, DEFAULT_MOOD } from '../engine/quick.mjs';
import { ICON_NAMES } from '../motion-kit/icons.mjs';

const { dir: EX_DIR, beats: EX } = loadTemplate('explainer');
const TIMING = loadStudioConfig().timing;
const BRAND = validateBrand({
  name: 'Quick Co', logoText: 'quick',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' },
});
const SOURCE = {
  name: 'MegaMax Classic',
  bullets: [
    { text: 'MegaMax Classic is back', ref: 'https://example.com/megamax' },
    { text: 'Up to 12 hours dry', ref: 'https://example.com/megamax' },
    { text: 'Free shipping on every order over $30', ref: 'https://example.com/shipping' },
    { text: 'Rated 4.8 by parents', ref: 'https://example.com/reviews' },
    { text: 'Soft cotton feel', ref: 'https://example.com/megamax' },
  ],
  facts: [{ text: '30-day returns, no questions', ref: 'brief.facts[0]' }],
};
// Text of exactly n characters (spaces inside, none at the ends) and a voice line of exactly n words.
const chars = (n) => `${'abcd '.repeat(Math.ceil(n / 5)).slice(0, n - 1)}z`;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const outline = () => ({
  mood: 'energetic',
  headline: { text: 'MegaMax Classic is back', source: 'bullets[0]' },
  points: [
    { label: 'Absorbency', text: 'Up to 12 hours dry', say: 'Twelve hours of protection, day or night.', source: 'bullets[1]' },
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'Easy returns', text: '30 days, no questions', source: 'facts[0]' },
  ],
  cta: { text: 'Try it today', button: 'Shop now' },
});
const minimal = () => ({
  headline: { text: 'MegaMax Classic is back' },
  points: [
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'Easy returns', text: '30 days, no questions', source: 'facts[0]' },
  ],
});
// Five points, every field at its explainer limit (title 44, text 110, button 24 characters; 34 voice words).
const maximal = () => ({
  lang: 'en', mood: 'premium',
  headline: { text: chars(44), say: words(34), source: 'bullets[0]' },
  points: [0, 1, 2, 3, 4].map((i) => ({ label: chars(44), text: chars(110), say: words(34), source: `bullets[${i}]` })),
  cta: { text: chars(44), button: chars(24), say: words(34), source: 'facts[0]' },
});
const check = (o) => validateOutline(o, EX, { source: SOURCE });
const expand = (o, opts) => expandOutline(o, EX, opts).script;
const repeats = (script) => pacing(estimateTiming(script, TIMING), script).scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id);

/* ---------- the outline check ---------- */

test('a maximal and a minimal outline pass the outline check and expand to a script the explainer accepts', () => {
  for (const o of [maximal(), minimal(), outline()]) {
    assert.deepEqual(check(o), { errors: [], warnings: [] });
    const r = validateScript(expand(o), EX);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  }
});

test('outline errors name the outline field, the template field it lands in, the limit and the cut', () => {
  const o = outline();
  o.points[0].text = chars(115);
  o.points[1].label = chars(50);
  o.points[0].say = words(40);
  o.points[1].source = 'bullets[9]';
  o.points[2].source = 'page 3';
  o.mood = 'happy';
  o.cta.button = chars(30);
  assert.deepEqual(check(o).errors, [
    'mood "happy" is not one of calm, energetic, premium, bold',
    'points[0].text is 115 characters, limit 110 (explainer step text): cut 5',
    'points[0].say has 40 words, limit 34 (explainer step voice line): cut 6',
    'points[1].source "bullets[9]" is not in source.json (it has bullets[0-4], facts[0])',
    'points[1].label is 50 characters, limit 44 (explainer step title): cut 6',
    'points[2].source must name a source.json line: "bullets[n]" or "facts[n]"',
    'cta.button is 30 characters, limit 24 (explainer cta button): cut 6',
  ]);
});

test('point counts, required fields and a missing source.json are errors; fields explainer does not show are warnings', () => {
  const six = outline();
  six.points = [...six.points, ...outline().points];
  assert.deepEqual(check(six).errors, ['points has 6 items, limit 5 (explainer): cut 1']);
  const one = outline();
  one.points = one.points.slice(0, 1);
  assert.deepEqual(check(one).errors, ['points has 1 item(s), at least 2 (explainer): add 1']);
  const holes = outline();
  delete holes.points[0].label;
  holes.points[1].text = '  ';
  delete holes.cta.button;
  delete holes.headline;
  assert.deepEqual(check(holes).errors, ['headline is required: { "text": "..." }', 'points[0].label is required', 'points[1].text is required', 'cta.button is required']);
  assert.deepEqual(validateOutline(outline(), EX, {}).errors, ['Commit source.json first: every point names the source.json bullet or fact it comes from']);
  assert.match(validateOutline(outline(), { id: 'lower-third' }).errors[0], /Template lower-third has no quick mode: write script\.draft\.json instead/);
  const extra = outline();
  extra.title = 'x';
  extra.points[0].tag = '12 h';
  extra.points[1].number = { value: 30, unit: '$' };
  extra.points[2].why = 'x';
  assert.deepEqual(check(extra), {
    errors: [],
    warnings: [
      'title is not an outline field; ignored',
      'points[0].tag is not shown by explainer; ignored',
      'points[1].number is not shown by explainer; ignored',
      'points[2].why is not an outline field; ignored',
    ],
  });
});

/* ---------- expansion ---------- */

test('expansion copies the outline into stable scenes: open, point-N, close, each with its source, themes cycled, icons matched', () => {
  const o = outline();
  const { script, notes } = expandOutline(o, EX);
  const expected = {
    template: 'explainer', look: 'energetic', generated: 'outline',
    scenes: [
      { id: 'open', kind: 'title', title: 'MegaMax Classic is back', vo: 'MegaMax Classic is back', source: 'bullets[0]' },
      { id: 'point-1', kind: 'step', title: 'Absorbency', text: 'Up to 12 hours dry', vo: 'Twelve hours of protection, day or night.', source: 'bullets[1]', theme: 'light', icon: 'drop' },
      { id: 'point-2', kind: 'step', title: 'Free shipping', text: 'On every order over $30', vo: 'On every order over $30', source: 'bullets[2]', theme: 'dark', icon: 'truck' },
      { id: 'point-3', kind: 'step', title: 'Easy returns', text: '30 days, no questions', vo: '30 days, no questions', source: 'facts[0]', theme: 'accent', icon: 'return' },
      { id: 'close', kind: 'cta', title: 'Try it today', button: 'Shop now', vo: 'Try it today' },
    ],
  };
  assert.equal(JSON.stringify(script), JSON.stringify(expected), 'same fields in the same order');
  assert.deepEqual(notes, ['look energetic (the mood)', 'point-1: icon drop (keyword match)', 'point-2: icon truck (keyword match)', 'point-3: icon return (keyword match)']);
  assert.deepEqual(o, outline(), 'the outline is not changed');
});

test('the same outline expands to the same script byte for byte, and builds in every explainer format', async () => {
  const { build } = await import(pathToFileURL(path.join(EX_DIR, 'template.mjs')).href);
  for (const o of [maximal(), minimal()]) {
    const a = JSON.stringify(expandOutline(o, EX));
    assert.equal(JSON.stringify(expandOutline(structuredClone(o), EX)), a);
    const script = JSON.parse(a).script;
    for (const format of EX.formats) {
      const html = build({ brief: { format }, brand: BRAND, script, timing: estimateTiming(script, TIMING), size: sizeFor(EX, format), icons: {} });
      for (const s of script.scenes) assert.ok(html.includes(`id="g-${s.id}"`), `${format}: ${s.id}`);
    }
  }
});

test('ends of the outline text are trimmed, the words never change', () => {
  const o = minimal();
  o.points[0].label = '  Free shipping ';
  o.points[0].say = ' Free shipping, every order.  ';
  const sc = expand(o).scenes[1];
  assert.deepEqual([sc.title, sc.vo, sc.text], ['Free shipping', 'Free shipping, every order.', 'On every order over $30']);
});

test('themes alternate over the points, so five steps carry no same-layout flag; without them they would', () => {
  const script = expand(maximal());
  assert.deepEqual(script.scenes.filter((s) => s.kind === 'step').map((s) => s.theme), ['light', 'dark', 'accent', 'light', 'dark']);
  assert.deepEqual(repeats(script), []);
  const flat = structuredClone(script);
  for (const s of flat.scenes) delete s.theme;
  assert.deepEqual(repeats(flat), ['point-3', 'point-4', 'point-5'], 'the theme rule is what ends the run');
});

test('the mood sets the look; premium and bold open on the dark theme; no mood is calm', () => {
  const look = (mood) => {
    const o = minimal();
    if (mood) o.mood = mood;
    const s = expand(o);
    return [s.look, s.scenes[0].theme];
  };
  assert.equal(DEFAULT_MOOD, 'calm');
  assert.deepEqual(look(), ['calm', undefined]);
  assert.deepEqual(look('energetic'), ['energetic', undefined]);
  assert.deepEqual(look('premium'), ['premium', 'dark']);
  assert.deepEqual(look('bold'), ['bold', 'dark']);
  assert.equal(expand({ ...minimal(), lang: 'vi' }).lang, 'vi');
  assert.equal('lang' in expand(minimal()), false, 'no lang given: prepare uses the brief and brand voice');
});

test('icons: the outline\'s own, then a brand icon named in the point, then keywords, then the fallback cycle without repeats', () => {
  const o = minimal();
  o.points = [
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'MegaMax inside', text: 'The same core as always', source: 'bullets[0]' },
    { label: 'Fast delivery', text: 'At your door in two days', source: 'bullets[2]' },
    { label: 'Night mode', text: 'Sleep through', icon: 'moon', source: 'bullets[1]' },
    { label: 'Zzz', text: 'Qqq', source: 'bullets[4]' },
  ];
  const icons = [...ICON_NAMES, 'megamax'];
  const { script, notes } = expandOutline(o, EX, { icons, brandIcons: ['megamax'] });
  assert.deepEqual(script.scenes.filter((s) => s.kind === 'step').map((s) => s.icon), ['truck', 'megamax', 'star', 'moon', 'sparkle']);
  assert.deepEqual(notes.slice(1), [
    'point-1: icon truck (keyword match)',
    'point-2: icon megamax (brand icon named in the point)',
    'point-3: icon star (fallback, truck is on an earlier point)',
    'point-4: icon moon (from the outline)',
    'point-5: icon sparkle (fallback, no keyword matched)',
  ]);
  assert.deepEqual(validateScript(script, EX, { icons }).errors, []);
  assert.equal(expand(o).scenes[2].icon, 'bolt', 'without the brand icon the second point falls to the cycle');
});

test('every template with a quick block fills each mapped kind\'s required fields from a required outline field or the engine', () => {
  const quick = listTemplates().filter((b) => b.quick);
  assert.ok(quick.some((b) => b.id === 'explainer'));
  for (const b of quick) {
    const q = b.quick;
    assert.ok(q.open && q.point, `${b.id}: quick needs open and point`);
    const slot = b.sequence.find((s) => s.kind.includes(q.point.kind));
    assert.ok(q.points[0] >= 1 && q.points[0] <= q.points[1] && q.points[1] <= slot.max, `${b.id}: points within the body slot`);
    assert.ok((q.icons || []).every((n) => ICON_NAMES.includes(n)), `${b.id}: fallback icons are built-ins`);
    for (const [k, cycle] of Object.entries(q.vary || {})) {
      assert.ok(cycle.length && cycle.every((v) => b.enums[k]?.includes(v)), `${b.id}: vary.${k} values are in enums.${k}`);
    }
    for (const [part, spec] of Object.entries(OUTLINE)) {
      const map = q[part];
      if (!map) continue;
      const f = b.fields[map.kind];
      assert.ok(f, `${b.id}.quick.${part}: no kind ${map.kind}`);
      const takes = [...f.required, ...f.optional];
      // say falls back to the required text; a source the kind requires is required in the outline too.
      const filled = new Set(part === 'point' ? Object.keys(q.vary || {}) : []);
      for (const [from, to] of Object.entries(map)) {
        if (from === 'kind') continue;
        assert.ok([...spec.fields, 'theme'].includes(from), `${b.id}.quick.${part}.${from} is not an outline field`);
        assert.ok(takes.includes(to), `${b.id}.quick.${part}.${from}: ${map.kind} has no field ${to}`);
        if (spec.required.includes(from) || ['say', 'source', 'icon', 'theme'].includes(from)) filled.add(to);
      }
      for (const r of f.required) assert.ok(filled.has(r), `${b.id}: ${map.kind}.${r} is filled by no required outline field`);
    }
  }
});

/* ---------- cli commit … outline ---------- */

const P = 'zz-test-quick';
const ID = 'quick-16x9';
const DRAFT = () => jobFile(P, ID, 'outline.draft.json');
function seedJob(t) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  saveBrief(validateBrief({ id: ID, project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' }));
  setStatus(P, ID, { status: 'scripting', step: 4 }, 'test');
  writeJson(jobFile(P, ID, 'source.json'), { ...SOURCE, locks: {} });
}

test('commit outline writes script.json, then outline.json, and reports like a script commit', (t) => {
  seedJob(t);
  writeJson(DRAFT(), outline());
  const r = commit(P, ID, 'outline', 'director');
  assert.deepEqual(r, { kept: [], repairs: [], warnings: [], notes: expandOutline(outline(), EX).notes });
  const script = readJson(jobFile(P, ID, 'script.json'));
  assert.deepEqual(script, { ...expand(outline()), locks: {} });
  assert.deepEqual(readJson(jobFile(P, ID, 'outline.json')), outline());
  assert.equal(fs.existsSync(DRAFT()), false);
  const st = getStatus(P, ID);
  assert.deepEqual([st.status, st.step, st.dirty_from], ['scripted', 5, null]);
  assert.equal(st.history.at(-1).event, 'script.json committed from outline (quick mode), look energetic');
});

test('a person\'s point title and look survive the next outline commit', (t) => {
  seedJob(t);
  writeJson(DRAFT(), outline());
  commit(P, ID, 'outline', 'director');
  const first = readJson(jobFile(P, ID, 'script.json'));
  const edited = structuredClone(first);
  edited.scenes[2].title = 'Ships free';
  edited.look = 'bold';
  writeJson(jobFile(P, ID, 'script.json'), humanEdit('script', first, edited, 'person').doc);
  const next = outline();
  next.points[0].label = 'All-day dry';
  next.points[1].label = 'Shipping is free';
  writeJson(DRAFT(), next);
  const r = commit(P, ID, 'outline', 'director');
  assert.deepEqual(r.kept, ['scene:point-2.title', 'look']);
  const script = readJson(jobFile(P, ID, 'script.json'));
  assert.deepEqual([script.scenes[1].title, script.scenes[2].title, script.look], ['All-day dry', 'Ships free', 'bold']);
  assert.deepEqual(Object.keys(script.locks).sort(), ['look', 'scene:point-2.title']);
  assert.deepEqual(readJson(jobFile(P, ID, 'outline.json')), next);
  assert.equal(getStatus(P, ID).history.at(-1).event, 'script.json committed from outline (quick mode), look bold, kept locked: scene:point-2.title, look');
});

test('an outline over a limit changes nothing: no outline.json, the script as it was, the draft kept', (t) => {
  seedJob(t);
  const bad = outline();
  bad.points[0].text = chars(115);
  writeJson(DRAFT(), bad);
  const refused = (e) => e.code === 400 && e.message.startsWith('Outline invalid:\n- ') && e.message.includes('points[0].text is 115 characters, limit 110 (explainer step text): cut 5');
  assert.throws(() => commit(P, ID, 'outline', 'director'), refused);
  assert.equal(fs.existsSync(jobFile(P, ID, 'outline.json')), false);
  assert.equal(fs.existsSync(jobFile(P, ID, 'script.json')), false);
  writeJson(DRAFT(), outline());
  commit(P, ID, 'outline', 'director');
  const before = fs.readFileSync(jobFile(P, ID, 'script.json'), 'utf8');
  writeJson(DRAFT(), bad);
  assert.throws(() => commit(P, ID, 'outline', 'director'), refused);
  assert.equal(fs.readFileSync(jobFile(P, ID, 'script.json'), 'utf8'), before);
  assert.deepEqual(readJson(jobFile(P, ID, 'outline.json')), outline());
  assert.ok(fs.existsSync(DRAFT()), 'the draft stays for the Director to fix');
  assert.equal(getStatus(P, ID).status, 'scripted');
});

test('an outline commit needs source.json and refuses a mixed brief; a script draft still commits on a quick job', (t) => {
  seedJob(t);
  fs.rmSync(jobFile(P, ID, 'source.json'));
  writeJson(DRAFT(), outline());
  assert.throws(() => commit(P, ID, 'outline', 'director'), (e) => e.code === 400 && e.message.includes('Commit source.json first'));
  writeJson(jobFile(P, ID, 'source.json'), { ...SOURCE, locks: {} });
  commit(P, ID, 'outline', 'director');
  const full = readJson(jobFile(P, ID, 'script.json'));
  full.scenes[1].title = 'Dry all day';
  delete full.locks;
  writeJson(jobFile(P, ID, 'script.draft.json'), full);
  assert.deepEqual(commit(P, ID, 'script', 'director'), { kept: [], repairs: [] });
  assert.equal(readJson(jobFile(P, ID, 'script.json')).scenes[1].title, 'Dry all day');
  assert.equal(getStatus(P, ID).history.at(-1).event, 'script.json committed');
  writeJson(briefFile(P, ID), { ...readJson(briefFile(P, ID)), mix: ['data-story'] });
  writeJson(DRAFT(), outline());
  assert.throws(() => commit(P, ID, 'outline', 'director'), (e) => e.code === 400 && e.message === 'Quick mode does not take a mix: write script.draft.json instead.');
  assert.throws(() => commit(P, ID, 'notes', 'director'), (e) => e.code === 400 && e.message === 'kind must be source, script or outline');
});

test('cli commit <project> <job> outline prints the report as JSON; a refused outline exits 1 naming the cut', (t) => {
  seedJob(t);
  const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: 'pipe' });
  writeJson(DRAFT(), outline());
  const r = JSON.parse(cli('commit', P, ID, 'outline', '--by', 'tester'));
  assert.deepEqual(Object.keys(r), ['kept', 'repairs', 'warnings', 'notes']);
  assert.equal(getStatus(P, ID).history.at(-1).by, 'tester');
  const bad = outline();
  bad.points[2].label = chars(47);
  writeJson(DRAFT(), bad);
  assert.throws(() => cli('commit', P, ID, 'outline'), (e) => e.status === 1 && String(e.stderr).includes('points[2].label is 47 characters, limit 44 (explainer step title): cut 3'));
});
