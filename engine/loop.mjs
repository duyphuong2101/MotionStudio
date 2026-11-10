// Web loop export (plan .ai/plans/publish-kit.md): a few silent seconds of a rendered job that play round without a
// jump, for a website hero or a chat. The span starts at a scene; its last LOOP_FADE seconds crossfade into the
// frames just before the loop's first one, so the end runs straight into the start. Written as loop.mp4 (H.264,
// silent, faststart, autoplays muted on the web) and loop.gif (palette, at most GIF_MAX_WIDTH wide). ffmpeg only.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, readJson, within, exists, round, loadStudioConfig } from './core.mjs';
import { getStatus, setStatus, jobDir, jobFile } from './jobs.mjs';
import { ffmpeg, mediaTimeoutMs, BT709_TAGS } from './media.mjs';

export const LOOP_SECONDS = [2, 10];
export const LOOP_WIDTHS = [480, 1920];
export const LOOP_DEFAULTS = { seconds: 6, width: 960 };
export const GIF_MAX_WIDTH = 640;
const GIF_FPS = 15;
const LOOP_FADE_MAX = 0.6;

/** The checked options: a scene of the timing, seconds and width within their ranges. */
export function loopOptions(timing, opts = {}) {
  const scenes = timing?.scenes || [];
  if (!scenes.length) throw new StudioError('This job has no timing.json: build the storyboard and render it first', 409);
  const scene = opts.scene || scenes[0].id;
  const sc = scenes.find((s) => s.id === scene);
  if (!sc) throw new StudioError(`Unknown scene ${scene}: pick one of ${scenes.map((s) => s.id).join(', ')}`, 400);
  const seconds = Number(opts.seconds ?? LOOP_DEFAULTS.seconds), width = Number(opts.width ?? LOOP_DEFAULTS.width);
  if (!(seconds >= LOOP_SECONDS[0] && seconds <= LOOP_SECONDS[1])) throw new StudioError(`Seconds must be ${LOOP_SECONDS[0]}-${LOOP_SECONDS[1]}`, 400);
  if (!Number.isInteger(width) || width < LOOP_WIDTHS[0] || width > LOOP_WIDTHS[1]) throw new StudioError(`Width must be a whole number from ${LOOP_WIDTHS[0]} to ${LOOP_WIDTHS[1]}`, 400);
  return { scene, start: sc.start, seconds, width };
}

/**
 * The span to cut: `fade` seconds before the loop's start are read too, so the loop's tail can fade into them.
 * Starts at the scene and, near the end of the video, moves back so the whole span fits. Pure, for tests.
 */
export function loopSpan(duration, start, seconds) {
  const fade = round(Math.min(LOOP_FADE_MAX, seconds / 4), 3);
  const len = round(seconds + fade, 3);
  if (duration < len) throw new StudioError(`The video is ${round(duration, 2)} s: a ${seconds} s loop needs ${len} s`, 400);
  const from = round(Math.max(0, Math.min(start, duration - len)), 3);
  return { from, fade, len };
}

/**
 * ffmpeg args for loop.mp4: [head = first `fade` s][body = the rest]; the body's last `fade` s crossfade into the
 * head, so the last frame leads straight into the body's first. Pure, for tests.
 */
export function loopArgs(video, { from, fade, len }, seconds, width, out) {
  const graph = `[0:v]split[a][b];[a]trim=${fade}:${len},setpts=PTS-STARTPTS[body];[b]trim=0:${fade},setpts=PTS-STARTPTS[head];`
    + `[body][head]xfade=transition=fade:duration=${fade}:offset=${round(seconds - fade, 3)},scale=${width}:-2:flags=lanczos,format=yuv420p[v]`;
  return ['-y', '-ss', String(from), '-t', String(len), '-i', video, '-an', '-filter_complex', graph, '-map', '[v]',
    '-c:v', 'libx264', ...BT709_TAGS, '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', out];
}

/** ffmpeg args for loop.gif from loop.mp4: one palette for the whole loop, frames at GIF_FPS. */
export const gifArgs = (mp4, width, out) => ['-y', '-i', mp4, '-filter_complex',
  `[0:v]fps=${GIF_FPS},scale=${Math.min(width, GIF_MAX_WIDTH)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  '-loop', '0', out];

/** Writes loop.mp4 and loop.gif from a rendered job; the job stays done; a failure lands in loopError. */
export async function makeLoop(project, id, opts = {}, by = 'engine') {
  try {
    const st = getStatus(project, id);
    if (st.status !== 'done') throw new StudioError('Render the video first: the loop is cut from the rendered video', 409);
    const dir = jobDir(project, id);
    const video = within(dir, 'video.mp4');
    if (!exists(video)) throw new StudioError('The rendered picture (video.mp4) is gone: render again, then make the loop', 409);
    const timing = readJson(jobFile(project, id, 'timing.json'), null);
    const o = loopOptions(timing, opts);
    const span = loopSpan(Number(st.outputs?.duration || timing.duration), o.start, o.seconds);
    const engine = loadStudioConfig().engine;
    const mp4 = path.join(dir, 'loop.mp4'), gif = path.join(dir, 'loop.gif');
    for (const f of [mp4, gif]) fs.rmSync(f, { force: true });
    await ffmpeg(loopArgs(video, span, o.seconds, o.width, mp4), { timeoutMs: mediaTimeoutMs(span.len * 4, engine) });
    await ffmpeg(gifArgs(mp4, o.width, gif), { timeoutMs: mediaTimeoutMs(span.len * 4, engine) });
    const mb = (f) => round(fs.statSync(f).size / 1048576, 2);
    const loop = { mp4: 'loop.mp4', gif: 'loop.gif', scene: o.scene, seconds: o.seconds, width: o.width, mp4Mb: mb(mp4), gifMb: mb(gif), at: new Date().toISOString() };
    const cur = getStatus(project, id);
    return setStatus(project, id, { outputs: { ...(cur.outputs || {}), loop }, loopError: null }, `web loop written: ${o.seconds} s from ${o.scene}`, by);
  } catch (err) {
    setStatus(project, id, { loopError: err.message }, 'web loop failed', by);
    throw err;
  }
}
