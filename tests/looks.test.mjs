import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIRS, readJson, writeJson, loadStudioConfig } from '../engine/core.mjs';
import {
  loadTemplate, validateBrief, saveBrief, updateBrief, setStatus, jobFile, commitBase, humanEdit, mergeRespectingLocks, diffLocks, editDirtyFrom,
} from '../engine/jobs.mjs';
import { LOOKS, LOOK_NAMES, BRAND_LOOK, lookBrand, lookProblem, scriptBrand, effectsProblems } from '../engine/looks.mjs';
import { validateBrand, motionProfile, MOTIONS, BACKDROPS, WIPES, CUT_SOUNDS } from '../engine/brand.mjs';
import { MUSIC } from '../engine/library.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { openComposition, lintInPage } from '../engine/media.mjs';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

const cfg = loadStudioConfig();
const BRAND = validateBrand({
  name: 'Look Co', logoText: 'look',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' },
});
// The templates quick mode starts with (plan quick-video); every look must build in each of their formats.
const QUICK_TEMPLATES = ['explainer', 'product-demo', 'social-teaser'];
const ASSETS = ['photo.jpg', 'clip.mp4', 'model.glb', 'anim.json'];
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2, tight: cfg.timing.tight };

/** A template's sample page in `brand`, timed the way prepare times it (tight gaps for a tight motion). */
async function samplePage(tid, brand, format) {
  const { dir, beats } = loadTemplate(tid);
  const sc = sampleScript(beats);
  const timing = estimateTiming(sc, TIMING, 'en', beats.pace || null, null, null, motionProfile(brand).tight);
  const { build } = await import(pathToFileURL(path.join(dir, 'template.mjs')).href);
  return build({ brief: { format }, brand, script: sc, timing, size: sizeFor(beats, format), icons: {} });
}

/* ---------- the table ---------- */

test('the four looks use only brand features that exist: motions, backdrops, wipes, cut sounds and built-in tracks', () => {
  assert.deepEqual(LOOK_NAMES, ['calm', 'energetic', 'premium', 'bold']);
  const tracks = MUSIC.map((m) => `library:${m.id}`);
  for (const [name, L] of Object.entries(LOOKS)) {
    assert.ok(MOTIONS.includes(L.motion) && L.motion !== 'standard', `${name}.motion`);
    assert.ok(L.backdrop === undefined || BACKDROPS.includes(L.backdrop), `${name}.backdrop`);
    assert.ok(L.wipe === undefined || WIPES.includes(L.wipe), `${name}.wipe`);
    assert.ok(L.sfx === undefined || (CUT_SOUNDS.includes(L.sfx.cut) && L.sfx.gainDb >= -30 && L.sfx.gainDb <= 0), `${name}.sfx`);
    assert.ok(tracks.includes(L.music), `${name}.music`);
    for (const k of ['shine', 'leaks']) assert.ok(L[k] === undefined || L[k] === true, `${name}.${k}`);
    assert.deepEqual(Object.keys(L).filter((k) => !['motion', 'backdrop', 'wipe', 'sfx', 'music', 'shine', 'leaks'].includes(k)), [], `${name}: unknown field`);
  }
});

test('every look over a plain brand is a valid brand carrying the look', () => {
  for (const name of LOOK_NAMES) {
    const b = validateBrand(lookBrand(name, BRAND));
    const L = LOOKS[name];
    assert.equal(b.motion, L.motion, name);
    assert.equal(b.backdrop, L.backdrop, name);
    assert.equal(b.wipe, L.wipe, name);
    assert.deepEqual(b.sfx, L.sfx, name);
    assert.deepEqual(b.music, { file: L.music, gainDb: BRAND.music.gainDb, duck: true }, name);
    assert.equal(b.shine, L.shine, name);
    assert.equal(b.leaks, L.leaks, name);
  }
});

/* ---------- precedence: what the brand sets wins ---------- */

test('look "brand" or no look returns the brand object itself', () => {
  for (const name of [BRAND_LOOK, undefined, null]) assert.equal(lookBrand(name, BRAND), BRAND, String(name));
});

test('a brand with motion: cinematic keeps it under every look', () => {
  const brand = validateBrand({ ...BRAND, motion: 'cinematic' });
  for (const name of LOOK_NAMES) assert.equal(lookBrand(name, brand).motion, 'cinematic', name);
});

test('every field the brand sets wins; the look fills only the fields left unset', () => {
  const brand = validateBrand({ ...BRAND, backdrop: 'mesh', sfx: { cut: 'riser', gainDb: -20 }, music: { file: 'song.mp3', gainDb: -22 }, shine: true });
  const b = lookBrand('energetic', brand);
  assert.equal(b.backdrop, 'mesh');
  assert.deepEqual(b.sfx, { cut: 'riser', gainDb: -20 });
  assert.deepEqual(b.music, { file: 'song.mp3', gainDb: -22 }, 'the brand track stays whole, not ducked by the look');
  assert.equal(b.shine, true);
  assert.equal(b.motion, 'kinetic', 'unset: filled');
  assert.equal(b.wipe, 'liquid', 'unset: filled');
  // A built-in track the person picked is the brand's too.
  assert.equal(lookBrand('calm', validateBrand({ ...BRAND, music: { file: 'library:steady-tech' } })).music.file, 'library:steady-tech');
});

test('a look keeps the brand music level and leaves colours, fonts, voice and logo alone', () => {
  const brand = validateBrand({ ...BRAND, music: { gainDb: -25 }, voice: { lang: 'vi' }, logo: 'logo.png' });
  const b = lookBrand('premium', brand);
  assert.deepEqual(b.music, { file: 'library:soft-pulse', gainDb: -25, duck: true });
  for (const k of ['colors', 'fonts', 'voice', 'logo', 'name', 'sources']) assert.deepEqual(b[k], brand[k], k);
});

test('lookBrand is a pure function: same answer twice, the brand and the table untouched', () => {
  const brand = structuredClone(BRAND), table = structuredClone(LOOKS);
  for (const name of LOOK_NAMES) {
    const a = lookBrand(name, brand);
    assert.deepEqual(a, lookBrand(name, brand), name);
    assert.notEqual(a, brand, `${name}: a new object`);
    if (a.sfx) a.sfx.gainDb = 0;
    a.music.file = 'changed.mp3';
  }
  assert.deepEqual(brand, BRAND, 'brand not mutated');
  assert.deepEqual(LOOKS, table, 'table not mutated through a result');
});

test('an unknown look is refused with the list of looks', () => {
  for (const name of ['epic', 'Calm', '__proto__', 'constructor', 'toString', 3]) {
    assert.throws(() => lookBrand(name, BRAND), (e) => e.code === 400 && e.message.includes('is not one of brand, calm, energetic, premium, bold'), String(name));
  }
});

/* ---------- script validation ---------- */

test('validateScript takes an absent look, brand or a look name, and names the choices for anything else', () => {
  const { beats } = loadTemplate('explainer');
  const base = sampleScript(beats);
  assert.deepEqual(validateScript(base, beats, { assets: ASSETS }).errors, []);
  for (const look of [BRAND_LOOK, ...LOOK_NAMES]) assert.deepEqual(validateScript({ ...base, look }, beats, { assets: ASSETS }).errors, [], look);
  assert.deepEqual(validateScript({ ...base, look: 'epic' }, beats, { assets: ASSETS }).errors, ['look "epic" is not one of brand, calm, energetic, premium, bold']);
  assert.deepEqual(validateScript({ ...base, look: null }, beats, { assets: ASSETS }).errors, ['look null is not one of brand, calm, energetic, premium, bold']);
  assert.equal(lookProblem(undefined), null);
});

/* ---------- locks ---------- */

const script = (look) => ({ scenes: [{ id: 'hero', kind: 'title', title: 'Hi', vo: 'Hi.' }], ...(look === undefined ? {} : { look }) });

test('a person\'s look edit is locked, re-prepares from step 5 and is kept on the next merge', () => {
  const { doc, changed } = humanEdit('script', script(), script('energetic'), 'anna');
  assert.deepEqual(changed, ['look']);
  assert.equal(doc.locks.look.by, 'anna');
  assert.equal(editDirtyFrom('script', doc, changed), 5);
  const { doc: merged, kept } = mergeRespectingLocks('script', doc, script('calm'));
  assert.equal(merged.look, 'energetic');
  assert.deepEqual(kept, ['look']);
  // The Director's draft without a look keeps the person's too.
  assert.equal(mergeRespectingLocks('script', doc, script()).doc.look, 'energetic');
});

test('a look the person cleared stays cleared; without a lock the draft\'s look wins', () => {
  const { doc } = humanEdit('script', script('bold'), script(), 'anna');
  assert.equal('look' in mergeRespectingLocks('script', doc, script('calm')).doc, false);
  assert.equal(mergeRespectingLocks('script', { ...script('bold'), locks: {} }, script('calm')).doc.look, 'calm');
  assert.deepEqual(diffLocks('script', script('bold'), script('bold')), []);
});

test('a scene lock and no look lock: the draft sets the look, the scene field stays', () => {
  const { doc } = humanEdit('script', script(), { scenes: [{ ...script().scenes[0], title: 'Mine' }] }, 'anna');
  const { doc: merged, kept } = mergeRespectingLocks('script', doc, { scenes: [{ ...script().scenes[0], title: 'Theirs' }], look: 'premium' });
  assert.equal(merged.look, 'premium');
  assert.equal(merged.scenes[0].title, 'Mine');
  assert.deepEqual(kept, ['scene:hero.title']);
});

const P = 'zz-test-looks';

test('a locked look carries over a template change to the next script', (t) => {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const brief = validateBrief({ id: 'j', project: P, template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'm' });
  saveBrief(brief);
  setStatus(P, 'j', { status: 'awaiting_review', step: 8 }, 'test');
  writeJson(jobFile(P, 'j', 'script.json'), { ...script('premium'), locks: { look: { by: 'anna' } } });
  updateBrief(P, 'j', { ...brief, template: 'event' }, { by: 'anna' });
  const base = commitBase(P, 'j', 'script');
  assert.equal(base.look, 'premium');
  assert.deepEqual(readJson(jobFile(P, 'j', 'script.locks.json')).locks, { look: { by: 'anna' } });
  const { doc, kept } = mergeRespectingLocks('script', base, { scenes: [{ id: 'poster', kind: 'poster' }], look: 'calm' });
  assert.equal(doc.look, 'premium');
  assert.deepEqual(kept, ['look']);
  assert.deepEqual(doc.locks, { look: { by: 'anna' } });
});

/* ---------- every look builds in every format of the quick templates (no Chrome) ---------- */

for (const tid of QUICK_TEMPLATES) {
  test(`${tid}: every look builds in every format, with its backdrop, wipe and leaks on the page`, async () => {
    const { beats } = loadTemplate(tid);
    for (const name of LOOK_NAMES) {
      const L = LOOKS[name];
      for (const format of beats.formats) {
        const html = await samplePage(tid, lookBrand(name, BRAND), format);
        const at = `${tid} ${name} ${format}`;
        assert.match(html, /window\.seek = /, `${at}: no seek contract`);
        assert.equal(html.includes('id="glb"'), Boolean(L.backdrop), `${at}: backdrop`);
        assert.equal(html.includes('id="glw"'), Boolean(L.wipe), `${at}: wipe`);
        assert.equal(html.includes('function lightLeaks()'), Boolean(L.leaks), `${at}: leaks`);
        assert.equal(html.includes('drawGrain(t)') && html.includes('id="vig"'), motionProfile({ motion: L.motion }).bg === 'grain', `${at}: grain`);
      }
    }
  });
}

/* ---------- T5: every look plays through in Chrome ---------- */

// Every still lints clean and at most one scene and one caption line show at a time. 16:9 and 9:16 are scanned
// frame by frame; the other formats around every cut, where two scenes or two lines could overlap.
const FULL_SCAN = ['16:9', '9:16'];
const CUT_WINDOW = 0.5;

for (const name of LOOK_NAMES) {
  test(`${name}: the explainer sample plays through clean in every format (Chrome)`, { timeout: 1200000 }, async (t) => {
    if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
    const folder = await chromeFolder(t, `ms-look-${name}-`);
    const { beats } = loadTemplate('explainer');
    const brand = lookBrand(name, BRAND);
    for (const format of beats.formats) {
      const file = folder.write(`${name}-${format.replace(':', 'x')}.html`, await samplePage('explainer', brand, format));
      const { browser, page: pg, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, format) });
      try {
        for (const st of info.stills) {
          await pg.evaluate((at) => window.seek(at), st.t);
          assert.deepEqual(await pg.evaluate(lintInPage, cfg.lint.safeArea), [], `${name} ${format} ${st.id}`);
        }
        const ranges = FULL_SCAN.includes(format) ? [[0, info.duration]]
          : info.scenes.slice(1).map((sc) => [Math.max(0, sc.start - CUT_WINDOW), Math.min(info.duration, sc.start + CUT_WINDOW)]);
        const stacked = await pg.evaluate((spans) => {
          const bad = [];
          for (const [a, b] of spans) {
            for (let t = a; t < b; t += 1 / 30) {
              window.seek(t);
              const on = [...document.querySelectorAll('#stage > .sc')].filter((g) => getComputedStyle(g).visibility !== 'hidden' && +getComputedStyle(g).opacity > 0.05);
              if (on.length > 1) bad.push(`${t.toFixed(2)} ${on.map((g) => g.id).join('+')}`);
              const subs = [...document.querySelectorAll('.subt')].filter((el) => +getComputedStyle(el).opacity > 0.05);
              if (subs.length > 1) bad.push(`${t.toFixed(2)} captions ${subs.map((el) => el.id).join('+')}`);
            }
          }
          return bad;
        }, ranges);
        assert.deepEqual(stacked, [], `${name} ${format}: one scene and one caption line at a time`);
      } finally {
        await browser.close();
      }
    }
  });
}

/* ---------- per-video effects ---------- */

test('script effects win over the brand and the look; false or "none" turns one off', () => {
  const brand = { name: 'B', leaks: true, shine: true, sfx: { cut: 'hit', gainDb: -18 } };
  const out = scriptBrand({ look: 'premium', effects: { leaks: false, carry: true, sfx: 'none', backdrop: 'aurora' } }, brand);
  assert.equal('leaks' in out, false);
  assert.equal('sfx' in out, false);
  assert.equal(out.carry, true);
  assert.equal(out.shine, true, 'a field the effects leave out stays as the brand set it');
  assert.equal(out.backdrop, 'aurora');
  assert.equal(scriptBrand({}, brand), brand, 'no effects and no look: the brand itself');
});

test('script effects are checked by name and value', () => {
  assert.deepEqual(effectsProblems(undefined), []);
  assert.deepEqual(effectsProblems({ leaks: true, sfx: { cut: 'whoosh', gainDb: -24 } }), []);
  assert.deepEqual(effectsProblems({ glow: true }), ['effects.glow is not one of leaks, carry, shine, confetti, backdrop, sfx']);
  assert.deepEqual(effectsProblems({ leaks: 'yes' }), ['effects.leaks must be true or false']);
  assert.equal(effectsProblems({ sfx: { cut: 'boom', gainDb: -3 } }).length, 1);
  assert.ok(validateScript({ ...script(), effects: { backdrop: 'stars' } }, loadTemplate('explainer').beats).errors.some((e) => e.startsWith('effects.backdrop')));
});

test('a person\'s effects edit is locked and kept on the next merge', () => {
  const fx = { effects: { leaks: true } };
  const { doc, changed } = humanEdit('script', script(), { ...script(), ...fx }, 'anna');
  assert.deepEqual(changed, ['effects']);
  assert.equal(editDirtyFrom('script', doc, changed), 5);
  const { doc: merged, kept } = mergeRespectingLocks('script', doc, script());
  assert.deepEqual(merged.effects, { leaks: true });
  assert.deepEqual(kept, ['effects']);
});
