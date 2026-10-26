import test from 'node:test';
import assert from 'node:assert/strict';
import { typedWords, heardWords } from '../engine/pipeline.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';

const heard = [['the', 0, 0.16], ['diaper', 0.18, 0.44], ['king', 0.46, 0.65], ['is', 0.67, 0.79], ['with', 0.81, 1], ['us', 1.02, 1.14], ['north', 1.16, 1.39], ['short.', 1.41, 1.88]]
  .map(([w, start, end]) => ({ w, start, end }));

test('a typed caption takes the heard timings word for word when the counts match', () => {
  const out = typedWords('The Diaper King is with us, North Shore.', heard, 1.87);
  assert.deepEqual(out.map((w) => w.w), ['The', 'Diaper', 'King', 'is', 'with', 'us,', 'North', 'Shore.']);
  assert.deepEqual(out.map((w) => w.start), heard.map((w) => w.start));
});

test('with a different word count the typed words spread by length over the heard speech, in order', () => {
  const out = typedWords('The Diaper King is with us, NorthShore.', heard, 1.87);
  assert.equal(out.length, 7);
  assert.equal(out[0].start, 0);
  assert.ok(out.at(-1).end <= 1.88 && out.at(-1).end > 1.7);
  assert.ok(out.every((w, i) => w.end > w.start && (i === 0 || w.start >= out[i - 1].end)));
});

test('without anything heard a typed caption spreads over the clip; an empty caption gives no words', () => {
  const out = typedWords('You can find them online.', [], 2.4);
  assert.equal(out[0].start, 0.1);
  assert.ok(out.at(-1).end <= 2.3);
  assert.deepEqual(typedWords('  ', heard, 2), []);
});

test('heard words land in the timing at the scene start, sorted with the voice words', () => {
  const timing = { scenes: [{ id: 'hook', start: 0, end: 2.5 }, { id: 'king', start: 2.5, end: 4.4 }], words: [{ w: 'Chicago.', start: 0.2, end: 0.8, scene: 'hook' }] };
  heardWords(timing, [{ id: 'king', words: typedWords('The Diaper King is with us, NorthShore.', heard, 1.87) }]);
  assert.equal(timing.words.length, 8);
  assert.equal(timing.words[1].w, 'The');
  assert.equal(timing.words[1].start, 2.5);
  assert.ok(timing.words.every((w, i) => i === 0 || w.start >= timing.words[i - 1].start));
});

test('an explainer video scene may carry a typed caption of up to 160 characters', () => {
  const beats = loadTemplate('explainer').beats;
  const script = (caption) => ({ lang: 'en', scenes: [
    { id: 't', kind: 'title', title: 'Hi', vo: 'Hi.' },
    { id: 'v', kind: 'video', title: 'On air', video: 'clip.mp4', sound: true, caption, source: 'bullets[0]' },
  ] });
  assert.deepEqual(validateScript(script('The Diaper King is with us.'), beats, { assets: ['clip.mp4'] }).errors, []);
  assert.ok(validateScript(script('x'.repeat(161)), beats, { assets: ['clip.mp4'] }).errors.some((e) => /caption is 161 chars, limit 160/.test(e)));
});
