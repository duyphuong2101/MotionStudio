import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { scopeCss } from '../engine/mix.mjs';
import { openComposition, lintInPage, ffmpegReport } from '../engine/media.mjs';
import { build } from '../templates/explainer/template.mjs';
import { captionLines, CAP_LAND } from '../templates/kit.mjs';

const lines = (text, max = CAP_LAND) => { const w = text.split(' ').map((x) => ({ w: x })); return captionLines(w, max).map(([a, b]) => w.slice(a, b + 1).map((x) => x.w).join(' ')); };

test('caption lines stay short and even, break at sentence ends and never end on a weak word', () => {
  const v = lines('We found a Find My Fit test routing every visitor to control. We rebuilt it, and it now runs on desktop and mobile.');
  assert.ok(v.every((l) => l.length <= CAP_LAND), v.join(' | '));
  assert.ok(v.some((l) => l.endsWith('control.')), 'a sentence ends a line');
  assert.ok(v.every((l, i) => i === v.length - 1 || !/\.\s/.test(l)), 'no sentence stops mid-line');
  assert.ok(v.every((l, i) => i === v.length - 1 || !/ (a|the|to|every|and|of)$/i.test(l)), v.join(' | '));
  assert.deepEqual(lines('Chicago.'), ['Chicago.']);
  // A spoken number stays on one line.
  const money = lines('From January to September, online revenue grew from eleven point one eight to twelve point two six million dollars.');
  assert.ok(money.some((l) => l.includes('eleven point one eight')) && money.some((l) => l.includes('twelve point two six million dollars.')), money.join(' | '));
  assert.ok(lines('Third-quarter revenue grew fourteen point four percent.').some((l) => l.includes('fourteen point four percent.')));
  assert.ok(lines('Across twenty-two iterations, build errors fell from six hundred and eight to zero.').some((l) => l.includes('six hundred and eight')));
  assert.deepEqual(captionLines([]), []);
  assert.deepEqual(lines('Supercalifragilisticexpialidocious-and-more-and-more-words here', 20), ['Supercalifragilisticexpialidocious-and-more-and-more-words', 'here']);
  assert.equal(lines('a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j').join(' '), 'a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j');
});

test('cinematic captions are written one line per element; standard pages keep one block per scene', () => {
  const brand = { ...BRAND, subtitles: { size: 40, weight: 400, color: '#262524', bg: '#ffffff' } };
  const cine = page({ ...brand, motion: 'cinematic' });
  assert.ok(cine.includes('id="sub-how-0"') && cine.includes('"caps":{'));
  assert.ok(!page(brand).includes('"caps":') && page(brand).includes('id="sub-how"'));
});

const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
const BRAND = {
  name: 'Cine Co', logo: null, logoDark: null, logoText: 'cine', site: '',
  colors: { primary: '#262524', primary2: '#4682ff', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5c5c', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Inter', body: 'Inter', googleFonts: '' },
  voice: { tts: 'none', voice: '', speed: 1, lang: 'en' }, music: { file: null, gainDb: -18 }, sources: { allowedHosts: [] },
};
const beats = loadTemplate('explainer').beats;
const script = { lang: 'en', scenes: [
  { id: 'open', kind: 'title', theme: 'dark', kicker: 'Chicago.', title: 'The Diaper King.', vo: 'Chicago has its own Diaper King.' },
  { id: 'clip', kind: 'video', title: 'On site', video: 'visit.mp4', in: 0, out: 5, vo: 'Side by side with the client.', source: 'bullets[0]' },
  { id: 'how', kind: 'step', title: 'Plan', icon: 'chat', vo: 'We plan it together.', source: 'bullets[0]' },
] };
const page = (brand) => {
  const timing = estimateTiming(script, TIMING, 'en', beats.pace);
  return build({ brief: { format: '16:9' }, brand, script, timing, size: sizeFor(beats, '16:9') });
};

test('brand.motion takes standard or cinematic; only cinematic is stored', () => {
  assert.equal(validateBrand({ ...BRAND, motion: 'cinematic' }).motion, 'cinematic');
  assert.equal('motion' in validateBrand({ ...BRAND, motion: 'standard' }), false);
  assert.equal('motion' in validateBrand(BRAND), false);
  assert.throws(() => validateBrand({ ...BRAND, motion: 'epic' }), /motion must be one of standard, cinematic/);
});

// sha1 of build() for each template's sample in every format with motion: cinematic, recorded before the motion
// profile refactor (plan motion-presets, T1), re-recorded on 2026-10-26 for the cut veil (every template) and the
// diagram highlight tween (explainer). The same brand and timing as PARTS_BASELINE in templates.test.mjs.
// Re-recorded 2026-10-29: typed text (the kit's typeText, every page) and ui-story's swapped texts no longer go through
// TextPlugin, which set innerHTML; checked that only those two edits change the pages.
const CINE_BASELINE = {
  // Explainer re-recorded 2026-10-26 for the model scene's studio lighting, shadow and new spins (MODEL_JS only).
  // Updated 2026-10-27: a model scene takes a camera path, exploded parts, a decal and a brand environment, a tour canvas, and the anim (Lottie) kind joined the sample (only MODEL_JS and the new kind; the pre-kind baselines leave anim out).
  // Updated 2026-10-28: a softer model contact shadow (a wider PCF blur, lighter ground); only MODEL_JS changed.
  // Updated 2026-10-29: MODEL_JS calls the opt-in bloom and focus composer; checked that only MODEL_JS changed.
  explainer: { '16:9': '96fe611755aff6d091d5e31fc1af009f32dc8642', '1:1': 'ea020901508cbc4e906341bb94f98e97c7ad589f', '9:16': '69b894839c25fa9c4be345dc5d2875d0ce1e3323', '4:5': 'd0490e02e7ed1c1164ba5c97ec6901736fb45b96', '2:3': '43f33a0841f4bbc0c5bed55de0dfdf7d293e2910', '21:9': 'f3324cf549b9d2c340b860994295574a8001cb74' },
  'data-story': { '16:9': '02bfd0558abde63af4b8ae6595ac396b278605bb', '1:1': '6b8c44a3726d43d58de1c099de4491c5d73f3e3a', '9:16': '430c92b9ffad6fa569a9e73dd78300cc0b6aac13', '4:5': 'd82ce7b1052f872e741870adfe16ad7f5c088349', '2:3': 'ee7604a5b96191d2ee3b2ed69fdf96eb5fea079a', '21:9': 'f185951b866796102b6b04c3275f413646478347' },
  testimonial: { '9:16': '14ab068eb535cd84e62a31249b335aeb175268c2', '1:1': 'da9b5cdd41108772d1a378d6164f7bb6c4036944', '16:9': '2a201072428738db8b90ff15d3754150cfe11f31', '4:5': '844f5bb8747cc218e5704baf8cc6bdbfea82816a', '2:3': 'a5adbbde8dcbbad4e1d21c5cdb8671681afdbe46', '21:9': '3f3c95ca7ceb8a39da10eb0385803a9700634eaa' },
  event: { '9:16': '590e6697f24b646ffe357cd16465419222f47f4c', '1:1': '1432b74a7379deb1c3a97c07759c5aaab19936c0', '16:9': '3516ed7d84bb37712d80a7baa2caa4a3e7d46569', '4:5': '46b675de13f79978af16ed3729562979b33d35b1', '2:3': '96984a85bb756baf68d3a96a4a5c95f7cde89f40', '21:9': '2a277e800516179a727c555b23b837cc007428dd' },
  // Code-story re-recorded 2026-10-28: a diff line that only changed shows its changed tokens (pairChanges, user decision).
  'code-story': { '16:9': '9d981b6a94cfdda0a095dad3a2002570730940d2', '1:1': '61e72a4b01270f3acc1274d80614f67b7352859d', '9:16': 'af51d4f8e11695b770e08ecd1365fdf610a3d289', '4:5': '916f5d52d3c2d55fc7ba239b8f7492cd9698cc7b' },
  'before-after': { '9:16': 'f242809421ff6ae71ed8f46da1270caf3f85ad51', '1:1': '676a8b19b891afe0427acb9cbe1a6e1fda5d90ba', '16:9': '1efba841976d35b1da2439480b4ceb44a464acf5', '4:5': '35c9b55d470817f0915b980f59291d9df7b0a0d6', '2:3': 'dd38f599b7330bf8fd0ba42e3b1b071f8ec8c353', '21:9': 'b308f8203d7c0c92fdc54c96b256eb4cb93cd4b8' },
  'ui-story': { '16:9': '5909644ded83a44e8b2d796e8d9f958180e9e307' },
};
const HASH_BRAND = { name: 'Hash Co', logoText: 'Hash', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' }, motion: 'cinematic' };
const HASH_TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };

test('cinematic pages of every pinned template build byte for byte as before the motion profiles', async () => {
  const { sampleScript } = await import('../engine/template-preview.mjs');
  for (const [id, hashes] of Object.entries(CINE_BASELINE)) {
    const { beats } = loadTemplate(id);
    const sc = sampleScript(beats);
    const timing = estimateTiming(sc, HASH_TIMING, 'en', beats.pace || null);
    const { build: b } = await mod(id);
    for (const [format, sha] of Object.entries(hashes)) {
      const html = b({ brief: { format }, brand: HASH_BRAND, script: sc, timing, size: sizeFor(beats, format) });
      assert.equal(crypto.createHash('sha1').update(html).digest('hex'), sha, `${id} ${format}: cinematic output changed`);
    }
  }
});

test('brand.film: false drops the film grain and vignette of a cinematic page and keeps the rest', () => {
  assert.equal(validateBrand({ ...BRAND, motion: 'cinematic', film: false }).film, false);
  assert.equal('film' in validateBrand({ ...BRAND, motion: 'cinematic', film: true }), false);
  assert.equal('film' in validateBrand({ ...BRAND, film: false }), false);
  assert.throws(() => validateBrand({ ...BRAND, film: 'off' }), /film must be true or false/);
  const grainy = page({ ...BRAND, motion: 'cinematic' }), clean = page({ ...BRAND, motion: 'cinematic', film: false });
  assert.ok(grainy.includes('id="grain"') && grainy.includes('drawGrain(t)') && grainy.includes('id="vig"'));
  assert.ok(!clean.includes('id="grain"') && !clean.includes('drawGrain') && !clean.includes('id="vig"') && !clean.includes('#vig{'));
  assert.ok(clean.includes('"caps":{') && clean.includes('scale: 1.03'), 'captions and push-in stay cinematic');
  assert.equal(page({ ...BRAND, film: false }), page(BRAND), 'a standard page ignores film');
});

test('a step counts "Step 01 / 02" only without its own kicker; a kicker replaces the counter', async () => {
  const html = await render('explainer', [S('a', 'step', { title: 'Plan', icon: 'chat' }), S('b', 'step', { title: 'Cloudflare CDN', icon: 'globe', kicker: 'Now in our hands' })], { ...BRAND, motion: 'cinematic' });
  assert.match(html, /<div class="snum" data-lint>Step 01 <span>\/ 02<\/span><\/div>/);
  assert.match(html, /<div class="snum" data-lint>Now in our hands<\/div>/);
});

test('a dark title theme passes the explainer rules; another theme is refused', () => {
  assert.deepEqual(validateScript(script, beats).errors.filter((e) => /theme/.test(e)), []);
  const bad = { ...script, scenes: [{ ...script.scenes[0], theme: 'neon' }, ...script.scenes.slice(1)] };
  assert.ok(validateScript(bad, beats).errors.some((e) => /theme/.test(e)));
});

test('cinematic pages trade particles for grain, focus-pull cuts and a camera push; standard pages keep none of it', () => {
  const cine = page({ ...BRAND, motion: 'cinematic' });
  assert.ok(cine.includes('<canvas id="grain"') && cine.includes('<div id="vig"></div>'));
  assert.ok(cine.includes(' drawGrain(t);') && !cine.includes(' drawBg(t);'));
  assert.ok(cine.includes("const EXO = 'expo.out';") && cine.includes('const cineWords = '));
  assert.ok(cine.includes("{ filter: 'blur(18px)' }, { filter: 'blur(0px)'") && cine.includes('{ scale: 1.03, duration:'));
  assert.ok(!/fromTo\(g, \{ opacity: 0/.test(cine), 'a cinematic cut never fades a scene in over the previous one');
  assert.ok(!cine.includes("ease: 'back.out(1.7)'"), 'no overshoot pop');
  const std = page(BRAND);
  for (const s of ['id="grain"', 'drawGrain', 'cineWords', 'blur(18px)', 'id="vig"']) assert.ok(!std.includes(s), s);
  assert.ok(std.includes(' drawBg(t);') && std.includes("ease: 'back.out(1.7)'"));
});

test('cinematic footage fills the frame under a lower third and counts as a dark scene', () => {
  const cine = page({ ...BRAND, motion: 'cinematic' });
  assert.match(cine, /<div class="sc fill dark vfull" id="g-clip"><div class="vbg" id="clip-win"><video data-clip="clip"/);
  assert.ok(cine.includes('<div class="vcap">') && cine.includes('.vbg video{display:block;width:100%;height:100%;object-fit:cover}'));
  assert.ok(!cine.includes('class="vwin"'));
  const std = page(BRAND);
  assert.ok(std.includes('<div class="vwin" id="clip-win">') && !std.includes('vfull'));
});

test('a dark title is a centred cold open in either motion style', () => {
  for (const html of [page(BRAND), page({ ...BRAND, motion: 'cinematic' })]) {
    assert.ok(html.includes('<div class="sc fill dark" id="g-open"><div class="ttl tdark">'));
    assert.ok(html.includes('.tdark{align-items:center;text-align:center}'));
  }
});

// ---- themes, flash, cinematic layout, corner logo ----

const AWARD = { ...BRAND, logo: 'logo.svg', logoDark: 'logo-dark.svg', logoBug: true, motion: 'cinematic' };
const STD_AWARD = (({ motion, ...b }) => b)(AWARD);
const mod = async (id) => import(pathToFileURL(path.join(loadTemplate(id).dir, 'template.mjs')).href);
const S = (id, kind, o) => ({ id, kind, source: 'bullets[0]', vo: 'A short line for this scene.', ...o });
const render = async (tid, scenes, brand, format = '16:9') => {
  const { beats } = loadTemplate(tid);
  const sc = { lang: 'en', scenes };
  return (await mod(tid)).build({ brief: { format }, brand, script: sc, timing: estimateTiming(sc, TIMING, 'en', beats.pace), size: sizeFor(beats, format) });
};
const FLASH = S('work', 'flash', { kicker: 'Nine workstreams', items: ['Strategy', 'Design', 'Commerce', 'Search', 'Data', 'Cloud', 'Support', 'Quality', 'Optimization'], title: 'One partnership.', vo: 'Strategy. Design. Commerce. Search. Data. Cloud. Support. Quality. Optimization. One partnership.' });
const THEMED = {
  explainer: [S('open', 'title', { title: 'Hi', theme: 'accent' }), S('a', 'step', { title: 'Plan', icon: 'chat', theme: 'dark' }), S('b', 'diagram', { title: 'Flow', nodes: ['A', 'B'], theme: 'accent' }), { ...FLASH, theme: 'dark' }],
  'data-story': [S('s', 'stat', { value: 9.7, format: 'pct', text: 'growth', theme: 'dark' }), S('b', 'bars', { title: 'T', items: [{ label: 'A', value: 2 }, { label: 'B', value: 1 }], theme: 'accent' }), S('l', 'line', { title: 'T', points: [1, 3, 2], theme: 'dark' })],
  'before-after': [S('s', 'stat', { value: 88, text: 'less image transfer', theme: 'accent' })],
};

test('every themed kind takes light, dark or accent; another theme is refused', () => {
  for (const [tid, scenes] of Object.entries(THEMED)) {
    const { beats } = loadTemplate(tid);
    assert.deepEqual(beats.enums.theme, ['light', 'dark', 'accent'], tid);
    for (const s of scenes) {
      assert.ok(beats.fields[s.kind].optional.includes('theme'), `${tid}.${s.kind} lists theme`);
      assert.deepEqual(validateScript({ scenes: [s] }, beats).errors.filter((e) => /theme/.test(e)), [], `${tid}.${s.kind}`);
      assert.ok(validateScript({ scenes: [{ ...s, theme: 'neon' }] }, beats).errors.some((e) => /theme must be light\|dark\|accent/.test(e)));
    }
  }
});

test('a dark scene is drawn on the brand dark colour and marked dark; accent is the secondary colour with ink text', async () => {
  for (const [tid, scenes] of Object.entries(THEMED)) {
    for (const brand of [STD_AWARD, AWARD]) {
      const html = await render(tid, scenes, brand);
      for (const s of scenes) {
        const cls = s.theme === 'dark' ? 'sc fill dark' : 'sc fill acc';
        assert.ok(html.includes(`<div class="${cls}" id="g-${s.id}">`), `${tid} ${s.id}: ${cls}`);
        // The logo bug and the subtitles read `dark` from the scene data.
        assert.equal(html.includes(`"id":"${s.id}","kind":"${s.kind}"`) && new RegExp(`"id":"${s.id}"[^}]*"dark":true`).test(html), s.theme === 'dark', `${tid} ${s.id} dark flag`);
      }
      if (scenes.some((s) => s.theme === 'accent')) assert.ok(html.includes('.acc{background:var(--secondary);color:var(--ink)}'), tid);
    }
    const plain = await render(tid, scenes.map(({ theme, ...s }) => s), STD_AWARD);
    assert.ok(!plain.includes('.acc') && !plain.includes(' acc"') && !plain.includes('.dark .big{color:var(--secondary)'), `${tid}: no theme rules without a theme`);
  }
  // The explainer's shared icon takes the themed step's colours.
  const html = await render('explainer', THEMED.explainer, AWARD);
  assert.ok(html.includes("tl.set('#xicon', { attr: { class: sc.theme ? 'x' + sc.theme : '' } }, s - 0.15);") && html.includes('#xicon.xdark #xshape{stroke:var(--on)}'));
});

test('flash items are 2-12 strings of at most 40 characters; title and theme are optional', () => {
  const { beats } = loadTemplate('explainer');
  assert.ok(beats.mixable.includes('flash') && beats.sequence[1].kind.includes('flash'));
  const errs = (patch) => validateScript({ scenes: [{ ...FLASH, ...patch }] }, beats).errors.filter((e) => !/at position \d/.test(e)).join(' | ');
  assert.equal(errs({}), '');
  assert.equal(errs({ title: undefined }), '');
  assert.match(errs({ items: ['One'] }), /items must list 2-12/);
  assert.match(errs({ items: Array.from({ length: 13 }, (_, i) => `W${i}`) }), /items must list 2-12/);
  assert.equal(errs({ items: ['Fine', 'Easy Create Order & Auto-Ship page'] }), '', 'a 34-character item fits');
  assert.match(errs({ items: ['Fine', 'x'.repeat(41)] }), /items\[1\]: text is required, at most 40 characters/);
  assert.match(errs({ items: ['Fine', 7] }), /items\[1\]/);
  assert.match(errs({ items: undefined }), /items is required/);
  assert.match(errs({ title: 'x'.repeat(45) }), /title is 45 chars, limit 44/);
});

// A radio bite of 1.9 s cut away as soon as it ended (NSC a1 `king`, 2026-10-26): `hold` keeps the last frame a moment.
// Updated 2026-10-29: `hold` became a field of every scene (the Timeline's pause after a line), 0-4 s.
test('a sound clip may hold its last frame for up to 4 s after the clip ends', () => {
  const { beats } = loadTemplate('explainer');
  const errs = (patch) => validateScript({ scenes: [S('k', 'video', { title: 'King', video: 'king.mp4', sound: true, vo: '', ...patch })] }, beats, { assets: ['king.mp4'] }).errors.filter((e) => !/at position \d/.test(e)).join(' | ');
  assert.equal(errs({ hold: 0.7 }), '');
  assert.equal(errs({ hold: '1' }), '');
  assert.match(errs({ hold: 4.5 }), /hold must be 0 to 4 seconds/);
  assert.match(errs({ hold: -1 }), /hold must be 0 to 4 seconds/);
  assert.ok(beats.fields.video.optional.includes('hold'));
});

test('flash shows one large item at a time over the voice line, then lands the title; its code is written only when used', async () => {
  for (const brand of [STD_AWARD, AWARD]) {
    const html = await render('explainer', [S('open', 'title', { title: 'Hi' }), FLASH], brand);
    const sizes = [...html.matchAll(/<div class="fl" id="work-f\d+"><div class="fi" data-lint style="font-size:(\d+)px">/g)].map((m) => +m[1]);
    assert.equal(sizes.length, 9);
    assert.ok(sizes.every((x) => x >= 110 && x <= 170), `item sizes ${sizes}`);
    assert.equal(sizes[0], 170, 'a short word gets the largest size');
    assert.match(html, /<div class="flw"><div class="hd fi flt" id="work-ft" data-lint style="font-size:\d+px">One partnership\.<\/div>/);
    assert.ok(html.includes('flash(sc, s, e) {') && html.includes('ws[hit].start - 0.08 : cue(sc, k / beats)'));
    assert.ok(html.includes('"kind":"flash","n":9,"title":true,"heads":["strategy","design","commerce","search","data","cloud","support","quality","optimization"]'));
    assert.equal(html.includes("filter: 'blur(14px)'"), brand === AWARD, 'a focus pull per item only in cinematic');
  }
  const port = await render('explainer', [S('open', 'title', { title: 'Hi' }), FLASH], AWARD, '9:16');
  assert.ok([...port.matchAll(/class="fi" data-lint style="font-size:(\d+)px"/g)].every((m) => +m[1] <= 150));
  assert.ok(!(await render('explainer', [S('open', 'title', { title: 'Hi' }), S('a', 'step', { title: 'Plan', icon: 'chat' })], AWARD)).includes('flash'));
});

// The flash beats used to spread evenly over the voice line, so an item named late in the line showed about a second
// early (NSC a3 `delivered`, 2026-10-26). Now an item flashes on the word that starts it, when the voice says that word.
test('a flash item shows as the voice says its first word; items the voice does not name keep the even beats', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-flash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const named = S('d', 'flash', { kicker: 'Delivered', items: ['Auto-Ship · skip & pause', 'Easy Create Order page', 'USPS API migration'], title: 'Shipped.', vo: 'Auto-Ship, from past orders to skip and pause, and now the easy Create Order page, then the USPS API migration.' });
  const spoken = S('d2', 'flash', { kicker: 'Delivered', items: ['Auto-Ship', 'Facebook Shop · live'], title: 'Shipped, sprint by sprint.', vo: 'Auto-Ship, skip and pause, and Facebook Shop, live. Shipped, sprint by sprint.' });
  const scenes = [S('open', 'title', { title: 'Hi' }), named, spoken, FLASH];
  const { beats } = loadTemplate('explainer');
  const sc = { lang: 'en', scenes };
  const timing = estimateTiming(sc, TIMING, 'en', beats.pace);
  const file = path.join(dir, 'flash.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: { ...BRAND, motion: 'cinematic', fonts: { display: 'Arial', body: 'Arial' } }, script: sc, timing, size: sizeFor(beats, '16:9') }));
  const ws = timing.words.filter((w) => w.scene === 'd');
  const at = (word) => ws.find((w) => w.w.toLowerCase().replace(/[^a-z0-9]/g, '') === word).start;
  const spread = ws[Math.floor(ws.length / 3)].start;
  assert.ok(at('easy') - spread > 0.6, `the test line must put "easy" well after the even beat (${at('easy')} vs ${spread})`);
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const vis = (x) => opened.page.evaluate((v) => { window.seek(v); return ['d-f0', 'd-f1', 'd-f2'].map((id) => Math.round(+getComputedStyle(document.getElementById(id)).opacity * 10) / 10); }, x);
    assert.deepEqual(await vis(at('easy') - 0.2), [1, 0, 0], 'before "easy" the first item still shows');
    assert.deepEqual(await vis(at('easy') + 0.3), [0, 1, 0], 'on "easy" the second item is in');
    assert.deepEqual(await vis(at('usps') - 0.2), [0, 1, 0]);
    assert.deepEqual(await vis(at('usps') + 0.3), [0, 0, 1], 'on "USPS" the third');
    // The title is not said: it waits until the line is over (it came in mid-sentence, NSC a3, 2026-10-26).
    const title = (x) => opened.page.evaluate((v) => { window.seek(v); return Math.round(+getComputedStyle(document.getElementById('d-ft')).opacity * 10) / 10; }, x);
    const lastEnd = ws[ws.length - 1].end;
    assert.equal(await title(lastEnd - 0.2), 0, 'no title while the voice still speaks');
    assert.equal(await title(Math.min(lastEnd + 0.15, timing.scenes.find((x) => x.id === 'd').end - 0.6) + 0.6), 1, 'the title lands after the line');
    // A title the voice says lands on its first word, after the last item.
    const w2 = timing.words.filter((w) => w.scene === 'd2'), shipped = w2.find((w) => /^shipped/i.test(w.w)).start;
    const title2 = (x) => opened.page.evaluate((v) => { window.seek(v); return Math.round(+getComputedStyle(document.getElementById('d2-ft')).opacity * 10) / 10; }, x);
    assert.equal(await title2(shipped - 0.3), 0, 'not before "Shipped"');
    assert.equal(await title2(shipped + 0.6), 1, 'in on "Shipped"');
    // The nine workstreams line names none of its items: the beats still spread over the line.
    const nine = timing.words.filter((w) => w.scene === 'work');
    const t4 = nine[Math.floor((4 / 10) * nine.length)].start;
    const on = await opened.page.evaluate((v) => { window.seek(v); return Math.round(+getComputedStyle(document.getElementById('work-f4')).opacity); }, t4 + 0.3);
    assert.equal(on, 1);
  } finally { await opened.browser.close(); }
});

test('cinematic centres the content between the corner logo and the subtitles, in larger type; standard pages keep their layout', async () => {
  const cases = {
    explainer: [[S('open', 'title', { title: 'Hi' }), S('a', 'step', { title: 'Plan', icon: 'chat' }), S('d', 'diagram', { title: 'F', nodes: ['A', 'B', 'C'] })], ['.step{padding:140px 120px 210px', '.diag{padding:140px 120px 210px', '.stt{font-size:108px}', '.nodes:has(> :nth-child(7)) .node{font-size:48px']],
    'data-story': [THEMED['data-story'], ['.box.center,.box:has(> .bars),.box:has(> .chart){padding:140px 170px 210px}', '.big{font-size:300px}', '.bl{font-size:52px}']],
    'before-after': [[S('sp', 'split', { before: { items: ['a'] }, after: { items: ['b'] } }), S('s', 'stat', { value: 1, text: 't' })], ['.stitle{top:140px;font-size:72px}', '.stat{padding:140px 110px 210px}', '.big{font-size:300px}']],
    'code-story': [[S('c', 'checklist', { title: 'T', items: ['a', 'b'] })], ['.box:has(> .check){padding:140px 170px 210px', '.ci{font-size:58px', '.check:has(> :nth-child(6)) .ci{font-size:48px}']],
  };
  for (const [tid, [scenes, rules]] of Object.entries(cases)) {
    const cine = await render(tid, scenes, AWARD), std = await render(tid, scenes, STD_AWARD);
    for (const r of rules) {
      assert.ok(cine.includes(r), `${tid} cinematic: ${r}`);
      assert.ok(!std.includes(r), `${tid} standard: ${r}`);
    }
  }
  // Without the corner logo the content area starts higher.
  const noBug = await render('explainer', cases.explainer[0], { ...AWARD, logoBug: false });
  assert.ok(noBug.includes('.step{padding:100px 120px 210px'));
});

test('theme, flash and cinematic rules stay flat css that a mixed page can scope', async () => {
  for (const [tid, scenes] of Object.entries({ explainer: [...THEMED.explainer, S('s', 'step', { title: 'x', icon: 'chat', theme: 'accent' })], 'data-story': [...THEMED['data-story'], S('l2', 'line', { title: 'T', points: [1, 2, 3], band: { from: 1, to: 2, label: 'Q3' }, ref: { value: 2, label: 'Target' } })], 'code-story': [S('c', 'checklist', { title: 'T', items: ['a'] })] })) {
    const { beats } = loadTemplate(tid);
    for (const format of beats.formats) {
      const sc = { lang: 'en', scenes };
      const { css } = (await mod(tid)).parts({ brief: { format }, brand: AWARD, script: sc, timing: estimateTiming(sc, TIMING, 'en', beats.pace), size: sizeFor(beats, format) });
      assert.doesNotThrow(() => scopeCss(css, `.t-${tid}`), `${tid} ${format}`);
    }
  }
});

test('with the corner logo on, a cta scene leaves out its own logo, so a frame shows the logo once', async () => {
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const withCta = ['explainer', 'data-story', 'before-after', 'code-story', 'promo', 'testimonial', 'event', 'talking-head', 'lifestyle', 'audiogram'];
  for (const tid of withCta) {
    const { beats } = loadTemplate(tid);
    const sc = sampleScript(beats);
    const args = (brand) => ({ brief: { format: beats.formats[0] }, brand, script: sc, timing: estimateTiming(sc, TIMING, 'en', beats.pace), size: sizeFor(beats, beats.formats[0]) });
    const { build: b } = await mod(tid);
    const bug = b(args(STD_AWARD));
    assert.ok(bug.includes('id="lbug"'), `${tid}: corner logo drawn`);
    assert.ok(!bug.includes('class="clogo"') && !bug.includes('class="bug-img"'), `${tid}: no second logo`);
    assert.ok(b(args({ ...STD_AWARD, logoBug: false })).includes('class="clogo"'), `${tid}: the cta logo stays without the corner logo`);
  }
});

test('before-after: an arrow only for a change, pointing the way of its sign; the split title clears the corner logo', async () => {
  const stat = (o) => S('s', 'stat', { value: 88, unit: '%', text: 'less image transfer', ...o });
  for (const brand of [STD_AWARD, AWARD]) {
    const none = await render('before-after', [stat({})], brand);
    assert.ok(!none.includes('class="arrow'), '"88% less" without a change has no arrow');
    assert.ok((await render('before-after', [stat({ change: -88 })], brand)).includes('<svg class="arrow dn"'));
    assert.ok((await render('before-after', [stat({ change: 40 })], brand)).includes('<svg class="arrow up"'));
    assert.ok(!(await render('before-after', [stat({ change: 0 })], brand)).includes('class="arrow'));
  }
  const split = [S('sp', 'split', { title: 'What changes', before: { items: ['a'] }, after: { items: ['b'] } })];
  assert.ok((await render('before-after', split, STD_AWARD)).includes('.stitle{position:absolute;left:90px;right:90px;top:140px;'));
  assert.ok((await render('before-after', split, STD_AWARD)).includes('.split{position:absolute;left:70px;right:70px;top:246px;'));
  assert.ok((await render('before-after', split, { ...STD_AWARD, logoBug: false })).includes('.stitle{position:absolute;left:90px;right:90px;top:64px;'));
});

// Opens cinematic pages with every new layout in Chrome and lints each scene at its still time (scenes scale to 1.03 by then).
test('cinematic layouts, themes and flash stay inside the safe area in landscape and portrait', { timeout: 240000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cine-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  for (const f of ['logo.svg', 'logo-dark.svg']) fs.writeFileSync(path.join(dir, 'assets', f), '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="46"><rect width="200" height="46"/></svg>');
  const brand = { ...AWARD, fonts: { display: 'Arial', body: 'Arial' } };
  const pages = {
    explainer: [S('open', 'title', { title: 'Two years, one team', theme: 'accent' }), S('a', 'step', { title: 'We plan the roadmap together', icon: 'chat', text: 'Every quarter the client and the team agree the next three releases.', theme: 'dark' }),
      S('d', 'diagram', { title: 'Five gates', nodes: ['Request', 'Estimate', 'Approve', 'Build', 'Deliver'], text: 'Every change follows the same gates.' }), { ...FLASH, theme: 'dark' },
      // More beats than words: the beats bunch up at their minimum spacing, where an entrance used to outlive its slot.
      { ...FLASH, id: 'dense', vo: 'Nine things, all at once.' }],
    'data-story': [S('s', 'stat', { kicker: 'Mobile orders', value: 16, unit: '%', change: 16, text: 'Jan-Sep 2026 against 2025. Mobile is now 53% of all orders.' }),
      S('b', 'bars', { title: '5 weeks delivered against 6 committed', unit: 'weeks', items: [{ label: 'Committed', value: 6 }, { label: 'Delivered', value: 5 }], theme: 'dark' }),
      S('l', 'line', { title: 'Conversion by quarter', points: [38, 41, 57, 52, 61], labels: ['Q1 25', 'Q1 26'], format: 'pct', band: { from: 2, to: 2, label: 'Q3 launch' }, ref: { value: 50, label: '50% target' }, text: 'Conversion passed the target after the Q3 launch.', theme: 'accent' })],
    'before-after': [S('sp', 'split', { title: 'What changes', before: { title: 'The old way', items: ['Slow releases', 'Manual tests'] }, after: { title: 'With us', items: ['Every two weeks', 'Automated tests'] } }), S('s', 'stat', { value: 88, unit: '%', change: -88, text: 'less image transfer', theme: 'dark' })],
    'code-story': [S('c', 'checklist', { title: 'In this release', items: ['Retries on upload', 'Clearer errors', 'Offline mode', 'Faster start-up'], text: 'Release 2.4, out today.' })],
  };
  for (const [tid, scenes] of Object.entries(pages)) {
    for (const format of tid === 'explainer' ? ['16:9', '9:16', '1:1'] : ['16:9', '9:16']) {
      const { beats } = loadTemplate(tid);
      const size = sizeFor(beats, format);
      const file = path.join(dir, `${tid}-${format.replace(':', 'x')}.html`);
      fs.writeFileSync(file, await render(tid, scenes, brand, format));
      let opened;
      try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
      const { browser, page: pg, info } = opened;
      try {
        for (const st of info.stills) {
          await pg.evaluate((at) => window.seek(at), st.t);
          assert.deepEqual(await pg.evaluate(lintInPage, cfg.lint.safeArea), [], `${tid} ${format} ${st.id}`);
        }
        // Played forward frame by frame, at most one scene shows at any moment: cuts never stack two scenes' text.
        const stacked = await pg.evaluate(() => {
          const bad = [];
          for (let t = 0; t < window.__studio.duration; t += 1 / 30) {
            window.seek(t);
            const on = [...document.querySelectorAll('#stage > .sc, #stage > .tpl > .sc')].filter((g) => getComputedStyle(g).visibility !== 'hidden' && +getComputedStyle(g).opacity > 0.05);
            if (on.length > 1) bad.push(`${t.toFixed(2)} ${on.map((g) => g.id).join('+')}`);
            const subs = [...document.querySelectorAll('.subt')].filter((el) => +getComputedStyle(el).opacity > 0.05);
            if (subs.length > 1) bad.push(`${t.toFixed(2)} captions ${subs.map((el) => el.id).join('+')}`);
          }
          return bad;
        });
        assert.deepEqual(stacked, [], `${tid} ${format}: one scene at a time`);
        // Jumping back from the end, only the word being said carries the marker (GSAP could not revert a missing class).
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
        // Lint skips boxes that may overflow visibly; a diagram node's label must still fit its box.
        const spill = await pg.evaluate(() => [...document.querySelectorAll('.node')].filter((el) => el.scrollWidth > el.clientWidth + 2).map((el) => el.id));
        assert.deepEqual(spill, [], `${tid} ${format}: node labels fit`);
        // Through the flash: never two items at once, and every item gets its moment.
        if (tid === 'explainer') {
          // Played forward frame by frame, the way the preview and the render step through it.
          for (const fid of ['work', 'dense']) {
            const seen = await pg.evaluate((id) => {
              const sc = window.__studio.scenes.find((x) => x.id === id), out = [];
              for (let t = sc.start; t < sc.end; t += 1 / 30) { window.seek(t); out.push([...document.querySelectorAll(`#g-${id} .fl`)].filter((el) => +getComputedStyle(el).opacity > 0.05).map((el) => el.id)); }
              return out;
            }, fid);
            assert.ok(seen.every((ids) => ids.length <= 1), `${format} ${fid}: one flash item at a time`);
            assert.equal(new Set(seen.flat()).size, 9, `${format} ${fid}: all nine items show`);
          }
        }
      } finally {
        await browser.close();
      }
    }
  }
});

test('brand.carry is kept only on a profile with a carrier, and a page without it has no carrier code', async () => {
  assert.equal(validateBrand({ ...BRAND, motion: 'cinematic', carry: true }).carry, true);
  assert.equal(validateBrand({ ...BRAND, motion: 'clean', carry: true }).carry, true);
  for (const motion of ['standard', 'editorial', 'kinetic', 'parallax']) assert.equal('carry' in validateBrand({ ...BRAND, motion, carry: true }), false, motion);
  assert.equal('carry' in validateBrand({ ...BRAND, motion: 'cinematic', carry: false }), false);
  assert.throws(() => validateBrand({ ...BRAND, carry: 'yes' }), /carry must be true or false/);
  const off = page({ ...BRAND, motion: 'cinematic' });
  assert.ok(!off.includes('carrier') && !off.includes('carryCuts'));
  const on = page({ ...BRAND, motion: 'cinematic', carry: true });
  assert.ok(on.includes('<div id="carrier"') && on.includes('carryCuts();'));
  assert.ok(!page({ ...BRAND, carry: true }).includes('carrier'), 'a standard page ignores carry');
});

test('the carrier rests under each anchor, moves only over the cut and takes the ink on an accent scene', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-carry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const brand = { ...BRAND, motion: 'cinematic', carry: true, fonts: { display: 'Arial', body: 'Arial' } };
  const stat = (id, o) => S(id, 'stat', { kicker: 'Online revenue', value: 9.7, format: 'pct', text: 'growth', ...o });
  const scenes = [stat('a'), S('b', 'bars', { title: 'Delivered against committed', items: [{ label: 'A', value: 2 }, { label: 'B', value: 1 }] }), stat('c', { theme: 'accent' }), stat('d')];
  const file = path.join(dir, 'carry.html');
  fs.writeFileSync(file, await render('data-story', scenes, brand));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(loadTemplate('data-story').beats, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const r = await opened.page.evaluate(() => {
      const C = document.getElementById('carrier');
      const at = (x) => { window.seek(x); const b = C.getBoundingClientRect(), cs = getComputedStyle(C); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), op: Math.round(+cs.opacity * 100) / 100, bg: cs.backgroundColor }; };
      return window.__studio.scenes.map((sc) => ({ id: sc.id, mid: at((sc.start + sc.end) / 2), late: at(sc.end - 0.3), start: at(sc.start), early: at(sc.start + 0.4) }));
    });
    const [a, b, c, d] = r;
    assert.equal(a.mid.op, 1, 'shown on the first scene');
    for (const s of [b, c, d]) {
      assert.deepEqual([s.early.x, s.early.y, s.early.w], [s.mid.x, s.mid.y, s.mid.w], `${s.id}: settled on its anchor once the cut is over`);
      const prev = r[r.indexOf(s) - 1];
      assert.deepEqual([prev.late.x, prev.late.y], [prev.mid.x, prev.mid.y], `${prev.id}: still before the cut`);
    }
    assert.ok(b.mid.y > a.mid.y, 'the bars title sits lower than the stat kicker');
    assert.ok(b.start.y > a.mid.y && b.start.y < b.mid.y, `on its way at the cut: ${JSON.stringify(r)}`);
    assert.notEqual(c.mid.bg, a.mid.bg, 'ink on the accent scene');
    assert.equal(d.mid.bg, a.mid.bg);
  } finally {
    await opened.browser.close();
  }
});

// Measuring anchors by seeking the timeline during build() once left the step icon showing in every scene.
test('with the carrier hidden, a carry page shows the same pixels as the page without it', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-carry-same-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const brand = { ...BRAND, motion: 'cinematic', fonts: { display: 'Arial', body: 'Arial' } };
  const scenes = [S('open', 'title', { title: 'A roadmap', kicker: 'Roadmap' }), S('a', 'step', { title: 'Plan', icon: 'chat' }), S('b', 'step', { title: 'Build', icon: 'rocket', theme: 'dark' }), S('c', 'title', { title: 'Done', kicker: 'Live' })];
  const shots = {};
  for (const [name, b] of [['plain', brand], ['carry', { ...brand, carry: true }]]) {
    const file = path.join(dir, `${name}.html`);
    fs.writeFileSync(file, await render('explainer', scenes, b));
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(loadTemplate('explainer').beats, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
    try {
      await opened.page.addStyleTag({ content: '#carrier{display:none!important}' });
      const times = await opened.page.evaluate(() => window.__studio.scenes.flatMap((sc) => [sc.start + 0.05, (sc.start + sc.end) / 2, sc.end - 0.05]));
      shots[name] = [];
      for (const [i, x] of times.entries()) {
        await opened.page.evaluate((v) => window.seek(v), x);
        const png = path.join(dir, `${name}-${i}.png`);
        await opened.page.screenshot({ path: png, type: 'png' });
        shots[name].push(png);
      }
    } finally {
      await opened.browser.close();
    }
  }
  assert.equal(shots.carry.length, shots.plain.length);
  // Two loads of one page differ by a level or so where Chrome rasterises a blur; a scene drawn wrong differs by far more.
  for (const [i, p] of shots.plain.entries()) {
    const log = await ffmpegReport(['-i', p, '-i', shots.carry[i], '-lavfi', '[0][1]blend=all_mode=difference,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YMAX', '-f', 'null', '-'], { timeoutMs: 30000 });
    const max = +/YMAX=(\d+)/.exec(log)[1];
    assert.ok(max <= 2, `frame ${i} differs by up to ${max} levels once the carrier is hidden`);
  }
});

// A blur cut between two colours used to swap the whole frame in one frame (yellow to dark, dark to white).
test('a cinematic cut between two colours turns through a veil in the new colour; like scenes and the diagram highlight move smoothly', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-veil-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const brand = { ...BRAND, motion: 'cinematic', fonts: { display: 'Arial', body: 'Arial' } };
  const stat = (id, theme) => S(id, 'stat', { value: 9.7, format: 'pct', text: 'growth', ...(theme ? { theme } : {}) });
  const pages = {
    'data-story': [stat('a'), stat('b'), stat('c', 'accent'), S('d', 'bars', { title: 'T', items: [{ label: 'A', value: 2 }, { label: 'B', value: 1 }], theme: 'dark' }), stat('e')],
    explainer: [S('open', 'title', { title: 'Hi' }), S('d', 'diagram', { title: 'Flow', nodes: ['One', 'Two', 'Three'] })],
  };
  const opened = {};
  for (const [tid, scenes] of Object.entries(pages)) {
    const file = path.join(dir, `${tid}.html`);
    fs.writeFileSync(file, await render(tid, scenes, brand));
    try { opened[tid] = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(loadTemplate(tid).beats, '16:9') }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
  }
  try {
    const cuts = await opened['data-story'].page.evaluate(() => window.__studio.scenes.slice(1).map((sc) => {
      const at = (x) => { window.seek(x); const v = getComputedStyle(document.getElementById('cutveil')); return { op: Math.round(+v.opacity * 100) / 100, bg: v.backgroundColor }; };
      const before = at(sc.start - 0.3), cut = at(sc.start), after = at(sc.start + 0.4);
      return { id: sc.id, before: before.op, cut: cut.op, after: after.op, bg: cut.bg, own: getComputedStyle(document.getElementById('g-' + sc.id)).backgroundColor };
    }));
    const byId = Object.fromEntries(cuts.map((c) => [c.id, c]));
    assert.equal(byId.b.cut, 0, 'two light scenes: no veil');
    for (const id of ['c', 'd', 'e']) {
      const c = byId[id];
      assert.equal(c.cut, 1, `${id}: the frame is covered at the cut`);
      assert.ok(c.before === 0 && c.after === 0, `${id}: the veil is gone either side of the cut`);
    }
    assert.equal(byId.c.bg, byId.c.own, 'into the accent scene the veil takes its colour');
    assert.equal(byId.d.bg, byId.d.own, 'into the dark scene the veil takes its colour');
    assert.equal(byId.e.bg, await opened['data-story'].page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'into a transparent scene the veil takes the page colour');
    // Frame by frame through the diagram, the second node's fill passes through in-between colours.
    const fills = await opened.explainer.page.evaluate(() => {
      const sc = window.__studio.scenes.find((x) => x.id === 'd'), out = new Set();
      for (let x = sc.start; x < sc.end; x += 1 / 30) { window.seek(x); out.add(getComputedStyle(document.getElementById('d-n1')).backgroundColor); }
      return [...out];
    });
    assert.ok(fills.length > 4, `the highlight tweens: ${fills.join(' | ')}`);
  } finally {
    for (const o of Object.values(opened)) await o.browser.close();
  }
});

// NSC a2, 2026-10-26: on a ui-story page (a template with its own subtitle style) the cinematic line captions stayed
// pale grey with no box, and the spoken word never lit. The film's caption look now wins in line-caption mode.
test('cinematic line captions keep the dark box and lit words on a template with its own subtitle style', async () => {
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const { beats } = loadTemplate('ui-story');
  const sc = sampleScript(beats);
  const timing = estimateTiming(sc, HASH_TIMING, 'en', beats.pace || null);
  const { build: b } = await mod('ui-story');
  const page = (brand) => b({ brief: { format: '16:9' }, brand, script: sc, timing, size: sizeFor(beats, '16:9') });
  const cine = page(HASH_BRAND);
  assert.ok(cine.includes('.sw,.subdark .sw{font-size:40px;font-weight:700;color:rgba(255,255,255,.7);background:rgba(15,23,42,.72)}'), 'the dark caption box');
  assert.ok(cine.includes('.sw span.hl{color:var(--secondary)}'), 'the spoken word lights');
  const std = page({ ...HASH_BRAND, motion: undefined });
  assert.ok(!std.includes('.sw span.hl') && !std.includes('.sw,.subdark .sw{'), 'standard pages keep the template subtitle style');
});
