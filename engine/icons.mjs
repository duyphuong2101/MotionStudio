// Brand icons: an uploaded SVG becomes one path in the motion-kit box (100x112) so it morphs like the built-ins.
// The file itself is never kept or served: only its filled shapes, flattened to absolute M/L/C/Z numbers.
import path from 'node:path';
import { StudioError, readJson, writeJson } from './core.mjs';
import { profileDir, listJobs, jobFile } from './jobs.mjs';
import { assertSafeSvg } from './assets.mjs';
import { ICONS } from '../motion-kit/icons.mjs';

export const MAX_ICON_BYTES = 200 * 1024;
export const MAX_BRAND_ICONS = 40;
export const MAX_PATH_CHARS = 16000;
export const ICON_NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;
// What a stored path may hold: safe to drop into an HTML attribute or a script as is.
export const ICON_PATH_RE = /^M[MLCZ0-9 .-]*$/;
// The area an icon is fitted into, inside the 100x112 box (the built-ins sit about here).
const FIT = { cx: 50, cy: 56, w: 88, h: 98 };

const iconsFile = (project) => path.join(profileDir(project), 'icons.json');

/** The brand's own icons, { name: path }. Entries that are not a clean name and path are skipped. */
export function loadBrandIcons(project) {
  const raw = readJson(iconsFile(project), {});
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (ICON_NAME_RE.test(k) && !ICONS[k] && typeof v === 'string' && ICON_PATH_RE.test(v) && v.length <= MAX_PATH_CHARS) out[k] = v;
  }
  return out;
}

/** Every icon a job of this project may use: the motion-kit built-ins, then the brand's own. */
export const iconsFor = (project) => ({ ...ICONS, ...loadBrandIcons(project) });

/** "My Icon (2).svg" → "my-icon-2". */
export function iconNameFrom(raw) {
  const stem = path.basename(String(raw || '')).replace(/\.svg$/i, '');
  const name = stem.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  if (!ICON_NAME_RE.test(name)) throw new StudioError('Icon name must start with a letter and use a-z, 0-9 and dashes (max 24)', 400);
  return name;
}

export function saveIcon(project, rawName, buf, { replace = false } = {}) {
  if (!buf?.length) throw new StudioError('Empty file', 400);
  if (buf.length > MAX_ICON_BYTES) throw new StudioError(`Icon file is larger than ${MAX_ICON_BYTES / 1024} KB`, 413);
  if (!/\.svg$/i.test(String(rawName || ''))) throw new StudioError('Icons must be .svg files', 400);
  const name = iconNameFrom(rawName);
  if (ICONS[name]) throw new StudioError(`"${name}" is a built-in icon. Rename the file and upload it again.`, 409);
  const d = svgToIconPath(buf.toString('utf8'), `${name}.svg`);
  const icons = loadBrandIcons(project);
  if (icons[name] && !replace) throw new StudioError(`Icon "${name}" already exists. Tick "Replace existing" to overwrite it.`, 409);
  if (!icons[name] && Object.keys(icons).length >= MAX_BRAND_ICONS) throw new StudioError(`A brand holds at most ${MAX_BRAND_ICONS} icons. Delete one first.`, 409);
  writeJson(iconsFile(project), { ...icons, [name]: d });
  return { name, d };
}

/** Jobs of this project whose script.json shows the icon. */
export function jobsUsingIcon(project, name) {
  return listJobs(project).map((j) => j.brief.id).filter((id) => {
    const script = readJson(jobFile(project, id, 'script.json'), null);
    return (script?.scenes || []).some((s) => s?.icon === name);
  });
}

export function deleteIcon(project, name) {
  if (!ICON_NAME_RE.test(name || '')) throw new StudioError('Invalid icon name', 400);
  const icons = loadBrandIcons(project);
  if (!icons[name]) throw new StudioError(`Icon "${name}" not found`, 404);
  const used = jobsUsingIcon(project, name);
  if (used.length) throw new StudioError(`Icon "${name}" is used by ${used.join(', ')}. Pick another icon in those scripts first.`, 409);
  delete icons[name];
  writeJson(iconsFile(project), icons);
}

/* ---------- SVG → one path ---------- */

// Their content is not drawn where it stands.
const HIDDEN = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'lineargradient', 'radialgradient', 'filter']);
const REFUSED = { text: 'has text: convert it to outlines', tspan: 'has text: convert it to outlines', image: 'embeds an image: use a vector icon', use: 'uses <use>: flatten or expand it', svg: 'nests an <svg>: flatten it' };
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline']);
const zero = (v) => v !== undefined && String(v).trim() !== '' && parseFloat(v) === 0;

function attrsOf(src) {
  const out = {};
  for (const m of src.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  for (const decl of String(out.style || '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

/** Turns SVG text into one closed path in the motion-kit box. Throws a StudioError that says how to fix the file. */
export function svgToIconPath(text, label = 'icon.svg') {
  assertSafeSvg(label, text);
  const src = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<[?!][^>]*>/g, '');
  const stack = [];
  let rootSeen = false, hidden = 0, stroked = 0;
  const parts = [];
  for (const m of src.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g)) {
    const [, close, rawTag, rawAttrs, self] = m;
    const tag = rawTag.toLowerCase().replace(/^svg:/, '');
    if (close) {
      const top = stack.pop();
      if (top?.hide) hidden--;
      continue;
    }
    const a = attrsOf(rawAttrs);
    const parent = stack[stack.length - 1] || { fill: '#000', rule: 'nonzero', m: IDENTITY, off: false };
    const hide = HIDDEN.has(tag) || a.display === 'none' || a.visibility === 'hidden';
    const node = {
      hide,
      fill: a.fill !== undefined && a.fill !== 'inherit' ? a.fill : parent.fill,
      rule: a['fill-rule'] && a['fill-rule'] !== 'inherit' ? a['fill-rule'] : parent.rule,
      m: a.transform ? multiply(parent.m, parseTransform(a.transform, label)) : parent.m,
      off: parent.off || zero(a.opacity) || zero(a['fill-opacity']),
    };
    if (tag === 'svg' && !rootSeen) { rootSeen = true; node.m = IDENTITY; }
    else if (!hidden && REFUSED[tag]) throw new StudioError(`${label} ${REFUSED[tag]}, then export again.`, 400);
    else if (!hidden && SHAPES.has(tag)) {
      if (node.off || hide || /^none$/i.test(node.fill.trim()) || /^transparent$/i.test(node.fill.trim())) { if (a.stroke && a.stroke !== 'none') stroked++; }
      else {
        const subs = shapeToSubpaths(tag, a, label).map((sp) => mapSubpath(sp, node.m)).filter((sp) => sp.segs.length);
        if (subs.length) parts.push(orient(subs, node.rule === 'evenodd'));
      }
    }
    if (!self) {
      stack.push(node);
      if (hide) hidden++;
    }
  }
  if (!rootSeen) throw new StudioError(`${label} has no <svg> element`, 400);
  if (!parts.length) {
    throw new StudioError(stroked || /stroke\s*[:=]\s*["']?(?!none)[#a-z]/i.test(src)
      ? `${label} draws only outlines (strokes). Use a filled (solid) icon, or outline the strokes before export.`
      : `${label} has no filled shape to use`, 400);
  }
  const all = parts.flat();
  const box = bboxOf(all);
  const w = box.x2 - box.x1, h = box.y2 - box.y1;
  if (!(w > 0 && h > 0)) throw new StudioError(`${label} has no area to draw`, 400);
  const s = Math.min(FIT.w / w, FIT.h / h);
  const fit = [s, 0, 0, s, FIT.cx - s * (box.x1 + w / 2), FIT.cy - s * (box.y1 + h / 2)];
  const d = all.map((sp) => mapSubpath(sp, fit)).map(subpathString).join(' ');
  if (d.length > MAX_PATH_CHARS) throw new StudioError(`${label} is too detailed (${d.length} path characters, limit ${MAX_PATH_CHARS}). Simplify it.`, 400);
  if (!ICON_PATH_RE.test(d)) throw new StudioError(`${label} could not be turned into a clean path`, 400);
  return d;
}

/* ---------- geometry: a subpath is { start: [x, y], segs: [{ t: 'L'|'C', p: [...] }], closed } ---------- */

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(src, label) {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  if (src.replace(re, '').replace(/[\s,]/g, '')) throw new StudioError(`${label} has a transform this tool cannot read`, 400);
  for (const [, fn, args] of src.matchAll(re)) {
    const n = (args.match(NUM_RE) || []).map(Number);
    const rad = (deg) => (deg * Math.PI) / 180;
    let t;
    if (fn === 'matrix' && n.length === 6) t = n;
    else if (fn === 'translate') t = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (fn === 'scale') t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = rad(n[0] || 0), [cx, cy] = [n[1] || 0, n[2] || 0];
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(rad(n[0] || 0)), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(rad(n[0] || 0)), 0, 1, 0, 0];
    else throw new StudioError(`${label} has a transform this tool cannot read`, 400);
    m = multiply(m, t);
  }
  return m;
}

const mapSubpath = (sp, m) => ({
  start: apply(m, ...sp.start),
  segs: sp.segs.map(({ t, p }) => ({ t, p: t === 'L' ? apply(m, p[0], p[1]) : [...apply(m, p[0], p[1]), ...apply(m, p[2], p[3]), ...apply(m, p[4], p[5])] })),
  closed: sp.closed,
});

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function shapeToSubpaths(tag, a, label) {
  const num = (k, def = 0) => {
    const v = a[k];
    if (v === undefined || v === '' || v === 'auto') return def;
    if (/%/.test(v)) throw new StudioError(`${label} sizes a <${tag}> in percent: export it with plain numbers`, 400);
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : def;
  };
  if (tag === 'path') return parsePath(a.d || '', label);
  if (tag === 'polygon' || tag === 'polyline') {
    const n = (a.points || '').match(NUM_RE)?.map(Number) || [];
    if (n.length < 6) return [];
    const segs = [];
    for (let i = 2; i + 1 < n.length; i += 2) segs.push({ t: 'L', p: [n[i], n[i + 1]] });
    return [{ start: [n[0], n[1]], segs, closed: true }];
  }
  if (tag === 'circle') return ellipse(num('cx'), num('cy'), num('r'), num('r'));
  if (tag === 'ellipse') return ellipse(num('cx'), num('cy'), num('rx'), num('ry'));
  // rect
  const x = num('x'), y = num('y'), w = num('width'), h = num('height');
  if (w <= 0 || h <= 0) return [];
  let rx = num('rx', -1), ry = num('ry', -1);
  if (rx < 0) rx = ry < 0 ? 0 : ry;
  if (ry < 0) ry = rx;
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (!rx || !ry) return [{ start: [x, y], segs: [{ t: 'L', p: [x + w, y] }, { t: 'L', p: [x + w, y + h] }, { t: 'L', p: [x, y + h] }], closed: true }];
  const segs = [];
  let cur = [x + rx, y];
  const line = (px, py) => { segs.push({ t: 'L', p: [px, py] }); cur = [px, py]; };
  const arc = (px, py) => { for (const c of arcToCubics(cur[0], cur[1], rx, ry, 0, 0, 1, px, py)) segs.push({ t: 'C', p: c }); cur = [px, py]; };
  line(x + w - rx, y); arc(x + w, y + ry); line(x + w, y + h - ry); arc(x + w - rx, y + h);
  line(x + rx, y + h); arc(x, y + h - ry); line(x, y + ry); arc(x + rx, y);
  return [{ start: [x + rx, y], segs, closed: true }];
}

function ellipse(cx, cy, rx, ry) {
  if (rx <= 0 || ry <= 0) return [];
  const segs = [...arcToCubics(cx + rx, cy, rx, ry, 0, 0, 1, cx - rx, cy), ...arcToCubics(cx - rx, cy, rx, ry, 0, 0, 1, cx + rx, cy)].map((p) => ({ t: 'C', p }));
  return [{ start: [cx + rx, cy], segs, closed: true }];
}

/** Path data → absolute subpaths of lines and cubics (quadratics and arcs converted). */
export function parsePath(d, label = 'icon.svg') {
  const s = String(d);
  let i = 0;
  const ws = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  const number = () => {
    ws();
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(s);
    if (!m || m.index !== i) throw new StudioError(`${label} has path data this tool cannot read near "${s.slice(i, i + 12)}"`, 400);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => {
    ws();
    if (s[i] !== '0' && s[i] !== '1') throw new StudioError(`${label} has a broken arc in its path data`, 400);
    return Number(s[i++]);
  };
  const more = () => { ws(); return i < s.length && /[\d.+-]/.test(s[i]); };

  const subs = [];
  let sp = null, cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, cmd = '';
  const open = () => { if (!sp) { sp = { start: [cx, cy], segs: [], closed: false }; subs.push(sp); } };
  const lineTo = (x, y) => { open(); sp.segs.push({ t: 'L', p: [x, y] }); cx = x; cy = y; };
  const cubicTo = (x1, y1, x2, y2, x, y) => { open(); sp.segs.push({ t: 'C', p: [x1, y1, x2, y2, x, y] }); cx = x; cy = y; };

  ws();
  while (i < s.length) {
    if (/[A-Za-z]/.test(s[i])) cmd = s[i++];
    else if (!cmd) throw new StudioError(`${label} path data does not start with a command`, 400);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    let q = null, c = null;
    switch (C) {
      case 'M': {
        const x = number() + ox, y = number() + oy;
        sp = null; cx = sx = x; cy = sy = y;
        cmd = rel ? 'l' : 'L'; // extra pairs after a moveto are lines
        break;
      }
      case 'L': lineTo(number() + ox, number() + oy); break;
      case 'H': lineTo(number() + ox, cy); break;
      case 'V': lineTo(cx, number() + oy); break;
      case 'C': {
        const p = [number() + ox, number() + oy, number() + ox, number() + oy, number() + ox, number() + oy];
        cubicTo(...p); c = [p[2], p[3]];
        break;
      }
      case 'S': {
        const [x1, y1] = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
        const p = [number() + ox, number() + oy, number() + ox, number() + oy];
        cubicTo(x1, y1, ...p); c = [p[0], p[1]];
        break;
      }
      case 'Q': case 'T': {
        const [qx, qy] = C === 'Q' ? [number() + ox, number() + oy] : lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
        const x = number() + ox, y = number() + oy;
        cubicTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        q = [qx, qy];
        break;
      }
      case 'A': {
        const rx = number(), ry = number(), rot = number(), fa = flag(), fs = flag();
        const x = number() + ox, y = number() + oy;
        const cs = arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y);
        if (!cs) lineTo(x, y);
        else for (const p of cs) cubicTo(...p);
        cx = x; cy = y;
        break;
      }
      case 'Z':
        if (sp) sp.closed = true;
        sp = null; cx = sx; cy = sy;
        break;
      default: throw new StudioError(`${label} uses path command "${cmd}", which this tool cannot read`, 400);
    }
    lastC = c; lastQ = q;
    if (C === 'Z' && more()) throw new StudioError(`${label} has numbers after a Z in its path data`, 400);
    ws();
  }
  // A filled path closes itself; drop subpaths that draw nothing.
  return subs.filter((x) => x.segs.length).map((x) => ({ ...x, closed: true }));
}

/** SVG arc → cubic Béziers in absolute coordinates (null when it is a straight line). */
function arcToCubics(x1, y1, rx, ry, rotDeg, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return null;
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry, vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
  const t1 = angle(1, 0, ux, uy);
  let dt = angle(ux, uy, vx, vy);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const map = (px, py) => [cx + cos * rx * px - sin * ry * py, cy + sin * rx * px + cos * ry * py];
  const out = [];
  for (let j = 0, t = t1; j < n; j++, t += step) {
    const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(t + step), s2 = Math.sin(t + step);
    out.push([...map(c1 - k * s1, s1 + k * c1), ...map(c2 + k * s2, s2 - k * c2), ...map(c2, s2)]);
  }
  out[out.length - 1].splice(4, 2, x2, y2);
  return out;
}

/* ---------- winding: the templates fill with nonzero, so each shape's outline and holes are set to match ---------- */

function flatten(sp) {
  const pts = [sp.start];
  let [x0, y0] = sp.start;
  for (const { t, p } of sp.segs) {
    if (t === 'L') pts.push(p);
    else for (let k = 1; k <= 6; k++) {
      const u = k / 6, v = 1 - u;
      pts.push([v * v * v * x0 + 3 * v * v * u * p[0] + 3 * v * u * u * p[2] + u * u * u * p[4], v * v * v * y0 + 3 * v * v * u * p[1] + 3 * v * u * u * p[3] + u * u * u * p[5]]);
    }
    [x0, y0] = t === 'L' ? p : [p[4], p[5]];
  }
  return pts;
}

const areaOf = (pts) => pts.reduce((a, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return a + x * ny - nx * y; }, 0) / 2;

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function reverse(sp) {
  const ends = [sp.start, ...sp.segs.map(({ t, p }) => (t === 'L' ? p : [p[4], p[5]]))];
  const segs = [];
  for (let k = sp.segs.length - 1; k >= 0; k--) {
    const { t, p } = sp.segs[k];
    segs.push(t === 'L' ? { t, p: ends[k] } : { t, p: [p[2], p[3], p[0], p[1], ...ends[k]] });
  }
  return { start: ends[ends.length - 1], segs, closed: sp.closed };
}

/**
 * One shape's subpaths, wound so that under nonzero it looks as it did on its own and adds to the other shapes:
 * evenodd → outline / hole by nesting depth; nonzero → its largest outline goes positive, the rest keep their relation.
 */
function orient(subs, evenodd) {
  const polys = subs.map(flatten);
  const areas = polys.map(areaOf);
  if (evenodd) {
    return subs.map((sp, i) => {
      const depth = polys.reduce((n, poly, j) => n + (j !== i && inside(polys[i][0], poly) ? 1 : 0), 0);
      return (depth % 2 === 0) === (areas[i] > 0) ? sp : reverse(sp);
    });
  }
  const big = areas.reduce((b, a, i) => (Math.abs(a) > Math.abs(areas[b]) ? i : b), 0);
  return areas[big] < 0 ? subs.map(reverse) : subs;
}

/* ---------- box and output ---------- */

function cubicRange(p0, p1, p2, p3) {
  const vals = [p0, p3];
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const roots = Math.abs(a) < 1e-12 ? (Math.abs(b) < 1e-12 ? [] : [-c / b])
    : (() => { const disc = b * b - 4 * a * c; if (disc < 0) return []; const r = Math.sqrt(disc); return [(-b + r) / (2 * a), (-b - r) / (2 * a)]; })();
  for (const t of roots) if (t > 0 && t < 1) { const u = 1 - t; vals.push(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3); }
  return vals;
}

function bboxOf(subs) {
  const xs = [], ys = [];
  for (const sp of subs) {
    let [x0, y0] = sp.start;
    xs.push(x0); ys.push(y0);
    for (const { t, p } of sp.segs) {
      if (t === 'L') { xs.push(p[0]); ys.push(p[1]); [x0, y0] = p; }
      else { xs.push(...cubicRange(x0, p[0], p[2], p[4])); ys.push(...cubicRange(y0, p[1], p[3], p[5])); [x0, y0] = [p[4], p[5]]; }
    }
  }
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

const fmt = (n) => { const v = Math.round(n * 100) / 100; return String(Object.is(v, -0) ? 0 : v); };
const subpathString = (sp) => `M${fmt(sp.start[0])} ${fmt(sp.start[1])} ${sp.segs.map(({ t, p }) => `${t}${p.map(fmt).join(' ')}`).join(' ')} Z`;
