// Golden frames: each built-in template's sample, three frames in 16:9 and 9:16 at 480 px, against the references
// in tests/golden/ by SSIM (tests/golden.mjs has the brand, the frame times and the threshold). A failure names the
// template, format, frame and score, and copies the actual frame beside a copy of its reference into a temp folder.
// After an intended layout change, look at those frames, then rewrite the references:
//
//   node tests/golden.mjs --update <template...>     (no template: every reference)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStudioConfig } from '../engine/core.mjs';
import { openComposition } from '../engine/media.mjs';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';
import { GOLDEN_DIR, FRAMES, THRESHOLD, goldenCases, goldenName, prepareCase, shootFrames, ssim } from './golden.mjs';

const cfg = loadStudioConfig();
const chrome = await hasChrome(cfg.engine.chromeChannel);
const cases = goldenCases();

// Failed frames are kept (not removed with the test) so the person can open them.
let failDir = null;
const keep = (file, name) => {
  failDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ms-golden-fail-'));
  const to = path.join(failDir, name);
  fs.copyFileSync(file, to);
  return to;
};

test('every reference frame belongs to a template and format the suite covers', () => {
  const want = new Set(cases.flatMap((c) => Array.from({ length: FRAMES }, (_, i) => goldenName(c, i + 1))));
  const stale = fs.existsSync(GOLDEN_DIR) ? fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.png') && !want.has(f)) : [];
  assert.deepEqual(stale, [], 'remove these, or run node tests/golden.mjs --update');
});

for (const template of [...new Set(cases.map((c) => c.template))]) {
  test(`${template}: frames match the golden references`, { timeout: 300000 }, async (t) => {
    if (!chrome) { t.skip('Chrome is not available'); return; }
    // A template with no reference yet (a new one) is skipped with the command, not failed; a partial set fails below.
    const mine = cases.filter((x) => x.template === template).flatMap((c) => Array.from({ length: FRAMES }, (_, i) => goldenName(c, i + 1)));
    if (!mine.some((n) => fs.existsSync(path.join(GOLDEN_DIR, n)))) { t.skip(`no golden references yet: node tests/golden.mjs --update ${template}`); return; }
    const folder = await chromeFolder(t, 'ms-golden-');
    const work = path.join(folder.dir, 'shots');
    fs.mkdirSync(work);
    const bad = [];
    let low = 1;
    for (const c of cases.filter((x) => x.template === template)) {
      const p = await prepareCase(folder, c);
      const { browser, page } = await openComposition(p.file, { channel: cfg.engine.chromeChannel, ...p.size, inject: p.inject });
      let frames;
      try { frames = await shootFrames(page, c, p.times, p.size, work); } finally { await browser.close(); }
      for (const f of frames) {
        const name = goldenName(c, f.n), ref = path.join(GOLDEN_DIR, name);
        const where = `${template} ${c.format} frame ${f.n} (t=${f.t} s)`;
        const actual = () => keep(f.file, name.replace(/\.png$/, '.actual.png'));
        if (!fs.existsSync(ref)) { bad.push(`${where}: no reference tests/golden/${name}; actual frame ${actual()}. Make it with node tests/golden.mjs --update ${template}`); continue; }
        let score;
        try { score = await ssim(f.file, ref); } catch (err) {
          bad.push(`${where}: could not compare (${err.message.slice(0, 200)}); actual frame ${actual()} beside ${keep(ref, name)}`);
          continue;
        }
        low = Math.min(low, score);
        if (score < THRESHOLD) bad.push(`${where}: SSIM ${score.toFixed(4)} is below ${THRESHOLD}; actual frame ${actual()} beside ${keep(ref, name)}`);
      }
    }
    t.diagnostic(`${template}: lowest SSIM ${low.toFixed(4)}`);
    assert.deepEqual(bad, [], `\n${bad.join('\n')}\nIf the change is intended: node tests/golden.mjs --update ${template}`);
  });
}
