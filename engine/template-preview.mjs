// A live preview of each template for the Templates tab: the template's own default scenes, laid out in the
// project's brand with estimated timing, written to out/_preview/templates/<project>/<template>/. No voice,
// no model, no render: the UI plays the composition in an iframe through its seek(t) contract.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIRS, StudioError, assertId, within, exists, loadStudioConfig } from './core.mjs';
import { loadTemplate, loadBrand, listAssets, assetPath } from './jobs.mjs';
import { iconsFor } from './icons.mjs';
import { estimateTiming } from './timing.mjs';
import { ffmpeg, BT709_VF, BT709_TAGS } from './media.mjs';
import { sizeFor } from './pipeline.mjs';
import { sampleGlb } from './glb.mjs';
import { sampleLottie } from './lottie.mjs';
import { hasLotties } from '../templates/lottie.mjs';
import { copyThree, copyLottie, copyGsap } from './vendor.mjs';
import { hasModels } from '../templates/model3d.mjs';

const ROOT = () => path.join(DIRS.out, '_preview');
const SAMPLE = { photo: 'sample-photo.jpg', clip: 'sample-clip.mp4' };
// The sample scenes name these files; the preview fills them with neutral generated media.
const FILL = { vo: 'A short line for this scene.', source: 'bullets[0]', video: 'clip.mp4', model: 'model.glb', lottie: 'anim.json', shots: [{ asset: 'photo.jpg', focus: null }] };
const IMG_RE = /\.(png|jpe?g|webp|svg)$/i;

/** One scene of every kind each slot allows, filled from the template's own defaults. */
export function sampleScript(beats) {
  const scenes = [];
  for (const slot of beats.sequence) {
    for (const kind of slot.kind.slice(0, Math.max(1, slot.max))) {
      const sc = { id: `${kind}-${scenes.length}`, kind, ...(beats.defaults?.[kind] || {}) };
      for (const f of beats.fields[kind].required) {
        if (sc[f] !== undefined) continue;
        if (f === 'asset') sc.asset = beats.audio === 'footage' ? 'clip.mp4' : 'photo.jpg';
        else if (FILL[f]) sc[f] = FILL[f];
      }
      if (sc.vo === undefined && beats.fields[kind].optional.includes('vo')) sc.vo = FILL.vo;
      scenes.push(sc);
    }
  }
  return { lang: 'en', scenes };
}

/** The neutral photo and clip every preview uses, generated once by ffmpeg (one shared run). */
let mediaRun = null;
const sampleMedia = () => (mediaRun ||= makeSampleMedia().catch((err) => { mediaRun = null; throw err; }));

async function makeSampleMedia() {
  const dir = path.join(ROOT(), 'media');
  fs.mkdirSync(dir, { recursive: true });
  const photo = path.join(dir, SAMPLE.photo), clip = path.join(dir, SAMPLE.clip);
  const grad = 'gradients=c0=0x2b5fb3:c1=0xc96d12:c2=0xf3f2ef:n=3:seed=7';
  // Each file is written aside and renamed, so a killed run never leaves a broken sample that "exists".
  const make = async (file, args, timeoutMs) => {
    if (exists(file)) return;
    const tmp = file.replace(/(\.\w+)$/, '.tmp$1');
    try { await ffmpeg([...args, tmp], { timeoutMs }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
  };
  await make(photo, ['-y', '-f', 'lavfi', '-i', `${grad}:s=1600x900`, '-frames:v', '1', '-q:v', '3'], 30000);
  await make(clip, ['-y', '-f', 'lavfi', '-i', `${grad}:s=960x540:speed=0.03:r=30`, '-t', '8', '-vf', BT709_VF, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS,
    '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart'], 60000);
  return { photo, clip };
}

/** 16:9 when the template has it, else its first format. */
export const previewFormat = (beats) => (beats.formats.includes('16:9') ? '16:9' : beats.formats[0]);

/**
 * Builds (or reuses) the preview of one template in one project's brand. Returns where the UI loads it from.
 * `readOnly` (the review link) builds and writes nothing: it answers for a preview already on disk, else 404.
 */
export async function templatePreview(project, templateId, { readOnly = false } = {}) {
  assertId(project, 'project');
  const { dir: tplDir, beats } = loadTemplate(templateId);
  const script = sampleScript(beats);
  const cfg = loadStudioConfig();
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const format = previewFormat(beats);
  const size = sizeFor(beats, format);
  const out = within(ROOT(), 'templates', project, templateId);
  if (readOnly) {
    if (!exists(path.join(out, 'index.html'))) throw new StudioError(`No preview of ${templateId} yet: it is made when the Templates tab is opened on the Studio machine`, 404);
    return previewInfo(project, templateId, format, size, timing);
  }
  const brand = loadBrand(project);
  const { build } = await import(pathToFileURL(path.join(tplDir, 'template.mjs')).href);
  let html;
  try {
    html = build({ brief: { format }, brand, script, timing, size, icons: iconsFor(project) });
  } catch (err) {
    throw new StudioError(`No preview for ${templateId}: ${err.message}`, 422);
  }
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(out, 'clips'), { recursive: true });
  copyGsap(out);
  const media = await sampleMedia();
  const own = new Set(listAssets(project));
  // Every file the page asks for: the brand's own (logo, fonts), else the sample photo for an image.
  for (const [, name] of html.matchAll(/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    const to = path.join(out, 'assets', name);
    if (own.has(name)) fs.copyFileSync(assetPath(project, name), to);
    else if (IMG_RE.test(name)) fs.copyFileSync(media.photo, to);
    else if (/\.glb$/i.test(name)) fs.writeFileSync(to, sampleGlb());
    else if (/\.json$/i.test(name)) fs.writeFileSync(to, sampleLottie());
  }
  if (hasModels(html)) copyThree(out);
  if (hasLotties(html)) copyLottie(out);
  for (const [, id] of html.matchAll(/clips\/([a-z0-9-]+)\.mp4/g)) fs.copyFileSync(media.clip, path.join(out, 'clips', `${id}.mp4`));
  fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
  return previewInfo(project, templateId, format, size, timing);
}

function previewInfo(project, templateId, format, size, timing) {
  const scenes = timing.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end }));
  const show = scenes[Math.min(1, scenes.length - 1)];
  return {
    url: `/tpreview/${project}/${templateId}/index.html`, format, width: size.width, height: size.height,
    duration: timing.duration, poster: show ? Math.round(((show.start + show.end) / 2) * 100) / 100 : 0, scenes,
  };
}

// Files the preview folder serves, as the job folder's JOB_FILE_RE does.
export const PREVIEW_FILE_RE = /^(index\.html|vendor\/[A-Za-z0-9.]+\.js|assets\/[A-Za-z0-9][A-Za-z0-9._-]*|clips\/[a-z0-9-]+\.mp4)$/;

/** The file under a project's template preview folder, or a 404. */
export function previewFile(project, templateId, rel) {
  assertId(project, 'project'); assertId(templateId, 'template');
  if (!PREVIEW_FILE_RE.test(rel)) throw new StudioError('Not found', 404);
  return within(ROOT(), 'templates', project, templateId, rel);
}
