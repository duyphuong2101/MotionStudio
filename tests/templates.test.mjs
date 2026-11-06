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
const ASSETS = ['photo.jpg', 'clip.mp4', 'model.glb', 'anim.json'];

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
// Re-recorded 2026-10-29 with the tables below: typed and swapped text no longer go through TextPlugin (innerHTML), the
// marks code reads only real marks, SplitText's line class is kitline; with templates/ as before those edits, every
// hash here matched.
const PARTS_BASELINE = {
  // Updated 2026-10-15: the sample now holds a video scene. A script without one still builds byte for byte as before.
  // Updated 2026-10-22: scenes no longer overlap at a switch and late elements start hidden (kit build/preset).
  // Updated 2026-10-22: the sample now holds a flash scene; without it the page is byte for byte NO_FLASH_BASELINE.
  // Updated 2026-10-22: flash items end their entrance before the next beat (two items overlapped while playing).
  // Updated 2026-10-23: the sample now holds a 3D model scene; without it the page is byte for byte NO_MODEL_BASELINE.
  // Updated 2026-10-23: a clip seek checks it reached its frame after the fallback wait (only the clip js changed).
  // Updated 2026-10-26: the diagram highlight tweens its colours from node to node (only the diagram js changed); the
  // video, flash and model baselines below moved with it.
  // Updated 2026-10-26: the model scene gets studio lighting, a contact shadow, view/shadow/env fields and the reveal
  // and detail spins (only MODEL_JS changed; NO_MODEL_BASELINE is untouched).
  // Updated 2026-10-27: a model scene takes a camera path, exploded parts, a decal and a brand environment, a tour canvas, and the anim (Lottie) kind joined the sample (only MODEL_JS and the new kind; the pre-kind baselines leave anim out).
  // Updated 2026-10-28: a softer model contact shadow (a wider PCF blur, lighter ground); only MODEL_JS changed.
  // Updated 2026-10-28: 1:1 only, the standard layout's diagram uses the square node rule (4+ nodes stack) so a
  // 4-node row no longer runs past both edges; NO_FLASH_BASELINE and NO_MODEL_BASELINE 1:1 changed with it.
  // Updated 2026-10-29: MODEL_JS calls the opt-in bloom and focus composer; checked that only MODEL_JS changed.
  explainer: { '16:9': '37aa374f8a7a46731d32b78d91bf972c5036f409', '1:1': '264fc100463fc989e6f2007f774d4fe061fbcf79', '9:16': 'fb9c3900dabcb6ef05c96801f969e51c5c511a2a', '4:5': '521317afc24ddc261be361a67de55553a54ec9ea', '2:3': 'a3074918dee44d42501c1c55b80a43ea8e3947c2', '21:9': '783a9e8a0e961aa82231084c16f2ce6310e1eb4f' },
  // Updated 2026-10-14 for the race and stripes kinds: the earlier scenes' markup is unchanged, only css and js were added.
  // Updated 2026-10-22: the line's end value sits right of its last point (the plot leaves a column for it) instead of
  // the chart's top-right corner.
  'data-story': { '16:9': '76de65d0c96153e94aa2bd3c5095c2f9250e4fa1', '1:1': 'b7d9ee7812c32c06fbe087afe56d1406f81e587a', '9:16': '32b4284f904d4d4e31ed08567613b70fcadc2dfc', '4:5': '9050f92d2aaeacf42e0ae2f7d929e8cd0e364c51', '2:3': 'eec964407774d70e90719cfc03293d2b43ede08a', '21:9': '817fbe3665e54f1b8167adaa49cec1c196f5e8dd' },
  testimonial: { '9:16': 'cfc7a5f8b76051b7b7d1d35fe0d0b8fe55ab4162', '1:1': '504e3fab94da98cafd1f98fa5d5b333909c61886', '16:9': 'd3bfe1d0eedf29cf27c2b1325a254cefa335fdd4', '4:5': '4a9804586177b555de9613aaec33125b66e7e53d', '2:3': '20a73216b0b514ca8eabf376aa30c194e1ad0fcc', '21:9': '751ffdd4ed086c83f253d87e9a3f3bfdb001b0d1' },
  event: { '9:16': '73139d151d9e68427bff3ad88a2f56f39912dd20', '1:1': '00382498d5fae6fbc3c287f340ef4132231364b7', '16:9': '4b09d9c64ec53f928c328a0ea0bdba698a580331', '4:5': 'c46e30b5cd7ad8d13d785bdc5c3c8abf942a1d63', '2:3': '9a04ed82a580db1bb2d29a66418a0945742361f9', '21:9': '0d33e7f4489138810d1375ab9d88386129fbf20f' },
};
const HASH_BRAND = { name: 'Hash Co', logoText: 'Hash', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
const HASH_TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };

// A flash scene may carry footage behind its words (2026-11-03): the clip full frame, blurred and shaded under the
// items; a flash without one writes none of that, so its page stays as before.
test('explainer: a flash scene with video puts the clip behind the words, blurred and shaded; without video nothing is added', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const page = (extra) => {
    const script = sampleScript(beats);
    Object.assign(script.scenes.find((s) => s.kind === 'flash'), extra);
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    return build({ brief: { format: '16:9' }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, '16:9') });
  };
  const plain = page({});
  assert.ok(!plain.includes('class="fbg"') && !plain.includes('.fbg'), 'no footage layer without a video');
  const html = page({ video: 'flow.mp4', in: 0, out: 12 });
  const m = /<div class="fbg" id="([^"]+)-win"><video data-clip="\1" data-start="[\d.]+" data-end="[\d.]+" src="clips\/\1\.mp4" muted playsinline preload="auto"><\/video><\/div><div class="fshade"><\/div><div class="flash">/.exec(html);
  assert.ok(m, 'the clip sits full frame before the flash words, with a shade over it');
  assert.match(html, /\.fbg video\{[^}]*object-fit:contain;filter:blur\([\d.]+px\)/);
  assert.match(html, /\.fshade\{[^}]*rgba\(0,0,0,\.45\)/);
});

// The explainer page from before the video kind existed: a script without a video scene must still build it exactly.
test('explainer: a script without a video scene builds the same page as before the video kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'video' && k !== 'flash' && k !== 'model' && k !== 'anim') })) });
  const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const html = build({ brief: { format: '16:9' }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, '16:9') });
  assert.equal(crypto.createHash('sha1').update(html).digest('hex'), '9cd6ed02796d2fc2c6dd28b154c075e5f698e7b1');
});

// The explainer pages from before the flash kind (PARTS_BASELINE of 2026-10-22): flash css and js are written only
// when a script holds a flash scene, so every existing explainer page stays the same in every format.
// Updated 2026-10-23: the sample's clip seek changed (see PARTS_BASELINE).
const NO_FLASH_BASELINE = { '16:9': '18ee04ac562e271d91436ef8e44cb25491b74698', '1:1': '9de4480d69555afa0cab5f3094a438007df3387d', '9:16': '3211148ba1900820ef6ddde217c70933e87250bd', '4:5': 'de9c9cb4177c7fd4b834141efc455324226dcd45', '2:3': '8beff823ccdfba1015f6430505b869bac3aa9cf0', '21:9': 'd2299dc5ba371b5a7824585913d9b45ca39920dc' };

test('explainer: a script without a flash scene builds the same page as before the flash kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'flash' && k !== 'model' && k !== 'anim') })) });
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
const NO_MODEL_BASELINE = { '16:9': '2f24c6ece9b00912f0b6bfe3ec0e9969c579641e', '1:1': '5538a4838ff0a978a8954576e66b73ec2645fc95', '9:16': '4c52977bce79b04dddc861999f99f3cf2d07c428', '4:5': '850f9eeffd011cff573afd1da163e65345c71346', '2:3': 'c06d47305e28c3d723ab72fb883a4e3da397702d', '21:9': '7ab490c3cbeb795e6a865d42ea089115c8b878f8' };

test('explainer: a script without a model scene builds the same page as before the model kind', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const script = sampleScript({ ...beats, sequence: beats.sequence.map((slot) => ({ ...slot, kind: slot.kind.filter((k) => k !== 'model' && k !== 'anim') })) });
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
const NO_SHOT_BASELINE = { 'ui-story': '34aee56d8584b1ebbca3e0066825744fc91a878a', 'feature-launch': '920e6a21c17696dd9d7e59fb24bbfb2bc4e7dfeb' };

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

// explainer video tags (2026-11-03): two labels over a split-screen clip, left then right; a bad list is refused.
test('explainer: video tags put one label over each half of the clip; without tags nothing is added', async () => {
  const { dir, beats } = loadTemplate('explainer');
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  const { validateScript } = await import('../engine/script.mjs');
  const page = (extra) => {
    const script = sampleScript(beats);
    const v = script.scenes.find((s) => s.kind === 'video') || Object.assign(script.scenes[1], { kind: 'video', title: 'Platform', video: 'a.mp4', source: 'x' });
    Object.assign(v, extra);
    const timing = estimateTiming(script, HASH_TIMING, 'en', beats.pace || null);
    return build({ brief: { format: '16:9' }, brand: HASH_BRAND, script, timing, size: sizeFor(beats, '16:9') });
  };
  assert.ok(!page({}).includes('vtag'), 'no tag markup, CSS or JS without the field');
  const html = page({ tags: ['Old', 'New'] });
  assert.match(html, /<div class="vtag l" id="([^"]+)-tag0" data-lint>Old<\/div><div class="vtag r" id="\1-tag1" data-lint>New<\/div>/);
  assert.match(html, /\.vtag\.l\{left:25%\}\.vtag\.r\{left:75%\}/);
  assert.ok(html.includes('const tagPops = ') && html.includes('tagPops(sc, s);'));
  const script = sampleScript(beats);
  const v = script.scenes.find((s) => s.kind === 'video');
  if (v) {
    const bad = (tags) => validateScript({ ...script, scenes: script.scenes.map((s) => (s === v ? { ...s, tags } : s)) }, beats, { assets: ['a.mp4', v.video], icons: [] }).errors.some((e) => /tags must list 2 labels/.test(e));
    assert.ok(bad(['Old']) && bad(['Old', 'A label that is far too long']) && !bad(['Old', 'New']));
  }
});
