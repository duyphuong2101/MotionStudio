// three.js for a page with a 3D model scene (templates/model3d.mjs), copied flat into the job's vendor/ like gsap,
// because the UI serves vendor/<name>.js only. The addons' relative imports are pointed at that same folder.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// require.resolve('three') names build/three.cjs; the package root is one folder up.
const THREE_ROOT = path.dirname(path.dirname(require.resolve('three')));
const THREE_FILES = {
  'three.module.js': 'build/three.module.js',
  'three.core.js': 'build/three.core.js',
  'GLTFLoader.js': 'examples/jsm/loaders/GLTFLoader.js',
  'BufferGeometryUtils.js': 'examples/jsm/utils/BufferGeometryUtils.js',
  'SkeletonUtils.js': 'examples/jsm/utils/SkeletonUtils.js',
  // The studio room the model scene's image-based lighting is built from; it imports 'three' only.
  'RoomEnvironment.js': 'examples/jsm/environments/RoomEnvironment.js',
  // The device subject's phone, tablet and laptop bodies (templates/m3subjects.mjs); it imports 'three' only.
  'RoundedBoxGeometry.js': 'examples/jsm/geometries/RoundedBoxGeometry.js',
  // A model scene's bloom and focus (templates/model3d.mjs): three's composer, its passes and their shaders.
  'EffectComposer.js': 'examples/jsm/postprocessing/EffectComposer.js',
  'RenderPass.js': 'examples/jsm/postprocessing/RenderPass.js',
  'UnrealBloomPass.js': 'examples/jsm/postprocessing/UnrealBloomPass.js',
  'BokehPass.js': 'examples/jsm/postprocessing/BokehPass.js',
  'OutputPass.js': 'examples/jsm/postprocessing/OutputPass.js',
  'Pass.js': 'examples/jsm/postprocessing/Pass.js',
  'ShaderPass.js': 'examples/jsm/postprocessing/ShaderPass.js',
  'MaskPass.js': 'examples/jsm/postprocessing/MaskPass.js',
  'CopyShader.js': 'examples/jsm/shaders/CopyShader.js',
  'LuminosityHighPassShader.js': 'examples/jsm/shaders/LuminosityHighPassShader.js',
  'OutputShader.js': 'examples/jsm/shaders/OutputShader.js',
  'BokehShader.js': 'examples/jsm/shaders/BokehShader.js',
};
// BokehShader sets alpha to 1, which would paint the clear canvas around a focused model black; without that line
// the blurred colour keeps its blurred alpha.
const BOKEH_OPAQUE = /\n\s*gl_FragColor\.a = 1\.0;/;

// lottie-web's SVG player for a page with a Lottie scene (templates/lottie.mjs): the one file the page loads.
// The "light" build drops the After Effects expression engine (an eval() over field `x` on every layer/shape,
// plus Math.random()): a page is deterministic only if nothing in it can run arbitrary script or vary per seek.
const LOTTIE_FILE = require.resolve('lottie-web/build/player/lottie_light.min.js');

export function copyLottie(dir) {
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  fs.copyFileSync(LOTTIE_FILE, path.join(dir, 'vendor', 'lottie.min.js'));
}

// GSAP and every plugin a page may load; templates/kit.mjs writes the opt-in ones (SplitText, CustomEase, Physics2D)
// into a page only when its brand asks, so copying them costs a page nothing.
const GSAP_DIST = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
export const GSAP_FILES = ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js', 'SplitText.min.js', 'CustomEase.min.js', 'Physics2DPlugin.min.js'];

export function copyGsap(dir) {
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  for (const f of GSAP_FILES) fs.copyFileSync(path.join(GSAP_DIST, f), path.join(dir, 'vendor', f));
}

export function copyThree(dir) {
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  for (const [name, rel] of Object.entries(THREE_FILES)) {
    let src = fs.readFileSync(path.join(THREE_ROOT, rel), 'utf8').replace(/(from\s*)'\.\.\/(utils|shaders)\//g, "$1'./");
    if (name === 'BokehShader.js') {
      if (!BOKEH_OPAQUE.test(src)) throw new Error('BokehShader.js no longer sets alpha to 1: check engine/vendor.mjs after a three.js update');
      src = src.replace(BOKEH_OPAQUE, '');
    }
    fs.writeFileSync(path.join(dir, 'vendor', name), src, 'utf8');
  }
}
