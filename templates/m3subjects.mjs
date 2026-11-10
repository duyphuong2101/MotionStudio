// The other 3D subjects a model canvas (templates/model3d.mjs) can draw instead of a .glb: solid type, a logo
// extruded from its picture, a device with a screen, points that settle into a form, photo cards, a globe and 3D bars.
// Each is a module script that registers window.__m3.<subject>, written into a page only when the page holds one; the
// shared library (M3_LIB_JS) comes first. A builder returns { root, tick(u, k, ctx), pose, shadow, fit, size, fill,
// ground }: MODEL_JS fits, lights and frames root like a model and calls tick at every draw. Everything is a pure
// function of the scene time u: scatter comes from an integer hash, never Math.random.
import { LAND_BITS } from './globe-land.mjs';

export const M3_LIB_JS = String.raw`
<script type="module">
import * as THREE from 'three';
// An integer hash in [0, 1): the same scatter on every render.
const hash = (n) => { let x = Math.imul((n | 0) ^ 0x5bd1e995, 0x9e3779b1); x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const clamp01 = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k);
const expo = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const backOut = (k) => { k = clamp01(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// The page's own font, loaded before a canvas draws with it (a font still loading would draw the fallback).
const font = async (role, weight, px) => {
  const f = weight + ' ' + px + 'px ' + (cssVar(role === 'body' ? '--body' : '--display') || 'system-ui, sans-serif');
  try { await document.fonts.load(f); } catch (e) { /* the fallback font draws */ }
  return f;
};
// Every 2D canvas a subject draws is a CPU canvas (willReadFrequently): a GPU canvas on SwiftShader can differ by a
// level here and there from one render to the next, and the traced outlines and the textures must not.
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); c.getContext('2d', { willReadFrequently: true }); return c; };
const decoded = async (img) => { if (img && img.decode) await img.decode().catch(() => {}); return img; };
// A picture drawn into a canvas no larger than maxW x maxH, with a clear margin of pad pixels.
const picture = (img, maxW, maxH, pad = 0) => {
  const iw = img.naturalWidth || 1000, ih = img.naturalHeight || 400, s = Math.min(maxW / iw, maxH / ih);
  const c = canvas(iw * s + 2 * pad, ih * s + 2 * pad);
  c.getContext('2d').drawImage(img, pad, pad, c.width - 2 * pad, c.height - 2 * pad);
  return c;
};
// A word in the display font: the canvas, each letter's left edge (xs, one more for the end) and the ascent.
const wordCanvas = async (text, fill, weight = 800, px = 220) => {
  const f = await font('display', weight, px), chars = [...String(text)];
  const m = canvas(2, 2).getContext('2d'); m.font = f;
  const tm = m.measureText(chars.join('')), l = Math.ceil(tm.actualBoundingBoxLeft || 0), r = Math.ceil(Math.max(tm.actualBoundingBoxRight || 0, tm.width));
  const asc = Math.ceil(tm.actualBoundingBoxAscent || px * 0.8), desc = Math.ceil(tm.actualBoundingBoxDescent || px * 0.2), pad = 14;
  const c = canvas(l + r + 2 * pad, asc + desc + 2 * pad), x = c.getContext('2d');
  x.font = f; x.textBaseline = 'alphabetic';
  x.fillStyle = typeof fill === 'function' ? fill(x, c) : fill;
  x.fillText(chars.join(''), pad + l, pad + asc);
  const xs = chars.map((_, i) => pad + l + m.measureText(chars.slice(0, i).join('')).width);
  xs.push(pad + l + tm.width);
  return { c, xs, asc, chars };
};
// The picture's colours bled a few pixels past its edge, so a texture sampled at the traced outline never shows the
// black of the clear pixels around it.
const bleed = (c) => {
  const o = canvas(c.width, c.height), x = o.getContext('2d');
  for (let r = 4; r >= 1; r--) for (let k = 0; k < 8; k++) x.drawImage(c, Math.round(Math.cos(k * Math.PI / 4) * r), Math.round(Math.sin(k * Math.PI / 4) * r));
  x.drawImage(c, 0, 0);
  return o;
};
// The mean colour of a picture's solid pixels (linear), for the sides of its slab.
const meanColor = (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : new THREE.Color(0x333333);
};

// Marching squares over a canvas's alpha at iso: closed outlines in pixel coordinates, each point on the cell edge
// where the alpha crosses iso (so an antialiased edge gives a smooth outline). Every edge point joins exactly two
// segments, so walking from neighbour to neighbour closes each loop.
const trace = (c, iso = 128) => {
  const W = c.width, H = c.height, a = c.getContext('2d').getImageData(0, 0, W, H).data, RW = W + 2;
  const v = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : a[(y * W + x) * 4 + 3]);
  const pos = new Map(), adj = new Map();
  const at = (key, x0, y0, x1, y1) => {
    if (!pos.has(key)) { const a0 = v(x0, y0), f = (iso - a0) / (v(x1, y1) - a0); pos.set(key, [x0 + (x1 - x0) * f + 0.5, y0 + (y1 - y0) * f + 0.5]); }
    return key;
  };
  const link = (p, q) => { if (!adj.has(p)) adj.set(p, []); if (!adj.has(q)) adj.set(q, []); adj.get(p).push(q); adj.get(q).push(p); };
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const tl = v(x, y), tr = v(x + 1, y), br = v(x + 1, y + 1), bl = v(x, y + 1);
    const c4 = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
    if (c4 === 0 || c4 === 15) continue;
    const k = ((y + 1) * RW + x + 1) * 2;
    const T = () => at(k, x, y, x + 1, y), B = () => at(k + RW * 2, x, y + 1, x + 1, y + 1);
    const L = () => at(k + 1, x, y, x, y + 1), R = () => at(k + 3, x + 1, y, x + 1, y + 1);
    const mid = (tl + tr + br + bl) / 4 >= iso;
    switch (c4) {
      case 1: case 14: link(L(), B()); break;
      case 2: case 13: link(B(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(T(), R()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), T()); break;
      case 5: if (mid) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); } break;
      case 10: if (mid) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
    }
  }
  const loops = [], seen = new Set();
  for (const first of adj.keys()) {
    if (seen.has(first)) continue;
    const loop = [];
    let prev = -1, cur = first;
    while (!seen.has(cur)) {
      seen.add(cur); loop.push(pos.get(cur));
      const n = adj.get(cur), nx = n[0] !== prev ? n[0] : n[1];
      prev = cur; cur = nx;
    }
    if (loop.length > 2) loops.push(simplify(loop, 0.6));
  }
  return loops;
};
// Douglas-Peucker on an open run, without recursion.
const rdp = (pts, eps) => {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop(), a = pts[i0], b = pts[i1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let dmax = 0, idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i], d = L ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
};
// A closed loop: split at the point farthest from the first, simplify both halves.
const simplify = (pts, eps) => {
  let far = 0, dm = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > dm) { dm = d; far = i; } });
  const a = rdp(pts.slice(0, far + 1), eps), b = rdp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
};
const area = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return s / 2; };
const inside = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// Outlines into solid shapes: a loop inside an even number of others is solid, inside an odd number a hole of the
// smallest loop around it. Specks below minArea are dropped.
const shapes = (loops, minArea) => {
  const L = loops.map((p) => ({ p, a: Math.abs(area(p)), depth: 0, parent: null })).filter((l) => l.a >= minArea);
  for (const l of L) for (const o of L) if (o !== l && o.a > l.a && inside(l.p[0], o.p)) { l.depth++; if (!l.parent || o.a < l.parent.a) l.parent = o; }
  const out = L.filter((l) => l.depth % 2 === 0).map((l) => ({ l, outer: l.p, holes: [] }));
  for (const l of L) if (l.depth % 2 === 1 && l.parent) { const o = out.find((s) => s.l === l.parent); if (o) o.holes.push(l.p); }
  return out;
};
/**
 * A picture as a solid: its outline traced from the alpha and extruded by depth pixels, the front showing the
 * picture, the bevelled sides and the back in side. One piece per separate shape (a letter, a part of a logo), each a
 * group at its own centre so it can turn and fly on its own and land back in place; all in the picture's pixel frame,
 * centred on the picture, y up.
 */
const slab = (c, { depth, side }) => {
  const W = c.width, H = c.height;
  const tex = new THREE.CanvasTexture(bleed(c)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const front = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.25 });
  const wall = new THREE.MeshStandardMaterial({ color: side, roughness: 0.45, metalness: 0.3 });
  const uv = { generateTopUV: (g, vs, a, b, d) => [a, b, d].map((i) => new THREE.Vector2(vs[i * 3] / W, vs[i * 3 + 1] / H)), generateSideWallUV: () => [0, 0, 0, 0].map(() => new THREE.Vector2()) };
  const toV = (p) => new THREE.Vector2(p[0], H - p[1]);
  const bs = Math.min(depth * 0.08, 3);
  const pieces = shapes(trace(c), Math.max(6, W * H * 0.00002)).map((s) => {
    const sh = new THREE.Shape(s.outer.map(toV));
    sh.holes = s.holes.map((hp) => new THREE.Path(hp.map(toV)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bs, bevelSize: bs * 0.6, bevelSegments: 2, curveSegments: 1, UVGenerator: uv });
    // The lid group holds the back faces, then the front ones, in equal halves: the front gets the picture.
    const [lid, sides] = g.groups, half = lid.count / 2;
    g.clearGroups(); g.addGroup(lid.start, half, 2); g.addGroup(lid.start + half, half, 0); g.addGroup(sides.start, sides.count, 1);
    g.translate(-W / 2, -H / 2, -depth / 2); g.computeBoundingBox();
    const centre = g.boundingBox.getCenter(new THREE.Vector3());
    const mesh = new THREE.Mesh(g, [front, wall, wall]); mesh.position.copy(centre).negate();
    const grp = new THREE.Group(); grp.position.copy(centre); grp.add(mesh);
    return { group: grp, centre, area: Math.abs(area(s.outer)) };
  });
  return { pieces, W, H };
};
/**
 * A text label as a sprite that always faces the camera, h world units tall, sized for the longest text it will
 * show (wide); set(text) redraws it in place (the counted values of the 3D bars).
 */
const label = (text, { font: f, color = '#111111', bg = null, h = 0.2, wide = text }) => {
  const px = 96, fo = f.replace(/\d+px/, px + 'px'), m = canvas(2, 2).getContext('2d'); m.font = fo;
  const padX = bg ? Math.round(px * 0.45) : 6, cw = Math.ceil(Math.max(m.measureText(wide).width, m.measureText(text).width)) + 2 * padX, ch = Math.round(px * (bg ? 1.55 : 1.3));
  const c = canvas(cw, ch), x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // Drawn over everything (no depth test): a label must never sink under the clear floor or behind a column.
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.renderOrder = 5; sp.scale.set((h * cw) / ch, h, 1);
  let shown = null;
  sp.userData.set = (t, col = color) => {
    if (t + col === shown) return;
    shown = t + col;
    x.clearRect(0, 0, cw, ch);
    if (bg) { x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, cw, ch, ch / 2); x.fill(); }
    x.font = fo; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = col;
    x.fillText(t, cw / 2, ch / 2 + px * 0.05);
    tex.needsUpdate = true;
  };
  sp.userData.set(text);
  return sp;
};
/**
 * Round soft points: each flies from its start to its place, from its own delay over fly seconds, and shimmers a
 * little once there. Sizes are in local units; tick sets uT (scene seconds) and uSize (local size times the scale the
 * points are drawn at). A point whose delay is far below 0 is simply in place.
 */
const dots = ({ to, from, delay, colors, fly = 1.4, shimmer = 0 }) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(to, 3));
  g.setAttribute('aStart', new THREE.Float32BufferAttribute(from || to, 3));
  g.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uSize: { value: 0.02 }, uPx: { value: 500 }, uFly: { value: fly }, uShim: { value: shimmer } },
    transparent: true, depthWrite: false,
    vertexShader: 'uniform float uT; uniform float uSize; uniform float uPx; uniform float uFly; uniform float uShim;' +
      'attribute vec3 aStart; attribute float aDelay; attribute vec3 aColor; varying vec3 vC; varying float vA;' +
      'void main() { float k = clamp((uT - aDelay) / uFly, 0.0, 1.0); float e = 1.0 - pow(1.0 - k, 3.0);' +
      ' vec3 p = mix(aStart, position, e); float s = (1.0 - e) * length(aStart - position) * 0.18;' +
      ' p += vec3(sin(aDelay * 37.0 + uT * 1.9), cos(aDelay * 23.0 + uT * 1.4), 0.0) * (s + uShim * e * sin(uT * 2.3 + aDelay * 51.0));' +
      ' vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;' +
      ' gl_PointSize = max(1.0, uSize * uPx / -mv.z); vC = aColor; vA = smoothstep(0.0, 0.35, k); }',
    fragmentShader: 'varying vec3 vC; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;' +
      ' gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.3, d));\n#include <colorspace_fragment>\n}',
  });
  return new THREE.Points(g, mat);
};
// Pixels per world unit at distance 1 for a canvas hgt pixels tall (the model camera's 30 degree field).
const pxPerUnit = (hgt) => hgt / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
// A picture as a texture, scaled down first when a side passes 4096 pixels.
const texture = (img) => {
  const iw = img.naturalWidth || 2, ih = img.naturalHeight || 2, s = Math.min(1, 4096 / Math.max(iw, ih));
  const tex = s < 1 ? new THREE.CanvasTexture(picture(img, iw * s, ih * s)) : new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
};
// A white rounded rectangle on black, as an alpha map: the round corners of a screen or a card.
const roundMask = (w, h, r) => {
  const c = canvas(512 * (w / Math.max(w, h)), 512 * (h / Math.max(w, h))), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(0, 0, c.width, c.height, (r / Math.max(w, h)) * 512); x.fill();
  return new THREE.CanvasTexture(c);
};
window.__m3 = window.__m3 || {};
window.__m3lib = { hash, clamp01, expo, smooth, backOut, font, canvas, decoded, picture, wordCanvas, meanColor, trace, shapes, slab, label, dots, pxPerUnit, texture, roundMask };
</script>`;

// Solid type: a short word in the display font as lit letters, each rising and tipping up into place one after
// another, the front in the face colour and the sides a shade darker.
const TYPE_JS = String.raw`
<script type="module">
import * as THREE from 'three';
window.__m3.type = async ({ data: d, lib }) => {
  const { c, xs, asc, chars } = await lib.wordCanvas(d.word, d.color, d.weight || 800, 220);
  const depth = asc * 0.3, side = new THREE.Color(d.color).multiplyScalar(0.45);
  const s = lib.slab(c, { depth, side });
  // Each piece belongs to the letter its centre falls in (an i's dot to its stem).
  const root = new THREE.Group(), letters = chars.map(() => ({ g: new THREE.Group(), n: 0, cen: new THREE.Vector3() }));
  for (const p of s.pieces) {
    const x = p.centre.x + s.W / 2;
    let i = 0; for (let j = 0; j < chars.length; j++) if (x >= xs[j]) i = j;
    letters[i].g.add(p.group); letters[i].n++; letters[i].cen.add(p.centre);
  }
  const live = letters.filter((l) => l.n);
  live.forEach((l) => { l.cen.divideScalar(l.n); l.g.children.forEach((ch) => ch.position.sub(l.cen)); l.g.position.copy(l.cen); root.add(l.g); });
  const tick = (u) => live.forEach((l, i) => {
    const p = (u - 0.1 - i * 0.065) / 0.75, e = lib.expo(p), r = 1 - e;
    l.g.visible = p > 0;
    l.g.position.set(l.cen.x, l.cen.y - r * s.H * 0.55, l.cen.z + r * depth * 1.5);
    l.g.rotation.set(r * 1.1, 0, 0); l.g.scale.setScalar(0.7 + 0.3 * e);
  });
  return { root, tick, pose: [0, 0.1] };
};
</script>`;

// A logo extruded from its picture (SVG or PNG, or the brand name when there is none): the pieces fly in from
// scattered places and turns and land in place left to right.
const LOGO_JS = String.raw`
<script type="module">
import * as THREE from 'three';
window.__m3.logo = async ({ data: d, pics, lib }) => {
  const c = pics[0] ? lib.picture(await lib.decoded(pics[0]), 1100, 460, 12) : (await lib.wordCanvas(d.word || 'Logo', d.color, d.weight || 800, 220)).c;
  const side = d.side ? new THREE.Color(d.side) : lib.meanColor(c).multiplyScalar(0.5);
  const s = lib.slab(c, { depth: c.height * 0.16, side });
  const root = new THREE.Group(), list = [...s.pieces].sort((a, b) => a.centre.x - b.centre.x);
  list.forEach((p) => root.add(p.group));
  const n = list.length;
  const tick = (u) => list.forEach((p, i) => {
    const q = (u - 0.05 - (n > 1 ? (i / (n - 1)) * 0.55 : 0)) / 0.95, e = lib.expo(q), r = 1 - e;
    p.group.visible = q > 0;
    p.group.position.set(p.centre.x + (lib.hash(i * 3 + 1) - 0.5) * s.W * 0.7 * r, p.centre.y + (lib.hash(i * 3 + 2) - 0.5) * s.H * 1.6 * r, p.centre.z + s.H * (1 + lib.hash(i * 3 + 3)) * r);
    p.group.rotation.set((lib.hash(i * 5 + 1) - 0.5) * 2.6 * r, (lib.hash(i * 5 + 2) - 0.5) * 2.6 * r, (lib.hash(i * 5 + 3) - 0.5) * 1.4 * r);
  });
  return { root, tick, pose: [0, 0.06] };
};
</script>`;

// A device with the screen picture: phone, tablet (turned to landscape for a wide picture) or laptop (its lid opens
// as the scene starts). A picture taller than the screen scrolls from top to bottom while the voice runs; the
// screen keeps its true colours under a faint glass that catches the studio light.
const DEVICE_JS = String.raw`
<script type="module">
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
window.__m3.device = async ({ data: d, pics, lib }) => {
  const img = await lib.decoded(pics[0]), iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
  const kind = d.device || 'phone';
  const shell = new THREE.MeshPhysicalMaterial({ color: 0x5a6069, metalness: 0.6, roughness: 0.32, clearcoat: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.55 });
  let scroll = null;
  // The screen: the picture covering sw x sh (cropped at the sides when wider, scrolled when much taller).
  const screen = (sw, sh, r) => {
    const tex = lib.texture(img), ia = iw / ih, sa = sw / sh;
    if (ia > sa) { tex.repeat.set(sa / ia, 1); tex.offset.set((1 - sa / ia) / 2, 0); }
    else { const ry = ia / sa; tex.repeat.set(1, ry); tex.offset.set(0, 1 - ry); if (ry < 0.93) scroll = { tex, top: 1 - ry }; }
    const mask = lib.roundMask(sw, sh, r), g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex, alphaMap: mask, alphaTest: 0.5, toneMapped: false })));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.06, transparent: true, opacity: 0.14, alphaMap: mask, depthWrite: false }));
    glass.position.z = 0.002; g.add(glass);
    return g;
  };
  const root = new THREE.Group();
  let lid = null;
  if (kind === 'laptop') {
    const base = new THREE.Mesh(new RoundedBoxGeometry(3, 0.07, 2.05, 3, 0.03), shell); base.position.y = 0.035; root.add(base);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), black); deck.rotation.x = -Math.PI / 2; deck.position.set(0, 0.0705, -0.3); root.add(deck);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.55), new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.4, metalness: 0.5 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.0705, 0.6); root.add(pad);
    lid = new THREE.Group(); lid.position.set(0, 0.07, -1.0); root.add(lid);
    const back = new THREE.Mesh(new RoundedBoxGeometry(3, 1.95, 0.05, 3, 0.025), shell); back.position.set(0, 0.975, -0.025); lid.add(back);
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(2.96, 1.91), black); bezel.position.set(0, 0.975, 0.001); lid.add(bezel);
    const scr = screen(2.84, 1.74, 0.02); scr.position.set(0, 0.99, 0.003); lid.add(scr);
    lid.rotation.x = -0.3;
  } else {
    const land = kind === 'tablet' && iw > ih;
    const [W, H, D, R, SW, SH, SR] = kind === 'tablet' ? (land ? [2, 1.5, 0.06, 0.09, 1.9, 1.4, 0.05] : [1.5, 2, 0.06, 0.09, 1.4, 1.9, 0.05]) : [1, 2.06, 0.085, 0.13, 0.93, 1.99, 0.11];
    root.add(new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, R), shell));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), black); front.position.z = D / 2 + 0.0005; root.add(front);
    const scr = screen(SW, SH, SR); scr.position.z = D / 2 + 0.0015; root.add(scr);
    if (kind === 'phone') {
      const pill = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.075, 0.004, 2, 0.0375), black); pill.position.set(0, SH / 2 - 0.08, D / 2 + 0.004); root.add(pill);
      const cam = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.36, 0.03, 3, 0.08), shell); cam.position.set(-0.24, 0.76, -D / 2 - 0.012); root.add(cam);
    }
  }
  const tick = (u, k) => {
    if (lid) lid.rotation.x = 1.52 + (-0.3 - 1.52) * lib.smooth((u - 0.1) / 1.1);
    if (scroll) scroll.tex.offset.y = scroll.top * (1 - lib.smooth((k - 0.25) / 0.55));
  };
  return { root, tick, pose: kind === 'laptop' ? [0.5, 0.42] : [0.42, 0.1] };
};
</script>`;

// Points that fly in from all around and settle into a form: a word in the display font, an icon or the logo (its
// own colours; the word and the icon in a brand gradient), sweeping in left to right, then shimmering softly.
const SWARM_JS = String.raw`
<script type="module">
import * as THREE from 'three';
window.__m3.swarm = async ({ data: d, pics, lib, hgt }) => {
  const grad = (x, c) => { const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, d.colors[0]); g.addColorStop(1, d.colors[1]); return g; };
  let c;
  if (d.form === 'logo' && pics[0]) c = lib.picture(await lib.decoded(pics[0]), 760, 380, 8);
  else if (d.form === 'icon' && d.icon) {
    c = lib.canvas(460, 512); const x = c.getContext('2d');
    x.translate(30, 30); x.scale(4, 4); x.fillStyle = x.strokeStyle = grad(x, { width: 100, height: 112 }); x.lineWidth = 5; x.lineJoin = x.lineCap = 'round';
    const p = new Path2D(d.icon); x.stroke(p); x.fill(p);
  } else c = (await lib.wordCanvas(d.word || 'Hello', grad, d.weight || 800, 200)).c;
  const W = c.width, H = c.height, px = c.getContext('2d').getImageData(0, 0, W, H).data;
  let solid = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) solid++;
  const N = 4200, step = Math.max(1.5, Math.sqrt(solid / N)), R = Math.max(W, H) * 0.55;
  const to = [], from = [], delay = [], colors = [], col = new THREE.Color();
  let i = 0;
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
    i++;
    const jx = Math.min(W - 1, Math.max(0, Math.round(x + (lib.hash(i * 2) - 0.5) * step * 0.8))), jy = Math.min(H - 1, Math.max(0, Math.round(y + (lib.hash(i * 2 + 1) - 0.5) * step * 0.8)));
    const o = (jy * W + jx) * 4;
    if (px[o + 3] <= 128) continue;
    to.push(jx - W / 2, H / 2 - jy, (lib.hash(i * 7) - 0.5) * step * 2);
    const th = lib.hash(i * 11) * Math.PI * 2, ph = Math.acos(2 * lib.hash(i * 13) - 1), r = R * (0.7 + 0.6 * lib.hash(i * 17));
    from.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th) + R * 0.4);
    delay.push(0.1 + (jx / W) * 0.6 + lib.hash(i * 19) * 0.35);
    col.setRGB(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, THREE.SRGBColorSpace);
    colors.push(col.r, col.g, col.b);
  }
  const pts = lib.dots({ to, from, delay, colors, fly: 1.4, shimmer: step * 0.12 });
  pts.material.uniforms.uPx.value = lib.pxPerUnit(hgt);
  const root = new THREE.Group(); root.add(pts);
  const tick = (u, k, { pivot }) => { pts.material.uniforms.uT.value = u; pts.material.uniforms.uSize.value = step * 1.2 * pivot.scale.x; };
  return { root, tick, shadow: false, pose: [0, 0] };
};
</script>`;

// Photo cards: each photo as an instant print (its caption under it) in 3D space. row: the camera glides along a
// row of tilted prints, settling on each in turn; fan: the prints rise one by one into a fanned hand; ring: the prints
// stand round a turning ring that brings each to the front in turn.
const CARDS_JS = String.raw`
<script type="module">
import * as THREE from 'three';
window.__m3.cards = async ({ data: d, pics, lib }) => {
  const f = await lib.font('body', 600, 40), n = pics.length, arrange = d.arrange || 'row';
  const paper = new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.7 });
  const card = (img, cap) => {
    const c = lib.canvas(512, 625), x = c.getContext('2d');
    x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, 512, 625);
    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1, s = Math.max(456 / iw, 456 / ih);
    x.save(); x.beginPath(); x.rect(28, 28, 456, 456); x.clip(); x.drawImage(img, 28 + (456 - iw * s) / 2, 28 + (456 - ih * s) / 2, iw * s, ih * s); x.restore();
    if (cap) {
      x.font = f; x.fillStyle = d.ink || '#1f2937'; x.textAlign = 'center'; x.textBaseline = 'middle';
      let t = cap; while (t.length > 1 && x.measureText(t).width > 470) t = t.slice(0, -2) + '…';
      x.fillText(t, 256, 556);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    return new THREE.Mesh(new THREE.BoxGeometry(1, 1.22, 0.012), [paper, paper, paper, paper, front, paper]);
  };
  const imgs = await Promise.all(pics.map((p) => lib.decoded(p)));
  const cards = imgs.map((img, i) => card(img, (d.captions || [])[i] || ''));
  const root = new THREE.Group(), set = new THREE.Group(); root.add(set);
  cards.forEach((m) => set.add(m));
  const mid = (n - 1) / 2, ringR = Math.max(1.3, n * 0.36);
  // Which card is in front: a smooth step from card to card across most of the scene, resting on each.
  const at = (k) => { const p = lib.clamp01((k - 0.12) / 0.76) * (n - 1), i = Math.min(n - 2, Math.floor(p)); return n < 2 ? 0 : i + lib.smooth(p - i); };
  const tick = (u, k) => cards.forEach((m, i) => {
    if (arrange === 'fan') {
      const e = lib.expo((u - 0.1 - (n > 1 ? (i / (n - 1)) * 0.9 : 0)) / 0.8), r = 1 - e, a = (i - mid) * 0.2;
      m.visible = e > 0;
      m.position.set((i - mid) * 0.62 * e, -Math.abs(i - mid) * 0.07 - 1.8 * r, i * 0.02);
      m.rotation.set(0, 0, -a * e + 0.5 * r);
    } else if (arrange === 'ring') {
      const th = (i / n) * Math.PI * 2, e = lib.expo(u / 0.9);
      m.position.set(Math.sin(th) * ringR, 0, Math.cos(th) * ringR); m.rotation.set(0, th, 0);
      set.rotation.y = -(at(k) / n) * Math.PI * 2; set.position.set(0, -0.6 * (1 - e), -ringR); set.scale.setScalar(0.75 + 0.25 * e);
    } else {
      const e = lib.expo((u - 0.05 - i * 0.08) / 0.8), r = 1 - e;
      m.visible = e > 0;
      m.position.set(i * 1.3, 1.6 * r, 0); m.rotation.set(-0.6 * r, -0.28, 0.25 * r);
      set.position.x = -at(k) * 1.3;
    }
  });
  const size = arrange === 'fan' ? [(n - 1) * 0.62 + 1.3, 1.45, 0.3] : arrange === 'ring' ? [2.1, 1.3, 0.2] : [2.5, 1.3, 0.3];
  return { root, tick, shadow: false, size, fill: 0.94, pose: [0, 0.06] };
};
</script>`;

// A globe: the oceans in the brand primary, the land as dots, a soft rim of light. It turns to face the places,
// which pop up one after another with a pulsing ring and a label, then arcs draw between them (from the first to
// each other place, or in order).
const GLOBE_JS = String.raw`
<script type="module">
import * as THREE from 'three';
const LAND = Uint8Array.from(atob('` + LAND_BITS + String.raw`'), (ch) => ch.charCodeAt(0));
const isLand = (lat, lon) => { const k = Math.min(179, Math.floor(90 - lat)) * 360 + Math.min(359, Math.floor(lon + 180)); return (LAND[k >> 3] >> (k & 7)) & 1; };
const onSphere = (lat, lon, r = 1) => { const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon); return new THREE.Vector3(Math.cos(a) * Math.sin(b) * r, Math.sin(a) * r, Math.cos(a) * Math.cos(b) * r); };
window.__m3.globe = async ({ data: d, lib, hgt }) => {
  const f = await lib.font('body', 700, 64);
  const ocean = new THREE.Color(d.ocean), land = ocean.clone().lerp(new THREE.Color(0xffffff), 0.6), accent = new THREE.Color(d.accent);
  const root = new THREE.Group(), globe = new THREE.Group(); root.add(globe);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshStandardMaterial({ color: ocean, roughness: 0.75, metalness: 0.1 }));
  globe.add(ball);
  // Land dots on a Fibonacci sphere, kept where the 1-degree land map says land.
  const N = 14000, to = [], colors = [], delay = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, lat = THREE.MathUtils.radToDeg(Math.asin(y)), lon = ((((i * 137.50776405) % 360) + 360) % 360) - 180;
    if (!isLand(lat, lon)) continue;
    const p = onSphere(lat, lon, 1.004); to.push(p.x, p.y, p.z); colors.push(land.r, land.g, land.b); delay.push(-100);
  }
  const ld = lib.dots({ to, delay, colors }); ld.material.uniforms.uPx.value = lib.pxPerUnit(hgt); ld.material.uniforms.uT.value = 0; globe.add(ld);
  // A rim of light round the edge.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 48, 32), new THREE.ShaderMaterial({
    uniforms: { uC: { value: accent.clone().lerp(new THREE.Color(0xffffff), 0.5) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uC; varying vec3 vN; void main() { float r = pow(1.0 - abs(vN.z), 3.0); gl_FragColor = vec4(uC * r * 0.9, 1.0);\n#include <colorspace_fragment>\n}',
  })));
  const pts = d.points.map((p, i) => {
    const at = onSphere(p.lat, p.lon), g = new THREE.Group();
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), new THREE.MeshBasicMaterial({ color: accent })); pin.position.copy(at.clone().multiplyScalar(1.01));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 32), new THREE.MeshBasicMaterial({ color: accent, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(at.clone().multiplyScalar(1.006)); ring.lookAt(at.clone().multiplyScalar(2));
    const tag = p.label ? lib.label(p.label, { font: f, color: d.ink, bg: '#ffffff', h: 0.12 }) : null;
    if (tag) { tag.position.copy(at.clone().multiplyScalar(1.05)); tag.center.set(0.5, -0.35); g.add(tag); }
    g.add(pin, ring); globe.add(g);
    return { at, g, pin, ring, tag, k: 0.08 + (d.points.length > 1 ? (i / (d.points.length - 1)) * 0.47 : 0) };
  });
  // Arcs: great-circle curves lifted by their length, drawn from the start as the later of their two places is in.
  const pairs = d.arcs === 'none' ? [] : pts.slice(1).map((_, i) => (d.arcs === 'chain' ? [i, i + 1] : [0, i + 1]));
  const arcs = pairs.map(([a, b]) => {
    const p0 = pts[a].at, p1 = pts[b].at, ang = p0.angleTo(p1), m = p0.clone().add(p1).normalize().multiplyScalar(1 + 0.35 * ang);
    const geo = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0.clone().multiplyScalar(1.01), m, p1.clone().multiplyScalar(1.01)), 64, 0.008, 6);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: accent })); globe.add(mesh);
    return { mesh, n: geo.index.count, k: Math.max(pts[a].k, pts[b].k) };
  });
  // The globe turns to face the places' mean direction (latitude held within 35 degrees), from a little way off.
  const mean = pts.reduce((v, p) => v.add(p.at), new THREE.Vector3());
  if (mean.lengthSq() < 1e-6) mean.set(0, 0, 1);
  mean.normalize();
  const latM = Math.max(-0.61, Math.min(0.61, Math.asin(mean.y))), lonM = Math.atan2(mean.x, mean.z);
  const tick = (u, k, { len, pivot }) => {
    ld.material.uniforms.uSize.value = 0.02 * pivot.scale.x;
    globe.rotation.set(latM * 0.85, -lonM - (1 - lib.expo(u / 1.8)) * 0.9 - u * 0.03, 0);
    for (const p of pts) {
      const at = p.k * len, e = lib.backOut((u - at) / 0.35), on = u >= at;
      p.g.visible = on; p.pin.scale.setScalar(Math.max(1e-3, e));
      const ph = ((u - at) * 0.8) % 1;
      p.ring.scale.setScalar(1 + 1.6 * ph); p.ring.material.opacity = on ? 0.85 * (1 - ph) : 0;
      if (p.tag) p.tag.material.opacity = lib.smooth((u - at - 0.1) / 0.3);
    }
    for (const a of arcs) { const e = lib.smooth((u - a.k * len - 0.15) / 0.9); a.mesh.visible = e > 0; a.mesh.geometry.setDrawRange(0, Math.floor((a.n * e) / 3) * 3); }
  };
  // Framed on the ball itself: the labels and arcs must not pull it off centre or shrink it.
  return { root, tick, shadow: false, fit: 'sphere', fill: 0.92, bounds: ball, sphere: new THREE.Sphere(new THREE.Vector3(), 1), pose: [0, 0] };
};
</script>`;

// 3D bars: lit columns standing on a floor, growing one after another, each value counting up above its column and
// the label under it; two series stand in pairs, a reference value is a thin green rail across.
const BARS_JS = String.raw`
<script type="module">
import * as THREE from 'three';
window.__m3.bars = async ({ data: d, lib }) => {
  const f = await lib.font('body', 700, 64), fl = await lib.font('body', 600, 64);
  const n = d.items.length, gx = 1.25, HM = 2.4, bw = d.two ? 0.42 : 0.66, max = d.max || 1;
  const fmt = (v) => (d.format === 'money' ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: d.dec, maximumFractionDigits: d.dec })
    : d.format === 'pct' ? v.toFixed(d.dec) + '%' : d.format === 'dec' ? v.toFixed(d.dec) : Math.round(v).toLocaleString('en-US')) + (d.unit ? ' ' + d.unit : '');
  const root = new THREE.Group(), cols = [];
  d.items.forEach((it, k) => {
    const vals = d.two ? [it.v, it.v2] : [it.v];
    vals.forEach((v, j) => {
      const hgt = Math.max(0.02, (v / max) * HM), x = (k - (n - 1) / 2) * gx + (d.two ? (j ? 0.24 : -0.24) : 0);
      const geo = new THREE.BoxGeometry(bw, 1, bw); geo.translate(0, 0.5, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: d.colors[d.two ? j : k % d.colors.length], roughness: 0.42, metalness: 0.12 }));
      m.position.x = x; m.scale.y = hgt; root.add(m);
      const tone = it.tone || d.tone, col = tone === 'up' ? d.up : tone === 'down' ? d.down : d.ink;
      const val = lib.label(fmt(v), { font: f, color: col, h: d.two ? 0.26 : 0.34, wide: fmt(v) }); val.center.set(0.5, 0); root.add(val);
      cols.push({ m, val, v, hgt, x, k, col });
    });
    const tag = lib.label(it.label, { font: fl, color: d.ink, h: 0.26 }); tag.center.set(0.5, 1); tag.position.set((k - (n - 1) / 2) * gx, -0.08, bw / 2 + 0.25); root.add(tag);
  });
  if (d.ref) {
    const y = (d.ref.v / max) * HM, w = n * gx;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.018, 0.018), new THREE.MeshBasicMaterial({ color: 0x15803d })); rail.position.set(0, y, bw / 2 + 0.04); root.add(rail);
    if (d.ref.label) { const t = lib.label(d.ref.label, { font: fl, color: '#15803d', bg: '#ffffff', h: 0.22 }); t.center.set(1, -0.2); t.position.set(w / 2, y, bw / 2 + 0.05); root.add(t); }
  }
  const tick = (u) => {
    root.rotation.y = 0.08 * Math.sin(u * 0.3) - 0.04;
    for (const c of cols) {
      const e = lib.expo((u - 0.35 - c.k * 0.14) / 1.1);
      c.m.scale.y = Math.max(1e-3, c.hgt * e); c.m.visible = e > 0;
      c.val.position.set(c.x, c.hgt * e + 0.06, 0); c.val.visible = e > 0;
      c.val.userData.set(fmt(c.v * e), c.col);
    }
  };
  return { root, tick, size: [n * gx + 0.5, HM + 1.0, 1.6], fill: 0.94, ground: 0, pose: [0.4, 0.24] };
};
</script>`;

export const SUBJECT_JS = { type: TYPE_JS, logo: LOGO_JS, device: DEVICE_JS, swarm: SWARM_JS, cards: CARDS_JS, globe: GLOBE_JS, bars: BARS_JS };
