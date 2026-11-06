import test from 'node:test';
import assert from 'node:assert/strict';
import { build, sceneWords, punchGroups, stackLines, wrapLines, buildSize, PUNCH_MAX, PUNCH_CHARS } from '../templates/type-film/template.mjs';

const BRAND = {
  name: 'Type Co', colors: { primary: '#1e293b', primary2: '#4f46e5', secondary: '#f59e0b', bg: '#f8fafc', ink: '#0f172a', muted: '#64748b', onPrimary: '#ffffff' },
  fonts: { display: 'Inter', body: 'Inter' },
};
const timed = (text, scene = 'a', step = 0.32) => text.split(' ').map((w, i) => ({ w, start: +(i * step).toFixed(2), end: +(i * step + step - 0.04).toFixed(2), scene }));

test('punch groups: a short word rides with the next, punctuation and size close a group', () => {
  const ws = timed('Nobody reads the manual. Nobody ever did.');
  assert.deepEqual(punchGroups(ws).map(([a, b]) => ws.slice(a, b + 1).map((x) => x.w).join(' ')), ['Nobody', 'reads', 'the manual.', 'Nobody', 'ever', 'did.']);
  // Quick words share the frame up to the limits.
  const fast = timed('we can do it all in one go now', 'a', 0.08);
  for (const [a, b] of punchGroups(fast)) {
    assert.ok(b - a + 1 <= PUNCH_MAX);
    assert.ok(fast.slice(a, b + 1).map((x) => x.w).join(' ').length <= PUNCH_CHARS);
  }
  // Every word is in exactly one group, in order.
  const flat = punchGroups(fast).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  assert.deepEqual(flat, fast.map((_, i) => i));
});

test('stack lines stay under the character limit and end at punctuation', () => {
  const ws = timed('Every word you say lands on screen. The moment you say it.');
  const lines = stackLines(ws, 11).map(([a, b]) => ws.slice(a, b + 1).map((x) => x.w).join(' '));
  assert.deepEqual(lines, ['Every word', 'you say', 'lands on', 'screen.', 'The moment', 'you say it.']);
  assert.ok(lines.every((l) => l.length <= 11));
});

test('build size: the largest size whose wrap fits, never under 56', () => {
  const ws = 'So we built a video that listens while you talk.'.split(' ');
  const fs = buildSize(ws, 920, 1710, 240);
  assert.ok(wrapLines(ws, fs, 920) * fs * 1.08 <= 1710);
  assert.ok(fs + 4 > 240 || wrapLines(ws, fs + 4, 920) * (fs + 4) * 1.08 > 1710, 'the next size up would not fit');
  assert.equal(buildSize(Array(200).fill('word'), 400, 300, 240), 56);
});

test('a line shows its own words from the timing, accent words marked, and the page has no subtitles', () => {
  const vo = 'Every word you say lands on screen.';
  const words = timed(vo, 'b');
  const args = (style) => ({
    brand: BRAND, size: { width: 1080, height: 1920 },
    script: { scenes: [{ id: 't', kind: 'title', vo: 'Hi', title: 'Say it' }, { id: 'b', kind: 'line', vo, style, accent: 'EVERY word!' }] },
    timing: { duration: 5, lang: 'en', scenes: [{ id: 't', start: 0, end: 1.2 }, { id: 'b', start: 1.2, end: 5 }], words: [{ w: 'Hi', start: 0.1, end: 0.4, scene: 't' }, ...words] },
  });
  for (const style of ['punch', 'stack', 'build']) {
    const html = build(args(style));
    assert.ok(!html.includes('class="subt'), `${style}: no subtitles`);
    assert.match(html, new RegExp(`class="tf tf-${style}"`));
    for (const [k, w] of vo.split(' ').entries()) assert.ok(html.includes(`id="b-w${k}">${w}</span>`) , `${style}: word ${k}`);
    assert.equal((html.match(/class="tw ac"/g) || []).length, 2, `${style}: Every and word are accents`);
  }
  // Without word times the line's own words show, spread over the scene.
  assert.deepEqual(sceneWords({ id: 'z', vo: ' Two  words ' }, { words: [] }), [{ w: 'Two' }, { w: 'words' }]);
  // An unknown style falls back to stack.
  const a = args('spin');
  assert.match(build(a), /class="tf tf-stack"/);
});
