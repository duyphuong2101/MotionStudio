import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { packGlb, glbJson, DEPTH_RANGE, PART_NAMES } from '../engine/pack-glb.mjs';
import { isGlb } from '../engine/glb.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { cleanAssetName } from '../engine/assets.mjs';
import { makePackGlb } from '../engine/pack-glb.mjs';
import { DIRS } from '../engine/core.mjs';

/** A tiny valid RGBA PNG of one colour. */
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgba).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const front = png(4, 5, [255, 255, 255, 255]), back = png(4, 5, [20, 30, 100, 255]);

/** A PNG from rows of RGBA pixels. */
function pngRows(rows) {
  const w = rows[0].length, h = rows.length;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), Buffer.from(r.flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Positions of a .glb's first accessor as [x, y, z] triples. */
const positions = (buf, g) => {
  const bv = g.bufferViews[g.accessors[0].bufferView], binStart = 20 + buf.readUInt32LE(12) + 8;
  const f = new Float32Array(buf.buffer.slice(buf.byteOffset + binStart + bv.byteOffset, buf.byteOffset + binStart + bv.byteOffset + bv.byteLength));
  return Array.from({ length: f.length / 3 }, (_, i) => [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]]);
};

test('packGlb writes a glTF 2.0 binary: a soft pillow with the front picture on the front and the rim, the back on the back', () => {
  const buf = packGlb({ front, back, aspect: 0.8, depth: 0.3 });
  assert.ok(isGlb(buf));
  assert.equal(buf.readUInt32LE(8), buf.length);
  const g = glbJson(buf);
  assert.equal(g.asset.version, '2.0');
  assert.deepEqual(g.nodes.map((n) => n.name), PART_NAMES, 'three named parts for an exploded view');
  assert.deepEqual(g.scenes[0].nodes, [0, 1, 2]);
  assert.deepEqual(g.meshes.map((m) => m.primitives[0].material), [0, 1, 2]);
  assert.equal(g.materials.length, 3);
  assert.equal(g.images.length, 2);
  assert.deepEqual(g.images.map((i) => i.mimeType), ['image/png', 'image/png']);
  assert.deepEqual([g.materials[0].alphaMode, g.materials[0].doubleSided], [undefined, true], 'picture faces are opaque and show from both sides');
  // The UVs stay inside the picture's border.
  const uv = g.accessors[2];
  const bvU = g.bufferViews[uv.bufferView], s0 = 20 + buf.readUInt32LE(12) + 8;
  const U = new Float32Array(buf.buffer.slice(buf.byteOffset + s0 + bvU.byteOffset, buf.byteOffset + s0 + bvU.byteOffset + bvU.byteLength));
  assert.ok(Math.min(...U) > 0.03 && Math.max(...U) < 0.97, `uv inside the border: ${Math.min(...U)} to ${Math.max(...U)}`);
  assert.equal(g.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0);
  assert.equal(g.materials[1].pbrMetallicRoughness.baseColorTexture.index, 1);
  assert.equal(g.materials[2].pbrMetallicRoughness.baseColorTexture.index, 0, 'the rim carries the front print round the edge');
  const pos = g.accessors[0];
  assert.deepEqual(pos.min, [-0.4, -0.5, -0.15]);
  assert.deepEqual(pos.max, [0.4, 0.5, 0.15]);
  assert.ok(pos.count > 1000 && pos.count < 65536, `a smooth grid that fits 16-bit indices: ${pos.count} vertices`);
  // Rounded, not a box: no vertex sits on a box corner, and the face's centre bulges to the full half depth.
  const P = positions(buf, g);
  assert.ok(P.every(([x, y, z]) => !(Math.abs(x) > 0.39 && Math.abs(y) > 0.49 && Math.abs(z) > 0.14)), 'no sharp corner');
  assert.ok(P.some(([x, y, z]) => Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z - 0.15) < 1e-6), 'the front bulges to its full depth at the centre');
  // Each part's triangles: the front's in front, the back's behind, the rim in between, together the whole surface.
  const idx = g.meshes.map((m) => g.accessors[m.primitives[0].indices].count / 3);
  assert.ok(idx.every((n) => n > 100), `every part has triangles: ${idx}`);
  // Every buffer view lies inside the binary chunk and the picture views carry the pictures' bytes.
  const binLen = g.buffers[0].byteLength;
  for (const bv of g.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= binLen, 'buffer view inside the chunk');
  assert.equal(g.bufferViews[6].byteLength, front.length);
  assert.equal(g.bufferViews[7].byteLength, back.length);
  const binStart = 20 + buf.readUInt32LE(12) + 8;
  assert.ok(buf.subarray(binStart + g.bufferViews[6].byteOffset, binStart + g.bufferViews[6].byteOffset + front.length).equals(front));
  assert.ok(cleanAssetName('pack.glb'));
});

test('without a back picture the back face reuses the front texture', () => {
  const g = glbJson(packGlb({ front, aspect: 1 }));
  assert.equal(g.images.length, 1);
  assert.equal(g.materials[1].pbrMetallicRoughness.baseColorTexture.index, 0);
});

test('makePackGlb refuses a bad name or picture before any work, trims the margins and saves the model', { timeout: 120000 }, async (t) => {
  const project = `zz-packglb-${process.pid}`;
  const dir = path.join(DIRS.profiles, project);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({ name: 'P', colors: { primary: '#123456' } }));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(DIRS.out, project), { recursive: true, force: true }); });
  // A 40x30 white pack inside a 64x64 transparent picture: the box must take the pack's 4:3, not the picture's square.
  const T = [0, 0, 0, 0], W = [255, 255, 255, 255];
  const rows = [];
  for (let y = 0; y < 64; y++) rows.push(Array.from({ length: 64 }, (_, x) => (x >= 12 && x < 52 && y >= 17 && y < 47 ? W : T)));
  fs.writeFileSync(path.join(dir, 'assets', 'pack.png'), pngRows(rows));
  fs.writeFileSync(path.join(dir, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(makePackGlb(project, { front: 'logo.svg' }), /front must be a \.png, \.jpg or \.webp asset/);
  await assert.rejects(makePackGlb(project, { front: 'missing.png' }), /front asset missing\.png not found/);
  await assert.rejects(makePackGlb(project, { front: '../pack.png' }), /front/);
  await assert.rejects(makePackGlb(project, { front: 'pack.png', name: 'pack.gltf' }), /name must end in \.glb/);
  await assert.rejects(makePackGlb(project, { front: 'pack.png', depth: 2 }), /--depth takes/);
  const r = await makePackGlb(project, { front: 'pack.png', depth: 0.2 });
  assert.equal(r.name, 'pack.glb');
  // cropdetect may keep a row or two of the faint edge out; the width is exact.
  assert.equal(r.crop.w, 40);
  assert.ok(r.crop.h >= 28 && r.crop.h <= 30, `pack height ${r.crop.h}`);
  assert.equal(r.aspect, Math.round((40 / r.crop.h) * 1000) / 1000);
  const g = glbJson(fs.readFileSync(path.join(dir, 'assets', 'pack.glb')));
  const [mx, my, mz] = g.accessors[0].max;
  assert.ok(Math.abs(mx - (40 / r.crop.h) / 2) < 1e-3 && my === 0.5 && Math.abs(mz - 0.1) < 1e-9, `box ${mx} ${my} ${mz}`);
  assert.equal(g.images.length, 1, 'no back picture: one texture, used on both faces');
  assert.equal(fs.existsSync(path.join(DIRS.out, project, '_pack-glb')), false, 'the work folder is gone');
  await assert.rejects(makePackGlb(project, { front: 'pack.png' }), /already exists/);
});

test('packGlb refuses a bad picture, aspect or depth', () => {
  assert.throws(() => packGlb({ front: Buffer.from('nope'), aspect: 1 }), /PNG or JPEG/);
  assert.throws(() => packGlb({ front, aspect: 9 }), /aspect/);
  assert.throws(() => packGlb({ front, aspect: 1, depth: DEPTH_RANGE[1] + 1 }), /depth/);
  assert.throws(() => packGlb({ front: Buffer.alloc(0) }), /front/);
});
