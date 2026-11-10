// Poster and thumbnail export (plan .ai/plans/publish-kit.md): one still of the storyboard under a small brand page,
// captured by headless Chrome as a PNG at a platform's size. The still comes from the page (the main format or an
// extra cut) whose shape is nearest the poster's, cover-fitted; an optional title sits on a brand scrim with the
// logo. Written to out/<project>/<job>/poster-<size>.png and recorded in status.posters. No model, no network but the
// brand's Google Fonts.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, readJson, within, exists, escapeHtml as h, loadStudioConfig, round } from './core.mjs';
import { getStatus, setStatus, jobDir, jobFile, loadBrand, loadBrief, loadBriefTemplate } from './jobs.mjs';
import { openComposition } from './media.mjs';
import { scriptBrand } from './looks.mjs';
import { checkBrand, fontFaces } from '../templates/kit.mjs';
import { logoFile } from '../templates/shared.mjs';

export const POSTER_SIZES = {
  youtube: { width: 1280, height: 720, label: 'YouTube thumbnail' },
  wide: { width: 1200, height: 630, label: 'Link preview' },
  square: { width: 1080, height: 1080, label: 'Square post' },
  story: { width: 1080, height: 1920, label: 'Story cover' },
};
export const POSTER_TITLE_MAX = 80;
const POSTER_PAGE = '_poster.html';
const BUSY = ['preparing', 'rendering'];

/** The checked options: a listed size, a scene with a still, a title of at most POSTER_TITLE_MAX characters. */
export function posterOptions(st, opts = {}) {
  const size = opts.size || 'youtube';
  if (!POSTER_SIZES[size]) throw new StudioError(`Size must be one of ${Object.keys(POSTER_SIZES).join(', ')}`, 400);
  const stills = st.stills || [];
  if (!stills.length) throw new StudioError('This job has no storyboard stills yet: build the storyboard first', 409);
  const scene = opts.scene || (stills[1] || stills[0]).id;
  if (!stills.some((s) => s.id === scene)) throw new StudioError(`Scene ${scene} has no still: pick one of ${stills.map((s) => s.id).join(', ')}`, 400);
  if (opts.title != null && typeof opts.title !== 'string') throw new StudioError('Title must be text', 400);
  const title = String(opts.title ?? '').replace(/\s+/g, ' ').trim();
  if ([...title].length > POSTER_TITLE_MAX) throw new StudioError(`Title holds at most ${POSTER_TITLE_MAX} characters (${[...title].length} given)`, 400);
  if (opts.logo != null && typeof opts.logo !== 'boolean') throw new StudioError('Logo must be true or false', 400);
  return { size, scene, title, logo: opts.logo !== false };
}

/**
 * The still to use: from the page (main or an extra cut) whose width/height ratio is nearest the poster's, so the
 * cover fit crops the least. Pure, for tests.
 */
export function pickStill(st, mainSize, scene, size) {
  const want = Math.log(size.width / size.height);
  const pages = [{ ...mainSize, stills: st.stills || [] }, ...(st.cuts || []).map((c) => ({ width: c.width, height: c.height, stills: c.stills || [] }))];
  const fit = pages.filter((p) => p.width && p.height && p.stills.some((s) => s.id === scene))
    .map((p) => ({ p, off: Math.abs(Math.log(p.width / p.height) - want) }))
    .sort((a, b) => a.off - b.off)[0];
  return fit ? fit.p.stills.find((s) => s.id === scene).file : null;
}

/** The poster page: the still cover-fitted, a scrim and the title when there is one, the logo top left. Pure. */
export function posterHtml(brand, { width, height, still, title, logo }) {
  const { c, f } = checkBrand(brand);
  const u = Math.min(width, height) / 1080;
  const px = (n) => `${round(n * u, 1)}px`;
  const pad = px(width > height ? 72 : 80);
  const file = logo ? logoFile(brand, true) : null;
  const weight = f.headingWeight || 800;
  const titleSize = px(width > height * 1.4 ? 112 : 128);
  const gf = f.googleFonts ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${h(f.googleFonts)}&amp;display=block">` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8">${gf}
<style>
${fontFaces(f)}
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${c.primary}}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;left:0;right:0;bottom:0;height:50%;background:linear-gradient(180deg,transparent,color-mix(in srgb,${c.primary} 80%,transparent) 40%,color-mix(in srgb,${c.primary} 94%,transparent) 70%);backdrop-filter:blur(${px(18)});-webkit-mask-image:linear-gradient(180deg,transparent,#000 30%);mask-image:linear-gradient(180deg,transparent,#000 30%)}
.tt{position:absolute;left:${pad};right:${pad};bottom:${pad};margin:0;color:${c.onPrimary || '#ffffff'};font:${weight} ${titleSize}/1.04 "${f.display}",system-ui,sans-serif;letter-spacing:-.02em;text-wrap:balance}
.tt::before{content:"";display:block;width:${px(120)};height:${px(12)};border-radius:${px(6)};background:${c.secondary};margin-bottom:${px(30)}}
.lg{position:absolute;left:${pad};top:${pad};height:${px(72)};max-width:40%;object-fit:contain;object-position:left top;filter:drop-shadow(0 ${px(4)} ${px(14)} rgba(0,0,0,.35))}
.lt{position:absolute;left:${pad};top:${pad};color:#fff;font:800 ${px(48)}/1 "${f.display}",system-ui,sans-serif;text-shadow:0 ${px(3)} ${px(14)} rgba(0,0,0,.45)}
</style></head>
<body>
<img class="bg" src="${h(still)}" alt="">
${title ? `<div class="scrim"></div><h1 class="tt">${h(title)}</h1>` : ''}
${file ? `<img class="lg" src="assets/${encodeURIComponent(file)}" alt="">` : logo && brand.logoText ? `<div class="lt">${h(brand.logoText)}</div>` : ''}
<script>
window.__studio = { width: ${width}, height: ${height}, duration: 0, scenes: [], stills: [] };
Promise.all([document.fonts.ready, ...[...document.images].map((im) => im.decode().catch(() => {}))]).then(() => { window.__ready = true; });
</script>
</body></html>
`;
}

/** Writes poster-<size>.png for a job with storyboard stills; a failure lands in posterError. */
export async function makePoster(project, id, opts = {}, by = 'engine') {
  try {
    const st = getStatus(project, id);
    if (BUSY.includes(st.status)) throw new StudioError(`Job is ${st.status}. Wait until it finishes.`, 409);
    const o = posterOptions(st, opts);
    const size = POSTER_SIZES[o.size];
    const dir = jobDir(project, id);
    const script = readJson(jobFile(project, id, 'script.json'), null);
    const brand = scriptBrand(script, loadBrand(project));
    const brief = loadBrief(project, id);
    const { sizeFor } = await import('./pipeline.mjs');
    const still = pickStill(st, sizeFor(loadBriefTemplate(brief).beats, brief.format), o.scene, size);
    if (!still || !exists(within(dir, still))) throw new StudioError(`The still of ${o.scene} is gone: build the storyboard again`, 409);
    const page = within(dir, POSTER_PAGE);
    fs.writeFileSync(page, posterHtml(brand, { ...size, still, title: o.title, logo: o.logo }), 'utf8');
    const file = `poster-${o.size}.png`;
    try {
      const { browser, page: tab } = await openComposition(page, { channel: loadStudioConfig().engine.chromeChannel, width: size.width, height: size.height });
      try {
        await tab.screenshot({ path: path.join(dir, file), type: 'png' });
      } finally {
        await browser.close();
      }
    } finally {
      fs.rmSync(page, { force: true });
    }
    const rec = { file, size: o.size, width: size.width, height: size.height, scene: o.scene, title: o.title, at: new Date().toISOString() };
    return setStatus(project, id, { posters: { ...(getStatus(project, id).posters || {}), [o.size]: rec }, posterError: null }, `poster ${o.size} written from ${o.scene}`, by);
  } catch (err) {
    setStatus(project, id, { posterError: err.message }, 'poster failed', by);
    throw err;
  }
}
