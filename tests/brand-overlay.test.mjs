import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { saveAsset, deleteAsset } from '../engine/assets.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { brandAssets } from '../templates/shared.mjs';
import { page, contentArea, geometry } from '../templates/kit.mjs';

const PROJECT = 'zz-test-brand-overlay';
test.after(() => fs.rmSync(path.join(DIRS.profiles, PROJECT), { recursive: true, force: true }));

const base = {
  name: 'Niteco', colors: { primary: '#262524', primary2: '#3a3937', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5b58', onPrimary: '#ffffff' },
  fonts: { display: 'Gilroy', body: 'Gilroy' },
};
const files = [{ family: 'Gilroy', file: 'Gilroy-Regular.woff2', weight: 400 }, { family: 'Gilroy', file: 'Gilroy-SemiBold.otf', weight: 600 }];

test('brand keeps font files, a subtitle style and the corner logo flag', () => {
  const b = validateBrand({ ...base, fonts: { ...base.fonts, files }, subtitles: { size: 40, color: '#262524', bg: '#ffffff' }, logoBug: true });
  assert.equal(b.fonts.files.length, 2);
  assert.equal(b.fonts.files[1].weight, 600);
  assert.deepEqual(b.subtitles, { size: 40, weight: 400, color: '#262524', bg: '#ffffff' });
  assert.equal(b.logoBug, true);
  assert.deepEqual(brandAssets(b), ['Gilroy-Regular.woff2', 'Gilroy-SemiBold.otf']);
  // Without the new fields the brand has none of them.
  const plain = validateBrand(base);
  assert.equal(plain.fonts.files, undefined);
  assert.equal(plain.subtitles, undefined);
  assert.equal(plain.logoBug, undefined);
  assert.throws(() => validateBrand({ ...base, fonts: { ...base.fonts, files: [{ family: 'Gilroy', file: '../x.woff2' }] } }), /fonts.files\[0\].file/);
  assert.throws(() => validateBrand({ ...base, fonts: { ...base.fonts, files: [{ family: 'G"}', file: 'a.woff2' }] } }), /family/);
  assert.throws(() => validateBrand({ ...base, subtitles: { size: 40, color: 'black' } }), /subtitles.color/);
  assert.throws(() => validateBrand({ ...base, subtitles: { size: 200, color: '#000000' } }), /subtitles.size/);
  assert.throws(() => validateBrand({ ...base, logoBug: 'yes' }), /logoBug/);
});

test('font files upload by signature and stay while the brand uses them', () => {
  const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]);
  assert.equal(saveAsset(PROJECT, 'Gilroy Regular.woff2', woff2).name, 'Gilroy-Regular.woff2');
  assert.throws(() => saveAsset(PROJECT, 'fake.otf', woff2), /does not look like/);
  const brand = { fonts: { files: [{ family: 'Gilroy', file: 'Gilroy-Regular.woff2' }] } };
  assert.throws(() => deleteAsset(PROJECT, 'Gilroy-Regular.woff2', brand), /font/);
  deleteAsset(PROJECT, 'Gilroy-Regular.woff2', {});
});

function render(brand) {
  const script = { scenes: [{ id: 'a', kind: 'x', vo: 'Hello there' }, { id: 'b', kind: 'y', vo: 'Bye now' }] };
  const timing = {
    duration: 4, lang: 'en',
    scenes: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 4 }],
    words: [{ scene: 'a', w: 'Hello', start: 0.2 }, { scene: 'a', w: 'there', start: 0.6 }, { scene: 'b', w: 'Bye', start: 2.2 }, { scene: 'b', w: 'now', start: 2.6 }],
  };
  return page({
    brand, script, timing, size: { width: 1920, height: 1080 }, title: 't', js: 'const KINDS = {};',
    body: '<div class="sc fill" id="g-a"></div><div class="sc fill dark" id="g-b"></div>',
    scenes: [{ id: 'a', kind: 'x' }, { id: 'b', kind: 'y' }],
  });
}

test('a page loads brand fonts, draws the corner logo and the brand subtitle box', () => {
  const brand = { ...base, logo: 'logo-black.svg', logoDark: 'logo-yellow.svg', fonts: { ...base.fonts, files }, subtitles: { size: 40, weight: 400, color: '#262524', bg: '#ffffff' }, logoBug: true };
  const html = render(brand);
  assert.match(html, /@font-face\{font-family:"Gilroy";src:url\("assets\/Gilroy-Regular\.woff2"\) format\("woff2"\);font-weight:400/);
  assert.match(html, /format\("opentype"\);font-weight:600/);
  assert.match(html, /<img class="lbug" id="lbug-l" src="assets\/logo-black\.svg"/);
  assert.match(html, /<img class="lbug" id="lbug-d" src="assets\/logo-yellow\.svg"/);
  assert.match(html, /\.sw\{font-size:40px;line-height:1\.3;font-weight:400;color:#262524\}/);
  assert.match(html, /\.sw\{font-family:var\(--body\);background:#ffffff/);
  assert.match(html, /classList\.contains\('dark'\)/);
});

test('a brand without the new fields renders the page as before', () => {
  const html = render({ ...base, logo: 'logo-black.svg' });
  assert.doesNotMatch(html, /@font-face|lbug|classList\.contains\('dark'\)/);
  assert.throws(() => render({ ...base, fonts: { ...base.fonts, files: [{ family: 'Gilroy', file: 'x");}body{' }] } }), /unusable/);
  assert.throws(() => render({ ...base, subtitles: { size: 40, color: 'red;}' } }), /brand.subtitles/);
});

test('a custom subtitle box can be translucent: rgba below full opacity, the plain hex at full', () => {
  const sub = { size: 40, weight: 400, color: '#262524', bg: '#ffffff' };
  assert.deepEqual(validateBrand({ ...base, subtitles: { ...sub, bgOpacity: 0.7 } }).subtitles, { ...sub, bgOpacity: 0.7 });
  assert.equal(validateBrand({ ...base, subtitles: { ...sub, bgOpacity: 1 } }).subtitles.bgOpacity, undefined);
  assert.throws(() => validateBrand({ ...base, subtitles: { ...sub, bgOpacity: 0 } }), /bgOpacity/);
  assert.throws(() => render({ ...base, subtitles: { ...sub, bgOpacity: 'x' } }), /brand.subtitles/);
  assert.match(render({ ...base, subtitles: { ...sub, bgOpacity: 0.7 } }), /\.sw\{font-family:var\(--body\);background:rgba\(255,255,255,0\.7\)/);
  assert.match(render({ ...base, subtitles: sub }), /\.sw\{font-family:var\(--body\);background:#ffffff/);
  // A translucent box with light text is blurred and its letters shaded, like a preset's; a solid one is left alone.
  const glass = render({ ...base, subtitles: { size: 40, weight: 400, color: '#ffffff', bg: '#0c0c0e', bgOpacity: 0.2 } });
  assert.match(glass, /background:rgba\(12,12,14,0\.2\);border-radius:6px;padding:8px 22px;-webkit-backdrop-filter:blur\(10px\);backdrop-filter:blur\(10px\);text-shadow:/);
  assert.doesNotMatch(render({ ...base, subtitles: { ...sub, bgOpacity: 0.7 } }), /backdrop-filter/);
});

test('a subtitle preset keeps its style and font; unknown values are named', () => {
  assert.deepEqual(validateBrand({ ...base, subtitles: { style: 'highlighter' } }).subtitles, { style: 'highlighter', font: 'Roboto' });
  assert.deepEqual(validateBrand({ ...base, subtitles: { style: 'minimal', font: 'brand', size: 50, marker: '#00aaff' } }).subtitles, { style: 'minimal', font: 'brand', size: 50, marker: '#00aaff' });
  assert.throws(() => validateBrand({ ...base, subtitles: { style: 'karaoke' } }), /subtitles.style/);
  assert.throws(() => validateBrand({ ...base, subtitles: { style: 'classic', font: 'Comic Sans' } }), /subtitles.font/);
  // Too small to read on a phone.
  assert.throws(() => validateBrand({ ...base, subtitles: { style: 'classic', size: 30 } }), /subtitles.size/);
  assert.throws(() => render({ ...base, subtitles: { style: 'classic', marker: 'red;}' } }), /brand.subtitles/);
});

test('a preset shows a few words at a time in a band clear of player controls, and replaces the custom look', () => {
  const words = 'Our team rebuilt the whole checkout flow in six weeks and cut the time to pay by half'.split(' ');
  const timing = { duration: 8, lang: 'en', scenes: [{ id: 'a', start: 0, end: 8 }], words: words.map((w, i) => ({ scene: 'a', w, start: 0.2 + i * 0.4, end: 0.5 + i * 0.4 })) };
  const args = (style, size) => ({
    brand: { ...base, subtitles: { style, font: 'Roboto' } }, script: { scenes: [{ id: 'a', kind: 'x' }] }, timing, size, title: 't',
    js: 'const KINDS = {};', body: '<div class="sc fill" id="g-a"></div>', scenes: [{ id: 'a', kind: 'x' }],
  });
  const land = page(args('classic', { width: 1920, height: 1080 }));
  assert.match(land, /family=Roboto:wght@400;500;700/);
  assert.match(land, /\.subt\{left:120px;right:120px;bottom:96px\}/);
  assert.match(land, /font-size:46px;[^}]*background:rgba\(12,12,14,\.2\);[^}]*backdrop-filter:blur\(10px\)/);
  assert.doesNotMatch(land, /span\.hl|span\.on/);
  const lines = [...land.matchAll(/id="sub-a-\d+"[^>]*><div class="sw">(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.ok(lines.length >= 3 && lines.every((l) => l.length <= 32), lines.join(' | '));
  // Portrait: larger type, raised above a social app's caption area and left of its icon rail.
  const port = page(args('highlighter', { width: 1080, height: 1920 }));
  assert.match(port, /\.subt\{left:80px;right:170px;bottom:360px\}/);
  assert.match(port, /font-size:60px/);
  assert.match(port, /\.sw span\.on\{color:#111111/);
  assert.match(port, /backgroundSize: '100% 88%'/);
  const min = page(args('minimal', { width: 1920, height: 1080 }));
  assert.match(min, /background:none;[^}]*text-shadow:2px 0 0 rgba\(0,0,0,\.72\),-2px 0 0 [^}]*-2px -2px 0 rgba\(0,0,0,\.72\)/);
  assert.match(min, /power1\.in/);
  // The content area moves up with the band.
  assert.deepEqual(contentArea({ ...base, subtitles: { style: 'classic' } }, geometry({ width: 1080, height: 1920 })), { top: 100, bottom: 480 });
});

test('a page can drop the corner logo, as a logo sting does', () => {
  const brand = { ...base, logo: 'logo-black.svg', logoBug: true };
  const script = { scenes: [{ id: 'a', kind: 'x', vo: 'Hi' }] };
  const timing = { duration: 2, lang: 'en', scenes: [{ id: 'a', start: 0, end: 2 }], words: [{ scene: 'a', w: 'Hi', start: 0.2 }] };
  const args = { brand, script, timing, size: { width: 1920, height: 1080 }, title: 't', js: 'const KINDS = {};', body: '<div class="sc fill" id="g-a"></div>', scenes: [{ id: 'a', kind: 'x' }] };
  assert.match(page(args), /id="lbug"/);
  assert.doesNotMatch(page({ ...args, corner: false }), /id="lbug"/);
});
