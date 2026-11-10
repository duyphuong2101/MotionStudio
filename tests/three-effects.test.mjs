import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition } from '../engine/media.mjs';
import { validateScript } from '../engine/script.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sampleGlb } from '../engine/glb.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { pictureCopies } from '../engine/direction.mjs';
import { packGlb } from '../engine/pack-glb.mjs';
import { PAINTS, MATERIAL_LOOKS, DEVICES, SWARM_FORMS, CARD_PHOTOS, CARD_CAPTION, CARD_ARRANGE, GLOBE_POINTS, GLOBE_LABEL, GLOBE_ARCS, WORD_MAX, THREE_CANVAS_RE, VIEW_RANGE } from '../engine/model-rules.mjs';
import { modelCanvas, m3Canvas, modelScripts, cueTime, hasModels, SUBJECTS } from '../templates/model3d.mjs';
import { LAND_BITS } from '../templates/globe-land.mjs';

const { beats } = loadTemplate('explainer');
const T = { start: 1, end: 5 };
const BRAND = { name: 'M Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };

// A PNG of w x h from fn(x, y) → [r, g, b, a], so a test needs no image file.
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(fn(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A tall app screen: coloured bands, so a scroll changes what shows.
const SCREEN = png(120, 400, (x, y) => [40 + (y % 100), 90 + ((y * 3) % 120), 200 - (y % 80), 255]);
const PHOTO = png(64, 48, (x, y) => [x * 4, y * 5, 160, 255]);
// A logo with two shapes and a hole: a ring and a bar.
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><path fill="#4f46e5" fill-rule="evenodd" d="M60 10a50 50 0 1 1 0 100a50 50 0 1 1 0-100zm0 25a25 25 0 1 0 0 50a25 25 0 1 0 0-50z"/><rect x="140" y="30" width="150" height="60" rx="12" fill="#f59e0b"/></svg>';

test('the explainer rules and the 3D renderers agree on every new field and range', () => {
  assert.deepEqual(beats.data.model.paints, PAINTS);
  assert.deepEqual(beats.data.model.material, MATERIAL_LOOKS);
  assert.deepEqual(beats.enums.device, DEVICES);
  assert.deepEqual(beats.enums.form, SWARM_FORMS);
  assert.deepEqual(beats.enums.arrange, CARD_ARRANGE);
  assert.deepEqual(beats.enums.arcs, GLOBE_ARCS);
  assert.deepEqual(beats.data.cards.photos, CARD_PHOTOS);
  assert.equal(beats.data.cards.caption, CARD_CAPTION);
  assert.deepEqual(beats.data.globe.points, GLOBE_POINTS);
  assert.equal(beats.data.globe.label, GLOBE_LABEL);
  assert.equal(beats.limits.word, WORD_MAX);
  for (const k of ['type3d', 'device', 'swarm']) assert.deepEqual(beats.data[k].view, VIEW_RANGE);
  for (const k of ['type3d', 'device', 'swarm', 'cards', 'globe']) {
    assert.ok(beats.mixable.includes(k), `${k} is mixable`);
    assert.ok(beats.help.kinds[k], `${k} has help`);
    assert.ok(beats.defaults[k], `${k} has a sample`);
  }
  for (const f of ['clip', 'paints', 'swap', 'material']) assert.ok(beats.fields.model.optional.includes(f), `model takes ${f}`);
  const story = loadTemplate('data-story').beats, logo = loadTemplate('logo-reveal').beats;
  assert.deepEqual(story.enums.depth, [true, false]);
  assert.ok(story.fields.bars.optional.includes('depth'));
  assert.ok(logo.enums.style.includes('3d'));
});

const scene = (kind, extra) => ({ id: 'x', kind, vo: 'Look at the new yellow cap now.', title: 'Look', source: 'bullets[0]', ...extra });
const errs = (sc, assets = ['a.glb', 'b.glb', 's.png', 'p.jpg']) => validateScript({ scenes: [{ id: 't', kind: 'title', vo: 'Hi.', title: 'Hi' }, sc] }, beats, { assets }).errors;

test('the new 3D kinds check their own fields', () => {
  assert.deepEqual(errs(scene('type3d', { word: '2x faster', title: undefined })), []);
  assert.match(errs(scene('type3d', { word: 'Seventeen letters' })).join(), /x: word is 17 chars, limit 16: cut 1/);
  assert.deepEqual(errs(scene('device', { screen: 's.png', device: 'laptop', spin: 'orbit' })), []);
  assert.match(errs(scene('device', { screen: 'missing.png' })).join(), /screen "missing.png" is not in the project assets/);
  assert.match(errs(scene('device', { screen: 'a.glb' })).join(), /screen must be a \.png, \.jpg or \.webp/);
  assert.match(errs(scene('device', { screen: 's.png', device: 'watch' })).join(), /device must be phone\|tablet\|laptop/);
  assert.deepEqual(errs(scene('swarm', { form: 'icon', icon: 'shield' })), []);
  assert.match(errs(scene('swarm', { form: 'icon' })).join(), /form icon needs an icon/);
  assert.match(errs(scene('swarm', { form: 'cloud' })).join(), /form must be word\|icon\|logo/);
  assert.deepEqual(errs(scene('cards', { photos: [{ asset: 'p.jpg', caption: 'One' }, { asset: 's.png' }], arrange: 'ring' })), []);
  assert.match(errs(scene('cards', { photos: [{ asset: 'p.jpg' }] })).join(), /photos must list 2-6 photos/);
  assert.match(errs(scene('cards', { photos: [{ asset: 'p.jpg', caption: 'x'.repeat(33) }, { asset: 'p.jpg' }] })).join(), /caption at most 32 characters/);
  assert.deepEqual(errs(scene('globe', { points: [{ lat: 59.3, lon: 18.1, label: 'Stockholm' }, { lat: 21, lon: 105.8 }], arcs: 'chain' })), []);
  assert.match(errs(scene('globe', { points: [] })).join(), /points must list 1-8 places/);
  assert.match(errs(scene('globe', { points: [{ lat: 91, lon: 0 }] })).join(), /lat must be a number from -90 to 90/);
  assert.match(errs(scene('globe', { points: [{ lat: 0, lon: '18' }] })).join(), /lon must be a number from -180 to 180/);
  assert.match(errs(scene('globe', { points: [{ lat: 0, lon: 0, label: 'x'.repeat(21) }] })).join(), /label at most 20 characters/);
});

test('a model scene checks its clip, paints, swap and material', () => {
  const m = (extra) => errs(scene('model', { model: 'a.glb', ...extra }));
  assert.deepEqual(m({ clip: 'Lid Open', paints: [{ color: 'secondary', part: 'cap', cue: 'yellow' }, { color: '#e11d48' }], swap: { model: 'b.glb', cue: 'new' }, material: { look: 'glass', parts: ['cap'] } }), []);
  assert.deepEqual(m({ material: 'chrome' }), []);
  assert.match(m({ clip: '<x>' }).join(), /clip must be the name of one animation/);
  assert.match(m({ paints: [] }).join(), /paints must list 1-4 colour changes/);
  assert.match(m({ paints: [{ color: 'pink' }] }).join(), /paints\[0\]: color must be a hex colour/);
  assert.match(m({ paints: [{ color: '#fff' }] }).join(), /paints\[0\]: color must be a hex colour/);
  assert.match(m({ paints: [{ color: 'bg', cue: 'purple' }] }).join(), /paints\[0\]: cue "purple" is not a word of the voice line/);
  assert.match(m({ paints: [{ color: 'bg', size: 2 }] }).join(), /paints\[0\]: each change is/);
  assert.match(m({ swap: { model: 'c.glb' } }).join(), /swap model "c.glb" is not in the project assets/);
  assert.match(m({ swap: 'b.glb' }).join(), /swap must be \{ "model"/);
  assert.match(m({ swap: { model: 'b.glb', cue: 'old' } }).join(), /swap\.cue "old" is not a word of the voice line/);
  assert.match(m({ material: 'wood' }).join(), /material must be/);
  assert.match(m({ material: { look: 'gold', parts: [] } }).join(), /material\.parts must list 1-6 part names/);
});

test('a cue lands just before its word, else at its share of the scene', () => {
  const words = [{ w: 'Look', start: 1.2 }, { w: 'Yellow,', start: 2.5 }];
  assert.equal(cueTime(words, 'yellow', T, 0.5), 2.4);
  assert.equal(cueTime(words, 'look', T, 0.5), 1.1);
  assert.equal(cueTime(words, 'blue', T, 0.5), 3);
  assert.equal(cueTime([{ w: 'go', start: 1.02 }], 'go', T, 0), 1, 'never before the scene starts');
});

test('a model canvas writes its clip, paints, swap and material only when set, colours resolved and escaped', () => {
  const plain = modelCanvas('m.glb', T, 'turn');
  assert.equal(modelCanvas('m.glb', T, 'turn', { clip: '', paints: [], swap: {}, material: 'wood' }), plain);
  const c = modelCanvas('m.glb', T, 'turn', {
    clip: 'Lid Open', colors: BRAND.colors, words: [{ w: 'yellow', start: 3.5 }],
    paints: [{ color: 'secondary', cue: 'yellow', part: 'cap' }, { color: '#E11D48' }, { color: 'nope' }],
    swap: { model: 'new pack.glb', cue: 'yellow' }, material: { look: 'glass', parts: ['cap', '<b>'] },
  });
  assert.match(c, / data-clip="Lid Open"/);
  assert.doesNotMatch(modelCanvas('m.glb', T, 'turn', { clip: 'a"><b>' }), /data-clip/, 'a clip name that is not a plain name is dropped');
  const paints = JSON.parse(c.match(/data-paints="([^"]+)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(paints, [{ t: 3, c: '#e11d48' }, { t: 3.4, c: '#f59e0b', part: 'cap' }], 'sorted in time, a bad colour dropped, a paint without a cue at its share');
  assert.match(c, / data-swap="assets\/new%20pack\.glb" data-swap-t="3.4"/);
  assert.match(c, / data-material="\{&quot;look&quot;:&quot;glass&quot;,&quot;parts&quot;:\[&quot;cap&quot;\]\}"/);
});

test('a 3D subject canvas carries its pictures as hidden images and its settings as escaped JSON', () => {
  const c = m3Canvas('cards', 'pics', T, { spin: 'orbit', data: { captions: ['<b>"x"</b>'] }, pics: ['a b.jpg', 'c.png'] });
  assert.match(c, /^<img class="m3src" id="pics-m3p0" src="assets\/a%20b\.jpg" alt="" hidden><img class="m3src" id="pics-m3p1" src="assets\/c\.png" alt="" hidden><canvas class="m3c" data-gl data-m3="cards"/);
  assert.match(c, / data-spin="still"/, 'cards move themselves: no spin');
  assert.match(c, / data-pics="pics-m3p0,pics-m3p1"/);
  assert.ok(!c.includes('<b>'), 'the settings are escaped');
  assert.match(m3Canvas('type', 'w', T, { spin: 'orbit' }), / data-spin="orbit"/);
  assert.match(m3Canvas('type', 'w', T, { spin: 'fly' }), / data-spin="hero"/);
  assert.throws(() => m3Canvas('teapot', 'w', T), /no 3D subject teapot/);
  assert.ok(hasModels(c) && THREE_CANVAS_RE.test(c) && hasModels(plainModel()));
  const one = modelScripts(m3Canvas('globe', 'g', T));
  assert.ok(one.includes('window.__m3lib =') && one.includes('window.__m3.globe =') && !one.includes('window.__m3.cards ='), 'only the subjects a page uses');
  assert.ok(!modelScripts(plainModel()).includes('window.__m3lib = {'), 'a page with only models gets no subject code');
  assert.deepEqual(SUBJECTS, ['type', 'logo', 'device', 'swarm', 'cards', 'globe', 'bars']);
});
const plainModel = () => modelCanvas('m.glb', T, 'turn');

test('the land map has one bit per 1-degree cell and puts land where land is', () => {
  const bits = Buffer.from(LAND_BITS, 'base64');
  assert.equal(bits.length, (360 * 180) / 8);
  const land = (lat, lon) => { const k = Math.min(179, Math.floor(90 - lat)) * 360 + Math.min(359, Math.floor(lon + 180)); return (bits[k >> 3] >> (k & 7)) & 1; };
  for (const [lat, lon] of [[55.7, 37.6], [21, 105.8], [40.7, -74.5], [-23.5, 133], [0, 20]]) assert.equal(land(lat, lon), 1, `${lat},${lon} is land`);
  for (const [lat, lon] of [[0, -140], [-40, 80], [30, -40]]) assert.equal(land(lat, lon), 0, `${lat},${lon} is sea`);
});

test('device screens and swap models are copied as they are; the photos of cards take the grade', () => {
  const { copies } = pictureCopies({ scenes: [{ id: 'd', kind: 'device', screen: 's.png' }, { id: 'm', kind: 'model', model: 'a.glb', swap: { model: 'b.glb' } }, { id: 'c', kind: 'cards', photos: [{ asset: 'p.jpg' }] }] });
  assert.deepEqual(copies.get('s.png'), { src: 's.png', grade: 'none' });
  assert.deepEqual(copies.get('b.glb'), { src: 'b.glb', grade: 'none' });
  assert.deepEqual(copies.get('p.jpg'), { src: 'p.jpg', grade: 'brand' });
});

// SwiftShader draws WebGL on the CPU, so these renders stay small: a 960x540 page, the few frames each check needs,
// and a second render of only the frames marked to repeat (one per subject), enough to catch a drifting frame.
const SMALL = { width: 960, height: 540 };
// Real Chrome on SwiftShader: every subject draws, moves over time and gives the same frames on a second render.
// Each probe is [name, time, canvas index, repeat]; the second render takes only the probes with repeat set.
async function renderTwice(t, html, size, files, probes) {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-three-fx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor')); fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  copyThree(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'assets', name), body);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  const runs = [], cover = {};
  for (let run = 0; run < 2; run++) {
    let opened;
    try { opened = await openComposition(path.join(dir, 'index.html'), { channel: cfg.engine.chromeChannel, ...size }); } catch (err) {
      if (/Composition|render script|model|WebGL|three|vendor|3D/i.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return null;
    }
    const { browser, page: pg } = opened;
    try {
      const hashes = [];
      for (const [name, at, i] of run ? probes.filter((p) => p[3]) : probes) {
        await pg.evaluate((x) => window.seek(x), at);
        hashes.push(crypto.createHash('sha1').update(await pg.screenshot()).digest('hex'));
        if (!run) cover[name] = await pg.evaluate((i) => {
          const src = document.querySelectorAll('canvas.m3c')[i], c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
          const x = c.getContext('2d'); x.drawImage(src, 0, 0);
          const px = x.getImageData(0, 0, src.width, src.height).data;
          let n = 0, sum = 0; for (let k = 3; k < px.length; k += 4) if (px[k] > 8) { n++; sum += px[k - 3] + 3 * px[k - 2] + 7 * px[k - 1]; }
          return { n, sum };
        }, i);
      }
      runs.push(run ? hashes : hashes.filter((_, k) => probes[k][3]));
    } finally { await browser.close(); }
  }
  assert.deepEqual(runs[1], runs[0], 'two renders give the same frames');
  return cover;
}

test('in Chrome: type, device, swarm, cards, globe and the model extras draw, move and repeat', { timeout: 300000 }, async (t) => {
  const cfg = loadStudioConfig();
  const vo = 'Here it is, now in yellow and then the new one.';
  const s = (id, kind, extra) => ({ id, kind, vo, source: 'bullets[0]', ...extra });
  const script = { lang: 'en', scenes: [
    { id: 'intro', kind: 'title', vo: 'Meet it.', title: 'Meet it' },
    s('word', 'type3d', { word: 'Ready.' }),
    s('phone', 'device', { title: 'In your pocket', screen: 'screen.png' }),
    s('laptop', 'device', { title: 'On your desk', screen: 'screen.png', device: 'laptop' }),
    s('dots', 'swarm', { form: 'icon', icon: 'shield' }),
    s('row', 'cards', { photos: [{ asset: 'photo.png', caption: 'Day one' }, { asset: 'photo.png', caption: 'Launch' }, { asset: 'photo.png' }] }),
    s('ring', 'cards', { photos: [{ asset: 'photo.png' }, { asset: 'photo.png' }, { asset: 'photo.png' }, { asset: 'photo.png' }], arrange: 'ring' }),
    s('earth', 'globe', { title: 'Where we work', points: [{ lat: 59.33, lon: 18.07, label: 'Stockholm' }, { lat: 21.03, lon: 105.85, label: 'Hanoi' }] }),
    s('pack', 'model', { title: 'The pack', model: 'pack.glb', paints: [{ color: 'secondary', part: 'front', cue: 'yellow' }], material: { look: 'chrome', parts: ['rim'] }, swap: { model: 'torus.glb', cue: 'new' } }),
  ] };
  assert.deepEqual(validateScript(script, beats, { assets: ['screen.png', 'photo.png', 'pack.glb', 'torus.glb'] }).errors, []);
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const size = SMALL;
  const { build } = await import(pathToFileURL(path.resolve('templates/explainer/template.mjs')).href);
  const html = build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size });
  const at = (id, f) => { const sc = timing.scenes.find((x) => x.id === id); return sc.start + f * (sc.end - sc.start); };
  const idx = (id) => script.scenes.filter((x) => x.kind !== 'title').findIndex((x) => x.id === id);
  const probes = [];
  // Middle and end for every subject (the middle repeats); the start only where a check reads it.
  for (const id of ['word', 'phone', 'laptop', 'dots', 'row', 'ring', 'earth', 'pack']) {
    if (id === 'word' || id === 'dots') probes.push([`${id}0.02`, at(id, 0.02), idx(id), false]);
    probes.push([`${id}0.5`, at(id, 0.5), idx(id), true], [`${id}0.95`, at(id, 0.95), idx(id), false]);
  }
  const cover = await renderTwice(t, html, size, { 'screen.png': SCREEN, 'photo.png': PHOTO, 'pack.glb': packGlb({ front: PHOTO, back: PHOTO, aspect: 1, depth: 0.3 }), 'torus.glb': sampleGlb() }, probes);
  if (!cover) return;
  for (const id of ['word', 'phone', 'laptop', 'dots', 'row', 'ring', 'earth', 'pack']) {
    assert.ok(cover[`${id}0.5`].n > 1500, `${id} draws: ${cover[`${id}0.5`].n} pixels`);
    assert.notDeepEqual(cover[`${id}0.5`], cover[`${id}0.95`], `${id} moves between the middle and the end`);
  }
  assert.ok(cover['dots0.02'].n < cover['dots0.95'].n, `the points settle into the form: ${cover['dots0.02'].n} then ${cover['dots0.95'].n} pixels`);
  assert.ok(cover['word0.02'].n < cover['word0.5'].n, `the letters rise in: ${cover['word0.02'].n} then ${cover['word0.5'].n} pixels`);
});

test('in Chrome: 3D bars count up and the 3D logo assembles from its SVG', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const story = loadTemplate('data-story'), logo = loadTemplate('logo-reveal');
  const sScript = { lang: 'en', scenes: [{ id: 'b', kind: 'bars', depth: true, vo: 'Three teams grew faster than the rest this year.', title: 'Growth', source: 'bullets[0]', format: 'pct', items: [{ label: 'North', value: 42 }, { label: 'South', value: 31, tone: 'up' }, { label: 'East', value: 18 }], ref: { value: 25, label: 'Target' } }] };
  assert.deepEqual(validateScript(sScript, story.beats, {}).errors, []);
  const sTiming = estimateTiming(sScript, cfg.timing, 'en', story.beats.pace || null);
  const { build: storyBuild } = await import(pathToFileURL(path.join(story.dir, 'template.mjs')).href);
  const size = SMALL;
  const sHtml = storyBuild({ brief: { format: '16:9' }, brand: BRAND, script: sScript, timing: sTiming, size });
  assert.ok(!/class="bars/.test(sHtml) && /data-m3="bars"/.test(sHtml), 'the 3D bars replace the flat ones');
  const e = sTiming.scenes[0].end;
  const bars = await renderTwice(t, sHtml, size, {}, [['early', 0.3, 0, false], ['end', e - 0.1, 0, true]]);
  if (!bars) return;
  assert.ok(bars.early.n < bars.end.n && bars.end.n > 1500, `the columns grow: ${bars.early.n} then ${bars.end.n} pixels`);

  const lScript = { lang: 'en', scenes: [{ id: 'r', kind: 'reveal', style: '3d', theme: 'light', tagline: 'Built to last', vo: 'Built to last.' }] };
  assert.deepEqual(validateScript(lScript, logo.beats, {}).errors, []);
  const lTiming = estimateTiming(lScript, cfg.timing, 'en', logo.beats.pace || null);
  const { build: logoBuild } = await import(pathToFileURL(path.join(logo.dir, 'template.mjs')).href);
  const lSize = SMALL;
  const lHtml = logoBuild({ brief: { format: '16:9' }, brand: { ...BRAND, logo: 'logo.svg' }, script: lScript, timing: lTiming, size: lSize });
  assert.match(lHtml, /<img class="m3src" id="r-m3p0" src="assets\/logo\.svg"/);
  const le = lTiming.scenes[0].end;
  const lg = await renderTwice(t, lHtml, lSize, { 'logo.svg': LOGO }, [['in', 0.4, 0, false], ['landed', le - 0.2, 0, true]]);
  if (!lg) return;
  assert.ok(lg.landed.n > 2500, `the logo is drawn: ${lg.landed.n} pixels`);
  assert.notDeepEqual(lg.in, lg.landed, 'the pieces move as they land');
});

test('in Chrome: a clip the model does not have stops the page with its name', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const script = { lang: 'en', scenes: [{ id: 'intro', kind: 'title', vo: 'Hi.', title: 'Hi' }, { id: 'm', kind: 'model', vo: 'Look.', title: 'Look', source: 'bullets[0]', model: 'torus.glb', clip: 'Open' }] };
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const size = SMALL;
  const { build } = await import(pathToFileURL(path.resolve('templates/explainer/template.mjs')).href);
  await assert.rejects(renderTwice(t, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size }), size, { 'torus.glb': sampleGlb() }, [['m', 1, 0, false]]), /has no animation named "Open" \(it has none\)/);
});
