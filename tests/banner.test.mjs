import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { DIRS, StudioError, assertId, loadStudioConfig, keyFreeEnv } from '../engine/core.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { createProject } from '../engine/jobs.mjs';
import { buildBanner, writeBanner, bannerFile, parseBannerSize, BANNER_BACKDROPS, BANNER_SIZES, BANNER_LIMITS } from '../engine/banner.mjs';
import { reviewRoute } from '../server/review.mjs';

const BRAND = validateBrand({
  name: 'Banner Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter', googleFonts: 'family=Inter:wght@400;700' },
});
const P = 'zz-test-banner';
const wipe = () => ['profiles', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
after(wipe);
wipe();
createProject({ id: P, name: 'Banner' });

const glOf = (html) => JSON.parse(/const D = \{ gl: (\{.*?\}) \}/.exec(html)[1]);
const studio400 = (re) => (err) => err instanceof StudioError && err.code === 400 && re.test(err.message);

test('the page is one full-bleed GL canvas running the chosen backdrop in the brand colours, all inline', () => {
  const html = buildBanner(BRAND, { backdrop: 'aurora' });
  assert.match(html, /<canvas id="glb" data-gl aria-hidden="true"><\/canvas>/);
  const gl = glOf(html);
  assert.equal(gl.backdrop, 'aurora');
  assert.deepEqual(gl.colors, ['#f8fafc', '#4f46e5', '#f59e0b', '#1e293b'], 'glData order: bg, primary2, secondary, primary');
  assert.equal(gl.strength, 0.55, 'a light background tints softly');
  assert.ok(html.includes('const FRAG') && html.includes('GL.draw(t)'));
  assert.match(html, /const K = 0\.5,/, 'aurora draws at half size and is scaled up');
  assert.match(html, /MAX_DPR = 2/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /new ResizeObserver\(resize\)\.observe\(box\)/);
  assert.match(html, /requestAnimationFrame\(frame\)/);
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/, 'no external script');
  assert.ok(!html.includes('const SOLIDS'), 'the solids ship only with the shapes backdrop');
  assert.ok(!html.includes('fonts.googleapis.com'), 'no font request without text');
  const shapes = buildBanner(BRAND, { backdrop: 'shapes' });
  assert.ok(shapes.includes('const SOLIDS') && /const K = 1,/.test(shapes) && /REBUILD = true/.test(shapes));
});

test('the backdrop defaults to the brand one, else mesh; the size to the first listed', () => {
  assert.equal(glOf(buildBanner({ ...BRAND, backdrop: 'flow' })).backdrop, 'flow');
  assert.equal(glOf(buildBanner(BRAND)).backdrop, 'mesh');
  assert.match(buildBanner(BRAND), /aspect-ratio:1920\/600/);
  assert.match(buildBanner(BRAND, parseBannerSize('1080x1080')), /aspect-ratio:1080\/1080/);
  assert.deepEqual(BANNER_BACKDROPS, ['mesh', 'aurora', 'flow', 'shapes']);
  for (const s of BANNER_SIZES) assert.doesNotThrow(() => buildBanner(BRAND, parseBannerSize(s)), s);
});

test('headline, subline and button are escaped and set in the brand fonts and colours', () => {
  const html = buildBanner(BRAND, { headline: `<b>"Fast" & 'free'</b>`, subline: 'Ends </script><script>alert(1)</script>', button: '  Start\n now ' });
  assert.ok(html.includes('<h1 class="hb-h">&lt;b&gt;&quot;Fast&quot; &amp; &#39;free&#39;&lt;/b&gt;</h1>'));
  assert.ok(html.includes('<p class="hb-s">Ends &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>'));
  assert.ok(html.includes('<a class="hb-b" href="#">Start now</a>'), 'whitespace folded to one line');
  assert.equal(html.match(/<script>/g).length, 1, 'only the page script');
  assert.match(html, /\.hb-h\{[^}]*"Inter"/);
  assert.match(html, /\.hb-b\{[^}]*background:#1e293b;color:#ffffff/);
  assert.ok(html.includes('href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap"'));
});

test('text over its cap, an unknown backdrop or size, and a non-boolean parallax are a 400', () => {
  for (const [k, n] of Object.entries(BANNER_LIMITS)) {
    assert.doesNotThrow(() => buildBanner(BRAND, { [k]: 'x'.repeat(n) }), k);
    assert.throws(() => buildBanner(BRAND, { [k]: 'x'.repeat(n + 1) }), studio400(new RegExp(`at most ${n} characters`)), k);
  }
  assert.deepEqual(BANNER_LIMITS, { headline: 60, subline: 120, button: 24 });
  assert.throws(() => buildBanner(BRAND, { headline: 42 }), studio400(/Headline must be text/));
  assert.throws(() => buildBanner(BRAND, { backdrop: 'plasma' }), studio400(/Backdrop must be one of mesh, aurora, flow, shapes/));
  assert.throws(() => buildBanner(BRAND, { width: 1000, height: 1000 }), studio400(/Size must be one of/));
  assert.throws(() => buildBanner(BRAND, { width: 1920 }), studio400(/Size must be one of/));
  assert.throws(() => parseBannerSize('huge'), studio400(/Size must be one of/));
  assert.throws(() => buildBanner(BRAND, { parallax: 'yes' }), studio400(/Parallax must be true or false/));
  assert.match(buildBanner(BRAND, { parallax: true }), /const SHIFT = 16,/);
  assert.match(buildBanner(BRAND), /const SHIFT = 0,/);
});

test('writeBanner writes inside out/<project>/_banner, a folder no job id can name', () => {
  const file = writeBanner(P, { backdrop: 'flow', ...parseBannerSize('1440x480'), headline: 'Hello' });
  assert.equal(file, path.join(DIRS.out, P, '_banner', 'flow-1440x480.html'));
  assert.ok(file.startsWith(path.join(DIRS.out, P) + path.sep));
  assert.match(fs.readFileSync(file, 'utf8'), /<h1 class="hb-h">Hello<\/h1>/);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['flow-1440x480.html'], 'no temp file left');
  assert.throws(() => assertId('_banner', 'job'), /Invalid job/);
  assert.throws(() => writeBanner('../x'), studio400(/Invalid project/));
  assert.throws(() => writeBanner('zz-no-such-project'), (e) => e instanceof StudioError && e.code === 404);
  assert.equal(bannerFile(P, 'flow-1440x480.html'), file);
  for (const bad of ['../../package.json', '..\\x.html', 'flow-1440x480.html/..', 'other.html', 'flow-1440x480.htm']) {
    assert.throws(() => bannerFile(P, bad), (e) => e instanceof StudioError && e.code === 404, bad);
  }
});

test('the review link reaches neither the banner route nor a banner file', () => {
  assert.equal(reviewRoute('POST', `/api/projects/${P}/banner`), null);
  assert.equal(reviewRoute('GET', `/api/projects/${P}/banner`), null);
  assert.equal(reviewRoute('GET', `/banner/${P}/mesh-1920x600.html`), null);
  assert.equal(reviewRoute('GET', `/files/${P}/_banner/mesh-1920x600.html`), null);
});

// Real Chrome on SwiftShader: no script error, a drawn backdrop, and one still frame under reduced motion.
test('the written banner draws in Chrome and holds still under reduced motion', { timeout: 120000 }, async (t) => {
  const file = writeBanner(P, { backdrop: 'shapes', headline: 'Hello', button: 'Go', parallax: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true, env: keyFreeEnv(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const pg = await browser.newPage({ viewport: { width: 960, height: 300 }, reducedMotion });
      // No network in a test: the brand's Google Fonts stylesheet comes back empty.
      await pg.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const errors = [];
      pg.on('pageerror', (e) => errors.push(e.message));
      pg.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('Hero banner:')) errors.push(m.text()); });
      await pg.goto(pathToFileURL(file).href);
      await pg.waitForFunction(() => document.getElementById('glb').width > 1, null, { timeout: 30000 });
      const pixel = () => pg.evaluate(() => {
        // A 96x32 copy of the layer canvas (it keeps its buffer) is enough to compare frames.
        const src = document.getElementById('glb'), c = document.createElement('canvas'); c.width = 96; c.height = 32;
        const x = c.getContext('2d'); x.drawImage(src, 0, 0, 96, 32);
        return [...x.getImageData(0, 0, 96, 32).data];
      });
      await pg.waitForTimeout(400);
      const a = await pixel();
      await pg.waitForTimeout(600);
      const b = await pixel();
      assert.deepEqual(errors, [], reducedMotion);
      const [w, cssW] = await pg.evaluate(() => [document.getElementById('glb').width, document.getElementById('glb').clientWidth]);
      assert.ok(w === cssW && cssW > 960, `shapes draw at full size (SCALE 1), past the edges for the parallax: ${w}/${cssW}`);
      assert.ok(a.length > 4 && a[3] === 255, `the backdrop is opaque: ${a.slice(0, 4)}`);
      assert.ok(a.some((v, i) => i % 4 !== 3 && Math.abs(v - [0xf8, 0xfa, 0xfc][i % 4]) > 3), 'the backdrop is drawn, not a blank background');
      if (reducedMotion === 'reduce') assert.ok(a.every((v, i) => v === b[i]), 'reduced motion keeps one still frame');
      else assert.ok(a.some((v, i) => v !== b[i]), 'the backdrop moves');
      assert.equal(await pg.locator('.hb-h').textContent(), 'Hello');
      await pg.close();
    }
  } finally { await browser.close(); }
});
