import { StudioError } from './core.mjs';
import { cloudVoice } from './cloudvoice.mjs';
import { gradeOf } from './grade.mjs';

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9 ]{1,40}$/;
const GF = /^[A-Za-z0-9:;@.,+=&]{0,300}$/;
const HOST = /^[a-z0-9.-]{1,120}$/;
const COLOR_KEYS = ['primary', 'primary2', 'secondary', 'bg', 'ink', 'muted', 'onPrimary'];
const PALETTE_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const IMAGE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(png|jpe?g|webp|svg)$/i;
const MUSIC_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(wav|mp3|m4a)|library:[a-z0-9-]{1,40})$/;
export const FONT_ASSET =/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(woff2?|ttf|otf)$/i;
// clipBrief and clipRefs: the character and style block and the reference pictures a Generate clip starts from
// (New from script); the pictures are the ones Gemini takes (server/generate.mjs MAX_REFS).
const MAX_CLIP_BRIEF = 1500;
const MAX_CLIP_REFS = 3;
const CLIP_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(png|jpe?g|webp)$/i;

/** brand.clipBrief (text) and brand.clipRefs (1-MAX_CLIP_REFS picture asset names); empty values drop out. */
function clipDefaults(b, errors) {
  const out = {};
  if (b.clipBrief != null) {
    if (typeof b.clipBrief !== 'string' || b.clipBrief.trim().length > MAX_CLIP_BRIEF) errors.push(`clipBrief must be text of at most ${MAX_CLIP_BRIEF} characters`);
    else if (b.clipBrief.trim()) out.clipBrief = b.clipBrief.trim();
  }
  if (b.clipRefs != null) {
    const refs = b.clipRefs;
    if (!Array.isArray(refs) || refs.length > MAX_CLIP_REFS || refs.some((r) => typeof r !== 'string' || !CLIP_REF.test(r) || r.includes('..'))) {
      errors.push(`clipRefs must list at most ${MAX_CLIP_REFS} picture assets (.png, .jpg, .webp)`);
    } else if (new Set(refs).size !== refs.length) errors.push('clipRefs lists a picture twice');
    else if (refs.length) out.clipRefs = [...refs];
  }
  return out;
}
// brand.motion: one row per value. templates/kit.mjs, the templates and engine/pipeline.mjs read these fields, never
// the name. entrance: the fadeUp/pop/countUp set; cut: the scene loop (cutD seconds for a fade); push: the camera's end
// scale per scene; bg: particles, grain (film grain and vignette) or none; caps: block (one pill per scene) or lines (one
// caption line at a time, words lit as spoken); layout: classic or stage (content centred between logo and captions);
// tight: short voice gaps (config timing.tight); oneScene: two scenes with text at once is a play-through error;
// carrier: the profile takes brand.carry (an accent bar that glides from scene to scene over every cut).
export const MOTION_PROFILES = {
  standard: { entrance: 'std', cut: 'fade', cutD: 0.3, push: 1, bg: 'particles', caps: 'block', layout: 'classic', tight: false, oneScene: false },
  cinematic: { entrance: 'cine', cut: 'blur', push: 1.03, bg: 'grain', caps: 'lines', layout: 'stage', tight: true, oneScene: true, carrier: true },
  clean: { entrance: 'clean', cut: 'fade', cutD: 0.15, push: 1, bg: 'none', caps: 'lines', layout: 'stage', tight: true, oneScene: true, carrier: true },
  editorial: { entrance: 'editorial', cut: 'panel', push: 1, bg: 'none', caps: 'lines', layout: 'stage', tight: false, oneScene: true },
  kinetic: { entrance: 'kinetic', cut: 'zoom', push: 1, bg: 'particles', caps: 'lines', layout: 'classic', tight: true, oneScene: true },
  // layers: the camera drifts across every scene while text and pictures drift at their own speed.
  parallax: { entrance: 'parallax', cut: 'fade', cutD: 0.4, push: 1.05, bg: 'particles', caps: 'lines', layout: 'stage', tight: false, oneScene: true, layers: true },
};
export const MOTIONS = Object.keys(MOTION_PROFILES);
/** The brand's motion profile; an absent or unknown name is standard. */
export const motionProfile = (brand) => (Object.hasOwn(MOTION_PROFILES, brand?.motion ?? '') ? MOTION_PROFILES[brand.motion] : MOTION_PROFILES.standard);
// Subtitle presets (templates/kit.mjs): white words on a light blurred box; the same with a marker sweeping across
// the spoken word; white words with a dark halo, fading softly; a pill in the marker colour sliding from word to
// word; or larger haloed words that pop in one by one as they are spoken.
export const SUBTITLE_STYLES = ['classic', 'highlighter', 'minimal', 'pill', 'pop'];
// Plain sans faces a preset may load from Google Fonts, as the family query each one needs.
export const SUBTITLE_FONTS = { Roboto: 'Roboto:wght@400;500;700', Montserrat: 'Montserrat:wght@400;500;700', Inter: 'Inter:wght@400;500;700' };
const WEIGHT = (v) => Number.isInteger(v) && v >= 100 && v <= 900 && v % 100 === 0;
// WebGL layers (templates/gl.mjs) in the brand colours: a moving backdrop behind every scene (a mesh gradient,
// aurora curtains, topographic lines, or lit 3D shapes drifting past the camera) and a wipe over every cut: a liquid
// band, an iris closing and opening on the middle, a burn with glowing edges, glitch blocks, or a flash through white.
export const BACKDROPS = ['mesh', 'aurora', 'flow', 'shapes'];
export const WIPES = ['liquid', 'iris', 'burn', 'glitch', 'flash'];
// brand.blend (templates/blend.mjs): both scenes show over every cut and are mixed, a whip pan, a zoom through, a
// cross-warp or a chromatic split. It takes the cut's place, so a brand sets a wipe or a blend, not both.
export const BLENDS = ['whip', 'zoom', 'warp', 'split'];
// brand.reveal: headings split into characters or masked lines by GSAP SplitText (templates/kit.mjs), on the
// profiles whose entrance is the plain rise; cinematic and editorial reveal headings word by word already.
export const REVEALS = ['chars', 'lines'];

// A damped spring sampled into a CustomEase path: about 10 % overshoot, settled by the end (Motion's spring idea,
// computed here rather than added as a dependency).
function springPath(zeta = 0.6, omega = 11, steps = 40) {
  const wd = omega * Math.sqrt(1 - zeta * zeta), pts = [];
  for (let k = 1; k < steps; k++) {
    const t = k / steps, y = 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    pts.push(`${t.toFixed(3)},${y.toFixed(3)}`);
  }
  return `M0,0 L${pts.join(' L')} L1,1`;
}
// brand.ease: the curve for the default ease every plain move uses, a preset name or a CustomEase path from 0,0 to 1,1.
export const EASES = {
  snappy: 'M0,0 C0.2,0.9 0.3,1 1,1',
  soft: 'M0,0 C0.45,0 0.2,1 1,1',
  spring: springPath(),
};
const EASE_PATH = /^M0,0(?:\s*[CLS]?\s*-?\d*\.?\d+,-?\d*\.?\d+)+$/;
const MAX_EASE_CHARS = 600;
/** The CustomEase path of a brand ease, or null for the profile's own. */
export const brandEase = (v) => (Object.hasOwn(EASES, v ?? '') ? EASES[v] : typeof v === 'string' && v.length <= MAX_EASE_CHARS && EASE_PATH.test(v.trim()) && /1,1$/.test(v.trim()) ? v.trim() : null);
// Cut sounds (engine/library.mjs `SFX`) a brand plays at scene cuts, at `gainDb` (default SFX_GAIN_DB).
// brand.voice.say: words the voice says differently, applied to TTS only (engine/tts.mjs spokenLine); captions keep the
// script's words. A key is one word as written (".NET", "AMAD", "Niteco's", "A/B"); a value is what to say instead.
export const MAX_SAY = 30;
const SAY_KEY = /^[A-Za-z0-9.+#&'’_\/-]{1,30}$/;
const SAY_VALUE = /^[A-Za-z0-9 .,'’-]{1,60}$/;
function sayMap(raw, errors) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) { errors.push('voice.say must map a word to what the voice says'); return null; }
  const entries = Object.entries(raw);
  if (entries.length > MAX_SAY) errors.push(`voice.say holds at most ${MAX_SAY} words`);
  for (const [k, v] of entries) {
    if (!SAY_KEY.test(k)) errors.push(`voice.say: "${k}" must be one word (letters, digits, . + # & ' _ / -)`);
    if (typeof v !== 'string' || !SAY_VALUE.test(v.trim())) errors.push(`voice.say: what to say for "${k}" must be 1-60 letters, digits, spaces or . , ' -`);
  }
  return entries.length ? Object.fromEntries(entries.map(([k, v]) => [k, String(v).trim()])) : null;
}

// brand.voice.cast: more voices for one video, by name ({ "numbers": "am_michael" }); a scene's `speaker` picks one
// (engine/tts.mjs speakScript), every other scene keeps voice.voice.
export const MAX_CAST = 4;
const CAST_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const CAST_VOICE = /^[A-Za-z0-9 _()-]{1,60}$/;
function castMap(raw, errors) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) { errors.push('voice.cast must map a speaker name to a voice'); return null; }
  const entries = Object.entries(raw);
  if (entries.length > MAX_CAST) errors.push(`voice.cast holds at most ${MAX_CAST} speakers`);
  for (const [k, v] of entries) {
    if (!CAST_NAME.test(k)) errors.push(`voice.cast: speaker "${k}" must be lowercase letters, digits and dashes`);
    if (typeof v !== 'string' || !CAST_VOICE.test(v)) errors.push(`voice.cast: the voice for "${k}" has unexpected characters`);
  }
  return entries.length ? Object.fromEntries(entries.map(([k, v]) => [k, String(v)])) : null;
}

export const CUT_SOUNDS = ['whoosh', 'hit', 'riser', 'click', 'none'];
export const SFX_GAIN_DB = -12;
const SFX_GAIN_MIN = -30;

/** brand.sfx: { cut, gainDb }. Absent or cut "none" plays nothing, so it is left out. */
function cutSfx(s, errors) {
  if (s == null) return null;
  const gainDb = Number(s.gainDb ?? SFX_GAIN_DB);
  if (!CUT_SOUNDS.includes(s.cut)) errors.push(`sfx.cut must be one of ${CUT_SOUNDS.join(', ')}`);
  if (!Number.isFinite(gainDb) || gainDb < SFX_GAIN_MIN || gainDb > 0) errors.push(`sfx.gainDb must be ${SFX_GAIN_MIN}..0`);
  return s.cut === 'none' ? null : { cut: s.cut, gainDb };
}

/** "https://www.acme.com/shop" → ["www.acme.com", "acme.com"]: the hosts the director may fetch. */
export function hostsFromSite(site) {
  const host = String(site || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!host) return [];
  return host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`];
}

/** A brief URL's host and whether the brand lets the Director fetch it; null without a URL, host null when it is not http(s). */
export function urlCheck(url, allowedHosts = []) {
  if (!url) return null;
  let host = null;
  try {
    const u = new URL(url);
    if (['http:', 'https:'].includes(u.protocol)) host = u.hostname.toLowerCase();
  } catch { /* host stays null */ }
  return { host, allowed: Boolean(host) && allowedHosts.some((h) => String(h).toLowerCase() === host) };
}

/** brand.fonts.files: licensed fonts uploaded as assets, loaded with @font-face instead of Google Fonts. */
function fontFiles(list, errors) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 8) { errors.push('fonts.files must be a list of at most 8 font files'); return []; }
  const faces = new Set();
  return list.map((x, i) => {
    const w = Number(x?.weight ?? 400);
    if (!FONT.test(x?.family || '')) errors.push(`fonts.files[${i}].family must be a plain font name`);
    if (!FONT_ASSET.test(x?.file || '')) errors.push(`fonts.files[${i}].file must be a .woff2, .woff, .ttf or .otf asset`);
    if (!WEIGHT(w)) errors.push(`fonts.files[${i}].weight must be 100..900 in steps of 100`);
    if (x?.style != null && !['normal', 'italic'].includes(x.style)) errors.push(`fonts.files[${i}].style must be normal or italic`);
    // Two files for one family, weight and style: the browser would use only one of them.
    const face = `${String(x?.family || '').toLowerCase()} ${w} ${x?.style || 'normal'}`;
    if (faces.has(face)) errors.push(`fonts.files[${i}] repeats ${x?.family} ${w} ${x?.style || 'normal'}: pick another weight or style`);
    faces.add(face);
    return { family: x?.family, file: x?.file, weight: w, style: x?.style || 'normal' };
  });
}

/**
 * brand.subtitles: one fixed subtitle look for every template. Either a preset (`style`, read by templates/kit.mjs:
 * a few words at a time, clear of a player's controls) or a custom box (e.g. black text on a white box).
 */
function subtitleStyle(s, errors) {
  if (s == null) return null;
  if (s.style != null) {
    if (!SUBTITLE_STYLES.includes(s.style)) errors.push(`subtitles.style must be one of ${SUBTITLE_STYLES.join(', ')}`);
    const font = s.font ?? 'Roboto', size = s.size == null ? null : Number(s.size);
    if (font !== 'brand' && !SUBTITLE_FONTS[font]) errors.push(`subtitles.font must be brand or one of ${Object.keys(SUBTITLE_FONTS).join(', ')}`);
    if (size != null && (!Number.isFinite(size) || size < 36 || size > 80)) errors.push('subtitles.size must be 36..80');
    if (s.marker != null && !HEX.test(s.marker)) errors.push('subtitles.marker must be #rrggbb');
    return { style: s.style, font, ...(size != null ? { size } : {}), ...(s.marker ? { marker: s.marker } : {}) };
  }
  const size = Number(s.size ?? 40), weight = Number(s.weight ?? 400);
  if (!Number.isFinite(size) || size < 20 || size > 80) errors.push('subtitles.size must be 20..80');
  if (!WEIGHT(weight)) errors.push('subtitles.weight must be 100..900 in steps of 100');
  if (!HEX.test(s.color || '')) errors.push('subtitles.color must be #rrggbb');
  if (s.bg != null && !HEX.test(s.bg)) errors.push('subtitles.bg must be #rrggbb or null');
  // The word being spoken may take its own colour (e.g. the brand yellow); without it every word stays one colour.
  if (s.lit != null && s.lit !== '' && !HEX.test(s.lit)) errors.push('subtitles.lit must be #rrggbb');
  const bgOpacity = s.bgOpacity == null ? null : Number(s.bgOpacity);
  if (bgOpacity != null && !(bgOpacity >= 0.1 && bgOpacity <= 1)) errors.push('subtitles.bgOpacity must be 0.1..1');
  return { size, weight, color: s.color, bg: s.bg ?? null, ...(bgOpacity != null && bgOpacity < 1 ? { bgOpacity } : {}), ...(s.lit ? { lit: s.lit } : {}) };
}

export function validateBrand(input) {
  const errors = [];
  const b = input || {};
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  if (!str(b.name, 80) || !b.name) errors.push('name is required (max 80)');
  if (b.logoText != null && !str(b.logoText, 40)) errors.push('logoText max 40');
  if (b.site != null && !str(b.site, 120)) errors.push('site max 120');
  for (const k of COLOR_KEYS) if (!HEX.test(b.colors?.[k] || '')) errors.push(`colors.${k} must be #rrggbb`);
  if (!FONT.test(b.fonts?.display || '')) errors.push('fonts.display must be a plain font name');
  if (!FONT.test(b.fonts?.body || '')) errors.push('fonts.body must be a plain font name');
  if (b.fonts?.googleFonts && !GF.test(b.fonts.googleFonts)) errors.push('fonts.googleFonts has unexpected characters');
  // Brand guides that allow only a few weights (e.g. Semibold for headings) set the display weight here; absent, each template keeps its own.
  const headingWeight = b.fonts?.headingWeight == null || b.fonts.headingWeight === '' ? null : Number(b.fonts.headingWeight);
  if (headingWeight != null && !WEIGHT(headingWeight)) errors.push('fonts.headingWeight must be 100..900 in steps of 100');
  let hosts = b.sources?.allowedHosts || [];
  if (!Array.isArray(hosts) || hosts.some((h) => !HOST.test(h))) errors.push('sources.allowedHosts must be host names');
  // An empty list follows the site, as a new project's does; a list the person typed stays.
  else if (!hosts.length && typeof b.site === 'string') hosts = hostsFromSite(b.site).filter((h) => HOST.test(h));
  const gain = Number(b.music?.gainDb ?? -18);
  if (!Number.isFinite(gain) || gain < -40 || gain > 0) errors.push('music.gainDb must be -40..0');
  if (b.music?.file != null && b.music.file !== '' && !MUSIC_FILE.test(b.music.file)) errors.push('music.file must be a .wav, .mp3 or .m4a asset or a built-in track');
  if (b.music?.duck != null && typeof b.music.duck !== 'boolean') errors.push('music.duck must be true or false');
  if (b.voice?.tts != null && !['kokoro', 'sapi', 'windows', 'piper', 'none'].includes(String(b.voice.tts).toLowerCase())) errors.push('voice.tts must be kokoro, sapi, piper or none');
  const say = sayMap(b.voice?.say, errors);
  const cast = castMap(b.voice?.cast, errors);
  const cloud = cloudVoice(b.voice?.cloud, errors);
  if (b.voice?.cleanup != null && typeof b.voice.cleanup !== 'boolean') errors.push('voice.cleanup must be true or false');
  for (const k of ['logo', 'logoDark']) {
    if (b[k] != null && b[k] !== '' && !IMAGE_ASSET.test(b[k])) errors.push(`${k} must be an image asset name (.png, .jpg, .webp, .svg)`);
  }
  const files = fontFiles(b.fonts?.files, errors);
  const subtitles = subtitleStyle(b.subtitles, errors);
  const sfx = cutSfx(b.sfx, errors);
  const clip = clipDefaults(b, errors);
  const grade = gradeOf(b.grade, errors);
  if (b.logoBug != null && typeof b.logoBug !== 'boolean') errors.push('logoBug must be true or false');
  // Broadcast safe area: the logo bug and the subtitles keep this far from the frame edge, in percent of the frame.
  const safeArea = b.safeArea == null || b.safeArea === '' ? null : Number(b.safeArea);
  if (safeArea != null && !(Number.isFinite(safeArea) && safeArea >= 3 && safeArea <= 12)) errors.push('safeArea must be 3..12 (percent of the frame)');
  if (b.shine != null && typeof b.shine !== 'boolean') errors.push('shine must be true or false');
  if (b.confetti != null && typeof b.confetti !== 'boolean') errors.push('confetti must be true or false');
  if (b.reveal != null && b.reveal !== 'words' && !REVEALS.includes(b.reveal)) errors.push(`reveal must be words or one of ${REVEALS.join(', ')}`);
  if (b.ease != null && b.ease !== '' && b.ease !== 'profile' && !brandEase(b.ease)) {
    errors.push(`ease must be ${Object.keys(EASES).join(', ')} or a curve from "M0,0" to "1,1" (C, L or S points, up to ${MAX_EASE_CHARS} characters)`);
  }
  if (b.leaks != null && typeof b.leaks !== 'boolean') errors.push('leaks must be true or false');
  if (b.film != null && typeof b.film !== 'boolean') errors.push('film must be true or false');
  if (b.carry != null && typeof b.carry !== 'boolean') errors.push('carry must be true or false');
  if (b.motion != null && !MOTIONS.includes(b.motion)) errors.push(`motion must be one of ${MOTIONS.join(', ')}`);
  if (b.backdrop != null && b.backdrop !== 'none' && !BACKDROPS.includes(b.backdrop)) errors.push(`backdrop must be none or one of ${BACKDROPS.join(', ')}`);
  if (b.wipe != null && b.wipe !== 'none' && !WIPES.includes(b.wipe)) errors.push(`wipe must be none or one of ${WIPES.join(', ')}`);
  if (b.blend != null && b.blend !== 'none' && !BLENDS.includes(b.blend)) errors.push(`blend must be none or one of ${BLENDS.join(', ')}`);
  if (WIPES.includes(b.wipe) && BLENDS.includes(b.blend)) errors.push('set wipe or blend, not both: pick None for one of them');
  const palette = Array.isArray(b.palette) ? b.palette : [];
  if (palette.length > 16) errors.push('palette holds at most 16 custom colors');
  const seen = new Set(COLOR_KEYS);
  for (const p of palette) {
    if (!p || !PALETTE_NAME.test(p.name || '')) errors.push(`custom color name "${p?.name ?? ''}" must be lowercase letters, digits and dashes`);
    else if (seen.has(p.name)) errors.push(`custom color "${p.name}" is used twice or clashes with a core color`);
    else seen.add(p.name);
    if (!HEX.test(p?.hex || '')) errors.push(`custom color "${p?.name ?? ''}" must be #rrggbb`);
  }
  if (errors.length) throw new StudioError(errors.join('; '), 400);
  return {
    name: b.name, logoText: b.logoText || '', logo: b.logo || null, logoDark: b.logoDark || null, site: b.site || '',
    colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, b.colors[k]])),
    palette: palette.map((p) => ({ name: p.name, hex: p.hex })),
    fonts: { display: b.fonts.display, body: b.fonts.body, googleFonts: b.fonts.googleFonts || '', ...(files.length ? { files } : {}), ...(headingWeight != null ? { headingWeight } : {}) },
    ...(subtitles ? { subtitles } : {}),
    ...(b.logoBug ? { logoBug: true } : {}),
    ...(safeArea != null ? { safeArea } : {}),
    ...(b.shine ? { shine: true } : {}),
    ...(b.confetti ? { confetti: true } : {}),
    ...(REVEALS.includes(b.reveal) ? { reveal: b.reveal } : {}),
    ...(brandEase(b.ease) ? { ease: Object.hasOwn(EASES, b.ease) ? b.ease : b.ease.trim() } : {}),
    ...(b.leaks ? { leaks: true } : {}),
    ...(b.motion != null && b.motion !== 'standard' ? { motion: b.motion } : {}),
    ...(motionProfile(b).bg === 'grain' && b.film === false ? { film: false } : {}),
    ...(motionProfile(b).carrier && b.carry === true ? { carry: true } : {}),
    ...(BACKDROPS.includes(b.backdrop) ? { backdrop: b.backdrop } : {}),
    ...(WIPES.includes(b.wipe) ? { wipe: b.wipe } : {}),
    ...(BLENDS.includes(b.blend) ? { blend: b.blend } : {}),
    ...(grade ? { grade } : {}),
    voice: {
      tts: String(b.voice?.tts || 'kokoro').slice(0, 20), voice: String(b.voice?.voice || '').slice(0, 40),
      speed: Math.min(1.5, Math.max(0.6, Number(b.voice?.speed) || 1)), lang: String(b.voice?.lang || 'en').slice(0, 8),
      ...(say ? { say } : {}),
      ...(cast ? { cast } : {}),
      ...(cloud ? { cloud } : {}),
      ...(b.voice?.cleanup ? { cleanup: true } : {}),
    },
    music: { file: b.music?.file || null, gainDb: gain, ...(b.music?.duck ? { duck: true } : {}) },
    ...(sfx ? { sfx } : {}),
    ...clip,
    sources: { allowedHosts: hosts },
  };
}
