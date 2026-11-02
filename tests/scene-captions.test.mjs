import test from 'node:test';
import assert from 'node:assert/strict';
import { typedWords, heardWords, pinToPauses, speechWords } from '../engine/pipeline.mjs';
import { loadTemplate } from '../engine/jobs.mjs';
import { validateScript } from '../engine/script.mjs';

const heard = [['the', 0, 0.16], ['diaper', 0.18, 0.44], ['king', 0.46, 0.65], ['is', 0.67, 0.79], ['with', 0.81, 1], ['us', 1.02, 1.14], ['north', 1.16, 1.39], ['short.', 1.41, 1.88]]
  .map(([w, start, end]) => ({ w, start, end }));

test('a typed caption takes the heard timings word for word when the counts match', () => {
  const out = typedWords('The Diaper King is with us, North Shore.', heard, 1.87);
  assert.deepEqual(out.map((w) => w.w), ['The', 'Diaper', 'King', 'is', 'with', 'us,', 'North', 'Shore.']);
  assert.deepEqual(out.map((w) => w.start), heard.map((w) => w.start));
});

test('with a different word count each typed word keeps the time of the heard words it lines up with', () => {
  const out = typedWords('The Diaper King is with us, NorthShore.', heard, 1.87);
  assert.equal(out.length, 7);
  assert.equal(out[0].start, 0);
  assert.ok(out.at(-1).end <= 1.88 && out.at(-1).end > 1.7);
  assert.ok(out.every((w, i) => w.end > w.start && (i === 0 || w.start >= out[i - 1].end)));
  assert.deepEqual(out.slice(0, 6).map((w) => w.start), heard.slice(0, 6).map((w) => w.start));
  assert.deepEqual([out[6].start, out[6].end], [1.16, 1.88]);
});

test('a misheard word keeps its place, so the words after it are not pushed late', () => {
  const h = [['our', 0, 0.2], ['version', 0.2, 0.54], ['of', 0.56, 0.7], ['us', 0.72, 0.9], ['all', 0.92, 1.1], ['north', 2.08, 2.34], ["shore's", 2.36, 2.7], ['revenue', 2.72, 3.3]]
    .map(([w, start, end]) => ({ w, start, end }));
  const out = typedWords("Our version numbers all NorthShore's revenue.", h, 4);
  assert.deepEqual(out.map((w) => w.start), [0, 0.2, 0.56, 0.92, 2.08, 2.72]);
  assert.equal(out[2].end, 0.9);
});

test('two typed words on one heard word split its time, and a typed word nobody heard fills the gap', () => {
  const split = typedWords('North Shore rocks', [{ w: 'NorthShore', start: 0, end: 1 }, { w: 'rocks', start: 1.1, end: 1.5 }], 2);
  assert.deepEqual(split.map((w) => w.start), [0, 0.51, 1.1]);
  const gap = typedWords('One extra word here', [{ w: 'one', start: 0, end: 0.3 }, { w: 'here', start: 1, end: 1.3 }], 2);
  assert.deepEqual(gap.map((w) => w.w), ['One', 'extra', 'word', 'here']);
  assert.ok(gap[1].start >= 0.3 && gap[2].end <= 1 && gap[3].start === 1);
});

test('without anything heard a typed caption spreads over the clip; an empty caption gives no words', () => {
  const out = typedWords('You can find them online.', [], 2.4);
  assert.equal(out[0].start, 0.1);
  assert.ok(out.at(-1).end <= 2.3);
  assert.deepEqual(typedWords('  ', heard, 2), []);
});

test('pinToPauses moves drifting recognition times onto the pauses in the clip sound', () => {
  // Recognition drifts late; the speaker really pauses after "yeah," (0.40-0.62) and before "Claude." (2.26-2.56).
  const ws = [['Oh', 0, 0.2], ['yeah,', 0.2, 0.4], ['and', 0.4, 0.6], ['AI', 0.68, 0.9], ['ran', 0.92, 1.2], ['to', 1.6, 1.78], ['my', 1.8, 1.98],
    ['colleague', 2.0, 2.38], ['Claude.', 2.4, 2.8]].map(([w, start, end]) => ({ w, start, end }));
  const out = pinToPauses(ws, [{ start: 0.4, end: 0.62 }, { start: 2.26, end: 2.56 }]);
  assert.equal(out.find((w) => w.w === 'and').start, 0.62, 'the word after the comma takes the pause, not the nearer "AI"');
  assert.equal(out.find((w) => w.w === 'Claude.').start, 2.56, 'the drift is corrected before the next pause is matched');
  assert.ok(out.every((w, i) => w.end > w.start && (i === 0 || w.start >= out[i - 1].start)));
  assert.ok(out.find((w) => w.w === 'colleague').end <= 2.26);
  assert.equal(out[0].start, 0);
});

test('pinToPauses ends the last words before the silence after the speech', () => {
  const ws = [['one,', 0, 0.3], ['I', 0.32, 0.44], ["don't", 0.46, 0.7], ['think', 0.73, 1.0], ['so.', 1.02, 1.4]].map(([w, start, end]) => ({ w, start, end }));
  // The pause after "one," pins "I"; the speaker stops at 1.3 s and drinks until 3 s.
  const out = pinToPauses(ws, [{ start: 0.3, end: 0.5 }, { start: 1.3, end: 3.0 }]);
  assert.equal(out[1].start, 0.5);
  assert.ok(out.at(-1).start < 1.3 && out.at(-1).end <= 1.3, JSON.stringify(out));
});

test('pinToPauses keeps every word inside the clip when a pin pushes the rest later', () => {
  const ws = [['one,', 0, 0.3], ['two', 0.32, 0.6], ['three', 0.62, 1.9]].map(([w, start, end]) => ({ w, start, end }));
  const out = pinToPauses(ws, [{ start: 0.3, end: 0.8 }], { end: 2 });
  assert.equal(out[1].start, 0.8);
  assert.ok(out.every((w) => w.end <= 2 && w.start < w.end), JSON.stringify(out));
});

test('pinToPauses leaves the words alone without a pause in reach', () => {
  const ws = [{ w: 'one', start: 0, end: 0.3 }, { w: 'two', start: 0.32, end: 0.6 }];
  assert.equal(pinToPauses(ws, []), ws);
  assert.equal(pinToPauses(ws, [{ start: 3, end: 3.4 }]), ws);
});

test('speechWords times a typed caption from the sound: each mark on its pause, nothing stretched past the last word', () => {
  const RATE = 16000;
  // Four phrases with clear pauses, then a sip of silence and a short noise well after the last word.
  const parts = [[0.5, 1.0], [1.2, 1.7], [1.9, 2.4], [2.7, 3.4], [5.0, 5.05]];
  const s = new Float32Array(Math.round(6 * RATE));
  for (const [a, b] of parts) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) s[i] = 0.5 * Math.sin(i / 3);
  // Recognition put every word about half a second early.
  const heard = [['cms', 0.1, 0.4], ['13', 0.45, 0.6], ['commerce', 0.7, 1.1], ['15', 1.15, 1.3], ['dot net', 1.4, 1.8], ['10', 1.85, 2.0], ['our', 2.2, 2.4], ['revenue', 2.45, 2.9]]
    .map(([w, start, end]) => ({ w, start, end }));
  const out = speechWords('CMS 13, Commerce 15, .NET 10, our revenue.', s, heard, RATE);
  const at = (w) => out.find((x) => x.w === w).start;
  assert.ok(Math.abs(at('Commerce') - 1.2) < 0.03, `Commerce at ${at('Commerce')}`);
  assert.ok(Math.abs(at('.NET') - 1.9) < 0.03, `.NET at ${at('.NET')}`);
  assert.ok(Math.abs(at('our') - 2.7) < 0.03, `our at ${at('our')}`);
  assert.ok(out.at(-1).end <= 3.5, 'the noise at 5 s does not stretch the last words');
  assert.ok(out.every((w, i) => w.end > w.start && (i === 0 || w.start > out[i - 1].start)));
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
