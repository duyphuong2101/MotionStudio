import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, StudioError, readJson, writeJson, exists, loadStudioConfig, round,
} from './core.mjs';
import {
  loadBrief, loadBrand, loadBriefTemplate, listAssets, assetPath, getStatus, setStatus, jobDir, jobFile,
  mergeRespectingLocks, commitBase, PLATFORMS, cutSlug,
} from './jobs.mjs';
import { iconsFor, loadBrandIcons } from './icons.mjs';
import { motionProfile } from './brand.mjs';
import { assertValidScript, validateSource, wordsOf, draftScenes, assertNoDrafts, sourceRefProblems } from './script.mjs';
import { repairScript } from './repair.mjs';
import { lookBrand, BRAND_LOOK } from './looks.mjs';
import { validateOutline, expandOutline } from './quick.mjs';
import { estimateTiming, toSrt, sceneGaps, resolvePace } from './timing.mjs';
import { buildMixed } from './mix.mjs';
import { ttsProvider, speakScript, voiceFor, voiceProblem, sapiCulture, sameLanguage } from './tts.mjs';
import { brandAssets } from '../templates/shared.mjs';
import { ensureMusic, musicPath, isLibraryMusic, MUSIC } from './library.mjs';
import { detectBeats, beatSnap } from './beats.mjs';
import { ffmpeg, openComposition, lintInPage, probeMedia, mediaTimeoutMs, BT709_VF, BT709_TAGS } from './media.mjs';
import { renderFrames, renderWorkers, openWorkers, cutClipFrames, CLIP_FPS, CLIP_FRAMES_DIR } from './frames.mjs';
import { playCheck, freshLoad, PLAY_DEFAULTS } from './playcheck.mjs';
import { pacing, sheetShots, cutShots, writeSheet, writeCutSheet, REVIEW_DIR, SHEET, CUT_SHEET, PACING } from './review.mjs';
import { runQa } from './qa.mjs';
import { buildHtmlVideo } from './htmlvideo.mjs';
import { clipWords, sttStatus, decode, speechOnset } from './stt.mjs';
import { clipGains } from './loudness.mjs';
import { recordedVoice } from './voicetake.mjs';
import { jobSfx, SFX_FILE } from './sfx.mjs';
import { copyThree, copyLottie, copyGsap } from './vendor.mjs';
// sequences.mjs imports this module too; loopMusic is only called at run time, so the cycle is safe.
import { loopMusic } from './sequences.mjs';

/** Frame size for this brief: a multi-format template lists one size per format. */
export function sizeFor(beats, format) {
  const s = beats.sizes?.[format];
  if (s) return { width: s[0], height: s[1] };
  return beats.size || { width: 1080, height: 1920 };
}

const DIRECTOR_PICKABLE = ['queued', 'dirty', 'error', 'scripting', 'scripted', 'awaiting_review'];

function requireStatus(st, allowed, action) {
  if (!allowed.includes(st.status)) throw new StudioError(`Cannot ${action} while the job is "${st.status}". Allowed from: ${allowed.join(', ')}`, 409);
}

/* ---------- step 2: director claims a job ---------- */
export function claim(project, id, by) {
  loadBrief(project, id);
  const st = getStatus(project, id);
  requireStatus(st, DIRECTOR_PICKABLE, 'claim');
  fs.mkdirSync(jobDir(project, id), { recursive: true });
  return setStatus(project, id, { status: 'scripting', step: 3, error: null, failed: null }, `claimed by director`, by);
}

// The Director may stop a job it cannot do, but only before a storyboard a person reviews or a render exists.
const FAILABLE = ['queued', 'scripting', 'scripted', 'dirty'];
const MAX_REASON = 300;

/** The Director's way to put a job into error with a reason, instead of editing status.json. */
export function fail(project, id, reason, by) {
  loadBrief(project, id);
  const text = String(reason ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, MAX_REASON);
  if (!text) throw new StudioError('Give the reason: --reason "<what is wrong and how to fix it>"', 400);
  requireStatus(getStatus(project, id), FAILABLE, 'fail');
  return setStatus(project, id, { status: 'error', error: text, failed: null }, `failed by director: ${text}`, by);
}

const COMMIT_BUSY = ['preparing', 'rendering'];
const COMMIT_APPROVED = ['approved', 'done'];
// After a storyboard (awaiting_review, or error from its lint) the Director commits a fix it wrote since.
const COMMIT_AFTER_STORYBOARD = ['awaiting_review', 'error'];

/**
 * Refuses a commit that would replace a storyboard a person is working with: a running prepare or render, an
 * approved or rendered job, a job whose render failed (its approval still holds), a draft older than the storyboard
 * it would replace (`storyboardMs`: when index.html was written, null without one), and a script draft written for
 * another template than the brief's.
 */
export function assertCommittable(st, { kind, draft, draftMs, template, storyboardMs = null }) {
  if (COMMIT_BUSY.includes(st.status)) throw new StudioError(`Cannot commit while the job is "${st.status}". Wait for it to finish.`, 409);
  if (COMMIT_APPROVED.includes(st.status)) throw new StudioError(`The storyboard is ${st.status === 'done' ? 'rendered' : 'approved'}: a commit would drop the approval. Edit the job in the UI to send it back to the Director.`, 409);
  if (st.status === 'error' && st.failed === 'render') throw new StudioError('The render failed but the storyboard is still approved: retry the render, or click Run Director to rewrite the job.', 409);
  // Not status.updatedAt: every status write moves it, so a draft finished just before a timeout would look stale.
  if (COMMIT_AFTER_STORYBOARD.includes(st.status) && storyboardMs !== null && draftMs < storyboardMs) {
    throw new StudioError(`${kind}.draft.json is older than the current storyboard: write the draft again, then commit.`, 409);
  }
  if (kind === 'script' && typeof draft?.template === 'string' && draft.template !== template) {
    throw new StudioError(`script.draft.json was written for template "${draft.template}", the brief now uses "${template}": write a new script.`, 409);
  }
}

/** Quick mode: the outline checked against the template's `quick` block and the job's source, then expanded. */
function outlineScript(project, id, brief, beats, outline, icons) {
  if (brief.mix?.length) throw new StudioError('Quick mode does not take a mix: write script.draft.json instead.', 400);
  const source = readJson(jobFile(project, id, 'source.json'), null);
  const { errors, warnings } = validateOutline(outline, beats, { source });
  if (errors.length) throw new StudioError(`Outline invalid:\n- ${errors.join('\n- ')}`, 400);
  const { script, notes } = expandOutline(outline, beats, { icons, brandIcons: Object.keys(loadBrandIcons(project)), source, assets: listAssets(project) });
  return { script, warnings, notes };
}

/* ---------- steps 3-4: director commits drafts; human locks survive ---------- */
export function commit(project, id, kind, by) {
  if (!['source', 'script', 'outline'].includes(kind)) throw new StudioError('kind must be source, script or outline', 400);
  // An outline (quick mode) is expanded into a script draft, then committed like any script.
  const target = kind === 'source' ? 'source' : 'script';
  const draftFile = jobFile(project, id, `${kind}.draft.json`);
  const finalFile = jobFile(project, id, `${target}.json`);
  const draft = readJson(draftFile);
  const page = jobFile(project, id, 'index.html');
  const brief = loadBrief(project, id);
  assertCommittable(getStatus(project, id), {
    kind, draft, draftMs: fs.statSync(draftFile).mtimeMs, template: brief.template,
    storyboardMs: exists(page) ? fs.statSync(page).mtimeMs : null,
  });
  const existing = commitBase(project, id, target);
  let doc, kept, repairs = [], quick = null;
  if (kind === 'source') {
    ({ doc, kept } = mergeRespectingLocks(kind, existing, draft));
    const errs = validateSource(doc, { assets: listAssets(project) });
    if (errs.length) throw new StudioError(`source invalid:\n- ${errs.join('\n- ')}`, 400);
  } else {
    const { beats } = loadBriefTemplate(brief);
    const icons = Object.keys(iconsFor(project));
    if (kind === 'outline') quick = outlineScript(project, id, brief, beats, draft, icons);
    const src = quick ? quick.script : draft;
    // The repairs and the merge read every scene: a null or a list in the draft is a refusal that says so, not a crash.
    const bad = Array.isArray(src?.scenes) ? src.scenes.findIndex((s) => !s || typeof s !== 'object' || Array.isArray(s)) : 0;
    if (bad >= 0) throw new StudioError(Array.isArray(src?.scenes) ? `script.draft.json: scenes[${bad}] must be an object (a scene)` : 'script.draft.json: scenes must be a list', 400);
    // Mechanical fixes first, on the draft only: the merge then restores every locked field as the person left it.
    const fixed = repairScript(src, beats, { icons, existing });
    repairs = fixed.repairs;
    ({ doc, kept } = mergeRespectingLocks(target, existing, fixed.doc));
    try {
      assertValidScript(doc, beats, { assets: listAssets(project), icons, source: readJson(jobFile(project, id, 'source.json'), null), brief });
      const left = draftScenes(doc).map((s) => s.id);
      if (left.length) throw new StudioError(`Draft scene(s) not filled: ${left.join(', ')}. Fill each one and remove its "draft" key, then commit again.`, 400);
    } catch (err) {
      // The errors may name a repaired id or icon, so say what was repaired; the draft file itself is unchanged.
      if (err instanceof StudioError && repairs.length) err.message += `\nRepaired before this check (fix these in the draft too):\n- ${repairs.join('\n- ')}`;
      throw err;
    }
  }
  writeJson(finalFile, doc);
  // The outline is kept only once the script made from it is written.
  if (quick) writeJson(jobFile(project, id, 'outline.json'), draft);
  fs.unlinkSync(draftFile);
  const patch = target === 'script'
    ? { status: 'scripted', step: 5, dirty_from: null, error: null, failed: null }
    : { status: 'scripting', step: 4, error: null, failed: null };
  const what = quick ? `script.json committed from outline (quick mode), look ${doc.look ?? BRAND_LOOK}` : `${kind}.json committed`;
  const warned = quick?.warnings.length ? `, warnings: ${quick.warnings.join('; ')}` : '';
  const event = `${what}${kept.length ? `, kept locked: ${kept.join(', ')}` : ''}${repairs.length ? `, repaired: ${repairs.join('; ')}` : ''}${warned}`;
  setStatus(project, id, patch, event, by);
  return quick ? { kept, repairs, warnings: quick.warnings, notes: quick.notes } : { kept, repairs };
}

/** The brand a job's video uses: the project brand with the script's look laid over it (engine/looks.mjs). */
const jobBrand = (project, script) => lookBrand(script?.look, loadBrand(project));

/* ---------- steps 5-7: timing, compose, stills + lint ---------- */
export async function prepare(project, id, by = 'engine') {
  const cfg = loadStudioConfig();
  const st = getStatus(project, id);
  requireStatus(st, ['scripted', 'dirty', 'awaiting_review', 'error'], 'prepare');
  assertNoDrafts(readJson(jobFile(project, id, 'script.json'), null));
  // Whatever the status: a Director run that failed or stopped leaves the job in error with the mark still set,
  // and only a script commit or a finished prepare clears it.
  if (st.dirty_from && st.dirty_from < 5) {
    throw new StudioError(`This job changed at step ${st.dirty_from}; the director has to run first (Run Director or /studio run).`, 409);
  }
  const brief = loadBrief(project, id);
  const brandFile = loadBrand(project);
  const script = readJson(jobFile(project, id, 'script.json'));
  // This video's brand: the script's look under what the brand sets, then the brief's language and voice on top.
  const brand = { ...lookBrand(script.look, brandFile), voice: voiceFor(brandFile, brief) };
  // A recorded take replaces the TTS voice, so the TTS voice's language limits do not apply.
  const problem = brief.voiceTake ? null : voiceProblem(brand.voice);
  if (problem) throw new StudioError(problem, 400);
  const { dir: tplDir, beats } = loadBriefTemplate(brief);
  const source = readJson(jobFile(project, id, 'source.json'));
  const icons = iconsFor(project);
  const { warnings } = assertValidScript(script, beats, { assets: listAssets(project), icons: Object.keys(icons) });
  // A commit refuses these; here they only warn, so a job whose source.json changed since its script still opens.
  warnings.push(...sourceRefProblems(script, source, brief));

  setStatus(project, id, { status: 'preparing', step: 5, error: null, failed: null, lint: null, outputs: null, approvedBy: null }, 'prepare started', by);
  try {
    // A new storyboard makes any earlier render stale.
    const dir0 = jobDir(project, id);
    fs.mkdirSync(dir0, { recursive: true });
    for (const f of fs.readdirSync(dir0)) {
      if (STALE_RE.test(f)) fs.unlinkSync(path.join(dir0, f));
    }
    fs.rmSync(path.join(dir0, REVIEW_DIR), { recursive: true, force: true });
    const size = sizeFor(beats, brief.format);
    const footage = beats.audio === 'footage';
    const clips = footage ? await footageClips(project, script, beats.footage || 'video') : await sceneVideos(project, script, beats);
    // A clip with sound and no typed text gets its words from local speech recognition, with real timings.
    // Motion scenes do the same for a clip that plays its own sound with no voice line over it.
    const heard = sttStatus().available ? clips.filter((c) => c.hasAudio && !c.text && (footage || c.caption)) : [];
    for (const c of heard) {
      c.words = await clipWords(project, c.asset, c.from, c.seconds, { lang: brand.voice.lang, cacheDir: jobFile(project, id, 'stt') });
      if (c.words.length) c.words = startOnSpeech(c.words, speechOnset(await decode(c.file, c.from, c.seconds)));
      c.text = c.words.map((w) => w.w).join(' ');
    }
    // A typed caption wins over what was heard; without speech recognition it is spread over the clip.
    for (const c of clips.filter((x) => x.typed)) {
      c.words = typedWords(c.typed, c.words || [], c.seconds);
      c.text = c.typed;
    }
    // Footage clips set their scene's length; a motion scene's clip does only when it plays its own sound.
    const timed = clips.filter((c) => footage || c.hasAudio);
    // A scene's `hold` comes on top in the timing (engine/timing.mjs `sceneHold`), after the clip or the line, whichever ends later.
    const fixed = timed.length ? Object.fromEntries(timed.map((c) => [c.id, c.seconds])) : null;
    const tts = ttsProvider(brand);
    const beat = brief.cutOnBeat ? await musicBeat(project, brand) : null;
    const snap = beat?.grid ? beatSnap(beat.grid) : null;
    // A tight motion profile (cinematic and others) cuts close around each line instead of leaving a pause on both sides.
    const tight = motionProfile(brand).tight;
    const take = brief.voiceTake ? await recordedVoice(project, jobDir(project, id), brief.voiceTake, script, { lang: brand.voice.lang, opts: { ...cfg.voiceTake, cleanup: brand.voice.cleanup === true } }) : null;
    const timeScript = (lengths) => (take || tts.available
      ? speakScript(jobDir(project, id), script, brand, cfg.timing, beats.pace || null, lengths, snap, tight, take)
      : estimateTiming(script, cfg.timing, script.lang || brand.voice.lang, beats.pace || null, lengths, snap, tight));
    let timing = await timeScript(fixed);
    // A motion clip with sound and a voice line: when the line outlasts the clip, the scene holds the clip's last frame.
    const held = footage ? null : voiceHolds(timing, fixed, script, { cfg: cfg.timing, pace: beats.pace || null, tight });
    if (held) timing = await timeScript(held);
    if (beat?.grid) timing.beat = beat.grid;
    if (clips.length) {
      const voiceWords = timing.words.slice();
      if (footage) captionClips(timing, clips);
      else {
        timing.videos = clips.map(({ id: cid, seconds, hasAudio }) => ({ id: cid, seconds, sound: hasAudio }));
        heardWords(timing, clips.filter((c) => c.caption && c.words?.length));
      }
      await matchLoudness(jobDir(project, id), clips, timing, voiceWords, cfg.loudness);
      await cutClips(jobDir(project, id), clips, timing, size);
      if (beats.levels) await clipLevels(clips, timing);
    }
    const sfx = await jobSfx(jobDir(project, id), script, timing, brand.sfx);
    if (sfx) timing.sfx = sfx;
    writeJson(jobFile(project, id, 'timing.json'), timing);
    writeJson(jobFile(project, id, 'words.json'), timing.words);
    fs.writeFileSync(jobFile(project, id, 'captions.srt'), toSrt(timing, script), 'utf8');
    const pace = pacing(timing, script, cfg.review);
    writeJson(jobFile(project, id, PACING), pace);

    setStatus(project, id, { step: 6 }, `timing ${timing.source}: ${timing.duration}s`, by);
    const dir = jobDir(project, id);
    copyGsap(dir);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    const used = new Set(brandAssets(brand));
    for (const sc of script.scenes) {
      if (sc.asset) used.add(sc.asset);
      if (sc.image) used.add(sc.image);
      if (sc.model) used.add(sc.model);
      if (sc.lottie) used.add(sc.lottie);
      for (const sh of sc.shots || []) used.add(sh.asset);
      for (const p of Array.isArray(sc.photos) ? sc.photos : []) if (p?.asset) used.add(p.asset);
    }
    // Footage is cut into clips/ above; the source files stay out of the job folder.
    for (const a of used) if (!VIDEO_RE.test(a) && !AUDIO_RE.test(a)) fs.copyFileSync(assetPath(project, a), path.join(dir, 'assets', a));
    const page = async (format, sz) => {
      const args = { brief: { ...brief, format }, brand, script, timing, size: sz, icons };
      return beats.mixed ? buildMixed(args, beats) : (await import(pathToFileURL(path.join(tplDir, 'template.mjs')).href)).build(args);
    };
    fs.writeFileSync(path.join(dir, 'index.html'), await page(brief.format, size), 'utf8');
    if (script.scenes.some((sc) => sc.model)) copyThree(dir);
    if (script.scenes.some((sc) => sc.lottie)) copyLottie(dir);
    // Extra cuts: the same script and timing laid out at each other size, one page each.
    const cuts = [];
    for (const format of brief.alsoFormats || []) {
      const slug = cutSlug(format);
      fs.writeFileSync(path.join(dir, `index-${slug}.html`), await page(format, sizeFor(beats, format)), 'utf8');
      cuts.push({ format, slug, page: `index-${slug}.html`, ...sizeFor(beats, format) });
    }

    setStatus(project, id, { step: 7 }, 'composition written', by);
    const findings = warnings.map((w) => ({ level: 'warning', el: 'script', msg: w }));
    if (!take && !tts.available) findings.push({ level: 'warning', el: 'voice', msg: `No voice-over: ${tts.reason}. Timing is estimated from word count.` });
    for (const f of timing.footage || []) if (f.heard) findings.push({ level: 'warning', el: 'captions', scene: f.id, msg: 'captions come from speech recognition: read them before you approve, or type the clip text to replace them' });
    if (beat && !beat.grid) findings.push({ level: 'warning', el: 'music', msg: `Cut on the beat is on, but ${beat.reason}; scenes keep their own length` });
    if (!take && tts.available && tts.name === 'sapi') {
      const culture = await sapiCulture(timing.voice);
      if (culture && !sameLanguage(culture, brand.voice.lang)) findings.push({ level: 'warning', el: 'voice', msg: `Voice ${timing.voice} speaks ${culture}, the video language is ${brand.voice.lang}` });
    }
    if (script.lang && !sameLanguage(script.lang, brand.voice.lang)) findings.push({ level: 'warning', el: 'script', msg: `script is written in ${script.lang}, the video language is ${brand.voice.lang}` });
    findings.push(...lengthFindings(timing.duration, brief.duration, cfg.timing));
    const { oneScene } = motionProfile(brand);
    const stills = await captureStills(dir, cfg, findings, size, { oneScene, sheet: pace.scenes });
    for (const c of cuts) {
      const own = [];
      c.stills = await captureStills(dir, cfg, own, c, { page: c.page, sub: c.slug, oneScene });
      for (const f of own) findings.push({ ...f, cut: c.format, el: `${c.format} ${f.el}` });
    }
    const errors = findings.filter((f) => f.level === 'error').length;
    const lint = { errors, warnings: findings.length - errors, findings };
    if (errors) {
      return setStatus(project, id, { status: 'error', step: 7, lint, stills, cuts, duration: timing.duration, error: `${errors} lint error(s): the director should fix script.json and run prepare again` }, 'lint failed', by);
    }
    return setStatus(project, id, { status: 'awaiting_review', step: 8, lint, stills, cuts, duration: timing.duration, dirty_from: null }, 'storyboard ready for review', by);
  } catch (err) {
    setStatus(project, id, { status: 'error', error: err.message }, `prepare failed`, by);
    throw err;
  }
}

const VIDEO_RE = /\.(mp4|webm|mov)$/i;
// A video shorter than this share of the brief's length gets a review warning.
const MIN_LENGTH_SHARE = 0.75;

/** Review findings on the video's length against the brief's: over by more than `maxOverrun` is an error, short a warning. */
export function lengthFindings(duration, target, timingCfg) {
  if (!(target > 0)) return [];
  if (duration > target * (1 + timingCfg.maxOverrun)) return [{ level: 'error', el: 'script', msg: `video is ${duration}s, brief asks ${target}s: shorten the voice lines` }];
  if (duration < target * MIN_LENGTH_SHARE) return [{ level: 'warning', el: 'script', msg: `video is ${duration}s, brief asks ${target}s: lengthen the voice lines or add a scene` }];
  return [];
}

/**
 * Scene lengths when a voice line outlasts the clip with sound that fixes its scene (`fixed`, clip seconds by scene
 * id): that scene grows to the line's last word plus its tail (its `hold` comes on top in the timing). The kit holds a clip's last frame while its scene runs
 * on, and the clip's sound plays once from the scene start. Null when every line fits its clip.
 */
export function voiceHolds(timing, fixed, script, { cfg, pace = null, tight = false }) {
  if (!fixed) return null;
  const out = { ...fixed };
  let grew = false;
  script.scenes.forEach((sc, i) => {
    if (fixed[sc.id] === undefined || !String(sc.vo || '').trim()) return;
    const t = timing.scenes.find((s) => s.id === sc.id);
    const said = timing.words.filter((w) => w.scene === sc.id);
    if (!t || !said.length) return;
    const { tail } = sceneGaps(cfg, resolvePace(pace, sc), i === script.scenes.length - 1, tight);
    const need = round(said[said.length - 1].end + tail - t.start, 3);
    if (need > fixed[sc.id]) { out[sc.id] = need; grew = true; }
  });
  return grew ? out : null;
}

/** The brand track's beat grid for cutting on the beat: known for built-in tracks, detected for uploads. */
async function musicBeat(project, brand) {
  const file = brand.music?.file;
  if (!file) return { grid: null, reason: 'the brand has no background music' };
  if (isLibraryMusic(file)) {
    const m = MUSIC.find((x) => x.id === file.slice(8));
    return m?.beat ? { grid: { period: m.beat, offset: 0, bpm: Math.round(60 / m.beat), source: 'built-in' } } : { grid: null, reason: `${file} has no beat` };
  }
  const grid = await detectBeats(assetPath(project, file));
  return grid ? { grid } : { grid: null, reason: `no steady beat was found in ${file}` };
}
// Files an earlier storyboard or render left: the next render must not hand them out as current.
const STALE_RE = /^(video|final)(-\d+x\d+)?\.mp4$|^(voice|footage|sfx)\.wav$|^index-\d+x\d+\.html$|^qa(-\d+x\d+)?\.json$|^video\.html$|^alpha(-\d+x\d+)?\.mov$/;
const AUDIO_RE = /\.(wav|mp3)$/i;
const MAX_CLIP_SECONDS = 120;
export const LEVELS_PER_SECOND = 30;

/**
 * Clip scenes of a footage template: source length, trim points and whether there is sound to keep.
 * `media` "video" (talking-head) needs a picture; "audio" (audiogram) takes a sound file or a video's sound.
 */
async function footageClips(project, script, media = 'video') {
  const out = [];
  for (const sc of script.scenes) {
    if (sc.kind !== 'clip') continue;
    const okName = media === 'audio' ? VIDEO_RE.test(sc.asset || '') || AUDIO_RE.test(sc.asset || '') : VIDEO_RE.test(sc.asset || '');
    if (!okName) throw new StudioError(`${sc.id}: asset must be ${media === 'audio' ? 'a sound or video file (.wav, .mp3, .mp4, .webm, .mov)' : 'a video file (.mp4, .webm, .mov)'}`, 400);
    const file = assetPath(project, sc.asset);
    const info = await probeMedia(file);
    if (media === 'video' && !info.hasVideo) throw new StudioError(`${sc.id}: ${sc.asset} has no video stream`, 400);
    if (media === 'audio' && !info.hasAudio) throw new StudioError(`${sc.id}: ${sc.asset} has no sound`, 400);
    const from = Math.max(0, Number(sc.in) || 0);
    const to = sc.out === undefined || sc.out === '' || sc.out === null ? info.duration : Math.min(Number(sc.out), info.duration);
    if (!Number.isFinite(to) || to - from < 0.5) throw new StudioError(`${sc.id}: in/out must leave at least 0.5 s of ${sc.asset} (length ${round(info.duration, 2)} s)`, 400);
    if (to - from > MAX_CLIP_SECONDS) throw new StudioError(`${sc.id}: a clip may be at most ${MAX_CLIP_SECONDS} s`, 400);
    out.push({ id: sc.id, asset: sc.asset, file, from, seconds: round(to - from, 3), hasAudio: info.hasAudio, hasVideo: media === 'video', fit: sc.fit || 'cover', text: sc.text || '' });
  }
  return out;
}

/**
 * A motion scene may show a clip of footage (`video`, e.g. a screen recording): trimmed like footage,
 * played muted under the voice unless the scene sets `sound`, then its sound plays and it sets the scene's length.
 * A template with `captions: false` (clip-reel) gets no heard captions.
 */
async function sceneVideos(project, script, beats = {}) {
  const out = [];
  for (const sc of script.scenes) {
    if (!sc.video) continue;
    if (!VIDEO_RE.test(sc.video)) throw new StudioError(`${sc.id}: video must be a video file (.mp4, .webm, .mov)`, 400);
    const file = assetPath(project, sc.video);
    const info = await probeMedia(file);
    if (!info.hasVideo) throw new StudioError(`${sc.id}: ${sc.video} has no video stream`, 400);
    const from = Math.max(0, Number(sc.in) || 0);
    const to = sc.out === undefined || sc.out === '' || sc.out === null ? info.duration : Math.min(Number(sc.out), info.duration);
    if (!Number.isFinite(to) || to - from < 0.5) throw new StudioError(`${sc.id}: in/out must leave at least 0.5 s of ${sc.video} (length ${round(info.duration, 2)} s)`, 400);
    if (to - from > MAX_CLIP_SECONDS) throw new StudioError(`${sc.id}: a clip may be at most ${MAX_CLIP_SECONDS} s`, 400);
    // A clip that speaks with no voice line over it is captioned: from the typed `caption` when the scene has one
    // (timed on what is heard), else from what is heard.
    const speaks = sc.sound === true && info.hasAudio;
    const captioned = speaks && beats.captions !== false && !String(sc.vo || '').trim();
    out.push({ id: sc.id, asset: sc.video, file, from, seconds: round(to - from, 3), hasAudio: speaks, hasVideo: true, fit: 'contain', text: '',
      ...(captioned ? { caption: true, typed: String(sc.caption || '').trim() } : {}) });
  }
  return out;
}

/**
 * Captions for footage: words heard by speech recognition keep their own times; typed clip text has no
 * timings, so it is spread over the clip.
 */
/**
 * Times a typed caption on the words heard in the same clip (clip-relative seconds): word for word when the counts
 * match, otherwise spread by length over the heard speech (or the whole clip when nothing was heard).
 */
export function typedWords(typed, heard, seconds) {
  const ws = wordsOf(typed);
  if (!ws.length) return [];
  if (heard.length === ws.length) return ws.map((w, i) => ({ w, start: heard[i].start, end: heard[i].end }));
  const a = heard.length ? heard[0].start : 0.1, b = heard.length ? heard[heard.length - 1].end : Math.max(0.2, seconds - 0.1);
  const total = ws.reduce((n, w) => n + w.length + 1, 0);
  let at = a;
  return ws.map((w) => {
    const d = ((b - a) * (w.length + 1)) / total;
    const out = { w, start: round(at), end: round(at + d - 0.02) };
    at += d;
    return out;
  });
}

/**
 * Speech recognition often stamps a clip's first words from 0 s, before anyone speaks. The words stamped before the
 * speech is heard (`onset`, clip seconds) are spread from there to the first word placed after it; every other word
 * keeps its time.
 */
export function startOnSpeech(words, onset) {
  if (!words.length || !(onset > words[0].start)) return words;
  const k = words.findIndex((w) => w.start >= onset);
  const lead = k < 0 ? words.length : k;
  const until = k < 0 ? Math.max(words.at(-1).end, onset + 0.2 * lead) : words[k].start;
  if (until - onset < 0.05 * lead) return words;
  const slot = (until - onset) / lead;
  return words.map((w, i) => (i < lead ? { ...w, start: round(onset + slot * i, 2), end: round(onset + slot * (i + 1) - 0.02, 2) } : w));
}

/** Adds the words recognised in each clip's sound to the timing as that scene's caption words, at real times. */
export function heardWords(timing, clips) {
  for (const c of clips) {
    const t = timing.scenes.find((s) => s.id === c.id);
    for (const w of c.words) timing.words.push({ w: w.w, start: round(t.start + w.start), end: round(t.start + Math.max(w.start + 0.05, w.end)), scene: c.id });
  }
  timing.words.sort((x, y) => x.start - y.start);
}

function captionClips(timing, clips) {
  for (const c of clips) {
    const t = timing.scenes.find((s) => s.id === c.id);
    if (c.words?.length) {
      heardWords(timing, [c]);
      continue;
    }
    const ws = wordsOf(c.text);
    if (!ws.length) continue;
    const a = t.start + 0.15, span = Math.max(0.5, t.end - t.start - 0.45);
    ws.forEach((w, i) => timing.words.push({ w, start: round(a + (span * i) / ws.length), end: round(a + (span * (i + 1)) / ws.length - 0.03), scene: c.id }));
  }
  timing.words.sort((x, y) => x.start - y.start);
  timing.footage = clips.map(({ id, seconds, hasAudio, words }) => ({ id, seconds, hasAudio, ...(words ? { heard: true } : {}) }));
}

/** Each clip becomes a frame-sized, keyframe-dense mp4 (fast exact seeks), and clip sound becomes footage.wav. */
async function cutClips(dir, clips, timing, { width, height }) {
  fs.mkdirSync(path.join(dir, 'clips'), { recursive: true });
  for (const c of clips.filter((x) => x.hasVideo)) {
    const scale = c.fit === 'contain'
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    await ffmpeg(['-y', '-ss', String(c.from), '-t', String(c.seconds), '-i', c.file, '-an', '-vf', `${scale},fps=${CLIP_FPS}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-crf', '18', '-g', '6', '-preset', 'veryfast', '-movflags', '+faststart', path.join(dir, 'clips', `${c.id}.mp4`)],
    { timeoutMs: mediaTimeoutMs(c.seconds) });
  }
  const voiced = clips.filter((c) => c.hasAudio);
  if (voiced.length) await ffmpeg(footageArgs(voiced, timing, path.join(dir, 'footage.wav')), { timeoutMs: FOOTAGE_TIMEOUT_MS });
}

const FOOTAGE_TIMEOUT_MS = 300000;

/** ffmpeg args for footage.wav: each clip's sound at its scene start, with its `gainDb` from the loudness match. */
export function footageArgs(voiced, timing, out) {
  const args = ['-y'];
  for (const c of voiced) args.push('-ss', String(c.from), '-t', String(c.seconds), '-i', c.file);
  const at = (c) => timing.scenes.find((s) => s.id === c.id).start;
  const gain = (c) => (c.gainDb ? `volume=${c.gainDb}dB,` : '');
  const chains = voiced.map((c, i) => `[${i}:a]aresample=48000,${gain(c)}afade=t=in:d=0.08,afade=t=out:st=${Math.max(0, c.seconds - 0.12).toFixed(3)}:d=0.12,adelay=${Math.round(at(c) * 1000)}:all=1[a${i}]`);
  const mix = `${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:duration=longest:normalize=0,apad,atrim=0:${timing.duration}[out]`;
  args.push('-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ac', '1', '-ar', '48000', out);
  return args;
}

/**
 * Loudness match (config `loudness`): each clip that plays its own sound gets a `gainDb` toward the voice-over
 * (voice.wav over its words), or toward the clips' median when there is none. Noted per clip in the timing.
 */
async function matchLoudness(dir, clips, timing, voiceWords, opts) {
  const voiceFile = path.join(dir, 'voice.wav');
  const voice = exists(voiceFile) ? { file: voiceFile, words: voiceWords } : null;
  const res = await clipGains(clips.filter((c) => c.hasAudio), voice, opts);
  if (!res) return;
  timing.loudness = { against: res.against, target: res.target };
  const rows = timing.footage || timing.videos;
  for (const m of res.clips) {
    clips.find((c) => c.id === m.id).gainDb = m.gainDb;
    Object.assign(rows.find((r) => r.id === m.id), { gainDb: m.gainDb, lufs: m.lufs, peak: m.peak });
  }
}

/** Loudness per frame of each clip (0-1, LEVELS_PER_SECOND a second), so a waveform can follow the real sound. */
export function levelsOf(samples, rate, perSecond = LEVELS_PER_SECOND) {
  const step = Math.round(rate / perSecond);
  const rms = [];
  for (let i = 0; i < samples.length; i += step) {
    let s = 0;
    const end = Math.min(samples.length, i + step);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    rms.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  // Scale by a loud frame (95th percentile), not the single peak, so one click does not flatten the rest.
  const ref = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.95)] || 1;
  return rms.map((v) => Math.round(Math.min(1, v / ref) * 100) / 100);
}

async function clipLevels(clips, timing) {
  const rate = 8000;
  for (const c of clips.filter((x) => x.hasAudio)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-lv-'));
    try {
      const raw = path.join(tmp, 'a.raw');
      await ffmpeg(['-y', '-ss', String(c.from), '-t', String(c.seconds), '-i', c.file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', raw], { timeoutMs: 60000 });
      const buf = fs.readFileSync(raw);
      const samples = new Float32Array(buf.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
      timing.footage.find((f) => f.id === c.id).levels = levelsOf(samples, rate);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

/**
 * Stills and lint at each still time, then (config `playcheck`) the play-through check in the same page. With `sheet`
 * (pacing rows), the review sheet's frames are taken on that forward play (or a plain forward pass when it is off).
 */
async function captureStills(dir, cfg, findings, size, { page: pageFile = 'index.html', sub = '', oneScene = false, sheet = null } = {}) {
  const stillsDir = path.join(dir, 'stills', sub);
  fs.mkdirSync(stillsDir, { recursive: true });
  for (const f of fs.readdirSync(stillsDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(stillsDir, f));
  const { browser, page, info } = await openComposition(path.join(dir, pageFile), { channel: cfg.engine.chromeChannel, width: size.width, height: size.height });
  try {
    const out = [];
    const linted = new Set();
    for (const s of info.stills) {
      await page.evaluate((t) => window.seek(t), s.t);
      await page.screenshot({ path: path.join(stillsDir, `${s.id}.png`), type: 'png' });
      const f = await page.evaluate(lintInPage, cfg.lint.safeArea);
      for (const x of f) { findings.push({ ...x, scene: s.id, t: s.t }); linted.add(`${s.id}|${x.el}`); }
      out.push({ id: s.id, t: s.t, file: `stills/${sub ? `${sub}/` : ''}${s.id}.png` });
    }
    const play = { ...PLAY_DEFAULTS, ...cfg.playcheck };
    const cuts = sheet?.length > 1 ? cutShots(sheet) : [];
    const shots = sheet?.length ? [...sheetShots(sheet, cfg.review), ...cuts].sort((a, b) => a.t - b.t) : [];
    const tmp = shots.length ? fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sheet-')) : null;
    try {
      const onShot = async (s) => {
        await page.evaluate((t) => window.seek(t), s.t);
        await page.screenshot({ path: path.join(tmp, s.file), type: 'jpeg', quality: 90 });
      };
      if (play.enabled) findings.push(...(await playCheck(page, info, { ...play, safeArea: cfg.lint.safeArea, oneScene, skipLint: linted, shots, onShot })).findings);
      else if (shots.length) {
        await freshLoad(page);
        for (const s of shots) await onShot(s);
      }
      // The sheet is a review aid: if it cannot be made, say so and keep the storyboard.
      if (tmp) await writeSheet(browser, tmp, path.join(dir, SHEET), sheet, size, cfg.review).catch((err) => findings.push({ level: 'warning', el: 'review', msg: `review sheet not made: ${err.message}` }));
      if (tmp && cuts.length) await writeCutSheet(browser, tmp, path.join(dir, CUT_SHEET), sheet, size).catch((err) => findings.push({ level: 'warning', el: 'review', msg: `cut sheet not made: ${err.message}` }));
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** The play-through check on a prepared job's pages (main and extra cuts), read-only: nothing is written. */
export async function playJob(project, id) {
  const cfg = loadStudioConfig();
  const st = getStatus(project, id);
  const brief = loadBrief(project, id);
  const { beats } = loadBriefTemplate(brief);
  const dir = jobDir(project, id);
  if (!exists(path.join(dir, 'index.html'))) throw new StudioError('This job has no composition yet: run prepare first', 409);
  const { oneScene } = motionProfile(jobBrand(project, readJson(jobFile(project, id, 'script.json'), null)));
  const pages =[{ format: brief.format, page: 'index.html', ...sizeFor(beats, brief.format) }, ...(st.cuts || []).filter((c) => exists(path.join(dir, c.page)))];
  const out = [];
  for (const p of pages) {
    const t0 = Date.now();
    const { browser, page, info } = await openComposition(path.join(dir, p.page), { channel: cfg.engine.chromeChannel, width: p.width, height: p.height });
    try {
      const r = await playCheck(page, info, { ...PLAY_DEFAULTS, ...cfg.playcheck, safeArea: cfg.lint.safeArea, oneScene });
      out.push({ format: p.format, duration: info.duration, ...r, seconds: round((Date.now() - t0) / 1000, 1) });
    } finally {
      await browser.close();
    }
  }
  return out;
}

export const BENCH_WORKERS = [2, 4, 6, 8];
export const BENCH_SECONDS = 10;

/** The distinct Chrome counts a benchmark can try: `asked`, cut by renderWorkers' limits (CPU, MAX_WORKERS, length). */
export function benchCounts(asked, frames, fps, cpus = os.cpus().length) {
  return [...new Set(asked.map((n) => renderWorkers(n, frames, fps, cpus)))].sort((a, b) => a - b);
}

/**
 * Renders the first `seconds` of a prepared job with each Chrome count and times it, Chrome start included, so a
 * person can set config/studio.json → render.concurrency from a measurement (as `npx remotion benchmark` does).
 * Encodes into a temp folder and leaves the job as it was; refused while the job prepares or renders.
 */
export async function benchJob(project, id, { seconds = BENCH_SECONDS, workers = BENCH_WORKERS, onRun = () => {} } = {}) {
  const cfg = loadStudioConfig();
  const st = getStatus(project, id);
  if (['preparing', 'rendering'].includes(st.status)) throw new StudioError(`The job is ${st.status}: benchmark it once that ends`, 409);
  const brief = loadBrief(project, id);
  const { beats } = loadBriefTemplate(brief);
  const dir = jobDir(project, id);
  if (!exists(path.join(dir, 'index.html')) || !st.duration) throw new StudioError('This job has no composition yet: run prepare first', 409);
  const fps = cfg.render.fps;
  const frames = Math.round(Math.min(Number(seconds) || BENCH_SECONDS, st.duration) * fps);
  const counts = benchCounts(workers, frames, fps);
  const { alpha, ...capture } = captureSpec(cfg, brief, beats);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-bench-'));
  const results = [];
  try {
    const inject = await cutClipFrames(dir, st.duration, cfg.engine);
    for (const n of counts) {
      const t0 = Date.now();
      const { pages, close } = await openWorkers(path.join(dir, 'index.html'), { channel: cfg.engine.chromeChannel, ...sizeFor(beats, brief.format), count: n, inject });
      try {
        await renderFrames(pages, { ...capture, frames, fps, out: path.join(tmp, `bench-${n}${alpha ? '.mov' : '.mp4'}`), timeoutMs: (cfg.engine.runTimeoutMinutes || 15) * 60000 });
      } finally {
        await close();
      }
      const secs = (Date.now() - t0) / 1000;
      const r = { workers: n, seconds: round(secs, 1), fps: round(frames / secs, 1) };
      results.push(r);
      onRun(r);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(dir, CLIP_FRAMES_DIR), { recursive: true, force: true });
  }
  const best = results.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  return { frames, seconds: round(frames / fps, 2), configured: cfg.render.concurrency, results, best };
}

/* ---------- step 8: human approval ---------- */
export function approve(project, id, by) {
  const st = getStatus(project, id);
  requireStatus(st, ['awaiting_review'], 'approve');
  return setStatus(project, id, { status: 'approved', step: 9, approvedBy: by, failed: null }, 'storyboard approved', by);
}

// Files a render reads from prepare: without them a retry after a failed render needs a new storyboard.
const STORYBOARD_FILES = ['index.html', 'timing.json'];

/** Whether a job may render: approved or done, or in error from a failed render with its approval still on it. */
export const canRender = (st) => ['approved', 'done'].includes(st.status) || (st.status === 'error' && st.failed === 'render' && Boolean(st.approvedBy));

/** ffmpeg args that lay an overlay render (`alpha`, ProRes 4444) on the brand background `bg` into an MP4. */
export function overlayArgs({ bg, width, height, fps, crf, alpha, out }) {
  const c = /^#[0-9a-f]{6}$/i.test(bg || '') ? `0x${bg.slice(1)}` : 'black';
  return ['-y', '-f', 'lavfi', '-i', `color=c=${c}:s=${width}x${height}:r=${fps}`, '-i', alpha,
    '-filter_complex', `[0:v][1:v]overlay=shortest=1,${BT709_VF},format=yuv420p`, '-c:v', 'libx264', ...BT709_TAGS, '-crf', String(crf), '-preset', 'medium', '-r', String(fps), '-movflags', '+faststart', out];
}

/** How a render captures and encodes frames (renderFrames options plus `alpha`); the benchmark uses the same. */
function captureSpec(cfg, brief, beats) {
  const fps = cfg.render.fps;
  // Motion blur: N sub-frames inside a 180° shutter per frame, averaged by ffmpeg (tmix). The page stays deterministic.
  const sub = brief.motionBlur ? Math.max(2, Math.min(8, Math.round(cfg.render.motionBlurSamples || 4))) : 1;
  const shutter = Math.max(0.1, Math.min(1, Number(cfg.render.shutter) || 0.5));
  const blur = sub > 1 ? `tmix=frames=${sub},select='not(mod(n+1,${sub}))',setpts=N/(${fps}*TB),` : '';
  // An overlay template renders PNG frames with their transparency into ProRes 4444; the MP4 is that over the brand background.
  const alpha = beats.alpha === true;
  return {
    alpha, sub, shutter, filterArgs: ['-vf', blur + BT709_VF],
    input: alpha ? 'png' : 'mjpeg',
    shoot: (page) => (alpha ? page.screenshot({ type: 'png', omitBackground: true }) : page.screenshot({ type: 'jpeg', quality: cfg.render.jpegQuality })),
    encode: (file) => (alpha
      ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', ...BT709_TAGS, '-vendor', 'apl0', '-r', String(fps), file]
      : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-crf', String(cfg.render.crf), '-preset', 'medium', '-r', String(fps), '-movflags', '+faststart', file]),
  };
}

/* ---------- steps 9-11: render, audio, export ---------- */
export async function render(project, id, by = 'engine') {
  const cfg = loadStudioConfig();
  const st = getStatus(project, id);
  if (!canRender(st)) requireStatus(st, ['approved', 'done'], 'render');
  if (st.status === 'error' && STORYBOARD_FILES.some((f) => !exists(jobFile(project, id, f)))) {
    throw new StudioError('The storyboard files are gone: run prepare again, then approve and render.', 409);
  }
  const script = readJson(jobFile(project, id, 'script.json'), null);
  assertNoDrafts(script);
  // The music of the final mix follows the look prepare laid over the brand.
  const brand = jobBrand(project, script);
  const brief = loadBrief(project, id);
  const { beats } = loadBriefTemplate(brief);
  const dir = jobDir(project, id);
  const fps = cfg.render.fps;
  const { alpha, ...capture } = captureSpec(cfg, brief, beats);
  // The main video first, then each extra cut prepare laid out; all share voice, music and captions.
  const cuts = (st.cuts || []).filter((c) => exists(path.join(dir, c.page)));
  const jobs = [{ format: brief.format, page: 'index.html', video: 'video.mp4', final: 'final.mp4', receipt: 'qa.json', alpha: 'alpha.mov', ...sizeFor(beats, brief.format) },
    ...cuts.map((c) => ({ format: c.format, page: c.page, video: `video-${c.slug}.mp4`, final: `final-${c.slug}.mp4`, receipt: `qa-${c.slug}.json`, alpha: `alpha-${c.slug}.mov`, width: c.width, height: c.height }))];
  setStatus(project, id, { status: 'rendering', step: 9, error: null, failed: null, progress: { frame: 0, total: 0 } }, st.status === 'error' ? 'render retried' : 'render started', by);
  const t0 = Date.now();
  try {
    const platformFormats = PLATFORMS.find((p) => p.id === brief.platform)?.formats || null;
    const total = Math.round((st.duration || 0) * fps) * jobs.length;
    let done = 0;
    const made = [];
    // Footage shows frames ffmpeg cut ahead, one set for every cut, instead of a <video> seeked per frame.
    const inject = await cutClipFrames(dir, st.duration, cfg.engine);
    for (const j of jobs) {
      const workers = renderWorkers(cfg.render.concurrency, Math.round((st.duration || 0) * fps), fps);
      const { pages, info, close } = await openWorkers(path.join(dir, j.page), { channel: cfg.engine.chromeChannel, width: j.width, height: j.height, count: workers, inject });
      const frames = Math.round(info.duration * fps);
      const all = Math.max(total, done + frames);
      try {
        let shot = 0;
        await renderFrames(pages, {
          ...capture, frames, fps,
          out: path.join(dir, alpha ? j.alpha : j.video),
          timeoutMs: (cfg.engine.runTimeoutMinutes || 15) * 60000,
          onFrame: () => { if (++shot % 30 === 0) setStatus(project, id, { progress: { frame: done + shot, total: all } }); },
        });
        const missed = (await Promise.all(pages.map((p) => p.evaluate(() => window.__frameErrors || [])))).flat();
        if (missed.length) throw new StudioError(`${missed[0]}; prepare the job again`);
      } finally {
        await close();
      }
      done += frames;
      if (alpha) {
        await ffmpeg(overlayArgs({ bg: brand.colors?.bg, width: j.width, height: j.height, fps, crf: cfg.render.crf, alpha: path.join(dir, j.alpha), out: path.join(dir, j.video) }),
          { timeoutMs: mediaTimeoutMs(info.duration, cfg.engine) });
      }
      setStatus(project, id, { step: 10, progress: { frame: done, total: all } }, `${j.format} frames rendered: ${frames} @ ${fps}fps`, by);
      const audio = await exportFinal(project, dir, brand, info.duration, { video: j.video, final: j.final }, cfg.engine);
      const qa = await qaFile(dir, j.final, j.receipt, {
        width: info.width, height: info.height, fps, duration: info.duration, silent: audio === 'silent', ...loudnessExpect(audio), format: j.format, platformFormats: j === jobs[0] ? platformFormats : null,
      });
      made.push({ format: j.format, final: j.final, width: info.width, height: info.height, duration: info.duration, audio, qa, ...(alpha ? { alpha: j.alpha } : {}) });
    }
    const [main, ...extra] = made;
    // The offline HTML copy of the main video; a failure here never fails the render.
    let html = null;
    try { html = { file: 'video.html', mb: round((await buildHtmlVideo(dir)) / 1048576, 1) }; } catch (err) { html = { file: null, reason: err.message.slice(0, 300) }; }
    const secs = round((Date.now() - t0) / 1000, 1);
    return setStatus(project, id, {
      status: 'done', step: 11, progress: null,
      outputs: {
        final: 'final.mp4', captions: 'captions.srt', width: main.width, height: main.height, fps, duration: main.duration, audio: main.audio, renderSeconds: secs, qa: main.qa,
        ...(main.alpha ? { alpha: main.alpha } : {}),
        cuts: extra.map(({ format, final, width, height, qa, alpha: a }) => ({ format, final, width, height, qa, ...(a ? { alpha: a } : {}) })),
        html,
      },
    }, `${made.map((m) => m.final).join(', ')} written in ${secs}s, QA ${made.every((m) => m.qa.passed) ? 'passed' : 'failed'}`, by);
  } catch (err) {
    // The approval stays: the person can retry the render without a new storyboard (canRender).
    setStatus(project, id, { status: 'error', failed: 'render', error: err.message, progress: null }, 'render failed', by);
    throw err;
  } finally {
    fs.rmSync(path.join(dir, CLIP_FRAMES_DIR), { recursive: true, force: true });
  }
}

/**
 * Runs QA on one finished file and writes the full receipt next to it. Returns the short summary kept in
 * status.json. A QA failure never undoes the render: the person sees the receipt and decides.
 */
export async function qaFile(dir, file, receipt, expect) {
  const captions = path.join(dir, 'captions.srt');
  try {
    const r = await runQa(path.join(dir, file), expect, exists(captions) ? fs.readFileSync(captions, 'utf8') : null);
    writeJson(path.join(dir, receipt), { file, expect, ...r });
    return { receipt, passed: r.passed, errors: r.errors, warnings: r.warnings, loudness: r.measured.loudness?.integrated ?? null, findings: r.findings.slice(0, 20) };
  } catch (err) {
    return { receipt: null, passed: false, errors: 1, warnings: 0, loudness: null, findings: [{ level: 'error', check: 'qa', msg: `QA could not run: ${err.message.slice(0, 300)}` }] };
  }
}

const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11';
// The mix is stereo. Speech, footage sound and cut sounds are written mono: each goes to both sides at full level,
// as a player plays a mono file. Music keeps its own stereo; the mono mix this replaced summed a centred track's two
// sides (+3 dB), so music is lifted 3 dB to keep the voice-to-music balance and duck depth a brand's gainDb was set by.
const MONO_TO_STEREO = 'pan=stereo|c0=c0|c1=c0';
const MUSIC_STEREO = 'aformat=channel_layouts=stereo';
const MUSIC_LIFT_DB = 3.01;
// Music dips while anyone speaks: the speech mix [v] is the sidechain.
const DUCK = 'sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1';

/**
 * The final mix's -filter_complex. Inputs 1..speech are speech tracks, the next one is music; output [a].
 * Without `duck` the graph is the constant-level mix every render used before ducking existed.
 * `offsets` (seconds, one per speech track) delays each track; `fadeIn` / `fadeOut` shape the music;
 * `loopGraph` (steps that read the music input and end in [loop]) replaces the music input.
 * `sfx` cut-sound tracks (inputs after the speech, before the music; `sfxOffsets` delays them) join after the duck:
 * they never dip the music, and their level is the brand's `sfx.gainDb`, set when sfx.wav was made.
 */
export function mixFilter({ speech = 0, sfx = 0, sfxOffsets = null, music = false, duration, gainDb, duck = false, offsets = null, fadeIn = 0, fadeOut = 1.5, loopGraph = null }) {
  const dur = duration.toFixed(3);
  const parts = [];
  let n = 1;
  for (; n <= speech; n++) {
    const delay = offsets ? `adelay=${Math.round(offsets[n - 1] * 1000)}:all=1,` : '';
    parts.push(`[${n}:a]aresample=48000,${MONO_TO_STEREO},${delay}apad,atrim=0:${dur}[s${n}]`);
  }
  if (speech) parts.push(speech === 1 ? '[s1]anull[v]' : `${Array.from({ length: speech }, (_, i) => `[s${i + 1}]`).join('')}amix=inputs=${speech}:duration=first:normalize=0[v]`);
  for (let k = 0; k < sfx; k++, n++) {
    const delay = sfxOffsets ? `adelay=${Math.round(sfxOffsets[k] * 1000)}:all=1,` : '';
    parts.push(`[${n}:a]aresample=48000,${MONO_TO_STEREO},${delay}apad,atrim=0:${dur}[e${k}]`);
  }
  if (sfx) parts.push(sfx === 1 ? '[e0]anull[fx]' : `${Array.from({ length: sfx }, (_, k) => `[e${k}]`).join('')}amix=inputs=${sfx}:duration=first:normalize=0[fx]`);
  const fx = sfx ? '[fx]' : '', more = sfx ? 1 : 0;
  if (music) {
    const gain = +(Number(gainDb ?? -18) + MUSIC_LIFT_DB).toFixed(2);
    const fadeAt = Math.max(0, duration - fadeOut).toFixed(3);
    const fin = fadeIn ? `afade=t=in:st=0:d=${fadeIn},` : '';
    if (loopGraph) parts.push(loopGraph);
    parts.push(`[${loopGraph ? 'loop' : `${n}:a`}]aresample=48000,${MUSIC_STEREO},apad,atrim=0:${dur},volume=${gain}dB,${fin}afade=t=out:st=${fadeAt}:d=${fadeOut}[m]`);
  }
  if (speech && music && duck) return `${parts.join(';')};[v]asplit=2[vm][vk];[m][vk]${DUCK}[md];[vm][md]${fx}amix=inputs=${2 + more}:duration=first:normalize=0,${LOUDNORM}[a]`;
  if (speech && music) return `${parts.join(';')};[v][m]${fx}amix=inputs=${2 + more}:duration=first:normalize=0,${LOUDNORM}[a]`;
  // Cut sounds alone are not loudness-normalised: that would lift a few clicks to full programme level.
  if (!speech && !music) return `${parts.join(';')};[fx]anull[a]`;
  if (sfx) return `${parts.join(';')};[${speech ? 'v' : 'm'}][fx]amix=inputs=2:duration=first:normalize=0,${LOUDNORM}[a]`;
  return `${parts.join(';')};[${speech ? 'v' : 'm'}]${LOUDNORM}[a]`;
}

// A job's speech tracks, in mix order: the voice-over and the footage clips' own sound.
export const SPEECH_FILES = ['voice.wav', 'footage.wav'];

/** The brand's music file (a `library:` track is synthesised on first use), or null when it has none. */
export async function brandMusic(project, brand) {
  const name = brand.music?.file;
  if (!name) return null;
  if (!isLibraryMusic(name)) return assetPath(project, name);
  await ensureMusic();
  return musicPath(name.slice(8));
}

/** Seconds of one chord progression of a built-in track (loops jump back whole cycles), 0 for an upload. */
const musicCycle = (name) => (isLibraryMusic(name) ? MUSIC.find((m) => m.id === name.slice(8))?.cycle || 0 : 0);

/**
 * The final mux: the rendered `video` with its sound from `speech` files, `sfx` files (cut sounds) and `music`
 * (a file or null) at the brand's music settings. Music `musicSeconds` long, shorter than the video, loops by
 * crossfade (`loopMusic`, one input per copy; `cycle` as there). `label` names what is heard ('silent' when nothing is).
 */
export function finalMixArgs({ video, final, speech = [], sfx = [], music = null, musicSeconds = 0, cycle = 0, brand, duration }) {
  const dur = duration.toFixed(3);
  const args = ['-y', '-i', video];
  if (!speech.length && !music && !sfx.length) {
    args.push('-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=48000:cl=stereo');
    args.push('-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-t', dur, '-movflags', '+faststart', final);
    return { args, label: 'silent' };
  }
  for (const f of [...speech, ...sfx]) args.push('-i', f);
  const loop = music && musicSeconds ? loopMusic(1 + speech.length + sfx.length, musicSeconds, duration, cycle) : null;
  if (music) for (let i = 0; i < (loop?.copies || 1); i++) args.push('-i', music);
  const filter = mixFilter({ speech: speech.length, sfx: sfx.length, music: Boolean(music), duration, gainDb: brand.music?.gainDb, duck: brand.music?.duck === true, loopGraph: loop?.graph || null });
  args.push('-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', dur, '-movflags', '+faststart', final);
  return { args, label: [...speech, ...sfx].map((f) => path.basename(f, '.wav')).concat(music ? ['music'] : []).join('+') };
}

// The final-mix label of a job whose only sound is its cut sounds: mixFilter leaves that unnormalised on purpose.
const SFX_ONLY = path.basename(SFX_FILE, '.wav');

/** QA expectation for a mix label: cut sounds alone are not loudness-normalised, so QA must not judge them at -14 LUFS. */
export const loudnessExpect = (audio) => (audio === SFX_ONLY ? { normalised: false } : {});

async function exportFinal(project, dir, brand, duration, names = { video: 'video.mp4', final: 'final.mp4' }, engine = loadStudioConfig().engine) {
  const music = await brandMusic(project, brand);
  const { args, label } = finalMixArgs({
    video: path.join(dir, names.video), final: path.join(dir, names.final), brand, duration,
    speech: SPEECH_FILES.map((f) => path.join(dir, f)).filter(exists),
    sfx: [path.join(dir, SFX_FILE)].filter(exists),
    music, musicSeconds: music ? (await probeMedia(music)).duration : 0, cycle: musicCycle(brand.music?.file),
  });
  await ffmpeg(args, { timeoutMs: mediaTimeoutMs(duration, engine) });
  return label;
}

/** Re-runs QA on a job that is already done (renders made before QA existed, or after a manual check). */
export async function qaJob(project, id, by = 'engine') {
  const st = getStatus(project, id);
  requireStatus(st, ['done'], 'check');
  const o = st.outputs || {};
  const brief = loadBrief(project, id);
  const qa = await qaFile(jobDir(project, id), 'final.mp4', 'qa.json', {
    width: o.width, height: o.height, fps: o.fps, duration: o.duration, silent: o.audio === 'silent', ...loudnessExpect(o.audio),
    format: brief.format, platformFormats: PLATFORMS.find((p) => p.id === brief.platform)?.formats || null,
  });
  return setStatus(project, id, { outputs: { ...o, qa } }, `QA ${qa.passed ? 'passed' : 'failed'} (${qa.warnings} warning(s))`, by);
}

export function describe(project, id) {
  const st = getStatus(project, id);
  const dir = jobDir(project, id);
  const rel = (f) => path.relative(ROOT, path.join(dir, f));
  return { status: st, files: ['source.json', 'script.json', 'timing.json', 'index.html', 'final.mp4'].filter((f) => exists(path.join(dir, f))).map(rel) };
}
