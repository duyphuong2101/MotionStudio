import path from 'node:path';
import { round } from './core.mjs';
import { ffmpeg } from './media.mjs';
import { SFX, ensureSfx, sfxPath } from './library.mjs';
import { SFX_GAIN_DB } from './brand.mjs';

// A cut sound per scene start (brand `sfx.cut`, a scene's own `sfx`), laid by prepare into the job's sfx.wav at the
// brand's level. The final mix and a sequence's music bed add it after the music is ducked, never as speech.
export const SFX_FILE = 'sfx.wav';
const SFX_TIMEOUT_MS = 120000;

/** The sound at a scene's start cut: the scene's own `sfx` wins over the brand's `sfx.cut`. */
export const cutSound = (scene, brandSfx) => scene?.sfx || brandSfx?.cut || 'none';

/**
 * One sound placed so its `peak` lands on `cut`: a whoosh swells into the cut, a riser ends on it, a hit or a
 * click starts on it. `at` is where the file starts in the track; `skip` trims the head of a sound whose run-up
 * would start before 0. Null for `none`.
 */
export function placeSound(sound, cut) {
  const s = SFX.find((x) => x.id === sound);
  if (!s) return null;
  const skip = Math.max(0, s.peak - cut);
  return { sound, cut: round(cut, 3), at: skip ? 0 : round(cut - s.peak, 3), ...(skip ? { skip: round(skip, 3) } : {}) };
}

/** Every cut sound of a job: one at each scene start but the first (the video's own start is not a cut). */
export function sfxPlacements(script, timing, brandSfx) {
  const byId = Object.fromEntries((script?.scenes || []).map((s) => [s.id, s]));
  return timing.scenes.slice(1).flatMap((t) => {
    const p = placeSound(cutSound(byId[t.id], brandSfx), t.start);
    return p ? [{ scene: t.id, ...p }] : [];
  });
}

/** ffmpeg args for a mono 48 kHz track `duration` long with each placed sound (one input per sound) at `gainDb`. */
export function sfxArgs(placements, duration, gainDb, out) {
  const args = ['-y'];
  for (const p of placements) args.push('-i', sfxPath(p.sound));
  const chains = placements.map((p, i) => `[${i}:a]aresample=48000,${p.skip ? `atrim=start=${p.skip},asetpts=PTS-STARTPTS,` : ''}adelay=${Math.round(p.at * 1000)}:all=1[f${i}]`);
  const sum = placements.length === 1 ? '[f0]' : `${placements.map((_, i) => `[f${i}]`).join('')}amix=inputs=${placements.length}:duration=longest:normalize=0,`;
  args.push('-filter_complex', `${chains.join(';')};${sum}volume=${gainDb}dB,apad,atrim=0:${duration.toFixed(3)}[out]`, '-map', '[out]', '-ac', '1', '-ar', '48000', out);
  return args;
}

/** Writes `placements` into `out`; false (nothing written) when there is no sound to lay. */
export async function writeSfxTrack(placements, duration, gainDb, out) {
  if (!placements.length) return false;
  await ensureSfx();
  await ffmpeg(sfxArgs(placements, duration, gainDb, out), { timeoutMs: SFX_TIMEOUT_MS });
  return true;
}

/** Prepare: the job's sfx.wav from its timing. Returns what timing.json records (null when the job has no cut sound). */
export async function jobSfx(dir, script, timing, brandSfx) {
  const cuts = sfxPlacements(script, timing, brandSfx);
  const gainDb = brandSfx?.gainDb ?? SFX_GAIN_DB;
  return (await writeSfxTrack(cuts, timing.duration, gainDb, path.join(dir, SFX_FILE))) ? { gainDb, cuts } : null;
}
