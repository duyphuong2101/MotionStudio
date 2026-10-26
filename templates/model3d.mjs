// A 3D model scene: a .glb asset drawn by three.js (vendored flat into the job's vendor/, engine/vendor.mjs) into
// its own canvas. The canvas carries data-gl, so the engine opens the page on SwiftShader. Every frame is a pure
// function of seek(t): the turn, the camera and the model's own animation clips are set from t, then drawn once.
import { escapeHtml as h } from '../engine/core.mjs';

export const SPINS = ['turn', 'orbit', 'hero', 'reveal', 'detail'];
// A scene's start pose: degrees round and above the model, and a zoom on the fitted distance. beats.json
// (explainer data.model.view) holds the same ranges for the script check.
export const VIEW_RANGE = { azimuth: [-180, 180], elevation: [-30, 60], zoom: [0.6, 1.6] };
const VIEW_ATTR = { azimuth: 'az', elevation: 'el', zoom: 'zoom' };

const viewAttrs = (view) => (view && typeof view === 'object' ? Object.entries(VIEW_RANGE).map(([k, [lo, hi]]) => {
  const v = view[k] == null || view[k] === '' ? NaN : Number(view[k]);
  return Number.isFinite(v) ? ` data-${VIEW_ATTR[k]}="${Math.min(hi, Math.max(lo, v))}"` : '';
}).join('') : '');

/**
 * The canvas a template puts where the model shows; the scene's start and end come from the timing. The last
 * argument is the scene: its view, shadow and env are written only when they differ from the default look.
 */
export const modelCanvas = (name, t, spin, { view, shadow, env } = {}) =>
  `<canvas class="m3c" data-gl data-model="${h(`assets/${encodeURIComponent(name)}`)}" data-start="${t.start}" data-end="${t.end}" data-spin="${SPINS.includes(spin) ? spin : 'turn'}"${viewAttrs(view)}${shadow === false ? ' data-shadow="off"' : ''}${env === 'none' ? ' data-env="none"' : ''}></canvas>`;

export const hasModels = (body) => /<canvas [^>]*data-model=/.test(body);

export const MODEL_HEAD = '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>';

/** Waited for before build(): the module resolves it once every model is loaded, or rejects naming the file. */
export const MODEL_WAIT = `
const modelsLoaded = new Promise((ok, no) => { window.__modelsOk = ok; window.__modelsFail = no; });`;

// turn: the model turns on its axis; orbit: the camera circles it; hero: it sways while the camera eases in;
// reveal: it rises and grows into place in 0.8 s, then turns slowly; detail: the camera pushes in to a close-up.
// Lit by a studio room (image-based lighting, built once per canvas) plus a key and a rim lamp; the key casts a
// soft contact shadow onto a clear ground under the model, so the scene background shows through.
export const MODEL_JS = String.raw`
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
try {
  const loader = new GLTFLoader(), room = new RoomEnvironment(), deg = THREE.MathUtils.degToRad;
  // Each spin's own start pose: azimuth and elevation in radians. A scene's view replaces either.
  const POSE = { turn: [0.5, 0.22], orbit: [0.3, 0.18], hero: [0.5, 0.22], reveal: [0.5, 0.22], detail: [0.5, 0.22] };
  const REVEAL = 0.8, expo = (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
  const views = await Promise.all([...document.querySelectorAll('canvas[data-model]')].map(async (cv) => {
    const ds = cv.dataset, file = ds.model, studio = ds.env !== 'none', shadow = ds.shadow !== 'off';
    const gltf = await loader.loadAsync(file).catch((e) => { throw new Error('The 3D model ' + decodeURIComponent(file.replace(/^assets\//, '')) + ' could not be loaded: ' + e.message); });
    const w = Math.max(2, Math.round(cv.clientWidth)), hgt = Math.max(2, Math.round(cv.clientHeight));
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(w, hgt, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    if (studio) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(room, 0.04).texture;
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
    if (shadow) {
      // PCF with a radius is three's soft shadow (PCFSoftShadowMap is gone); the light's camera hugs the unit sphere.
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      key.castShadow = true;
      const ks = key.shadow;
      ks.mapSize.set(1024, 1024); ks.radius = 4; ks.bias = -0.0005; ks.normalBias = 0.02;
      Object.assign(ks.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 3, far: 14 });
      ks.camera.updateProjectionMatrix();
      root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      // A clear ground at the bottom of the fitted model: only the shadow shows on it.
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.35 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = (box.min.y - sphere.center.y) * fitScale; ground.receiveShadow = true;
      scene.add(ground);
    }
    const cam = new THREE.PerspectiveCamera(30, w / hgt, 0.05, 100);
    const half = deg(15), fit = 1.12 / Math.sin(Math.min(half, Math.atan(Math.tan(half) * (w / hgt))));
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    if (mixer) gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    const start = +ds.start, end = +ds.end, spin = ds.spin, len = Math.max(0.5, end - start);
    const pose = POSE[spin] || POSE.turn;
    const az0 = 'az' in ds ? deg(+ds.az) : pose[0], el0 = 'el' in ds ? deg(+ds.el) : pose[1], dist = fit / (+ds.zoom || 1);
    const draw = (t) => {
      const u = Math.max(0, t - start), k = Math.min(1, u / len);
      let az = az0, el = el0, d = dist;
      pivot.rotation.set(0, 0, 0); pivot.position.y = 0; pivot.scale.setScalar(fitScale);
      if (spin === 'turn') pivot.rotation.y = -0.6 + u * 0.55;
      else if (spin === 'orbit') { az += u * 0.35; el += 0.12 * Math.sin(u * 0.6); }
      else if (spin === 'hero') { pivot.rotation.y = 0.35 * Math.sin(u * 0.5); d *= 1.12 - 0.12 * (1 - Math.pow(1 - k, 3)); }
      else if (spin === 'reveal') {
        const e = expo(u / REVEAL), rest = 1 - e;
        pivot.position.y = -0.6 * rest; pivot.scale.setScalar(fitScale * (0.6 + 0.4 * e));
        pivot.rotation.y = -0.6 - 0.5 * rest + u * 0.3;
        el += 0.12 * rest; d *= 1 + 0.18 * rest;
      } else {
        // detail: in to 0.55 of the distance on a smooth step, the model and the camera drifting slowly.
        d *= 1 - 0.45 * k * k * (3 - 2 * k);
        pivot.rotation.y = -0.4 + u * 0.08; az += 0.08 * Math.sin(u * 0.4); el += 0.04 * Math.sin(u * 0.3);
      }
      cam.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
      cam.lookAt(0, 0, 0);
      if (mixer) mixer.setTime(u);
      renderer.render(scene, cam);
    };
    // One draw now compiles every shader and allocates the shadow map before the page reports ready.
    draw(start);
    return (t) => { if (t >= start - 0.5 && t <= end + 0.5) draw(t); };
  }));
  room.dispose();
  window.__drawModels = (t) => views.forEach((draw) => draw(t));
  window.__modelsOk();
} catch (err) {
  window.__modelsFail(err);
  throw err;
}
</script>`;
