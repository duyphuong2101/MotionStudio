import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadStudioConfig } from '../engine/core.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { estimateTiming } from '../engine/timing.mjs';
import { sizeFor } from '../engine/pipeline.mjs';
import { openComposition } from '../engine/media.mjs';

const BRAND = {
  name: 'Burst Co', logoText: 'burst', colors: { primary: '#262524', primary2: '#4682ff', secondary: '#ffd400', bg: '#ffffff', ink: '#262524', muted: '#5c5c5c', onPrimary: '#ffffff' },
  fonts: { display: 'Arial', body: 'Arial' }, motion: 'cinematic',
};

// NSC award film, 2026-10-26: after the burst pulled back, each ray stayed as a zero-length stroke whose round cap drew
// a dot; two of them sat on the tagline.
test('the burst rays are gone once they pull back, so no dots are left on the tagline', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-burst-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const { dir: tdir, beats } = loadTemplate('logo-reveal');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const script = { lang: 'en', scenes: [{ id: 'reveal', kind: 'reveal', style: 'burst', theme: 'dark', tagline: 'We build trust. We own outcomes.', vo: 'We build trust, shape what is next, and own outcomes.' }] };
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const file = path.join(dir, 'burst.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') }));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const s = timing.scenes[0].start;
    const rays = (x) => opened.page.evaluate((v) => { window.seek(v); return [...document.querySelectorAll('.rays path')].map((p) => Number(getComputedStyle(p).opacity)); }, x);
    assert.ok((await rays(s + 0.6)).some((o) => o > 0), 'the rays show during the burst');
    assert.ok((await rays(s + 2)).every((o) => o === 0), 'no ray is left once they pulled back');
  } finally { await opened.browser.close(); }
});

const { validateScript } = await import('../engine/script.mjs');
const reveal = (extra = {}) => ({ lang: 'en', scenes: [{ id: 'reveal', kind: 'reveal', style: 'burst', theme: 'dark', tagline: 'We build trust.', vo: 'We build trust and own outcomes.', ...extra }] });

// NSC award film, 2026-10-28: the CEO asked every award film to end with the AI tools used to make it, as silent
// end notes inside the logo sting rather than a card of their own.
test('logo-reveal notes: 1-6 short silent lines, checked like any other field', () => {
  const { beats } = loadTemplate('logo-reveal');
  const ok = validateScript(reveal({ notes: ['AI tools used to make this film', 'Kokoro TTS: voice-over'] }), beats);
  assert.deepEqual(ok.errors, []);
  assert.match(validateScript(reveal({ notes: [] }), beats).errors.join(' '), /notes must list 1-6/);
  assert.match(validateScript(reveal({ notes: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }), beats).errors.join(' '), /notes must list 1-6/);
  assert.match(validateScript(reveal({ notes: ['x'.repeat(91)] }), beats).errors.join(' '), /notes\[0\]: text is required, at most 90/);
  assert.match(validateScript(reveal({ notes: 'one line' }), beats).errors.join(' '), /notes must list/);
});

test('logo-reveal notes are escaped into the page, and a sting without them builds as before', async () => {
  const cfg = loadStudioConfig();
  const { dir: tdir, beats } = loadTemplate('logo-reveal');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const make = (script) => build({ brief: { format: '16:9' }, brand: BRAND, script, timing: estimateTiming(script, cfg.timing, 'en', beats.pace || null), size: sizeFor(beats, '16:9') });
  const plain = make(reveal());
  assert.doesNotMatch(plain, /class="notes"|\.notes\{|-n0/);
  assert.equal(make(reveal({ notes: undefined })), plain);
  const html = make(reveal({ notes: ['Claude <Opus> & Sonnet', 'No AI-generated video'] }));
  assert.match(html, /Claude &lt;Opus&gt; &amp; Sonnet/);
  assert.doesNotMatch(html, /Claude <Opus>/);
  assert.match(html, /id="reveal-n1"/);
});

test('logo-reveal notes: the reveal plays as before, then the logo lifts and the notes roll up like credits', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-notes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const { dir: tdir, beats } = loadTemplate('logo-reveal');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const script = reveal({ notes: ['AI tools used to make this film', 'Claude: script', 'Kokoro TTS: voice-over', 'Whisper: captions', 'No AI-generated video, images or music.'], pace: 'focus' });
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const file = path.join(dir, 'notes.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') }));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const { start: s, end: e } = timing.scenes[0];
    const voiceEnd = Math.max(...timing.words.filter((w) => w.scene === 'reveal').map((w) => w.end));
    const look = (x) => opened.page.evaluate((v) => {
      window.seek(v);
      const r = (el) => el.getBoundingClientRect();
      const notes = [...document.querySelectorAll('.note')];
      const shown = Number(getComputedStyle(document.getElementById('reveal-notes')).opacity);
      const frame = document.getElementById('stage').getBoundingClientRect();
      return {
        // A line counts as seen when its block is shown and the line is inside the frame.
        notes: notes.map((n) => (shown > 0.05 && r(n).top < frame.bottom ? Number(getComputedStyle(n).opacity) : 0)),
        tagBottom: r(document.getElementById('reveal-tag')).bottom, noteTop: r(notes[0]).top, noteBottom: r(notes.at(-1)).bottom,
        logoTop: r(document.getElementById('reveal-logo')).top,
        subs: [...document.querySelectorAll('[id^="sub-reveal"]')].map((el) => Number(getComputedStyle(el).opacity)),
      };
    }, x);
    const early = await look(s + 0.3), during = await look(Math.min(voiceEnd - 0.2, s + 2.5)), end = await look(e - 0.1);
    assert.ok(early.notes.every((o) => o < 0.05) && during.notes.every((o) => o < 0.05), 'no notes while the voice speaks');
    assert.ok(during.subs.some((o) => o > 0.5), 'the caption shows while the voice speaks');
    const rolling = await look(voiceEnd + 0.15 + 0.3 + 1.2);
    assert.ok(rolling.notes[0] > 0.5 && rolling.notes.at(-1) === 0, `mid-roll the first line is in and the last still below: ${rolling.notes}`);
    assert.equal(end.notes.length, 5);
    assert.ok(end.notes.every((o) => o > 0.7), `notes shown by the end: ${end.notes}`);
    assert.ok(end.logoTop < during.logoTop - 40, `the logo lifted: ${during.logoTop} -> ${end.logoTop}`);
    assert.ok(end.noteTop > end.tagBottom, 'the notes sit under the tagline');
    assert.ok(end.noteBottom < 1080, 'the notes stay in the frame');
    assert.ok(end.subs.every((o) => o < 0.05), 'the caption is gone once the notes are in');
  } finally { await opened.browser.close(); }
});

const READ = 'We build trust and own outcomes. Made with Claude, Kokoro for voice, Whisper for captions. No AI-generated video.';

test('logo-reveal notesCue: a word of the voice line, only with notes; with notes the line may be longer', () => {
  const { beats } = loadTemplate('logo-reveal');
  const notes = ['AI tools used to make this film', 'Claude: script'];
  assert.deepEqual(validateScript(reveal({ vo: READ, notes, notesCue: 'Made' }), beats).errors, []);
  assert.match(validateScript(reveal({ vo: READ }), beats).errors.join(' '), /voice line/, 'without notes the sting keeps its 14-word cap');
  assert.match(validateScript(reveal({ vo: READ, notes, notesCue: 'Gemini' }), beats).errors.join(' '), /notesCue "Gemini" is not a word of the voice line/);
  assert.match(validateScript(reveal({ notesCue: 'trust' }), beats).errors.join(' '), /notesCue needs notes/);
});

test('logo-reveal notesCue: the roll starts on that word while the voice reads, with no caption over it', { timeout: 120000 }, async (t) => {
  const cfg = loadStudioConfig();
  const require = createRequire(import.meta.url);
  const gsapDir = path.dirname(require.resolve('gsap/dist/gsap.min.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-notescue-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'vendor'));
  for (const f of ['gsap.min.js', 'DrawSVGPlugin.min.js', 'MorphSVGPlugin.min.js', 'TextPlugin.min.js']) fs.copyFileSync(path.join(gsapDir, f), path.join(dir, 'vendor', f));
  const { dir: tdir, beats } = loadTemplate('logo-reveal');
  const { build } = await import(pathToFileURL(path.join(tdir, 'template.mjs')).href);
  const script = reveal({ vo: READ, notes: ['AI tools used to make this film', 'Claude: script', 'Kokoro TTS: voice-over', 'Whisper: captions'], notesCue: 'Made' });
  const timing = estimateTiming(script, cfg.timing, 'en', beats.pace || null);
  const file = path.join(dir, 'cue.html');
  fs.writeFileSync(file, build({ brief: { format: '16:9' }, brand: BRAND, script, timing, size: sizeFor(beats, '16:9') }));
  let opened;
  try { opened = await openComposition(file, { channel: cfg.engine.chromeChannel, ...sizeFor(beats, '16:9') }); } catch (err) { t.skip(`Chrome is not available: ${err.message}`); return; }
  try {
    const ws = timing.words.filter((w) => w.scene === 'reveal');
    const made = ws.find((w) => w.w === 'Made').start, voiceEnd = Math.max(...ws.map((w) => w.end));
    const look = (x) => opened.page.evaluate((v) => {
      window.seek(v);
      const frame = document.getElementById('stage').getBoundingClientRect().bottom;
      return {
        notes: [...document.querySelectorAll('.note')].map((n) => (n.getBoundingClientRect().top < frame ? Number(getComputedStyle(n).opacity) : 0)),
        subs: [...document.querySelectorAll('[id^="sub-reveal"]')].map((el) => (getComputedStyle(el).visibility === 'hidden' ? 0 : Number(getComputedStyle(el).opacity))),
      };
    }, x);
    assert.ok((await look(made - 1)).subs.some((o) => o > 0.5), 'the main line is captioned');
    const reading = await look(made + (voiceEnd - made) * 0.6);
    assert.ok(reading.notes[0] > 0.5, `lines roll in while the voice reads them: ${reading.notes}`);
    assert.ok(reading.subs.every((o) => o < 0.05), `no caption over the rolling notes: ${reading.subs}`);
  } finally { await opened.browser.close(); }
});
