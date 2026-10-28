// Quick mode end to end (plan quick-video T15): for each quick template, a hand-written outline is committed through
// the engine and prepared for real (Chrome + ffmpeg, estimated timing, no voice). Never approved, rendered or sequenced.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson, loadStudioConfig } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, jobFile, createProject } from '../engine/jobs.mjs';
import { commit, prepare } from '../engine/pipeline.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { PACING } from '../engine/review.mjs';
import { SFX_FILE } from '../engine/sfx.mjs';
import { hasChrome } from './helpers/chrome-folder.mjs';

// Made-up demo facts, used only inside the throwaway projects.
const SOURCE = {
  name: 'Brightwell Kettle', url: '', image: 'pack.png',
  bullets: [
    { text: 'The Brightwell Kettle is here', ref: 'https://example.com/kettle' },
    { text: 'Boils one litre in 3 minutes', ref: 'https://example.com/kettle' },
    { text: 'Keeps water hot for 2 hours', ref: 'https://example.com/kettle' },
    { text: 'Free delivery on every order', ref: 'https://example.com/delivery' },
  ],
  facts: [{ text: '30-day returns, no questions asked', ref: 'brief.facts[0]' }],
};
const OPEN = { text: 'Brightwell Kettle', say: 'Meet the Brightwell Kettle.', source: 'bullets[0]' };
const FAST = { label: 'Fast boil', text: 'One litre in three minutes', say: 'It boils one litre in three minutes.', source: 'bullets[1]' };
const HOT = { label: 'Stays hot', text: 'Hot water for two hours', say: 'Your water stays hot for two hours.', source: 'bullets[2]' };
const FREE = { label: 'Free delivery', text: 'On every order', say: 'Delivery is free on every order.', source: 'bullets[3]' };
const CLOSE = { text: 'Order yours today', button: 'Shop now', say: 'Order yours today.' };
const NUMBER = { tag: '3 min', number: { value: 3, unit: 'min' } };

// One format per template, one look per template; `page` holds what that look puts in index.html.
const CASES = [
  {
    template: 'explainer', format: '16:9', duration: 30,
    outline: { mood: 'premium', headline: OPEN, points: [FAST, HOT, FREE], cta: CLOSE },
    kinds: ['title', 'step', 'step', 'step', 'cta'],
    page: ['id="grain"', 'id="leak"'], gl: false,
  },
  {
    template: 'product-demo', format: '9:16', duration: 30,
    outline: { mood: 'energetic', headline: OPEN, points: [FREE, { ...FAST, ...NUMBER }, HOT], cta: CLOSE },
    kinds: ['hero', 'benefit', 'stat', 'benefit', 'cta'],
    page: ['id="glb"', 'id="glw"', 'assets/pack.png'], gl: true,
  },
  {
    template: 'social-teaser', format: '9:16', duration: 15,
    outline: { mood: 'bold', headline: OPEN, points: [{ ...FAST, ...NUMBER }], cta: CLOSE },
    kinds: ['hero', 'stat', 'cta'],
    page: ['id="glb"', 'id="cutpanel"', 'assets/pack.png'], gl: true,
  },
];

const clean = (P) => ['profiles', 'briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true }));

for (const c of CASES) {
  test(`quick ${c.template} ${c.format}: an outline commits and prepares to a reviewable storyboard in the ${c.outline.mood} look`, { timeout: 600000 }, async (t) => {
    if (!(await hasChrome(loadStudioConfig().engine.chromeChannel))) { t.skip('Chrome is not available'); return; }
    const P = `zz-test-quick-smoke-${c.template}`, ID = `quick-${c.format.replace(':', 'x')}`;
    clean(P);
    t.after(() => clean(P));
    createProject({ id: P, name: 'Smoke Test' });
    const brandFile = path.join(DIRS.profiles, P, 'brand.json');
    writeJson(brandFile, { ...readJson(brandFile), logoText: 'Smoke Test', voice: { tts: 'none' }, music: { file: null, gainDb: -18 } });
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=800x1000', '-frames:v', '1', path.join(DIRS.profiles, P, 'assets', 'pack.png')], { timeoutMs: 30000 });
    saveBrief(validateBrief({ project: P, id: ID, template: c.template, format: c.format, duration: c.duration, message: 'm', quick: true }));
    setStatus(P, ID, { status: 'scripting', step: 4 }, 'test');
    writeJson(jobFile(P, ID, 'source.json'), { ...SOURCE, locks: {} });
    writeJson(jobFile(P, ID, 'outline.draft.json'), c.outline);

    const r = commit(P, ID, 'outline', 'test');
    assert.deepEqual([r.repairs, r.warnings], [[], []], JSON.stringify(r));
    const script = readJson(jobFile(P, ID, 'script.json'));
    assert.deepEqual([script.generated, script.look], ['outline', c.outline.mood]);
    assert.deepEqual(script.scenes.map((s) => s.kind), c.kinds);

    const st = await prepare(P, ID, 'test');
    assert.equal(st.status, 'awaiting_review', JSON.stringify(st.lint?.findings));
    assert.equal(st.lint.errors, 0);
    const pace = readJson(jobFile(P, ID, PACING));
    assert.deepEqual(pace.scenes.map((s) => s.kind), c.kinds);
    assert.deepEqual(pace.scenes.filter((s) => s.flags.includes('repeat')).map((s) => s.id), [], 'no "same layout" run');
    // The look reached the page and the cut sounds: brand.json sets none of these.
    const html = fs.readFileSync(jobFile(P, ID, 'index.html'), 'utf8');
    for (const mark of c.page) assert.ok(html.includes(mark), `${c.outline.mood}: ${mark}`);
    assert.equal(html.includes('data-gl'), c.gl);
    assert.ok(readJson(jobFile(P, ID, 'timing.json')).sfx && fs.existsSync(jobFile(P, ID, SFX_FILE)), 'the look\'s cut sound');
  });
}
