// A 3D model scene: a .glb asset drawn by three.js (vendored flat into the job's vendor/, engine/vendor.mjs) into
// its own canvas. The canvas carries data-gl, so the engine opens the page on SwiftShader. Every frame is a pure
// function of seek(t): the turn, the camera, the exploded parts and the model's own animation clips are set from t,
// then drawn once.
import { escapeHtml as h } from '../engine/core.mjs';
import { VIEW_RANGE, PATH_POSES, EXPLODE_PARTS, GAP_RANGE, GAP_DEFAULT, PART_RE, DECAL_SIZE, DECAL_SIZE_DEFAULT, ENVS } from '../engine/model-rules.mjs';

export { VIEW_RANGE, PATH_POSES, EXPLODE_PARTS, GAP_RANGE, GAP_DEFAULT, PART_RE, DECAL_SIZE, DECAL_SIZE_DEFAULT, ENVS };
export const SPINS = ['turn', 'orbit', 'hero', 'reveal', 'detail'];
const VIEW_ATTR = { azimuth: 'az', elevation: 'el', zoom: 'zoom' };
const HEX_RE = /^#[0-9a-f]{6}$/i;

const clampView = (view, k) => {
  const [lo, hi] = VIEW_RANGE[k], v = view?.[k] == null || view[k] === '' ? NaN : Number(view[k]);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NaN;
};
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

const viewAttrs = (view) => (view && typeof view === 'object' ? Object.entries(VIEW_RANGE).map(([k]) => {
  const v = clampView(view, k);
  return Number.isFinite(v) ? ` data-${VIEW_ATTR[k]}="${v}"` : '';
}).join('') : '');

// Each pose as az:el:zoom, a missing key as an empty field (the start pose fills it in the page).
const pathAttr = (path) => (Array.isArray(path) && path.length >= PATH_POSES[0]
  ? ` data-path="${path.slice(0, PATH_POSES[1]).map((p) => Object.keys(VIEW_RANGE).map((k) => { const v = clampView(p, k); return Number.isFinite(v) ? v : ''; }).join(':')).join(';')}"`
  : '');

const partNames = (explode) => (Array.isArray(explode) ? explode.filter((p) => typeof p === 'string' && PART_RE.test(p)).slice(0, EXPLODE_PARTS[1]) : []);

const explodeAttrs = (explode, gap) => {
  const parts = partNames(explode);
  return parts.length ? ` data-explode="${h(parts.join(','))}" data-gap="${clamp(gap, GAP_RANGE[0], GAP_RANGE[1], GAP_DEFAULT)}"` : '';
};

/**
 * A decal as the page draws it: the icon's path (`d`, a motion-kit path in the 100x112 box, resolved by the
 * template from the scene's `icon`), where it sits on the front face (`at` [x, y] as fractions, x right, y down),
 * its height as a fraction of the face (`size`), its colours and the part it rides on. Nothing without a path.
 */
const decalAttr = (decal) => {
  // Only a plain path (commands, numbers, separators) reaches the page; anything else drops the decal.
  if (!decal || typeof decal !== 'object' || typeof decal.d !== 'string' || !decal.d || /[^MLHVCSQTAZmlhvcsqtaz0-9eE .,+-]/.test(decal.d)) return '';
  const at = Array.isArray(decal.at) ? decal.at : [];
  const out = {
    d: decal.d,
    at: [clamp(at[0], 0, 1, 0.85), clamp(at[1], 0, 1, 0.15)],
    size: clamp(decal.size, DECAL_SIZE[0], DECAL_SIZE[1], DECAL_SIZE_DEFAULT),
    color: HEX_RE.test(decal.color) ? decal.color : '#f59e0b',
    bg: HEX_RE.test(decal.bg) ? decal.bg : '#ffffff',
    ...(typeof decal.part === 'string' && PART_RE.test(decal.part) ? { part: decal.part } : {}),
  };
  return ` data-decal="${h(JSON.stringify(out))}"`;
};

// env "brand" lights the model with a room in the brand colours; the colours ride on the canvas.
const envAttrs = (env, colors) => (env === 'none' ? ' data-env="none"'
  : env === 'brand' ? ` data-env="brand" data-env-colors="${[colors?.primary, colors?.secondary].map((c) => (HEX_RE.test(c) ? c : '#808080')).join(',')}"` : '');

/**
 * The canvas a template puts where the model shows; the scene's start and end come from the timing. The last
 * argument is the scene: its view, path, explode, decal, shadow and env are written only when they differ from
 * the default look. `colors` (the brand's) feed the brand environment.
 */
export const modelCanvas = (name, t, spin, { view, path, explode, gap, decal, shadow, env, colors } = {}) =>
  `<canvas class="m3c" data-gl data-model="${h(`assets/${encodeURIComponent(name)}`)}" data-start="${t.start}" data-end="${t.end}" data-spin="${SPINS.includes(spin) ? spin : 'turn'}"${viewAttrs(view)}${pathAttr(path)}${explodeAttrs(explode, gap)}${decalAttr(decal)}${shadow === false ? ' data-shadow="off"' : ''}${envAttrs(env, colors)}></canvas>`;

/**
 * One canvas for a whole tour (templates/product-tour): the model stays on screen from `t.start` to `t.end` while
 * the camera glides from step to step. `steps` are { t, view, explode, gap, offset } in time order: at each step's
 * `t` the camera moves to its pose over about a second and settles, and its named parts come out (the others go
 * back). A step without a view keeps the previous pose; `offset` [x, y] shifts the model by that share of the
 * frame. At zoom 1 the model stands about two thirds of the frame height, leaving room for the captions.
 * `opts` take the tour's decal, env and brand colours.
 */
export const tourCanvas = (name, t, steps, { decal, env, colors } = {}) => {
  const list = (Array.isArray(steps) ? steps : []).map((s) => {
    const pose = Object.keys(VIEW_RANGE).map((k) => { const v = clampView(s.view, k); return Number.isFinite(v) ? v : null; });
    // Where the model sits in the frame: a shift of up to a third of the width and height, so a caption has room.
    const off = [0, 1].map((k) => Math.round(clamp(s.offset?.[k], -0.34, 0.34, 0) * 1000) / 1000);
    return { t: Number(s.t) || 0, pose, parts: partNames(s.explode), gap: clamp(s.gap, GAP_RANGE[0], GAP_RANGE[1], GAP_DEFAULT), offset: off };
  });
  return `<canvas class="m3c tour" data-gl data-model="${h(`assets/${encodeURIComponent(name)}`)}" data-start="${t.start}" data-end="${t.end}" data-spin="tour" data-steps="${h(JSON.stringify(list))}"${decalAttr(decal)}${envAttrs(env, colors)}></canvas>`;
};

export const hasModels = (body) => /<canvas [^>]*data-model=/.test(body);

export const MODEL_HEAD = '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>';

/** Waited for before build(): the module resolves it once every model is loaded, or rejects naming the file. */
export const MODEL_WAIT = `
const modelsLoaded = new Promise((ok, no) => { window.__modelsOk = ok; window.__modelsFail = no; });`;

// turn: the model turns on its axis; orbit: the camera circles it; hero: it sways while the camera eases in;
// reveal: it rises and grows into place in 0.8 s, then turns slowly; detail: the camera pushes in to a close-up.
// A path replaces the spin's camera move: the camera glides from pose to pose on a smooth step, one equal leg
// per pose, settling at each; the spin still moves the model itself. Exploded parts leave the centre from 30 %
// of the scene on an expo ease and stay out. Lit by a studio room (image-based lighting, built once per canvas;
// env "brand" builds the room from panels in the brand colours instead) plus a key and a rim lamp; the key casts
// a soft contact shadow onto a clear ground under the model, so the scene background shows through.
export const MODEL_JS = String.raw`
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
try {
  const loader = new GLTFLoader(), room = new RoomEnvironment(), deg = THREE.MathUtils.degToRad;
  // Each spin's own start pose: azimuth and elevation in radians. A scene's view replaces either.
  const POSE = { turn: [0.5, 0.22], orbit: [0.3, 0.18], hero: [0.5, 0.22], reveal: [0.5, 0.22], detail: [0.5, 0.22] };
  const REVEAL = 0.8, EXPLODE_AT = 0.3, EXPLODE_LEN = 0.9, GAP = ${GAP_DEFAULT};
  // Both eases are clamped at both ends: a negative input (before a move starts) must sit at 0, never below.
  const expo = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)), smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  // A room in the brand colours: a white ceiling panel as the key light, one wall in the primary, one in the
  // secondary, a soft grey floor, so the reflections carry the brand. Built once per canvas like the studio room.
  const brandRoom = (hexes) => {
    const s = new THREE.Scene();
    const panel = (w, hh, color, x, y, z, rx, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); s.add(m); };
    s.add(new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial({ color: 0x1a1d24, side: THREE.BackSide })));
    panel(5, 3, 0xffffff, 0, 6.5, 0, Math.PI / 2, 0);
    panel(6, 5, hexes[0], -6.5, 1, 0, 0, Math.PI / 2);
    panel(6, 5, hexes[1], 6.5, 1, 0, 0, -Math.PI / 2);
    panel(8, 4, 0xbfc4cc, 0, 1.5, -6.5, 0, 0);
    panel(10, 10, 0x55585e, 0, -6.5, 0, -Math.PI / 2, 0);
    return s;
  };
  // A decal texture: the icon path (100x112 box) in its colour on a round plate, drawn once.
  const decalTexture = (dc) => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = dc.bg; x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
    x.translate(128 - 50 * 1.5, 128 - 56 * 1.5); x.scale(1.5, 1.5);
    x.fillStyle = dc.color; x.strokeStyle = dc.color; x.lineWidth = 6; x.lineJoin = 'round'; x.lineCap = 'round';
    const p = new Path2D(dc.d); x.stroke(p); x.fill(p);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  };
  const views = await Promise.all([...document.querySelectorAll('canvas[data-model]')].map(async (cv) => {
    const ds = cv.dataset, file = ds.model, env = ds.env || 'studio', studio = env !== 'none', shadow = ds.shadow !== 'off';
    const modelName = decodeURIComponent(file.replace(/^assets\//, ''));
    const gltf = await loader.loadAsync(file).catch((e) => { throw new Error('The 3D model ' + modelName + ' could not be loaded: ' + e.message); });
    const w = Math.max(2, Math.round(cv.clientWidth)), hgt = Math.max(2, Math.round(cv.clientHeight));
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(w, hgt, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    if (studio) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const src = env === 'brand' ? brandRoom((ds.envColors || '').split(',').map((c) => new THREE.Color(c))) : room;
      scene.environment = pmrem.fromScene(src, 0.04).texture;
      pmrem.dispose();
    }
    // With the room as fill the lamps only add a key highlight and a rim; without it they light everything.
    if (!studio) scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, studio ? 1.2 : 2.4); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, studio ? 0.6 : 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
    // Centre the model and fit it into a sphere of radius 1.
    const root = gltf.scene, pivot = new THREE.Group();
    const box = new THREE.Box3().setFromObject(root), sphere = box.getBoundingSphere(new THREE.Sphere()), fitScale = 1 / (sphere.radius || 1);
    root.position.sub(sphere.center); pivot.add(root); pivot.scale.setScalar(fitScale); scene.add(pivot);
    root.updateWorldMatrix(true, true);
    const centre = root.localToWorld(new THREE.Vector3(0, 0, 0));
    // A tour canvas (data-steps) lists every step's pose and parts; a plain scene its own explode list.
    const steps = ds.steps ? JSON.parse(ds.steps) : null;
    const names = steps ? [...new Set(steps.flatMap((s) => s.parts))] : (ds.explode || '').split(',').filter(Boolean);
    // Exploded parts: each named node keeps its rest position and a unit direction out from the model's centre
    // (its own centre; a part sitting on the centre goes up), scaled by the gap and the model radius at draw time.
    const parts = names.map((name) => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error('The 3D model ' + modelName + ' has no part named "' + name + '"');
      const dir = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).sub(centre);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      return { name, node, rest: node.position.clone(), dir: dir.normalize().multiplyScalar(sphere.radius) };
    });
    if (ds.decal) {
      // The decal rides on its part (or the model) at the front face, a hair in front of it, so it explodes with the part.
      const dc = JSON.parse(ds.decal), host = (dc.part && root.getObjectByName(dc.part)) || root;
      // hb is in world units, but the plane lives under host, whose world scale includes the fit to the frame: its
      // size is divided by that scale, and its lift off the face comes from the same world box, so a model made in
      // metres or in millimetres gets the decal at dc.size of its height.
      const hb = new THREE.Box3().setFromObject(host), size = hb.getSize(new THREE.Vector3());
      const scale = host.getWorldScale(new THREE.Vector3()).y || 1;
      const hgtD = (size.y * dc.size) / scale, plane = new THREE.Mesh(new THREE.PlaneGeometry(hgtD, hgtD), new THREE.MeshBasicMaterial({ map: decalTexture(dc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      plane.position.copy(host.worldToLocal(new THREE.Vector3(hb.min.x + dc.at[0] * size.x, hb.max.y - dc.at[1] * size.y, hb.max.z + 0.005 * Math.max(size.x, size.y, size.z))));
      plane.renderOrder = 2;
      host.add(plane);
    }
    // Tour steps resolved in time order: a pose per step (a missing number keeps the previous step's), and each
    // part's gap at that step (0 when the part is in).
    const tour = steps && steps.reduce((acc, s, i) => {
      const prev = acc[i - 1], pose = s.pose.map((v, k) => (v == null ? (prev ? prev.pose[k] : [29, 13, 1][k]) : v));
      acc.push({ t: s.t, pose, az: deg(pose[0]), el: deg(pose[1]), zoom: pose[2] * 0.75, gaps: parts.map((q) => (s.parts.includes(q.name) ? s.gap : 0)) });
      return acc;
    }, []);
    const TOUR_MOVE = 1.2, TOUR_PART = 0.9;
    if (shadow) {
      // PCF with a radius is three's soft shadow (PCFSoftShadowMap is gone); the light's camera hugs the unit sphere.
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      key.castShadow = true;
      const ks = key.shadow;
      ks.mapSize.set(1024, 1024); ks.radius = 10; ks.blurSamples = 16; ks.bias = -0.0005; ks.normalBias = 0.02;
      Object.assign(ks.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 3, far: 14 });
      ks.camera.updateProjectionMatrix();
      root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // A clear ground at the bottom of the fitted model: only the shadow shows on it.
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = (box.min.y - sphere.center.y) * fitScale; ground.receiveShadow = true;
      scene.add(ground);
    }
    const cam = new THREE.PerspectiveCamera(30, w / hgt, 0.05, 100);
    const half = deg(15), fit = 1.12 / Math.sin(Math.min(half, Math.atan(Math.tan(half) * (w / hgt))));
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    if (mixer) gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    const start = +ds.start, end = +ds.end, spin = ds.spin, len = Math.max(0.5, end - start);
    const pose = POSE[spin] || POSE.turn;
    const az0 = 'az' in ds ? deg(+ds.az) : pose[0], el0 = 'el' in ds ? deg(+ds.el) : pose[1], zoom0 = +ds.zoom || 1, dist = fit / zoom0;
    const gap = +ds.gap || GAP;
    // The path's poses in radians and zoom, an empty field taking the start pose's value.
    const path = ds.path ? ds.path.split(';').map((p) => { const [a, e, z] = p.split(':'); return [a === '' ? az0 : deg(+a), e === '' ? el0 : deg(+e), z === '' ? zoom0 : +z]; }) : null;
    const draw = (t) => {
      const u = Math.max(0, t - start), k = Math.min(1, u / len);
      let az = az0, el = el0, d = dist;
      pivot.rotation.set(0, 0, 0); pivot.position.y = 0; pivot.scale.setScalar(fitScale);
      if (tour) {
        // The model rises in at the canvas start, then sways slowly; the camera glides to each step's pose from
        // the step's time and the step's parts come out while the others return.
        const e0 = expo(u / REVEAL), rest = 1 - e0;
        pivot.position.y = -0.5 * rest; pivot.scale.setScalar(fitScale * (0.7 + 0.3 * e0));
        pivot.rotation.y = -0.4 * rest + 0.18 * Math.sin(u * 0.35);
        let i = 0; for (let j = 0; j < tour.length; j++) if (t >= tour[j].t) i = j;
        const cur = tour[i], prev = tour[i - 1] || cur, s = smooth((t - cur.t) / TOUR_MOVE);
        az = prev.az + (cur.az - prev.az) * s; el = prev.el + (cur.el - prev.el) * s; d = fit / (prev.zoom + (cur.zoom - prev.zoom) * s);
        d *= 1 + 0.18 * rest;
        const so = steps[i].offset, po = (tour[i - 1] ? steps[i - 1].offset : so);
        cam.setViewOffset(w, hgt, -(po[0] + (so[0] - po[0]) * s) * w, -(po[1] + (so[1] - po[1]) * s) * hgt, w, hgt);
        const e = expo((t - cur.t - 0.2) / TOUR_PART);
        parts.forEach((p, n) => p.node.position.copy(p.rest).addScaledVector(p.dir, prev.gaps[n] + (cur.gaps[n] - prev.gaps[n]) * e));
      } else {
        if (spin === 'turn') pivot.rotation.y = -0.6 + u * 0.55;
        else if (spin === 'orbit') { az += u * 0.35; el += 0.12 * Math.sin(u * 0.6); }
        else if (spin === 'hero') { pivot.rotation.y = 0.35 * Math.sin(u * 0.5); d *= 1.12 - 0.12 * (1 - Math.pow(1 - k, 3)); }
        else if (spin === 'reveal') {
          const e = expo(u / REVEAL), rest = 1 - e;
          pivot.position.y = -0.6 * rest; pivot.scale.setScalar(fitScale * (0.6 + 0.4 * e));
          pivot.rotation.y = -0.6 - 0.5 * rest + u * 0.3;
          el += 0.12 * rest; d *= 1 + 0.18 * rest;
        } else if (spin === 'detail') {
          // detail: in to 0.55 of the distance on a smooth step, the model and the camera drifting slowly.
          d *= 1 - 0.45 * k * k * (3 - 2 * k);
          pivot.rotation.y = -0.4 + u * 0.08; az += 0.08 * Math.sin(u * 0.4); el += 0.04 * Math.sin(u * 0.3);
        }
        if (path) {
          const legs = path.length - 1, x = k * legs, i = Math.min(legs - 1, Math.floor(x)), s = smooth(x - i);
          const a = path[i], b = path[i + 1];
          az = a[0] + (b[0] - a[0]) * s; el = a[1] + (b[1] - a[1]) * s; d = fit / (a[2] + (b[2] - a[2]) * s);
        }
        const e = expo((u - EXPLODE_AT * len) / EXPLODE_LEN) * gap;
        for (const p of parts) p.node.position.copy(p.rest).addScaledVector(p.dir, e);
      }
      cam.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
      cam.lookAt(0, 0, 0);
      if (mixer) mixer.setTime(u);
      renderer.render(scene, cam);
    };
    // One draw now compiles every shader and allocates the shadow map before the page reports ready. Outside its
    // scene the canvas holds its first or last frame, drawn from the clamped time, so a jump and a play-through agree.
    let shown = NaN;
    const show = (t) => { const c = Math.min(end, Math.max(start, t)); if (c !== shown) { shown = c; draw(c); } };
    show(start);
    return show;
  }));
  room.dispose();
  window.__drawModels = (t) => views.forEach((draw) => draw(t));
  window.__modelsOk();
} catch (err) {
  window.__modelsFail(err);
  throw err;
}
</script>`;
