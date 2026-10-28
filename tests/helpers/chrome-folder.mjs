// A temp folder that Chrome tests open composition pages from: GSAP, three.js and lottie-web in vendor/, and for every asset or
// clip a page names a sample photo, clip, .glb or Lottie .json made once with ffmpeg. Removed when the test ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ffmpeg } from '../../engine/media.mjs';
import { sampleGlb } from '../../engine/glb.mjs';
import { sampleLottie } from '../../engine/lottie.mjs';
import { copyThree, copyLottie, copyGsap } from '../../engine/vendor.mjs';

/** True when playwright-core can start the configured Chrome. */
export async function hasChrome(channel) {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel, headless: true })).close(); return true; } catch { return false; }
}

/** { dir, write(name, html) → file path }: write() also puts every asset and clip the page names next to it. */
export async function chromeFolder(t, prefix = 'ms-chrome-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const d of ['vendor', 'assets', 'clips']) fs.mkdirSync(path.join(dir, d));
  copyGsap(dir);
  copyThree(dir);
  copyLottie(dir);
  const photo = path.join(dir, 'sample.jpg'), clip = path.join(dir, 'sample.mp4');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', photo], { timeoutMs: 30000 });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', clip], { timeoutMs: 60000 });
  const write = (name, html) => {
    for (const [, n] of html.matchAll(/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
      if (/\.glb$/i.test(n)) fs.writeFileSync(path.join(dir, 'assets', n), sampleGlb());
      else if (/\.json$/i.test(n)) fs.writeFileSync(path.join(dir, 'assets', n), sampleLottie());
      else fs.copyFileSync(/\.(mp4|webm|mov)$/i.test(n) ? clip : photo, path.join(dir, 'assets', n));
    }
    for (const [, c] of html.matchAll(/clips\/([a-z0-9-]+)\.mp4/g)) fs.copyFileSync(clip, path.join(dir, 'clips', `${c}.mp4`));
    const file = path.join(dir, name);
    fs.writeFileSync(file, html);
    return file;
  };
  return { dir, write };
}
