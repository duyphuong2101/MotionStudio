import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DIRS, readJson, loadStudioConfig } from '../engine/core.mjs';
import { listTemplates, loadTemplate } from '../engine/jobs.mjs';
import { isBuiltIn } from '../engine/templates.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { page } from '../templates/kit.mjs';
import { sampleScript } from '../engine/template-preview.mjs';

const brand = readJson(path.join(DIRS.profiles, 'nsc', 'brand.json'));
const cfg = loadStudioConfig();
const ASSETS = ['photo.jpg', 'clip.mp4', 'model.glb'];

const withDefaults = listTemplates().filter((t) => t.defaults);

test('every template folder is built in', () => {
  const all = listTemplates();
  assert.ok(all.length >= 14, `expected 14+ templates, found ${all.length}`);
  for (const t of all) assert.ok(isBuiltIn(t.id), `${t.id} has no renderer`);
});

for (const t of withDefaults) {
  test(`${t.id}: default scenes pass its own rules and compose in every format`, async () => {
    const { dir, beats } = loadTemplate(t.id);
    const script = sampleScript(beats);
    const { errors } = validateScript(script, beats, { assets: ASSETS });
    assert.deepEqual(errors, []);
    const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
    const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    for (const format of beats.formats) {
      const size = sizeFor(beats, format);
      const html = build({ brief: { format }, brand, script, timing, size });
      assert.match(html, /window\.seek = /, `${t.id} ${format}: no seek contract`);
      assert.match(html, new RegExp(`<meta name="viewport" content="width=${size.width}">`), `${t.id} ${format}: wrong frame width`);
      for (const sc of script.scenes) assert.ok(html.includes(`id="g-${sc.id}"`), `${t.id} ${format}: scene ${sc.id} not drawn`);
    }
  });
}

test('every format a template lists has an even frame size of that aspect ratio', () => {
  for (const t of listTemplates()) {
    const { beats } = loadTemplate(t.id);
    if (!beats.sizes) assert.equal(beats.formats.length, 1, `${t.id}: several formats need a sizes entry each`);
    for (const f of beats.formats) {
      if (beats.sizes) assert.ok(beats.sizes[f], `${t.id}: no size for ${f}`);
      const { width, height } = sizeFor(beats, f);
      assert.ok(width % 2 === 0 && height % 2 === 0, `${t.id} ${f}: odd frame size`);
      const [a, b] = f.split(':').map(Number);
      assert.ok(Math.abs(width / height - a / b) < 0.01, `${t.id} ${f}: ${width}x${height} is not ${f}`);
    }
  }
});

test('templates that reuse a renderer load it and keep their own rules', () => {
  const teaser = loadTemplate('social-teaser');
  assert.equal(path.basename(teaser.dir), 'product-demo');
  const script = { scenes: [
    { id: 'hero', kind: 'hero', vo: 'Hi.', title: 'MegaMax', source: 'facts[0]' },
    { id: 'b1', kind: 'benefit', vo: 'Dry.', kicker: 'Dry', text: 'All night', chip: '12h', icon: 'drop', source: 'bullets[0]' },
    { id: 'cta', kind: 'cta', vo: 'Try it.', title: 'Try a sample', button: 'Get it' },
  ] };
  assert.deepEqual(validateScript(script, teaser.beats).errors, []);
  const two = { scenes: [script.scenes[0], script.scenes[1], { ...script.scenes[1], id: 'b2' }, script.scenes[2]] };
  assert.ok(validateScript(two, teaser.beats).errors.length, 'a teaser holds one benefit');
  assert.equal(path.basename(loadTemplate('feature-launch').dir), 'ui-story');
});

// sha1 of build() for the default scenes in every format, recorded before the parts() refactor (plan mixed-template, T1).
// Fixed brand and timing config so profile or config edits do not move them; a deliberate look change updates this table.
const PARTS_BASELINE = {
  // Updated 2026-10-15: the sample now holds a video scene. A script without one still builds byte for byte as before.
  // Updated 2026-10-22: scenes no longer overlap at a switch and late elements start hidden (kit build/preset).
  // Updated 2026-10-22: the sample now holds a flash scene; without it the page is byte for byte NO_FLASH_BASELINE.
  // Updated 2026-10-22: flash items end their entrance before the next beat (two items overlapped while playing).
  // Updated 2026-10-23: the sample now holds a 3D model scene; without it the page is byte for byte NO_MODEL_BASELINE.
  // Updated 2026-10-23: a clip seek checks it reached its frame after the fallback wait (only the clip js changed).
  // Updated 2026-10-26: the diagram highlight tweens its colours from node to node (only the diagram js changed); the
  // video, flash and model baselines below moved with it.
  explainer: { '16:9': '5c667b032386fb5463ddc73f14be2df1308b9d26', '1:1': '715390d823d1c3fb16f098eab580edaa562ffe1a', '9:16': '13421d3c2fd834e95acabb94b694de8aa34294d6', '4:5': '0274c64ecd6bcba1e5117a2c9093875d012fe577', '2:3': '0d99335569c669ec0dd2e8778573202f829e91e7', '21:9': '1ef3d50c62a48f5eaabaad3357b18f5f86a45a2f' },
  // Updated 2026-10-14 for the race and stripes kinds: the earlier scenes' markup is unchanged, only css and js were added.
  // Updated 2026-10-22: the line's end value sits right of its last point (the plot leaves a column for it) instead of
  // the chart's top-right corner.
  'data-story': { '16:9': '1cf59ed886e503c145730d3eddd9fb1366386975', '1:1': '15ef9d463f6d96f1535a4ed3ee84dfe09bc0c9ca', '9:16': 'a35aa3ad38b779e2a34d154beab485e6e6901473', '4:5': 'b73bf50fe4370ca6f9809c4d9b76dec8eb01ccb4', '2:3': 'afe707145cebd8e5a431a81254539fa2fb3f6575', '21:9': 'bd2e675b52346fe089435583be7c999e3d047382' },
  testimonial: { '9:16': '3b8f4a9f73b32a70cf1314eca8bb9fdac33b6412', '1:1': '6d50d7cc43f12629ba76f0eb8652803dcc9a4c65', '16:9': 'd907416be769d6b220ca24f32c554a55d3386750', '4:5': 'e25ef9af674b6cf988a475644f0b0ecec2720114', '2:3': 'b1a3e6820cd91c3c1fa0234bdf40d48e67a367f6', '21:9': 'f2b0b9ff42c26ba13e35958b7c1f629eb7526da2' },
  event: { '9:16': 'c72ee5549747374b0aa66fccb08e5e41ef3ad531', '1:1': 'b7bde479e0de11e0dd625c60aa1c65adaa437e00', '16:9': '1ac30371a0b71d81731b9856ac624083a3769cb8', '4:5': 'ad3f67e5ea9fb4d831e6e2a97cf63f7d90d9a957', '2:3': '43bdf699efb2f0f6b55dc415b9ea68de7db09ec9', '21:9': '3b16782ef0f064f4500aa309dff43fe725bca2bf' },
};
const HASH_BRAND = { name: 'Hash Co', logoText: 'Hash', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
const HASH_TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };

// The explainer page from before the video kind existed: a script without a video scene must still build it exactly.
test('explainer: a script without a video scene builds the same page as before the video kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'video' && k !== 'flash' && k !== 'model') })) });
  const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const html = build({ brief: { format: '16:9' }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, '16:9') });
  assert.equal(crypto.createHash('sha1').update(html).digest('hex'), 'fb76f5d74ac859c0985b74262b4606c6076a33b9');
});

// The explainer pages from before the flash kind (PARTS_BASELINE of 2026-10-22): flash css and js are written only
// when a script holds a flash scene, so every existing explainer page stays the same in every format.
// Updated 2026-10-23: the sample's clip seek changed (see PARTS_BASELINE).
const NO_FLASH_BASELINE = { '16:9': 'a58adc032794ad63058fb51a27151b4061860200', '1:1': 'bcbe80feb10972c0d744eaeb6c6fa208ce255d91', '9:16': '5fcf022542c4b91abcc80655edabcce6e2760bf0', '4:5': '52fc32f2c9cec766c7bdd307f6dc04c1d61fed53', '2:3': '7e758f84bedb2d339f3b6c356a8ccbc7c1066d5f', '21:9': 'a15c8681987b978573082bfef30ccae6232acda5' };

test('explainer: a script without a flash scene builds the same page as before the flash kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'flash' && k !== 'model') })) });
  const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  for (const [format, sha] of Object.entries(NO_FLASH_BASELINE)) {
    const html = build({ brief: { format }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, format) });
    assert.equal(crypto.createHash('sha1').update(html).digest('hex'), sha, format);
    assert.ok(!html.includes('flash') && !html.includes('.acc'), `${format}: no flash or theme code`);
  }
});

// The explainer pages from before the model kind (PARTS_BASELINE of 2026-10-22): model css, js and three.js are
// written only when a script holds a model scene, so every existing explainer page stays the same in every format.
// Updated 2026-10-23: the sample's clip seek changed (see PARTS_BASELINE).
const NO_MODEL_BASELINE = { '16:9': '1d5881151826564ea30bba80a804df78eb265043', '1:1': '07a7ea2a8514a1bb0ecc69b35c274837fceda52d', '9:16': 'c000b506cce2fc1c029c76cd053d5508b4799525', '4:5': '6d05bf7a8fb42bbcb23ddb6de49263e97e9f6371', '2:3': '40296d01c2ed81112626ccce6440abe999b84094', '21:9': '572379bc2ef593a20a67a46b449651f1ddf65b91' };

test('explainer: a script without a model scene builds the same page as before the model kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'model') })) });
  const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  for (const [format, sha] of Object.entries(NO_MODEL_BASELINE)) {
    const html = build({ brief: { format }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, format) });
    assert.equal(crypto.createHash('sha1').update(html).digest('hex'), sha, format);
    assert.ok(!html.includes('data-model') && !html.includes('importmap'), `${format}: no model code`);
  }
});

for (const [id, hashes] of Object.entries(PARTS_BASELINE)) {
  test(`${id}: build() equals page(parts()) and its output is unchanged by the parts() split`, async () => {
    const { dir, beats } = loadTemplate(id);
    const script = sampleScript(beats);
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    const mod = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    for (const [format, sha] of Object.entries(hashes)) {
      const args = { brief: { format }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, format) };
      const html = mod.build(args);
      assert.equal(html, page({ ...args, title: id, ...mod.parts(args) }), `${id} ${format}`);
      assert.equal(crypto.createHash('sha1').update(html).digest('hex'), sha, `${id} ${format}: output changed`);
    }
  });
}

// sha1 of build() for the default scenes without shot scenes, recorded before ui-story had them: shot css, markup and js
// are written only when a script uses a shot, so every existing ui-story and feature-launch page stays the same.
const NO_SHOT_BASELINE = { 'ui-story': '657c2e1fec68fa0bd5640be2c5b8436703b8ef1c', 'feature-launch': 'a6a9a06b517c73085239cad9ca3b94be08f6854f' };

for (const [id, sha] of Object.entries(NO_SHOT_BASELINE)) {
  test(`${id}: a script without shot scenes builds the same page as before shots existed`, async () => {
    const { dir, beats } = loadTemplate(id);
    const script = sampleScript({ ...beats, sequence: beats.sequence.map((sl) => ({ ...sl, kind: sl.kind.filter((k) => k !== 'shot') })) });
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    const html = build({ brief: { format: '16:9' }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, '16:9') });
    assert.equal(crypto.createHash('sha1').update(html).digest('hex'), sha);
    assert.ok(!html.includes('shot'), 'no shot code on a page without shots');
  });
}

for (const t of listTemplates().filter((b) => b.mixable)) {
  test(`${t.id}: a mixable renderer's build() is page(parts()) in every format`, async () => {
    const { dir, beats } = loadTemplate(t.id);
    const script = sampleScript(beats);
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    const mod = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    assert.equal(typeof mod.parts, 'function', `${t.id}: mixable without parts()`);
    for (const format of beats.formats) {
      const args = { brief: { format }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, format) };
      assert.equal(mod.build(args), page({ ...args, title: path.basename(dir), ...mod.parts(args) }), `${t.id} ${format}`);
    }
  });
}

test('page() writes mix-aware kind lookups only when a scene names its template', () => {
  const script = { scenes: [{ id: 'a', kind: 'title', vo: 'One.' }, { id: 'b', kind: 'bars', vo: 'Two.' }] };
  const timing = estimateTiming(script, HASH_TIMING);
  const args = { brand: HASH_BRAND, script, timing, title: 't', js: 'const KINDS = {};' };
  const plain = page({ ...args, scenes: [{ id: 'a', kind: 'title' }, { id: 'b', kind: 'bars' }] });
  assert.ok(plain.includes('const fn = KINDS[sc.kind];'));
  assert.ok(!plain.includes('sc.tpl'));
  const mixed = page({ ...args, scenes: [{ id: 'a', kind: 'title' }, { id: 'b', kind: 'bars', tpl: 'data-story' }], particles: false });
  assert.ok(mixed.includes("const fn = KINDS[sc.tpl ? sc.tpl + '.' + sc.kind : sc.kind];"));
  assert.ok(mixed.includes("scenes: D.scenes.map((sc) => ({ id: sc.id, kind: sc.tpl ? sc.tpl + '.' + sc.kind : sc.kind,"));
  assert.ok(mixed.includes('"tpl":"data-story"'));
  assert.ok(!mixed.includes('drawBg(t);'), 'particles: false skips the background');
  assert.ok(plain.includes('tl.seek(t, false); drawBg(t); return'));
});

test('page() takes a subtitle style from the lead and writes it only when one is given', () => {
  const script = { scenes: [{ id: 'a', kind: 'title', vo: 'One.' }, { id: 'b', kind: 'ui', vo: 'Two.' }] };
  const timing = estimateTiming(script, HASH_TIMING);
  const args = { brand: HASH_BRAND, script, timing, title: 't', js: 'const KINDS = {};' };
  const plain = page({ ...args, scenes: [{ id: 'a', kind: 'title' }, { id: 'b', kind: 'ui' }] });
  assert.ok(plain.includes("color: '#ffffff', duration: 0.1") && !plain.includes('subdark') && !plain.includes('"subs"'));
  const styled = page({ ...args, scenes: [{ id: 'a', kind: 'title', dark: true }, { id: 'b', kind: 'ui' }], subs: { size: 30, bottom: 54, side: 240, pill: false, color: '#cbd5e1', lit: '#0f172a' } });
  assert.ok(styled.includes('.subt{left:240px;right:240px;bottom:54px}'));
  assert.ok(styled.includes('.sw{font-size:30px;line-height:1.3;font-weight:700;color:#cbd5e1;background:none;border-radius:0;padding:0}'));
  assert.ok(styled.includes('<div class="subt subdark" id="sub-a"') && styled.includes('<div class="subt" id="sub-b"'));
  assert.ok(styled.includes('color: sc.dark ? D.subs.darkLit : D.subs.lit') && styled.includes('"subs":{"lit":"#0f172a","darkLit":"#ffffff"}'));
  assert.throws(() => page({ ...args, scenes: [{ id: 'a', kind: 'title' }], subs: { lit: 'red;}body{' } }), /lit must be a hex or rgb color/);
});

test('a dark scene from any template of a mix gets the dark subtitle colours; without a style dark stays out of the page', () => {
  const script = { scenes: [{ id: 'a', kind: 'ui', vo: 'One.' }, { id: 'b', kind: 'cta', vo: 'Two.' }, { id: 'c', kind: 'bars', vo: 'Three.' }] };
  const timing = estimateTiming(script, HASH_TIMING);
  const args = { brand: HASH_BRAND, script, timing, title: 't', js: 'const KINDS = {};' };
  const scenes = [{ id: 'a', kind: 'ui' }, { id: 'b', kind: 'cta', tpl: 'data-story', dark: true }, { id: 'c', kind: 'bars', tpl: 'data-story' }];
  const styled = page({ ...args, scenes, subs: { pill: false, color: '#cbd5e1', lit: '#0f172a' } });
  assert.ok(styled.includes('<div class="subt subdark" id="sub-b"'), 'the extra marks its own frame dark');
  assert.ok(styled.includes('<div class="subt" id="sub-a"') && styled.includes('<div class="subt" id="sub-c"'));
  assert.ok(styled.includes('"id":"b","kind":"cta","tpl":"data-story","dark":true'));
  const plain = page({ ...args, scenes });
  assert.ok(!plain.includes('"dark"') && !plain.includes('subdark'));
});

for (const t of listTemplates().filter((b) => b.mixable)) {
  test(`${t.id}: parts() marks every scene it draws on a dark frame as dark`, async () => {
    const { dir, beats } = loadTemplate(t.id);
    const script = { ...sampleScript(beats), app: { name: 'App', nav: [] } };
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    const { parts } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    const p = parts({ brief: { format: beats.formats[0] }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, beats.formats[0]) });
    const darkGroups = [...p.body.matchAll(/class="sc [^"]*\bdark\b[^"]*" id="g-([^"]+)"/g)].map((m) => m[1]);
    for (const id of darkGroups) assert.equal(p.scenes.find((s) => s.id === id)?.dark, true, `${t.id}: ${id} is drawn dark`);
  });
}

test('a nested stat object is only required where the template declares it', () => {
  const ds = loadTemplate('data-story').beats;
  const s = { scenes: [{ id: 's', kind: 'stat', vo: 'Up.', value: 12, text: 'orders', source: 'x' }] };
  assert.deepEqual(validateScript(s, ds).errors, []);
});
