import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  listTemplates, loadTemplate, loadBriefTemplate, validateBrief, saveBrief, updateBrief, loadBrief, jobFile,
} from '../engine/jobs.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { DIRS, loadStudioConfig, writeJson } from '../engine/core.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { MAX_MIX_EXTRAS, splitKind, isMixable, composeBeats, scopeCss, buildMixed } from '../engine/mix.mjs';

const rules = (id) => loadTemplate(id).beats;
const cfg = loadStudioConfig();
const BRAND = { name: 'Mix Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };

test('splitKind separates the template of a namespaced kind and leaves lead kinds bare', () => {
  assert.deepEqual(splitKind('data-story.bars'), { tpl: 'data-story', kind: 'bars' });
  assert.deepEqual(splitKind('title'), { tpl: '', kind: 'title' });
  assert.equal(MAX_MIX_EXTRAS, 3);
});

test('only templates that list mixable kinds can mix', () => {
  assert.ok(isMixable(rules('data-story')));
  assert.ok(!isMixable(rules('talking-head')));
  assert.throws(() => composeBeats(rules('explainer'), [rules('talking-head')]), /talking-head cannot be mixed in/);
  assert.throws(() => composeBeats(rules('product-demo'), [rules('data-story')]), /product-demo cannot be mixed in/);
});

test('composed formats are the intersection in the lead order; durations and frame stay the lead', () => {
  const lead = rules('testimonial');
  const c = composeBeats(lead, [{ ...rules('data-story'), formats: ['16:9', '9:16'] }]);
  assert.deepEqual(c.formats, ['9:16', '16:9']);
  assert.deepEqual(c.durations, lead.durations);
  assert.deepEqual(c.sizes, lead.sizes);
  assert.equal(c.mixed, true);
  assert.equal(c.lead, 'testimonial');
  assert.deepEqual(c.mix, ['data-story']);
  assert.equal(c.label, 'Testimonial + Data story');
});

test('body slots open to the extras kinds; title and cta slots do not', () => {
  const c = composeBeats(rules('explainer'), [rules('data-story'), rules('testimonial')]);
  const [title, body, cta] = c.sequence;
  assert.deepEqual(title.kind, ['title']);
  assert.deepEqual(cta.kind, ['cta']);
  for (const k of ['step', 'diagram', 'data-story.bars', 'data-story.stat', 'testimonial.quote', 'testimonial.stat']) assert.ok(body.kind.includes(k), k);
  assert.ok(!body.kind.includes('data-story.title') && !body.kind.includes('testimonial.cta'));
  assert.equal(body.max, rules('explainer').sequence[1].max);
});

test('extras fields, defaults and pace are keyed by namespaced kind; sources hold full rules', () => {
  const ds = rules('data-story'), tm = rules('testimonial');
  const c = composeBeats(rules('explainer'), [ds, tm]);
  assert.deepEqual(c.fields['data-story.bars'], ds.fields.bars);
  assert.deepEqual(c.fields.step, rules('explainer').fields.step);
  assert.deepEqual(c.defaults['testimonial.quote'], tm.defaults.quote);
  assert.deepEqual(c.pace.byKind['testimonial.quote'], tm.pace);
  assert.deepEqual(c.pace.quick, rules('explainer').pace.quick);
  assert.deepEqual(c.limits, rules('explainer').limits);
  assert.deepEqual(c.sources['data-story'], ds);
  assert.equal(c.sources['data-story'].limits.text, 90);
  assert.match(c.scene, /<template>\.<kind>/);
});

test('scopeCss prefixes every selector of a flat rule list', () => {
  assert.equal(scopeCss('.a,.b{x}.c .d{y}', '.t-x'), '.t-x .a,.t-x .b{x}.t-x .c .d{y}');
  assert.equal(scopeCss('\n.p::after{content:"";transform:rotate(-90deg)}', '.t-e'), '\n.t-e .p::after{content:"";transform:rotate(-90deg)}');
});

test('scopeCss refuses @ rules and nested blocks', () => {
  assert.throws(() => scopeCss('@media (max-width:1px){.a{x}}', '.t-x'), /@ rule/);
  assert.throws(() => scopeCss('.a{.b{x}}', '.t-x'), /flat rule list/);
});

/** A scene of `kind` filled from the composed defaults, as the UI's "add scene" makes it. */
const scene = (beats, kind, id, more = {}) => ({ id, kind, vo: 'One short line.', source: 'facts[0]', ...beats.defaults[kind], ...more });
const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
const explainerMix = (...extras) => composeBeats(rules('explainer'), extras.map(rules));

test('a mixed script with lead and extra kinds passes the composed rules', () => {
  const c = explainerMix('data-story');
  const script = { scenes: [scene(c, 'title', 't'), scene(c, 'step', 's1'), scene(c, 'data-story.bars', 'bars-1'), scene(c, 'cta', 'c')] };
  assert.deepEqual(validateScript(script, c).errors, []);
});

test('an extra kind outside the body slot is an unexpected scene', () => {
  const c = explainerMix('data-story');
  const script = { scenes: [scene(c, 'title', 't'), scene(c, 'step', 's1'), { id: 'dt', kind: 'data-story.title', vo: 'Hi.', title: 'Numbers' }] };
  assert.ok(validateScript(script, c).errors.some((e) => e.includes('unexpected scene "dt"')));
});

test('a kind from a template outside the mix names the mix', () => {
  const c = explainerMix('data-story');
  const script = { scenes: [scene(c, 'title', 't'), scene(c, 'step', 's1'), { id: 'q', kind: 'testimonial.quote', vo: 'Hi.', quote: 'Great.', author: 'Ana', source: 'facts[0]' }] };
  assert.ok(validateScript(script, c).errors.some((e) => e.includes("testimonial, which is not in this brief's mix")));
});

test('each scene follows the limits of its own template', () => {
  const c = explainerMix('data-story');
  const long = 'x'.repeat(95);
  const script = { scenes: [scene(c, 'title', 't'), scene(c, 'step', 's1', { text: long }), scene(c, 'data-story.stat', 'st', { text: long })] };
  const { errors } = validateScript(script, c);
  assert.deepEqual(errors, ['st: text is 95 chars, limit 90: cut 5']);
});

test('voice-line word limits come from the scene template', () => {
  const ds = composeBeats(rules('explainer'), [rules('data-story')]);
  const over = { scenes: [scene(ds, 'title', 't'), scene(ds, 'data-story.bars', 'b', { vo: words(35) })] };
  assert.ok(validateScript(over, ds).errors.includes('b: voice line has 35 words, limit 34: cut 1'));
  const ev = composeBeats(rules('event'), [rules('data-story')]);
  const script = { scenes: [scene(ev, 'poster', 'p'), scene(ev, 'data-story.bars', 'b', { vo: words(32) }), scene(ev, 'speakers', 'sp', { vo: words(32) })] };
  assert.deepEqual(validateScript(script, ev).errors, ['sp: voice line has 32 words, limit 30: cut 2']);
});

test('enums come from the scene template', () => {
  const c = explainerMix('data-story', 'testimonial');
  const script = { scenes: [scene(c, 'title', 't'), scene(c, 'data-story.stat', 'a', { format: 'money' }), scene(c, 'testimonial.stat', 'b', { format: 'money' })] };
  assert.deepEqual(validateScript(script, c).errors, ['b: format must be int|dec|pct']);
});

test('a mixed script times each scene with its own template pace table', () => {
  const c = explainerMix('testimonial');
  const script = { scenes: [{ id: 's', kind: 'step', vo: 'Hi.', pace: 'quick' }, { id: 'q', kind: 'testimonial.quote', vo: 'Hi.', pace: 'quick' }, { id: 'c', kind: 'cta', vo: 'Go.' }] };
  const t = estimateTiming(script, cfg.timing, 'en', c.pace);
  const dur = (id) => { const s = t.scenes.find((x) => x.id === id); return Math.round((s.end - s.start) * 100) / 100; };
  assert.equal(dur('s'), rules('explainer').pace.quick.minScene);
  assert.equal(dur('q'), rules('testimonial').pace.quick.minScene);
  assert.equal(dur('q'), 2.2);
});

/* ---------- one page from several renderers ---------- */
const mixedScript = (c) => ({ scenes: [
  scene(c, 'title', 'intro'), scene(c, 'step', 'how'), scene(c, 'data-story.bars', 'bars-1'),
  scene(c, 'testimonial.quote', 'quote-1'), scene(c, 'step', 'next'), scene(c, 'cta', 'end'),
] });

async function mixedPage() {
  const c = explainerMix('data-story', 'testimonial');
  const script = mixedScript(c);
  const timing = estimateTiming(script, cfg.timing, 'en', c.pace);
  return { c, script, html: await buildMixed({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(c, '16:9') }, c) };
}

test('buildMixed writes one page with one timeline and every scene of every template', async () => {
  const { c, script, html } = await mixedPage();
  assert.deepEqual(validateScript(script, c).errors, []);
  assert.equal(html.split('window.seek = ').length, 2);
  assert.equal(html.split('<canvas id="bgc"').length, 2);
  for (const sc of script.scenes) assert.ok(html.includes(`id="g-${sc.id}"`), sc.id);
  assert.ok(html.includes('.t-data-story .box{'));
  assert.ok(html.includes('<div class="tpl t-testimonial">'));
  assert.ok(html.includes('mixKinds("data-story.", ') && html.includes('mixKinds("testimonial.", ') && html.includes('mixKinds("", '));
  assert.ok(html.includes('"id":"bars-1","kind":"bars"') && html.includes('"tpl":"data-story"'));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no element id twice');
});

test('each template js sees its own kinds bare and other templates scenes namespaced', async () => {
  const { html } = await mixedPage();
  const src = html.match(/const MIX_LEAD = .*\nconst mixView = .*\n/)[0];
  const D = { duration: 9, scenes: [{ id: 'a', kind: 'step' }, { id: 'b', kind: 'bars', tpl: 'data-story' }, { id: 'c', kind: 'step' }] };
  const mixView = new Function('D', `${src}return mixView;`)(D);
  assert.deepEqual(mixView('explainer').scenes.map((s) => s.kind), ['step', 'data-story.bars', 'step']);
  assert.deepEqual(mixView('data-story').scenes.map((s) => s.kind), ['explainer.step', 'bars', 'explainer.step']);
  assert.equal(mixView('explainer').scenes[0], D.scenes[0], 'own scenes keep their identity');
  assert.equal(mixView('data-story').duration, 9);
  assert.ok(html.includes('})(mixView("data-story")));'));
});

/* ---------- ui-story on the kit ---------- */
async function uiStoryMixedPage() {
  const c = composeBeats(rules('ui-story'), [rules('data-story'), rules('testimonial')]);
  const script = { app: { name: 'Console', nav: [{ label: 'Dashboard', icon: 'home' }] }, scenes: [
    scene(c, 'title', 'intro'), scene(c, 'ui', 'dash'), scene(c, 'data-story.bars', 'bars-1'),
    scene(c, 'beat', 'why'), scene(c, 'testimonial.quote', 'quote-1'), scene(c, 'ui', 'dash-2'), scene(c, 'cta', 'end'),
  ] };
  const timing = estimateTiming(script, cfg.timing, 'en', c.pace);
  return { c, script, html: await buildMixed({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(c, '16:9') }, c) };
}

test('ui-story leads a mix: one page, the app window scoped, no particles, every scene drawn', async () => {
  const { c, script, html } = await uiStoryMixedPage();
  assert.deepEqual(validateScript(script, c).errors, []);
  assert.equal(html.split('window.seek = ').length, 2);
  assert.ok(!html.includes('drawBg(t);'), 'ui-story keeps the background canvas empty');
  for (const sc of script.scenes) assert.ok(html.includes(`id="g-${sc.id}"`), sc.id);
  assert.ok(html.includes('.t-ui-story #app{') && html.includes('"navLabels":["Dashboard"]'));
  assert.ok(html.includes('<div class="ui-cap" data-lint>Dashboard · Start with what needs you</div>'));
  assert.ok(html.includes('.subt{left:240px;right:240px;bottom:54px}'), 'the lead ui-story sets the subtitle style');
  assert.ok(html.includes('<div class="subt subdark" id="sub-intro"'), 'the title frame is dark');
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no element id twice');
});

test('an extra template with no scenes in the script adds nothing to the page', async () => {
  const c = composeBeats(rules('data-story'), [rules('code-story'), rules('ui-story')]);
  const script = { scenes: [scene(c, 'bars', 'bars-1'), scene(c, 'code-story.checklist', 'list-1'), scene(c, 'cta', 'end')] };
  const timing = estimateTiming(script, cfg.timing, 'en', c.pace);
  const html = await buildMixed({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(c, '16:9') }, c);
  assert.ok(html.includes('<div class="tpl t-code-story">'));
  assert.ok(!html.includes('t-ui-story') && !html.includes('mixKinds("ui-story.", '), 'no empty app window from ui-story');
  for (const sc of script.scenes) assert.ok(html.includes(`id="g-${sc.id}"`), sc.id);
});

test('ui-story mixes only in 16:9, and never with a template drawn by the same renderer', () => {
  const brief = { ...mixBrief, template: 'ui-story', mix: ['data-story'] };
  assert.deepEqual(validateBrief(brief).mix, ['data-story']);
  assert.throws(() => validateBrief({ ...brief, format: '9:16' }), /These templates share formats: 16:9/);
  assert.throws(() => validateBrief({ ...brief, mix: ['feature-launch'] }), /feature-launch and ui-story share one renderer/);
  assert.deepEqual(validateBrief({ ...brief, template: 'feature-launch', duration: 45 }).mix, ['data-story']);
});

/* ---------- briefs ---------- */
const MIX_PROJECT = 'zz-test-mix';
const mixBrief = { id: 'tour-16x9', project: MIX_PROJECT, template: 'explainer', mix: ['data-story', 'testimonial'], format: '16:9', duration: 60, director: 'seat', message: 'm' };

test('a brief mix is checked against the lead and every extra', () => {
  assert.deepEqual(validateBrief(mixBrief).mix, ['data-story', 'testimonial']);
  assert.deepEqual(validateBrief({ ...mixBrief, mix: undefined }).mix, []);
  assert.throws(() => validateBrief({ ...mixBrief, mix: ['talking-head'] }), /Template talking-head cannot be mixed in/);
  assert.throws(() => validateBrief({ ...mixBrief, template: 'product-demo', format: '9:16', duration: 20 }), /Template product-demo cannot be mixed in/);
  assert.throws(() => validateBrief({ ...mixBrief, mix: ['data-story', 'testimonial', 'event', 'ui-story'] }), /mixes at most 3 other templates/);
  assert.throws(() => validateBrief({ ...mixBrief, mix: ['explainer'] }), /explainer is already the brief's template/);
  assert.throws(() => validateBrief({ ...mixBrief, mix: ['event', 'event'] }), /event is in the mix twice/);
  assert.throws(() => validateBrief({ ...mixBrief, mix: ['nope'] }), /Unknown template: nope/);
  assert.throws(() => validateBrief({ ...mixBrief, mix: 'data-story' }), /mix must be a list/);
  assert.throws(() => validateBrief({ ...mixBrief, format: '3:4' }), /These templates share formats: 16:9, 1:1, 9:16, 4:5, 2:3, 21:9/);
  assert.throws(() => validateBrief({ ...mixBrief, duration: 200 }), /Duration must be 15-150 s/);
});

test('the brief rules of a mixed brief are composed; a plain brief keeps its beats.json', () => {
  const mixed = loadBriefTemplate(validateBrief(mixBrief));
  assert.equal(mixed.beats.mixed, true);
  assert.deepEqual(mixed.beats.mix, ['data-story', 'testimonial']);
  assert.equal(mixed.dir, loadTemplate('explainer').dir);
  assert.deepEqual(loadBriefTemplate({ template: 'explainer' }), loadTemplate('explainer'));
});

test('a mix change once the director wrote a script asks for a new script', (t) => {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], MIX_PROJECT), { recursive: true, force: true })));
  saveBrief(validateBrief(mixBrief));
  assert.deepEqual(updateBrief(MIX_PROJECT, mixBrief.id, { ...mixBrief, mix: ['data-story'] }).changed, ['mix']);
  writeJson(jobFile(MIX_PROJECT, mixBrief.id, 'script.json'), { scenes: [] });
  const res = updateBrief(MIX_PROJECT, mixBrief.id, { ...mixBrief, mix: ['event'] });
  assert.equal(res.newScript, true);
  assert.deepEqual(loadBrief(MIX_PROJECT, mixBrief.id).mix, ['event']);
  assert.ok(!fs.existsSync(jobFile(MIX_PROJECT, mixBrief.id, 'script.json')), 'the old script moved aside');
  assert.ok(fs.existsSync(jobFile(MIX_PROJECT, mixBrief.id, 'script.prev.json')));
  assert.deepEqual(updateBrief(MIX_PROJECT, mixBrief.id, { ...mixBrief, mix: ['event'] }).changed, []);
  assert.deepEqual(updateBrief(MIX_PROJECT, mixBrief.id, { ...mixBrief, mix: ['event'], cta: 'Go' }).changed, ['cta']);
});

test('an old brief without mix reads as an empty mix when edited', (t) => {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], MIX_PROJECT), { recursive: true, force: true })));
  const { mix, ...old } = validateBrief({ ...mixBrief, mix: [] });
  writeJson(path.join(DIRS.briefs, MIX_PROJECT, `${old.id}.json`), old);
  writeJson(jobFile(MIX_PROJECT, old.id, 'script.json'), { scenes: [] });
  assert.deepEqual(updateBrief(MIX_PROJECT, old.id, { ...old }).changed, []);
});

for (const t of listTemplates().filter(isMixable)) {
  test(`${t.id}: mixable kinds have fields and defaults, and its css scopes in every format`, async () => {
    const { dir, beats } = loadTemplate(t.id);
    for (const k of beats.mixable) {
      assert.ok(beats.fields[k], `${t.id}: no fields for ${k}`);
      assert.ok(beats.defaults?.[k], `${t.id}: no defaults for ${k}`);
    }
    const { parts } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    assert.equal(typeof parts, 'function', `${t.id}: a mixable renderer exports parts()`);
    for (const format of beats.formats) {
      const { css } = parts({ brand: BRAND, script: { scenes: [] }, size: sizeFor(beats, format) });
      assert.doesNotThrow(() => scopeCss(css, `.t-${t.id}`), `${t.id} ${format}`);
    }
  });
}
