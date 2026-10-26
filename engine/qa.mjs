// Checks a finished MP4 the way a person would before posting it: loudness, black or frozen picture, hard cuts,
// size and length, and captions. The result is a receipt (qa.json) shown on the done banner.
import { round } from './core.mjs';
import { ffmpegReport, probeMedia } from './media.mjs';

export const QA_RULES = {
  loudness: -14, loudnessTolerance: 1.5, // LUFS, the level exportFinal normalises to
  truePeakMax: -1.0, // dBTP
  blackMin: 0.5, // seconds of black picture worth a warning
  freezeMin: 3, // seconds of a fully still picture worth a warning
  durationTolerance: 0.1, // seconds between the file and the timing it was rendered from
  cueMaxChars: 84, // two caption lines of 42 characters
  // ffmpeg scdet score (0-100) at which the picture changes in one frame much more than in the frame before: a hard
  // cut or a flash. Measured on the NSC film: one-frame colour swaps scored 14-69, footage and kinetic type 8-12.
  cutJump: 12,
};

// ffmpeg writes -inf for a silent track: no number, as in loudness.mjs.
const num = (re, s) => { const m = re.exec(s); return m && !/inf|nan/i.test(m[1]) ? Number(m[1]) : null; };

/** ebur128's closing summary: integrated loudness, range and true peak. */
export function parseLoudness(log) {
  const at = log.lastIndexOf('Summary:');
  if (at < 0) return null;
  const s = log.slice(at);
  return { integrated: num(/I:\s*(-?[\d.]+|-inf) LUFS/, s), range: num(/LRA:\s*(-?[\d.]+) LU/, s), truePeak: num(/Peak:\s*(-?[\d.]+|-inf) dBFS/, s) };
}

/** blackdetect segments: [{ start, end }]. */
export function parseBlack(log) {
  return [...log.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => ({ start: round(+m[1], 2), end: round(+m[2], 2) }));
}

/** freezedetect segments: [{ start, end }]; a freeze still running at the end of the file ends at `duration`. */
export function parseFreeze(log, duration) {
  const out = [];
  let open = null;
  for (const m of log.matchAll(/freezedetect\.freeze_(start|end):\s*([\d.]+)/g)) {
    if (m[1] === 'start') open = +m[2];
    else if (open !== null) { out.push({ start: round(open, 2), end: round(+m[2], 2) }); open = null; }
  }
  if (open !== null) out.push({ start: round(open, 2), end: round(duration, 2) });
  return out;
}

/** scdet hits: [{ t, score }], one per frame whose change jumps against the frame before. */
export function parseJumps(log) {
  return [...log.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => ({ t: round(+m[2], 2), score: round(+m[1], 1) }));
}

const srtSeconds = (t) => { const [h, m, rest] = t.split(':'); const [s, ms] = rest.split(','); return +h * 3600 + +m * 60 + +s + +ms / 1000; };

/** SRT text → cues; malformed blocks come back as `{ bad: n }`. */
export function parseSrt(text) {
  return String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((block, i) => {
    const lines = block.split('\n');
    const m = /^(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)$/.exec(lines[1] || '');
    if (!m) return { bad: i + 1 };
    return { n: i + 1, start: srtSeconds(m[1]), end: srtSeconds(m[2]), text: lines.slice(2).join('\n') };
  });
}

/** Caption problems: bad blocks, empty or reversed cues, overlaps, cues past the end, cues too long to read. */
export function checkCaptions(text, duration, rules = QA_RULES) {
  const cues = parseSrt(text);
  const issues = [];
  let prevEnd = 0;
  for (const c of cues) {
    if (c.bad) { issues.push(`cue ${c.bad} is not valid SRT`); continue; }
    if (!c.text.trim()) issues.push(`cue ${c.n} has no text`);
    if (c.end <= c.start) issues.push(`cue ${c.n} ends before it starts`);
    if (c.start < prevEnd - 0.001) issues.push(`cue ${c.n} overlaps the cue before it`);
    if (c.end > duration + 0.05) issues.push(`cue ${c.n} runs past the end of the video`);
    const len = c.text.replace(/\n/g, ' ').length;
    if (len > rules.cueMaxChars) issues.push(`cue ${c.n} is ${len} characters, more than two caption lines`);
    prevEnd = Math.max(prevEnd, c.end);
  }
  return { cues: cues.length, issues };
}

/**
 * Pure verdict from what was measured. `expect`: { width, height, fps, duration, silent, normalised, platformFormats,
 * format }; `normalised: false` (cut sounds only, no loudness pass) skips the loudness target but not the silence check.
 * Findings are errors when the file is wrong, warnings when a person should look.
 */
export function judge(measured, expect, rules = QA_RULES) {
  const f = [];
  const { probe, loudness, black, freeze, captions, jumps = [] } = measured;
  if (Math.abs(probe.duration - expect.duration) > rules.durationTolerance) {
    f.push({ level: 'error', check: 'length', msg: `file is ${round(probe.duration, 2)} s, the storyboard is ${expect.duration} s` });
  }
  if (!probe.hasAudio) f.push({ level: 'error', check: 'audio', msg: 'the file has no audio track' });
  if (!expect.silent && loudness) {
    if (loudness.integrated === null) {
      f.push({ level: 'warning', check: 'loudness', msg: 'the sound track is silent: check the voice and music' });
    } else if (expect.normalised !== false && Math.abs(loudness.integrated - rules.loudness) > rules.loudnessTolerance) {
      f.push({ level: 'warning', check: 'loudness', msg: `loudness is ${loudness.integrated} LUFS, target ${rules.loudness} ± ${rules.loudnessTolerance}` });
    }
    if (loudness.truePeak !== null && loudness.truePeak > rules.truePeakMax) {
      f.push({ level: 'warning', check: 'loudness', msg: `true peak ${loudness.truePeak} dBTP is above ${rules.truePeakMax}: may clip on some players` });
    }
  }
  for (const b of black) {
    if (b.end - b.start >= rules.blackMin) f.push({ level: 'warning', check: 'black', msg: `black picture from ${b.start} s to ${b.end} s` });
  }
  for (const z of freeze) {
    if (z.end - z.start >= rules.freezeMin) f.push({ level: 'warning', check: 'freeze', msg: `picture stands still from ${z.start} s to ${z.end} s` });
  }
  // Hits a frame or two apart are one cut.
  let last = -1;
  for (const j of jumps) {
    if (j.score < rules.cutJump) continue;
    if (j.t - last > 0.1) f.push({ level: 'warning', check: 'cut', msg: `the picture jumps in one frame at ${j.t} s (change ${j.score}): a hard cut, check it plays smoothly` });
    last = j.t;
  }
  if (expect.platformFormats && expect.format && !expect.platformFormats.includes(expect.format)) {
    f.push({ level: 'warning', check: 'platform', msg: `${expect.format} is not a format this platform shows well (${expect.platformFormats.join(', ')})` });
  }
  if (captions) for (const msg of captions.issues) f.push({ level: 'warning', check: 'captions', msg });
  const errors = f.filter((x) => x.level === 'error').length;
  return { passed: errors === 0, errors, warnings: f.length - errors, findings: f };
}

/** Measures one MP4 (one decode pass) and judges it. `captionsText` may be null when there are no captions. */
export async function runQa(file, expect, captionsText = null) {
  const probe = await probeMedia(file);
  const filters = [];
  const args = ['-i', file];
  // scdet runs on a small copy after the full-size checks and prints only the frames at the warning level.
  if (probe.hasVideo) filters.push(`[0:v]blackdetect=d=0.2:pix_th=0.10,freezedetect=n=0.001:d=1,scale=320:-2,scdet=threshold=${QA_RULES.cutJump}[v]`);
  if (probe.hasAudio) filters.push('[0:a]ebur128=peak=true:framelog=quiet[a]');
  if (filters.length) {
    args.push('-filter_complex', filters.join(';'));
    if (probe.hasVideo) args.push('-map', '[v]');
    if (probe.hasAudio) args.push('-map', '[a]');
  }
  args.push('-f', 'null', '-');
  const log = await ffmpegReport(args);
  const measured = {
    probe: { duration: round(probe.duration, 3), hasAudio: probe.hasAudio, hasVideo: probe.hasVideo },
    loudness: probe.hasAudio ? parseLoudness(log) : null,
    black: parseBlack(log),
    freeze: parseFreeze(log, probe.duration),
    jumps: parseJumps(log),
    captions: captionsText === null ? null : checkCaptions(captionsText, probe.duration),
  };
  return { checkedAt: new Date().toISOString(), measured, ...judge(measured, expect) };
}
