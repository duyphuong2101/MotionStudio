import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { openComposition, lintInPage } from '../engine/media.mjs';
import { build, parts, raceFrames, stripeColor, chartColors } from '../templates/data-story/template.mjs';

const beats = loadTemplate('data-story').beats;
const race = {
  id: 'race', kind: 'race', vo: 'From 2005 to 2020, gas overtook coal and nuclear, and wind climbed past hydro on the way up the ranking.',
  title: 'Power by source', periods: ['2005', '2010', '2015', '2020'], top: 4, source: 'bullets[0]',
  series: [
    { label: 'Coal', values: [2013, 1847, 1352, 774] },
    { label: 'Gas', values: [761, 988, 1335, 1624] },
    { label: 'Nuclear', values: [782, 807, 797, 790] },
    { label: 'Wind', values: [18, 95, 191, 338] },
    { label: 'Hydro', values: [270, 260, 249, 291] },
  ],
};
const stripes = {
  id: 'stripes', kind: 'stripes', vo: 'Each stripe is one year, blue when cooler than the average and red when warmer, and the last years are the warmest of all.',
  title: 'One stripe per year', labels: ['2000', '2024'], finish: 'bars', source: 'bullets[1]',
  values: [0.4, 0.5, 0.6, 0.5, 0.6, 0.7, 0.6, 0.6, 0.7, 0.6, 0.7, 0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 0.9, 0.8, 1.0, 1.0, 0.9, 0.9, 1.2, 1.3],
};
const script = { lang: 'en', scenes: [{ id: 'title', kind: 'title', vo: 'Twenty years of power.', title: 'Power, 2005-2020' }, race, stripes, { id: 'cta', kind: 'cta', vo: 'Read the full data.', title: 'Read more', button: 'Open' }] };

test('race and stripes scenes pass the data-story rules; malformed data is named', () => {
  assert.deepEqual(validateScript(script, beats).errors, []);
  const bad = (patch) => validateScript({ ...script, scenes: [script.scenes[0], { ...race, ...patch }] }, beats).errors.join(' | ');
  assert.match(bad({ periods: ['2005'] }), /periods must list 2-12/);
  assert.match(bad({ series: [{ label: 'Coal', values: [1, 2, 3] }, race.series[1]] }), /3 values for 4 periods/);
  assert.match(bad({ series: [{ label: 'Coal', values: [1, -2, 3, 4] }, race.series[1]] }), /cannot be negative/);
  assert.match(bad({ series: [{ values: [1, 2, 3, 4] }, race.series[1]] }), /label is required/);
  assert.match(bad({ top: 12 }), /top must be a whole number 3-8/);
  const badStripes = (patch) => validateScript({ ...script, scenes: [script.scenes[0], { ...stripes, ...patch }] }, beats).errors.join(' | ');
  assert.match(badStripes({ values: [1, 2] }), /values must be 5-200 numbers/);
  assert.match(badStripes({ values: [1, 1, 1, 1, 1] }), /all the same/);
  assert.match(badStripes({ labels: ['2000'] }), /first and last period/);
  assert.match(badStripes({ finish: 'zigzag' }), /finish must be stripes\|bars/);
});

test('race frames rank each period and scale to its longest bar; stripe colors run cool to warm', () => {
  const f = raceFrames(race.periods, race.series);
  assert.deepEqual(f[0].rank, [0, 2, 1, 4, 3], '2005: coal, nuclear, gas, hydro, wind');
  assert.deepEqual(f[3].rank, [2, 0, 1, 3, 4], '2020: gas, nuclear, coal, wind, hydro');
  assert.equal(f[3].frac[1], 1);
  assert.ok(Math.abs(f[3].frac[0] - 774 / 1624) < 1e-9);
  assert.equal(stripeColor(0), 'rgb(247,247,247)');
  assert.equal(stripeColor(-1), 'rgb(8,81,156)');
  assert.equal(stripeColor(1), 'rgb(165,15,21)');
});

test('chart colours come from the brand custom colours named chart-*; without them the defaults stay', () => {
  const brand = { palette: [{ name: 'chart-1', hex: '#4682ff' }, { name: 'chart-2', hex: '#ffd400' }, { name: 'chart-cool', hex: '#235fc8' }, { name: 'chart-warm', hex: '#ffd400' }, { name: 'chart-mark', hex: '#ffd400' }, { name: 'chart-3', hex: 'red' }] };
  const c = chartColors(brand);
  assert.deepEqual(c.series, ['#4682ff', '#ffd400']);
  assert.equal(c.line, '#4682ff');
  assert.equal(c.mark, '#ffd400');
  assert.equal(stripeColor(-1, c.cool, c.warm), 'rgb(35,95,200)');
  assert.equal(stripeColor(1, c.cool, c.warm), 'rgb(255,212,0)');
  const sc = { lang: 'en', scenes: [
    { id: 'b', kind: 'bars', title: 'T', items: [{ label: 'A', value: 3 }, { label: 'B', value: 2 }] },
    { id: 'l', kind: 'line', title: 'T', points: [1, 2, 3] },
    { id: 's', kind: 'stat', value: 9.7, format: 'pct', text: 'x' },
  ] };
  const out = parts({ brand, script: sc, size: { width: 1920, height: 1080 } });
  assert.match(out.body, /id="b-b0" style="background:#4682ff"/);
  assert.match(out.body, /id="b-b1" style="background:#ffd400"/);
  assert.match(out.body, /<linearGradient id="l-grad"[^]*stop-color="#4682ff"/);
  assert.ok(out.css.includes('.ln{fill:none;stroke:#4682ff'));
  assert.match(out.css, /\.big\{color:var\(--ink\);[^}]*#ffd400 58%/);
  assert.match(out.js, /backgroundSize: '100% 100%'/);
  const plain = parts({ brand: {}, script: sc, size: { width: 1920, height: 1080 } });
  assert.ok(plain.body.includes('id="b-b0" style="background:var(--primary2)"'));
  assert.doesNotMatch(plain.css + plain.body + plain.js, /linear-gradient\(transparent|linearGradient|backgroundSize/);
});

test('a bars unit sits after each value; without a unit the markup is unchanged', () => {
  const bars = (unit) => ({ lang: 'en', scenes: [{ id: 'b', kind: 'bars', title: 'T', ...(unit ? { unit } : {}), items: [{ label: 'A', value: 57 }, { label: 'B', value: 10 }] }] });
  const withUnit = parts({ brand: {}, script: bars('min <x>'), size: { width: 1920, height: 1080 } }).body;
  assert.match(withUnit, /<span><b id="b-bv0"[^>]*>0<\/b><small[^>]*>min &lt;x&gt;<\/small><\/span>/);
  assert.equal((withUnit.match(/<small/g) || []).length, 2);
  const plain = parts({ brand: {}, script: bars(), size: { width: 1920, height: 1080 } }).body;
  assert.match(plain, /<span data-lint>A<\/span><b id="b-bv0"/);
  assert.doesNotMatch(plain, /<small/);
});

// NSC award film, 2026-10-26: the "%" after a green PEX value stayed black.
test('a toned bars value colours its unit too; without a tone the unit markup is unchanged', () => {
  const toned = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ unit: '%', format: 'dec' })] }, size: { width: 1920, height: 1080 } }).body;
  assert.match(toned, /<span class="tup"><b id="pex-bv0" class="tup" data-count="295"[^>]*>0<\/b><small[^>]*>%<\/small><\/span>/);
  const plain = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ unit: '%', format: 'dec', tone: undefined })] }, size: { width: 1920, height: 1080 } }).body;
  assert.match(plain, /<span><b id="pex-bv0" data-count="295"[^>]*>0<\/b><small[^>]*>%<\/small><\/span>/);
});

const pex = (o) => ({ id: 'pex', kind: 'bars', vo: 'Both indices lead with My Account.', title: 'Commercial and Delivery PEX', format: 'pct', series: ['Commercial PEX', 'Delivery PEX'], tone: 'up', source: 'bullets[0]',
  items: [{ label: 'My Account', value: 295, value2: 210.5 }, { label: 'Klaviyo', value: 196.1, value2: 123.7 }, { label: 'AMAD, to end of August', value: 164.7, value2: 108.6 }], ...o });

test('bars may show two series side by side and any chart may tone its numbers; malformed ones are named', () => {
  const one = (sc) => validateScript({ lang: 'en', scenes: [sc] }, beats).errors.join(' | ');
  assert.equal(one(pex()), '');
  assert.equal(one({ id: 's', kind: 'stat', vo: 'Up nine point seven percent.', value: 9.7, format: 'pct', text: 'Jan-Sep, year over year', tone: 'up', source: 'bullets[0]' }), '');
  assert.match(one(pex({ series: ['Only one'] })), /series must name the two values/);
  assert.match(one(pex({ series: ['A', 'x'.repeat(25)] })), /at most 24 characters/);
  assert.match(one(pex({ items: [{ label: 'My Account', value: 295 }] })), /every item needs value2/);
  assert.match(one(pex({ tone: 'green' })), /tone/);
});

test('two series draw a pair of bars per item under a legend; without series the markup is unchanged', () => {
  const body = parts({ brand: {}, script: { lang: 'en', scenes: [pex()] }, size: { width: 1920, height: 1080 } }).body;
  assert.equal((body.match(/class="bp"/g) || []).length, 6, 'two bars for each of three items');
  assert.match(body, /<div class="sleg"><span data-lint><i [^>]*><\/i>Commercial PEX<\/span><span data-lint><i [^>]*><\/i>Delivery PEX<\/span><\/div>/);
  assert.match(body, /id="pex-bv0" class="tup" data-count="295"/);
  assert.match(body, /id="pex-bv0x" class="tup" data-count="210.5"/);
  assert.match(body, /id="pex-b0" style="background:([^"]+)" data-frac="1"[\s\S]*id="pex-b0x" style="background:([^"]+)" data-frac="0.713/);
  const plain = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ series: undefined, tone: undefined })] }, size: { width: 1920, height: 1080 } });
  assert.doesNotMatch(plain.body, /class="bp"|class="sleg"|tup/);
  assert.doesNotMatch(plain.css, /\.tup|\.sleg|\.bp\{/, 'no css for what the page does not use');
});

test('bars may stand as columns: value above, label below, both series side by side; without layout the page is unchanged', () => {
  const one = (sc) => validateScript({ lang: 'en', scenes: [sc] }, beats).errors.join(' | ');
  assert.equal(one(pex({ layout: 'columns' })), '');
  assert.match(one(pex({ layout: 'sideways' })), /layout/);
  const out = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ layout: 'columns' })] }, size: { width: 1920, height: 1080 } });
  assert.match(out.body, /<div class="bars cols">/);
  assert.equal((out.body.match(/class="col"/g) || []).length, 3, 'one column group per item');
  assert.equal((out.body.match(/class="cp"/g) || []).length, 6, 'two columns per item');
  assert.match(out.body, /<div class="cp"><b id="pex-bv0" class="tup" data-count="295"[^>]*>0<\/b><div class="ct"><i id="pex-b0" style="background:[^"]+" data-frac="1"><\/i><\/div><\/div>/);
  assert.match(out.body, /<div class="cl" data-lint>AMAD, to end of August<\/div>/);
  assert.ok(out.css.includes('.bars.cols{flex-direction:row') && out.js.includes("{ height: '0%' }"));
  const rows = parts({ brand: {}, script: { lang: 'en', scenes: [pex()] }, size: { width: 1920, height: 1080 } });
  assert.doesNotMatch(rows.body + rows.css + rows.js, /cols|class="cp"|height: '0%'/, 'no column code for a page without columns');
});

test('columns may carry one dashed reference line at a value, labelled once; rows refuse it and pages without it are unchanged', () => {
  const one = (sc) => validateScript({ lang: 'en', scenes: [sc] }, beats).errors.join(' | ');
  const ref = { value: 100, label: 'Green zone' };
  assert.equal(one(pex({ layout: 'columns', ref })), '');
  assert.match(one(pex({ ref })), /ref needs layout "columns"/);
  assert.match(one(pex({ layout: 'columns', ref: { value: 'x' } })), /ref must be/);
  assert.match(one(pex({ layout: 'columns', ref: { value: 100, label: 'x'.repeat(25) } })), /at most 24 characters/);
  const out = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ layout: 'columns', ref })] }, size: { width: 1920, height: 1080 } });
  assert.match(out.body, /<div class="bars cols rf"><div class="cref" style="top:calc\([^"]+\* 0\.3390\)"><i><\/i><span data-lint>Green zone<\/span><\/div>/, 'one line at 100 of 295');
  assert.equal((out.body.match(/class="cref"/g) || []).length, 1, 'one line across all the columns');
  assert.ok(out.css.includes('.bars.rf{position:relative') && out.js.includes(".querySelectorAll('.cref')"));
  // A value above the data widens the scale, so the line stays on the columns.
  const high = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ layout: 'columns', ref: { value: 400 } })] }, size: { width: 1920, height: 1080 } });
  assert.match(high.body, /\* 1\.0000\)"><i><\/i><\/div>/);
  assert.match(high.body, /id="pex-b0" style="background:[^"]+" data-frac="0.7375"/);
  const plain = parts({ brand: {}, script: { lang: 'en', scenes: [pex({ layout: 'columns' })] }, size: { width: 1920, height: 1080 } });
  assert.doesNotMatch(plain.body + plain.css + plain.js, /cref|\brf\b/, 'no reference code for a page without one');
});

test('a bars item may set its own tone: only its value is coloured, and a bad tone is refused', () => {
  const one = (sc) => validateScript({ lang: 'en', scenes: [sc] }, beats).errors.join(' | ');
  const items = [{ label: 'Manual checklist', value: 57 }, { label: 'Automated suite', value: 10, tone: 'up' }];
  const tax = pex({ id: 'tax', series: undefined, tone: undefined, unit: 'min', format: 'int', items });
  assert.equal(one(tax), '');
  assert.match(one({ ...tax, items: [items[0], { ...items[1], tone: 'green' }] }), /items\[1\]: tone must be "up"/);
  const out = parts({ brand: {}, script: { lang: 'en', scenes: [tax] }, size: { width: 1920, height: 1080 } });
  assert.match(out.body, /<span><b id="tax-bv0" data-count="57"/, 'the untoned value stays plain');
  assert.match(out.body, /<span class="tup"><b id="tax-bv1" class="tup" data-count="10"/, 'the toned value and its unit are green');
  assert.ok(out.css.includes('.tup{color:#15803d'));
  // An item tone wins over the scene tone for that item only.
  const mixed = parts({ brand: {}, script: { lang: 'en', scenes: [{ ...tax, tone: 'up', items: [{ ...items[0], tone: 'down' }, items[1]] }] }, size: { width: 1920, height: 1080 } });
  assert.match(mixed.body, /id="tax-bv0" class="tdn"[\s\S]*id="tax-bv1" class="tup"/);
});

test('in the page, toned numbers are green on light, accent and dark scenes and the second bars grow too', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-tone-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const stat = (id, theme) => ({ id, kind: 'stat', vo: 'Up nine point seven percent, year over year.', value: 9.7, format: 'pct', kicker: 'Online revenue', text: 'Jan-Sep 2026 vs Jan-Sep 2025', tone: 'up', source: 'bullets[0]', ...(theme ? { theme } : {}) });
  const sc = { lang: 'en', scenes: [stat('light'), stat('acc', 'accent'), stat('dk', 'dark'), lineScene({ tone: 'up' }), pex(), pex({ id: 'pexc', layout: 'columns', unit: '%', format: 'dec' })] };
  const timing = estimateTiming(sc, cfg.timing, 'en', beats.pace);
  const brand = { name: 'Test', logoText: 'Test', colors: { primary: '#262524', primary2: '#3f3e3c', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5b58', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' }, motion: 'cinematic' };
  for (const format of ['16:9', '9:16']) {
    const size = sizeFor(beats, format);
    const file = path.join(dir, `tone-${format.replace(':', 'x')}.html`);
    fs.writeFileSync(file, build({ brief: { format }, brand, script: sc, timing, size, icons: {} }));
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
    const { browser, page } = opened;
    try {
      const at = (id) => { const s = timing.scenes.find((x) => x.id === id); return s.end - 0.1; };
      const color = (sel, x) => page.evaluate(([q, v]) => { window.seek(v); return getComputedStyle(document.querySelector(q)).color; }, [sel, x]);
      assert.equal(await color('#g-light .big', at('light')), 'rgb(21, 128, 61)', `${format}: green on light`);
      assert.equal(await color('#g-acc .big', at('acc')), 'rgb(21, 128, 61)', `${format}: green on the accent yellow`);
      assert.equal(await color('#g-dk .big', at('dk')), 'rgb(74, 222, 128)', `${format}: a lighter green on dark`);
      assert.equal(await color('#l-lv', at('l')), 'rgb(21, 128, 61)', `${format}: the line's end value`);
      const bars = await page.evaluate((v) => { window.seek(v); return ['0', '0x', '2', '2x'].map((k) => Math.round(document.getElementById('pex-b' + k).getBoundingClientRect().width)); }, at('pex'));
      assert.ok(bars.every((w) => w > 0) && bars[0] > bars[1] && bars[1] > bars[3], `${format}: both series grow, in proportion: ${bars}`);
      assert.equal(await page.evaluate(() => document.getElementById('pex-bv0x').textContent), '210.5%');
      // Columns grow upward: the tallest is the 295 of the first item, each pair keeps its proportion, and every bottom
      // sits on the same baseline.
      const cols = await page.evaluate((v) => { window.seek(v); return ['0', '0x', '1', '1x', '2x'].map((k) => { const r = document.getElementById('pexc-b' + k).getBoundingClientRect(); return [Math.round(r.height), Math.round(r.bottom)]; }); }, at('pexc'));
      assert.ok(cols.every(([hh]) => hh > 0) && cols[0][0] > cols[1][0] && cols[1][0] > cols[2][0] && cols[2][0] > cols[4][0], `${format}: columns grow in proportion: ${cols}`);
      assert.ok(Math.abs(cols[0][0] / cols[1][0] - 295 / 210.5) < 0.05, `${format}: the pair keeps its ratio`);
      assert.ok(cols.every(([, b]) => Math.abs(b - cols[0][1]) <= 1), `${format}: one baseline: ${cols}`);
      assert.equal(await page.evaluate(() => document.getElementById('pexc-bv2x').parentElement.textContent), '108.6%');
      for (const id of ['light', 'acc', 'dk', 'l', 'pex', 'pexc']) {
        await page.evaluate((v) => window.seek(v), at(id));
        assert.deepEqual(await page.evaluate(lintInPage, cfg.lint.safeArea), [], `${format} ${id} stays in the safe area`);
      }
    } finally {
      await browser.close();
    }
  }
});

const lineScene = (o) => ({ id: 'l', kind: 'line', vo: 'Conversion passed the target.', title: 'Conversion', points: [38, 41, 57, 52, 61], format: 'pct', source: 'bullets[0]', ...o });
const lineParts = (o, size = { width: 1920, height: 1080 }) => parts({ brand: {}, script: { lang: 'en', scenes: [lineScene(o)] }, size });

test('a line band and reference line pass when well formed; malformed ones are named', () => {
  const errs = (o) => validateScript({ scenes: [lineScene(o)] }, beats).errors.filter((e) => !/at position \d/.test(e)).join(' | ');
  assert.equal(errs({ band: { from: 2, to: 3, label: 'Q3' }, ref: { value: 50, label: '50% target' } }), '');
  assert.equal(errs({ band: { from: 2, to: 2 }, ref: { value: 0 } }), '', 'labels are optional');
  for (const band of [{ from: 3, to: 2 }, { from: 0, to: 5 }, { from: -1, to: 1 }, { from: 1.5, to: 2 }, { from: 1, to: 2, label: 'x'.repeat(25) }, 'Q3']) {
    assert.match(errs({ band }), /band must be \{ "from": 2, "to": 3, "label": "Q3" \}/, JSON.stringify(band));
  }
  for (const ref of [{ value: '50' }, { label: 'Target' }, { value: 50, label: 'x'.repeat(25) }, 50]) {
    assert.match(errs({ ref }), /ref must be \{ "value": 50, "label": "Target" \}/, JSON.stringify(ref));
  }
});

test('a band tints its span of points under a label; a reference value draws a dashed line and widens the scale', () => {
  const p = lineParts({ band: { from: 2, to: 2, label: 'Q3 <launch>' }, ref: { value: 90, label: 'Target' } });
  // 5 points over 1400 units: point 2 sits at 700, half a segment (175) each side.
  assert.match(p.body, /<rect class="band" id="l-band" x="525" y="0" width="350" height="420"\/>/);
  assert.match(p.body, /<div class="blab" id="l-bl" data-lint style="left:calc\(\(100% - \d+px\) \* 0\.3750\);width:calc\(\(100% - \d+px\) \* 0\.2500\);justify-content:center">Q3 &lt;launch&gt;<\/div>/);
  // 90 is above every point, so it becomes the top of the scale; under a band label the top is 10 + 28 * 1.3 + 14 = 60,
  // so the line keeps clear of the label (a peak ran through "Q3", NSC s5, 2026-10-26).
  assert.match(p.body, /<path class="ref" id="l-ref" d="M0 60 H1400"\/>/);
  // The label sits just above its line as a share of the chart height (60 / 420), so it follows the line when the
  // chart is shorter than its viewBox (the cinematic layout squeezes it; the label used to land on the line).
  assert.match(p.body, /<div class="rlab" id="l-rl" data-lint style="top:calc\(14\.29% - 38px\)">Target<\/div>/);
  // Without a band label the scale top stays at 40.
  assert.match(lineParts({ band: { from: 2, to: 2 }, ref: { value: 90, label: 'Target' } }).body, /<path class="ref" id="l-ref" d="M0 40 H1400"\/>/);
  assert.ok(p.css.includes('.band{fill:var(--secondary);fill-opacity:.22}') && p.css.includes('stroke-dasharray:14 10'));
  assert.ok(p.js.includes("for (const [mark, lab] of [['-band', '-bl'], ['-ref', '-rl']])"));
  const plain = lineParts({});
  assert.doesNotMatch(plain.body + plain.css + plain.js, /class="band"|class="ref"|blab|rlab|\.band\{|\.ref\{|-band/);
});

test("the line's end value sits right of its last point, in a column the plot leaves for it", () => {
  const p = lineParts({});
  // "61.0%" = 5 characters: the column is 5 * 0.64 * 64 + 2 * 26 = 257 px; the value is centred on the last point.
  assert.match(p.body, /<svg viewBox="0 0 1400 420" preserveAspectRatio="none" aria-hidden="true" style="width:calc\(100% - 257px\)">/);
  assert.match(p.body, /<div class="lval" id="l-lv" style="left:calc\(100% - 231px\);top:8px"/);
  const falling = lineParts({ points: [900, 700, 108], format: 'int' });
  // The lowest point (y = 400) holds the value as low as the chart allows: 420 - 64.
  assert.match(falling.body, /<div class="lval" id="l-lv" style="left:calc\(100% - \d+px\);top:356px"/);
  assert.ok(!p.css.includes('top:-70px'), 'no longer pinned above the chart corner');
});

// Opens the built page in Chrome and checks the bars at each period and the stripes turning into bars.
test('in the page, bars reach each period rank, stripes become bars, and nothing leaves the safe area', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-charts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const brand = { name: 'Test', logoText: 'Test', colors: { primary: '#111827', primary2: '#2563eb', secondary: '#f59e0b', bg: '#ffffff', ink: '#111827', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };

  for (const format of ['16:9', '9:16']) {
    const size = sizeFor(beats, format);
    const file = path.join(dir, `index-${format.replace(':', 'x')}.html`);
    fs.writeFileSync(file, build({ brief: { format }, brand, script, timing, size, icons: {} }));
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size }); } catch (err) { if (/Composition|render script/.test(err.message)) throw err; t.skip(`Chrome is not available: ${err.message}`); return; }
    const { browser, page } = opened;
    try {
      const sc = timing.scenes.find((x) => x.id === 'race');
      const order = async (tm) => page.evaluate((at) => {
        window.seek(at);
        const rows = [...document.querySelectorAll('[id^="race-r"]')].filter((el) => /^race-r\d+$/.test(el.id));
        const shown = rows.filter((el) => +getComputedStyle(el).opacity > 0.5).map((el) => ({ i: +el.id.slice(6), y: el.getBoundingClientRect().top }));
        return { per: document.getElementById('race-per').textContent, order: shown.sort((a, b) => a.y - b.y).map((x) => x.i) };
      }, tm);
      const early = await order(sc.start + 0.95);
      assert.deepEqual(early, { per: '2005', order: [0, 2, 1, 4] }, `${format} 2005 shows the top 4 in rank order`);
      const late = await order(sc.end - 0.05);
      assert.deepEqual(late, { per: '2020', order: [1, 2, 0, 3] }, `${format} 2020: gas, nuclear, coal, wind`);

      const st = timing.scenes.find((x) => x.id === 'stripes');
      const heights = await page.evaluate((at) => { window.seek(at); return [...document.querySelectorAll('#g-stripes .stp')].map((el) => Math.round(el.getBoundingClientRect().height)); }, st.end - 0.05);
      assert.ok(new Set(heights).size > 5, `${format} stripes have become bars of different heights`);

      for (const id of ['race', 'stripes']) {
        const s2 = timing.scenes.find((x) => x.id === id);
        await page.evaluate((at) => window.seek(at), s2.end - 0.1);
        assert.deepEqual(await page.evaluate(lintInPage, cfg.lint.safeArea), [], `${format} ${id} stays in the safe area`);
      }
    } finally {
      await browser.close();
    }
  }
});
