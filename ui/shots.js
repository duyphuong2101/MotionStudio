// Pure UI helpers (no DOM), imported by app.js and tested in node: bullet screenshots, uploads, brand fields.

// Same rule as engine/script.mjs validateSource: a bullet screenshot is a png, jpg or webp asset.
export const SHOT_RE = /\.(png|jpe?g|webp)$/i;

/** The screenshot of the bullet a claim source names ("bullets[2]"), or ''. */
export function bulletShot(source, ref) {
  const m = /^bullets\[(\d+)\]$/.exec(String(ref || ''));
  return (m && source?.bullets?.[Number(m[1])]?.asset) || '';
}

/** The field that shows a screenshot in a scene with these fields: 'shots', 'asset', or '' for none. */
export const shotField = (fields) => (fields.includes('shots') ? 'shots' : fields.includes('asset') ? 'asset' : '');

const currentImage = (scene, field) => (field === 'shots' ? scene.shots?.[0]?.asset : scene.asset) || '';

/**
 * 'set' when the image is empty or still the automatic default (`auto`, the first image), 'offer' when the person
 * picked another image (ask, do not overwrite), '' when there is nothing to do.
 */
export function shotAction(scene, field, shot, auto) {
  const cur = currentImage(scene, field);
  if (!field || !shot || cur === shot) return '';
  return !cur || cur === auto ? 'set' : 'offer';
}

/** Puts the screenshot into the scene; a shot keeps its focus, cursor, click and highlight. */
export function applyShot(scene, field, shot) {
  if (field === 'asset') return { ...scene, asset: shot };
  const shots = Array.isArray(scene.shots) && scene.shots.length ? scene.shots.map((s) => ({ ...s })) : [{ focus: null }];
  shots[0] = { ...shots[0], asset: shot };
  return { ...scene, shots };
}

/* ---------------- assets ---------------- */
const KIND_RE = { image: /\.(png|jpe?g|webp|svg)$/i, audio: /\.(wav|mp3|m4a)$/i, video: /\.(mp4|webm|mov)$/i, font: /\.(woff2?|ttf|otf)$/i, model: /\.glb$/i, animation: /\.json$/i };
/** What an asset file is, from its extension: image, audio, video, font, model, animation (Lottie) or other. */
export const assetKind = (name) => Object.keys(KIND_RE).find((k) => KIND_RE[k].test(String(name || ''))) || 'other';

/**
 * The asset picker of a Script tab field: which brand assets it lists and which files its Upload button accepts, or
 * null for a field that names no file. `footage` is the template's footage mode (true or 'audio'): its `asset` picks
 * clips (and sound files with 'audio') instead of pictures.
 */
export function assetPick(field, footage = false) {
  const pictures = { re: /\.(png|jpe?g|webp|svg)$/i, accept: '.png,.jpg,.jpeg,.webp,.svg' };
  const clips = { re: /\.(mp4|webm|mov)$/i, accept: '.mp4,.webm,.mov' };
  switch (field) {
    case 'asset': return footage === 'audio' ? { re: /\.(mp4|webm|mov|wav|mp3)$/i, accept: '.mp4,.webm,.mov,.wav,.mp3' } : footage ? clips : pictures;
    case 'image': return pictures;
    case 'video': return clips;
    case 'model': return { re: /\.glb$/i, accept: '.glb' };
    case 'lottie': return { re: /\.json$/i, accept: '.json' };
    default: return null;
  }
}

const VIDEO_EXT = ['mp4', 'webm', 'mov']; // engine/assets.mjs VIDEO_EXT: footage has the larger cap
const MB = 1024 * 1024;
export const fmtSize = (n) => (n >= MB ? `${Math.round((n / MB) * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Why the server would refuse this upload (engine/assets.mjs cleanAssetName, maxBytesFor), or '' when it may go. */
export function uploadProblem(file, types, maxBytes, maxVideoBytes = maxBytes) {
  const ext = /\.([^.]+)$/.exec(String(file?.name || ''))?.[1]?.toLowerCase() || '';
  if (!types.includes(ext)) return `.${ext || '?'} files are not allowed. Allowed: ${types.join(', ')}.`;
  if (!file.size) return 'The file is empty.';
  const max = VIDEO_EXT.includes(ext) ? maxVideoBytes : maxBytes;
  return file.size > max ? `The file is ${fmtSize(file.size)}; a .${ext} file may be at most ${fmtSize(max)}.` : '';
}

/* ---------------- form fields ---------------- */
/** A number field's value: null when it is empty, NaN when it is not a number. */
export const parseNum = (v) => (String(v ?? '').trim() === '' ? null : Number(v));

/** The Brand tab's "Say as" box, one "word = what to say" per line, as brand.voice.say; null when empty. */
export function parseSay(text) {
  const out = {};
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.indexOf('=');
    if (at < 1 || !line.slice(at + 1).trim()) throw new Error(`Say as, line ${i + 1}: write the word, then =, then what the voice says`);
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  });
  return Object.keys(out).length ? out : null;
}

/** brand.voice.say as the "Say as" box text. */
export const sayText = (say) => Object.entries(say || {}).map(([k, v]) => `${k} = ${v}`).join('\n');

const CORE_COLORS = ['primary', 'primary2', 'secondary', 'bg', 'ink', 'muted', 'onPrimary']; // engine/brand.mjs COLOR_KEYS
const PALETTE_NAME = /^[a-z][a-z0-9-]{0,23}$/; // engine/brand.mjs PALETTE_NAME

/** What validateBrand would refuse in the custom colors, one plain line each; [] when they can be saved. */
export function paletteProblems(palette) {
  const seen = new Set(CORE_COLORS), out = [];
  palette.forEach((p, i) => {
    const n = `Custom color ${i + 1}`;
    if (!p.name) out.push(`${n} needs a name. Name it or remove it.`);
    else if (!PALETTE_NAME.test(p.name)) out.push(`${n}: "${p.name}" must start with a letter and use only lowercase letters, digits and dashes.`);
    else if (seen.has(p.name)) out.push(`${n}: "${p.name}" is used twice or clashes with a core color.`);
    else seen.add(p.name);
    if (!/^#[0-9a-fA-F]{6}$/.test(p.hex || '')) out.push(`${n} must be a #rrggbb color.`);
  });
  return out;
}

// The Brand tab's Motion style choices, in engine/brand.mjs MOTIONS order (a test keeps the two in step). `reveal`:
// the style takes the brand's heading reveal (templates/kit.mjs revealable). `film`: the
// profile draws film grain and a vignette, so the "Film grain and vignette" box shows.
export const MOTION_OPTIONS = [
  { id: 'standard', label: 'Standard', reveal: true, hint: 'Things slide and pop in, scenes fade into each other over soft floating shapes. Fits most videos. Applies when the storyboard is rebuilt.' },
  { id: 'cinematic', label: 'Cinematic', film: true, carry: true, hint: 'Text comes into focus word by word, the camera keeps pushing in, film grain, full-frame footage. Fits brand films. Applies when the storyboard is rebuilt.' },
  { id: 'clean', label: 'Clean', carry: true, reveal: true, hint: 'Sharp text slides in short and quick, fast fades between scenes, no grain or floating shapes, centred layout. Fits award and corporate films. Applies when the storyboard is rebuilt.' },
  { id: 'editorial', label: 'Editorial', hint: 'Headlines rise line by line out of a mask, other things wipe in, and a brand-coloured panel sweeps across at every cut. Fits stories and reports. Applies when the storyboard is rebuilt.' },
  { id: 'kinetic', label: 'Kinetic', reveal: true, hint: 'Big, fast moves that overshoot and settle, zoom and slide cuts, floating shapes behind. Fits social clips and launches. Applies when the storyboard is rebuilt.' },
  { id: 'parallax', label: 'Parallax', reveal: true, hint: 'The camera drifts slowly while text and pictures move at their own speed, long soft entrances, gentle fades. Fits product and brand stories. Applies when the storyboard is rebuilt.' },
];
/** The option for a stored motion name; absent or unknown is Standard, as the engine reads it. */
export const motionOpt = (id) => MOTION_OPTIONS.find((o) => o.id === id) || MOTION_OPTIONS[0];

// A scene script's lines as engine/scenescript.mjs reads them: a scene starts at SCENE n and ends at the next SCENE,
// at End card or at a capital section label with nothing after its colon.
const SCENE_LINE_RE = /^\s*SCENE\s+(\d{1,3})\b/;
const SCENE_END_RE = /^\s*end card\s*:/i;
const SECTION_RE = /^\s*[A-Z][A-Z0-9 ]*[A-Z0-9]\s*:\s*$/;
const KEY_LINE_RE = /^\s*(clip|image|images|voice|on screen|button)\s*:/i;
const CLIP_LINE_RE = /^(\s*CLIP\s*:)(.*)$/i;

/**
 * The scene script `text` with `name` in scene `n`'s CLIP line: added to the line's list, or a new CLIP line under the
 * SCENE line. Unchanged when the name is listed already; null when there is no scene `n`.
 */
export function insertClip(text, n, name) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(text).split(/\r?\n/);
  const at = lines.findIndex((l) => Number(SCENE_LINE_RE.exec(l)?.[1]) === n);
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !SCENE_LINE_RE.test(lines[end]) && !SCENE_END_RE.test(lines[end]) && !(SECTION_RE.test(lines[end]) && !KEY_LINE_RE.test(lines[end]))) end++;
  const clip = lines.slice(at + 1, end).findIndex((l) => CLIP_LINE_RE.test(l));
  if (clip < 0) lines.splice(at + 1, 0, `CLIP: ${name}`);
  else {
    const [, head, list] = CLIP_LINE_RE.exec(lines[at + 1 + clip]);
    if (list.split(',').some((c) => c.trim().split(/\s+/)[0] === name)) return String(text);
    lines[at + 1 + clip] = `${head} ${list.trim() ? `${list.trim()}, ` : ''}${name}`;
  }
  return lines.join(eol);
}

// Weight words in font file names, the compound ones first ("SemiBold" is not "Bold").
const WEIGHT_WORDS = [[/thin|hairline/i, 100], [/(extra|ultra)-?light/i, 200], [/light/i, 300], [/medium/i, 500], [/(semi|demi)-?bold/i, 600],
  [/(extra|ultra)-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];

/** A font file's likely family, weight and style from its name: "Gilroy-SemiBoldItalic.otf" → Gilroy, 600, italic. */
export function guessFont(file, fallback = 'Brand') {
  const stem = String(file || '').replace(/\.[^.]+$/, '');
  const cut = stem.search(/[-_ ]/);
  const rest = cut < 0 ? '' : stem.slice(cut);
  const family = (cut < 0 ? stem : stem.slice(0, cut)).replace(/[^A-Za-z0-9 ]+/g, ' ').trim().slice(0, 40) || fallback;
  return { family, file, weight: WEIGHT_WORDS.find(([re]) => re.test(rest))?.[1] ?? 400, style: /italic|oblique/i.test(rest) ? 'italic' : 'normal' };
}
