import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, StudioError, round, readJson, writeJson, keyFreeEnv, loadStudioConfig } from './core.mjs';
import { PIPER_DIR, SHERPA_DIR, PIPER_VOICE_RE, parseVoiceId, listPiperVoices, piperText, sherpaProblem } from './tts/piper.mjs';
import { ffmpeg, killTree, mediaTimeoutMs } from './media.mjs';
import { wordsOf, stressAt } from './script.mjs';
import { resolvePace, sceneGaps, sceneHold } from './timing.mjs';
import { cloudTake } from './cloudvoice.mjs';
import { kokoroStatus, kokoroSpeak, kokoroVoices, writeWav, voicedSpan, voicedPauses, SAMPLE_RATE as KOKORO_RATE } from './tts/kokoro.mjs';

const VOICE_RE = /^[A-Za-z0-9 _()-]{1,60}$/;
const TTS_TIMEOUT_MS = 60000;
// By full path: Windows looks for a bare name in the working folder (the repo) before PATH.
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ONECORE_PS = path.join(ROOT, 'engine', 'tts', 'onecore.ps1');
const SHERPA_PS = path.join(ROOT, 'engine', 'tts', 'sherpa.ps1');

/**
 * Whether Piper voices can speak here: Windows, the pinned sherpa-onnx runtime (engine/tts/piper.mjs sherpaProblem)
 * and at least one voice in models/piper/.
 */
export function piperStatus(cfg = loadStudioConfig()) {
  if (process.platform !== 'win32') return { available: false, reason: 'Piper voices run through sherpa-onnx for Windows here' };
  const problem = sherpaProblem(path.join(ROOT, SHERPA_DIR), cfg.piper?.sha256);
  if (problem) return { available: false, reason: problem };
  return listPiperVoices(path.join(ROOT, PIPER_DIR)).length ? { available: true } : { available: false, reason: `${PIPER_DIR}/ holds no voice (a folder such as vi_VN-vais1000-medium with its .onnx, tokens.txt and espeak-ng-data/)` };
}

// The preview line in the voice's own language, so a Vietnamese voice is not heard reading English.
const PREVIEW_TEXT = {
  en: 'Hi, this is how your video will sound. Every claim comes from the product page.',
  vi: 'Xin chào, đây là giọng đọc cho video của bạn. Mọi thông tin đều lấy từ trang sản phẩm.',
};

// Kokoro's own grading of its English voices (from the kokoro-js voice table); others are listed as "ungraded".
const KOKORO_INFO = {
  af_heart: 'Heart · US female · grade A', af_bella: 'Bella · US female · grade A-', af_nicole: 'Nicole · US female · B-',
  af_aoede: 'Aoede · US female · C+', af_kore: 'Kore · US female · C+', af_sarah: 'Sarah · US female · C+',
  af_alloy: 'Alloy · US female · C', af_nova: 'Nova · US female · C', af_sky: 'Sky · US female · C-',
  am_fenrir: 'Fenrir · US male · C+', am_michael: 'Michael · US male · C+', am_puck: 'Puck · US male · C+',
  am_echo: 'Echo · US male · D', am_eric: 'Eric · US male · D', am_liam: 'Liam · US male · D', am_onyx: 'Onyx · US male · D',
  bf_emma: 'Emma · UK female · B-', bf_isabella: 'Isabella · UK female · C', bm_george: 'George · UK male · C', bm_fable: 'Fable · UK male · C',
  bm_lewis: 'Lewis · UK male · D+', bf_alice: 'Alice · UK female · D', bf_lily: 'Lily · UK female · D', bm_daniel: 'Daniel · UK male · D',
};
let sapiVoicesCache = null;

/**
 * Windows voices for the "sapi" engine: the classic ones (System.Speech, "Microsoft Zira Desktop") and the newer
 * OneCore ones Windows installs with a language's speech pack ("Microsoft An", Vietnamese), marked `onecore`. A
 * OneCore voice that is a classic one under another name (Zira and Zira Desktop) is listed once.
 */
async function sapiVoices() {
  if (process.platform !== 'win32') return [];
  if (sapiVoicesCache) return sapiVoicesCache;
  const desktop = await desktopVoices();
  const known = new Set(desktop.map((v) => v.id.replace(/ Desktop$/, '')));
  sapiVoicesCache = [...desktop, ...(await oneCoreVoices()).filter((v) => !known.has(v.id))];
  return sapiVoicesCache;
}

const voiceLabel = (name, culture, gender) => `${name.replace(/^Microsoft /, '').replace(/ Desktop$/, '')} · ${culture} ${String(gender || '').toLowerCase()}`;

/** The OneCore voices: name, language and gender from engine/tts/onecore.ps1 -List; none when it fails. */
async function oneCoreVoices() {
  const out = await new Promise((resolve) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ONECORE_PS, '-List'], { shell: false, windowsHide: true, env: keyFreeEnv() });
    let txt = '';
    p.stdout.on('data', (d) => { if (txt.length < 20000) txt += d; });
    const timer = setTimeout(() => killTree(p), 20000);
    p.on('close', () => { clearTimeout(timer); resolve(txt); });
    p.on('error', () => resolve(''));
  });
  return parseVoiceList(out, 'onecore');
}

/** "name|culture|gender" lines → voices; a name the voice id rule refuses is dropped. Pure, for tests. */
export function parseVoiceList(text, kind) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, culture, gender] = l.split('|');
    return { id: name, culture, label: voiceLabel(name, culture, gender), ...(kind === 'onecore' ? { onecore: true } : {}) };
  }).filter((v) => VOICE_RE.test(v.id));
}

async function desktopVoices() {
  const out = await new Promise((resolve) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture + "|" + $_.VoiceInfo.Gender }'],
    { shell: false, windowsHide: true, env: keyFreeEnv() });
    let txt = '';
    p.stdout.on('data', (d) => { if (txt.length < 20000) txt += d; });
    const timer = setTimeout(() => killTree(p), 20000);
    p.on('close', () => { clearTimeout(timer); resolve(txt); });
    p.on('error', () => resolve(''));
  });
  return parseVoiceList(out, 'desktop');
}

/** Every TTS engine with the voices this machine actually has, for the Brand dropdowns. */
export async function listVoices() {
  const k = kokoroStatus();
  const kv = k.available ? kokoroVoices() : [];
  const graded = kv.filter((id) => KOKORO_INFO[id]).sort((a, b) => Object.keys(KOKORO_INFO).indexOf(a) - Object.keys(KOKORO_INFO).indexOf(b));
  const rest = kv.filter((id) => !KOKORO_INFO[id]);
  return [
    { id: 'kokoro', label: 'Kokoro (natural, offline)', available: k.available, reason: k.reason || null,
      voices: [...graded.map((id) => ({ id, label: `${id} · ${KOKORO_INFO[id]}` })), ...rest.map((id) => ({ id, label: `${id} · other language` }))] },
    { id: 'sapi', label: 'Windows voices (exact word timing)', available: process.platform === 'win32', reason: process.platform === 'win32' ? null : 'Windows only', voices: await sapiVoices() },
    (() => { const p = piperStatus(); return { id: 'piper', label: 'Piper voices (offline, sherpa-onnx)', available: p.available, reason: p.reason || null, voices: p.available ? listPiperVoices(path.join(ROOT, PIPER_DIR)) : [] }; })(),
    { id: 'none', label: 'No voice-over', available: true, reason: null, voices: [] },
  ];
}

/** A short sample line in one voice, cached on disk; returns the WAV path. */
export async function previewVoice(cacheDir, provider, voice, speed = 1) {
  const culture = provider === 'piper' ? (listPiperVoices(path.join(ROOT, PIPER_DIR)).find((v) => v.id === voice)?.culture || '')
    : provider === 'sapi' ? (await sapiVoices()).find((v) => v.id === voice)?.culture || '' : '';
  const text = PREVIEW_TEXT[base(culture)] || PREVIEW_TEXT.en;
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!VOICE_RE.test(voice || '')) throw new StudioError('Pick a voice first', 400);
  const sp = Math.max(0.6, Math.min(1.5, Number(speed) || 1));
  if (provider === 'kokoro') {
    if (!kokoroStatus().available) throw new StudioError(`Kokoro: ${kokoroStatus().reason}`, 400);
    return (await speakKokoro(cacheDir, text, voice, sp)).wav;
  }
  if (provider === 'sapi') return (await speakLine(cacheDir, text, voice, Math.round((sp - 1) * 20))).wav;
  if (provider === 'piper') return (await speakPiper(cacheDir, text, voice, sp)).wav;
  throw new StudioError('This voice engine has no preview', 400);
}

/**
 * The voice one video uses: the brand's voice, with the brief's own language and voice on top.
 * `brief.voice` is "<engine>:<voice id>" (e.g. "sapi:Microsoft Helena Desktop"), "none:" for no voice-over.
 */
export function voiceFor(brand, brief = {}) {
  const v = { ...(brand.voice || {}) };
  if (brief.voice) {
    const at = brief.voice.indexOf(':');
    v.tts = brief.voice.slice(0, at);
    v.voice = brief.voice.slice(at + 1) || undefined;
  }
  if (brief.lang) v.lang = brief.lang;
  v.lang = String(v.lang || 'en').toLowerCase();
  return v;
}

const base = (lang) => String(lang || 'en').toLowerCase().split('-')[0];

/**
 * Kokoro's voice prefix names its language; this machine's phonemizer only has English, so only
 * American (a*) and British (b*) voices can speak. Returns the espeak language or null.
 */
export function kokoroLang(voice) {
  return { a: 'en-us', b: 'en-gb' }[String(voice || '')[0]] || null;
}

/** Why this voice cannot speak this video's language here, or null when it can. Kokoro is checked; SAPI voices are checked by culture at prepare. */
export function voiceProblem(v) {
  if (String(v.tts || '').toLowerCase() === 'piper') {
    const id = parseVoiceId(v.voice || '');
    if (!id) return `Piper voice "${v.voice || ''}" is not a voice folder name such as vi_VN-vais1000-medium`;
    const lang = id.name.slice(0, id.name.indexOf('_'));
    return base(v.lang) === lang ? null : `Piper voice ${id.name} speaks ${lang}, and this video is "${v.lang}". Pick a voice in that language.`;
  }
  if (String(v.tts || '').toLowerCase() !== 'kokoro') return null;
  const voice = v.voice || 'af_heart';
  if (!kokoroLang(voice)) return `Kokoro voice ${voice} needs a phonemizer for its language, and this machine only has English. Pick an English Kokoro voice or a Windows voice.`;
  if (base(v.lang) !== 'en') return `Kokoro on this machine speaks English only, and this video is "${v.lang}". Pick a Windows voice in that language for the brief (add the language's voice in Windows Settings → Time & language → Speech → Add voices, e.g. Microsoft An for Vietnamese, then restart the UI so it lists it), or "No voice-over".`;
  return null;
}

/** A SAPI voice's culture, e.g. "en-US", or null when the voice is unknown here. */
export async function sapiCulture(voice) {
  return (await sapiVoices()).find((x) => x.id === voice)?.culture || null;
}

export const sameLanguage = (culture, lang) => base(culture) === base(lang);

/** Which TTS this brand asks for, and whether this machine can run it. */
export function ttsProvider(brand) {
  const name = String(brand.voice?.tts || 'none').toLowerCase();
  if (name === 'sapi' || name === 'windows') {
    if (process.platform !== 'win32') return { name, available: false, reason: 'Windows speech needs Windows' };
    return { name: 'sapi', available: true };
  }
  if (name === 'kokoro') {
    const st = kokoroStatus();
    return st.available ? { name, available: true } : { name, available: false, reason: `Kokoro: ${st.reason}` };
  }
  if (name === 'piper') {
    const st = piperStatus();
    return st.available ? { name, available: true } : { name, available: false, reason: `Piper: ${st.reason}` };
  }
  if (name === 'none') return { name, available: false, reason: 'no TTS set in brand.voice.tts' };
  return { name, available: false, reason: `TTS "${name}" has no adapter on this machine yet` };
}

function runPs(script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { shell: false, windowsHide: true, env: keyFreeEnv() });
    let err = '';
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    const timer = setTimeout(() => { killTree(p); reject(new StudioError('TTS timed out')); }, TTS_TIMEOUT_MS);
    p.on('error', reject);
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new StudioError(`TTS failed (${code}): ${err.trim().slice(0, 500)}`)); });
  });
}

/** The fmt fields and the sample bytes of a PCM WAV; SAPI and Kokoro both write a plain header. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12; let fmt = null; let data = buf.subarray(0, 0);
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), byteRate: buf.readUInt32LE(off + 16), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + Math.min(size, buf.length - off - 8)); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt?.byteRate) throw new StudioError(`Unreadable WAV ${path.basename(file)}`);
  return { ...fmt, data };
}

const wavSeconds = (file) => { const w = readWav(file); return w.data.length / w.byteRate; };

/** The first channel of a 16-bit WAV as floats, or null for another format. */
function wavSamples(file) {
  const w = readWav(file);
  if (w.bits !== 16) return null;
  const step = 2 * w.channels;
  const samples = new Float32Array(Math.floor(w.data.length / step));
  for (let i = 0; i < samples.length; i++) samples[i] = w.data.readInt16LE(i * step) / 32768;
  return { samples, rate: w.rate };
}

/** Where the voice starts and stops in a 16-bit WAV (seconds), or null when it is silent or another format. */
function wavVoicedSpan(file) {
  const s = wavSamples(file);
  if (!s) return null;
  const span = voicedSpan(s.samples, s.rate);
  return span.end > span.start ? span : null;
}

// How far (s) from its estimated place a punctuation mark may be pinned to a pause the voice really makes.
const PIN_REACH = 0.7;
// Bumped when kokoroWords changes, so cached lines get their word times again from the cached audio.
const KOKORO_WORDS_V = 8;
// Seconds of pause length a pin gives up per second it lies from the estimate: in a list ("speed, Auto-Ship, security,")
// the pauses are alike, and the longest one in reach is often the next comma's.
const PIN_DRIFT = 0.2;

/**
 * The word boundaries inside one script word that the voice says as several (brand voice.say: "AMAD" → "Eh Em Eh Dee"),
 * from spokenLine's groups: boundary i lies between spoken words i and i + 1. A pause there is never a pin.
 */
export function innerBoundaries(groups) {
  if (!Array.isArray(groups)) return null;
  const set = new Set();
  let k = 0;
  for (const n of groups) { for (let j = 0; j < n - 1; j++) set.add(k + j); k += n; }
  return set.size ? set : null;
}

// A pause at least this long (s) is a word boundary even where the line has no punctuation (Kokoro breathes about
// 0.1 s before a name it spells out, e.g. "AMAD"; a stop consonant inside a word stays under 0.08 s).
const CLEAR_PAUSE = 0.1;

/**
 * Kokoro reports no word timing. Each word is weighted by its letters (digits count more) plus a pause for its
 * trailing punctuation; the punctuation marks are pinned together, in order, to the real pauses in the audio near
 * where the weights put them (pinScore), then any clear pause still free is pinned to the word boundary nearest to it.
 * The words between two pins are spread over that stretch only, so a pause never lets the words after it drift.
 */
export function kokoroWords(text, samples, rate = KOKORO_RATE, { inner = null } = {}) {
  const tokens = wordsOf(text);
  if (!tokens.length) return [];
  const span = voicedSpan(samples, rate);
  const mark = (w) => (/[.!?]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0);
  // Letters of any script count (a Vietnamese "đây" is three letters, not one); English words weigh as before.
  const base = (w) => w.replace(/[^\p{L}\p{N}$%]/gu, '').length + 2 + (/\d/.test(w) ? w.length * 2 : 0);
  const ws = tokens.map((w) => base(w) + mark(w));
  const sum = (a, b) => ws.slice(a, b).reduce((x, y) => x + y, 0);
  // Start times of every word with these pins ({ i: last word before the pause, start, end }), sorted by i.
  const spread = (pins) => {
    const at = [];
    let a = span.start, first = 0;
    for (const p of [...pins, { i: tokens.length - 1, start: span.end, end: span.end }]) {
      // The last word before a pin ends at the pause, so its own punctuation weight is the pause, not speech.
      const seg = tokens.slice(first, p.i + 1).map((w, k, arr) => (k === arr.length - 1 ? base(w) : ws[first + k]));
      const total = seg.reduce((x, y) => x + y, 0) || 1;
      let acc = 0;
      for (const wt of seg) { at.push(a + ((p.start - a) * acc) / total); acc += wt; }
      a = p.end; first = p.i + 1;
    }
    return at;
  };
  const pauses = voicedPauses(samples, rate);
  // The marks are pinned together, in order: the chain of pins with the highest total pinScore (each against where the
  // weights put its mark after the previous pin) wins, so in a list every comma keeps its own pause.
  const marks = tokens.slice(0, -1).map((w, i) => (mark(w) ? i : -1)).filter((i) => i >= 0);
  const chains = [];
  let top = null;
  for (const i of marks) {
    const found = [];
    pauses.forEach((p, k) => {
      let pick = null;
      for (const prev of [null, ...chains.filter((c) => c.k < k)]) {
        const start = prev ? pauses[prev.k].end : span.start, first = prev ? prev.i + 1 : 0;
        if (p.start <= start) continue;
        const est = start + ((span.end - start) * sum(first, i + 1)) / (sum(first, tokens.length) || 1);
        if (p.end < est - PIN_REACH || p.start > est + PIN_REACH) continue;
        const score = (prev ? prev.score : 0) + pinScore(p, est, mark(tokens[i]) === 6);
        if (!pick || score > pick.score) pick = { i, k, score, back: prev };
      }
      if (pick) found.push(pick);
    });
    for (const c of found) { chains.push(c); if (!top || c.score > top.score) top = c; }
  }
  const used = new Set();
  const pins = [];
  for (let c = top; c; c = c.back) { pins.unshift({ i: c.i, ...pauses[c.k] }); used.add(c.k); }
  pauses.forEach((p, k) => {
    if (used.has(k) || p.end - p.start < CLEAR_PAUSE) return;
    const at = spread(pins);
    let best = -1;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (pins.some((q) => q.i === i) || inner?.has(i) || Math.abs(at[i + 1] - p.end) > PIN_REACH) continue;
      if (best < 0 || Math.abs(at[i + 1] - p.end) < Math.abs(at[best + 1] - p.end)) best = i;
    }
    if (best < 0) return;
    const next = [...pins, { i: best, ...p }].sort((x, y) => x.i - y.i);
    if (next.every((q, n) => !n || q.start >= next[n - 1].end)) pins.splice(0, pins.length, ...next);
  });
  return spread(pins).map((at, i) => ({ w: tokens[i], at: round(at) }));
}

// A sentence end (strong) counts its pause twice, as Kokoro pauses longest there; every pin earns PIN_BONUS, so a chain
// does not give up a comma's pause to let a period take a slightly longer one further on.
const PIN_BONUS = 0.15;
const pinScore = (p, est, strong) => PIN_BONUS + (p.end - p.start) * (strong ? 2 : 1) - PIN_DRIFT * Math.abs(p.start - est);

async function speakKokoro(dir, text, voice, speed, inner = null) {
  const lang = kokoroLang(voice);
  if (!lang) throw new StudioError(`Kokoro voice ${voice} needs a phonemizer for its language, and this machine only has English`, 400);
  const key = crypto.createHash('sha1').update(`kokoro|${voice}|${speed}|${lang}|${text}`).digest('hex').slice(0, 16);
  const wav = path.join(dir, `${key}.wav`);
  const meta = path.join(dir, `${key}.json`);
  if (fs.existsSync(wav) && fs.existsSync(meta)) {
    const m = readJson(meta);
    const s = m.wordsV === KOKORO_WORDS_V ? null : wavSamples(wav);
    if (!s) return { wav, ...m };
    const fresh = { seconds: m.seconds, words: kokoroWords(text, s.samples, s.rate, { inner }), wordsV: KOKORO_WORDS_V };
    writeJson(meta, fresh);
    return { wav, ...fresh };
  }
  const { samples } = await kokoroSpeak(text, voice, speed, lang);
  writeWav(wav, samples);
  const result = { seconds: round(samples.length / KOKORO_RATE), words: kokoroWords(text, samples, KOKORO_RATE, { inner }), wordsV: KOKORO_WORDS_V };
  writeJson(meta, result);
  return { wav, ...result };
}

/**
 * The words of a OneCore run: each cue names its characters in the text (end included) and where it starts in ms.
 * Pure, for tests.
 */
export function oneCoreWords(text, cues) {
  return (Array.isArray(cues) ? cues : [cues]).filter(Boolean)
    .map((c) => ({ w: text.slice(c.s, c.e + 1).trim(), at: round(c.ms / 1000) })).filter((x) => x.w);
}

/** A OneCore voice speaks one line: its WAV is made 24 kHz mono like the classic voices'. Returns { seconds, words }. */
async function speakOneCore(dir, key, text, voice, rate, wav) {
  const input = path.join(dir, `${key}.in.json`), raw = path.join(dir, `${key}.raw.json`), native = path.join(dir, `${key}.native.wav`);
  // The classic rate runs -10..10; OneCore takes a speed, 1 normal.
  const speed = Math.max(0.5, Math.min(3, 1 + rate / 20));
  fs.writeFileSync(input, JSON.stringify({ voice, speed, text }), 'utf8');
  try {
    await runPs(ONECORE_PS, ['-In', input, '-Wav', native, '-Out', raw]);
    await ffmpeg(['-y', '-i', native, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav], { timeoutMs: TTS_TIMEOUT_MS });
    const parsed = JSON.parse(fs.readFileSync(raw, 'utf8').replace(/^\uFEFF/, ''));
    return { seconds: round(wavSeconds(wav)), words: oneCoreWords(text, parsed.words) };
  } finally {
    for (const f of [input, raw, native]) fs.rmSync(f, { force: true });
  }
}

/**
 * A Piper voice speaks one line through sherpa-onnx (engine/tts/sherpa.ps1), cached by voice, speed and text. The
 * text is guarded (piperText) before it is spoken; the words are timed on the script's own text the way Kokoro's
 * are (kokoroWords), since the voice reports no word times. The WAV is made 24 kHz mono.
 */
async function speakPiper(dir, text, voice, speed, inner = null) {
  const id = parseVoiceId(voice);
  if (!id) throw new StudioError(`Piper voice "${voice}" is not a voice folder name such as vi_VN-vais1000-medium`, 400);
  const st = piperStatus();
  if (!st.available) throw new StudioError(`Piper: ${st.reason}`, 400);
  const spoken = piperText(text);
  if (!spoken) throw new StudioError(`This line has nothing a voice can read: ${String(text).slice(0, 60)}`, 400);
  const key = crypto.createHash('sha1').update(`piper|${voice}|${speed}|${text}`).digest('hex').slice(0, 16);
  const wav = path.join(dir, `${key}.wav`), meta = path.join(dir, `${key}.json`);
  if (fs.existsSync(wav) && fs.existsSync(meta)) return { wav, ...readJson(meta) };
  const vdir = path.join(ROOT, PIPER_DIR, id.name);
  const input = path.join(dir, `${key}.in.json`), raw = path.join(dir, `${key}.raw.json`), native = path.join(dir, `${key}.native.wav`);
  fs.writeFileSync(input, JSON.stringify({ lib: path.join(ROOT, SHERPA_DIR), model: path.join(vdir, `${id.name}.onnx`), tokens: path.join(vdir, 'tokens.txt'), dataDir: path.join(vdir, 'espeak-ng-data'), threads: 2, speed, sid: id.speaker, text: spoken }), 'utf8');
  try {
    await runPs(SHERPA_PS, ['-In', input, '-Wav', native, '-Out', raw]);
    await ffmpeg(['-y', '-i', native, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wav], { timeoutMs: TTS_TIMEOUT_MS });
  } finally {
    for (const f of [input, raw, native]) fs.rmSync(f, { force: true });
  }
  const s = wavSamples(wav);
  const result = { seconds: round(s.samples.length / s.rate), words: kokoroWords(text, s.samples, s.rate, { inner }) };
  writeJson(meta, result);
  return { wav, ...result };
}

/** Speaks one line (cached by text + voice + rate). Returns { wav, seconds, words:[{w, at}] }. */
async function speakLine(dir, text, voice, rate) {
  const key = crypto.createHash('sha1').update(`${voice}|${rate}|${text}`).digest('hex').slice(0, 16);
  const wav = path.join(dir, `${key}.wav`);
  const meta = path.join(dir, `${key}.json`);
  if (fs.existsSync(wav) && fs.existsSync(meta)) return { wav, ...readJson(meta) };
  if ((await sapiVoices()).find((v) => v.id === voice)?.onecore) {
    const result = await speakOneCore(dir, key, text, voice, rate, wav);
    writeJson(meta, result);
    return { wav, ...result };
  }
  const input = path.join(dir, `${key}.in.json`);
  fs.writeFileSync(input, JSON.stringify({ voice, rate, text }), 'utf8');
  const raw = path.join(dir, `${key}.raw.json`);
  await runPs(path.join(ROOT, 'engine', 'tts', 'sapi.ps1'), ['-In', input, '-Wav', wav, '-Out', raw]);
  const parsed = JSON.parse(fs.readFileSync(raw, 'utf8').replace(/^﻿/, ''));
  const words = (Array.isArray(parsed.words) ? parsed.words : [parsed.words]).filter(Boolean).map((x) => ({ w: x.w, at: round(x.ms / 1000) }));
  const result = { seconds: round(wavSeconds(wav)), words };
  writeJson(meta, result);
  fs.unlinkSync(input);
  fs.unlinkSync(raw);
  return { wav, ...result };
}

/**
 * The words a brand wants said differently (brand.voice.say: "AMAD" → "A M A D", ".NET" → "dot net"), applied to one
 * voice line. A word matches with its trailing punctuation and a possessive 's set aside. Returns the text to speak and,
 * per script word, how many spoken words it became (null when nothing was replaced), so timing maps back to the script.
 */
export function spokenLine(text, say) {
  const tokens = wordsOf(text);
  if (!say || !Object.keys(say).length) return { text, groups: null };
  let hit = false;
  const groups = [];
  const spoken = tokens.map((tok) => {
    const [, core, poss, tail] = /^(.*?)((?:'s|’s)?)([.,!?;:"”)]*)$/.exec(tok);
    // "Niteco's" matches a key "Niteco's" first, then "Niteco" with the 's kept.
    const key = Object.hasOwn(say, core + poss) ? core + poss : Object.hasOwn(say, core) ? core : null;
    if (!core || !key) { groups.push(1); return tok; }
    hit = true;
    const rep = say[key] + (key === core ? poss : '');
    groups.push(wordsOf(rep).length);
    return rep + tail;
  });
  return hit ? { text: spoken.join(' '), groups } : { text, groups: null };
}

// A scene's `stress` phrases are said this much louder, with short ramps so the step never clicks.
export const STRESS_DB = 4;
const STRESS_RAMP = 0.06;

/** The stressed spans of one line, in its clip's own seconds: from the first word's start to where the next word starts. */
export function stressSpans(vo, stress, said, end) {
  if (!Array.isArray(stress)) return [];
  return stress.map((p) => stressAt(vo, p)).filter(Boolean).map(([i, j]) => ({
    a: round(Math.max(0, said[i].at - STRESS_RAMP)), b: round((said[j + 1]?.at ?? end) + STRESS_RAMP / 2),
  }));
}

/** ffmpeg volume step for stressed spans (empty without any): gain 1 outside, STRESS_DB inside, linear ramps. */
export function stressFilter(spans) {
  if (!spans?.length) return '';
  const g = (10 ** (STRESS_DB / 20) - 1).toFixed(3);
  const r = STRESS_RAMP;
  const terms = spans.map(({ a, b }) => `clip((t-${a})/${r},0,1)*clip((${b}-t)/${r},0,1)`).join('+');
  // eval=frame works out the gain once per audio frame, which a decoder hands over in ~2048-sample blocks (85 ms at
  // 24 kHz): longer than the ramp, so the gain would jump in one step. 120-sample frames make the ramp a ramp.
  return `asetnsamples=n=120:p=0,volume=volume='1+${g}*(${terms})':eval=frame,`;
}

/**
 * Real timing from speech: each scene lasts at least its spoken line plus lead/tail, words start
 * where the voice says them, and voice.wav is every line placed at its scene's lead-in.
 * `tight` (a motion profile with `tight`) uses the short gaps of `sceneGaps` and measures them from where the voice is
 * heard, so the engine's own silence at either end of a clip does not widen them.
 * `take` (engine/voicetake.mjs `recordedVoice`) replaces TTS with a recorded take's cuts, one per scene id.
 */
export async function speakScript(jobDirPath, script, brand, cfg, paceCfg, fixed = null, snap = null, tight = false, take = null) {
  const silent = { seconds: 0, words: [] };
  let provider = 'take', voice = take?.asset, speak = async (sc) => take.lines[sc.id] || silent, cloudUse = null;
  if (!take) {
    provider = ttsProvider(brand).name;
    voice = brand.voice?.voice || (provider === 'kokoro' ? 'af_heart' : provider === 'piper' ? listPiperVoices(path.join(ROOT, PIPER_DIR))[0]?.id || '' : 'Microsoft Zira Desktop');
    if (!VOICE_RE.test(voice)) throw new StudioError('brand.voice.voice has unexpected characters', 400);
    const speed = Math.max(0.6, Math.min(1.5, Number(brand.voice?.speed) || 1));
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 20)));
    const cache = path.join(jobDirPath, 'tts');
    fs.mkdirSync(cache, { recursive: true });
    const cast = brand.voice?.cast || {};
    speak = (sc, text, groups) => {
      let v = voice;
      if (sc.speaker) {
        if (!Object.hasOwn(cast, sc.speaker)) throw new StudioError(`${sc.id}: speaker "${sc.speaker}" is not in the brand's voice cast (${Object.keys(cast).join(', ') || 'none set'})`, 400);
        v = cast[sc.speaker];
        if (!VOICE_RE.test(v)) throw new StudioError(`brand.voice.cast.${sc.speaker} has unexpected characters`, 400);
      }
      return provider === 'kokoro' ? speakKokoro(cache, text, v, speed, innerBoundaries(groups))
        : provider === 'piper' ? speakPiper(cache, text, v, speed, innerBoundaries(groups)) : speakLine(cache, text, v, rate);
    };
    // A brand with a cloud voice uses the lines a person made with Make cloud voice; a line not made (or changed
    // since) keeps the local voice and is named in timing.cloud.stale. A cast speaker keeps its local voice.
    if (brand.voice?.cloud) {
      const saved = cloudTake(jobDirPath, brand.voice.cloud), local = speak;
      cloudUse = { used: [], stale: [] };
      speak = async (sc, text, groups) => {
        const l = sc.speaker ? null : saved.get(text);
        if (l) { cloudUse.used.push(sc.id); return l; }
        if (!sc.speaker) cloudUse.stale.push(sc.id);
        return local(sc, text, groups);
      };
    }
  }

  const scenes = [];
  const words = [];
  const clips = [];
  let t = 0;
  for (const [idx, sc] of script.scenes.entries()) {
    const text = String(sc.vo || '').trim();
    // A recorded take is the person's own reading: brand.voice.say changes only what TTS says.
    const sp = take ? { text, groups: null } : spokenLine(text, brand.voice?.say);
    const line = !text ? silent : await speak(sc, sp.text, sp.groups);
    const last = idx === script.scenes.length - 1;
    const pace = resolvePace(paceCfg, sc);
    const shots = Array.isArray(sc.shots) && sc.shots.length ? sc.shots.length : 1;
    const minScene = pace ? Math.max(pace.minScene, shots * pace.perShot) : cfg.minScene;
    const { lead, tail } = sceneGaps(cfg, pace, last, tight);
    const span = tight && line.wav ? wavVoicedSpan(line.wav) : null;
    // The clip may start before the cut: its leading silence overlaps the previous scene's tail, or is cut off at 0.
    const at = span ? t + lead - span.start : t + lead;
    const spoken = span ? at - t + span.end : lead + line.seconds;
    // `hold`: quiet after the line (or the clip that fixes the scene), before the next scene's gap.
    const hold = sceneHold(sc);
    const raw = (fixed?.[sc.id] ?? Math.max(minScene, spoken + tail)) + hold;
    const dur = snap && fixed?.[sc.id] === undefined ? snap(t + raw) - t : raw;
    const tokens = wordsOf(text);
    let said = line.words.length ? line.words : tokens.map((w, i, a) => ({ w, at: (line.seconds * i) / a.length }));
    // A word said as several ("A M A D") starts where its first spoken word does.
    if (sp.groups && said.length === sp.groups.reduce((a, b) => a + b, 0)) {
      let k = 0;
      said = sp.groups.map((n) => { const x = said[k]; k += n; return x; });
    }
    // The engine reports bare words; show the script's own tokens (with punctuation) when they line up one to one.
    if (said.length === tokens.length) said = said.map((x, i) => ({ ...x, w: tokens[i] }));
    if (line.wav) clips.push({ wav: line.wav, at, stress: said.length === tokens.length ? stressSpans(text, sc.stress, said, span ? span.end : line.seconds) : [] });
    said.forEach((x, i) => {
      const next = said[i + 1]?.at ?? (span ? span.end : line.seconds);
      words.push({ w: x.w, start: round(Math.max(t, at + x.at)), end: round(at + Math.max(x.at + 0.05, next - 0.03)), scene: sc.id });
    });
    scenes.push({ id: sc.id, start: round(t), end: round(t + dur), ...(hold ? { hold } : {}) });
    t += dur;
  }
  const duration = round(t);
  const out = path.join(jobDirPath, 'voice.wav');
  if (clips.length) {
    const args = ['-y'];
    for (const c of clips) args.push('-i', c.wav);
    const head = (c) => (c.at < 0 ? `atrim=start=${(-c.at).toFixed(3)},asetpts=PTS-STARTPTS,` : '');
    const chains = clips.map((c, i) => `[${i}:a]${stressFilter(c.stress)}aresample=48000,${head(c)}adelay=${Math.round(Math.max(0, c.at) * 1000)}:all=1[a${i}]`);
    // A louder phrase may peak above full scale: only then a limiter keeps it clean.
    const limit = clips.some((c) => c.stress.length) ? 'alimiter=limit=0.97:level=false,' : '';
    const mix = `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:duration=longest:normalize=0,${limit}apad,atrim=0:${duration}[out]`;
    args.push('-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ac', '1', '-ar', '48000', out);
    await ffmpeg(args, { timeoutMs: mediaTimeoutMs(duration) });
  }
  const lang = script.lang || brand.voice?.lang || 'en';
  return { source: take ? 'take' : 'tts', provider, voice, lang, duration, scenes, words, ...(take ? { take: take.summary } : {}), ...(cloudUse ? { cloud: cloudUse } : {}) };
}
