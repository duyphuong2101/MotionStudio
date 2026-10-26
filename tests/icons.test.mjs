import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIRS, ROOT, readJson, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { svgToIconPath, parsePath, iconNameFrom, saveIcon, deleteIcon, loadBrandIcons, iconsFor, ICON_PATH_RE, ICON_NAME_RE, MAX_PATH_CHARS } from '../engine/icons.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { ICONS, BASE_ICONS, ICON_NAMES } from '../motion-kit/icons.mjs';
import { SET_ICONS } from '../motion-kit/icons-set.mjs';
import { iconRows } from '../motion-kit/build-icons.mjs';

// A throwaway profile, so icon tests never touch a real brand.
const PROJECT = 'zz-test-icons';
test.after(() => {
  fs.rmSync(path.join(DIRS.profiles, PROJECT), { recursive: true, force: true });
  fs.rmSync(path.join(DIRS.briefs, PROJECT), { recursive: true, force: true });
  fs.rmSync(path.join(DIRS.out, PROJECT), { recursive: true, force: true });
});

const svg = (inner, root = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}</svg>`;
const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
const xs = (d) => nums(d).filter((_, i) => i % 2 === 0);
const ys = (d) => nums(d).filter((_, i) => i % 2 === 1);

test('an icon is fitted into the motion-kit box as absolute M/L/C/Z only', () => {
  const d = svgToIconPath(svg('<path d="M12 2a10 10 0 110 20 10 10 0 010-20z"/>'));
  assert.match(d, ICON_PATH_RE);
  assert.doesNotMatch(d, /[a-z]|[AQSTHV]/);
  assert.ok(Math.min(...xs(d)) >= 5.9 && Math.max(...xs(d)) <= 94.1, d);
  assert.ok(Math.min(...ys(d)) >= 6.9 && Math.max(...ys(d)) <= 105.1, d);
});

test('relative commands, compact arc flags and quadratics are read', () => {
  const subs = parsePath('m1 1h4v4h-4z m6 0q2 0 2 2t2 2 a1 1 0 011 1');
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[0].start, [1, 1]);
  assert.deepEqual(subs[0].segs.map((s) => s.p), [[5, 1], [5, 5], [1, 5]]);
  assert.deepEqual(subs[1].start, [7, 1]);
  const last = subs[1].segs.at(-1).p;
  assert.deepEqual(last.slice(4), [12, 6], 'the arc ends where its flags and end point say');
});

test('shapes, transforms and hidden defs are handled like a browser would', () => {
  // A 90° turn of a wide rect makes a tall icon; the clipPath rect in defs is not drawn.
  const d = svgToIconPath(svg('<g clip-path="url(#c)"><rect x="0" y="9" width="24" height="6" fill="#111" transform="rotate(90 12 12)"/></g><defs><clipPath id="c"><rect width="24" height="24" fill="white"/></clipPath></defs>', 'viewBox="0 0 24 24" fill="none"'));
  const w = Math.max(...xs(d)) - Math.min(...xs(d)), h = Math.max(...ys(d)) - Math.min(...ys(d));
  assert.ok(h > w * 3, `expected a tall shape, got ${w} x ${h}`);
  for (const inner of ['<circle cx="12" cy="12" r="8"/>', '<ellipse cx="12" cy="12" rx="8" ry="4"/>', '<polygon points="2,2 22,2 12,20"/>', '<rect x="2" y="2" width="20" height="20" rx="4"/>']) {
    assert.match(svgToIconPath(svg(inner)), ICON_PATH_RE, inner);
  }
});

test('an evenodd hole is wound against its outline so nonzero templates keep the hole', () => {
  const d = svgToIconPath(svg('<path fill-rule="evenodd" d="M2 2h20v20H2z M6 6h12v12H6z"/>'));
  const [outer, inner] = d.split(' Z').filter((x) => x.trim()).map((sp) => parsePath(`${sp} Z`)[0]);
  const area = (sp) => { const p = [sp.start, ...sp.segs.map((s) => s.p)]; return p.reduce((a, [x, y], i) => { const [nx, ny] = p[(i + 1) % p.length]; return a + x * ny - nx * y; }, 0); };
  assert.ok(area(outer) * area(inner) < 0, 'outline and hole turn opposite ways');
});

test('outline-only, unsafe and empty icons are refused with a fix', () => {
  assert.throws(() => svgToIconPath(svg('<path d="M5 12h14"/>', 'viewBox="0 0 24 24" fill="none" stroke="currentColor"')), /only outlines/);
  assert.throws(() => svgToIconPath(svg('<script>alert(1)</script><path d="M0 0h1v1z"/>')), /active or external/);
  assert.throws(() => svgToIconPath(svg('<path onload="x()" d="M0 0h1v1z"/>')), /active or external/);
  assert.throws(() => svgToIconPath(svg('<text>Hi</text>')), /convert it to outlines/);
  assert.throws(() => svgToIconPath(svg('<use href="#a"/>')), /flatten or expand/);
  assert.throws(() => svgToIconPath(svg('<path d="M0 0 X 4"/>')), /cannot read/);
  assert.throws(() => svgToIconPath('<div>no svg</div>'), /no <svg>/);
});

test('icon names come from the file name and stay clear of the built-ins', () => {
  assert.equal(iconNameFrom('My Icon (2).svg'), 'my-icon-2');
  assert.equal(iconNameFrom('../../2-Forklift.svg'), 'forklift');
  assert.throws(() => iconNameFrom('123.svg'), /start with a letter/);
  assert.throws(() => saveIcon(PROJECT, 'star.svg', Buffer.from(svg('<circle cx="12" cy="12" r="8"/>'))), /built-in/);
  assert.throws(() => saveIcon(PROJECT, 'forklift.png', Buffer.from('x')), /\.svg/);
});

test('a saved icon is listed for the brand, refuses a silent overwrite and can be deleted', () => {
  const body = Buffer.from(svg('<rect x="2" y="6" width="20" height="12" rx="3"/>'));
  const { name, d } = saveIcon(PROJECT, 'Forklift.svg', body);
  assert.equal(name, 'forklift');
  assert.equal(loadBrandIcons(PROJECT).forklift, d);
  assert.equal(iconsFor(PROJECT).star, ICONS.star, 'built-ins stay available');
  assert.throws(() => saveIcon(PROJECT, 'forklift.svg', body), /already exists/);
  assert.equal(saveIcon(PROJECT, 'forklift.svg', body, { replace: true }).name, 'forklift');
  deleteIcon(PROJECT, 'forklift');
  assert.equal(loadBrandIcons(PROJECT).forklift, undefined);
  assert.throws(() => deleteIcon(PROJECT, 'forklift'), /not found/);
});

test('a hand-edited icons.json cannot smuggle markup into a page', () => {
  writeJson(path.join(DIRS.profiles, PROJECT, 'icons.json'), { ok: 'M1 1 L2 2 Z', bad: 'M1 1"/><script>x()</script>', star: 'M0 0 Z', 'Up': 'M1 1 Z' });
  assert.deepEqual(loadBrandIcons(PROJECT), { ok: 'M1 1 L2 2 Z' });
});

test('an icon in use by a job cannot be deleted', () => {
  saveIcon(PROJECT, 'forklift.svg', Buffer.from(svg('<circle cx="12" cy="12" r="8"/>')));
  writeJson(path.join(DIRS.briefs, PROJECT, 'job-a.json'), { project: PROJECT, id: 'job-a', template: 'promo', createdAt: '2026-10-14' });
  writeJson(path.join(DIRS.out, PROJECT, 'job-a', 'script.json'), { scenes: [{ id: 'b', kind: 'beat', icon: 'forklift' }] });
  assert.throws(() => deleteIcon(PROJECT, 'forklift'), /used by job-a/);
});

test('validateScript takes the brand icons it is given', () => {
  const { beats } = loadTemplate('product-demo');
  const script = { scenes: [{ id: 'x', kind: 'benefit', icon: 'forklift' }] };
  const iconErr = (opts) => validateScript(script, beats, opts).errors.filter((e) => e.includes('icon "forklift"'));
  assert.equal(iconErr({}).length, 1);
  assert.equal(iconErr({ icons: [...Object.keys(ICONS), 'forklift'] }).length, 0);
});

// Builds each icon template's minimal script with `icon` on every scene that takes one; returns { id: html }.
async function drawIconTemplates(icon, icons) {
  const brand = readJson(path.join(DIRS.profiles, 'nsc', 'brand.json'));
  const out = {};
  for (const id of ['product-demo', 'promo', 'explainer', 'ui-story']) {
    const { dir, beats } = loadTemplate(id);
    const scenes = [];
    for (const slot of beats.sequence) {
      for (let n = 0; n < slot.min; n++) {
        const takesIcon = (k) => [...beats.fields[k].required, ...beats.fields[k].optional].includes('icon');
        const kind = slot.kind.find(takesIcon) || slot.kind[0];
        const sc = { id: `${kind}-${scenes.length}`, kind, vo: 'A short line for this scene.', ...(beats.defaults?.[kind] || {}) };
        if (takesIcon(kind)) sc.icon = icon;
        scenes.push(sc);
      }
    }
    if (!scenes.some((s) => s.icon)) continue;
    const script = { scenes };
    const timing = estimateTiming(script, loadStudioConfig().timing, 'en', beats.pace || null);
    const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
    out[id] = build({ brief: { format: beats.formats[0] }, brand, script, timing, size: sizeFor(beats, beats.formats[0]), icons });
  }
  return out;
}

test('the icon templates draw a brand icon passed in the build args', async () => {
  const d = svgToIconPath(svg('<rect x="2" y="6" width="20" height="12" rx="3"/>'));
  const pages = await drawIconTemplates('forklift', { forklift: d });
  assert.equal(Object.keys(pages).length, 4, 'every icon template was checked');
  for (const [id, html] of Object.entries(pages)) assert.ok(html.includes(d), `${id} does not draw the brand icon`);
});

/* ---------- the built-in set ---------- */

test('the eleven original icons keep their exact paths and come first', () => {
  const hash = crypto.createHash('sha256').update(JSON.stringify(BASE_ICONS)).digest('hex');
  assert.equal(hash, '2741793079c9d94dfcf222c1bde6fe97576d2aadbfb4504e6086ac3940bd75a9', 'an original icon path changed: old scripts would render differently');
  assert.deepEqual(ICON_NAMES.slice(0, 11), Object.keys(BASE_ICONS));
  for (const [k, d] of Object.entries(BASE_ICONS)) assert.equal(ICONS[k], d);
});

test('every built-in icon has a clean name and a path the kit can store', () => {
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
  assert.ok(ICON_NAMES.length >= 81, `expected the commerce set, got ${ICON_NAMES.length} icons`);
  for (const [name, d] of Object.entries(SET_ICONS)) {
    assert.match(name, ICON_NAME_RE);
    assert.match(d, ICON_PATH_RE, name);
    assert.ok(d.length <= MAX_PATH_CHARS, `${name} is ${d.length} chars`);
  }
});

test('icons-set.mjs holds exactly the icons in icon-list.json, in list order', () => {
  const list = readJson(path.join(ROOT, 'motion-kit', 'icon-list.json'));
  assert.deepEqual(Object.keys(SET_ICONS), iconRows(list).map(([name]) => name), 'rerun node motion-kit/build-icons.mjs after editing the list');
});

test('the icon list refuses a clash, a repeat and a bad name', () => {
  const list = (icons) => ({ source: 'x', weight: 'fill', groups: { A: icons } });
  assert.throws(() => iconRows(list({ star: 'star' })), /used twice/);
  assert.throws(() => iconRows({ source: 'x', weight: 'fill', groups: { A: { cart: 'a' }, B: { cart: 'b' } } }), /used twice/);
  assert.throws(() => iconRows(list({ Cart: 'a' })), /must start with a letter/);
  assert.throws(() => iconRows(list({ cart: '../x' })), /Invalid icon source/);
});

test('a set icon validates, cannot be taken by a brand upload, and is drawn by every icon template', async () => {
  const { beats } = loadTemplate('product-demo');
  assert.deepEqual(validateScript({ scenes: [{ id: 'x', kind: 'benefit', icon: 'truck' }] }, beats).errors.filter((e) => e.includes('icon "truck"')), []);
  assert.throws(() => saveIcon(PROJECT, 'truck.svg', Buffer.from(svg('<circle cx="12" cy="12" r="8"/>'))), /built-in/);
  const pages = await drawIconTemplates('truck', null);
  assert.equal(Object.keys(pages).length, 4);
  for (const [id, html] of Object.entries(pages)) assert.ok(html.includes(ICONS.truck), `${id} does not draw the truck icon`);
});
