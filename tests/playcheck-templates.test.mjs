// Plays every built-in template's sample scenes through in every format, once per motion profile: no play-through
// error (text over text, a caption over text, two captions or scenes at once, played ≠ jumped). Slow: Chrome, ~2 min a
// profile; `--test-name-pattern <motion>` runs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { listTemplates, loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { sampleScript } from '../engine/template-preview.mjs';
import { openComposition } from '../engine/media.mjs';
import { playCheck, PLAY_DEFAULTS } from '../engine/playcheck.mjs';
import { MOTIONS, motionProfile } from '../engine/brand.mjs';
import { chromeFolder, hasChrome } from './helpers/chrome-folder.mjs';

const cfg = loadStudioConfig();
const BRAND = {
  name: 'Sweep Co', logo: null, logoDark: null, logoText: 'Sweep', site: '',
  colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  palette: [], fonts: { display: 'Arial', body: 'Arial', googleFonts: '' },
  voice: { tts: 'none', voice: '', speed: 1, lang: 'en' }, music: { file: null, gainDb: -18 }, sources: { allowedHosts: [] },
};
const TIMING = { wordsPerSecond: { default: 2.6 }, minScene: 2.5, leadIn: 0.3, tailOut: 0.4, lastSceneHold: 1.2 };
// Coarser than prepare (1/12 s) to keep the sweep quick; history marks stay every 0.5 s.
const STEP = 1 / 6;

for (const motion of MOTIONS) {
  test(`every template sample plays through with no play-through error: ${motion}`, { timeout: 900000 }, async (t) => {
    if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
    const folder = await chromeFolder(t, 'ms-playall-');
    const brand = motion === 'standard' ? BRAND : { ...BRAND, motion };
    const timingCfg = { ...TIMING, ...(motionProfile(brand).tight ? { tight: cfg.timing.tight } : {}) };
    const bad = [];
    let pages = 0;
    for (const { id } of listTemplates()) {
      const { dir: tplDir, beats } = loadTemplate(id);
      const script = sampleScript(beats);
      const timing = estimateTiming(script, timingCfg, 'en', beats.pace || null, null, null, motionProfile(brand).tight);
      const { build } = await import(pathToFileURL(path.join(tplDir, 'template.mjs')).href);
      for (const format of beats.formats) {
        const size = sizeFor(beats, format);
        const file = folder.write('index.html', build({ brief: { format }, brand, script, timing, size, icons: {} }));
        const { browser, page, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size });
        try {
          const { findings } = await playCheck(page, info, { ...PLAY_DEFAULTS, step: STEP, safeArea: cfg.lint.safeArea, oneScene: motionProfile(brand).oneScene });
          for (const f of findings.filter((x) => x.level === 'error')) bad.push(`${id} ${format} ${motion}: ${f.scene} ${f.el}: ${f.msg}`);
          pages++;
        } finally {
          await browser.close();
        }
      }
    }
    assert.ok(pages >= 50, `only ${pages} pages played`);
    assert.deepEqual(bad, []);
  });
}
