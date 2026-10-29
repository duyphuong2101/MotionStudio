// A product pack as a glTF 2.0 binary (.glb) written from code: a soft pillow (a superellipsoid, rounded corners and
// edges, faces that bulge a little) with the pack's front picture on the front and round the rim, and the back picture
// on the back. No 3D tool needed; a model scene or a product-demo hero turns it.
// `packGlb` builds the file from image buffers; `makePackGlb` trims the pictures with ffmpeg and saves the model as a
// brand asset (the `pack-glb` CLI command).

import fs from 'node:fs';
import path from 'node:path';
import { StudioError, DIRS, within, assertFileName, assertId } from './core.mjs';
import { profileDir } from './jobs.mjs';
import { saveAsset, IMAGE_EXT } from './assets.mjs';
import { ffmpeg, ffmpegReport } from './media.mjs';

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
export const DEPTH_RANGE = [0.05, 1];
export const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
/** The node names of a pack model: the front, the back and the rim between them. */
export const PART_NAMES = ['front', 'back', 'rim'];
// The pack's surface: roughness of the printed faces and of the rim, and for gloss a clear lacquer coat
// (KHR_materials_clearcoat, read by three's GLTFLoader) that catches the studio light as a sharp highlight.
// satin is the look every pack had before the choice, and stays the default.
export const FINISHES = {
  matte: { face: 0.8, rim: 0.85 },
  satin: { face: 0.45, rim: 0.6 },
  gloss: { face: 0.3, rim: 0.4, coat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.06 } },
};

const pad4 = (buf, fill) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), fill)]) : buf);

function mimeOf(buf) {
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  throw new StudioError('A pack picture must be a PNG or JPEG', 400);
}

// The pillow's shape: a superellipsoid, flat-ish faces that round into the edges (E1 along the depth) and rounded
// corners in the face plane (E2); the grid's rings round the depth and segments round the face.
const E1 = 0.55, E2 = 0.3, RINGS = 40, SEGS = 96;
// Triangles whose middle sits this far (of the half depth) in front show the front picture, that far behind the back;
// the band between is the rim, where the front print stretches round the edge.
const FACE_Z = 0.15;
// The pictures are sampled this far inside their edges, so the rim never reads a photo's soft or see-through border.
const UV_INSET = 0.035;
const sgnPow = (w, m) => Math.sign(w) * Math.abs(w) ** m;

/**
 * The pillow: a soft pack, not a box. Positions, normals and UVs for one grid, written twice (front-mapped UVs for the
 * front and the rim, mirrored UVs for the back, so the back picture reads the right way round when seen from behind)
 * and three index lists: the front, the back and the rim. Width is the picture's aspect, height 1, depth `depth` of it.
 */
function pillow(aspect, depth) {
  const a = aspect / 2, b = 0.5, c = depth / 2;
  const pos = [], nrm = [], uvF = [], uvB = [];
  for (let i = 0; i <= RINGS; i++) {
    const th = -Math.PI / 2 + (i / RINGS) * Math.PI;
    for (let j = 0; j <= SEGS; j++) {
      const ph = -Math.PI + (j / SEGS) * 2 * Math.PI;
      const x = a * sgnPow(Math.cos(th), E1) * sgnPow(Math.cos(ph), E2), y = b * sgnPow(Math.cos(th), E1) * sgnPow(Math.sin(ph), E2), z = c * sgnPow(Math.sin(th), E1);
      const nx = sgnPow(Math.cos(th), 2 - E1) * sgnPow(Math.cos(ph), 2 - E2) / a, ny = sgnPow(Math.cos(th), 2 - E1) * sgnPow(Math.sin(ph), 2 - E2) / b, nz = sgnPow(Math.sin(th), 2 - E1) / c;
      const nl = Math.hypot(nx, ny, nz) || 1;
      pos.push(x, y, z); nrm.push(nx / nl, ny / nl, nz / nl);
      const u = UV_INSET + (x / (2 * a) + 0.5) * (1 - 2 * UV_INSET), v = UV_INSET + (0.5 - y / (2 * b)) * (1 - 2 * UV_INSET);
      uvF.push(u, v); uvB.push(1 - u, v);
    }
  }
  const n = pos.length / 3, row = SEGS + 1;
  const idx = [[], [], []];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGS; j++) {
      const p = i * row + j, q = p + row;
      const zc = (pos[p * 3 + 2] + pos[q * 3 + 2]) / 2;
      const list = zc > FACE_Z * c ? 0 : zc < -FACE_Z * c ? 1 : 2, base = list === 1 ? n : 0;
      // Counter-clockwise seen from outside: the ring index grows from the back pole to the front one.
      idx[list].push(base + p, base + p + 1, base + q, base + q, base + p + 1, base + q + 1);
    }
  }
  return { pos: [...pos, ...pos], nrm: [...nrm, ...nrm], uv: [...uvF, ...uvB], idx, min: [-a, -b, -c], max: [a, b, c] };
}

/**
 * The model as a Buffer. `front` and `back` are PNG or JPEG buffers already trimmed to the pack; `aspect` is the
 * front picture's width over its height; `depth` is the pillow's depth as a share of its height. Without `back`
 * the back shows the front picture mirrored. The rim carries the front print stretched round the edge.
 */
export function packGlb({ front, back = null, aspect = 1, depth = 0.3, finish = 'satin' }) {
  if (!Object.hasOwn(FINISHES, finish)) throw new StudioError(`finish takes ${Object.keys(FINISHES).join(', ')}`, 400);
  const F = FINISHES[finish];
  if (!Buffer.isBuffer(front) || !front.length) throw new StudioError('front picture missing', 400);
  if (!(aspect > 0.2 && aspect < 5)) throw new StudioError('aspect must be between 0.2 and 5', 400);
  if (!(depth >= DEPTH_RANGE[0] && depth <= DEPTH_RANGE[1])) throw new StudioError(`depth takes ${DEPTH_RANGE[0]} to ${DEPTH_RANGE[1]}`, 400);
  const images = [front, back].filter(Boolean);
  for (const im of images) if (im.length > MAX_TEXTURE_BYTES) throw new StudioError(`A pack picture is larger than ${MAX_TEXTURE_BYTES / 1024 / 1024} MB`, 413);
  const g = pillow(aspect, depth);
  const P = Buffer.from(new Float32Array(g.pos).buffer), N = Buffer.from(new Float32Array(g.nrm).buffer), U = Buffer.from(new Float32Array(g.uv).buffer);
  const I = g.idx.map((list) => pad4(Buffer.from(new Uint16Array(list).buffer), 0));
  const T = images.map((im) => pad4(im, 0));
  const parts = [P, N, U, ...I, ...T];
  const bin = Buffer.concat(parts);
  let off = 0;
  const bufferViews = parts.map((b, i) => {
    const bv = { buffer: 0, byteOffset: off, byteLength: i < 3 ? b.length : i < 6 ? g.idx[i - 3].length * 2 : images[i - 6].length };
    if (i < 3) bv.target = 34962; else if (i < 6) bv.target = 34963;
    off += b.length;
    return bv;
  });
  const count = g.pos.length / 3;
  // A picture surface: a soft plastic sheen, opaque (the inset UVs stay inside the print, so no see-through border
  // becomes a hole), two-sided, so a pulled-out face still shows from behind.
  const tex = (i, rough) => ({ pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: rough }, doubleSided: true,
    ...(F.coat ? { extensions: { KHR_materials_clearcoat: F.coat } } : {}) });
  const gltf = {
    // Three named nodes, so a model scene can explode the front or the back away from the rim.
    asset: { version: '2.0', generator: 'Motion Studio pack-glb' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }],
    nodes: PART_NAMES.map((name, i) => ({ mesh: i, name })),
    meshes: [0, 1, 2].map((i) => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 + i, material: i }] })),
    materials: [tex(0, F.face), tex(back ? 1 : 0, F.face), tex(0, F.rim)],
    ...(F.coat ? { extensionsUsed: ['KHR_materials_clearcoat'] } : {}),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    textures: images.map((_, i) => ({ source: i, sampler: 0 })),
    images: images.map((im, i) => ({ bufferView: 6 + i, mimeType: mimeOf(im) })),
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: g.min, max: g.max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      ...g.idx.map((list, i) => ({ bufferView: 3 + i, componentType: 5123, count: list.length, type: 'SCALAR' })),
    ],
  };
  const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(CHUNK_JSON, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([head, jh, json, bh, bin]);
}

/** The JSON chunk of a .glb buffer (for tests and checks). */
export function glbJson(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

/** The pack's bounds inside a picture with empty (transparent or black) margins, from ffmpeg's cropdetect. */
export async function detectPackCrop(file) {
  const log = await ffmpegReport(['-i', file, '-vf', 'format=rgba,premultiply=inplace=1,cropdetect=limit=24:round=2:skip=0:reset=0', '-frames:v', '1', '-f', 'null', '-']);
  const hits = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!hits.length) throw new StudioError(`ffmpeg found no pack in ${path.basename(file)}`, 400);
  const [, w, h, x, y] = hits[hits.length - 1].map(Number);
  if (!(w > 8 && h > 8)) throw new StudioError(`${path.basename(file)} looks empty`, 400);
  return { w, h, x, y };
}

/**
 * Trims one picture to `crop` and writes it as PNG (at most 2048 px on the long side). A detailed photo can come out
 * past MAX_TEXTURE_BYTES as a 2048 px PNG, so it steps down until it fits; PNG keeps a cut-out pack's transparency.
 */
async function trimPicture(src, dst, { w, h, x, y }) {
  let png;
  for (const side of [2048, 1536, 1024]) {
    const vf = `crop=${w}:${h}:${x}:${y},scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease,format=rgba`;
    await ffmpeg(['-y', '-i', src, '-vf', vf, '-frames:v', '1', dst]);
    png = fs.readFileSync(dst);
    if (png.length <= MAX_TEXTURE_BYTES) break;
  }
  return png;
}

/**
 * `pack-glb`: trims the brand's front (and back) pack pictures with ffmpeg, builds the box and saves it as
 * `profiles/<project>/assets/<name>`. Returns { name, bytes, crop, aspect }.
 */
export async function makePackGlb(project, { front, back, name, depth = 0.3, finish = 'satin', replace = false } = {}) {
  if (!Object.hasOwn(FINISHES, finish)) throw new StudioError(`--finish takes ${Object.keys(FINISHES).join(', ')}`, 400);
  const assets = path.join(profileDir(project), 'assets');
  const pic = (f, what) => {
    assertFileName(f, what);
    if (!IMAGE_EXT.includes(path.extname(f).slice(1).toLowerCase()) || /\.svg$/i.test(f)) throw new StudioError(`${what} must be a .png, .jpg or .webp asset`, 400);
    const file = within(assets, f);
    if (!fs.existsSync(file)) throw new StudioError(`${what} asset ${f} not found`, 404);
    return file;
  };
  const frontFile = pic(front, 'front');
  const backFile = back ? pic(back, 'back') : null;
  const out = name || `${path.basename(front, path.extname(front))}.glb`;
  assertFileName(out, 'name');
  if (!/\.glb$/i.test(out)) throw new StudioError('name must end in .glb', 400);
  const d = Number(depth);
  if (!(d >= DEPTH_RANGE[0] && d <= DEPTH_RANGE[1])) throw new StudioError(`--depth takes ${DEPTH_RANGE[0]} to ${DEPTH_RANGE[1]}`, 400);
  // A work folder of its own per run under out/<project>/_pack-glb (never a job id: ids start with a letter or digit),
  // removed whatever happens.
  const work = within(DIRS.out, assertId(project, 'project'), '_pack-glb', `${process.pid}-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const crop = await detectPackCrop(frontFile);
    const frontPng = await trimPicture(frontFile, path.join(work, 'front.png'), crop);
    const backPng = backFile ? await trimPicture(backFile, path.join(work, 'back.png'), await detectPackCrop(backFile)) : null;
    const aspect = crop.w / crop.h;
    const glb = packGlb({ front: frontPng, back: backPng, aspect, depth: d, finish });
    const saved = saveAsset(project, out, glb, { replace });
    return { ...saved, crop, aspect: Math.round(aspect * 1000) / 1000 };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    // The parent goes too once no other run is using it.
    try { fs.rmdirSync(path.dirname(work)); } catch { /* another run's folder is still there */ }
  }
}
