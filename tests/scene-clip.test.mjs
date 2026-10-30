// Generate clip from New from script (plan scene-script, B2-B3): the brand's clip brief and reference pictures, the
// prompt composed per scene, the check result that carries it, and the clip name put into the scene's CLIP line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DIRS, within, readJson, writeJson, loadStudioConfig } from '../engine/core.mjs';
import { createProject } from '../engine/jobs.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { clipPrompt, clipAspect, importSceneScript } from '../engine/scenescript.mjs';
import { validateRequest, optionsFor, MAX_PROMPT_CHARS } from '../server/generate.mjs';
import { insertClip } from '../ui/shots.js';

const BASE = {
  name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};

test('the brand keeps a clip brief and 1-3 picture assets as clip references', () => {
  const ok = validateBrand({ ...BASE, clipBrief: '  Huy, 30, blue overalls.  ', clipRefs: ['huy-front.png', 'huy-side.jpg', 'drill.webp'] });
  assert.equal(ok.clipBrief, 'Huy, 30, blue overalls.');
  assert.deepEqual(ok.clipRefs, ['huy-front.png', 'huy-side.jpg', 'drill.webp']);
  const none = validateBrand({ ...BASE, clipBrief: '  ', clipRefs: [] });
  assert.ok(!('clipBrief' in none) && !('clipRefs' in none), 'empty values drop out');
  assert.throws(() => validateBrand({ ...BASE, clipBrief: 'x'.repeat(1501) }), /clipBrief must be text of at most 1500/);
  assert.throws(() => validateBrand({ ...BASE, clipBrief: 42 }), /clipBrief/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: ['a.png', 'b.png', 'c.png', 'd.png'] }), /clipRefs must list at most 3/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: ['clip.mp4'] }), /clipRefs/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: ['logo.svg'] }), /clipRefs/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: ['../other/a.png'] }), /clipRefs/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: 'a.png' }), /clipRefs/);
  assert.throws(() => validateBrand({ ...BASE, clipRefs: ['a.png', 'a.png'] }), /twice/);
});

const SCENE = { n: 3, title: 'DIAGNOSTIC TEST', notes: ['Huy holds the multimeter probes on the battery.', 'Close-up, slow push in.'] };

test('a scene prompt is the clip brief, SCENE, ACTION and the aspect, in that order', () => {
  assert.equal(clipPrompt('Huy, 30, blue overalls.', SCENE, '9:16'),
    'Huy, 30, blue overalls.\n\nSCENE: DIAGNOSTIC TEST\n\nACTION: Huy holds the multimeter probes on the battery.\nClose-up, slow push in.\n\nVertical 9:16 composition.');
  assert.equal(clipPrompt('', { n: 1, title: 'OPEN', notes: [] }, '16:9'), 'SCENE: OPEN\n\nHorizontal 16:9 composition.');
  assert.deepEqual(['9:16', '4:5', '2:3', '16:9', '1:1', '21:9', 'x'].map(clipAspect), ['9:16', '9:16', '9:16', '16:9', '16:9', '16:9', '16:9']);
});

test('a prompt past the Generate cap is refused with the cut', () => {
  const prompt = clipPrompt('x'.repeat(1500), { ...SCENE, notes: ['y'.repeat(600)] }, '9:16');
  const over = prompt.length - MAX_PROMPT_CHARS;
  assert.ok(over > 0);
  assert.throws(() => validateRequest({ kind: 'video', prompt }, optionsFor(loadStudioConfig().generate)),
    (e) => e.code === 400 && e.message.includes(`limit ${MAX_PROMPT_CHARS}: cut ${over}`));
});

const P = 'zz-test-scene-clip';
const clean = () => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(within(DIRS[k], P), { recursive: true, force: true }));
const TEXT = 'TITLE: Clip test\nVOICE: Two scenes.\nFORMAT: Vertical 9:16\n\nSCENE 1 — OPEN (0–4 seconds)\nHuy walks into the shop.\nVOICE: He walks in.\n\nSCENE 2 — DRILL (4–8 seconds)\nCLIP: none-yet.mp4\nThe drill stops on wood.\n';

test('the script check gives each scene its notes and clip prompt, and the brand\'s references', async (t) => {
  clean();
  t.after(clean);
  createProject({ id: P, name: 'Scene Clip' });
  const brandFile = within(DIRS.profiles, P, 'brand.json');
  writeJson(brandFile, { ...readJson(brandFile), clipBrief: 'Huy, 30, blue overalls.', clipRefs: ['huy.png'] });
  const r = await importSceneScript(P, TEXT, { check: true, file: 'clip.txt' });
  assert.ok(r.errors.length, 'scene 1 has no clip yet, and its Generate clip still shows');
  assert.deepEqual(r.clip, { aspect: '9:16', refs: ['huy.png'], brief: true });
  assert.deepEqual(r.scenes.map((s) => [s.n, s.title, s.notes]), [[1, 'OPEN', ['Huy walks into the shop.']], [2, 'DRILL', ['The drill stops on wood.']]]);
  assert.equal(r.scenes[0].prompt, 'Huy, 30, blue overalls.\n\nSCENE: OPEN\n\nACTION: Huy walks into the shop.\n\nVertical 9:16 composition.');
});

test('a saved clip goes into its scene\'s CLIP line, or a new one under the SCENE line', () => {
  const text = 'TITLE: T\n\nSCENE 1 — A (0–4 seconds)\nCLIP: a.mp4 0:00-0:04\nVOICE: One.\n\nSCENE 2 — B (4–8 seconds)\nVOICE: Two.\nEnd card: Bye\nCLIP: wrong.mp4\n';
  assert.equal(insertClip(text, 1, 'gen.mp4'), text.replace('CLIP: a.mp4 0:00-0:04', 'CLIP: a.mp4 0:00-0:04, gen.mp4'));
  assert.equal(insertClip(text, 2, 'b.mp4'), text.replace('SCENE 2 — B (4–8 seconds)\n', 'SCENE 2 — B (4–8 seconds)\nCLIP: b.mp4\n'), 'the end card is not scene 2');
  assert.equal(insertClip(text, 1, 'a.mp4'), text, 'a listed clip is not added twice');
  assert.equal(insertClip(text, 9, 'x.mp4'), null);
  assert.equal(insertClip('SCENE 1 — A (0–4 s)\r\nCLIP:\r\nVOICE: x', 1, 'c.mp4'), 'SCENE 1 — A (0–4 s)\r\nCLIP: c.mp4\r\nVOICE: x', 'CRLF and an empty CLIP line');
  assert.equal(insertClip('SCENE 1 — A (0–4 s)\nACTION:\nCLIP: z.mp4', 1, 'c.mp4'), 'SCENE 1 — A (0–4 s)\nACTION:\nCLIP: z.mp4, c.mp4', 'a bare label (ACTION:) is part of the scene');
  assert.equal(insertClip('Cảnh 2 – Tìm nguyên nhân\nCreate an 8-second video.\n\nCảnh 3 – Sửa\n', 2, 'linh-2.mp4'), 'Cảnh 2 – Tìm nguyên nhân\nCLIP: linh-2.mp4\nCreate an 8-second video.\n\nCảnh 3 – Sửa\n', 'a Vietnamese scene line');
});
