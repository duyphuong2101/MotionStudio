import test from 'node:test';
import assert from 'node:assert/strict';
import { listTemplates, loadTemplate } from '../engine/jobs.mjs';
import { composeBeats } from '../engine/mix.mjs';
import { sceneHelp } from '../engine/help.mjs';

for (const t of listTemplates()) {
  test(`${t.id}: every scene kind and every field has help text`, () => {
    const h = sceneHelp(t);
    for (const [kind, spec] of Object.entries(t.fields)) {
      assert.ok(h.kinds[kind], `${t.id}: kind ${kind} has no help.kinds entry`);
      for (const f of [...spec.required, ...spec.optional]) assert.ok(h.fields[kind][f], `${t.id}: ${kind}.${f} has no help (beats.json help.fields or engine/help.mjs FIELD_HELP)`);
    }
  });
}

test('a kind-specific hint wins over the template-wide and the shared hint', () => {
  const h = sceneHelp(loadTemplate('testimonial').beats);
  assert.match(h.fields.quote.asset, /reviewer/i);
  assert.equal(h.fields.product.asset, 'A product image.');
  assert.match(h.fields.quote.vo, /voice says/);
});

test('a mixed brief resolves help for the extras from their own beats.json', () => {
  const ds = loadTemplate('data-story').beats;
  const h = sceneHelp(composeBeats(loadTemplate('explainer').beats, [ds]));
  assert.equal(h.kinds['data-story.bars'], ds.help.kinds.bars);
  assert.equal(h.fields['data-story.bars'].items, ds.help.fields.items);
  assert.equal(h.kinds.step, loadTemplate('explainer').beats.help.kinds.step);
});
