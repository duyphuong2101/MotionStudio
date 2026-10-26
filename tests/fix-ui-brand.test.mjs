import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrand } from '../engine/brand.mjs';

const base = {
  name: 'Acme', colors: { primary: '#262524', primary2: '#3a3937', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5b58', onPrimary: '#ffffff' },
  fonts: { display: 'Gilroy', body: 'Gilroy' },
};

test('music may be an .m4a asset, as the Brand tab offers it', () => {
  assert.equal(validateBrand({ ...base, music: { file: 'bed.m4a', gainDb: -18 } }).music.file, 'bed.m4a');
  assert.equal(validateBrand({ ...base, music: { file: 'library:calm', gainDb: -18 } }).music.file, 'library:calm');
  assert.throws(() => validateBrand({ ...base, music: { file: 'bed.ogg' } }), /music.file must be a \.wav, \.mp3 or \.m4a asset/);
  assert.throws(() => validateBrand({ ...base, music: { file: '../bed.m4a' } }), /music.file/);
});

test('font files refuse a second file for the same family, weight and style', () => {
  const files = [{ family: 'Gilroy', file: 'Gilroy-Regular.woff2', weight: 400 }, { family: 'Gilroy', file: 'Gilroy-Italic.woff2', weight: 400, style: 'italic' }];
  assert.equal(validateBrand({ ...base, fonts: { ...base.fonts, files } }).fonts.files.length, 2);
  const twice = [...files, { family: 'gilroy', file: 'Gilroy-Book.otf', weight: 400 }];
  assert.throws(() => validateBrand({ ...base, fonts: { ...base.fonts, files: twice } }), /fonts\.files\[2\] repeats gilroy 400 normal/);
  // An empty list (every row removed in the Brand tab) leaves no files key.
  assert.equal(validateBrand({ ...base, fonts: { ...base.fonts, files: [] } }).fonts.files, undefined);
});

test('the corner logo flag is kept on, dropped off', () => {
  assert.equal(validateBrand({ ...base, logoBug: true }).logoBug, true);
  assert.equal(validateBrand({ ...base, logoBug: false }).logoBug, undefined);
});

test('an unnamed custom colour is refused, not dropped', () => {
  assert.throws(() => validateBrand({ ...base, palette: [{ name: '', hex: '#ff0000' }] }), /custom color name ""/);
});
