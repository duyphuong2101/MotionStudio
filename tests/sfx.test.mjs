import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, readJson, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, loadTemplate } from '../engine/jobs.mjs';
import { validateBrand, CUT_SOUNDS, SFX_GAIN_DB } from '../engine/brand.mjs';
import { SFX, ensureSfx, sfxPath } from '../engine/library.mjs';
import { placeSound, sfxPlacements, sfxArgs, cutSound } from '../engine/sfx.mjs';
import { mixFilter, finalMixArgs, prepare, approve, render } from '../engine/pipeline.mjs';
import { musicBedPlan, sequencePlan, joinSfx } from '../engine/sequences.mjs';
import { validateScript } from '../engine/script.mjs';
import { ffmpeg, ffmpegReport } from '../engine/media.mjs';

const brand = (over) => ({
  name: 'B', colors: { primary: '#112233', primary2: '#223344', secondary: '#334455', bg: '#ffffff', ink: '#000000', muted: '#777777', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' }, ...over,
});
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];
const inputsOf = (args) => args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11';
const DUCK = 'sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1';

/* ---------- brand field ---------- */
test('brand sfx: absent or "none" is left out, so existing brands are unchanged', () => {
  assert.ok(!('sfx' in validateBrand(brand())));
  assert.ok(!('sfx' in validateBrand(brand({ sfx: { cut: 'none', gainDb: -20 } }))));
  assert.deepEqual(validateBrand(brand({ sfx: { cut: 'whoosh' } })).sfx, { cut: 'whoosh', gainDb: SFX_GAIN_DB });
  assert.deepEqual(validateBrand(brand({ sfx: { cut: 'hit', gainDb: -30 } })).sfx, { cut: 'hit', gainDb: -30 });
  assert.deepEqual(validateBrand(brand({ sfx: { cut: 'click', gainDb: 0 } })).sfx, { cut: 'click', gainDb: 0 });
});

test('brand sfx refuses an unknown sound and a level outside -30..0', () => {
  assert.throws(() => validateBrand(brand({ sfx: { cut: 'boom' } })), /sfx\.cut must be one of whoosh, hit, riser, click, none/);
  assert.throws(() => validateBrand(brand({ sfx: {} })), /sfx\.cut must be one of/);
  for (const gainDb of [-31, 1, 'loud']) assert.throws(() => validateBrand(brand({ sfx: { cut: 'hit', gainDb } })), /sfx\.gainDb must be -30\.\.0/, String(gainDb));
});

test('the brand list of cut sounds is the library plus none', () => {
  assert.deepEqual(CUT_SOUNDS, [...SFX.map((s) => s.id), 'none']);
});

/* ---------- placement ---------- */
const timing = { duration: 12, scenes: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 8.5 }, { id: 'c', start: 8.5, end: 12 }] };
const peakOf = (id) => SFX.find((s) => s.id === id).peak;

test('a whoosh peaks on the cut, a riser ends on it, a hit and a click start on it', () => {
  const w = placeSound('whoosh', 4);
  assert.equal(w.at + peakOf('whoosh'), 4);
  assert.ok(peakOf('whoosh') > 0 && peakOf('whoosh') < SFX.find((s) => s.id === 'whoosh').seconds, 'the whoosh decays after the cut');
  const r = placeSound('riser', 4);
  assert.equal(r.at + SFX.find((s) => s.id === 'riser').seconds, 4, 'the riser ends on the cut');
  assert.equal(placeSound('hit', 4).at, 4);
  assert.equal(placeSound('click', 4).at, 4);
  assert.equal(placeSound('none', 4), null);
  for (const s of SFX) assert.ok(s.seconds >= 0.3 && s.seconds <= 1.2, `${s.id} is ${s.seconds} s`);
});

test('a run-up longer than the time before the cut loses its head, so the peak still lands on the cut', () => {
  const r = placeSound('riser', 0.5);
  assert.deepEqual(r, { sound: 'riser', cut: 0.5, at: 0, skip: 0.7 });
});

test('cut sounds go on every scene start but the first; a scene sfx overrides the brand', () => {
  const script = { scenes: [{ id: 'a', sfx: 'riser' }, { id: 'b' }, { id: 'c', sfx: 'hit' }] };
  const p = sfxPlacements(script, timing, { cut: 'whoosh', gainDb: -12 });
  assert.deepEqual(p.map((x) => [x.scene, x.sound, x.cut]), [['b', 'whoosh', 4], ['c', 'hit', 8.5]], 'no sound on the first scene, even with its own sfx');
  assert.deepEqual(sfxPlacements({ scenes: [{ id: 'a' }, { id: 'b', sfx: 'none' }, { id: 'c' }] }, timing, { cut: 'click' }).map((x) => x.scene), ['c'], 'none silences one cut');
  assert.deepEqual(sfxPlacements({ scenes: [{ id: 'a' }, { id: 'b' }, { id: 'c', sfx: 'hit' }] }, timing, undefined).map((x) => x.scene), ['c'], 'a scene picks a sound without a brand one');
  assert.deepEqual(sfxPlacements({ scenes: [] }, timing, undefined), [], 'no brand sound, no scene sound: nothing');
  assert.equal(cutSound(undefined, undefined), 'none');
});

test('a scene sfx must be one of the cut sounds', () => {
  const { beats } = loadTemplate('explainer');
  const scenes = (sfx) => [{ id: 't', kind: 'title', vo: 'Hello there.', title: 'Hi', sfx }, { id: 's', kind: 'step', vo: 'Step one.', title: 'One', icon: 'chat', source: 'bullets[0]', sfx }];
  const ok = validateScript({ scenes: scenes('hit') }, beats);
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => w.includes('sfx')), 'sfx is a field the explainer knows');
  assert.ok(validateScript({ scenes: scenes('boom') }, beats).errors.some((e) => e.includes('sfx must be whoosh|hit|riser|click|none')));
});

test('sfx.wav args: one library input per sound, delayed to its place, at the brand level', () => {
  const p = [placeSound('whoosh', 4), placeSound('riser', 0.5)];
  const args = sfxArgs(p, 12, -12, 'sfx.wav');
  assert.deepEqual(inputsOf(args), [sfxPath('whoosh'), sfxPath('riser')]);
  assert.equal(graphOf(args), '[0:a]aresample=48000,adelay=3400:all=1[f0];[1:a]aresample=48000,atrim=start=0.7,asetpts=PTS-STARTPTS,adelay=0:all=1[f1];'
    + '[f0][f1]amix=inputs=2:duration=longest:normalize=0,volume=-12dB,apad,atrim=0:12.000[out]');
  assert.deepEqual(args.slice(-7), ['-map', '[out]', '-ac', '1', '-ar', '48000', 'sfx.wav']);
  assert.equal(graphOf(sfxArgs([placeSound('hit', 4)], 12, -6, 'o.wav')), '[0:a]aresample=48000,adelay=4000:all=1[f0];[f0]volume=-6dB,apad,atrim=0:12.000[out]');
});

/* ---------- final mix ---------- */
const music = { music: { file: 'm.wav', gainDb: -18, duck: true } };
const base = { video: 'video.mp4', final: 'final.mp4', duration: 12.34 };
const tail = ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', '12.340', '-movflags', '+faststart', 'final.mp4'];

test('without sfx.wav the final mix args are the ones every render used before', () => {
  const ducked = finalMixArgs({ ...base, brand: music, speech: ['voice.wav'], music: 'm.wav' });
  assert.deepEqual(ducked.args, ['-y', '-i', 'video.mp4', '-i', 'voice.wav', '-i', 'm.wav', '-filter_complex',
    `[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[s1];[s1]anull[v];[2:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:12.340,volume=-14.99dB,afade=t=out:st=10.840:d=1.5[m];[v]asplit=2[vm][vk];[m][vk]${DUCK}[md];[vm][md]amix=inputs=2:duration=first:normalize=0,${LOUDNORM}[a]`, ...tail]);
  assert.equal(ducked.label, 'voice+music');
  const two = finalMixArgs({ ...base, brand: {}, speech: ['voice.wav', 'footage.wav'] });
  assert.deepEqual(two.args, ['-y', '-i', 'video.mp4', '-i', 'voice.wav', '-i', 'footage.wav', '-filter_complex',
    `[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[s1];[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[s2];[s1][s2]amix=inputs=2:duration=first:normalize=0[v];[v]${LOUDNORM}[a]`, ...tail]);
  assert.equal(two.label, 'voice+footage');
  const flat = finalMixArgs({ ...base, brand: { music: { file: 'm.wav', gainDb: -20 } }, music: 'm.wav' });
  assert.equal(graphOf(flat.args), `[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:12.340,volume=-16.99dB,afade=t=out:st=10.840:d=1.5[m];[m]${LOUDNORM}[a]`);
  assert.equal(flat.label, 'music');
  assert.deepEqual(finalMixArgs({ ...base, brand: {} }), { label: 'silent', args: ['-y', '-i', 'video.mp4', '-f', 'lavfi', '-t', '12.340', '-i', 'anullsrc=r=48000:cl=stereo',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', '12.340', '-movflags', '+faststart', 'final.mp4'] });
});

test('sfx.wav joins the final mix after the duck: it never dips the music and is never the sidechain', () => {
  const { args, label } = finalMixArgs({ ...base, brand: music, speech: ['voice.wav'], sfx: ['sfx.wav'], music: 'm.wav' });
  assert.deepEqual(inputsOf(args), ['video.mp4', 'voice.wav', 'sfx.wav', 'm.wav'], 'cut sounds after the speech, before the music');
  assert.equal(graphOf(args), '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[s1];[s1]anull[v];[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[e0];[e0]anull[fx];'
    + `[3:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:12.340,volume=-14.99dB,afade=t=out:st=10.840:d=1.5[m];[v]asplit=2[vm][vk];[m][vk]${DUCK}[md];[vm][md][fx]amix=inputs=3:duration=first:normalize=0,${LOUDNORM}[a]`);
  assert.equal(label, 'voice+sfx+music');
  assert.equal(graphOf(finalMixArgs({ ...base, brand: {}, speech: ['voice.wav'], sfx: ['sfx.wav'] }).args),
    `[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[s1];[s1]anull[v];[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[e0];[e0]anull[fx];[v][fx]amix=inputs=2:duration=first:normalize=0,${LOUDNORM}[a]`);
  const alone = finalMixArgs({ ...base, brand: {}, sfx: ['sfx.wav'] });
  assert.equal(graphOf(alone.args), '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:12.340[e0];[e0]anull[fx];[fx]anull[a]', 'cut sounds alone are not lifted by loudnorm');
  assert.equal(alone.label, 'sfx');
});

/* ---------- sequence music bed ---------- */
test('a music bed lays each part sfx.wav and the join sounds at their offsets, before the looped music', () => {
  const speech = [{ file: 'a/voice.wav', start: 0 }, { file: 'b/voice.wav', start: 66.6 }];
  const sfx = [{ file: 'a/sfx.wav', start: 0 }, { file: 'b/sfx.wav', start: 66.6 }, { file: 'joins.wav', start: 0 }];
  const args = musicBedPlan({ video: 'j.mp4', speech, sfx, music: 'calm-pad.wav', musicSeconds: 120, cycle: 16, duration: 200, duck: true, out: 'o.mp4' });
  assert.deepEqual(inputsOf(args), ['j.mp4', 'a/voice.wav', 'b/voice.wav', 'a/sfx.wav', 'b/sfx.wav', 'joins.wav', 'calm-pad.wav', 'calm-pad.wav']);
  const g = graphOf(args);
  assert.ok(g.includes('[3:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0:all=1,apad,atrim=0:200.000[e0];[4:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=66600:all=1,apad,atrim=0:200.000[e1];'
    + '[5:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=0:all=1,apad,atrim=0:200.000[e2];[e0][e1][e2]amix=inputs=3:duration=first:normalize=0[fx]'), g);
  assert.ok(g.includes('[6:a]aresample=48000,atrim=0:116.000[c0];[7:a]aresample=48000,atrim=start=2.000'), 'the loop reads the music inputs after the cut sounds');
  assert.ok(g.endsWith(`[vm][md][fx]amix=inputs=3:duration=first:normalize=0,${LOUDNORM}[a]`));
  const without = musicBedPlan({ video: 'j.mp4', speech, music: 'calm-pad.wav', musicSeconds: 120, cycle: 16, duration: 200, duck: true, out: 'o.mp4' });
  assert.ok(!graphOf(without).includes('[fx]'), 'no cut sounds: the bed graph is unchanged');
});

test('join sounds land mid-transition (on the join for a cut); a part opening on sfx "none" has none', (t) => {
  const P = 'zz-test-sfx-joins';
  t.after(() => fs.rmSync(path.join(DIRS.out, P), { recursive: true, force: true }));
  for (const [id, first] of [['one', {}], ['two', {}], ['three', { sfx: 'none' }], ['four', { sfx: 'riser' }]]) {
    fs.mkdirSync(path.join(DIRS.out, P, id), { recursive: true });
    writeJson(jobFile(P, id, 'script.json'), { scenes: [{ id: 'x', kind: 'title', ...first }] });
  }
  const parts = [10, 6, 6, 6].map((d, i) => ({ id: ['one', 'two', 'three', 'four'][i], file: 'f.mp4', duration: d, hasAudio: true }));
  const plan = sequencePlan({ parts, transition: 'cut', transitions: ['fade', 'cut', 'cut'], fps: 30, crf: 18, size: { width: 1920, height: 1080 }, out: 'o.mp4' });
  const joins = joinSfx(P, parts, plan, { cut: 'hit', gainDb: -12 });
  assert.deepEqual(joins.map((j) => [j.part, j.sound, j.cut]), [['two', 'hit', 9.8], ['four', 'riser', 21.6]]);
  assert.deepEqual(joinSfx(P, parts, plan, undefined).map((j) => j.part), ['four'], 'only the part that asks for one without a brand sound');
});

/* ---------- real ffmpeg ---------- */
test('the library sounds are mono 48 kHz, short, under -3 dBFS, and the whoosh peaks where it says', { timeout: 120000 }, async () => {
  await ensureSfx();
  for (const s of SFX) {
    const rep = await ffmpegReport(['-i', sfxPath(s.id), '-af', 'astats=metadata=0', '-f', 'null', '-'], { timeoutMs: 30000 });
    assert.match(rep, /48000 Hz, mono/, s.id);
    const peak = Number([...rep.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].pop()[1]);
    assert.ok(peak <= -3 && peak > -20, `${s.id} peaks at ${peak} dBFS`);
    const len = Number(/Duration: 00:00:(\d+\.\d+)/.exec(rep)[1]);
    assert.ok(Math.abs(len - s.seconds) < 0.03, `${s.id} lasts ${len}`);
  }
  const buf = fs.readFileSync(sfxPath('whoosh'));
  const at = buf.indexOf('data') + 8, n = (buf.length - at) / 2;
  let max = 0, where = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(buf.readInt16LE(at + i * 2)); if (v > max) { max = v; where = i / 48000; } }
  assert.ok(Math.abs(where - peakOf('whoosh')) < 0.15, `whoosh peak at ${where.toFixed(3)} s`);
});

/** Peak (dBFS) of a mono 48 kHz s16 WAV between `a` and `b` seconds. */
const windowPeak = (buf, a, b) => {
  const at = buf.indexOf('data') + 8;
  let max = 0;
  for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) max = Math.max(max, Math.abs(buf.readInt16LE(at + i * 2)));
  return 20 * Math.log10(Math.max(1, max) / 32768);
};

// Real Chrome + ffmpeg: three explainer scenes, no voice and no music, the brand's cut sound a hit.
test('a rendered 3-scene job has its hit at the two cuts and nothing at the start', { timeout: 300000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-sfx-e2e', ID = 'cuts-1x1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sfx-'));
  t.after(() => {
    ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  createProject({ id: P, name: 'Sfx Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 }, sfx: { cut: 'hit', gainDb: -6 } });
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '1:1', duration: 30, message: 'm' }));
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Sfx Test', url: '', bullets: [{ text: 'It has steps.', ref: 'brief' }] });
  writeJson(jobFile(P, ID, 'script.json'), { lang: 'en', scenes: [
    { id: 'open', kind: 'title', vo: 'How it works.', title: 'How it works' },
    { id: 'how', kind: 'step', vo: 'First you ask.', title: 'Ask', icon: 'chat', source: 'bullets[0]' },
    { id: 'go', kind: 'cta', vo: 'Try it today.', title: 'Try it', button: 'Start' },
  ] });
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  const st = await prepare(P, ID, 'test');
  assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
  const tm = readJson(jobFile(P, ID, 'timing.json'));
  const cuts = tm.scenes.slice(1).map((s) => s.start);
  assert.deepEqual(tm.sfx.cuts.map((c) => [c.scene, c.sound, c.cut]), [['how', 'hit', cuts[0]], ['go', 'hit', cuts[1]]]);
  assert.ok(fs.existsSync(jobFile(P, ID, 'sfx.wav')));
  approve(P, ID, 'test');
  const done = await render(P, ID, 'test');
  assert.equal(done.outputs.audio, 'sfx');
  const wav = path.join(dir, 'final.wav');
  await ffmpeg(['-y', '-i', jobFile(P, ID, 'final.mp4'), '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60000 });
  const buf = fs.readFileSync(wav);
  for (const c of cuts) {
    const hit = windowPeak(buf, c, c + 0.15), before = windowPeak(buf, c - 0.6, c - 0.1);
    assert.ok(hit > -16, `hit at ${c} s peaks at ${hit.toFixed(1)} dBFS`);
    assert.ok(hit - before > 30, `quiet before the cut at ${c} s (${before.toFixed(1)} dBFS)`);
  }
  assert.ok(windowPeak(buf, 0, 0.8) < -60, 'no sound at the start of the video');
});
