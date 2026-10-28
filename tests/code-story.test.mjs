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
import { build, highlightLine, lineDiff, tokenDiff, pairChanges } from '../templates/code-story/template.mjs';

const beats = loadTemplate('code-story').beats;
const script = {
  lang: 'en',
  scenes: [
    { id: 'title', kind: 'title', vo: 'What changed in release 2.4.', title: 'Release 2.4', subtitle: 'Three fixes and one new option' },
    { id: 'code', kind: 'code', vo: 'Uploads now retry three times before they give up.', title: 'Retries', lang: 'config.js', code: 'export default {\n  // Retry failed uploads\n  retries: 3,\n  timeout: 30_000,\n};', highlight: [3], source: 'bullets[0]' },
    { id: 'diff', kind: 'diff', vo: 'A single equals sign was the bug; now the check compares instead of assigning.', title: 'The fix', file: 'upload.js', before: 'if (res.status = 200) {\n  done();\n}', after: 'if (res.status === 200) {\n  done();\n}', source: 'bullets[1]' },
    { id: 'tree', kind: 'tree', vo: 'Two files changed, most of it new tests.', title: 'Files changed', files: [{ path: 'src/upload.js', added: 12, removed: 3 }, { path: 'tests/upload.test.js', added: 40, removed: 0 }], source: 'bullets[2]' },
    { id: 'term', kind: 'terminal', vo: 'And the whole suite passes.', title: 'Tests', lines: [{ cmd: 'npm test' }, { out: '✓ 42 passed' }, { out: 'Done in 3.1s' }], source: 'bullets[3]' },
    { id: 'list', kind: 'checklist', vo: 'Retries, clearer errors, and offline mode is next.', title: 'In this release', items: ['Retries on upload', 'Clearer errors', { text: 'Offline mode', done: false }], source: 'bullets[4]' },
    { id: 'cta', kind: 'cta', vo: 'Read the release notes.', title: 'Read the notes', button: 'Open changelog' },
  ],
};

test('code is escaped and highlighted; a diff keeps context, removals and additions in order', () => {
  const html = highlightLine('const x = "<script>"; // done');
  assert.ok(!html.includes('<script>'), 'markup in code is escaped');
  assert.match(html, /<span class="tk">const<\/span>/);
  assert.match(html, /<span class="ts">&quot;&lt;script&gt;&quot;<\/span>/);
  assert.match(html, /<span class="tc">\/\/ done<\/span>/);
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd').map((x) => `${x.op}${x.text}`), [' a', '-b', '+B', ' c', '+d']);
});

test('a line that only changed becomes one changed line with its removed and added tokens', () => {
  assert.deepEqual(tokenDiff('if (res.status = 200) {', 'if (res.status === 200) {'), [{ op: ' ', text: 'if (res.status =' }, { op: '+', text: '==' }, { op: ' ', text: ' 200) {' }]);
  const ops = pairChanges(lineDiff('if (res.status = 200) {\n  done();\n}', 'if (res.status === 200) {\n  done();\n}'));
  assert.deepEqual(ops.map((o) => `${o.op}${o.text}`), ['~if (res.status === 200) {', '   done();', ' }']);
  assert.deepEqual(pairChanges(lineDiff('a\nb\nc', 'a\nB\nc\nd')).map((o) => `${o.op}${o.text}`), [' a', '-b', '+B', ' c', '+d'], 'lines with nothing in common stay a removal and an addition');
  assert.deepEqual(pairChanges(lineDiff('x = load(a);\ny = 1;', 'x = load(b);\ny = 2;\nz = 3;')).map((o) => o.op), ['~', '~', '+'], 'a run pairs line by line, the extra addition follows');
  assert.deepEqual(pairChanges(lineDiff('const x = load();', 'return fetchAll(items).then(render);')).map((o) => o.op), ['-', '+']);
  const html = build({ brief: { format: '16:9' }, brand: { name: 'T', logoText: 'T', colors: { primary: '#0b1020', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f7f5f0', ink: '#111827', muted: '#5b6474', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } },
    script: { lang: 'en', scenes: [{ id: 'd', kind: 'diff', vo: 'v', title: 'Fix', before: 'a = "<b>";', after: 'a = "<i>";' }] }, timing: { duration: 4, lang: 'en', words: [], scenes: [{ id: 'd', start: 0, end: 4 }] }, size: sizeFor(beats, '16:9'), icons: {} });
  assert.match(html, /class="ln chg" id="d-l0"><b>±<\/b>/);
  assert.ok(!html.includes('"<b>"') && html.includes('class="xd"') && html.includes('class="xa"'), 'changed tokens are escaped and wrapped');
});

test('code-story scenes pass its rules; oversize or malformed data is named', () => {
  assert.deepEqual(validateScript(script, beats).errors, []);
  const errs = (i, patch) => validateScript({ ...script, scenes: script.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }, beats).errors.join(' | ');
  assert.match(errs(1, { code: Array(20).fill('x').join('\n') }), /20 lines, at most 18/);
  assert.match(errs(1, { code: 'x'.repeat(80) }), /line 1 is longer than 72/);
  assert.match(errs(1, { highlight: ['3'] }), /highlight must be a list of line numbers/);
  assert.match(errs(2, { after: script.scenes[2].before }), /before and after are the same/);
  assert.match(errs(3, { files: [{ path: '', added: 1 }] }), /path is required/);
  assert.match(errs(3, { files: [{ path: 'a.js', added: -1 }] }), /whole numbers/);
  assert.match(errs(4, { lines: [{ cmd: 'a', out: 'b' }] }), /\{ "cmd": "..." \} or \{ "out": "..." \}/);
  assert.match(errs(5, { items: [] }), /items is required|items must list/);
});

test('in the page: lines light up, the diff opens, commands type, items tick, and all stays in the safe area', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-code-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace);
  const brand = { name: 'Test', logoText: 'Test', colors: { primary: '#0b1020', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f7f5f0', ink: '#111827', muted: '#5b6474', onPrimary: '#ffffff' }, fonts: { display: 'Arial', body: 'Arial' } };
  const end = (id) => timing.scenes.find((x) => x.id === id).end - 0.45;
  for (const format of ['16:9', '9:16']) {
    const size = sizeFor(beats, format);
    const file = path.join(dir, `index-${format.replace(':', 'x')}.html`);
    fs.writeFileSync(file, build({ brief: { format }, brand, script, timing, size, icons: {} }));
    let opened;
    try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
    const { browser, page } = opened;
    try {
      const at = (tm, fn) => page.evaluate(([x, src]) => { window.seek(x); return new Function(`return (${src})()`)(); }, [tm, fn.toString()]);
      const diff = await at(end('diff'), () => [...document.querySelectorAll('[id^="diff-l"]')].map((el) => ({ cls: el.className, h: Math.round(el.getBoundingClientRect().height), dec: getComputedStyle(el).textDecorationLine })));
      assert.ok(diff.filter((x) => x.cls.includes('add')).every((x) => x.h > 10), `${format}: added lines are open`);
      assert.ok(diff.filter((x) => x.cls.includes('del')).every((x) => x.dec === 'line-through'), `${format}: removed lines are struck`);
      // A changed line reads as the old line before the cue and as the new one by the end of the scene.
      const shown = () => [...document.querySelectorAll('[id^="diff-l"].chg code')].map((c) => [...c.childNodes].filter((n) => n.nodeType === 3 || (+getComputedStyle(n).opacity > 0.5 && n.offsetWidth > 0)).map((n) => n.textContent).join(''));
      const sd = script.scenes.find((x) => x.id === 'diff');
      assert.deepEqual(await at(timing.scenes.find((x) => x.id === 'diff').start + 0.8, shown), [sd.before.split('\n')[0]], `${format}: the old line first`);
      assert.deepEqual(await at(end('diff'), shown), [sd.after.split('\n')[0]], `${format}: the new line at the end`);
      assert.equal(await at(end('term'), () => document.getElementById('term-c0').textContent), 'npm test', `${format}: the command is fully typed`);
      assert.equal(await at(timing.scenes.find((x) => x.id === 'term').start + 0.3, () => document.getElementById('term-c0').textContent), '', `${format}: and empty before it starts`);
      const ticks = await at(end('list'), () => [0, 1, 2].map((k) => getComputedStyle(document.getElementById(`list-t${k}`)).strokeDasharray));
      assert.notEqual(ticks[0], ticks[2], `${format}: done items tick, the open one does not`);
      for (const id of ['title', 'code', 'diff', 'tree', 'term', 'list', 'cta']) {
        await page.evaluate((x) => window.seek(x), end(id));
        assert.deepEqual(await page.evaluate(lintInPage, cfg.lint.safeArea), [], `${format} ${id} stays in the safe area`);
      }
    } finally {
      await browser.close();
    }
  }
});
