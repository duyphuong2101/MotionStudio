import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { GRADES, gradeOf, isCube, filterPath, gradeChain, videoGradeVf, imageGradeArgs } from '../engine/grade.mjs';
import { ffmpeg, BT709_TAGS } from '../engine/media.mjs';
import { validateBrand } from '../engine/brand.mjs';

const cube = (size, fn) => {
  let s = 'TITLE "test"\n# a comment\n' + `LUT_3D_SIZE ${size}\n`;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) s += `${fn(r / (size - 1), g / (size - 1), b / (size - 1)).join(' ')}\n`;
  return s;
};
const IDENTITY = cube(2, (r, g, b) => [r, g, b]);
const INVERT = cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);

// One pixel as RGBA bytes; a BT.709 video is read back through the BT.709 matrix.
function pixel(file, x, y, { video = false } = {}) {
  const vf = `${video ? 'scale=in_color_matrix=bt709:in_range=tv,' : ''}format=rgba,crop=1:1:${x}:${y}`;
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { timeout: 30000, windowsHide: true });
  assert.equal(r.status, 0, String(r.stderr));
  return [...r.stdout.subarray(0, 4)];
}
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('gradeOf keeps a look or a LUT with an amount, and refuses the rest', () => {
  const e = [];
  assert.equal(gradeOf(undefined, e), null);
  assert.equal(gradeOf('none', e), null);
  assert.equal(gradeOf({}, e), null);
  assert.deepEqual(gradeOf({ look: 'warm' }, e), { look: 'warm' });
  assert.deepEqual(gradeOf({ look: 'mono', amount: 1 }, e), { look: 'mono' });
  assert.deepEqual(gradeOf({ lut: 'Film-1.cube', amount: '0.6' }, e), { lut: 'Film-1.cube', amount: 0.6 });
  assert.deepEqual(e, []);
  for (const bad of [{ look: 'sepia' }, { lut: '../x.cube' }, { lut: 'x.png' }, { look: 'warm', lut: 'x.cube' }, { look: 'warm', amount: 0 }, { look: 'warm', amount: 2 }, 'warm']) {
    const errs = [];
    assert.equal(gradeOf(bad, errs), null, JSON.stringify(bad));
    assert.equal(errs.length, 1, JSON.stringify(bad));
  }
});

test('validateBrand keeps grade and drops it when unset', () => {
  const base = {
    name: 'Acme', colors: { primary: '#112233', primary2: '#223344', secondary: '#445566', bg: '#ffffff', ink: '#000000', muted: '#777777', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' },
  };
  assert.equal(validateBrand(base).grade, undefined);
  assert.deepEqual(validateBrand({ ...base, grade: { look: 'teal-orange', amount: 0.7 } }).grade, { look: 'teal-orange', amount: 0.7 });
  assert.throws(() => validateBrand({ ...base, grade: { look: 'nope' } }), /grade.look/);
});

test('isCube takes a well-formed 3D LUT and refuses anything else', () => {
  assert.equal(isCube(Buffer.from(IDENTITY)), true);
  assert.equal(isCube(Buffer.from(cube(17, (r, g, b) => [r, g, b]))), true);
  assert.equal(isCube(Buffer.from(IDENTITY.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 3'))), false, 'row count must be size³');
  assert.equal(isCube(Buffer.from(IDENTITY + '0 0 0\n')), false);
  assert.equal(isCube(Buffer.from(IDENTITY.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 99'))), false);
  assert.equal(isCube(Buffer.from(IDENTITY + '<script>alert(1)</script>\n')), false);
  assert.equal(isCube(Buffer.from('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n')), false);
  assert.equal(isCube(Buffer.from([0x4c, 0, 0x55])), false);
});

test('filterPath quotes the path and escapes the drive colon', () => {
  assert.equal(filterPath('C:\\Projects\\Motion Studio\\out\\a.cube'), "'C\\:/Projects/Motion Studio/out/a.cube'");
  assert.throws(() => filterPath("C:/it's/a.cube"), /quote/);
});

test('gradeChain mixes at the amount; no grade gives no filter', () => {
  assert.equal(gradeChain(null), '');
  assert.equal(videoGradeVf(null), '');
  assert.equal(gradeChain({ look: 'cool' }), GRADES.cool);
  assert.match(gradeChain({ look: 'cool', amount: 0.4 }), /^split\[gro\]\[grg\];\[grg\]colortemperature.*blend=all_expr='A\*0\.60\+B\*0\.40'$/);
  assert.match(videoGradeVf({ look: 'warm' }), /^scale=in_color_matrix=bt709,format=gbrp,.*scale=out_color_matrix=bt709:out_range=tv,format=yuv420p$/);
  for (const look of Object.keys(GRADES)) assert.doesNotMatch(GRADES[look], /\beq=|\bhue=/, `${look} must use RGB filters only`);
});

test('a graded picture keeps its alpha; a LUT and an amount land where expected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'));
  try {
    const lut = path.join(dir, 'invert.cube');
    fs.writeFileSync(lut, INVERT);
    const src = path.join(dir, 'a.png');
    await ffmpeg(['-y', '-f', 'lavfi', '-i', "color=c=0x3366cc:s=64x64,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,32),255,0)'", '-frames:v', '1', src]);
    const full = path.join(dir, 'full.png');
    await ffmpeg(imageGradeArgs(src, full, { lut: 'invert.cube' }, lut));
    assert.ok(near(pixel(full, 2, 2), [204, 153, 51, 255]), String(pixel(full, 2, 2)));
    assert.equal(pixel(full, 40, 2)[3], 0, 'the transparent half stays transparent');
    const half = path.join(dir, 'half.png');
    await ffmpeg(imageGradeArgs(src, half, { lut: 'invert.cube', amount: 0.5 }, lut));
    assert.ok(near(pixel(half, 2, 2), [127, 127, 127, 255]), String(pixel(half, 2, 2)));
    for (const ext of ['jpg', 'webp']) {
      const out = path.join(dir, `mono.${ext}`);
      await ffmpeg(imageGradeArgs(src, out, { look: 'mono' }));
      const [r, g, b] = pixel(out, 2, 2);
      assert.ok(Math.abs(r - g) <= 3 && Math.abs(g - b) <= 3, `${ext} mono is grey: ${r},${g},${b}`);
    }
    assert.throws(() => imageGradeArgs(src, path.join(dir, 'x.svg'), { look: 'mono' }), /cannot be graded/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a graded BT.709 clip: an identity LUT changes nothing, a look changes the colour', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'));
  try {
    const lut = path.join(dir, 'id.cube');
    fs.writeFileSync(lut, IDENTITY);
    const src = path.join(dir, 'src.mp4');
    const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS];
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xd04020:s=64x64:d=0.2,scale=out_color_matrix=bt709:out_range=tv', ...enc, src]);
    const plain = pixel(src, 30, 30, { video: true });
    const id = path.join(dir, 'id.mp4');
    await ffmpeg(['-y', '-i', src, '-vf', `scale=64:64,${videoGradeVf({ lut: 'id.cube' }, lut)}`, ...enc, id]);
    assert.ok(near(pixel(id, 30, 30, { video: true }), plain, 2), `identity LUT keeps ${plain}, got ${pixel(id, 30, 30, { video: true })}`);
    const mono = path.join(dir, 'mono.mp4');
    await ffmpeg(['-y', '-i', src, '-vf', videoGradeVf({ look: 'mono' }), ...enc, mono]);
    const [r, g, b] = pixel(mono, 30, 30, { video: true });
    assert.ok(Math.abs(r - g) <= 3 && Math.abs(g - b) <= 3, `mono clip is grey: ${r},${g},${b}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a .cube upload keeps its name; prepare names a missing LUT', async () => {
  const { cleanAssetName } = await import('../engine/assets.mjs');
  const { brandGrade } = await import('../engine/pipeline.mjs');
  assert.equal(cleanAssetName('Film LUT.cube'), 'Film-LUT.cube');
  assert.equal(brandGrade('demo', {}), null);
  assert.deepEqual(brandGrade('demo', { grade: { look: 'warm' } }), { grade: { look: 'warm' }, lutFile: null });
  assert.throws(() => brandGrade('no-such-project-grade', { grade: { lut: 'gone.cube' } }), /colour LUT gone\.cube is not in this brand's assets/);
});
