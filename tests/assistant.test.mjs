// The Assistant (server/assistant.mjs): a typed line becomes one intent, read intents answer from the files, every
// write comes back as a proposal, and only an approval runs it. No model anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson, readJson } from '../engine/core.mjs';
import { validateBrief, saveBrief, setStatus, loadBrand } from '../engine/jobs.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { parseAsk, createAssistant, COMMANDS, BRAND_FIELDS } from '../server/assistant.mjs';

const P = 'zz-assistant';
const BRAND = validateBrand({
  name: 'Assist Co', colors: { primary: '#262524', primary2: '#4682ff', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5c5c', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
});

function project(t) {
  t.after(() => ['briefs', 'out', 'profiles', 'sequences'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  fs.mkdirSync(path.join(DIRS.profiles, P, 'assets'), { recursive: true });
  writeJson(path.join(DIRS.profiles, P, 'brand.json'), BRAND);
}
function job(id, format = '16:9', status = 'queued') {
  saveBrief(validateBrief({ id, project: P, template: 'explainer', format, duration: 30, director: 'seat', message: 'm' }));
  if (status !== 'queued') setStatus(P, id, { status, step: 9 }, 'test');
}
const calls = [];
const deps = {
  user: 'tester', providers: () => ({ default: 'seat', providers: { seat: {} } }), assertVoiceFits: () => {},
  nextRun: () => ({ label: 'Claude seat', model: 'claude-sonnet-5-5', jobs: [{ id: 'a-16x9' }, { id: 'b-16x9' }] }),
  startDirector: async (args) => { calls.push(['director', args]); return { jobs: ['a-16x9'] }; },
  makeClip: async (p, asset, body) => { calls.push(['clip', asset, body]); return { name: `${body.name}.mp4` }; },
  saveBrand: (p, brand) => { calls.push(['brand', brand]); writeJson(path.join(DIRS.profiles, P, 'brand.json'), brand); },
};
const make = (cfg = {}) => createAssistant(deps, { approvalMinutes: 10, maxOpen: 20, freeform: false, ...cfg });

/* ---------- parsing ---------- */
test('a slash command and a plain sentence land on the same intent', () => {
  assert.deepEqual(parseAsk('/brief explainer 9:16 Our October offer').args, { template: 'explainer', format: '9:16', message: 'Our October offer' });
  assert.deepEqual(parseAsk('new explainer 9:16 about our October offer').args, { template: 'explainer', format: '9:16', message: 'our October offer' });
  assert.deepEqual(parseAsk('create a social-teaser video: "Big sale"').args, { template: 'social-teaser', format: null, message: 'Big sale' });
  assert.equal(parseAsk('/status a-16x9').args.job, 'a-16x9');
  assert.equal(parseAsk('which jobs are waiting?').intent, 'status');
  assert.deepEqual(parseAsk('run the director on a-16x9').args, { job: 'a-16x9' });
  assert.deepEqual(parseAsk('set motion to cinematic').args, { field: 'motion', value: 'cinematic' });
  assert.deepEqual(parseAsk('/brand subtitles.style = pill').args, { field: 'subtitles.style', value: 'pill' });
  assert.deepEqual(parseAsk('cut a clip from talk.mp4 0:04-0:12 as intro').args, { asset: 'talk.mp4', from: 4, to: 12, name: 'intro' });
  assert.deepEqual(parseAsk('/sequence a-16x9, b-16x9 as Launch film').args, { parts: ['a-16x9', 'b-16x9'], title: 'Launch film' });
  assert.equal(parseAsk('/help').intent, 'help');
  assert.equal(parseAsk('/render a-16x9').intent, 'unknown');
  assert.equal(parseAsk('hello there').intent, 'unknown');
  assert.throws(() => parseAsk('   '), /Type a question/);
  assert.throws(() => parseAsk('x'.repeat(801)), /at most 800/);
});

test('the command list and the brand fields are the ones the panel offers', () => {
  assert.ok(COMMANDS.every((c) => c.name.startsWith('/') && c.usage && c.help));
  assert.ok(!COMMANDS.some((c) => /render|approve/.test(c.name)));
  assert.ok(['motion', 'subtitles.style', 'wipe', 'blend', 'colors.primary', 'voice.voice'].every((k) => BRAND_FIELDS[k]));
});

/* ---------- read answers ---------- */
test('status answers from the briefs and never proposes', async (t) => {
  project(t);
  job('a-16x9'); job('b-16x9', '16:9', 'done');
  const as = make();
  const all = await as.ask({ project: P, text: '/status' });
  assert.equal(all.proposal, undefined);
  assert.match(all.text, /2 jobs; 1 waiting for the Director/);
  const one = await as.ask({ project: P, text: 'status of b-16x9' });
  assert.match(one.text, /b-16x9: done/);
  await assert.rejects(as.ask({ project: P, text: '/status nope' }), /No job nope/);
  const help = await as.ask({ project: P, text: 'help' });
  assert.equal(help.rows.length, COMMANDS.length);
  const unknown = await as.ask({ project: P, text: '/render a-16x9' });
  assert.match(unknown.text, /do not know \/render/);
});

test('suggestions follow what the project holds', async (t) => {
  project(t);
  const as = make();
  let s = as.suggestions(P);
  assert.equal(s.scope.label, 'Assist Co');
  assert.ok(s.suggestions.some((x) => x.ask.startsWith('/brief')));
  job('a-16x9', '16:9', 'done'); job('b-16x9', '16:9', 'done'); job('c-16x9');
  s = as.suggestions(P);
  assert.ok(s.suggestions.some((x) => x.ask === '/director'));
  assert.ok(s.suggestions.some((x) => x.ask.split(' ').slice(1).sort().join(' ') === 'a-16x9 b-16x9'));
  assert.ok(s.suggestions.some((x) => x.ask === '/brand motion cinematic'));
});

/* ---------- proposals ---------- */
test('a brief is written only on approval, with a free id and the template length', async (t) => {
  project(t);
  const as = make();
  const r = await as.ask({ project: P, text: 'new explainer 9:16 about our October offer' });
  assert.equal(r.proposal.action, 'brief');
  assert.equal(r.proposal.preview.title, 'New brief our-october-offer-9x16');
  assert.ok(!fs.existsSync(path.join(DIRS.briefs, P, 'our-october-offer-9x16.json')));
  const done = await as.approve(r.proposal.id);
  assert.equal(done.changed, 'jobs');
  const brief = readJson(path.join(DIRS.briefs, P, 'our-october-offer-9x16.json'));
  assert.equal(brief.duration, 20);
  assert.equal(brief.createdBy, 'tester');
  // The same ask again gets the next free id; the used proposal cannot be approved twice.
  const again = await as.ask({ project: P, text: 'new explainer 9:16 about our October offer' });
  assert.equal(again.proposal.preview.title, 'New brief our-october-offer-9x16-2');
  await assert.rejects(as.approve(r.proposal.id), /expired or was already used/);
  await assert.rejects(as.ask({ project: P, text: '/brief 16:9 no template here' }), /Name a template/);
  await assert.rejects(as.ask({ project: P, text: '/brief explainer' }), /Say what the video/);
});

test('a Director run goes through startDirector with the one job asked for', async (t) => {
  project(t);
  job('a-16x9'); job('b-16x9');
  const as = make();
  const r = await as.ask({ project: P, text: '/director a-16x9' });
  assert.deepEqual(r.proposal.preview.rows.find(([k]) => k === 'Jobs'), ['Jobs', 'a-16x9']);
  calls.length = 0;
  await as.approve(r.proposal.id);
  assert.deepEqual(calls, [['director', { project: P, job: 'a-16x9' }]]);
  await assert.rejects(as.ask({ project: P, text: '/director zzz' }), /not waiting/);
});

test('a sequence needs two jobs of one format and saves as a draft', async (t) => {
  project(t);
  job('a-16x9', '16:9', 'done'); job('b-16x9', '16:9', 'done'); job('c-9x16', '9:16', 'done');
  const as = make();
  await assert.rejects(as.ask({ project: P, text: '/sequence a-16x9' }), /at least two/);
  await assert.rejects(as.ask({ project: P, text: '/sequence a-16x9 c-9x16' }), /share one format/);
  await assert.rejects(as.ask({ project: P, text: '/sequence a-16x9 nope' }), /No job nope/);
  const r = await as.ask({ project: P, text: 'make a sequence of a-16x9 and b-16x9 as Launch film' });
  assert.equal(r.proposal.preview.title, 'New sequence launch-film-16x9');
  const done = await as.approve(r.proposal.id);
  assert.equal(done.changed, 'sequences');
  const seq = readJson(path.join(DIRS.sequences, P, 'launch-film-16x9.json'));
  assert.deepEqual([seq.parts, seq.format, seq.title], [['a-16x9', 'b-16x9'], '16:9', 'Launch film']);
});

test('a clip needs a video asset and a forward span', async (t) => {
  project(t);
  fs.writeFileSync(path.join(DIRS.profiles, P, 'assets', 'talk.mp4'), 'x');
  fs.writeFileSync(path.join(DIRS.profiles, P, 'assets', 'pic.png'), 'x');
  const as = make();
  await assert.rejects(as.ask({ project: P, text: '/clip talk.mp4' }), /Give the asset and a span/);
  await assert.rejects(as.ask({ project: P, text: '/clip nope.mp4 1-2' }), /No asset nope.mp4/);
  await assert.rejects(as.ask({ project: P, text: '/clip pic.png 1-2' }), /video asset/);
  await assert.rejects(as.ask({ project: P, text: '/clip talk.mp4 5-2' }), /end after it starts/);
  const r = await as.ask({ project: P, text: '/clip talk.mp4 0:04-0:12' });
  assert.equal(r.proposal.preview.title, 'Clip talk-4-12.mp4');
  calls.length = 0;
  const done = await as.approve(r.proposal.id);
  assert.equal(done.changed, 'brand');
  assert.deepEqual(calls, [['clip', 'talk.mp4', { in: 4, out: 12, name: 'talk-4-12' }]]);
});

test('a brand change shows before and after, checks the value, and keeps wipe and blend exclusive', async (t) => {
  project(t);
  const as = make();
  await assert.rejects(as.ask({ project: P, text: '/brand motion wild' }), /motion takes/);
  await assert.rejects(as.ask({ project: P, text: '/brand colors.primary red' }), /#rrggbb/);
  await assert.rejects(as.ask({ project: P, text: '/brand secret x' }), /I can change/);
  const r = await as.ask({ project: P, text: 'set motion to cinematic' });
  assert.deepEqual(r.proposal.preview.rows.slice(0, 2), [['Before', 'not set'], ['After', 'cinematic']]);
  assert.equal(loadBrand(P).motion, undefined);
  await as.approve(r.proposal.id);
  assert.equal(loadBrand(P).motion, 'cinematic');
  const w = await as.ask({ project: P, text: '/brand wipe iris' });
  await as.approve(w.proposal.id);
  const b = await as.ask({ project: P, text: '/brand blend whip' });
  assert.ok(b.proposal.preview.rows.some(([k, v]) => k === 'Also' && /wipe off/.test(v)));
  await as.approve(b.proposal.id);
  assert.deepEqual([loadBrand(P).blend, loadBrand(P).wipe], ['whip', undefined]);
  const off = await as.ask({ project: P, text: '/brand blend off' });
  await as.approve(off.proposal.id);
  assert.equal(loadBrand(P).blend, undefined);
  const duck = await as.ask({ project: P, text: '/brand music.duck true' });
  await as.approve(duck.proposal.id);
  assert.equal(loadBrand(P).music.duck, true);
});

test('proposals expire, cancel, and are capped', async (t) => {
  project(t);
  const as = make({ approvalMinutes: 0, maxOpen: 2 });
  const r = await as.ask({ project: P, text: '/brand motion clean' });
  await assert.rejects(as.approve(r.proposal.id), /expired/);
  const live = make({ maxOpen: 2 });
  const a = await live.ask({ project: P, text: '/brand motion clean' });
  assert.deepEqual(live.reject(a.proposal.id), { ok: true, cancelled: true });
  assert.equal(live.approvals().length, 0);
  await live.ask({ project: P, text: '/brand motion clean' });
  await live.ask({ project: P, text: '/brand motion kinetic' });
  await assert.rejects(live.ask({ project: P, text: '/brand motion editorial' }), /2 proposals are waiting/);
  assert.equal(live.capabilities().freeform, false);
});

/* ---------- freeform: a model picks the intent ---------- */
const picked = (intent, args, reply = null) => ({ intent, args, reply });
const fakePicker = (answer) => {
  const asks = [];
  return {
    asks,
    models: () => [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }],
    state: () => ({ freeform: true, hasKey: true, keyEnv: 'GEMINI_API_KEY', usedToday: asks.length, maxAsksPerDay: 200, paused: null }),
    async pick(req) { asks.push(req); return { ...(typeof answer === 'function' ? answer(req) : answer), model: req.model }; },
  };
};

test('with a model, only a line the parser does not know goes to the picker, and its pick takes the proposal road', async (t) => {
  project(t); job('a-16x9');
  const picker = fakePicker(picked('brand', { field: 'motion', value: 'cinematic' }));
  const a = createAssistant({ ...deps, picker }, { approvalMinutes: 10, maxOpen: 20, freeform: true });
  assert.deepEqual(a.capabilities().models, [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }]);
  assert.equal(a.capabilities().model.hasKey, true);

  const known = await a.ask({ project: P, text: '/status', model: 'gemini-3.8-flash' });
  assert.equal(known.intent, 'status');
  assert.equal(known.via, undefined);
  assert.equal(picker.asks.length, 0, 'a known line never reaches the model');

  const r = await a.ask({ project: P, text: 'make the whole thing feel like a film', model: 'gemini-3.8-flash' });
  assert.equal(picker.asks.length, 1);
  assert.equal(picker.asks[0].model, 'gemini-3.8-flash');
  assert.match(picker.asks[0].context, /Templates: .*explainer/);
  assert.match(picker.asks[0].context, /Jobs: a-16x9 \(explainer, 16:9, queued for the Director\)/);
  assert.match(picker.asks[0].context, /Brand fields: motion: /);
  assert.equal(r.intent, 'brand');
  assert.equal(r.via, 'gemini-3.8-flash');
  assert.deepEqual(r.proposal.preview.rows.slice(0, 2), [['Before', 'not set'], ['After', 'cinematic']]);

  await assert.rejects(() => a.ask({ project: P, text: 'make the whole thing feel like a film' }), /Name a template/, 'no model: the parser alone answers');
  assert.equal(picker.asks.length, 1);

  const bad = fakePicker(picked('brand', { field: 'colors.primary', value: 'red' }));
  const b = createAssistant({ ...deps, picker: bad }, { approvalMinutes: 10, maxOpen: 20, freeform: true });
  await assert.rejects(() => b.ask({ project: P, text: 'paint it red', model: 'gemini-3.8-flash' }), (e) => e.code === 400 && /#rrggbb/.test(e.message), 'a pick is checked like a typed line');

  const unknown = fakePicker(picked('unknown', {}, 'I can queue briefs, run the Director, join sequences, cut clips and change the brand.'));
  const u = createAssistant({ ...deps, picker: unknown }, { approvalMinutes: 10, maxOpen: 20, freeform: true });
  const ur = await u.ask({ project: P, text: 'render everything now', model: 'gemini-3.8-flash' });
  assert.equal(ur.intent, 'unknown');
  assert.match(ur.text, /^I can queue briefs/);
});

test('freeform off, or no picker, refuses a model ask with 400', async (t) => {
  project(t);
  const off = createAssistant({ ...deps, picker: fakePicker(picked('help', {})) }, { approvalMinutes: 10, maxOpen: 20, freeform: false });
  await assert.rejects(() => off.ask({ project: P, text: 'hello there', model: 'gemini-3.8-flash' }), (e) => e.code === 400 && /freeform/.test(e.message));
  assert.deepEqual(off.capabilities().models, []);
  const bare = make({ freeform: true });
  await assert.rejects(() => bare.ask({ project: P, text: 'hello there', model: 'gemini-3.8-flash' }), (e) => e.code === 400);
  assert.equal(bare.capabilities().model, null);
});
