import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { openComposition } from '../engine/media.mjs';

const BRAND = {
  name: 'Burst Co', logoText: 'burst', colors: { primary: '#262524', primary2: '#4682ff', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5c5c', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' }, motion: 'cinematic',
};

// NSC award film, 2026-10-26: after the burst pulled back, each ray stayed as a zero-length stroke whose round cap drew
// a dot; two of them sat on the tagline.
test('the burst rays are gone once they pull back, so no dots are left on the tagline', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-burst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const { dir: tdir, beats } = loadTemplate('logo-reveal');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const script = { lang: 'en', scenes: [{ id: 'reveal', kind: 'reveal', style: 'burst', theme: 'dark', tagline: 'We build trust. We own outcomes.', vo: 'We build trust, shape what is next, and own outcomes.' }] };
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const file = path.join(dir, 'burst.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') }));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const s = timing.scenes[0].start;
    const rays = (x) => opened.page.evaluate((v) => { window.seek(v); return [...document.querySelectorAll('.rays path')].map((p) => Number(getComputedStyle(p).opacity)); }, x);
    assert.ok((await rays(s + 0.6)).some((o) => o > 0), 'the rays show during the burst');
    assert.ok((await rays(s + 2)).every((o) => o === 0), 'no ray is left once they pulled back');
  } finally { await opened.browser.close(); }
});
