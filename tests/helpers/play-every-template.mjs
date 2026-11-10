// Plays every built-in template's sample scenes through in every format, once per motion profile: no play-through
// error (text over text, a caption over text, two captions or scenes at once, played ≠ jumped). Slow: Chrome, a few
// minutes a profile when every page plays, so the profiles are split over tests/playcheck-templates-<n>.test.mjs and the runner plays the
// files side by side. `--test-name-pattern <motion>` runs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadStudioConfig } from '../../engine/core.mjs';
import { listTemplates, loadTemplate } from '../../engine/jobs.mjs';
import { estimateTiming } from '../../engine/timing.mjs';
import { sizeFor } from '../../engine/pipeline.mjs';
import { sampleScript } from '../../engine/template-preview.mjs';
import { openComposition } from '../../engine/media.mjs';
import { playCheck, PLAY_DEFAULTS } from '../../engine/playcheck.mjs';
import { MOTIONS, motionProfile } from '../../engine/brand.mjs';
import { chromeFolder, hasChrome } from './chrome-folder.mjs';
import { pageCache, checkerStamp } from './page-cache.mjs';

// Balanced by their play times (editorial is the slowest); a profile missing here joins the last group.
const GROUPS = [['editorial', 'clean'], ['standard', 'kinetic'], ['cinematic', 'parallax']];
export const motionGroup = (n) => {
  const listed = GROUPS.flat();
  const rest = MOTIONS.filter((m) => !listed.includes(m));
  return [...GROUPS[n].filter((m) => MOTIONS.includes(m)), ...(n === GROUPS.length - 1 ? rest : [])];
};

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

/**
 * One test per motion profile of group `n`. A page that already passed with the same HTML and the same checker
 * (tests/helpers/page-cache.mjs) is not played again, so a run plays only the templates a change touched, by itself or
 * through the kit; Chrome is not started when nothing changed. STUDIO_PLAY_ALL=1 plays every page.
 */
export function playEveryTemplate(n) {
  for (const motion of motionGroup(n)) {
    test(`every template sample plays through with no play-through error: ${motion}`, { timeout: 900000 }, async (t) => {
      const brand = motion === 'standard' ? BRAND : { ...BRAND, motion };
      const profile = motionProfile(brand);
      const timingCfg = { ...TIMING, ...(profile.tight ? { tight: cfg.timing.tight } : {}) };
      const cache = pageCache(`play-${motion}`, checkerStamp([fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n'), cfg.lint.safeArea, cfg.engine.chromeChannel]));
      const todo = [];
      let pages = 0;
      for (const { id } of listTemplates()) {
        const { dir: tplDir, beats } = loadTemplate(id);
        const script = sampleScript(beats);
        const timing = estimateTiming(script, timingCfg, 'en', beats.pace || null, null, null, profile.tight);
        const { build } = await import(pathToFileURL(path.join(tplDir, 'template.mjs')).href);
        for (const format of beats.formats) {
          const size = sizeFor(beats, format);
          const html = build({ brief: { format }, brand, script, timing, size, icons: {} });
          pages++;
          if (!cache.passed(`${id}|${format}`, html)) todo.push({ id, format, size, html });
        }
      }
      assert.ok(pages >= 50, `only ${pages} pages built`);
      t.diagnostic(`${motion}: ${todo.length} of ${pages} pages to play${todo.length ? ` (${[...new Set(todo.map((p) => p.id))].join(', ')})` : ''}, ${pages - todo.length} unchanged since they last passed`);
      if (!todo.length) { cache.save(); return; }
      if (!(await hasChrome(cfg.engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
      const folder = await chromeFolder(t, 'ms-playall-');
      const bad = [];
      try {
        for (const { id, format, size, html } of todo) {
          const file = folder.write('index.html', html);
          const { browser, page, info } = await openComposition(file, { channel: cfg.engine.chromeChannel, ...size });
          try {
            const { findings } = await playCheck(page, info, { ...PLAY_DEFAULTS, step: STEP, safeArea: cfg.lint.safeArea, oneScene: profile.oneScene });
            const errors = findings.filter((x) => x.level === 'error');
            for (const f of errors) bad.push(`${id} ${format} ${motion}: ${f.scene} ${f.el}: ${f.msg}`);
            if (!errors.length) cache.pass(`${id}|${format}`, html);
          } finally {
            await browser.close();
          }
        }
      } finally {
        // Pages that passed stay recorded even when another page fails or throws, so the next run plays only the rest.
        cache.save();
      }
      assert.deepEqual(bad, []);
    });
  }
}
