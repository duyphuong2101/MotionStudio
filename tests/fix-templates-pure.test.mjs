// Template review fixes that need no browser: mark limits, flash sizing, cut windows, preset bands, the product-demo
// fit, page() output for leaks, captions, fonts and the corner logo, the moved product-demo and app-walkthrough, and
// the HTML video export's inlining.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK_CHARS } from '../engine/marks.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { validateScript } from '../engine/script.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { inlinePage } from '../engine/htmlvideo.mjs';
import { copyThree } from '../engine/vendor.mjs';
import { page, geometry, presetBand, contentArea } from '../templates/kit.mjs';
import { cutWindows, glData } from '../templates/gl.mjs';
import { flashSize } from '../templates/explainer/template.mjs';
import { build as productDemo, fitRows } from '../templates/product-demo/template.mjs';
import { build as walkthrough } from '../templates/app-walkthrough/template.mjs';
import { modelCanvas, MODEL_HEAD, MODEL_JS } from '../templates/model3d.mjs';

const BRAND = {
  name: 'Fix Co', logoText: 'Fix',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
// The template's sample scenes with any required text it has no default for (app-walkthrough has none), and as many
// scenes of each slot as it needs.
const filled = (beats) => {
  const script = sampleScript(beats);
  for (const slot of beats.sequence) {
    const of = script.scenes.filter((s) => slot.kind.includes(s.kind));
    for (let k = of.length; k < slot.min; k++) script.scenes.splice(script.scenes.indexOf(of[of.length - 1]) + 1, 0, { ...of[0], id: `${of[0].id}-x${k}` });
  }
  for (const sc of script.scenes) for (const f of ['title', 'button']) if (beats.fields[sc.kind].required.includes(f) && !sc[f]) sc[f] = f === 'title' ? 'Plan the week' : 'Start';
  return script;
};
const PORT = geometry({ width: 1080, height: 1920 }), SQUARE = geometry({ width: 1080, height: 1080 }), LAND = geometry({ width: 1920, height: 1080 });

// 1. A circle never wraps: at most 10 characters, which fit the largest 9:16 title (140 units on 860).
test('a circle mark fits one line of the largest portrait title; underline and strike keep 40 and wrap', () => {
  assert.ok(MARK_CHARS.circle * 0.6 * 140 <= 860, `circle ${MARK_CHARS.circle}`);
  assert.equal(MARK_CHARS.underline, 40);
  const script = { scenes: [{ id: 'a', kind: 'x', vo: 'One plan for every team.' }] };
  const html = page({ brand: BRAND, script, timing: estimateTiming(script, TIMING), title: 't', js: 'const KINDS = {};', scenes: [{ id: 'a', kind: 'x' }], body: '<div class="sc fill" id="g-a"><div>[[underline:one plan for every team]]</div></div>' });
  assert.match(html, /\.mk-underline,\.mk-strike\{display:inline;white-space:normal\}\.mk\.mkl\{display:inline-block;white-space:nowrap\}/);
  assert.match(html, /function splitMark\(m\)/);
});

// 2. A flash item's longest word always fits whole; marks are measured as the words they show.
test('flashSize shrinks below the floor for one long word and ignores mark brackets', () => {
  const width = 1080 - 160, word = 'documentationsupport'; // 20 characters at 9:16
  const size = flashSize(word, 150, 88, width);
  assert.ok(size < 88, `below the floor: ${size}`);
  // Twenty of the widest letters still fit whole.
  assert.ok(flashSize('m'.repeat(20), 150, 88, width) * 20 * 0.92 <= width);
  assert.equal(flashSize('[[circle:Fast]] wins', 150, 88, width), flashSize('Fast wins', 150, 88, width));
  // A short line keeps today's size; a long sentence of short words wraps at the floor.
  assert.equal(flashSize('Faster', 150, 88, width), Math.min(150, Math.floor(width / (6 * 0.6))));
  assert.equal(flashSize('one two six ten big red car sun', 150, 88, width), 88);
  // 1:1 and 4:5 (land floor 110 on a 820-unit line): a 12-letter word no longer breaks.
  assert.ok(flashSize('Productivity', 170, 110, 820) * 12 * 0.6 <= 820);
});

// 7. Cut windows never overlap; far cuts keep the full window.
test('cutWindows splits the time between close cuts and keeps the full window for far ones', () => {
  assert.deepEqual(cutWindows([3, 8], 0.5, 0.5), [[3, 0.5, 0.5], [8, 0.5, 0.5]]);
  const w = cutWindows([3, 3.6, 3.9], 0.25, 0.75);
  assert.deepEqual(w, [[3, 0.25, 0.3], [3.6, 0.25, 0.15], [3.9, 0.15, 0.75]]);
  for (let k = 1; k < w.length; k++) assert.ok(w[k - 1][0] + w[k - 1][2] <= w[k][0] - w[k][1] + 1e-9, 'no overlap');
  assert.deepEqual(glData({ backdrop: null, wipe: 'liquid' }, BRAND.colors, [2, 2.4]).cuts, [[2, 0.5, 0.2], [2.4, 0.2, 0.5]]);
  assert.equal(glData({ backdrop: 'mesh', wipe: null }, BRAND.colors, [2]).cuts, undefined);
});

test('page() gives leaks their cut windows and the wipe its windows', () => {
  const script = { scenes: [{ id: 'a', kind: 'x', vo: 'One.' }, { id: 'b', kind: 'x', vo: 'Two.' }, { id: 'c', kind: 'x', vo: 'Three.' }] };
  const timing = { duration: 5, lang: 'en', scenes: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 2.6 }, { id: 'c', start: 2.6, end: 5 }], words: [] };
  const html = page({ brand: { ...BRAND, leaks: true, wipe: 'liquid' }, script, timing, title: 't', js: 'const KINDS = {};', scenes: script.scenes.map(({ id }) => ({ id, kind: 'x' })), body: '' });
  assert.match(html, /"leaks":\[\[2,0\.25,0\.3\],\[2\.6,0\.25,0\.75\]\]/);
  assert.match(html, /"cuts":\[\[2,0\.5,0\.3\],\[2\.6,0\.3,0\.5\]\]/);
  assert.ok(html.includes('D.leaks.forEach(([c, pre, post], k)') && html.includes('G.cuts.findIndex(([c, a, b])'));
});

// 8. The preset band: one line in the face's width, and the content area clears its top.
test('a preset caption line fits one line in its face; the content area clears the band', () => {
  for (const [g, name] of [[PORT, '9:16'], [SQUARE, '1:1'], [geometry({ width: 1080, height: 1350 }), '4:5'], [LAND, '16:9']]) {
    for (const style of ['classic', 'pill', 'pop', 'minimal', 'highlighter']) {
      for (const font of ['Roboto', 'Montserrat', 'Inter']) {
        const bs = { style, font }, b = presetBand(bs, g);
        const box = style === 'minimal' || style === 'pop' ? 0 : 44;
        const avail = (g.land ? Math.min(g.W, (g.H * 16) / 9) : g.W) / g.U - b.left - b.right - box;
        // Montserrat Bold measured 0.654 em per character (20 characters at 67 units = 877).
        if (font === 'Montserrat') assert.ok(b.chars * b.size * 0.654 <= avail, `${name} ${style} ${font}: ${b.chars} chars at ${b.size} > ${avail}`);
        assert.ok(contentArea({ ...BRAND, subtitles: bs }, g).bottom >= b.top + 30, `${name} ${style} ${font}`);
      }
    }
  }
  // The pop preset at its largest size raises the content area above the old fixed 230.
  assert.ok(contentArea({ ...BRAND, subtitles: { style: 'pop', size: 80 } }, SQUARE).bottom > 230);
  assert.equal(presetBand({ style: 'pop', font: 'Montserrat' }, PORT).chars, 17);
});

// 10 and 11: caption entrances never get a negative duration; a preset without a font is Roboto everywhere.
test('preset captions clamp their entrance and load the face they draw in', () => {
  const words = 'Our team rebuilt the checkout'.split(' ');
  const timing = { duration: 4, lang: 'en', scenes: [{ id: 'a', start: 0, end: 4 }], words: words.map((w, i) => ({ scene: 'a', w, start: 0.2 + i * 0.3, end: 0.4 + i * 0.3 })) };
  const args = (subtitles, brand = {}) => ({ brand: { ...BRAND, ...brand, subtitles }, script: { scenes: [{ id: 'a', kind: 'x' }] }, timing, size: { width: 1920, height: 1080 }, title: 't', js: 'const KINDS = {};', body: '<div class="sc fill" id="g-a"></div>', scenes: [{ id: 'a', kind: 'x' }] });
  const plain = page(args({ style: 'classic' }));
  assert.ok(plain.includes('duration: Math.max(0, Math.min(0.12, t1 - t0 - 0.03))'));
  assert.ok(plain.includes('font-family:"Roboto",Helvetica,Arial,sans-serif') && plain.includes('family=Roboto:wght@400;500;700'));
  const own = page(args({ style: 'classic', font: 'brand' }));
  assert.ok(own.includes('font-family:var(--body)') && !own.includes('family=Roboto'));
  assert.ok(page(args(null, { motion: 'cinematic' })).includes('duration: Math.max(0, Math.min(0.16, t1 - t0 - 0.03))'));
});

// 9. The corner logo follows the scene's background luminance.
test('with a corner logo the page picks the logo by the scene surface', () => {
  const script = { scenes: [{ id: 'a', kind: 'x', vo: 'One.' }] };
  const html = page({ brand: { ...BRAND, logo: 'l.svg', logoDark: 'd.svg', logoBug: true }, script, timing: estimateTiming(script, TIMING), title: 't', js: 'const KINDS = {};', scenes: [{ id: 'a', kind: 'x' }], body: '<div class="sc fill acc" id="g-a"></div>' });
  assert.ok(html.includes('const dk = surfaceDark(sc, g);') && html.includes('<= 150'));
});

// 4. product-demo and app-walkthrough on the kit: brand fonts, subtitles, corner logo and marks.
test('product-demo and app-walkthrough honour brand fonts, subtitles, the corner logo and marks', () => {
  const brand = { ...BRAND, logo: 'l.svg', logoDark: 'd.svg', logoBug: true, fonts: { ...BRAND.fonts, files: [{ family: 'Inter', file: 'Inter.woff2', weight: 700 }] }, subtitles: { style: 'pop', font: 'Montserrat' }, shine: true };
  for (const [id, build] of [['product-demo', productDemo], ['social-teaser', productDemo], ['app-walkthrough', walkthrough]]) {
    const { beats } = loadTemplate(id);
    assert.equal(beats.marks, true, id);
    const script = filled(beats);
    const titled = script.scenes.find((s) => s.title);
    titled.title = `${titled.title} [[underline:now]]`;
    assert.deepEqual(validateScript(script, beats, { assets: ['photo.jpg'] }).errors, [], id);
    const html = build({ brand, script, timing: estimateTiming(script, TIMING, 'en', beats.pace || null) });
    assert.match(html, /@font-face\{font-family:"Inter";src:url\("assets\/Inter\.woff2"\)/, id);
    assert.match(html, /id="lbug-d"/, id);
    assert.match(html, /class="subt" id="sub-[^"]+-0"/, id);
    assert.match(html, /<span class="mk mk-underline"><span class="mkt">now<\/span>/, id);
    assert.match(html, /class="btn /, `${id}: the button takes the shine`);
    assert.ok(!html.includes('class="clogo"') && !html.includes('class="lg"'), `${id}: the corner logo replaces the card logo`);
  }
  // Without the brand options the pages keep their own look: no subtitles, no corner logo, no marks code.
  for (const [id, build] of [['product-demo', productDemo], ['app-walkthrough', walkthrough]]) {
    const { beats } = loadTemplate(id);
    const script = filled(beats);
    const html = build({ brand: BRAND, script, timing: estimateTiming(script, TIMING, 'en', beats.pace || null) });
    assert.ok(!html.includes('class="subt') && !html.includes('lbug') && !html.includes('drawMarks'), id);
    assert.match(html, /"stills":\[/, id);
  }
});

test('product-demo squeezes its rows above a preset caption band and keeps them without subtitles', () => {
  assert.equal(fitRows(BRAND, false).y(1620), 1620);
  const fit = fitRows({ ...BRAND, subtitles: { style: 'classic' } }, true);
  assert.equal(fit.y(290), 290);
  assert.ok(fit.y(1620) <= 1920 - contentArea({ ...BRAND, subtitles: { style: 'classic' } }, PORT).bottom);
});

// 3. The exported page loads everything from itself: no vendor/ or assets/ reference is left.
test('inlinePage inlines assets in attributes, vendor scripts and the three.js modules, and leaves JSON text alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-fixhv-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets')); fs.mkdirSync(path.join(dir, 'vendor'));
    copyThree(dir);
    fs.writeFileSync(path.join(dir, 'vendor', 'gsap.min.js'), 'window.gsap = {};');
    fs.writeFileSync(path.join(dir, 'assets', 'model.glb'), Buffer.from('glTF'));
    fs.writeFileSync(path.join(dir, 'assets', 'photo.png'), Buffer.from('png'));
    const html = `<!doctype html><html><head>${MODEL_HEAD}<style>@font-face{src:url("assets/photo.png")}</style></head><body>
<img src="assets/photo.png">${modelCanvas('model.glb', { start: 0, end: 2 }, 'turn')}
<script src="vendor/gsap.min.js"></script><script>const D = {"caption":"see assets/photo.png"};</script>${MODEL_JS}</body></html>`;
    const out = inlinePage(html, dir);
    assert.doesNotMatch(out, /\.\/vendor\/|src="vendor\/|(src|href|data-model)="assets\/|url\("assets\//);
    assert.ok(out.includes('"caption":"see assets/photo.png"'), 'JSON text is left as it is');
    assert.ok(out.includes("from 'studio-vendor/GLTFLoader.js'"));
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(out)[1]).imports;
    assert.deepEqual(Object.keys(map).sort(), ['studio-vendor/BufferGeometryUtils.js', 'studio-vendor/GLTFLoader.js', 'studio-vendor/RoomEnvironment.js', 'studio-vendor/SkeletonUtils.js', 'studio-vendor/three.core.js', 'three']);
    for (const [k, v] of Object.entries(map)) {
      assert.match(v, /^data:text\/javascript;base64,/, k);
      assert.doesNotMatch(Buffer.from(v.split(',')[1], 'base64').toString('utf8'), /from\s*['"]\.\.?\//, `${k} keeps a relative import`);
    }
    assert.match(out, /data-model="data:model\/gltf-binary;base64,/);
    fs.rmSync(path.join(dir, 'vendor', 'three.core.js'));
    assert.throws(() => inlinePage(html, dir), /vendor\/three\.core\.js is missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
