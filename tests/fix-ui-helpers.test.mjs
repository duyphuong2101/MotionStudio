import test from 'node:test';
import assert from 'node:assert/strict';
import { assetKind, uploadProblem, fmtSize, parseNum, parseSay, sayText, paletteProblems, guessFont } from '../ui/shots.js';
import { ASSET_TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES } from '../engine/assets.mjs';

const TYPES = Object.keys(ASSET_TYPES);
const file = (name, size) => ({ name, size });

test('assetKind tells fonts, models and m4a apart from audio', () => {
  assert.equal(assetKind('take.m4a'), 'audio');
  assert.equal(assetKind('Gilroy-Bold.woff2'), 'font');
  assert.equal(assetKind('Brand.OTF'), 'font');
  assert.equal(assetKind('bottle.glb'), 'model');
  assert.equal(assetKind('clip.mov'), 'video');
  assert.equal(assetKind('logo.svg'), 'image');
  assert.equal(assetKind('notes.txt'), 'other');
});

test('uploadProblem mirrors the server: type list, empty file and the larger video cap', () => {
  assert.equal(uploadProblem(file('a.png', 10), TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES), '');
  assert.match(uploadProblem(file('a.exe', 10), TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES), /^\.exe files are not allowed/);
  assert.match(uploadProblem(file('noext', 10), TYPES, MAX_ASSET_BYTES), /^\.\? files/);
  assert.equal(uploadProblem(file('a.png', 0), TYPES, MAX_ASSET_BYTES), 'The file is empty.');
  // 100 MB: too big for an image, fine for footage.
  assert.match(uploadProblem(file('a.png', 100 * 1024 * 1024), TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES), /at most 25 MB/);
  assert.equal(uploadProblem(file('a.MP4', 100 * 1024 * 1024), TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES), '');
  assert.match(uploadProblem(file('a.mov', MAX_VIDEO_BYTES + 1), TYPES, MAX_ASSET_BYTES, MAX_VIDEO_BYTES), /at most 400 MB/);
  // Icons: svg only, KB cap.
  assert.match(uploadProblem(file('i.svg', 70 * 1024), ['svg'], 64 * 1024), /at most 64 KB/);
  assert.match(uploadProblem(file('i.png', 1), ['svg'], 64 * 1024), /Allowed: svg/);
  assert.equal(fmtSize(1536 * 1024), '1.5 MB');
});

test('parseNum keeps an emptied field empty instead of 0', () => {
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('   '), null);
  assert.equal(parseNum(undefined), null);
  assert.equal(parseNum('0'), 0);
  assert.equal(parseNum('-18'), -18);
  assert.ok(Number.isNaN(parseNum('abc')));
});

test('paletteProblems reports unnamed, badly named, duplicate and core-clashing colours', () => {
  assert.deepEqual(paletteProblems([{ name: 'highlight', hex: '#ff0000' }]), []);
  assert.match(paletteProblems([{ name: '', hex: '#ff0000' }])[0], /^Custom color 1 needs a name/);
  assert.match(paletteProblems([{ name: '1st', hex: '#ff0000' }])[0], /must start with a letter/);
  assert.match(paletteProblems([{ name: 'bg', hex: '#ff0000' }])[0], /clashes with a core color/);
  const dup = paletteProblems([{ name: 'a', hex: '#000000' }, { name: 'a', hex: '#111111' }]);
  assert.equal(dup.length, 1);
  assert.match(dup[0], /^Custom color 2/);
  assert.match(paletteProblems([{ name: 'x', hex: 'red' }])[0], /#rrggbb/);
});

test('guessFont reads family, weight and style from a font file name', () => {
  assert.deepEqual(guessFont('Gilroy-SemiBoldItalic.otf'), { family: 'Gilroy', file: 'Gilroy-SemiBoldItalic.otf', weight: 600, style: 'italic' });
  assert.equal(guessFont('Gilroy-Bold.woff2').weight, 700);
  assert.equal(guessFont('Gilroy-ExtraBold.woff2').weight, 800);
  assert.equal(guessFont('Gilroy-ExtraLight.woff2').weight, 200);
  assert.equal(guessFont('Gilroy-Light.woff2').weight, 300);
  assert.equal(guessFont('Gilroy-Regular.ttf').weight, 400);
  assert.equal(guessFont('Inter_Black.ttf').weight, 900);
  assert.deepEqual(guessFont('Brandface.woff2'), { family: 'Brandface', file: 'Brandface.woff2', weight: 400, style: 'normal' });
  // A name with no usable letters falls back to the given family.
  assert.equal(guessFont('---.otf', 'Gilroy').family, 'Gilroy');
});

test('the Say as box: one "word = what to say" per line, blank lines skipped, a bad line named', () => {
  assert.deepEqual(parseSay('AMAD = A M A D\n\n .NET=dot net \n'), { AMAD: 'A M A D', '.NET': 'dot net' });
  assert.equal(parseSay('  \n'), null);
  assert.throws(() => parseSay('AMAD = A M A D\nNiteco'), /line 2/);
  assert.throws(() => parseSay('= nothing'), /line 1/);
  assert.throws(() => parseSay('AMAD ='), /line 1/);
  assert.equal(sayText({ AMAD: 'A M A D', '.NET': 'dot net' }), 'AMAD = A M A D\n.NET = dot net');
  assert.deepEqual(parseSay(sayText({ "Niteco's": 'Nee-teh-cos' })), { "Niteco's": 'Nee-teh-cos' }, 'round trip');
});
