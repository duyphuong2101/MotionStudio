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
};

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
    const src = fs.readFileSync(path.join(THREE_ROOT, rel), 'utf8');
    fs.writeFileSync(path.join(dir, 'vendor', name), src.replace(/(from\s*)'\.\.\/utils\//g, "$1'./"), 'utf8');
  }
}
