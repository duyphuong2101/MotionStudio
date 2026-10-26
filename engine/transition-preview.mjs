// A demo clip of each sequence transition for the sequence form: two short gradient scenes in the project's brand
// colours, joined by that preset with the same ffmpeg plan a real sequence uses, written once to
// out/_preview/transitions/<project>/<id>.mp4. No model, no job state; a brand edit makes it rebuild.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRS, StudioError, assertId, within, exists, loadStudioConfig } from './core.mjs';
import { loadBrand, profileDir } from './jobs.mjs';
import { ffmpeg, BT709_VF, BT709_TAGS } from './media.mjs';
import { TRANSITIONS, sequencePlan } from './sequences.mjs';

const ROOT = () => path.join(DIRS.out, '_preview', 'transitions');
const SIZE = { width: 640, height: 360 };
const FPS = 30;
const SCENE_SECONDS = 1.5;
const HEX = /^#[0-9a-fA-F]{6}$/;
const FILE_RE = /^[a-z0-9-]+\.mp4$/;

const hex = (c, fallback) => `0x${(HEX.test(c || '') ? c : fallback).slice(1)}`;

/** One slowly moving gradient scene in two brand colours, as ffmpeg's lavfi source. */
const scene = (c0, c1, seed) => `gradients=s=${SIZE.width}x${SIZE.height}:c0=${c0}:c1=${c1}:n=2:seed=${seed}:speed=0.04:r=${FPS}`;
// Flat shapes over the gradient, so a move, a spin or a wipe reads: a card and a bar on A, a card and dots on B.
const box = (x, y, w, h, color) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`;
const SHAPES = {
  a: (ink, light) => [box(48, 60, 220, 240, ink), box(48, 60, 220, 14, light), box(310, 150, 280, 24, light), box(310, 200, 200, 24, light)].join(','),
  b: (ink, light) => [box(372, 60, 220, 240, ink), box(372, 286, 220, 14, light), ...[0, 1, 2].map((i) => box(48 + i * 70, 160, 40, 40, light))].join(','),
};

/** Builds (or reuses) the demo of one transition in one project's brand. Returns where the UI loads it from. */
export async function transitionPreview(project, id) {
  assertId(project, 'project');
  const preset = TRANSITIONS[id];
  if (!preset) throw new StudioError(`Unknown transition: ${id}`, 404);
  const brand = loadBrand(project);
  const c = brand.colors || {};
  const dir = within(ROOT(), project);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.mp4`);
  const brandFile = path.join(profileDir(project), 'brand.json');
  // Rebuilt when the brand, this module or the transition table changed after the demo was made.
  const newer = (f) => exists(f) && fs.statSync(f).mtimeMs > fs.statSync(out).mtimeMs;
  const stale = !exists(out) || [brandFile, fileURLToPath(import.meta.url), fileURLToPath(new URL('./sequences.mjs', import.meta.url))].some(newer);
  const duration = Math.round((2 * SCENE_SECONDS - preset.seconds) * 100) / 100;
  if (stale) {
    const cfg = loadStudioConfig();
    const tmp = path.join(dir, `${id}.part.mp4`);
    const a = path.join(dir, 'scene-a.mp4'), b = path.join(dir, 'scene-b.mp4');
    const clip = (file, src, shapes) => ffmpeg(['-y', '-f', 'lavfi', '-i', src, '-t', String(SCENE_SECONDS), '-vf', `${shapes},${BT709_VF}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-preset', 'veryfast', '-crf', '24', file], { timeoutMs: 60000 });
    const primary = hex(c.primary, '#1e293b'), primary2 = hex(c.primary2, '#4f46e5'), secondary = hex(c.secondary, '#f59e0b'), bg = hex(c.bg, '#f8fafc');
    try {
      await clip(a, scene(primary, primary2, 3), SHAPES.a(secondary, bg));
      await clip(b, scene(secondary, bg, 11), SHAPES.b(primary, primary2));
      const parts = [{ id: 'a', file: a, duration: SCENE_SECONDS, hasAudio: false }, { id: 'b', file: b, duration: SCENE_SECONDS, hasAudio: false }];
      const plan = sequencePlan({ parts, transition: id, fps: FPS, crf: 26, size: SIZE, out: tmp });
      await ffmpeg(plan.args, { timeoutMs: Math.min(300000, cfg.engine.runTimeoutMinutes * 60000) });
      fs.renameSync(tmp, out);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw new StudioError(`No demo for ${id}: ${err.message}`, 422);
    } finally {
      for (const f of [a, b]) fs.rmSync(f, { force: true });
    }
  }
  return { id, label: preset.label, seconds: preset.seconds, url: `/xpreview/${project}/${id}.mp4`, ...SIZE, duration };
}

/** The demo file under a project's transition preview folder, or a 404. */
export function transitionPreviewFile(project, name) {
  assertId(project, 'project');
  if (!FILE_RE.test(name)) throw new StudioError('Not found', 404);
  return within(ROOT(), project, name);
}
