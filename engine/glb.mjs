// A small glTF 2.0 binary (.glb) written from code: a torus with normals and one PBR material. The Templates tab
// shows it in a model scene's sample, and the tests load it, so neither needs a 3D file from anywhere.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

/** True when `buf` starts like a glTF 2.0 binary. */
export const isGlb = (buf) => buf.length >= 20 && buf.readUInt32LE(0) === GLB_MAGIC && buf.readUInt32LE(4) === 2;

function torus(R = 0.7, r = 0.3, U = 64, V = 32) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= U; i++) {
    const u = (i / U) * Math.PI * 2;
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * Math.PI * 2, cx = Math.cos(u), sx = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      pos.push((R + r * cv) * cx, r * sv, (R + r * cv) * sx);
      nrm.push(cv * cx, sv, cv * sx);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j, b = (i + 1) * (V + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return { pos, nrm, idx };
}

const pad4 = (buf, fill) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), fill)]) : buf);

/** The sample model as a Buffer: a brand-neutral blue-grey torus, about two units across. */
export function sampleGlb(color = [0.36, 0.45, 0.62]) {
  const { pos, nrm, idx } = torus();
  const P = Buffer.from(new Float32Array(pos).buffer), N = Buffer.from(new Float32Array(nrm).buffer);
  const I = pad4(Buffer.from(new Uint16Array(idx).buffer), 0);
  const bin = Buffer.concat([P, N, I]);
  const count = pos.length / 3, min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k))), max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
  const gltf = {
    asset: { version: '2.0', generator: 'Motion Studio' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'sample' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0.3, roughnessFactor: 0.35 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: P.length, target: 34962 },
      { buffer: 0, byteOffset: P.length, byteLength: N.length, target: 34962 },
      { buffer: 0, byteOffset: P.length + N.length, byteLength: idx.length * 2, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  };
  const json = pad4(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(CHUNK_JSON, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([head, jh, json, bh, bin]);
}
