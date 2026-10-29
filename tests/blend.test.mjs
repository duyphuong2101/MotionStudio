import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { validateBrand, BLENDS, WIPES } from '../engine/brand.mjs';
import { openComposition } from '../engine/media.mjs';
import { page } from '../templates/kit.mjs';
import { blendOf, blendData, BLEND_BEFORE, BLEND_AFTER } from '../templates/blend.mjs';

const BRAND = {
  name: 'Blend Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

// Three 2 s scenes, each with a heading; the second is dark, so the two sides of a cut look different.
function args(brand, n = 3, extra = {}) {
  const ids = ['a', 'b', 'c'].slice(0, n);
  const scenes = ids.map((id, i) => ({ id, start: i * 2, end: i * 2 + 2 }));
  return {
    brand, script: { scenes: ids.map((id) => ({ id, kind: 'x', vo: 'Hello' })) }, size: { width: 640, height: 360 }, title: 't',
    timing: { duration: n * 2, lang: 'en', scenes, words: [] }, js: 'const KINDS = {};',
    body: ids.map((id, i) => `<div class="sc fill${i === 1 ? ' dark' : ''}" id="g-${id}"><div class="hd" id="${id}-hd" style="position:absolute;left:60px;top:120px;font-size:64px">Scene ${id.toUpperCase()}</div></div>`).join(''),
    scenes: ids.map((id) => ({ id, kind: 'x' })), ...extra,
  };
}

test('brand keeps a cut blend; none, an unknown one and a wipe with a blend are named', () => {
  for (const b of BLENDS) assert.equal(validateBrand({ ...BRAND, blend: b }).blend, b);
  assert.ok(!('blend' in validateBrand({ ...BRAND, blend: 'none' })));
  assert.ok(!('blend' in validateBrand(BRAND)));
  assert.throws(() => validateBrand({ ...BRAND, blend: 'swirl' }), /blend must be none or one of whip, zoom, warp, split/);
  for (const w of WIPES) assert.throws(() => validateBrand({ ...BRAND, wipe: w, blend: 'whip' }), /set wipe or blend, not both/);
  assert.equal(validateBrand({ ...BRAND, wipe: 'none', blend: 'zoom' }).blend, 'zoom');
  // Every blend is offered in the Brand tab and saved with the brand.
  const ui = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
  for (const b of BLENDS) assert.ok(ui.includes(`['${b}', '`), `the Brand tab offers ${b}`);
  assert.match(ui, /blend: \$\('#br-blend'\)\.value \|\| undefined/);
});

test('a page without a blend is unchanged; an overlay or a single scene gets none', () => {
  const plain = page(args(BRAND));
  assert.equal(page(args({ ...BRAND, blend: 'none' })), plain);
  assert.equal(page(args({ ...BRAND, blend: 'bogus' })), plain);
  for (const w of ['blw', 'blendWrap', 'drawBlend', 'blsvg', 'blends:']) assert.ok(!plain.includes(w), `no ${w} on a plain page`);
  assert.equal(page(args({ ...BRAND, blend: 'whip' }, 1)), page(args(BRAND, 1)));
  assert.equal(page(args({ ...BRAND, blend: 'warp' }, 3, { transparent: true })), page(args(BRAND, 3, { transparent: true })));
  assert.equal(blendOf({ blend: 'whip' }, false, 1), null);
  assert.equal(blendOf({ blend: 'whip' }, true, 3), null);
  assert.equal(blendOf({ blend: 'whip' }, false, 2), 'whip');
});

test('a blend takes the place of the profile cut, and wins over a wipe a look adds', () => {
  assert.deepEqual(blendData('zoom', [2, 4]).cuts, [[2, BLEND_BEFORE, BLEND_AFTER], [4, BLEND_BEFORE, BLEND_AFTER]]);
  // Two close cuts split the time between them.
  assert.deepEqual(blendData('zoom', [2, 2.3]).cuts, [[2, 0.25, 0.15], [2.3, 0.15, 0.25]]);
  const cine = page(args({ ...BRAND, motion: 'cinematic', blend: 'split' }));
  assert.ok(!cine.includes('veilCuts()') && !cine.includes("filter: 'blur(18px)'"), 'no veil and no blur cut under a blend');
  assert.match(cine, /scale: 1\.03, duration: Math\.max\(0\.1, e - s\)/, 'the cinematic push stays');
  assert.ok(!page(args({ ...BRAND, motion: 'editorial', blend: 'warp' })).includes('panelCuts()'), 'no editorial panel under a blend');
  // A look's wipe (lookBrand fills it) gives way to the brand's own blend.
  const both = page(args({ ...BRAND, wipe: 'liquid', blend: 'whip' }));
  assert.ok(!both.includes('id="glw"') && both.includes('drawBlend(t)'));
  // Only the filters the blend needs: a zoom has none.
  assert.ok(!page(args({ ...BRAND, blend: 'zoom' })).includes('<svg class="blsvg"'));
  assert.match(page(args({ ...BRAND, blend: 'warp' })), /<feTurbulence type="fractalNoise" baseFrequency="0\.01050" numOctaves="2" seed="7"/);
});

// Real Chrome: at a cut both scenes show and are in the frame; mid-scene only one does; a frame is the same however it
// was reached.
test('every blend shows both scenes at the cut, one mid-scene, and the same frame twice', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-blend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
  for (const b of BLENDS) {
    const file = path.join(dir, `${b}.html`);
    fs.writeFileSync(file, page(args({ ...BRAND, motion: b === 'zoom' ? 'cinematic' : 'standard', blend: b })), 'utf8');
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, width: 640, height: 360 }); } catch (err) {
      if (/Composition|render script/.test(err.message)) throw err;
      t.skip(`Chrome is not available: ${err.message}`); return;
    }
    const { browser, page: pg } = opened;
    try {
      // Each scene group's effective opacity and how much of it lies inside the frame.
      const shown = (at) => pg.evaluate(async (x) => {
        await window.seek(x);
        return Object.fromEntries(['a', 'b', 'c'].map((id) => {
          const g = document.getElementById('g-' + id);
          let op = getComputedStyle(g).visibility === 'visible' ? 1 : 0;
          for (let n = g; n && n.id !== 'stage'; n = n.parentElement) op *= +getComputedStyle(n).opacity;
          const r = g.getBoundingClientRect(), w = Math.max(0, Math.min(r.right, 640) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, 360) - Math.max(r.top, 0));
          return [id, op > 0.01 && w * h > 0.05 * 640 * 360 ? op : 0];
        }));
      }, at);
      for (const cut of [2, 4]) {
        const s = await shown(cut);
        const [out, inc] = cut === 2 ? ['a', 'b'] : ['b', 'c'];
        assert.ok(s[out] > 0 && s[inc] > 0, `${b} at ${cut} s shows both ${out} and ${inc}: ${JSON.stringify(s)}`);
      }
      for (const [at, only] of [[1, 'a'], [3, 'b'], [5, 'c']]) {
        const s = await shown(at);
        assert.deepEqual(Object.keys(s).filter((k) => s[k] > 0), [only], `${b} at ${at} s shows only ${only}: ${JSON.stringify(s)}`);
      }
      // Mid-blend, reached forward, from the end and from the start: the same pixels.
      const shot = async (from) => { await pg.evaluate((x) => window.seek(x), from); await pg.evaluate(() => window.seek(2.1)); return sha(await pg.screenshot()); };
      const first = await shot(1.9);
      assert.equal(await shot(6), first, `${b}: the same frame from the end`);
      assert.equal(await shot(0), first, `${b}: the same frame from the start`);
      // Outside the window the wrappers carry no style.
      const rest = await pg.evaluate(async () => { await window.seek(3); return [...document.querySelectorAll('.blw')].map((w) => w.getAttribute('style') || ''); });
      assert.ok(rest.every((s) => !/transform: \S|filter: \S|opacity: \S/.test(s)), `${b}: the wrappers rest mid-scene: ${rest}`);
    } finally { await browser.close(); }
  }
});
