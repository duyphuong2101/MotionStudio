import fs from 'node:fs';
import path from 'node:path';
import { StudioError, FILE_RE, within, exists } from './core.mjs';
import { profileDir } from './jobs.mjs';
import { isGlb } from './glb.mjs';
import { isLottie } from './lottie.mjs';

const extOf = (name) => path.extname(name).slice(1).toLowerCase();

export const ASSET_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  glb: 'model/gltf-binary',
  json: 'application/json',
};
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
export const VIDEO_EXT = ['mp4', 'webm', 'mov'];
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 400 * 1024 * 1024;

/** Upload size cap for a file name: footage gets a larger cap than images and audio. */
export const maxBytesFor = (name) => (VIDEO_EXT.includes(extOf(String(name || ''))) ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES);


/** Turns an uploaded file name into a safe asset name: no folders, allowed extension, plain characters. */
export function cleanAssetName(raw) {
  const base = path.basename(String(raw || '')).trim();
  const ext = extOf(base);
  if (!ASSET_TYPES[ext]) throw new StudioError(`File type .${ext || '?'} is not allowed. Allowed: ${Object.keys(ASSET_TYPES).join(', ')}`, 400);
  const stem = base.slice(0, -(ext.length + 1)).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'asset';
  const name = `${stem}.${ext}`;
  if (!FILE_RE.test(name)) throw new StudioError('File name is not usable', 400);
  return name;
}

// SVG can carry script; it is shown inside the UI's origin, so anything active is refused, not stripped.
const SVG_BLOCK = [
  /<script\b/i, /\son[a-z]+\s*=/i, /javascript\s*:/i, /<foreignObject\b/i, /<(iframe|embed|object|audio|video)\b/i,
  /<!ENTITY/i, /\b(xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(png|jpe?g|webp|gif);)/i, /url\(\s*["']?\s*(?!#|data:image\/)/i,
  /<\?xml-stylesheet/i, /@import/i,
];

function checkContent(name, buf) {
  const ext = extOf(name);
  const head = buf.subarray(0, 16);
  const ascii = (a, b) => head.toString('latin1', a, b);
  const ok = {
    png: () => head[0] === 0x89 && ascii(1, 4) === 'PNG',
    jpg: () => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    jpeg: () => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    webp: () => ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    wav: () => ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE',
    mp3: () => ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0),
    svg: () => true,
    mp4: () => ascii(4, 8) === 'ftyp',
    m4a: () => ascii(4, 8) === 'ftyp',
    mov: () => ascii(4, 8) === 'ftyp' || ['moov', 'mdat', 'wide', 'free'].includes(ascii(4, 8)),
    webm: () => head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3,
    woff2: () => ascii(0, 4) === 'wOF2',
    woff: () => ascii(0, 4) === 'wOFF',
    ttf: () => (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || ascii(0, 4) === 'true',
    otf: () => ascii(0, 4) === 'OTTO',
    glb: () => isGlb(buf),
    json: () => isLottie(buf),
  }[ext];
  if (!ok || !ok()) throw new StudioError(ext === 'json' ? `${name} is not a Lottie animation (a .json export from After Effects or LottieFiles with v, fr and layers)` : `${name} does not look like a real .${ext} file`, 400);
  if (ext === 'svg') assertSafeSvg(name, buf.toString('utf8'));
}

/** Refuses SVG text that is not an SVG or carries script, handlers or external links. */
export function assertSafeSvg(name, text) {
  if (!/<svg[\s>]/i.test(text)) throw new StudioError(`${name} has no <svg> element`, 400);
  const hit = SVG_BLOCK.find((re) => re.test(text));
  if (hit) throw new StudioError(`${name} contains active or external content (${hit.source.slice(0, 30)}…). Export a plain SVG without scripts, event handlers or external links.`, 400);
}

export function saveAsset(project, rawName, buf, { replace = false } = {}) {
  if (!buf?.length) throw new StudioError('Empty file', 400);
  const name = cleanAssetName(rawName);
  const max = maxBytesFor(name);
  if (buf.length > max) throw new StudioError(`File is larger than ${max / 1024 / 1024} MB`, 413);
  checkContent(name, buf);
  const dir = path.join(profileDir(project), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const file = within(dir, name);
  if (exists(file) && !replace) throw new StudioError(`${name} already exists. Tick "Replace existing" to overwrite it.`, 409);
  fs.writeFileSync(file, buf);
  return { name, bytes: buf.length };
}

export function deleteAsset(project, name, brand) {
  if (!FILE_RE.test(name || '')) throw new StudioError('Invalid asset name', 400);
  const fonts = (brand?.fonts?.files || []).map((x) => ['font', x?.file]);
  const inUse = [['logo', brand?.logo], ['logo on dark', brand?.logoDark], ['music', brand?.music?.file], ...fonts]
    .filter(([, v]) => v === name).map(([k]) => k);
  if (inUse.length) throw new StudioError(`${name} is the brand's ${inUse.join(' and ')}. Pick another file there first.`, 409);
  const file = within(path.join(profileDir(project), 'assets'), name);
  if (!exists(file)) throw new StudioError(`${name} not found`, 404);
  fs.unlinkSync(file);
}
