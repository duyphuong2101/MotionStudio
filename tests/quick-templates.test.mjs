// Quick mode on product-demo and social-teaser (plan quick-video T14): the number → stat mapping, the tag fallback,
// the opening picture from source.image, decor cycling, the "same layout" warning, and a build of every format.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, getStatus, jobFile, loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { pacing } from '../engine/review.mjs';
import { commit, sizeFor } from '../engine/pipeline.mjs';
import { LOOK_NAMES, lookBrand } from '../engine/looks.mjs';
import { validateOutline, expandOutline, quickRules } from '../engine/quick.mjs';

const PD = loadTemplate('product-demo');
const ST = loadTemplate('social-teaser');
const TIMING = loadStudioConfig().timing;
const BRAND = validateBrand({
  name: 'Quick Co', logoText: 'quick',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' },
});
const SOURCE = {
  name: 'MegaMax Classic', image: 'pack.png',
  bullets: [
    { text: 'MegaMax Classic is back', ref: 'https://example.com/megamax' },
    { text: 'Up to 12 hours dry', ref: 'https://example.com/megamax' },
    { text: 'Free shipping on every order over $30', ref: 'https://example.com/shipping' },
    { text: 'Rated 4.8 by parents', ref: 'https://example.com/reviews' },
    { text: 'Soft cotton feel', ref: 'https://example.com/megamax' },
  ],
  facts: [{ text: '30-day returns, no questions', ref: 'brief.facts[0]' }],
};
const ASSETS = ['pack.png', 'logo.svg'];
const chars = (n) => `${'abcd '.repeat(Math.ceil(n / 5)).slice(0, n - 1)}z`;
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// The plan's Data design example: a number on the first point only.
const pd = () => ({
  mood: 'energetic',
  headline: { text: 'MegaMax Classic is back', source: 'bullets[0]' },
  points: [
    { label: 'Absorbency', text: 'Up to 12 hours dry', tag: '12 h', say: 'Twelve hours of protection, day or night.', number: { value: 12, unit: 'h' }, source: 'bullets[1]' },
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'Easy returns', text: '30 days, no questions', icon: 'return', source: 'facts[0]' },
  ],
  cta: { text: 'Try it today', button: 'Shop now', say: 'Try it today.' },
});
// Each figure is the one its source line states.
const FIGURES = { 'bullets[1]': { value: 12, unit: 'h' }, 'bullets[2]': { value: 30, unit: '$' }, 'bullets[3]': { value: 4.8 } };
// Every field at its limit for the template; numbers on the first, third and fifth point (stat, benefit, stat, …).
const maximal = (beats) => {
  const L = beats.limits, n = beats.quick.points[1];
  const refs = ['bullets[1]', 'bullets[4]', 'bullets[3]', 'bullets[0]', 'bullets[2]'];
  return {
    lang: 'en', mood: 'premium',
    headline: { text: chars(L.title), say: words(L.voWords), source: 'bullets[0]' },
    points: refs.slice(0, n).map((source, i) => ({
      label: chars(L.kicker), text: chars(L.text), tag: chars(L.chip), say: words(L.voWords), source,
      ...(i % 2 === 0 ? { number: FIGURES[source] } : {}),
    })),
    cta: { text: chars(L.title), button: chars(L.button), say: words(L.voWords), source: 'facts[0]' },
  };
};
const minimal = (beats) => ({
  headline: { text: 'MegaMax Classic is back', source: 'bullets[0]' },
  points: [
    { label: 'Free shipping', text: 'On every order over $30', source: 'bullets[2]' },
    { label: 'Easy returns', text: '30 days, no questions', source: 'facts[0]' },
  ].slice(0, beats.quick.points[0]),
  cta: { text: 'Try it today', button: 'Shop now' },
});
const check = (o, beats = PD.beats) => validateOutline(o, beats, { source: SOURCE });
const expand = (o, beats = PD.beats, opts = { source: SOURCE, assets: ASSETS }) => expandOutline(o, beats, opts);
const repeats = (script) => pacing(estimateTiming(script, TIMING), script).scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id);
const SAME = /make \d+ \w+ scenes in a row, which the pacing flags "same layout"/;

/* ---------- both templates: valid outlines, determinism, builds ---------- */

for (const { beats } of [PD, ST]) {
  test(`${beats.id}: a maximal and a minimal outline pass and expand to a script the template accepts`, () => {
    for (const o of [maximal(beats), minimal(beats)]) {
      assert.deepEqual(check(o, beats), { errors: [], warnings: [] });
      const r = validateScript(expand(o, beats).script, beats, { assets: ASSETS });
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, []);
    }
  });

  test(`${beats.id}: the same outline expands byte for byte, and builds in every format with every look`, async () => {
    const { dir } = beats.id === PD.beats.id ? PD : ST;
    const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    for (const o of [maximal(beats), minimal(beats)]) {
      const a = JSON.stringify(expand(o, beats));
      assert.equal(JSON.stringify(expand(structuredClone(o), beats)), a);
      const { script } = JSON.parse(a);
      const timing = estimateTiming(script, TIMING);
      for (const look of LOOK_NAMES) {
        for (const format of beats.formats) {
          const html = build({ brief: { format }, brand: lookBrand(look, BRAND), script, timing, size: sizeFor(beats, format), icons: {} });
          for (const s of script.scenes) assert.ok(html.includes(`id="g-${s.id}"`), `${look} ${format}: ${s.id}`);
        }
      }
    }
  });

  test(`${beats.id}: the example outline in the quick context passes, and every point field is listed with its limit`, () => {
    const r = quickRules(beats);
    assert.deepEqual(check(r.shape, beats), { errors: [], warnings: [] });
    assert.equal(r.cta, 'required');
    assert.equal(r.fields['points[].tag'], `optional: max ${beats.limits.chip} chars (~${Math.floor(beats.limits.chip / 6)} words), default the label`);
    assert.equal(r.fields['points[].number'], 'optional: { "value": 12, "unit": "h" }, unit max 4 chars, only a figure its source line states; the point then shows as a stat');
    assert.equal(r.fields['headline.source'], 'required: bullets[n] or facts[n]', 'the hero needs a source');
  });
}

/* ---------- product-demo ---------- */

test('product-demo: the quick context lists each outline field with the product-demo limit', () => {
  assert.deepEqual(quickRules(PD.beats).fields, {
    mood: 'optional: one of moods, default calm',
    lang: 'optional: language code, default the brief\'s',
    'headline.text': 'required: max 30 chars (~5 words)',
    'headline.say': 'optional spoken line: max 24 words, default the text',
    'headline.source': 'required: bullets[n] or facts[n]',
    'points[].label': 'required: max 20 chars (~3 words)',
    'points[].text': 'required: max 72 chars (~12 words)',
    'points[].tag': 'optional: max 26 chars (~4 words), default the label',
    'points[].say': 'optional spoken line: max 24 words, default the text',
    'points[].icon': 'optional: one of icons, default matched',
    'points[].source': 'required: bullets[n] or facts[n]',
    'points[].number': 'optional: { "value": 12, "unit": "h" }, unit max 4 chars, only a figure its source line states; the point then shows as a stat',
    'cta.text': 'required: max 30 chars (~5 words)',
    'cta.button': 'required: max 22 chars (~3 words)',
    'cta.say': 'optional spoken line: max 24 words, default the text',
    'cta.source': 'optional: bullets[n] or facts[n]',
  });
});

test('product-demo: a point with a number becomes a stat scene; the others are benefits with the decor cycled', () => {
  const o = pd();
  const { script, notes } = expand(o);
  const [open, p1, p2, p3, close] = script.scenes;
  assert.deepEqual(script.scenes.map((s) => [s.id, s.kind]), [['open', 'hero'], ['point-1', 'stat'], ['point-2', 'benefit'], ['point-3', 'benefit'], ['close', 'cta']]);
  assert.deepEqual(open, { id: 'open', kind: 'hero', title: 'MegaMax Classic is back', vo: 'MegaMax Classic is back', source: 'bullets[0]', asset: 'pack.png' });
  assert.deepEqual({ ...p1, icon: undefined }, {
    id: 'point-1', kind: 'stat', kicker: 'Absorbency', stat: { value: 12, unit: 'h' }, text: 'Up to 12 hours dry', chip: '12 h',
    vo: 'Twelve hours of protection, day or night.', source: 'bullets[1]', icon: undefined,
  });
  assert.equal('decor' in p1, false, 'a stat takes no decor');
  assert.deepEqual([p2.decor, p3.decor], ['waves', 'none'], 'the decor cycles by the point\'s position');
  assert.equal(p3.icon, 'return');
  assert.deepEqual(close, { id: 'close', kind: 'cta', title: 'Try it today', button: 'Shop now', vo: 'Try it today.' });
  assert.ok(notes.includes('point-1: stat (it has a number)'));
  assert.ok(notes.includes('open: asset pack.png (source.image)'));
  p1.stat.value = 99;
  assert.deepEqual(o, pd(), 'the script shares no object with the outline');
  const five = expand(maximal(PD.beats)).script.scenes.filter((s) => s.id.startsWith('point-'));
  assert.deepEqual(five.map((s) => [s.kind, s.decor]), [['stat', undefined], ['benefit', 'waves'], ['stat', undefined], ['benefit', 'walls'], ['stat', undefined]]);
});

test('product-demo: a missing tag shows the label in the chip; a given tag shows itself', () => {
  const { script, notes } = expand(pd());
  assert.deepEqual(script.scenes.slice(1, 4).map((s) => s.chip), ['12 h', 'Free shipping', 'Easy returns']);
  assert.ok(notes.includes('point-2: chip shows the label (no tag)'));
  assert.equal(notes.some((n) => n.startsWith('point-1: chip')), false);
  const blankTag = pd();
  blankTag.points[1].tag = '  ';
  assert.equal(expand(blankTag).script.scenes[2].chip, 'Free shipping', 'a blank tag counts as none');
});

test('product-demo: source.image lands in the hero asset only when it is a listed .png, .jpg or .webp', () => {
  const hero = (source, assets = ASSETS) => {
    const { script, notes } = expand(pd(), PD.beats, { source, assets });
    return [script.scenes[0].asset, notes.filter((n) => n.startsWith('open:'))];
  };
  assert.deepEqual(hero(SOURCE), ['pack.png', ['open: asset pack.png (source.image)']]);
  assert.deepEqual(hero(SOURCE, ['logo.svg']), [undefined, ['open: asset none, source.image "pack.png" is not a .png, .jpg or .webp in the project assets']]);
  assert.deepEqual(hero({ ...SOURCE, image: 'logo.svg' }), [undefined, ['open: asset none, source.image "logo.svg" is not a .png, .jpg or .webp in the project assets']]);
  assert.deepEqual(hero({ ...SOURCE, image: null }), [undefined, []]);
  assert.deepEqual(hero(null), [undefined, []]);
  const { script } = expand(pd(), PD.beats, { source: SOURCE, assets: [] });
  assert.deepEqual(validateScript(script, PD.beats, { assets: [] }).errors, [], 'no listed image: no asset, still valid');
});

test('product-demo: outline errors name the field, where it lands (benefit or stat), the limit and the cut', () => {
  const o = pd();
  o.headline.text = chars(35);
  delete o.headline.source;
  o.points[0].number = { value: 12, unit: 'hours' };
  o.points[0].text = chars(80);
  o.points[1].label = chars(27);
  o.points[1].say = words(30);
  o.points[2].number = { value: '12' };
  o.points[2].tag = chars(30);
  assert.deepEqual(check(o).errors, [
    'headline.source is required',
    'headline.text is 35 characters, limit 30 (product-demo hero title): cut 5',
    'points[0].number.unit is 5 characters, limit 4 (product-demo stat unit): cut 1',
    'points[0].text is 80 characters, limit 72 (product-demo stat text): cut 8',
    'points[1].label is 27 characters, limit 20 (product-demo benefit kicker): cut 7',
    'points[1].label is 27 characters, limit 26 (product-demo benefit chip): cut 1',
    'points[1].say has 30 words, limit 24 (product-demo benefit voice line): cut 6',
    'points[2].number must be { "value": 12, "unit": "h" }: value a number its source line states, unit optional text',
    'points[2].tag is 30 characters, limit 26 (product-demo stat chip): cut 4',
  ]);
  const six = pd();
  six.points = [...six.points, ...pd().points];
  assert.deepEqual(check(six).errors, ['points has 6 items, limit 5 (product-demo): cut 1']);
  const extra = pd();
  extra.points[0].number.scale = 2;
  assert.match(check(extra).errors[0], /^points\[0\]\.number must be \{ "value": 12, "unit": "h" \}/);
});

test('product-demo: three or more points without a number warn "same layout" (a warning, not an error), naming the fix', () => {
  const none = pd();
  delete none.points[0].number;
  assert.deepEqual(check(none), {
    errors: [],
    warnings: ['points[0-2] make 3 benefit scenes in a row, which the pacing flags "same layout": give one of them a number its source line states, so it shows as a stat'],
  });
  assert.deepEqual(repeats(expand(none).script), ['point-3']);
  const stats = pd();
  stats.points[1].number = FIGURES['bullets[2]'];
  stats.points[2].number = { value: 30 };
  assert.deepEqual(check(stats).warnings, ['points[0-2] make 3 stat scenes in a row, which the pacing flags "same layout": leave the number off one of them, so it shows as a benefit']);
  assert.deepEqual(check(pd()), { errors: [], warnings: [] });
  assert.deepEqual(repeats(expand(pd()).script), []);
  assert.deepEqual(repeats(expand(maximal(PD.beats)).script), [], 'numbers on every other point: no run');
});

test('product-demo: the warning fires exactly when the pacing would flag a point, for every number pattern of 2-5 points', () => {
  const base = maximal(PD.beats).points;
  for (let n = 2; n <= 5; n++) {
    for (let mask = 0; mask < 2 ** n; mask++) {
      const o = maximal(PD.beats);
      o.points = base.slice(0, n).map((p, i) => {
        const q = { ...p };
        delete q.number;
        if (mask & (1 << i)) q.number = { value: 12, unit: 'h' };
        return q;
      });
      const { errors, warnings } = check(o);
      assert.deepEqual(errors, [], `${n}/${mask}`);
      const flagged = repeats(expand(o).script).length > 0;
      assert.equal(warnings.some((w) => SAME.test(w)), flagged, `${n} points, numbers ${mask.toString(2)}`);
    }
  }
});

/* ---------- social-teaser ---------- */

test('social-teaser: exactly one point, its own voice limit, and the number still makes a stat', () => {
  const two = minimal(ST.beats);
  two.points = minimal(PD.beats).points;
  assert.deepEqual(check(two, ST.beats).errors, ['points has 2 items, limit 1 (social-teaser): cut 1']);
  const none = minimal(ST.beats);
  none.points = [];
  assert.deepEqual(check(none, ST.beats).errors, ['points has 0 item(s), at least 1 (social-teaser): add 1']);
  const long = minimal(ST.beats);
  long.points[0].say = words(16);
  assert.deepEqual(check(long, ST.beats).errors, ['points[0].say has 16 words, limit 14 (social-teaser benefit voice line): cut 2']);
  const { script } = expand(maximal(ST.beats), ST.beats);
  assert.deepEqual(script.scenes.map((s) => s.kind), ['hero', 'stat', 'cta']);
  assert.equal(script.scenes[0].asset, 'pack.png');
  const plain = expand(minimal(ST.beats), ST.beats).script.scenes[1];
  assert.deepEqual([plain.kind, plain.chip, plain.decor], ['benefit', 'Free shipping', 'walls']);
});

/* ---------- cli commit … outline on a product-demo job ---------- */

const P = 'zz-test-quick-tpl';
const ID = 'pd-9x16';

test('commit outline on a product-demo job: the hero takes the listed source.image, the same-layout warning is reported', (t) => {
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  fs.mkdirSync(path.join(DIRS.profiles, P, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIRS.profiles, P, 'assets', 'pack.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  saveBrief(validateBrief({ id: ID, project: P, template: 'product-demo', format: '9:16', duration: 30, director: 'seat', message: 'm', quick: true }));
  setStatus(P, ID, { status: 'scripting', step: 4 }, 'test');
  writeJson(jobFile(P, ID, 'source.json'), { ...SOURCE, locks: {} });
  const o = pd();
  delete o.points[0].number;
  writeJson(jobFile(P, ID, 'outline.draft.json'), o);
  const r = commit(P, ID, 'outline', 'director');
  const warning = 'points[0-2] make 3 benefit scenes in a row, which the pacing flags "same layout": give one of them a number its source line states, so it shows as a stat';
  assert.deepEqual(r.warnings, [warning]);
  assert.ok(r.notes.includes('open: asset pack.png (source.image)'));
  const script = readJson(jobFile(P, ID, 'script.json'));
  assert.equal(script.scenes[0].asset, 'pack.png');
  assert.deepEqual(script.scenes.map((s) => s.kind), ['hero', 'benefit', 'benefit', 'benefit', 'cta']);
  const st = getStatus(P, ID);
  assert.equal(st.status, 'scripted');
  assert.ok(st.history.at(-1).event.endsWith(`, warnings: ${warning}`));
});
