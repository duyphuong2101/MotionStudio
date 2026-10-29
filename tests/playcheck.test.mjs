import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { openComposition } from '../engine/media.mjs';
import { playCheck, playFrames, groupHits, PLAY_DEFAULTS } from '../engine/playcheck.mjs';
import { page } from '../templates/kit.mjs';

const cfg = loadStudioConfig();
const BRAND = {
  name: 'Play Co', logo: null, logoDark: null, logoText: 'play', site: '',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Arial', body: 'Arial', googleFonts: '' },
  voice: { tts: 'none', voice: '', speed: 1, lang: 'en' }, music: { file: null, gainDb: -18 }, sources: { allowedHosts: [] },
};
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 3, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1 };
const SIZE = { width: 1920, height: 1080 };
const STEP = 1 / 12;

test('frames are evenly spaced, capped at maxFrames, with one history mark per interval', () => {
  const { frames, marks } = playFrames(3, { step: 0.25, maxFrames: 1500, historyEvery: 0.5 });
  assert.deepEqual(frames.map((f) => f.t), [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75]);
  assert.deepEqual(marks, [0, 0.5, 1, 1.5, 2, 2.5]);
  assert.deepEqual(frames.filter((f) => f.j !== undefined).map((f) => f.j), [0, 1, 2, 3, 4, 5]);
  const capped = playFrames(100, { step: 1 / 12, maxFrames: 200, historyEvery: 0.5 });
  assert.equal(capped.frames.length, 200);
  assert.equal(capped.times[1], 0.5, 'sampled evenly over the whole video');
});

test('hits of one problem over many frames group into one finding with its time ranges', () => {
  const times = Array.from({ length: 40 }, (_, i) => i / 10);
  const hit = (i) => ({ k: 'text', i, key: 'text|1|2', scene: 'a', el: 'x × y', what: 'x "A" × y "B"' });
  const [f] = groupHits([3, 4, 5, 6, 20, 21].map(hit), times, []);
  assert.equal(f.level, 'error');
  assert.equal(f.msg, 'text over text 0.30–0.60, 2.00–2.10 s: x "A" × y "B"');
  assert.equal(f.t, 0.3);
  const [short] = groupHits([7, 8, 30].map(hit), times, []);
  assert.equal(short.level, 'warning', 'two frames at most is a transition frame');
  assert.match(short.msg, /^text over text 0\.70–0\.80, 3\.00 s: .*\(a transition frame\)$/);
  const many = groupHits([1, 3, 5, 7, 9].map(hit), times, [])[0];
  assert.match(many.msg, /0\.10, 0\.30, 0\.50 s \(\+2 more\)/);
  const lint = groupHits([{ k: 'lint', i: 2, key: 'lint|a|m', scene: 'a', el: 'a', what: 'text is wider than its box' }], times, [0, 0.5, 1]);
  assert.deepEqual(lint, [{ level: 'warning', scene: 'a', el: 'a', msg: 'mid-motion lint 1.00 s: text is wider than its box', t: 1 }]);
});

// A kit page from hand-made scenes: `html` is each scene's markup, FX[id](s, e) adds its tweens.
function kitPage(dir, name, scenes, { css = '', fx = '', brand = BRAND } = {}) {
  const script = { lang: 'en', scenes: scenes.map(({ id, vo }) => ({ id, kind: 'x', vo })) };
  const timing = estimateTiming(script, TIMING, 'en');
  const html = page({
    brand, script, timing, size: SIZE, title: name, particles: false,
    css: `.t{position:absolute;font:700 60px Arial;white-space:nowrap}${css}`,
    body: scenes.map((s) => `<div class="sc fill" id="g-${s.id}">${s.html}</div>`).join('\n'),
    scenes: scenes.map(({ id }) => ({ id, kind: 'x' })),
    js: `const FX = {${fx}};\nconst KINDS = { x: (sc, s, e) => (FX[sc.id] || (() => {}))(s, e) };`,
  });
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, html);
  return { file, timing };
}

async function check(t, dir, name, scenes, o = {}) {
  const { file, timing } = kitPage(dir, name, scenes, o);
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...SIZE }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return null; }
  try {
    const r = await playCheck(opened.page, opened.info, { ...PLAY_DEFAULTS, step: STEP, safeArea: cfg.lint.safeArea, oneScene: o.brand?.motion === 'cinematic' });
    return { ...r, timing };
  } finally {
    await opened.browser.close();
  }
}

test('broken pages: each kind of play-through problem is one finding with its time range', { timeout: 180000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-play-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gsapDir = path.dirname(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const scene = (id, html) => ({ id, vo: 'A short line for this scene to say.', html });
  const errors = (r) => r.findings.filter((f) => f.level === 'error');

  await t.test('a clean page has no findings', async (tt) => {
    const r = await check(tt, dir, 'clean', [scene('a', '<div class="t" style="left:200px;top:200px">Alpha</div>'), scene('b', '<div class="t" style="left:200px;top:400px">Beta</div>')]);
    if (r) assert.deepEqual(r.findings, []);
  });

  await t.test('two texts in one spot: text over text for the whole scene', async (tt) => {
    const r = await check(tt, dir, 'stack', [
      scene('a', '<div class="t" id="a-one" style="left:200px;top:200px">Alpha one</div><div class="t" id="a-two" style="left:230px;top:215px">Alpha two</div>'),
      scene('b', '<div class="t" style="left:200px;top:200px">Beta</div>')]);
    if (!r) return;
    const [f] = errors(r);
    assert.equal(errors(r).length, 1, JSON.stringify(r.findings));
    assert.equal(f.scene, 'a');
    assert.equal(f.el, 'a-one × a-two');
    const end = r.timing.scenes[0].end;
    const m = /^text over text 0\.00–(\d+\.\d+) s: a-one "Alpha one" × a-two "Alpha two"$/.exec(f.msg);
    assert.ok(m, f.msg);
    assert.ok(Math.abs(+m[1] - end) < 0.2, `${m[1]} vs scene end ${end}`);
  });

  await t.test('a big number does not touch the kicker above it: glyph boxes, not line boxes', async (tt) => {
    const r = await check(tt, dir, 'stat', [scene('a', '<div class="t" style="left:200px;top:80px;font-size:40px">MOBILE ORDERS</div><div class="t" style="left:200px;top:100px;font-size:300px">88%</div>')]);
    if (r) assert.deepEqual(r.findings, []);
  });

  await t.test('text shown for one frame over another is a warning, not an error', async (tt) => {
    const r = await check(tt, dir, 'blip', [scene('a', '<div class="t" style="left:200px;top:200px">Alpha</div><div class="t" id="a-blip" style="left:210px;top:205px;opacity:0">Blip</div>')],
      { fx: `a: (s) => { tl.set('#a-blip', { opacity: 1 }, s + 1.01).set('#a-blip', { opacity: 0 }, s + 1.1); }` });
    if (!r) return;
    assert.equal(r.findings.length, 1, JSON.stringify(r.findings));
    assert.equal(r.findings[0].level, 'warning');
    assert.match(r.findings[0].msg, /^text over text 1\.08 s: .*\(a transition frame\)$/);
  });

  await t.test('scene text in the caption band: the caption covers it', async (tt) => {
    const r = await check(tt, dir, 'cover', [scene('a', '<div class="t" id="a-low" style="left:0;right:0;text-align:center;bottom:80px">Lower third label</div>')]);
    if (!r) return;
    const f = errors(r).find((x) => x.msg.startsWith('caption covers scene text'));
    assert.ok(f, JSON.stringify(r.findings));
    assert.equal(f.el, 'a-low');
    assert.match(f.msg, /^caption covers scene text 0\.\d+–\d+\.\d+ s: sub-a over a-low "Lower third label"$/);
  });

  await t.test('a caption that stays on into the next scene: two captions at once', async (tt) => {
    const r = await check(tt, dir, 'caps', [scene('a', '<div class="t" style="left:200px;top:200px">Alpha</div>'), scene('b', '<div class="t" style="left:200px;top:200px">Beta</div>')],
      { fx: `b: (s) => { tl.set('#sub-a', { opacity: 1 }, s + 0.5).set('#sub-a', { opacity: 0 }, s + 1.5); }` });
    if (!r) return;
    const f = errors(r).find((x) => x.msg.startsWith('two captions at once'));
    assert.ok(f, JSON.stringify(r.findings));
    const b = r.timing.scenes[1].start;
    const m = /^two captions at once (\d+\.\d+)–(\d+\.\d+) s: sub-a \+ sub-b$/.exec(f.msg);
    assert.ok(m, f.msg);
    assert.ok(+m[1] >= b + 0.5 - 0.01 && +m[1] < b + 0.6 && +m[2] < b + 1.5 && +m[2] > b + 1.3, f.msg);
  });

  await t.test('a cinematic page that keeps the old scene on: two scenes at once', async (tt) => {
    const r = await check(tt, dir, 'scenes', [scene('a', '<div class="t" style="left:200px;top:200px">Alpha</div>'), scene('b', '<div class="t" style="left:200px;top:500px">Beta</div>')],
      { brand: { ...BRAND, motion: 'cinematic' }, fx: `b: (s) => { tl.set('#g-a', { visibility: 'visible', filter: 'none' }, s).set('#g-a', { visibility: 'hidden' }, s + 1); }` });
    if (!r) return;
    const f = errors(r).find((x) => x.msg.startsWith('two scenes at once'));
    assert.ok(f, JSON.stringify(r.findings));
    assert.match(f.msg, /^two scenes at once \d+\.\d+–\d+\.\d+ s: a \+ b$/);
    assert.ok(!errors(r).some((x) => x.msg.startsWith('text')), 'the texts sit apart');
  });

  await t.test('two scenes stacking their text: text of two scenes at once', async (tt) => {
    const r = await check(tt, dir, 'across', [scene('a', '<div class="t" id="a-t" style="left:200px;top:200px">Alpha</div>'), scene('b', '<div class="t" id="b-t" style="left:210px;top:210px">Beta</div>')],
      { fx: `b: (s) => { tl.set('#g-a', { visibility: 'visible', opacity: 1 }, s).set('#g-a', { visibility: 'hidden' }, s + 1); }` });
    if (!r) return;
    const f = errors(r).find((x) => x.msg.startsWith('text of two scenes at once'));
    assert.ok(f, JSON.stringify(r.findings));
    assert.match(f.msg, /: a-t "Alpha" \(a\) × b-t "Beta" \(b\)$/);
  });

  await t.test('an entrance that outlives a later set: played and jumped differ', async (tt) => {
    const r = await check(tt, dir, 'history', [scene('a', '<div class="t" id="a-late" style="left:200px;top:200px">Late</div>')],
      { fx: `a: (s) => { tl.fromTo('#a-late', { opacity: 0 }, { opacity: 1, duration: 2, ease: 'none', immediateRender: false }, s).set('#a-late', { opacity: 0 }, s + 1); }` });
    if (!r) return;
    const f = errors(r).filter((x) => x.msg.startsWith('played and jumped differ') && x.el === 'a-late');
    assert.ok(f.length, JSON.stringify(r.findings));
    // The set at 1 s hides it once; the running entrance paints it back while played, a jump lands on the set.
    assert.ok(f.every((x) => x.scene === 'a' && x.t >= 1 && x.t <= 2.01), JSON.stringify(f));
    for (const x of f) assert.match(x.msg, /^played and jumped differ \d+\.\d\d(–\d+\.\d\d)?(, \d+\.\d\d(–\d+\.\d\d)?)* s: a-late opacity [\d.]+ played, [\d.]+ jumped from the (start|end)$/);
  });
});
