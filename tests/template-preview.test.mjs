import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, writeJson } from '../engine/core.mjs';
import { listTemplates } from '../engine/jobs.mjs';
import { templatePreview, previewFile, previewFormat, sampleScript } from '../engine/template-preview.mjs';
import { reviewRoute } from '../server/review.mjs';

const PROJECT = 'zz-test-template-preview';
const brandDir = path.join(DIRS.profiles, PROJECT);
const outDir = path.join(DIRS.out, '_preview', 'templates', PROJECT);

test.before(() => {
  writeJson(path.join(brandDir, 'brand.json'), {
    name: 'Preview Co', logo: null, logoDark: null, logoText: 'preview', site: '',
    colors: { primary: '#1d3557', primary2: '#457b9d', secondary: '#e63946', bg: '#f1faee', ink: '#1d3557', muted: '#5c677d', onPrimary: '#ffffff' },
    palette: [], fonts: { display: 'Inter', body: 'Inter', googleFonts: '' }, voice: { tts: 'none', voice: '', speed: 1, lang: 'en' },
    music: { file: '', gainDb: -18 }, sources: { allowedHosts: [] },
  });
});
test.after(() => {
  fs.rmSync(brandDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('every template builds a playable preview in the project brand, with the media its page asks for', { timeout: 120000 }, async () => {
  for (const t of listTemplates()) {
    const p = await templatePreview(PROJECT, t.id);
    assert.equal(p.url, `/tpreview/${PROJECT}/${t.id}/index.html`);
    assert.equal(p.format, previewFormat(t));
    assert.ok(p.duration > 0 && p.poster >= 0 && p.poster <= p.duration, `${t.id} poster inside the video`);
    const dir = path.join(outDir, t.id);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /window\.seek = /, `${t.id} keeps the seek contract`);
    assert.match(html, /#1d3557/i, `${t.id} uses the project's colors`);
    for (const [, name] of html.matchAll(/(?:src|href)="(assets\/[^"]+|clips\/[^"]+|vendor\/[^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(dir, decodeURIComponent(name))), `${t.id}: ${name} is in the preview folder`);
    }
  }
});

test('sample scenes come from the template defaults', () => {
  const beats = listTemplates().find((t) => t.id === 'data-story');
  const s = sampleScript(beats);
  assert.equal(s.lang, 'en');
  assert.equal(s.scenes.find((x) => x.kind === 'stat').value, beats.defaults.stat.value);
});

test('preview files are an allowlist under the preview folder; the review link may show them', () => {
  assert.ok(previewFile(PROJECT, 'promo', 'index.html').endsWith(path.join('promo', 'index.html')));
  assert.ok(previewFile(PROJECT, 'promo', 'clips/clip-1.mp4'));
  for (const bad of ['../../profiles/x/brand.json', 'index.js', 'assets/../../.env', 'vendor/../index.html']) {
    assert.throws(() => previewFile(PROJECT, 'promo', bad), /Not found/, bad);
  }
  assert.throws(() => previewFile('../x', 'promo', 'index.html'), /project/);
  assert.equal(reviewRoute('GET', '/api/templates/promo/preview'), 'api');
  assert.equal(reviewRoute('GET', `/tpreview/${PROJECT}/promo/index.html`), 'tpreview');
  assert.equal(reviewRoute('POST', '/api/templates/promo/preview'), null);
});

test('read-only (the review link) answers for a preview on disk and never builds one', async () => {
  const dir = path.join(outDir, 'promo');
  fs.rmSync(dir, { recursive: true, force: true });
  await assert.rejects(templatePreview(PROJECT, 'promo', { readOnly: true }), (e) => e.code === 404 && /No preview of promo yet/.test(e.message));
  assert.ok(!fs.existsSync(dir), 'nothing was written');
  const built = await templatePreview(PROJECT, 'promo');
  const before = fs.statSync(path.join(dir, 'index.html')).mtimeMs;
  assert.deepEqual(await templatePreview(PROJECT, 'promo', { readOnly: true }), built);
  assert.equal(fs.statSync(path.join(dir, 'index.html')).mtimeMs, before, 'the page was not rebuilt');
});
