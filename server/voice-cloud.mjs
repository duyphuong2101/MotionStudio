// The third person-clicked model path (user decision 2026-10-29): Make cloud voice on a job sends each of its voice
// lines once to ElevenLabs with the person's own key (config/studio.json → voiceCloud.keyEnv) and saves the audio and
// word times in the job (engine/cloudvoice.mjs). Prepare only reads them; the engine, the Director, a cron or a loop
// never call this. One run at a time, capped per run and per day, a 429 or a spent quota pauses it, nothing retries.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError, assertId, readJson, writeJson, exists, nowIso, within } from '../engine/core.mjs';
import { jobDir, jobFile, profileDir } from '../engine/jobs.mjs';
import { spokenLine } from '../engine/tts.mjs';
import { ffmpeg } from '../engine/media.mjs';
import { CLOUD_DIR, alignmentWords, lineKey, takeFile } from '../engine/cloudvoice.mjs';
import { runDay, readPause } from './caps.mjs';
import { fetchJson, redact, flatLine } from './http.mjs';

const API = 'https://api.elevenlabs.io';
const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const NUMERIC_CAPS = ['maxLinesPerRun', 'maxLinesPerDay', 'maxCharsPerDay', 'maxCharsPerLine', 'requestTimeoutSeconds', 'maxResponseBytes', 'pauseMinutes', 'maxLogBytes'];

export const filesIn = (dir) => ({ dir, usage: path.join(dir, 'usage.json'), pause: path.join(dir, 'pause.json') });
export const FILES = filesIn(path.join(ROOT, 'logs', 'voice-cloud'));

/* ---------- pure parts (tested) ---------- */
export function assertVoiceConfig(v) {
  const bad = NUMERIC_CAPS.find((k) => !(typeof v?.[k] === 'number' && v[k] > 0));
  if (bad) throw new StudioError(`config/studio.json voiceCloud.${bad} must be a positive number`, 503);
  if (!NAME_RE.test(String(v.keyEnv || ''))) throw new StudioError('config/studio.json voiceCloud.keyEnv must name an environment variable', 503);
  return v;
}

/** The lines a run speaks: every scene with a voice line and no cast speaker, as the voice will say it. */
export function planLines(script, brand) {
  const cloud = brand.voice.cloud;
  return (script.scenes || []).flatMap((sc) => {
    const vo = String(sc.vo || '').trim();
    if (!vo || sc.speaker) return [];
    const { text } = spokenLine(vo, brand.voice?.say);
    return [{ id: sc.id, text, key: lineKey(cloud, text) }];
  });
}

/** POST …/with-timestamps for one line. The key goes in the header only. */
export function lineRequest({ voice, model, text }, key) {
  return {
    url: `${API}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`,
    init: { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'xi-api-key': key }, body: JSON.stringify({ text, model_id: model }) },
  };
}

/** The audio and words of one answer, or a StudioError naming what is missing. */
export function lineFromAnswer(json, maxBytes) {
  const b64 = typeof json?.audio_base64 === 'string' ? json.audio_base64 : '';
  if (!b64) throw new StudioError('ElevenLabs answered without audio', 502);
  if (Math.floor(b64.length * 3 / 4) > maxBytes) throw new StudioError(`The audio is larger than ${maxBytes} bytes (voiceCloud.maxResponseBytes)`, 413);
  const words = alignmentWords(json.alignment || json.normalized_alignment);
  if (!words.length) throw new StudioError('ElevenLabs answered without word times', 502);
  return { audio: Buffer.from(b64, 'base64'), words };
}

/** Seconds of a PCM WAV from its fmt and data chunks. */
export function wavSeconds(buf) {
  const fmt = buf.indexOf('fmt ', 12), data = buf.indexOf('data', 12);
  if (fmt < 0 || data < 0) return 0;
  const byteRate = buf.readUInt32LE(fmt + 16);
  return byteRate ? Math.round((buf.readUInt32LE(data + 4) / byteRate) * 1000) / 1000 : 0;
}

/** Today's lines and characters, `{ day, lines, chars }` reset at the person's midnight. */
export function usageToday(file, now = new Date()) {
  const u = readJson(file, null);
  return u && u.day === runDay(now) ? { lines: Number(u.lines) || 0, chars: Number(u.chars) || 0 } : { lines: 0, chars: 0 };
}
const countLine = (file, chars, now) => { const u = usageToday(file, now); writeJson(file, { day: runDay(now), lines: u.lines + 1, chars: u.chars + chars }); };

/* ---------- state ---------- */
let current = null;
let last = null;

const when = (iso) => new Date(iso).toLocaleString('en-US');

function logLine(ctx, text) {
  const file = within(ctx.files.dir, `${ctx.project}.log`);
  const line = `${nowIso()} ${redact(flatLine(text), ctx.key)}\n`;
  fs.mkdirSync(ctx.files.dir, { recursive: true });
  const size = exists(file) ? fs.statSync(file).size : 0;
  if (size + Buffer.byteLength(line) > ctx.v.maxLogBytes) fs.writeFileSync(file, `[log restarted at voiceCloud.maxLogBytes]\n${line}`);
  else fs.appendFileSync(file, line);
}

async function callProvider(ctx, req) {
  const { v, key } = ctx;
  const { res, json, text } = await fetchJson(ctx.fetch, {
    url: req.url, init: req.init, who: 'ElevenLabs', keys: key,
    timeoutMs: v.requestTimeoutSeconds * 1000, timeoutLabel: 'voiceCloud.requestTimeoutSeconds',
    maxBytes: v.maxResponseBytes * 2, label: 'voiceCloud.maxResponseBytes',
  });
  const detail = json?.detail;
  const msg = redact(String((typeof detail === 'object' ? detail?.message || detail?.status : detail) || text || res.statusText).slice(0, 300), key);
  if (res.status === 429 || /quota_exceeded|too_many_concurrent/i.test(JSON.stringify(detail ?? ''))) {
    const until = new Date(ctx.now().getTime() + v.pauseMinutes * 60000).toISOString();
    writeJson(ctx.files.pause, { until, reason: msg, at: nowIso(), project: ctx.project });
    throw new StudioError(`ElevenLabs quota or rate limit reached. Paused until ${when(until)}.`, 429);
  }
  if (!res.ok) throw new StudioError(`ElevenLabs answered ${res.status}: ${msg}`, 502);
  if (!json) throw new StudioError('ElevenLabs answered something that is not JSON', 502);
  return json;
}

/** Each missing line in turn; the take is written after every line, so a stop keeps what was made. */
async function runLines(ctx, todo, run) {
  const dir = within(ctx.dir, CLOUD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = takeFile(ctx.dir);
  for (const l of todo) {
    countLine(ctx.files.usage, l.text.length, ctx.now());
    const json = await callProvider(ctx, lineRequest({ voice: ctx.cloud.voice, model: ctx.cloud.model, text: l.text }, ctx.key));
    const { audio, words } = lineFromAnswer(json, ctx.v.maxResponseBytes);
    const mp3 = within(dir, `${l.key}.mp3`), wav = within(dir, `${l.key}.wav`);
    fs.writeFileSync(mp3, audio);
    try { await ffmpeg(['-y', '-i', mp3, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', wav], { timeoutMs: 60000 }); } finally { fs.rmSync(mp3, { force: true }); }
    const seconds = wavSeconds(fs.readFileSync(wav));
    if (!(seconds > 0)) throw new StudioError(`${l.id}: the audio ElevenLabs sent could not be read`, 502);
    const take = readJson(file, null) || { lines: {} };
    take.provider = ctx.cloud.provider;
    take.lines[l.key] = { scene: l.id, file: `${l.key}.wav`, seconds, words: words.map(({ w, at }) => ({ w, at })), voice: ctx.cloud.voice, model: ctx.cloud.model, madeAt: nowIso(), by: run.by };
    writeJson(file, take);
    run.made += 1;
    logLine(ctx, `${run.by} ${run.job} ${l.id} ${l.text.length} chars ${seconds} s`);
  }
}

/** Starts one Make cloud voice run in the background after every check; the UI polls `voiceCloudState`. */
export function startCloudVoice(v, { project, job, by, fetch = globalThis.fetch, env = process.env, now = () => new Date(), files = FILES, onDone = () => {} }) {
  assertVoiceConfig(v);
  if (!env[v.keyEnv]) throw new StudioError(`Add ${v.keyEnv} to .env in the Motion Studio folder (or set it in your environment), then restart npm run ui.`, 503);
  const key = env[v.keyEnv];
  if (current) throw new StudioError('A cloud voice run is already going. Wait for it to finish.', 409);
  const pause = readPause(files.pause);
  if (pause) throw new StudioError(`Paused until ${when(pause.until)} after an ElevenLabs quota or rate limit. Wait, or clear the pause.`, 429);
  const brand = readJson(path.join(profileDir(project), 'brand.json'), null);
  if (!brand?.voice?.cloud) throw new StudioError('Set a cloud voice in the Brand tab first (Voice → Cloud voice id)', 400);
  const script = readJson(jobFile(project, job, 'script.json'), null);
  if (!script?.scenes?.length) throw new StudioError('This job has no script yet', 409);
  const dir = jobDir(project, job);
  const lines = planLines(script, brand);
  const long = lines.find((l) => l.text.length > v.maxCharsPerLine);
  if (long) throw new StudioError(`${long.id}: the line is longer than ${v.maxCharsPerLine} characters (voiceCloud.maxCharsPerLine)`, 400);
  const saved = readJson(takeFile(dir), null)?.lines || {};
  const todo = lines.filter((l, i) => !Object.hasOwn(saved, l.key) && lines.findIndex((x) => x.key === l.key) === i);
  if (!todo.length) throw new StudioError('Every line already has its cloud voice', 409);
  if (todo.length > v.maxLinesPerRun) throw new StudioError(`${todo.length} lines to make, more than ${v.maxLinesPerRun} per run (voiceCloud.maxLinesPerRun)`, 400);
  const used = usageToday(files.usage, now()), chars = todo.reduce((n, l) => n + l.text.length, 0);
  if (used.lines + todo.length > v.maxLinesPerDay) throw new StudioError(`Daily line limit: ${used.lines} of ${v.maxLinesPerDay} used, this run needs ${todo.length} (voiceCloud.maxLinesPerDay)`, 429);
  if (used.chars + chars > v.maxCharsPerDay) throw new StudioError(`Daily character limit: ${used.chars} of ${v.maxCharsPerDay} used, this run needs ${chars} (voiceCloud.maxCharsPerDay)`, 429);

  const ctx = { v, key, fetch, now, files, project, dir, cloud: brand.voice.cloud };
  const run = { project, job, by, lines: todo.length, made: 0, startedAt: nowIso(), status: 'running' };
  current = run;
  logLine(ctx, `${by} ${job} start: ${todo.length} lines, ${chars} chars, voice ${brand.voice.cloud.voice}, ${brand.voice.cloud.model}`);
  runLines(ctx, todo, run)
    .then(() => { run.status = 'done'; run.message = `Made ${run.made} cloud voice line${run.made === 1 ? '' : 's'}`; })
    .catch((err) => { run.status = 'error'; run.message = redact(err instanceof StudioError ? err.message : `Cloud voice failed: ${err?.message}`, key); })
    .finally(() => {
      run.endedAt = nowIso();
      try { logLine(ctx, `${run.status}: ${run.message}`); } catch { /* the result still reaches the UI */ }
      current = null;
      last = run;
      if (run.made) { try { onDone(run); } catch (err) { run.message += ` (${err.message})`; } }
    });
  return { started: true, lines: todo.length, chars };
}

export const voiceCloudHas = (project, job = null) => Boolean(current && current.project === project && (!job || current.job === job));

const publicRun = (r) => r && { job: r.job, by: r.by, lines: r.lines, made: r.made, startedAt: r.startedAt, endedAt: r.endedAt || null, status: r.status, message: r.message || null };

/** What the job's voice panel shows: key present, voice set, lines made and missing, caps, usage, run, pause. Never the key. */
export function voiceCloudState(v, project, job, { env = process.env, files = FILES } = {}) {
  let error = null;
  try { assertVoiceConfig(v); } catch (e) { error = e.message; }
  assertId(project, 'project'); assertId(job, 'job');
  const brand = readJson(path.join(profileDir(project), 'brand.json'), null);
  const script = readJson(jobFile(project, job, 'script.json'), null);
  const cloud = brand?.voice?.cloud || null;
  const lines = cloud && script?.scenes ? planLines(script, brand) : [];
  const saved = cloud ? readJson(takeFile(jobDir(project, job)), null)?.lines || {} : {};
  return {
    error, hasKey: Boolean(v?.keyEnv && env[v.keyEnv]), keyEnv: v?.keyEnv || null, voice: cloud,
    lines: lines.length, missing: lines.filter((l) => !Object.hasOwn(saved, l.key)).map((l) => l.id),
    caps: error ? null : { maxLinesPerRun: v.maxLinesPerRun, maxLinesPerDay: v.maxLinesPerDay, maxCharsPerDay: v.maxCharsPerDay },
    usage: usageToday(files.usage),
    running: current && current.project === project ? publicRun(current) : null,
    last: last && last.project === project && last.job === job ? publicRun(last) : null,
    pause: readPause(files.pause),
  };
}
