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
};

export function copyThree(dir) {
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
  for (const [name, rel] of Object.entries(THREE_FILES)) {
    const src = fs.readFileSync(path.join(THREE_ROOT, rel), 'utf8');
    fs.writeFileSync(path.join(dir, 'vendor', name), src.replace(/(from\s*)'\.\.\/utils\//g, "$1'./"), 'utf8');
  }
}
