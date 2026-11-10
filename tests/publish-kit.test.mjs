import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIRS, writeJson, readJson, StudioError, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, getStatus, jobFile, loadBrief, createProject } from '../engine/jobs.mjs';
import { ffmpeg, probeMedia } from '../engine/media.mjs';
import { chaptersOf, chaptersText, sceneName, stamp } from '../engine/chapters.mjs';
import { posterOptions, pickStill, posterHtml, makePoster, POSTER_SIZES } from '../engine/poster.mjs';
import { loopOptions, loopSpan, loopArgs, gifArgs } from '../engine/loop.mjs';
import { coverCrop, objectPosition, reframeCss, withReframeCss, focusClips } from '../engine/reframe.mjs';
import { subjectFocus } from '../engine/matte.mjs';
import { translateJob, translationContext, TRANSLATION_RULE } from '../engine/translate.mjs';
import { directorContext } from '../engine/context.mjs';
import { hasChrome } from './helpers/chrome-folder.mjs';

// The publishing extras of plan .ai/plans/publish-kit.md: chapters, posters, web loops, subject reframe and
// language versions. One small Chrome page (the poster); the rest is pure or a 320x180 ffmpeg run.
const tmpDir = (t, prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const scenes = (lens) => { let at = 0.3; return lens.map((len, i) => { const s = { id: `s${i}`, start: at, end: at + len }; at += len; return s; }); };

test('chapters: scenes grouped into 10 s chapters named by their first title, a short tail folded in, fewer than 3 gives none', () => {
  // Starts 0.3 4.3 8.3 12.3 18.3 23.3 26.3 30.3 34.3, end 36.3: chapters open at 12.3 and 23.3, and 34.3's 2 s fold back.
  const sc = scenes([4, 4, 4, 6, 5, 3, 4, 4, 2]);
  const timing = { duration: 36.3, scenes: sc };
  const script = { scenes: [
    { id: 's0', title: 'Why [[circle:speed]] matters' }, { id: 's1', title: 'x' }, { id: 's2', kicker: '' },
    { id: 's3', text: 'A rather long line of text that runs well past the sixty character limit set for names' },
    { id: 's4' }, { id: 's5', title: 'Last part' }, { id: 's6', title: 'x' }, { id: 's7' }, { id: 's8', title: 'Tail' },
  ] };
  const { chapters, reason } = chaptersOf(timing, script);
  assert.equal(reason, null);
  assert.deepEqual(chapters.map((c) => c.at), [0, sc[3].start, sc[5].start]);
  assert.equal(chapters[0].name, 'Why speed matters', 'marks are stripped');
  assert.match(chapters[1].name, /^A rather long line of text that runs well past the sixty…$/);
  assert.ok(chapters[1].name.length <= 61);
  assert.equal(chapters[2].name, 'Last part', 'the 2 s tail (s8) joins the last chapter instead of opening its own');
  assert.equal(chapters.length, 3);
  assert.equal(chaptersText(chapters).split('\n')[0], '0:00 Why speed matters');
  assert.equal(stamp(75.9), '1:15');
  assert.equal(stamp(3725), '1:02:05');
  const short = chaptersOf({ duration: 18, scenes: scenes([4, 4, 4, 5]) }, { scenes: [] });
  assert.deepEqual(short.chapters, []);
  assert.match(short.reason, /3 or more of at least 10 s; this 18 s video makes 1/);
  assert.equal(chaptersOf({ duration: 40, scenes: scenes([12, 12, 12]) }, { scenes: [] }).chapters[1].name, 'Part 2', 'an unnamed chapter is numbered');
  assert.equal(sceneName({ quote: '  two   spaces  ' }), 'two spaces');
});

test('poster options, the still from the nearest page shape, and an escaped title page', () => {
  const st = { stills: [{ id: 'a', file: 'stills/a.png' }, { id: 'b', file: 'stills/b.png' }], cuts: [{ width: 1080, height: 1920, stills: [{ id: 'b', file: 'stills/1080x1920/b.png' }] }] };
  assert.deepEqual(posterOptions(st, {}), { size: 'youtube', scene: 'b', title: '', logo: true }, 'the second scene by default');
  assert.throws(() => posterOptions(st, { size: 'huge' }), /Size must be one of youtube, wide, square, story/);
  assert.throws(() => posterOptions(st, { scene: 'zz' }), /Scene zz has no still: pick one of a, b/);
  assert.throws(() => posterOptions(st, { title: 'x'.repeat(81) }), /at most 80 characters \(81 given\)/);
  assert.throws(() => posterOptions({ stills: [] }, {}), (e) => e instanceof StudioError && e.code === 409);
  assert.equal(posterOptions(st, { title: '  two\n lines ' }).title, 'two lines');
  assert.equal(pickStill(st, { width: 1920, height: 1080 }, 'b', POSTER_SIZES.youtube), 'stills/b.png');
  assert.equal(pickStill(st, { width: 1920, height: 1080 }, 'b', POSTER_SIZES.story), 'stills/1080x1920/b.png', 'a story cover takes the 9:16 cut');
  assert.equal(pickStill(st, { width: 1920, height: 1080 }, 'a', POSTER_SIZES.story), 'stills/a.png', 'a scene only the main page has');
  const brand = { name: 'B', logoText: 'Bee', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' }, fonts: { display: 'Inter', body: 'Inter' } };
  const html = posterHtml(brand, { ...POSTER_SIZES.youtube, still: 'stills/b.png', title: 'A <b> & "c"', logo: true });
  assert.match(html, /<h1 class="tt">A &lt;b&gt; &amp; &quot;c&quot;<\/h1>/);
  assert.match(html, /<div class="lt">Bee<\/div>/, 'the logo text without a logo file');
  assert.ok(!posterHtml(brand, { ...POSTER_SIZES.youtube, still: 'x.png', title: '', logo: false }).includes('class="tt"'), 'no title, no scrim');
});

test('makePoster writes poster-<size>.png at the platform size and records it; a bad still fails into posterError', { timeout: 120000 }, async (t) => {
  if (!(await hasChrome(loadStudioConfig().engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
  const P = 'zz-test-poster', ID = 'p1';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Poster Test' });
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 30, message: 'm', subject: 'Poster' }));
  fs.mkdirSync(jobFile(P, ID, 'stills'), { recursive: true });
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', jobFile(P, ID, 'stills/intro.png')], { timeoutMs: 30000 });
  setStatus(P, ID, { status: 'awaiting_review', step: 8, stills: [{ id: 'intro', t: 1, file: 'stills/intro.png' }] }, 'test');
  const st = await makePoster(P, ID, { size: 'wide', title: 'Ship it <now>' }, 'test');
  assert.deepEqual({ ...st.posters.wide, at: 0 }, { file: 'poster-wide.png', size: 'wide', width: 1200, height: 630, scene: 'intro', title: 'Ship it <now>', at: 0 });
  const info = await probeMedia(jobFile(P, ID, 'poster-wide.png')).catch(() => null);
  assert.ok(fs.statSync(jobFile(P, ID, 'poster-wide.png')).size > 10000);
  if (info?.width) assert.deepEqual([info.width, info.height], [1200, 630]);
  assert.ok(!fs.existsSync(jobFile(P, ID, '_poster.html')), 'the page is removed');
  fs.rmSync(jobFile(P, ID, 'stills/intro.png'));
  await assert.rejects(makePoster(P, ID, { size: 'square' }, 'test'), /still of intro is gone/);
  assert.match(getStatus(P, ID).posterError, /still of intro is gone/);
});

test('web loop: options, the span kept inside the video, and a crossfade from tail to head', async (t) => {
  const timing = { duration: 20, scenes: [{ id: 'a', start: 0.3, end: 6 }, { id: 'b', start: 6, end: 19.5 }] };
  assert.deepEqual(loopOptions(timing, {}), { scene: 'a', start: 0.3, seconds: 6, width: 960 });
  assert.throws(() => loopOptions(timing, { seconds: 11 }), /Seconds must be 2-10/);
  assert.throws(() => loopOptions(timing, { width: 300 }), /Width must be a whole number from 480 to 1920/);
  assert.throws(() => loopOptions(timing, { scene: 'x' }), /Unknown scene x/);
  assert.deepEqual(loopSpan(20, 6, 6), { from: 6, fade: 0.6, len: 6.6 });
  assert.deepEqual(loopSpan(20, 18, 6), { from: 13.4, fade: 0.6, len: 6.6 }, 'moved back to fit');
  assert.deepEqual(loopSpan(20, 0, 2), { from: 0, fade: 0.5, len: 2.5 });
  assert.throws(() => loopSpan(4, 0, 6), /needs 6.6 s/);
  const dir = tmpDir(t, 'ms-loop-');
  const video = path.join(dir, 'video.mp4'), mp4 = path.join(dir, 'loop.mp4'), gif = path.join(dir, 'loop.gif');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { timeoutMs: 60000 });
  await ffmpeg(loopArgs(video, loopSpan(6, 1, 3), 3, 480, mp4), { timeoutMs: 60000 });
  await ffmpeg(gifArgs(mp4, 1280, gif), { timeoutMs: 60000 });
  const info = await probeMedia(mp4);
  assert.ok(Math.abs(info.duration - 3) < 0.1, `loop lasts ${info.duration} s`);
  assert.equal(info.hasAudio, false);
  assert.deepEqual([info.width, info.height], [480, 270]);
  assert.equal(String(fs.readFileSync(gif).subarray(0, 6)), 'GIF89a');
  assert.match(gifArgs('l.mp4', 1280, 'l.gif')[4], /scale=640:-2/, 'a GIF is at most 640 px wide');
});

test('reframe: the crop follows the focus, the page rule centres it as far as the picture allows', async (t) => {
  assert.equal(coverCrop(1080, 1920), 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', 'no focus: the middle, as before');
  assert.equal(coverCrop(1080, 1920, { x: 0.8, y: 0.5 }), 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:max(0\\,min(iw-ow\\,iw*0.8-ow/2)):max(0\\,min(ih-oh\\,ih*0.5-oh/2))');
  const p = objectPosition({ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { x: 0.8, y: 0.3 });
  // Scaled to 3413 px wide in a 1080 box: the subject at 2731 px wants a left edge at 2191 of 2333 px to spare.
  assert.ok(Math.abs(p.x - 0.939) < 0.01, `x ${p.x}`);
  assert.equal(p.y, 0.5, 'nothing to crop on y');
  assert.equal(objectPosition({ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { x: 0.99, y: 0.5 }).x, 1, 'clamped at the edge');
  const clips = [{ id: 'v1', width: 1920, height: 1080, focus: { x: 0.2, y: 0.5 } }, { id: 'v2', width: 1920, height: 1080 }];
  assert.equal(reframeCss(clips, { width: 1080, height: 1920 }), '.vbg video[data-clip="v1"]{object-position:6.1% 50%}');
  assert.equal(reframeCss([{ id: 'x"]{}', width: 2, height: 1, focus: { x: 1, y: 1 } }], { width: 1, height: 1 }), '', 'an id that is not a scene id is dropped');
  assert.equal(withReframeCss('<head><style>a{}</style></head><body>', ''), '<head><style>a{}</style></head><body>', 'no rule, page unchanged');
  assert.equal(withReframeCss('<head></head>', 'x{}'), '<head><style id="reframe">\nx{}\n</style>\n</head>');
  // The subject's centre from a matte, and one focus per clip from three frames.
  const S = 10, alpha = new Uint8Array(S * S);
  for (let y = 2; y < 6; y++) for (let x = 6; x < 9; x++) alpha[y * S + x] = 255;
  assert.deepEqual(subjectFocus(alpha, S), { x: 0.75, y: 0.4, share: 0.12 });
  assert.equal(subjectFocus(new Uint8Array(S * S), S), null);
  const dir = tmpDir(t, 'ms-reframe-');
  const file = path.join(dir, 'c.mp4');
  await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { timeoutMs: 60000 });
  // A segmenter that sees the subject in the right third of every frame.
  const segment = (rgb, size) => Float32Array.from({ length: size * size }, (_, i) => ((i % size) >= size * 0.66 ? 1 : 0));
  const cl = [{ id: 'v1', file, from: 0, seconds: 2, hasVideo: true, fit: 'contain' }, { id: 'th', file, from: 0, seconds: 2, hasVideo: true, fit: 'contain' }];
  assert.deepEqual(await focusClips(cl.slice(1), { cfg: { matte: { size: 32 } }, footage: true, segment }), [], 'footage shown whole is never cropped');
  assert.equal(cl[1].focus, undefined);
  assert.deepEqual(await focusClips(cl.slice(0, 1), { cfg: { matte: { size: 32 } }, segment }), []);
  assert.ok(cl[0].focus.x > 0.8 && Math.abs(cl[0].focus.y - 0.5) < 0.05, JSON.stringify(cl[0].focus));
  const none = await focusClips([{ id: 'z', file, from: 0, seconds: 2, hasVideo: true }], { cfg: { matte: { model: 'models/matte/none-here.onnx' } } });
  assert.match(none[0], /^Keep the subject in frame is on, but models\/matte\/none-here\.onnx is missing/);
  // The crop expression is one ffmpeg accepts, and keeps the frame size.
  const out = path.join(dir, 'crop.mp4');
  await ffmpeg(['-y', '-i', file, '-vf', coverCrop(90, 160, { x: 0.9, y: 0.5 }), '-frames:v', '3', out], { timeoutMs: 60000 });
  const info = await probeMedia(out);
  assert.deepEqual([info.width, info.height], [90, 160]);
});

test('briefs take reframe and translateOf; a job cannot translate itself', () => {
  const base = { project: 'demo', id: 'j1', template: 'explainer', format: '16:9', duration: 30, message: 'm' };
  assert.equal(validateBrief({ ...base, reframe: true }).reframe, true);
  assert.equal('reframe' in validateBrief(base), false, 'absent when off, so old briefs read the same');
  assert.throws(() => validateBrief({ ...base, reframe: 'yes' }), /reframe must be true or false/);
  assert.equal(validateBrief({ ...base, translateOf: 'j0' }).translateOf, 'j0');
  assert.throws(() => validateBrief({ ...base, translateOf: 'j1' }), /cannot be a language version of itself/);
  assert.throws(() => validateBrief({ ...base, translateOf: '../x' }), /translateOf/);
});

test('a language version copies the brief and source, waits for the Director, and gives it the original script', (t) => {
  const P = 'zz-test-translate', ID = 'launch';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Translate Test' });
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 30, message: 'm', subject: 'Launch', alsoFormats: ['9:16'], quick: true, voiceTake: 'take.wav' }));
  assert.throws(() => translateJob(P, ID, { lang: 'es' }), /has no script yet/);
  const source = { name: 'Launch', url: '', bullets: [{ text: 'Ships in May' }], locks: {} };
  const script = { lang: 'en', look: 'calm', scenes: [{ id: 'open', kind: 'title', title: 'Launch day', vo: 'It ships in May.', source: 'bullets[0]' }] };
  writeJson(jobFile(P, ID, 'source.json'), source);
  writeJson(jobFile(P, ID, 'script.json'), script);
  assert.throws(() => translateJob(P, ID, { lang: 'english' }), /Pick the language/);
  assert.throws(() => translateJob(P, ID, { lang: 'en' }), /already in en/);
  const r = translateJob(P, ID, { lang: 'es' }, { by: 'tester' });
  const b = loadBrief(P, 'launch-es');
  assert.deepEqual([b.lang, b.translateOf, b.voice, b.quick, b.voiceTake, b.alsoFormats, b.subject], ['es', ID, '', undefined, undefined, ['9:16'], 'Launch']);
  assert.deepEqual(readJson(jobFile(P, 'launch-es', 'source.json')), source, 'the facts are the original\'s');
  const st = getStatus(P, 'launch-es');
  assert.deepEqual([st.status, st.dirty_from, st.step], ['dirty', 3, 3]);
  assert.match(st.history.at(-1).event, /language version of launch in es/);
  assert.match(r.warning || '', /speaks English only/, 'the brand\'s Kokoro voice cannot speak Spanish here');
  assert.throws(() => translateJob(P, ID, { lang: 'es' }), /already exists/);
  assert.equal(translateJob(P, ID, { lang: 'fr', voice: 'none:', newId: 'launch-fr-v2' }).warning, null);
  const ctx = directorContext(P, 'launch-es');
  assert.deepEqual(ctx.translation, { of: ID, lang: 'es', script: { lang: 'en', scenes: script.scenes, look: 'calm' } });
  assert.equal(ctx.translationRule, TRANSLATION_RULE);
  assert.equal('translation' in directorContext(P, ID), false, 'an ordinary job has none');
  fs.rmSync(jobFile(P, ID, 'script.json'));
  assert.match(translationContext(P, b).translation.missing, /launch has no script\.json any more/);
});
