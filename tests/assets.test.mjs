import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../engine/core.mjs';
import { cleanAssetName, saveAsset, deleteAsset } from '../engine/assets.mjs';
import { validateBrand } from '../engine/brand.mjs';

// A throwaway profile, so upload tests never touch a real brand.
const PROJECT = 'zz-test-assets';
const dir = path.join(DIRS.profiles, PROJECT, 'assets');
test.after(() => fs.rmSync(path.join(DIRS.profiles, PROJECT), { recursive: true, force: true }));

test('asset names are cleaned and only allowed types pass', () => {
  assert.equal(cleanAssetName('../../My Logo (final).SVG'), 'My-Logo-final.svg');
  assert.throws(() => cleanAssetName('run.exe'), /not allowed/);
  assert.throws(() => cleanAssetName('page.html'), /not allowed/);
});

test('unsafe SVG and fake images are refused and never written', () => {
  const tries = [
    ['x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /active or external/],
    ['y.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>', /active or external/],
    ['z.svg', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>', /active or external/],
    ['w.svg', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>', /active or external/],
    ['fake.png', 'not a png at all', /does not look like/],
  ];
  for (const [name, body, re] of tries) {
    assert.throws(() => saveAsset(PROJECT, name, Buffer.from(body)), re, name);
    assert.ok(!fs.existsSync(path.join(dir, name)), `${name} must not be written`);
  }
});

test('a plain SVG uploads, refuses a silent overwrite, and deletes', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f5c55"/></svg>');
  const ok = saveAsset(PROJECT, 'qa logo.svg', svg, { replace: true });
  assert.equal(ok.name, 'qa-logo.svg');
  assert.throws(() => saveAsset(PROJECT, 'qa-logo.svg', svg), /already exists/);
  assert.throws(() => deleteAsset(PROJECT, 'qa-logo.svg', { logo: 'qa-logo.svg' }), /brand's logo/);
  deleteAsset(PROJECT, 'qa-logo.svg', {});
  assert.ok(!fs.existsSync(path.join(dir, 'qa-logo.svg')));
});

test('brand accepts logo files, custom colors and built-in music', () => {
  const base = {
    name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' },
  };
  const ok = validateBrand({ ...base, logo: 'logo.svg', logoDark: 'logo-white.png', palette: [{ name: 'highlight', hex: '#ff8800' }], music: { file: 'library:calm-pad' }, voice: { tts: 'kokoro', voice: 'af_bella' } });
  assert.equal(ok.logo, 'logo.svg');
  assert.equal(ok.palette[0].name, 'highlight');
  assert.equal(ok.music.file, 'library:calm-pad');
  assert.throws(() => validateBrand({ ...base, logo: '../x.svg' }));
  assert.throws(() => validateBrand({ ...base, palette: [{ name: 'primary', hex: '#000000' }] }), /clashes/);
  assert.throws(() => validateBrand({ ...base, palette: [{ name: 'x', hex: 'red' }] }), /#rrggbb/);
  assert.throws(() => validateBrand({ ...base, voice: { tts: 'elevenlabs' } }), /voice.tts/);
});
