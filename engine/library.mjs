import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError } from './core.mjs';
import { ffmpeg, ffmpegReport } from './media.mjs';

// Built-in background music, synthesised locally with ffmpeg: no licence questions, no download.
const DIR = path.join(ROOT, 'library', 'music');
const SECONDS = 120;

// Chord tones (Hz) per bar; each track walks its progression.
const C = [130.81, 164.81, 196.0, 246.94];
const Am = [110.0, 130.81, 164.81, 220.0];
const F = [87.31, 130.81, 174.61, 220.0];
const G = [98.0, 123.47, 146.83, 196.0];
const Dm = [73.42, 146.83, 174.61, 220.0];

// Voice `v` (0 = root) of the chord the progression is on at time t.
const pickTone = (prog, bar, v) => prog.reduceRight((acc, ch, i) => `if(eq(mod(floor(t/${bar}),${prog.length}),${i}),${ch[v]},${acc})`, `${prog[0][v]}`);

const chordExpr = (prog, bar, gain, extra = '') => {
  // Each voice picks its frequency from the current bar; a slow swell keeps the pad alive.
  const voices = [0, 1, 2, 3].map((v) => `sin(2*PI*(${pickTone(prog, bar, v)})*t)`).join('+');
  return `${gain}*(${voices})*(0.75+0.25*sin(2*PI*t/${bar}))${extra}`;
};

// A plucked note with two overtones, so it sounds like an instrument rather than a bare sine; it restarts every `every` s.
const pluck = (f, every, decay, gain) => `${gain}*(sin(2*PI*(${f})*t)+0.5*sin(4*PI*(${f})*t)+0.25*sin(6*PI*(${f})*t))*exp(-${decay}*mod(t,${every}))`;
// Bright drive: 120 BPM in C major (I-V-vi-IV, one chord per 2 s bar). A kick on every beat, a hat on the off-beats,
// the root plucked an octave down on eighths, and an arpeggio of the chord two octaves up on sixteenths.
const BRIGHT = [C, G, Am, F];
const arpTone = (v) => `if(eq(mod(floor(t*8),4),0),${v(1)},if(eq(mod(floor(t*8),4),1),${v(2)},if(eq(mod(floor(t*8),4),2),${v(3)},${v(2)})))`;
const brightExpr = [
  chordExpr(BRIGHT, 2, 0.018),
  pluck(`(${pickTone(BRIGHT, 2, 0)})/2`, 0.25, 9, 0.11),
  pluck(`4*(${arpTone((v) => pickTone(BRIGHT, 2, v))})`, 0.125, 16, 0.035),
  '0.32*sin(2*PI*(45*mod(t,0.5)+90*(1-exp(-30*mod(t,0.5)))/30))*exp(-10*mod(t,0.5))',
  '0.035*(2*random(0)-1)*exp(-70*mod(t+0.25,0.5))',
].join('+');

// `beat`: seconds between the beats a cut can land on (the synthesised patterns start at t = 0).
// `cycle`: seconds of one full chord progression, so a loop that jumps back whole cycles lands on the same chord.
export const MUSIC = [
  {
    id: 'calm-pad', label: 'Calm pad · slow, warm (C–Am–F–G)', beat: 2, cycle: 16,
    expr: chordExpr([C, Am, F, G], 4, 0.06),
    filters: 'lowpass=f=1800,aecho=0.8:0.7:120|240:0.3|0.2',
  },
  {
    id: 'soft-pulse', label: 'Soft pulse · light plucks over a pad', beat: 0.5, cycle: 8,
    expr: `${chordExpr([C, G, Am, F], 2, 0.035)}+0.09*sin(2*PI*(if(eq(mod(floor(t*4),4),0),523.25,if(eq(mod(floor(t*4),4),1),659.25,if(eq(mod(floor(t*4),4),2),783.99,659.25))))*t)*exp(-7*mod(t,0.25))`,
    filters: 'lowpass=f=4000,aecho=0.8:0.6:180:0.25',
  },
  {
    id: 'steady-tech', label: 'Steady tech · even beat for software demos', beat: 0.5, cycle: 8,
    expr: `${chordExpr([Dm, F, C, G], 2, 0.03)}+0.12*sin(2*PI*55*t)*exp(-14*mod(t,0.5))+0.05*sin(2*PI*(if(lt(mod(t,1),0.5),880,1046.5))*t)*exp(-20*mod(t,0.25))`,
    filters: 'lowpass=f=5000,aecho=0.8:0.5:250:0.2',
  },
  {
    id: 'bright-drive', label: 'Bright drive · upbeat, major key, 120 BPM', beat: 0.5, cycle: 8,
    expr: brightExpr,
    filters: 'highpass=f=35,lowpass=f=9000,aecho=0.8:0.35:125:0.15',
  },
];

export const musicPath = (id) => {
  const m = MUSIC.find((x) => x.id === id);
  if (!m) throw new StudioError(`Unknown built-in track "${id}"`, 400);
  return path.join(DIR, `${m.id}.wav`);
};

/** Creates any missing built-in track (a few seconds each, once per machine). */
export async function ensureMusic() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const m of MUSIC) {
    const out = musicPath(m.id);
    if (fs.existsSync(out)) continue;
    const fade = `afade=t=in:d=2,afade=t=out:st=${SECONDS - 3}:d=3`;
    // Written aside, then renamed: a run killed half way must not leave a short track that "exists" for good.
    const tmp = `${out}.tmp.wav`;
    try {
      await ffmpeg(['-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${m.expr}':s=48000:d=${SECONDS}`, '-af', `${m.filters},${fade},loudnorm=I=-20:TP=-2`, '-ac', '2', '-ar', '48000', tmp]);
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}

/** brand.music.file is either a project asset or "library:<id>". */
export const isLibraryMusic = (file) => typeof file === 'string' && file.startsWith('library:');

// Cut sounds, synthesised the same way: seeded noise and sine sweeps shaped by fades, so every machine makes the
// same file. `peak`: seconds from the start of the sound to the moment that lands on the cut. `peakDb`: the
// sample peak the file is normalised to (a second ffmpeg pass measures and sets it).
const SFX_DIR = path.join(ROOT, 'library', 'sfx');
const SFX_TIMEOUT_MS = 30000;
export const SFX = [
  {
    id: 'whoosh', label: 'Whoosh', seconds: 0.9, peak: 0.6, peakDb: -6,
    inputs: ['anoisesrc=c=pink:seed=7:a=0.8:r=48000:d=0.9'],
    graph: '[0:a]highpass=f=300,lowpass=f=3200,afade=t=in:st=0:d=0.6:curve=exp,afade=t=out:st=0.6:d=0.3:curve=qsin[x]',
  },
  {
    id: 'hit', label: 'Hit', seconds: 0.8, peak: 0, peakDb: -4,
    // A sine that falls from 140 Hz to 50 Hz under a short noise transient.
    inputs: ["aevalsrc=exprs='sin(2*PI*(50*t+90*(1-exp(-25*t))/25))*exp(-7*t)':s=48000:d=0.8", 'anoisesrc=c=white:seed=11:a=0.5:r=48000:d=0.8'],
    graph: '[1:a]highpass=f=1500,afade=t=out:st=0:d=0.05[n];[0:a][n]amix=inputs=2:normalize=0,afade=t=in:d=0.003,afade=t=out:st=0.6:d=0.2[x]',
  },
  {
    id: 'riser', label: 'Riser', seconds: 1.2, peak: 1.2, peakDb: -8,
    // A 300 → 1500 Hz sweep and bright noise, both swelling into the cut, where the sound ends.
    inputs: ["aevalsrc=exprs='0.5*sin(2*PI*(300*t+500*t*t))*pow(t/1.2,2)':s=48000:d=1.2", 'anoisesrc=c=pink:seed=13:a=0.6:r=48000:d=1.2'],
    graph: '[1:a]highpass=f=1200,afade=t=in:st=0:d=1.2:curve=exp[n];[0:a][n]amix=inputs=2:normalize=0,afade=t=out:st=1.17:d=0.03[x]',
  },
  {
    id: 'click', label: 'Click', seconds: 0.3, peak: 0, peakDb: -9,
    inputs: ["aevalsrc=exprs='(0.6*sin(2*PI*2400*t)*exp(-180*t)+0.4*sin(2*PI*1200*t)*exp(-120*t))':s=48000:d=0.3"],
    graph: '[0:a]lowpass=f=6000,afade=t=in:d=0.001[x]',
  },
];

export const sfxPath = (id) => {
  const s = SFX.find((x) => x.id === id);
  if (!s) throw new StudioError(`Unknown cut sound "${id}"`, 400);
  return path.join(SFX_DIR, `${s.id}.wav`);
};

/** Creates any missing cut sound (mono 48 kHz, peak at its `peakDb`), once per machine. */
export async function ensureSfx() {
  fs.mkdirSync(SFX_DIR, { recursive: true });
  for (const s of SFX) {
    const out = sfxPath(s.id);
    if (fs.existsSync(out)) continue;
    const raw = `${out}.raw.wav`, tmp = `${out}.tmp.wav`;
    try {
      await ffmpeg(['-y', ...s.inputs.flatMap((i) => ['-f', 'lavfi', '-i', i]), '-filter_complex', s.graph, '-map', '[x]', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', raw], { timeoutMs: SFX_TIMEOUT_MS });
      // astats reads float samples; volumedetect would clip the raw sum at 0 dBFS first.
      const max = Number([...(await ffmpegReport(['-i', raw, '-af', 'astats=metadata=0', '-f', 'null', '-'], { timeoutMs: SFX_TIMEOUT_MS })).matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].pop()?.[1]);
      if (!Number.isFinite(max)) throw new StudioError(`Cut sound ${s.id} came out silent`);
      await ffmpeg(['-y', '-i', raw, '-af', `volume=${(s.peakDb - max).toFixed(2)}dB`, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', tmp], { timeoutMs: SFX_TIMEOUT_MS });
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(raw, { force: true });
      fs.rmSync(tmp, { force: true });
    }
  }
}
