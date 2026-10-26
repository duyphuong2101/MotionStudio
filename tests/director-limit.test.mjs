import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPause, eventText } from '../server/director.mjs';

const NOW = new Date(2026, 9, 14, 10, 0);
const line = (ev) => eventText(JSON.stringify(ev));
const said = (text, model = 'claude-sonnet-5-5') => line({ type: 'assistant', message: { model, content: [{ type: 'text', text }] } });

test('the Director saying "limit reached" in its own words never pauses the seat', () => {
  for (const text of ['Title limit reached, shortened it.', 'Word limit reached on scene 2; cut the voice line.', 'The usage limit reached in beats.json is 12 words.']) {
    assert.equal(said(text).check, '', text);
    assert.equal(detectPause(text, NOW), null, text);
  }
  const summary = line({ type: 'result', subtype: 'success', is_error: false, result: 'Usage limit reached? No. Title limit reached, shortened it.' });
  assert.equal(summary.check, '', 'a finished run is not a limit, whatever its summary says');
  assert.equal(detectPause('Note: usage limit reached for the scene count', NOW), null, 'not at a line start');
});

test("Claude Code's own limit messages pause, from an error result, its synthetic reply, an error event or stderr", () => {
  const result = line({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1760000000' });
  assert.equal(detectPause(result.check, NOW).until, new Date(1760000000 * 1000).toISOString());
  const synthetic = said("You've hit your limit · resets 3pm (Asia/Saigon)", '<synthetic>');
  assert.equal(new Date(detectPause(synthetic.check, NOW).until).getHours(), 15);
  const event = line({ type: 'system', subtype: 'api_error', error: { message: 'Claude AI usage limit reached|1760000000' } });
  assert.match(event.text, /^! Claude AI usage limit reached/);
  assert.ok(detectPause(event.check, NOW));
  const sixty = new Date(NOW.getTime() + 3600000).toISOString();
  for (const stderr of [
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}',
    "You're out of extra usage · resets in 2h",
    'You’ve hit your usage limit',
    'Error: something\nUsage limit reached.',
    'Claude usage limit reached. Your limit will reset at 3pm.',
  ]) assert.ok(detectPause(stderr, NOW, 60), stderr);
  assert.equal(detectPause('API Error: 429 rate_limit_error', NOW, 60).until, sixty);
  const late = new Date(2026, 9, 14, 23, 0);
  const p = new Date(detectPause('5-hour limit reached ∙ resets 2am', late).until);
  assert.deepEqual([p.getDate(), p.getHours()], [15, 2]);
});
