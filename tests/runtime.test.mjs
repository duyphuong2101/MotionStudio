import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nodeProblem, NODE_FLOOR } from '../engine/runtime.mjs';

test('a Node without the October 2026 security fixes is named; a patched or newer one passes', () => {
  for (const v of ['22.23.4', 'v22.24.0', '24.22.1', '24.30.0', '26.12.1', '27.0.0']) assert.equal(nodeProblem(v), null, v);
  assert.match(nodeProblem('22.23.3'), /Node 22\.23\.3 is missing security fixes; install Node 22\.23\.4 or later/);
  assert.match(nodeProblem('24.21.0'), /install Node 24\.22\.1 or later/);
  assert.match(nodeProblem('26.11.9'), /install Node 26\.12\.1 or later/);
  for (const v of ['20.19.0', '25.9.0', '23.1.0']) assert.match(nodeProblem(v), /no longer gets security fixes; install Node 22\.23\.4, 24\.22\.1, 26\.12\.1/, v);
});

test('package.json engines names the same floors as the runtime check', () => {
  const { engines } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const [a, b, c] = Object.values(NODE_FLOOR).map((f) => f.join('.'));
  assert.equal(engines.node, `^${a} || ^${b} || >=${c}`);
});
