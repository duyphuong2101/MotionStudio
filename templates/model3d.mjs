// A 3D model scene: a .glb asset drawn by three.js (vendored flat into the job's vendor/, engine/vendor.mjs) into
// its own canvas. The canvas carries data-gl, so the engine opens the page on SwiftShader. Every frame is a pure
// function of seek(t): the turn, the camera and the model's own animation clips are set from t, then drawn once.
import { escapeHtml as h } from '../engine/core.mjs';

export const SPINS = ['turn', 'orbit', 'hero'];

/** The canvas a template puts where the model shows; the scene's start and end come from the timing. */
export const modelCanvas = (name, t, spin) =>
  `<canvas class="m3c" data-gl data-model="${h(`assets/${encodeURIComponent(name)}`)}" data-start="${t.start}" data-end="${t.end}" data-spin="${SPINS.includes(spin) ? spin : 'turn'}"></canvas>`;

export const hasModels = (body) => /<canvas [^>]*data-model=/.test(body);

export const MODEL_HEAD = '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>';

/** Waited for before build(): the module resolves it once every model is loaded, or rejects naming the file. */
export const MODEL_WAIT = `
const modelsLoaded = new Promise((ok, no) => { window.__modelsOk = ok; window.__modelsFail = no; });`;

// turn: the model turns on its axis; orbit: the camera circles it; hero: it sways while the camera eases in.
export const MODEL_JS = String.raw`
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
try {
  const loader = new GLTFLoader();
  const views = await Promise.all([...document.querySelectorAll('canvas[data-model]')].map(async (cv) => {
    const file = cv.dataset.model;
    const gltf = await loader.loadAsync(file).catch((e) => { throw new Error('The 3D model ' + decodeURIComponent(file.replace(/^assets\//, '')) + ' could not be loaded: ' + e.message); });
    const w = Math.max(2, Math.round(cv.clientWidth)), hgt = Math.max(2, Math.round(cv.clientHeight));
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(w, hgt, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.3); rim.position.set(-4, 2, -3); scene.add(rim);
    // Centre the model and fit it into a sphere of radius 1.
    const root = gltf.scene, pivot = new THREE.Group();
    const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
    root.position.sub(sphere.center); pivot.add(root); pivot.scale.setScalar(1 / (sphere.radius || 1)); scene.add(pivot);
    const cam = new THREE.PerspectiveCamera(30, w / hgt, 0.05, 100);
    const half = THREE.MathUtils.degToRad(15), fit = 1.12 / Math.sin(Math.min(half, Math.atan(Math.tan(half) * (w / hgt))));
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    if (mixer) gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    const start = +cv.dataset.start, end = +cv.dataset.end, spin = cv.dataset.spin, len = Math.max(0.5, end - start);
    return (t) => {
      if (t < start - 0.5 || t > end + 0.5) return;
      const u = Math.max(0, t - start), k = Math.min(1, u / len);
      let az = 0.5, el = 0.22, d = fit;
      pivot.rotation.set(0, 0, 0);
      if (spin === 'turn') pivot.rotation.y = -0.6 + u * 0.55;
      else if (spin === 'orbit') { az = 0.3 + u * 0.35; el = 0.18 + 0.12 * Math.sin(u * 0.6); }
      else { pivot.rotation.y = 0.35 * Math.sin(u * 0.5); d = fit * (1.12 - 0.12 * (1 - Math.pow(1 - k, 3))); }
      cam.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
      cam.lookAt(0, 0, 0);
      if (mixer) mixer.setTime(u);
      renderer.render(scene, cam);
    };
  }));
  window.__drawModels = (t) => views.forEach((draw) => draw(t));
  window.__modelsOk();
} catch (err) {
  window.__modelsFail(err);
  throw err;
}
</script>`;
