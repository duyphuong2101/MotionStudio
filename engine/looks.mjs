import { StudioError } from './core.mjs';

// script.look: a named set of existing brand features (engine/brand.mjs, engine/library.mjs), laid over the brand by
// prepare and render. A field the brand sets wins; the look fills only what the brand leaves unset (user, 2026-10-28).
// Templates never see the name: they read motionProfile(brand), brand.backdrop and the rest as before.
export const LOOKS = {
  calm: { motion: 'clean', backdrop: 'aurora', music: 'library:calm-pad' },
  energetic: { motion: 'kinetic', backdrop: 'shapes', wipe: 'liquid', shine: true, sfx: { cut: 'whoosh', gainDb: -12 }, music: 'library:bright-drive' },
  premium: { motion: 'cinematic', leaks: true, sfx: { cut: 'hit', gainDb: -18 }, music: 'library:soft-pulse' },
  bold: { motion: 'editorial', backdrop: 'flow', sfx: { cut: 'click', gainDb: -12 }, music: 'library:steady-tech' },
};
export const LOOK_NAMES = Object.keys(LOOKS);
// The look that keeps the brand as set in the Brand tab; a script without `look` behaves the same.
export const BRAND_LOOK = 'brand';
const CHOICES = [BRAND_LOOK, ...LOOK_NAMES];
// Brand fields a look may fill; music is filled as a whole (file + duck) only when the brand has no track.
const FIELDS = ['motion', 'backdrop', 'wipe', 'leaks', 'shine', 'sfx'];

/** The script check's message for a `look` that is not a look; null when absent or valid. */
export const lookProblem = (name) => (name === undefined || CHOICES.includes(name) ? null : `look ${JSON.stringify(name)} is not one of ${CHOICES.join(', ')}`);

/** The brand with the look laid over it: `brand` or no look returns the same object; otherwise a new one. */
export function lookBrand(name, brand) {
  if (name == null || name === BRAND_LOOK) return brand;
  const problem = lookProblem(name);
  if (problem) throw new StudioError(`script.json: ${problem}. Pick a look in the Script tab.`, 400);
  const look = LOOKS[name];
  const out = { ...brand };
  for (const k of FIELDS) if (out[k] == null && look[k] != null) out[k] = typeof look[k] === 'object' ? { ...look[k] } : look[k];
  if (!brand.music?.file) out.music = { ...brand.music, file: look.music, duck: true };
  return out;
}
