import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { stripMarks, markErrors, marksToHtml, MARK_CHARS } from '../engine/marks.mjs';
import { validateScript } from '../engine/script.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { readTemplate } from '../engine/templates.mjs';

test('stripMarks reads a mark as its words and leaves other brackets alone', () => {
  assert.equal(stripMarks('Cut costs by [[circle:40%]]'), 'Cut costs by 40%');
  assert.equal(stripMarks('[[strike:old way]] → [[mark:one team]]'), 'old way → one team');
  assert.equal(stripMarks('arr[[1, 2]]'), 'arr[[1, 2]]');
});

test('markErrors names a bad style, an empty or long mark, too many and unmatched brackets', () => {
  assert.deepEqual(markErrors('Cut [[circle:40%]] and [[underline:faster]]', 'title'), []);
  assert.match(markErrors('[[box:40%]]', 'title')[0], /is not a mark/);
  assert.match(markErrors('[[mark: x]]', 'title')[0], /no space at either end/);
  assert.match(markErrors(`[[circle:${'x'.repeat(MARK_CHARS.circle + 1)}]]`, 'title')[0], new RegExp(`at most ${MARK_CHARS.circle} characters`));
  assert.match(markErrors('[[mark:a]] [[mark:b]] [[mark:c]]', 'text').join(), /at most 2 marks/);
  assert.match(markErrors('[[mark:a', 'text').join(), /unmatched/);
});

test('marksToHtml draws marks in text and keeps an attribute plain', () => {
  const { html, count } = marksToHtml('<div class="hd" data-text="[[mark:x]]">Save [[circle:40%]] now, [[mark:one team]]</div>');
  assert.equal(count, 2);
  assert.match(html, /data-text="x"/);
  assert.match(html, /<span class="mk mk-circle"><span class="mkt">40%<\/span><svg class="mks" aria-hidden="true"><path d="M/);
  assert.match(html, /<span class="mk mk-mark">one team<\/span>/);
  assert.equal(marksToHtml('<code>a[[1]]</code>').count, 0);
});

const explainer = () => readTemplate('explainer');
const scenes = (title, extra = {}) => ({
  scenes: [
    { id: 'title', kind: 'title', vo: 'How the team saves forty percent.', title, source: 'bullets[0]' },
    { id: 'step-1', kind: 'step', vo: 'Plan the work.', title: 'Plan', icon: 'chat', source: 'bullets[0]', ...extra },
    { id: 'cta', kind: 'cta', vo: 'Start today.', title: 'Start today', button: 'Get started' },
  ],
});

test('a script may mark the on-screen text of a template that draws marks', () => {
  const b = explainer();
  assert.equal(b.marks, true);
  assert.deepEqual(validateScript(scenes('Save [[circle:40%]] with [[underline:one team]]'), b).errors, []);
  // The limit counts what reads on screen: 44 characters of text plus the brackets is fine.
  assert.deepEqual(validateScript(scenes(`[[mark:${'x'.repeat(40)}]] abc`), b).errors, []);
  assert.match(validateScript(scenes(`[[mark:${'x'.repeat(40)}]] abcde`), b).errors.join(), /title is 46 chars, limit 44/);
});

test('a mark is refused in a voice line, a button, nested data and a template without marks', () => {
  const b = explainer();
  const s = scenes('Plain');
  s.scenes[0].vo = 'We save [[circle:40%]].';
  s.scenes[2].button = '[[mark:Go]]';
  assert.match(validateScript(s, b).errors.join('\n'), /title: vo cannot hold a mark/);
  assert.match(validateScript(s, b).errors.join('\n'), /cta: button cannot hold a mark/);
  const d = { scenes: [scenes('x').scenes[0], { id: 'flow', kind: 'diagram', vo: 'It flows.', title: 'Flow', nodes: ['A', '[[circle:B]]'], source: 'bullets[0]' }] };
  assert.match(validateScript(d, b).errors.join(), /nodes\.1 cannot hold a mark/);
  // Every template draws marks now; a copy of one with marks off stands in for a template without them.
  const pd = { ...readTemplate('product-demo'), marks: false };
  const field = Object.entries(pd.fields).find(([, f]) => f.required.includes('title'));
  const one = { scenes: [{ id: 'a', kind: field[0], title: 'Save [[circle:40%]]' }] };
  assert.match(validateScript(one, pd).errors.join(), /does not draw marks/);
});

test('brand.shine is a yes/no and pill and pop are subtitle presets', () => {
  const base = {
    name: 'T', colors: { primary: '#112233', primary2: '#223344', secondary: '#ffcc00', bg: '#f5f5f5', ink: '#111111', muted: '#666666', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' }, voice: {}, music: {}, sources: { allowedHosts: ['example.com'] },
  };
  assert.equal(validateBrand({ ...base, shine: true }).shine, true);
  assert.equal('shine' in validateBrand({ ...base, shine: false }), false);
  assert.throws(() => validateBrand({ ...base, shine: 'yes' }), /shine must be true or false/);
  for (const style of ['pill', 'pop']) assert.equal(validateBrand({ ...base, subtitles: { style } }).subtitles.style, style);
});

// A field split into one span a word: a mark of two words stays whole, so it is drawn, never shown as "[[underline:big".
test('a multi-word mark in a word-by-word heading becomes one mark', async () => {
  const { loadTemplate } = await import('../engine/jobs.mjs');
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const { estimateTiming } = await import('../engine/timing.mjs');
  const { sizeFor } = await import('../engine/pipeline.mjs');
  const brand = { name: 'B', logoText: 'B', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };
  for (const [id, kind, field] of [['testimonial', 'quote', 'quote'], ['promo', 'hook', 'title'], ['lifestyle', 'photo', 'title'], ['talking-head', 'card', 'title']]) {
    const { beats } = loadTemplate(id);
    const script = sampleScript(beats);
    const sc = script.scenes.find((s) => s.kind === kind);
    assert.ok(sc, `${id} has a ${kind} sample scene`);
    sc[field] = 'A [[underline:big win]] today';
    const timing = estimateTiming(script, { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 }, 'en', beats.pace || null);
    const { build } = await import(`../templates/${id}/template.mjs`);
    const html = build({ brief: { format: beats.formats[0] }, brand, script, timing, size: sizeFor(beats, beats.formats[0]), icons: {} });
    assert.ok(!html.includes('[[underline'), `${id}: no raw mark left`);
    assert.match(html, /class="mk mk-underline"><span class="mkt">big win<\/span>/, `${id}: one mark over both words`);
  }
});

// Real Chrome: a template's own ".mk" class (before-after's ticks) once made the kit's marks code throw in build().
test('before-after with a mark and a split scene builds and becomes ready', { timeout: 120000 }, async (t) => {
  const { hasChrome, chromeFolder } = await import('./helpers/chrome-folder.mjs');
  const channel = loadStudioConfig().engine.chromeChannel;
  if (!(await hasChrome(channel))) { t.skip('Chrome is not available'); return; }
  const { loadTemplate } = await import('../engine/jobs.mjs');
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const { estimateTiming } = await import('../engine/timing.mjs');
  const { sizeFor } = await import('../engine/pipeline.mjs');
  const { openComposition } = await import('../engine/media.mjs');
  const { build } = await import('../templates/before-after/template.mjs');
  const { beats } = loadTemplate('before-after');
  const script = sampleScript(beats);
  script.scenes[0].title = 'Before and [[mark:after]]';
  const timing = estimateTiming(script, { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 }, 'en', beats.pace || null);
  const size = sizeFor(beats, '16:9');
  const brand = { name: 'B', logoText: 'B', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };
  const folder = await chromeFolder(t, 'ms-bamarks-');
  const file = folder.write('index.html', build({ brief: { format: '16:9' }, brand, script, timing, size, icons: {} }));
  const { browser } = await openComposition(file, { channel, ...size });
  await browser.close();
});

// Real Chrome: prepare plays every frame (no lint, played = jumped), marks are scaled to their text and drawn by the
// end of the scene, the button carries a shine and each subtitle preset builds.
for (const style of ['pill', 'pop']) {
  test(`marks, shine and ${style} subtitles prepare clean and draw`, { timeout: 300000 }, async (t) => {
    const { chromium } = await import('playwright-core');
    const channel = loadStudioConfig().engine.chromeChannel;
    try { await (await chromium.launch({ channel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
    const { createProject, validateBrief, saveBrief, setStatus, jobFile } = await import('../engine/jobs.mjs');
    const { prepare } = await import('../engine/pipeline.mjs');
    const { openComposition } = await import('../engine/media.mjs');
    const P = `zz-test-marks-${style}`, ID = 'ex-16x9';
    t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
    createProject({ id: P, name: 'Marks Test' });
    const brandFile = path.join(DIRS.profiles, P, 'brand.json');
    writeJson(brandFile, { ...readJson(brandFile), shine: true, subtitles: { style }, voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
    saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 15, message: 'm' }));
    writeJson(jobFile(P, ID, 'source.json'), { name: 'Marks', url: '', bullets: [{ text: 'Teams save 40% with one plan.' }] });
    const s = scenes('Save [[circle:40%]] with [[underline:one plan]]', { text: 'No more [[strike:spreadsheets]], just [[mark:one plan]].' });
    writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', ...s });
    setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
    const st = await prepare(P, ID, 'test');
    assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
    const { browser, page, info } = await openComposition(jobFile(P, ID, 'index.html'), { channel, width: 1920, height: 1080 });
    try {
      const sc = (id) => info.scenes.find((x) => x.id === id);
      // The share of a path DrawSVG shows: its first dash over the path length (no dash array = all of it).
      await page.evaluate(() => { window.drawn = (p) => { const a = getComputedStyle(p).strokeDasharray; return a === 'none' ? 1 : parseFloat(a) / p.getTotalLength(); }; });
      await page.evaluate((x) => window.seek(x), sc('title').end - 0.05);
      const title = await page.evaluate(() => [...document.querySelectorAll('#g-title .mk')].map((m) => {
        const p = m.querySelector('path');
        return { cls: m.className, d: p?.getAttribute('d') || '', vb: m.querySelector('svg')?.getAttribute('viewBox') || '', drawn: p ? drawn(p) : 1 };
      }));
      assert.equal(title.length, 2);
      for (const m of title) {
        assert.ok(!/\.\d\d /.test(m.d) && /^M\d/.test(m.d), `scaled path: ${m.d.slice(0, 40)}`);
        assert.match(m.vb, /^0 0 \d/);
        assert.ok(m.drawn > 0.98, `drawn by the scene end: ${m.drawn}`);
      }
      await page.evaluate((x) => window.seek(x), sc('title').start + 0.05);
      const early = await page.evaluate(() => drawn(document.querySelector('#g-title .mk-circle path')));
      assert.ok(early < 0.02, `not drawn at the scene start: ${early}`);
      await page.evaluate((x) => window.seek(x), sc('step-1').end - 0.05);
      assert.equal(await page.evaluate(() => document.querySelector('#g-step-1 .mk-mark').style.backgroundSize), '100% 86%');
      assert.equal(await page.evaluate(() => document.querySelector('#g-step-1 .mk-mark').className), 'mk mk-mark on');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.btn .shw .shn').length), 1);
      if (style === 'pill') assert.ok(await page.evaluate(() => document.querySelectorAll('.sw .pl').length > 0));
    } finally {
      await browser.close();
    }
  });
}
