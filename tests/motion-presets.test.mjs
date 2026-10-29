import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { openComposition, lintInPage } from '../engine/media.mjs';
import { MOTION_PROFILES, MOTIONS, motionProfile, validateBrand } from '../engine/brand.mjs';
import { MOTION_OPTIONS, motionOpt } from '../ui/shots.js';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

const cfg = loadStudioConfig();
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2, tight: cfg.timing.tight };

/** The sample page of template `tid` with the brand's motion, timed the way prepare times it (tight gaps or not). */
async function samplePage(tid, brand, format = '16:9') {
  const { dir, beats } = loadTemplate(tid);
  const sc = sampleScript(beats);
  const timing = estimateTiming(sc, TIMING, 'en', beats.pace || null, null, null, motionProfile(brand).tight);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  return build({ brief: { format }, brand, script: sc, timing, size: sizeFor(beats, format), icons: {} });
}

/**
 * Opens the explainer and data-story samples in 16:9 and 9:16 with `motion` in Chrome: every still lints clean, at most
 * one scene and one caption line show at any frame, and after a jump back only the word being said is lit. `own(pg,
 * info, tid, format)` adds the profile's own checks.
 */
async function chromeChecks(t, motion, own = null, extra = {}) {
  if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
  const folder = await chromeFolder(t, `ms-${motion}-`);
  const brand = { ...BRAND, ...extra, motion };
  for (const tid of ['explainer', 'data-story']) {
    for (const format of ['16:9', '9:16']) {
      const { beats } = loadTemplate(tid);
      const file = folder.write(`${tid}-${format.replace(':', 'x')}.html`, await samplePage(tid, brand, format));
      const { browser, page: pg, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, format) });
      try {
        for (const st of info.stills) {
          await pg.evaluate((at) => window.seek(at), st.t);
          assert.deepEqual(await pg.evaluate(lintInPage, cfg.lint.safeArea), [], `${tid} ${format} ${st.id}`);
        }
        const stacked = await pg.evaluate(() => {
          const bad = [];
          for (let t = 0; t < window.__studio.duration; t += 1 / 30) {
            window.seek(t);
            const on = [...document.querySelectorAll('#stage > .sc')].filter((g) => getComputedStyle(g).visibility !== 'hidden' && +getComputedStyle(g).opacity > 0.05);
            if (on.length > 1) bad.push(`${t.toFixed(2)} ${on.map((g) => g.id).join('+')}`);
            const subs = [...document.querySelectorAll('.subt')].filter((el) => +getComputedStyle(el).opacity > 0.05);
            if (subs.length > 1) bad.push(`${t.toFixed(2)} captions ${subs.map((el) => el.id).join('+')}`);
          }
          return bad;
        });
        assert.deepEqual(stacked, [], `${tid} ${format}: one scene and one caption line at a time`);
        const stale = await pg.evaluate(() => {
          const bad = [], D = window.__studio.duration;
          for (let t = 0.2; t < D; t += 0.5) {
            window.seek(D); window.seek(t);
            const lit = [...document.querySelectorAll('.sw span.hl')].map((el) => el.id);
            if (lit.length > 1) bad.push(`${t.toFixed(1)} ${lit.join('+')}`);
          }
          return bad;
        });
        assert.deepEqual(stale, [], `${tid} ${format}: one word lit after a jump back`);
        if (own) await own(pg, info, tid, format);
      } finally {
        await browser.close();
      }
    }
  }
}

const BRAND = {
  name: 'Preset Co', logoText: 'preset',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' },
};
const FIELDS = {
  entrance: (v) => typeof v === 'string' && v.length > 0,
  cut: (v) => ['fade', 'blur', 'panel', 'zoom'].includes(v),
  push: (v) => typeof v === 'number' && v >= 1 && v <= 1.1,
  bg: (v) => ['particles', 'grain', 'none'].includes(v),
  caps: (v) => ['block', 'lines'].includes(v),
  layout: (v) => ['classic', 'stage'].includes(v),
  tight: (v) => typeof v === 'boolean',
  oneScene: (v) => typeof v === 'boolean',
};

test('every motion profile row sets every field to a known value; MOTIONS lists the rows', () => {
  assert.deepEqual(MOTIONS, Object.keys(MOTION_PROFILES));
  assert.equal(MOTIONS[0], 'standard');
  for (const [id, row] of Object.entries(MOTION_PROFILES)) {
    for (const [k, ok] of Object.entries(FIELDS)) assert.ok(ok(row[k]), `${id}.${k} = ${row[k]}`);
    if (row.cut === 'fade') assert.ok(row.cutD > 0 && row.cutD <= 0.5, `${id}.cutD`);
    assert.ok(row.layers === undefined || row.layers === true, `${id}.layers`);
    assert.ok(row.carrier === undefined || row.carrier === true, `${id}.carrier`);
  }
  // Standard is today's page; cinematic keeps every value it had before the table, plus the carrier it takes (2026-10-26).
  assert.deepEqual(MOTION_PROFILES.standard, { entrance: 'std', cut: 'fade', cutD: 0.3, push: 1, bg: 'particles', caps: 'block', layout: 'classic', tight: false, oneScene: false });
  assert.deepEqual(MOTION_PROFILES.cinematic, { entrance: 'cine', cut: 'blur', push: 1.03, bg: 'grain', caps: 'lines', layout: 'stage', tight: true, oneScene: true, carrier: true });
});

test('motionProfile gives standard for an absent, unknown or inherited name', () => {
  for (const motion of [undefined, null, '', 'epic', 'constructor', '__proto__', 'toString', 42]) {
    assert.equal(motionProfile({ ...BRAND, motion }), MOTION_PROFILES.standard, String(motion));
  }
  assert.equal(motionProfile(null), MOTION_PROFILES.standard);
  for (const id of MOTIONS) assert.equal(motionProfile({ motion: id }), MOTION_PROFILES[id]);
});

test('validateBrand stores every motion but standard, and refuses another name listing all of them', () => {
  for (const id of MOTIONS.filter((m) => m !== 'standard')) assert.equal(validateBrand({ ...BRAND, motion: id }).motion, id);
  assert.equal('motion' in validateBrand({ ...BRAND, motion: 'standard' }), false);
  for (const motion of ['epic', 'constructor', 'Cinematic', 3]) {
    assert.throws(() => validateBrand({ ...BRAND, motion }), (e) => e.code === 400 && e.message.includes(`motion must be one of ${MOTIONS.join(', ')}`), String(motion));
  }
});

test('the Brand tab offers every motion the engine takes, in its order, each with a short English hint', () => {
  assert.deepEqual(MOTION_OPTIONS.map((o) => o.id), MOTIONS);
  for (const o of MOTION_OPTIONS) {
    assert.match(o.label, /^[A-Z][a-z]+$/, `${o.id}: one-word label`);
    assert.ok(o.hint.endsWith('Applies when the storyboard is rebuilt.') && o.hint.length <= 200 && /^[\x20-\x7e]+$/.test(o.hint), `${o.id}: ${o.hint}`);
    // The film box shows exactly for a profile that draws film grain.
    assert.equal(!!o.film, MOTION_PROFILES[o.id].bg === 'grain', `${o.id}: film flag`);
    // The carry box shows exactly for a profile with a carrier.
    assert.equal(!!o.carry, !!MOTION_PROFILES[o.id].carrier, `${o.id}: carry flag`);
  }
  assert.equal(motionOpt(undefined), MOTION_OPTIONS[0]);
  assert.equal(motionOpt('epic'), MOTION_OPTIONS[0]);
  assert.equal(motionOpt('cinematic').id, 'cinematic');
});

test('film: false is kept only next to a motion that draws film grain', () => {
  for (const id of MOTIONS) {
    const kept = 'film' in validateBrand({ ...BRAND, motion: id, film: false });
    assert.equal(kept, MOTION_PROFILES[id].bg === 'grain', id);
  }
});

test('each profile draws its own surface and captions: grain, particles or nothing; one pill or one line at a time', async () => {
  for (const id of MOTIONS) {
    const M = MOTION_PROFILES[id], html = await samplePage('explainer', { ...BRAND, motion: id });
    assert.equal(html.includes('drawGrain(t)') && html.includes('id="vig"'), M.bg === 'grain', `${id}: grain`);
    assert.equal(html.includes(' drawBg(t);'), M.bg === 'particles', `${id}: particles`);
    assert.equal(html.includes('"caps":{'), M.caps === 'lines', `${id}: caption lines`);
    assert.equal(html.includes('.prog{display:none}'), M.layout === 'stage', `${id}: stage layout`);
    assert.equal(html.includes('.cw{display:inline-block}'), M.entrance === 'cine', `${id}: word split css`);
  }
});

// ---- clean: the stage layout and tight gaps without blur, push-in or grain ----

test('clean: short sharp entrances, 0.15 s fades, no blur, no push-in, no grain, no particles', async () => {
  for (const tid of ['explainer', 'data-story']) {
    const html = await samplePage(tid, { ...BRAND, motion: 'clean' });
    assert.ok(html.includes("{ y: (o.y ?? 24) * U, opacity: 0 }, { y: 0, opacity: 1, duration: o.d ?? 0.35, ease: o.ease || 'power2.out'"), tid);
    assert.ok(html.includes("{ scale: o.from ?? 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: o.d ?? 0.3, ease: 'power2.out'"), tid);
    assert.ok(html.includes('if (!first) tl.fromTo(g, { opacity: 0 }, { opacity: 1, duration: 0.15, immediateRender: false }, s);'), tid);
    assert.ok(html.includes('if (!last) tl.to(g, { opacity: 0, duration: 0.15, ease: XI }, e - 0.15)'), tid);
    for (const s of ["filter: 'blur", ' drawBg(t);', 'id="grain"', 'scale: 1.03', 'cineWords', "'back.out(1.7)'"]) assert.ok(!html.includes(s), `${tid}: ${s}`);
  }
});

test('clean: lint at every still, one scene and one caption line at a time, one lit word after a jump back', { timeout: 300000 }, async (t) => {
  await chromeChecks(t, 'clean');
});

// ---- editorial: masked headline words, wipes, a brand panel over every cut ----

test('editorial: masked headings, wiped elements and a panel over every cut; a brand wipe replaces the panel', async () => {
  const html = await samplePage('explainer', { ...BRAND, motion: 'editorial' });
  assert.ok(html.includes('const maskWords = (el) => {') && html.includes("{ yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'power4.out', stagger: 0.04"));
  assert.ok(html.includes("clipPath: 'inset(0% 100% 0% 0%)'") && html.includes('.mw{display:inline-block;overflow:hidden'));
  assert.ok(html.includes('<div id="cutpanel" class="cp" aria-hidden="true"></div>') && html.includes('panelCuts();') && html.includes('"cutPanel":[['));
  assert.ok(html.includes("if (!last) tl.set(g, { visibility: 'hidden' }, e);") && !/fromTo\(g, \{ opacity: 0/.test(html), 'a hard cut under the panel');
  for (const s of ["filter: 'blur", ' drawBg(t);', 'id="grain"', 'scale: 1.03', 'cineWords']) assert.ok(!html.includes(s), s);
  // The panel takes the secondary colour before a dark scene (the explainer's cta is drawn dark).
  const data = JSON.parse(html.match(/"cutPanel":(\[\[.*?\]\])/)[1]);
  assert.ok(data.every((w) => w.length === 4 && w[1] <= 0.25 && w[2] <= 0.25));
  const wiped = await samplePage('explainer', { ...BRAND, motion: 'editorial', wipe: 'liquid' });
  assert.ok(!wiped.includes('id="cutpanel"') && !wiped.includes('panelCuts') && wiped.includes('const maskWords'));
  // ui-story has its own #panel: the kit's sheet never takes that id.
  assert.ok((await samplePage('ui-story', { ...BRAND, motion: 'editorial' })).includes('id="cutpanel"'));
});

test('editorial: Chrome checks, and the panel covers the frame at each cut and is gone 0.3 s later', { timeout: 300000 }, async (t) => {
  await chromeChecks(t, 'editorial', async (pg, info, tid, format) => {
    const bad = await pg.evaluate(() => {
      const out = [], P = document.getElementById('cutpanel');
      for (const sc of window.__studio.scenes.slice(1)) {
        window.seek(sc.start);
        const at = gsap.getProperty(P, 'xPercent');
        window.seek(sc.start + 0.3);
        const after = gsap.getProperty(P, 'xPercent');
        if (Math.abs(at) > 2 || after < 99) out.push(`${sc.id}: ${at} then ${after}`);
      }
      return out;
    });
    assert.deepEqual(bad, [], `${tid} ${format}: panel at the cuts`);
  });
});

// ---- kinetic: big bouncy entrances and zoom or slide cuts on the standard layout ----

test('kinetic: overshooting entrances, zoom and slide cuts by cut index, particles, one caption line at a time', async () => {
  const html = await samplePage('data-story', { ...BRAND, motion: 'kinetic' });
  assert.ok(html.includes("{ y: (o.y ?? 60) * U, opacity: 0 }, { y: 0, opacity: 1, duration: o.d ?? 0.45, ease: o.ease || 'back.out(1.8)'"));
  assert.ok(html.includes("duration: o.d ?? 0.45, ease: 'back.out(2.2)'") && html.includes("duration: dur * 0.6, ease: 'expo.out'"));
  assert.ok(html.includes("tl.fromTo(g, { scale: 0.9 }, { scale: 1, duration: 0.22, ease: 'back.out(1.4)'") && html.includes("tl.fromTo(g, { xPercent: 8 }, { xPercent: 0, duration: 0.22, ease: 'power4.out'"));
  assert.ok(html.includes(' drawBg(t);') && html.includes('"caps":{') && !html.includes('.prog{display:none}') && !html.includes("filter: 'blur"));
  assert.ok(!/Math\.random|Date\.now|setTimeout|setInterval/.test(html.slice(html.indexOf('function build()'), html.indexOf('const ctx = '))), 'the scene loop is a function of the timeline only');
});

test('kinetic: Chrome checks; an even cut lands from small, an odd cut slides in from the right; text stays in the safe area at the overshoot', { timeout: 300000 }, async (t) => {
  await chromeChecks(t, 'kinetic', async (pg, info, tid, format) => {
    const moves = await pg.evaluate(() => window.__studio.scenes.slice(1).map((sc, j) => {
      window.seek(sc.start + 0.05);
      const g = document.getElementById('g-' + sc.id);
      return { id: sc.id, k: j + 1, scale: gsap.getProperty(g, 'scale'), x: gsap.getProperty(g, 'xPercent') };
    }));
    for (const m of moves) {
      if (m.k % 2 === 0) assert.ok(m.scale < 1, `${tid} ${format} ${m.id}: scale ${m.scale}`);
      else assert.ok(m.x > 0, `${tid} ${format} ${m.id}: xPercent ${m.x}`);
    }
    for (const sc of info.scenes.slice(1)) {
      await pg.evaluate((at) => window.seek(at), sc.start + 0.15);
      const out = (await pg.evaluate(lintInPage, cfg.lint.safeArea)).filter((f) => /safe area/.test(f.msg));
      assert.deepEqual(out, [], `${tid} ${format} ${sc.id} at the overshoot`);
    }
  });
});

// ---- parallax: a drifting camera, text and pictures at their own speed, long soft entrances ----

test('parallax: a drifting camera on every scene, layer drift for text and pictures, 0.4 s fades; ui-story keeps its window still', async () => {
  const html = await samplePage('explainer', { ...BRAND, motion: 'parallax' });
  assert.ok(html.includes("{ y: (o.y ?? 30) * U, opacity: 0 }, { y: 0, opacity: 1, duration: o.d ?? 1.1, ease: o.ease || 'expo.out'"));
  assert.ok(html.includes('tl.fromTo(g, { scale: 1.02, x: dir * 10 * U, y: dir * 6 * U }, { scale: 1.05, x: -dir * 10 * U, y: -dir * 6 * U'));
  assert.ok(html.includes('function layerDrift(g, s, e) {') && html.includes('if (g) layerDrift(g, s, e);'));
  assert.ok(html.includes("tl.fromTo('#bgc', { x: dir * 24 * U }, { x: -dir * 24 * U"), 'the far layer drifts with the camera');
  assert.ok(html.includes('duration: 0.4, immediateRender: false }, s);') && html.includes(' drawBg(t);'));
  const ui = await samplePage('ui-story', { ...BRAND, motion: 'parallax' });
  assert.ok(ui.includes('tl.fromTo(g, { scale: 1.02') && !ui.includes('layerDrift'), 'ui-story: camera yes, layers no');
  assert.ok(ui.includes(' + Math.ceil((sub.offsetTop - D.H / 2) * 0.05)'), 'ui-story lifts its caption by the larger push');
  const gl = await samplePage('explainer', { ...BRAND, motion: 'parallax', backdrop: 'mesh' });
  assert.ok(!gl.includes("tl.fromTo('#bgc'"), 'a WebGL backdrop does not drift (its edge would show)');
});

test('parallax: Chrome checks; a heading drifts during its scene; played and jumped agree', { timeout: 300000 }, async (t) => {
  const { playCheck, PLAY_DEFAULTS } = await import('../engine/playcheck.mjs');
  await chromeChecks(t, 'parallax', async (pg, info, tid, format) => {
    const drift = await pg.evaluate(() => {
      const out = [];
      for (const sc of window.__studio.scenes) {
        const h = document.querySelector(`#g-${sc.id} .hd`);
        if (!h) continue;
        window.seek(sc.start + 0.05); const a = gsap.getProperty(h, 'x');
        window.seek((sc.start + sc.end) / 2); const b = gsap.getProperty(h, 'x');
        out.push({ id: sc.id, a, b });
      }
      return out;
    });
    assert.ok(drift.some((d) => d.a !== d.b), `${tid} ${format}: no heading drifts ${JSON.stringify(drift)}`);
    const { findings } = await playCheck(pg, info, { ...PLAY_DEFAULTS, step: 1 / 6, safeArea: cfg.lint.safeArea, oneScene: true });
    assert.deepEqual(findings.filter((f) => f.level === 'error'), [], `${tid} ${format}: play-through`);
  });
});
