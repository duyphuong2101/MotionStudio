import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject, loadTemplate } from '../engine/jobs.mjs';
import { pacing, sheetShots, cutShots, tileSize, pacingTable, REVIEW_DEFAULTS, SHEET, CUT_SHEET, CUT_FRAMES, PACING } from '../engine/review.mjs';
import { reviewRoute } from '../server/review.mjs';

const word = (w, start, end, scene) => ({ w, start, end, scene });
// Three scenes: a fast one with a long tail, a silent one, and a last one whose long tail is allowed.
const timing = () => ({
  duration: 12,
  scenes: [{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 8 }, { id: 'c', start: 8, end: 12 }],
  words: [
    word('one', 0.2, 0.5, 'a'), word('two', 0.5, 0.8, 'a'), word('three', 0.8, 1.1, 'a'), word('four', 1.1, 1.4, 'a'), word('five', 1.4, 1.7, 'a'), word('six', 1.7, 2.2, 'a'),
    word('seven', 8.3, 9.0, 'c'), word('eight', 9.0, 9.8, 'c'),
  ],
});
const script = { scenes: [{ id: 'a', kind: 'title' }, { id: 'b', kind: 'step' }, { id: 'c', kind: 'cta' }] };

test('pacing gives each scene its words per second, head, tail and silence, and flags what is off', () => {
  const p = pacing(timing(), script, REVIEW_DEFAULTS);
  const [a, b, c] = p.scenes;
  assert.deepEqual([a.kind, a.length, a.words, a.wps, a.head, a.tail, a.silence], ['title', 5, 6, 3, 0.2, 2.8, 0.6]);
  assert.deepEqual(a.flags, ['slowTail'], '3 w/s is not fast, a 2.8 s tail before a cut is long');
  assert.deepEqual([b.words, b.wps, b.head, b.tail, b.silence, b.flags], [0, null, null, null, 1, ['dead']]);
  assert.deepEqual([c.wps, c.head, c.tail, c.flags], [1.33, 0.3, 2.2, []], 'the last scene may hold');
  assert.deepEqual(p.totals, { words: 8, wps: 2.29, speech: 3.5, silence: 0.708, flags: ['silence'] });
  assert.deepEqual(p.thresholds, { fastWps: 3.2, slowTail: 1.5, maxSilence: 0.25, sameKindRun: 3 });
});

test('pacing flags the third scene of one kind in a row and every one after it, but not a run of footage', () => {
  const kinds = ['split', 'split', 'split', 'split', 'stat', 'split', 'video', 'video', 'video', 'code-story.clip', 'bars', 'bars'];
  const t = { duration: kinds.length, scenes: kinds.map((_, i) => ({ id: `s${i}`, start: i, end: i + 1 })), words: kinds.map((_, i) => word('w', i + 0.1, i + 0.9, `s${i}`)) };
  const p = pacing(t, { scenes: kinds.map((kind, i) => ({ id: `s${i}`, kind })) }, REVIEW_DEFAULTS);
  assert.deepEqual(p.scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id), ['s2', 's3']);
  assert.deepEqual(pacing(t, { scenes: kinds.map((kind, i) => ({ id: `s${i}`, kind })) }, { sameKindRun: 2 }).scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id), ['s1', 's2', 's3', 's11']);
  assert.equal(pacing(t, null).scenes.some((s) => s.flags.includes('repeat')), false, 'no script, no kinds, no run');
  assert.match(pacingTable(p)[3], /same layout$/);
  // A scene with its own camera pose or exploded parts (a product-tour step) shows a different picture, like footage.
  const posed = kinds.map((kind, i) => ({ id: `s${i}`, kind, ...(i === 2 ? { view: { azimuth: 30 } } : i === 3 ? { explode: ['front'] } : {}) }));
  assert.deepEqual(pacing(t, { scenes: posed }, REVIEW_DEFAULTS).scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id), []);
});

test('a theme change ends a same-layout run; one theme (or none) all along does not', () => {
  const repeats = (themes) => {
    const t = { duration: themes.length, scenes: themes.map((_, i) => ({ id: `s${i}`, start: i, end: i + 1 })), words: themes.map((_, i) => word('w', i + 0.1, i + 0.9, `s${i}`)) };
    const sc = { scenes: themes.map((theme, i) => ({ id: `s${i}`, kind: 'step', ...(theme ? { theme } : {}) })) };
    return pacing(t, sc, REVIEW_DEFAULTS).scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id);
  };
  assert.deepEqual(repeats(['light', 'dark', 'accent']), []);
  assert.deepEqual(repeats(['light', 'dark', 'accent', 'light', 'dark']), []);
  assert.deepEqual(repeats(['dark', 'dark', 'dark']), ['s2']);
  assert.deepEqual(repeats([null, null, null, null]), ['s2', 's3']);
  assert.deepEqual(repeats(['light', 'light', 'dark', 'dark', 'dark']), ['s4']);
});

test('pacing flags fast speech and counts a clip that plays its own sound as heard', () => {
  const t = timing();
  t.words.push(word('more', 2.2, 2.4, 'a'), word('words', 2.4, 2.6, 'a'), word('here', 2.6, 2.8, 'a'));
  t.videos = [{ id: 'b', seconds: 3, sound: true }];
  const p = pacing(t, null, { fastWps: 3.2 });
  assert.equal(p.scenes[0].wps, 3.46);
  assert.ok(p.scenes[0].flags.includes('fast'));
  assert.deepEqual([p.scenes[1].sound, p.scenes[1].silence, p.scenes[1].flags, p.scenes[1].kind], [true, 0, [], '']);
  assert.equal(p.totals.speech, 7.1);
  assert.equal(p.totals.silence, 0.408);
  assert.deepEqual(p.totals.flags, ['silence']);
  assert.deepEqual(pacing(t, null, { maxSilence: 0.45 }).totals.flags, []);
});

test('sheet frames: in, middle and before the cut of each scene, in time order, files in row order', () => {
  const shots = sheetShots([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 5.6 }], REVIEW_DEFAULTS);
  const of = (id) => shots.filter((s) => s.scene === id).sort((x, y) => x.k - y.k).map((s) => [s.t, s.file]);
  assert.deepEqual(of('a'), [[0.45, 'f0000.jpg'], [2.5, 'f0001.jpg'], [4.75, 'f0002.jpg']]);
  // A short scene: never before start + 0.5, never on the next scene's first frame.
  assert.deepEqual(of('b'), [[5.45, 'f0003.jpg'], [5.3, 'f0004.jpg'], [5.5, 'f0005.jpg']]);
  assert.deepEqual(sheetShots([{ id: 'x', start: 0, end: 0.3 }]).map((s) => s.t), [0.15, 0.267, 0.267]);
  assert.deepEqual(shots.map((s) => s.t), [...shots.map((s) => s.t)].sort((x, y) => x - y));
});

test('cut sheet frames sit close around every cut but the first scene, inside the video, in time order', () => {
  const shots = cutShots([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 9 }, { id: 'c', start: 9, end: 9.3 }]);
  assert.equal(shots.length, 2 * CUT_FRAMES.length, 'no row for the opening scene');
  assert.deepEqual(shots.filter((s) => s.scene === 'b').map((s) => s.t), CUT_FRAMES.map((f) => Math.round((5 + f / 30) * 1000) / 1000));
  assert.ok(shots.every((s) => s.t >= 0 && s.t <= 9.267), 'never past the last frame (rounded to ms, as sheetShots)');
  assert.deepEqual(shots.map((s) => s.t), [...shots.map((s) => s.t)].sort((x, y) => x - y));
  assert.equal(new Set(shots.map((s) => s.file)).size, shots.length, 'one file per frame');
  assert.ok(shots.every((s) => /^c\d{4}\.jpg$/.test(s.file)), 'apart from the scene sheet frames');
  assert.deepEqual(cutShots([{ id: 'a', start: 0, end: 5 }]), []);
});

test('tiles keep the frame shape with a 480 px long side', () => {
  assert.deepEqual(tileSize({ width: 1920, height: 1080 }), { tw: 480, th: 270 });
  assert.deepEqual(tileSize({ width: 1080, height: 1920 }), { tw: 270, th: 480 });
  assert.deepEqual(tileSize({ width: 1080, height: 1080 }), { tw: 480, th: 480 });
});

test('the pacing table prints aligned columns with a total row', () => {
  const lines = pacingTable(pacing(timing(), script));
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^scene\s+kind\s+start\s+end\s+length\s+words\s+w\/s\s+head\s+tail\s+silence\s+flags$/);
  assert.match(lines[1], /^a\s+title\s+0\.00\s+5\.00\s+5\.00\s+6\s+3\.00\s+0\.20\s+2\.80\s+60%\s+long tail$/);
  assert.match(lines[2], /^b\s+step .*–\s+–\s+–\s+100%\s+no sound$/);
  assert.match(lines[4], /^total\s+12\.00\s+8\s+2\.29\s+71%\s+too much silence$/);
  // Right-aligned numbers end where their header ends.
  const at = lines[0].indexOf('length') + 'length'.length;
  assert.ok(lines[1].slice(0, at).endsWith(' 5.00') && lines[4].slice(0, at).endsWith('12.00'), lines.join('\n'));
});

test('the review link may read the review data and sheet, nothing more', () => {
  assert.equal(reviewRoute('GET', '/api/jobs/nsc-award/a1-open/review'), 'api');
  assert.equal(reviewRoute('GET', '/files/nsc-award/a1-open/review/sheet.jpg'), 'files');
  assert.equal(reviewRoute('GET', '/files/nsc-award/a1-open/review/pacing.json'), 'files');
  for (const [m, p] of [['HEAD', '/api/jobs/p/j/review'], ['POST', '/api/jobs/p/j/review'], ['PUT', '/api/jobs/p/j/review'], ['GET', '/api/jobs/p/j/review/x'], ['GET', '/api/jobs/p/j/pacing'], ['GET', '/api/sequences/p/s/review']]) {
    assert.equal(reviewRoute(m, p), null, `${m} ${p}`);
  }
});

const PORT = 4796;
function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: `127.0.0.1:${PORT}` }, timeout: 10000 }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

test('review routes serve pacing and the sheet, and refuse other paths', { timeout: 60000 }, async (t) => {
  const P = 'zz-test-review-routes', ID = 'pace';
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 30, message: 'm' }));
  writeJson(jobFile(P, ID, 'script.json'), script);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, shell: false, windowsHide: true, timeout: 55000, env: { ...process.env, MOTION_STUDIO_PORT: String(PORT) },
  });
  t.after(() => child.kill());
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out.slice(0, 2000)}`)), 30000);
    const on = (d) => { out = (out + d).slice(-20000); if (out.includes('Motion Studio UI:')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', (c) => { clearTimeout(timer); reject(new Error(`server exited ${c}: ${out.slice(0, 2000)}`)); });
  });
  const base = `/api/jobs/${P}/${ID}/review`;
  assert.deepEqual(JSON.parse((await get(base)).text), { pacing: null, sheet: null, cuts: null }, 'not prepared yet');
  writeJson(jobFile(P, ID, 'timing.json'), timing());
  writeJson(jobFile(P, ID, PACING), { ok: 1 });
  fs.writeFileSync(jobFile(P, ID, SHEET), 'jpeg');
  fs.writeFileSync(jobFile(P, ID, 'review/other.jpg'), 'x');
  const r = JSON.parse((await get(base)).text);
  assert.equal(r.sheet, SHEET);
  assert.deepEqual(r.pacing.scenes.map((s) => s.flags), [['slowTail'], ['dead'], []]);
  const files = `/files/${P}/${ID}`;
  assert.equal((await get(`${files}/${SHEET}`)).text, 'jpeg');
  assert.equal((await get(`${files}/${PACING}`)).status, 200);
  fs.writeFileSync(jobFile(P, ID, CUT_SHEET), 'cuts');
  assert.equal(JSON.parse((await get(base)).text).cuts, CUT_SHEET);
  assert.equal((await get(`${files}/${CUT_SHEET}`)).text, 'cuts');
  assert.equal((await get(`${files}/review/other.jpg`)).status, 404, 'only the three review files');
  assert.equal((await get(`${files}/review/..%2Ftiming.json`)).status, 404);
  assert.equal((await get(`${files}/review%2F..%2F..%2F..%2F..%2Fconfig%2Fstudio.json`)).status, 404);
  assert.equal((await get(`/api/jobs/..%2Fx/${ID}/review`)).status, 400, 'project id');
  assert.equal((await get(`/api/jobs/${P}/missing/review`)).status, 404, 'no brief');
});

// Real Chrome + ffmpeg: three explainer scenes, estimated timing, the sheet taken on the play-through pass.
test('prepare writes the review sheet and pacing table and clears the old ones', { timeout: 240000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  try { await (await chromium.launch({ channel: loadStudioConfig().engine.chromeChannel, headless: true })).close(); } catch { t.skip('Chrome is not available'); return; }
  const { prepare } = await import('../engine/pipeline.mjs');
  const { probeMedia } = await import('../engine/media.mjs');
  const { sampleScript } = await import('../engine/template-preview.mjs');
  const P = 'zz-test-review-sheet', ID = 'sheet-16x9';
  t.after(() => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  createProject({ id: P, name: 'Sheet Test' });
  const brandFile = path.join(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
  saveBrief(validateBrief({ project: P, id: ID, template: 'explainer', format: '16:9', duration: 30, message: 'm' }));
  const { beats } = loadTemplate('explainer');
  const keep = ['title', 'step', 'cta'];
  writeJson(jobFile(P, ID, 'source.json'), { name: 'Sheet Test', url: '', bullets: [] });
  writeJson(jobFile(P, ID, 'script.json'), sampleScript({ ...beats, sequence: beats.sequence.map((sl) => ({ ...sl, kind: sl.kind.filter((k) => keep.includes(k)) })) }));
  setStatus(P, ID, { status: 'scripted', step: 5 }, 'test');
  fs.mkdirSync(jobFile(P, ID, 'review'), { recursive: true });
  fs.writeFileSync(jobFile(P, ID, 'review/old.jpg'), 'stale');

  const st = await prepare(P, ID, 'test');
  assert.ok(!(st.lint?.findings || []).some((f) => f.el === 'review'), JSON.stringify(st.lint?.findings));
  assert.ok(!fs.existsSync(jobFile(P, ID, 'review/old.jpg')), 'stale review files are gone');
  const pace = readJson(jobFile(P, ID, PACING));
  assert.deepEqual(pace.scenes.map((s) => s.kind), keep);
  assert.ok(pace.scenes.every((s) => s.words > 0 && s.wps > 0));
  const info = await probeMedia(jobFile(P, ID, SHEET));
  assert.deepEqual([info.width, info.height], [200 + 3 * 480 + 2 * 6, 3 * 270 + 2 * 6], 'label column + 3 tiles per row, one row per scene');
  const cut = await probeMedia(jobFile(P, ID, CUT_SHEET));
  assert.deepEqual([cut.width, cut.height], [200 + 8 * 320 + 7 * 6, 2 * 180 + 6], 'label column + 8 tiles per row, one row per cut');
});
