import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVoiceList, oneCoreWords, listVoices, previewVoice, voiceProblem } from '../engine/tts.mjs';

// Windows' newer (OneCore) voices next to the classic ones: the voices Windows installs with a language's speech pack,
// e.g. Microsoft An for Vietnamese, listed under the "sapi" engine and spoken by engine/tts/onecore.ps1.

test('voice lists: name, culture and gender per line, OneCore ones marked, odd names dropped', () => {
  assert.deepEqual(parseVoiceList('Microsoft An|vi-VN|Female\r\nMicrosoft Zira|en-US|Female\n\nBad;Name|en-US|Male\n', 'onecore'), [
    { id: 'Microsoft An', culture: 'vi-VN', label: 'An · vi-VN female', onecore: true },
    { id: 'Microsoft Zira', culture: 'en-US', label: 'Zira · en-US female', onecore: true },
  ]);
  assert.deepEqual(parseVoiceList('Microsoft Zira Desktop|en-US|Female', 'desktop'), [{ id: 'Microsoft Zira Desktop', culture: 'en-US', label: 'Zira · en-US female' }]);
});

test('OneCore word cues become script words with their start in seconds, Vietnamese marks kept', () => {
  const text = 'Xin chào, Việt Nam.';
  const cues = [{ s: 0, e: 2, ms: 101.4 }, { s: 4, e: 7, ms: 420 }, { s: 10, e: 13, ms: 900.26 }, { s: 15, e: 17, ms: 1300 }, { s: 18, e: 17, ms: 1500 }];
  assert.deepEqual(oneCoreWords(text, cues), [{ w: 'Xin', at: 0.101 }, { w: 'chào', at: 0.42 }, { w: 'Việt', at: 0.9 }, { w: 'Nam', at: 1.3 }]);
  assert.deepEqual(oneCoreWords('Hi', { s: 0, e: 1, ms: 50 }), [{ w: 'Hi', at: 0.05 }], 'one cue comes back from JSON as an object');
  assert.match(voiceProblem({ tts: 'kokoro', voice: 'af_heart', lang: 'vi' }), /Add voices, e\.g\. Microsoft An for Vietnamese, then restart the UI/);
});

test('on Windows, the newer voices are listed and one speaks a line at 24 kHz with word times', { timeout: 120000 }, async (t) => {
  if (process.platform !== 'win32') { t.skip('Windows only'); return; }
  const sapi = (await listVoices()).find((e) => e.id === 'sapi');
  const one = sapi.voices.find((v) => v.onecore);
  if (!one) { t.skip('no OneCore voice besides the classic ones on this machine'); return; }
  const names = sapi.voices.map((v) => v.id);
  assert.equal(new Set(names).size, names.length, 'each voice once');
  for (const v of sapi.voices.filter((x) => x.onecore)) assert.ok(!names.includes(`${v.id} Desktop`), `${v.id} is not listed twice`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-onecore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wav = await previewVoice(dir, 'sapi', one.id, 1);
  const b = fs.readFileSync(wav);
  assert.deepEqual([b.readUInt32LE(24), b.readUInt16LE(22), b.readUInt16LE(34)], [24000, 1, 16], '24 kHz mono 16-bit, as the classic voices write');
  const meta = JSON.parse(fs.readFileSync(wav.replace(/\.wav$/, '.json'), 'utf8'));
  assert.ok(meta.seconds > 1 && meta.words.length >= 10, JSON.stringify(meta).slice(0, 200));
  assert.ok(meta.words.every((w, i) => i === 0 || w.at >= meta.words[i - 1].at), 'word times rise');
  assert.equal(fs.readdirSync(dir).filter((f) => /\.(in|raw)\.json$|\.native\.wav$/.test(f)).length, 0, 'no work files left');
});
