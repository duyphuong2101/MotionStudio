// Remembers which composition pages already passed a slow Chrome check, so a later run plays only the pages that
// changed. A page's stamp is the sha1 of its HTML and of everything else the check reads (`checkerStamp`): a template
// nobody touched builds the same page and is skipped; a kit change that alters a page plays it again. One JSON file per
// name in out/_test-pages/ (gitignored). STUDIO_PLAY_ALL=1 (or `node tests/run.mjs --play-all`) ignores the cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const sha = (...parts) => { const h = crypto.createHash('sha1'); for (const p of parts) h.update(String(p)).update('\0'); return h.digest('hex'); };

// What a page check reads besides the page: the checker, the page opener, the files it injects or copies next to the
// page, and the libraries the page loads from vendor/.
const CHECKER_FILES = ['engine/playcheck.mjs', 'engine/media.mjs', 'engine/frames.mjs', 'engine/vendor.mjs', 'engine/glb.mjs', 'engine/lottie.mjs', 'tests/helpers/chrome-folder.mjs', 'tests/helpers/page-cache.mjs'];
const CHECKER_PACKAGES = ['gsap', 'three', 'lottie-web', 'playwright-core'];

/** One hash of the checker's own files, the vendored library versions and `extra` (the caller's file and settings). */
export function checkerStamp(extra = [], { root = ROOT, files = CHECKER_FILES, packages = CHECKER_PACKAGES } = {}) {
  const version = (p) => { try { return require(`${p}/package.json`).version; } catch { return 'none'; } };
  return sha(...files.map((f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n')), ...packages.map(version), JSON.stringify(extra));
}

/**
 * The cache `name`: `passed(key, html)` is true when that page passed with this stamp before; `pass(key, html)`
 * records it; `save()` writes the file (only the keys seen this run, so a removed template drops out).
 */
export function pageCache(name, stamp, { dir = path.join(ROOT, 'out', '_test-pages'), all = process.env.STUDIO_PLAY_ALL === '1' } = {}) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`page cache name: ${name}`);
  const file = path.join(dir, `${name}.json`);
  let old = {};
  if (!all) { try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { old = {}; } }
  const now = {};
  const of = (html) => sha(stamp, html);
  return {
    passed(key, html) { const ok = old[key] === of(html); if (ok) now[key] = old[key]; return ok; },
    pass(key, html) { now[key] = of(html); },
    save() {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(now, null, 1));
      fs.renameSync(tmp, file);
    },
  };
}
