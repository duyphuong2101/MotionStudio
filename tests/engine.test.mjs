import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertId, within, jsonForScript, escapeHtml, DIRS, loadStudioConfig, writeJson } from '../engine/core.mjs';
import {
  humanEdit, mergeRespectingLocks, loadTemplate, validateBrief, PLATFORMS, createProject, hostsFromSite,
  deleteProject, deleteJob, saveBrief, setStatus, updateBrief, getStatus, loadBrief, jobFile, listTemplates, sequenceFile,
} from '../engine/jobs.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { geometry } from '../templates/kit.mjs';
import { validateScript, validateSource, sourceRefProblems } from '../engine/script.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { build } from '../templates/product-demo/template.mjs';

const beats = loadTemplate('product-demo').beats;
const script = () => ({
  lang: 'en',
  scenes: [
    { id: 'hero', kind: 'hero', vo: 'Meet the product.', title: 'Product', source: 'facts[0]' },
    { id: 'b1', kind: 'stat', vo: 'Twelve hours of protection.', kicker: 'Absorbency', stat: { value: 12, unit: 'h' }, text: 'of protection', chip: 'Up to 12 hours', icon: 'drop', source: 'bullets[0]' },
    { id: 'b2', kind: 'benefit', vo: 'Guards on both sides.', kicker: 'Leak guards', text: 'Tall guards', chip: 'Peace of mind', icon: 'shield', source: 'bullets[1]' },
    { id: 'cta', kind: 'cta', vo: 'Try a sample.', title: 'Try a sample', button: 'Get it' },
  ],
});

test('every scene source points at a real source.json line or a filled brief field', () => {
  const source = { name: 'n', bullets: [{ text: 'a', ref: 'r' }, { text: 'b', ref: 'r' }], facts: ['x'] };
  assert.deepEqual(sourceRefProblems(script(), source), []);
  assert.deepEqual(validateScript(script(), beats, { source }).errors, []);
  const s = script();
  s.scenes[1].source = 'bullets[0], bullets[5]';
  s.scenes[2].source = 'bullets[1],facts[3]';
  s.scenes[3].source = 'brief.cta';
  assert.deepEqual(sourceRefProblems(s, source, { cta: '' }), [
    'b1: source "bullets[5]" is not a line of source.json',
    'b2: source "facts[3]" is not a line of source.json',
    'cta: source "brief.cta" is not a line of source.json or a filled brief field',
  ]);
  assert.deepEqual(sourceRefProblems(s, source, { cta: 'Book a demo' }).length, 2, 'a filled brief field is a source');
  assert.ok(validateScript(s, beats, { source, brief: { cta: 'Book a demo' } }).errors.some((e) => /bullets\[5\]/.test(e)));
  assert.deepEqual(validateScript(s, beats).errors, [], 'without source.json nothing is checked');
  s.scenes[1].source = 'the website';
  assert.match(sourceRefProblems(s, source).join(), /"the website"/);
});

test('ids and paths refuse traversal', () => {
  assert.throws(() => assertId('../x'));
  assert.throws(() => assertId('Upper'));
  assert.equal(assertId('megamax-9x16'), 'megamax-9x16');
  assert.throws(() => within(DIRS.out, '..', 'secret'));
  assert.equal(within(DIRS.out, 'nsc', 'a'), path.join(DIRS.out, 'nsc', 'a'));
});

test('jsonForScript cannot close a script tag', () => {
  const out = jsonForScript({ t: '</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>'));
  assert.equal(JSON.parse(out).t, '</script><script>alert(1)</script>');
  assert.equal(escapeHtml('<b a="1">'), '&lt;b a=&quot;1&quot;&gt;');
});

test('valid script passes, broken order and limits fail', () => {
  assert.deepEqual(validateScript(script(), beats).errors, []);
  const noCta = script(); noCta.scenes.pop();
  assert.ok(validateScript(noCta, beats).errors.some((e) => e.includes('cta')));
  const long = script(); long.scenes[1].chip = 'x'.repeat(60);
  assert.ok(validateScript(long, beats).errors.some((e) => e.includes('chip')));
  const badIcon = script(); badIcon.scenes[2].icon = 'unicorn';
  assert.ok(validateScript(badIcon, beats).errors.some((e) => e.includes('icon')));
  const missingAsset = script(); missingAsset.scenes[0].asset = 'nope.png';
  assert.ok(validateScript(missingAsset, beats, { assets: [] }).errors.some((e) => e.includes('asset')));
});

test('every limit error says how much to cut, in chars or in words', () => {
  const ex = loadTemplate('explainer').beats;
  const title = { id: 'intro', kind: 'title', vo: 'Hi.', title: 'x'.repeat(50) };
  const step = { id: 's1', kind: 'step', vo: 'Ask.', title: 'Ask', icon: 'chat', source: 'bullets[0]' };
  assert.deepEqual(validateScript({ scenes: [title, step] }, ex).errors, ['intro: title is 50 chars, limit 44: cut 6']);
  const words = Array.from({ length: ex.limits.voWords + 3 }, () => 'word').join(' ');
  assert.deepEqual(validateScript({ scenes: [{ ...title, title: 'Ok', vo: words }, step] }, ex).errors, [`intro: voice line has ${ex.limits.voWords + 3} words, limit ${ex.limits.voWords}: cut 3`]);
  const long = script(); long.scenes[1].chip = 'x'.repeat(60);
  assert.ok(validateScript(long, beats).errors.includes(`b1: chip is 60 chars, limit ${beats.limits.chip}: cut ${60 - beats.limits.chip}`));
});

test('source needs a ref for every claim', () => {
  assert.deepEqual(validateSource({ name: 'X', bullets: [{ text: 'a', ref: 'p1' }] }), []);
  assert.ok(validateSource({ name: 'X', bullets: [{ text: 'a' }] }).length);
});

test('human edits lock fields and director commits keep them', () => {
  const before = script();
  const after = script();
  after.scenes[1].chip = 'Twelve hours dry';
  const { doc, changed } = humanEdit('script', before, after, 'phuong', 'tone');
  assert.deepEqual(changed, ['scene:b1.chip']);
  assert.equal(doc.locks['scene:b1.chip'].by, 'phuong');

  const draft = script();
  draft.scenes[1].chip = 'Director rewrite';
  draft.scenes[1].text = 'new text';
  const merged = mergeRespectingLocks('script', doc, draft);
  assert.equal(merged.doc.scenes[1].chip, 'Twelve hours dry');
  assert.equal(merged.doc.scenes[1].text, 'new text');
  assert.deepEqual(merged.kept, ['scene:b1.chip']);
});

test('source bullet removal is locked against re-fetch', () => {
  const before = { name: 'X', bullets: [{ text: 'a', ref: '1' }, { text: 'b', ref: '2' }] };
  const after = { name: 'X', bullets: [{ text: 'a', ref: '1' }] };
  const { doc } = humanEdit('source', before, after, 'p');
  const refetch = { name: 'X', bullets: [{ text: 'a', ref: '1' }, { text: 'b', ref: '2' }] };
  assert.equal(mergeRespectingLocks('source', doc, refetch).doc.bullets.length, 1);
});

test('a UI edit of a template-specific scene field (testimonial quote, data-story items) is locked', () => {
  const q = { id: 'q1', kind: 'quote', vo: 'Hear it.', quote: 'It just works.', author: 'Ana', source: 'facts[0]' };
  const bars = { id: 'b1', kind: 'bars', vo: 'Up.', title: 'Growth', items: [{ label: 'A', value: 1 }], source: 'facts[1]' };
  const before = { scenes: [q, bars] };
  const after = { scenes: [{ ...q, quote: 'Saved us hours.' }, { ...bars, items: [{ label: 'A', value: 2 }] }] };
  const { doc, changed } = humanEdit('script', before, after, 'phuong');
  assert.deepEqual(changed.sort(), ['scene:b1.items', 'scene:q1.quote']);
  const draft = { scenes: [{ ...q, quote: 'Director rewrite.' }, { ...bars, items: [] }] };
  const merged = mergeRespectingLocks('script', doc, draft);
  assert.equal(merged.doc.scenes[0].quote, 'Saved us hours.');
  assert.deepEqual(merged.doc.scenes[1].items, [{ label: 'A', value: 2 }]);
});

test('every scene field locked before still locks', () => {
  for (const f of ['vo', 'title', 'subtitle', 'kicker', 'text', 'chip', 'stat', 'icon', 'decor', 'check', 'button', 'url', 'asset', 'packLine', 'source', 'shots', 'pace']) {
    const { changed } = humanEdit('script', { scenes: [{ id: 's', kind: 'x' }] }, { scenes: [{ id: 's', kind: 'x', [f]: 'v' }] }, 'p');
    assert.deepEqual(changed, [`scene:s.${f}`], f);
  }
});

test('timing grows with words and stays ordered', () => {
  const t = estimateTiming(script(), loadStudioConfig().timing, 'en');
  assert.equal(t.scenes.length, 4);
  for (let i = 1; i < t.scenes.length; i++) assert.equal(t.scenes[i].start, t.scenes[i - 1].end);
  assert.ok(t.words.every((w, i, a) => i === 0 || w.start >= a[i - 1].start));
  assert.equal(t.duration, t.scenes.at(-1).end);
});

test('brand validation rejects CSS injection', () => {
  const ok = {
    name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' },
  };
  assert.equal(validateBrand(ok).name, 'A');
  assert.throws(() => validateBrand({ ...ok, colors: { ...ok.colors, primary: 'red;}body{display:none' } }));
  assert.throws(() => validateBrand({ ...ok, fonts: { display: 'Inter";}', body: 'Inter' } }));
});

test('template escapes text and exposes seek', () => {
  const s = script();
  s.scenes[0].title = '<img src=x onerror=alert(1)>';
  const brand = validateBrand({
    name: 'A', colors: { primary: '#000000', primary2: '#111111', secondary: '#222222', bg: '#ffffff', ink: '#000000', muted: '#555555', onPrimary: '#ffffff' },
    fonts: { display: 'Inter', body: 'Inter' },
  });
  const html = build({ brand, script: s, timing: estimateTiming(s, loadStudioConfig().timing) });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('window.seek'));
});

test('pace stretches focus scenes and trims quick ones', () => {
  const wt = loadTemplate('app-walkthrough').beats;
  const s = {
    lang: 'en',
    scenes: [
      { id: 't', kind: 'title', vo: 'Hi.', title: 'X', pace: 'quick' },
      { id: 'q', kind: 'screen', vo: 'Find any customer,', title: 'A', pace: 'quick', shots: [{ asset: 'a.png' }], source: 'b' },
      { id: 'f', kind: 'screen', vo: 'Short line.', title: 'B', pace: 'focus', shots: [{ asset: 'a.png' }, { asset: 'a.png' }, { asset: 'a.png' }], source: 'b' },
    ],
  };
  assert.deepEqual(validateScript(s, wt, { assets: ['a.png'] }).errors, []);
  const t = estimateTiming(s, loadStudioConfig().timing, 'en', wt.pace);
  const len = (id) => { const x = t.scenes.find((y) => y.id === id); return x.end - x.start; };
  assert.ok(len('q') < 2.5, `quick scene ${len('q')}`);
  assert.ok(len('f') >= 3 * wt.pace.focus.perShot - 0.01, `focus scene ${len('f')}`);
});

test('shots are validated against assets and image bounds', () => {
  const wt = loadTemplate('app-walkthrough').beats;
  const base = { lang: 'en', scenes: [
    { id: 't', kind: 'title', vo: 'Hi.', title: 'X' },
    { id: 'a', kind: 'screen', vo: 'One.', title: 'A', shots: [{ asset: 'missing.png' }], source: 'b' },
    { id: 'b', kind: 'screen', vo: 'Two.', title: 'B', shots: [{ asset: 'a.png', focus: { x: 1800, y: 0, w: 400, h: 200 }, click: true }], source: 'b' },
  ] };
  const errs = validateScript(base, wt, { assets: ['a.png'] }).errors.join(' | ');
  assert.match(errs, /missing\.png/);
  assert.match(errs, /focus must be/);
  assert.match(errs, /click needs a cursor/);
});

test('a brief takes a platform only with a format that platform shows', () => {
  const base = { id: 'q3-16x9', project: 'nsc', template: 'explainer', format: '16:9', duration: 30, director: 'seat', message: 'Q3 in one minute.' };
  const ok = validateBrief({ ...base, platform: 'youtube', subject: 'Q3 results', facts: 'Revenue up 12%' });
  assert.equal(ok.platform, 'youtube');
  assert.equal(ok.subject, 'Q3 results');
  assert.equal(ok.facts, 'Revenue up 12%');
  assert.throws(() => validateBrief({ ...base, platform: 'tiktok' }), /TikTok takes 9:16, not 16:9/);
  assert.throws(() => validateBrief({ ...base, platform: 'myspace' }), /Unknown platform/);
  assert.equal(validateBrief(base).platform, '');
  assert.throws(() => validateBrief({ ...base, facts: 'x'.repeat(2001) }), /facts must be text/);
});

test('an old brief with sku keeps it as the subject', () => {
  const b = validateBrief({ id: 'megamax-9x16', project: 'nsc', template: 'product-demo', format: '9:16', duration: 20, director: 'seat', message: 'm', sku: 'MEGAMAX' });
  assert.equal(b.subject, 'MEGAMAX');
  assert.equal('sku' in b, false);
});

test('every platform lists at least one format some template renders', () => {
  const rendered = new Set(listTemplates().flatMap((t) => t.formats));
  for (const p of PLATFORMS) assert.ok(p.formats.length && p.formats.every((f) => rendered.has(f)), p.id);
});

test('the new aspect ratios get a frame size with a 1080 short side', () => {
  const ex = loadTemplate('explainer').beats;
  assert.deepEqual(sizeFor(ex, '4:5'), { width: 1080, height: 1350 });
  assert.deepEqual(sizeFor(ex, '2:3'), { width: 1080, height: 1620 });
  assert.deepEqual(sizeFor(ex, '21:9'), { width: 2520, height: 1080 });
});

test('a brief takes a new format only where template and platform both allow it', () => {
  const base = { id: 'q3-4x5', project: 'nsc', template: 'explainer', format: '4:5', duration: 30, director: 'seat', message: 'Q3 in one minute.' };
  assert.equal(validateBrief({ ...base, platform: 'feed' }).format, '4:5');
  assert.equal(validateBrief({ ...base, format: '2:3', platform: 'pinterest' }).platform, 'pinterest');
  assert.equal(validateBrief({ ...base, format: '21:9', platform: 'web' }).format, '21:9');
  assert.throws(() => validateBrief({ ...base, platform: 'tiktok' }), /TikTok takes 9:16, not 4:5/);
  assert.throws(() => validateBrief({ ...base, template: 'social-teaser' }), /supports formats: 9:16/);
});

test('geometry draws 4:5 square, 2:3 short portrait and 21:9 inside a centred 16:9 area', () => {
  const g45 = geometry({ width: 1080, height: 1350 });
  assert.ok(g45.square && !g45.port);
  const g23 = geometry({ width: 1080, height: 1620 });
  assert.ok(g23.port && g23.short);
  const g916 = geometry({ width: 1080, height: 1920 });
  assert.ok(g916.port && !g916.short);
  assert.equal(geometry({ width: 2520, height: 1080 }).padX(90), '390px');
  assert.equal(geometry({ width: 1920, height: 1080 }).padX(90), '90px');
});

test('a site becomes the hosts the director may fetch', () => {
  assert.deepEqual(hostsFromSite('https://www.Acme.com/shop?x=1'), ['www.acme.com', 'acme.com']);
  assert.deepEqual(hostsFromSite('acme.com'), ['acme.com', 'www.acme.com']);
  assert.deepEqual(hostsFromSite(''), []);
});

test('a new project gets a valid brand, a voice file and an empty assets folder', (t) => {
  const ids = ['zz-test-new', 'zz-test-copy'];
  t.after(() => ids.forEach((id) => fs.rmSync(path.join(DIRS.profiles, id), { recursive: true, force: true })));
  const dir = path.join(DIRS.profiles, 'zz-test-new');
  const made = createProject({ id: 'zz-test-new', name: 'Acme', site: 'acme.com' });
  assert.equal(made.brand.name, 'Acme');
  assert.deepEqual(made.brand.sources.allowedHosts, ['acme.com', 'www.acme.com']);
  assert.ok(fs.existsSync(path.join(dir, 'brand.json')) && fs.existsSync(path.join(dir, 'voice.md')) && fs.existsSync(path.join(dir, 'assets')));
  assert.throws(() => createProject({ id: 'zz-test-new', name: 'Acme' }), /already exists/);
  assert.throws(() => createProject({ id: '../x', name: 'Bad' }));
  assert.throws(() => createProject({ id: 'zz-test-noname', name: '' }), /name is required/);
  assert.ok(!fs.existsSync(path.join(DIRS.profiles, 'zz-test-noname')), 'a refused project leaves no folder');

  const nsc = JSON.parse(fs.readFileSync(path.join(DIRS.profiles, 'nsc', 'brand.json'), 'utf8'));
  const copy = createProject({ id: 'zz-test-copy', name: 'Copy', from: 'nsc' });
  assert.deepEqual(copy.brand.colors, nsc.colors);
  assert.equal(copy.brand.logo, null);
  assert.deepEqual(copy.brand.sources.allowedHosts, []);
});

test('deleting a project moves its folders to trash, and only when confirmed and idle', (t) => {
  const id = 'zz-test-del';
  let trashed = null;
  t.after(() => {
    for (const dir of [path.join(DIRS.profiles, id), path.join(DIRS.briefs, id), path.join(DIRS.out, id), trashed && path.join(DIRS.trash, trashed)]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  createProject({ id, name: 'Delete me' });
  saveBrief(validateBrief({ id: 'a-9x16', project: id, template: 'promo', format: '9:16', duration: 15, director: 'seat', message: 'm' }));
  setStatus(id, 'a-9x16', { status: 'rendering' }, 'test');

  assert.throws(() => deleteProject('zz-test-missing', 'zz-test-missing'), /Unknown project/);
  assert.throws(() => deleteProject(id, 'nope'), /Type the project id/);
  assert.throws(() => deleteProject(id, id), /Wait until these jobs finish: a-9x16/);

  setStatus(id, 'a-9x16', { status: 'done' }, 'test');
  const res = deleteProject(id, id);
  trashed = res.trash;
  assert.deepEqual(res.moved, ['out', 'briefs', 'profiles']);
  for (const kind of ['profiles', 'briefs', 'out']) {
    assert.ok(!fs.existsSync(path.join(DIRS[kind], id)), `${kind}/${id} is gone`);
    assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, kind)), `${kind} is in trash`);
  }
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'briefs', 'a-9x16.json')));
});

test('deleting a job moves its brief and output to trash, refused while busy or in a sequence', (t) => {
  const P = 'zz-test-deljob';
  const trashed = [];
  t.after(() => {
    for (const k of ['briefs', 'out', 'sequences']) fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true });
    trashed.forEach((d) => fs.rmSync(path.join(DIRS.trash, d), { recursive: true, force: true }));
  });
  const brief = { project: P, template: 'promo', format: '9:16', duration: 15, director: 'seat', message: 'm' };
  saveBrief(validateBrief({ ...brief, id: 'a-9x16' }));
  saveBrief(validateBrief({ ...brief, id: 'b-9x16' }));
  setStatus(P, 'a-9x16', { status: 'rendering' }, 'test');

  assert.throws(() => deleteJob(P, 'nope'), (e) => e.code === 404);
  assert.throws(() => deleteJob(P, '../x'), /Invalid job/);
  assert.throws(() => deleteJob(P, 'a-9x16'), (e) => e.code === 409 && /rendering/.test(e.message));

  setStatus(P, 'a-9x16', { status: 'done' }, 'test');
  writeJson(sequenceFile(P, 'reel'), { id: 'reel', project: P, format: '9:16', transition: 'cut', parts: ['a-9x16', 'b-9x16'] });
  assert.throws(() => deleteJob(P, 'a-9x16'), (e) => e.code === 409 && /Sequence reel plays this job/.test(e.message));

  fs.unlinkSync(sequenceFile(P, 'reel'));
  const res = deleteJob(P, 'a-9x16');
  trashed.push(res.trash);
  assert.ok(!fs.existsSync(path.join(DIRS.briefs, P, 'a-9x16.json')), 'brief is gone');
  assert.ok(!fs.existsSync(path.join(DIRS.out, P, 'a-9x16')), 'output is gone');
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'brief.json')));
  assert.ok(fs.existsSync(path.join(DIRS.trash, res.trash, 'out', 'status.json')));
  assert.ok(fs.existsSync(path.join(DIRS.briefs, P, 'b-9x16.json')), 'the other job stays');

  // A brief that never ran has no output folder; deleting it still works.
  trashed.push(deleteJob(P, 'b-9x16').trash);
  assert.ok(!fs.existsSync(path.join(DIRS.briefs, P, 'b-9x16.json')));
});

test('a brief without a director gets the default; an edit keeps the stored one', (t) => {
  const P = 'zz-test-dirdef';
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], P), { recursive: true, force: true })));
  const providers = { default: 'seat', providers: { seat: {}, claude: {} } };
  const base = { id: 'x-9x16', project: P, template: 'promo', format: '9:16', duration: 15, message: 'm' };
  assert.equal(validateBrief(base, { providers }).director, 'seat');
  assert.equal(validateBrief(base).director, 'seat');
  saveBrief({ ...validateBrief(base, { providers }), director: 'claude' });
  const res = updateBrief(P, 'x-9x16', { template: 'promo', format: '9:16', duration: 15, message: 'm' }, { providers });
  assert.deepEqual(res.changed, [], 'leaving the director out is not a change');
  assert.equal(loadBrief(P, 'x-9x16').director, 'claude');
});

/* ---------- editing a brief ---------- */
const EDIT_PROJECT = 'zz-test-edit';
const editBrief = { id: 'job-9x16', project: EDIT_PROJECT, template: 'promo', format: '9:16', duration: 15, director: 'seat', message: 'Old message', createdBy: 'anna' };
function editJob(t) {
  t.after(() => ['briefs', 'out'].forEach((k) => fs.rmSync(path.join(DIRS[k], EDIT_PROJECT), { recursive: true, force: true })));
  return saveBrief(validateBrief(editBrief));
}

test('editing a brief before the director ran overwrites it and keeps id and creation', (t) => {
  const saved = editJob(t);
  const res = updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief, template: 'explainer', duration: 30, message: 'New message', createdBy: 'mallory', createdAt: '2000-01-01' }, { by: 'bob' });
  assert.equal(res.requeued, false);
  assert.deepEqual(res.changed, ['template', 'duration', 'message']);
  const stored = loadBrief(EDIT_PROJECT, 'job-9x16');
  assert.equal(stored.message, 'New message');
  assert.equal(stored.template, 'explainer');
  assert.equal(stored.id, 'job-9x16');
  assert.equal(stored.createdBy, 'anna');
  assert.equal(stored.createdAt, saved.createdAt);
  assert.ok(stored.updatedAt);
  assert.ok(!fs.existsSync(jobFile(EDIT_PROJECT, 'job-9x16', 'status.json')), 'a queued job gets no status change');
});

test('saving an unchanged brief changes nothing', (t) => {
  const saved = editJob(t);
  writeJson(jobFile(EDIT_PROJECT, 'job-9x16', 'script.json'), { scenes: [] });
  const res = updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief });
  assert.deepEqual(res.changed, []);
  assert.deepEqual(res.brief, saved);
  assert.equal(getStatus(EDIT_PROJECT, 'job-9x16').status, 'queued');
});

test('the id and project of a brief cannot change', (t) => {
  editJob(t);
  assert.throws(() => updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief, id: 'other' }), /job id of a brief cannot change/);
  assert.throws(() => updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief, project: 'nsc' }), /project of a brief cannot change/);
  assert.throws(() => updateBrief(EDIT_PROJECT, '../x', editBrief), /Invalid job/);
});

test('after the director wrote a script an edit re-queues the job and keeps the script', (t) => {
  editJob(t);
  const scriptFile = jobFile(EDIT_PROJECT, 'job-9x16', 'script.json');
  const locked = { scenes: [{ id: 'hero', title: 'Mine' }], locks: { 'scene:hero.title': { by: 'anna' } } };
  writeJson(scriptFile, locked);
  setStatus(EDIT_PROJECT, 'job-9x16', { status: 'awaiting_review', step: 8 }, 'test');

  const res = updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief, cta: 'Buy now' }, { by: 'bob' });
  assert.equal(res.requeued, true);
  const st = getStatus(EDIT_PROJECT, 'job-9x16');
  assert.equal(st.status, 'dirty');
  assert.equal(st.dirty_from, 1);
  assert.deepEqual(st.history.at(-1), { at: st.updatedAt, by: 'bob', event: 'brief edited in UI: cta' });
  assert.deepEqual(JSON.parse(fs.readFileSync(scriptFile, 'utf8')), locked, 'the script and its locks stay for the director');
});

test('a brief cannot be edited while its job is busy', (t) => {
  editJob(t);
  for (const status of ['scripting', 'preparing', 'rendering']) {
    setStatus(EDIT_PROJECT, 'job-9x16', { status }, 'test');
    assert.throws(() => updateBrief(EDIT_PROJECT, 'job-9x16', { ...editBrief, cta: 'x' }), (e) => e.code === 409 && e.message.includes(status));
  }
  assert.equal(loadBrief(EDIT_PROJECT, 'job-9x16').cta, '');
});
