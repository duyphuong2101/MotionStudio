// One self-contained HTML file per finished video: the composition page with its scripts, images, clips and
// the final audio mix inlined, plus a small player. It plays from disk with no server (fonts fall back offline).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError } from './core.mjs';
import { ffmpeg } from './media.mjs';

export const MAX_HTML_BYTES = 200 * 1024 * 1024;
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.js': 'text/javascript',
};

const dataUri = (file, body = fs.readFileSync(file)) => `data:${TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${Buffer.from(body).toString('base64')}`;
// Inlined code must not close the <script> it sits in.
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

// A file the page points at: in a src, href, data-model or data-swap attribute, or a css url(). Text, and the JSON of `const D`,
// are left as they are, so a path in a code listing or a caption is never mistaken for one.
const FILE_REF = /(\s(?:src|href|poster|data-model|data-swap)=["']|url\(["']?)(assets|clips)\/([A-Za-z0-9%._-]+)/g;
// A flat vendor module and the specifiers that import one: `from './x.js'`, `import './x.js'`, `import('./x.js')`.
const VENDOR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const MODULE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])\.\/((?:vendor\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.js)\2/g;
// The bare name a vendor module takes in the rewritten import map (a data: module has no base for ./ imports).
const BARE = (name) => `studio-vendor/${name}`;

/**
 * The page's three.js modules (templates/model3d.mjs) made to load from file://, where a module script cannot fetch
 * ./vendor/…: every vendor module the import map or a module script names, and every module those import, becomes a
 * data: URL in the import map, its relative imports turned into bare names the map resolves. Returns the page.
 */
function inlineModules(html, dir) {
  const mapAt = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  if (!mapAt && !/<script type="module">/.test(html)) return html;
  const imports = mapAt ? JSON.parse(mapAt[1]).imports || {} : {};
  // vendor file name → the specifier every import of it uses (the map's own name, such as "three", wins).
  const spec = new Map();
  for (const [k, v] of Object.entries(imports)) {
    const m = /^\.\/vendor\/(.+)$/.exec(v);
    if (m && VENDOR_NAME.test(m[1])) spec.set(m[1], k);
  }
  const named = (name) => { if (!spec.has(name)) spec.set(name, BARE(name)); return spec.get(name); };
  const rewrite = (code) => code.replace(MODULE_IMPORT, (m, lead, q, rel) => `${lead}${q}${named(rel.replace(/^vendor\//, ''))}${q}`);
  html = html.replace(/<script type="module">([\s\S]*?)<\/script>/g, (m, code) => `<script type="module">${rewrite(code)}</script>`);
  const map = {}, done = new Set();
  for (let todo = [...spec.keys()]; todo.length; todo = [...spec.keys()].filter((n) => !done.has(n))) {
    for (const name of todo) {
      done.add(name);
      const file = path.join(dir, 'vendor', name);
      if (!VENDOR_NAME.test(name) || !fs.existsSync(file)) throw new StudioError(`vendor/${name} is missing; prepare the job again`, 500);
      map[spec.get(name)] = dataUri(file, rewrite(fs.readFileSync(file, 'utf8')));
    }
  }
  const tag = `<script type="importmap">${safeScript(JSON.stringify({ imports: map }))}</script>`;
  return mapAt ? html.replace(mapAt[0], () => tag) : html.replace('<head>', () => `<head>\n${tag}`);
}

/** The player: scales the fixed-size stage to the window and drives seek() from the audio clock. */
const PLAYER = `<style>
html.hv{width:100vw!important;height:100vh!important;overflow:hidden!important;background:#000!important}
html.hv body{position:absolute!important;transform-origin:0 0}
#hv{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;padding:10px 14px;background:linear-gradient(transparent,rgba(0,0,0,.75));font:14px system-ui,sans-serif;color:#fff;z-index:2147483647;opacity:0;transition:opacity .2s}
html.hv:hover #hv,#hv.show{opacity:1}
#hv button{all:unset;cursor:pointer;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:rgba(255,255,255,.18);font-size:15px}
#hv input{flex:1;accent-color:#fff}#hv span{font-variant-numeric:tabular-nums;min-width:92px;text-align:right}
</style>
<script>
(() => {
  const A = document.getElementById('hv-audio');
  const ui = document.createElement('div');
  ui.id = 'hv'; ui.className = 'show';
  ui.innerHTML = '<button type="button" aria-label="Play">\\u25B6</button><input type="range" min="0" step="0.01" value="0" aria-label="Seek"><span>0:00</span>';
  document.documentElement.classList.add('hv');
  document.documentElement.appendChild(ui);
  const [btn, bar, time] = ui.children;
  const fmt = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  let t = 0, playing = false, raf = 0, last = 0;
  const fit = () => {
    const W = window.__studio?.width || document.body.offsetWidth, H = window.__studio?.height || document.body.offsetHeight;
    const s = Math.min(innerWidth / W, innerHeight / H);
    document.body.style.transform = 'translate(' + (innerWidth - W * s) / 2 + 'px,' + (innerHeight - H * s) / 2 + 'px) scale(' + s + ')';
  };
  const show = (x) => { t = Math.max(0, Math.min(x, window.__studio.duration)); window.seek(t); bar.value = t; time.textContent = fmt(t) + ' / ' + fmt(window.__studio.duration); };
  const stop = () => { playing = false; cancelAnimationFrame(raf); A && A.pause(); btn.textContent = '\\u25B6'; btn.setAttribute('aria-label', 'Play'); ui.className = 'show'; };
  const loop = (now) => {
    if (!playing) return;
    const next = A && !A.paused ? A.currentTime : t + (now - last) / 1000;
    last = now;
    show(next);
    if (t >= window.__studio.duration) { stop(); return; }
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    if (t >= window.__studio.duration - 0.05) show(0);
    playing = true; btn.textContent = '\\u275A\\u275A'; btn.setAttribute('aria-label', 'Pause'); ui.className = '';
    if (A) { A.currentTime = t; A.play().catch(() => {}); }
    last = performance.now(); raf = requestAnimationFrame(loop);
  };
  btn.onclick = () => (playing ? stop() : play());
  bar.oninput = () => { const was = playing; stop(); show(+bar.value); if (A) A.currentTime = t; if (was) play(); };
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); btn.click(); } });
  addEventListener('resize', fit);
  const ready = () => { if (!window.__ready) return setTimeout(ready, 50); bar.max = window.__studio.duration; fit(); show(0); };
  ready();
})();
</script>`;

/**
 * The composition page of job folder `dir` with nothing left to fetch from it: every asset and clip it points at,
 * every vendor script and every three.js module inlined. Fonts from Google stay links (they fall back offline).
 */
export function inlinePage(html, dir) {
  html = html.replace(FILE_REF, (m, lead, folder, name) => {
    let decoded;
    try { decoded = decodeURIComponent(name); } catch { return m; }
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return m;
    const file = path.join(dir, folder, decoded);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? lead + dataUri(file) : m;
  });
  html = html.replace(/<script src="(vendor\/[A-Za-z0-9.]+\.js)"><\/script>/g, (m, src) => {
    const file = path.join(dir, src);
    return fs.existsSync(file) ? `<script>${safeScript(fs.readFileSync(file, 'utf8'))}</script>` : m;
  });
  return inlineModules(html, dir);
}

/**
 * Writes `<dir>/<out>` from the composition `page` and the audio of `final`. Returns its size in bytes,
 * or throws a StudioError when it would pass MAX_HTML_BYTES.
 */
export async function buildHtmlVideo(dir, { page = 'index.html', final = 'final.mp4', out = 'video.html' } = {}) {
  let html = inlinePage(fs.readFileSync(path.join(dir, page), 'utf8'), dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-hv-'));
  let audio = '';
  try {
    const m4a = path.join(tmp, 'a.m4a');
    await ffmpeg(['-y', '-i', path.join(dir, final), '-vn', '-c:a', 'copy', m4a], { timeoutMs: 60000 });
    audio = `<audio id="hv-audio" preload="auto" src="data:audio/mp4;base64,${fs.readFileSync(m4a).toString('base64')}"></audio>`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const at = html.lastIndexOf('</body>');
  if (at < 0) throw new StudioError(`${page} has no </body>`, 500);
  html = `${html.slice(0, at)}${audio}\n${PLAYER}\n${html.slice(at)}`;
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_HTML_BYTES) throw new StudioError(`The HTML video would be ${Math.round(bytes / 1048576)} MB, over the ${MAX_HTML_BYTES / 1048576} MB limit`, 413);
  fs.writeFileSync(path.join(dir, out), html, 'utf8');
  return bytes;
}
