// Colour grade (brand `grade`): one look over every clip and scene picture of a video, applied by prepare with ffmpeg.
// Every preset is an RGB filter: eq and hue work in YUV and would convert back through BT.601, shifting the colours.
import { StudioError } from './core.mjs';

export const GRADES = {
  warm: 'colortemperature=temperature=5200,vibrance=intensity=0.08',
  cool: 'colortemperature=temperature=8200',
  'teal-orange': 'colorbalance=rs=-0.06:gs=0.01:bs=0.08:rh=0.08:gh=0.02:bh=-0.06,vibrance=intensity=0.1',
  mono: "colorchannelmixer=.2126:.7152:.0722:0:.2126:.7152:.0722:0:.2126:.7152:.0722,curves=all='0/0.02 0.5/0.48 1/1'",
  faded: "curves=all='0/0.08 0.5/0.52 1/0.92',vibrance=intensity=-0.25",
  vivid: "vibrance=intensity=0.15,curves=all='0/0 0.25/0.22 0.75/0.79 1/1'",
};
export const GRADE_NAMES = { warm: 'Warm', cool: 'Cool', 'teal-orange': 'Teal and orange', mono: 'Black and white', faded: 'Faded film', vivid: 'Vivid' };

export const LUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,122}\.cube$/;
const LUT_MAX_SIZE = 65;

/** Brand check: none, or { look } or { lut }, with an optional amount 0.1-1 (1 is dropped). */
export function gradeOf(g, errors) {
  if (g == null || g === '' || g === 'none') return null;
  if (typeof g !== 'object' || Array.isArray(g)) { errors.push('grade must be { look } or { lut } with an optional amount'); return null; }
  const look = g.look || null;
  const lut = g.lut || null;
  if (look && lut) { errors.push('grade takes a look or a LUT, not both'); return null; }
  if (!look && !lut) return null;
  if (look && !Object.hasOwn(GRADES, look)) { errors.push(`grade.look must be one of ${Object.keys(GRADES).join(', ')}`); return null; }
  if (lut && !LUT_RE.test(lut)) { errors.push('grade.lut must be a .cube asset name'); return null; }
  const amount = g.amount == null || g.amount === '' ? 1 : Number(g.amount);
  if (!(Number.isFinite(amount) && amount >= 0.1 && amount <= 1)) { errors.push('grade.amount must be 0.1..1'); return null; }
  return { ...(look ? { look } : { lut }), ...(amount < 1 ? { amount: Math.round(amount * 100) / 100 } : {}) };
}

/** A .cube 3D LUT: text, LUT_3D_SIZE 2-65, exactly size³ rows of three numbers, comments and the usual keywords. */
export function isCube(buf) {
  if (buf.includes(0)) return false;
  const lines = buf.toString('utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let size = 0;
  let rows = 0;
  const num = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  for (const l of lines) {
    const parts = l.split(/\s+/);
    if (parts[0] === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > LUT_MAX_SIZE || parts.length !== 2) return false;
    } else if (parts[0] === 'TITLE') {
      if (!/^TITLE\s+"[^"]{0,200}"$/.test(l)) return false;
    } else if (parts[0] === 'DOMAIN_MIN' || parts[0] === 'DOMAIN_MAX') {
      if (parts.length !== 4 || !parts.slice(1).every((p) => num.test(p))) return false;
    } else if (parts.length === 3 && parts.every((p) => num.test(p))) {
      if (!size) return false;
      rows++;
    } else return false;
  }
  return size > 0 && rows === size ** 3;
}

/** A path inside a filter graph: quoted, with the option-level colon escaped. A quote in the path cannot be escaped safely. */
export function filterPath(file) {
  const p = String(file).replace(/\\/g, '/');
  if (p.includes("'")) throw new StudioError('The colour LUT path holds a quote; move the project to a folder without one', 400);
  return `'${p.replace(/:/g, '\\:')}'`;
}

/**
 * The RGB filters of a grade, mixed over the original at `amount` (alpha included). `lutFile` is the .cube's path
 * when the grade names one. '' when there is no grade.
 */
export function gradeChain(grade, lutFile) {
  if (!grade) return '';
  const f = grade.look ? GRADES[grade.look] : `lut3d=file=${filterPath(lutFile)}`;
  const a = grade.amount ?? 1;
  if (a >= 1) return f;
  return `split[gro][grg];[grg]${f}[grd];[gro][grd]blend=all_expr='A*${(1 - a).toFixed(2)}+B*${a.toFixed(2)}'`;
}

/** The grade for a BT.709 video chain: into RGB and back with the BT.709 matrix (range from the frames). */
export function videoGradeVf(grade, lutFile) {
  const chain = gradeChain(grade, lutFile);
  return chain ? `scale=in_color_matrix=bt709,format=gbrp,${chain},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p` : '';
}

const IMAGE_CODEC = { png: [], jpg: ['-q:v', '2'], jpeg: ['-q:v', '2'], webp: ['-c:v', 'libwebp', '-quality', '92'] };
export const GRADABLE_IMAGE = /\.(png|jpe?g|webp)$/i;

/** ffmpeg args that write a graded copy of one picture, alpha kept, in its own format. */
export function imageGradeArgs(src, out, grade, lutFile) {
  const ext = String(out).split('.').pop().toLowerCase();
  if (!IMAGE_CODEC[ext]) throw new StudioError(`A .${ext} picture cannot be graded`, 400);
  return ['-y', '-i', src, '-vf', `format=gbrap,${gradeChain(grade, lutFile)}`, '-frames:v', '1', ...IMAGE_CODEC[ext], out];
}
