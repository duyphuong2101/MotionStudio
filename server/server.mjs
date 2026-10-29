import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT, DIRS, StudioError, assertId, within, readJson, writeJson, exists, loadStudioConfig,
} from '../engine/core.mjs';
import {
  STEPS, PLATFORMS, listProjects, listTemplates, listJobs, loadBrief, validateBrief, saveBrief, updateBrief, getStatus, setStatus,
  jobDir, jobFile, profileDir, listAssets, loadVoiceNotes, loadBrand, humanEdit, editDirtyFrom, loadBriefTemplate, createProject, deleteProject, deleteJob,
} from '../engine/jobs.mjs';
import { sceneHelp } from '../engine/help.mjs';
import { MAX_MIX_EXTRAS } from '../engine/mix.mjs';
import { approve, canRender } from '../engine/pipeline.mjs';
import { killTree } from '../engine/media.mjs';
import { reviewOf } from '../engine/review.mjs';
import { loadNotes, addNote, deleteNote } from '../engine/notes.mjs';
import {
  FADE_SECONDS, MIN_PARTS, MAX_PARTS, transitionList, listSequences, loadSequence, getSequenceStatus, sequenceStatusView, setSequenceStatus,
  createSequence, updateSequence, deleteSequence, checkParts, sequenceBudget, TARGET_RANGE,
} from '../engine/sequences.mjs';
import { validateScript, validateSource, assertNoDrafts } from '../engine/script.mjs';
import { validateBrand } from '../engine/brand.mjs';
import { LOOK_NAMES, lookBrand, lookProblem } from '../engine/looks.mjs';
import { saveAsset, deleteAsset, maxBytesFor, MAX_ASSET_BYTES, MAX_VIDEO_BYTES, ASSET_TYPES } from '../engine/assets.mjs';
import { listVoices, previewVoice, voiceFor, voiceProblem } from '../engine/tts.mjs';
import { MUSIC, ensureMusic, musicPath, SFX, ensureSfx, sfxPath } from '../engine/library.mjs';
import { readTemplate, isBuiltIn } from '../engine/templates.mjs';
import { ICONS } from '../motion-kit/icons.mjs';
import { sttStatus, transcriptFile, loadTranscript } from '../engine/stt.mjs';
import { footageDir, footageImage, loadShots, findWords, previewFrame, makeClip, clipSidecar, forgetFootage } from '../engine/footage.mjs';
import { iconsFor, loadBrandIcons, saveIcon, deleteIcon, MAX_ICON_BYTES, MAX_BRAND_ICONS } from '../engine/icons.mjs';
import {
  startDirector, cancelDirector, directorState, directorHas, clearPause, setDirectorModel, nextRun, DIRECTOR_MODELS,
  pickBackend, directorProviders, setDefaultProvider, recoverStale, engineEnv, directorSlots, trackChild, untrackChild, exeName, recoverInflight,
} from './director.mjs';
import {
  FILES as GENERATE_FILES, startGenerate, refreshModels, saveModelDefaults, fetchedModels, generateState, generateHas, sidecarFile,
} from './generate.mjs';
import { clearPause as clearPauseFile } from './caps.mjs';
import { keyEnvNames, loadKeysFromEnvFile } from './keys.mjs';
import { templatePreview, previewFile } from '../engine/template-preview.mjs';
import { writeBanner, bannerFile, parseBannerSize, BANNER_BACKDROPS, BANNER_SIZES, BANNER_LIMITS } from '../engine/banner.mjs';
import { transitionPreview, transitionPreviewFile } from '../engine/transition-preview.mjs';
import { COOKIE, lanInterface, newCode, codeMatches, cookieCode, reviewRoute, reviewPage } from './review.mjs';
import {
  evidenceConfig, repoAliases, resolveRepo, gitSearch, csvEvidence, csvColumns, decodeCsv, csvName, MAX_CSV_BYTES, MAX_RANGES, MAX_TICKETS,
} from '../engine/evidence.mjs';

const cfg = loadStudioConfig();
const { host } = cfg.server;
const port = Number(process.env.MOTION_STUDIO_PORT) || cfg.server.port;
if (host !== '127.0.0.1' && host !== 'localhost') {
  throw new Error('Motion Studio UI must bind to 127.0.0.1. It is a local tool; do not expose it to the network.');
}
const ALLOWED_HOSTS = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const USER = (() => { try { return os.userInfo().username; } catch { return 'ui'; } })();
const BODY_LIMIT = 256 * 1024;
const PROVIDERS_FILE = path.join(DIRS.config, 'providers.json');

// Fixed path, read once here: no request or config value can point the server at another file.
try {
  const loaded = loadKeysFromEnvFile(path.join(ROOT, '.env'), keyEnvNames(readJson(PROVIDERS_FILE)), process.env);
  if (loaded.length) console.log(`Keys from .env: ${loaded.join(', ')}`);
} catch (err) {
  console.error(`Could not read .env (${err.code || 'unreadable'}). Keys come from the environment only.`);
}

// An API Director run lives in this process: a job it left in scripting when the server stopped goes to error.
try {
  const stale = recoverStale();
  if (stale.length) console.log(`Director: ${stale.join(', ')} stopped with the server and went to error. Click Run Director again.`);
} catch (err) {
  console.error(`Could not check for jobs left by a Director run: ${err.message}`);
}

// A prepare, render, sequence, asset task or seat Director a stopped server started: stopped, and its job set to error.
try {
  const left = recoverInflight();
  if (left.length) console.log(`Left by a stopped server: ${left.join(', ')}. Busy jobs went to error; run them again.`);
} catch (err) {
  console.error(`Could not check for runs left by a stopped server: ${err.message}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.glb': 'model/gltf-binary',
};
// A sequence's renders are "<title> v<N>.mp4" (VERSION_FILE_RE in engine/sequences.mjs).
const JOB_FILE_RE = /^(index(-\d+x\d+)?\.html|final(-\d+x\d+)?\.mp4|[A-Za-z0-9][A-Za-z0-9 ._-]{0,79} v\d{1,4}\.mp4|preview\.mp4|captions\.srt|voice\.wav|footage\.wav|sfx\.wav|qa(-\d+x\d+)?\.json|video\.html|alpha(-\d+x\d+)?\.mov|stills\/(\d+x\d+\/)?[a-z0-9-]+\.png|review\/(sheet\.jpg|cuts\.jpg|pacing\.json)|clips\/[a-z0-9-]+\.mp4|vendor\/[A-Za-z0-9.]+\.js|assets\/[A-Za-z0-9][A-Za-z0-9._-]*)$/;

/* ---------- engine runner: one child process at a time, no shell, hard timeout ---------- */
const running = new Map();

/** `node engine/cli.mjs …` with no shell and a key-free environment (no keyEnv reaches an engine child). */
const engineChild = (args) => spawn(process.execPath, [path.join(ROOT, 'engine', 'cli.mjs'), ...args], { cwd: ROOT, env: engineEnv(), shell: false, windowsHide: true });

/** A free engine slot, counting the one a seat Director holds for the prepare it runs itself. */
function assertEngineSlot(message) {
  if (running.size + directorSlots() < cfg.engine.maxConcurrentRuns) return;
  throw new StudioError(running.size ? message : 'The Director is running and prepares its own jobs. Wait for it to finish.', 429);
}

/** The child in `running` and in logs/inflight (a restarted server stops it and resets what it held). */
function hold(key, entry, child, rec) {
  running.set(key, entry);
  trackChild(key, { ...rec, pid: child.pid, exe: exeName(process.execPath), startedAt: Date.now() });
}
const release = (key) => { running.delete(key); untrackChild(key); };

function runEngine(action, project, id) {
  assertEngineSlot('Another render or prepare is running. Wait for it to finish.');
  const key = `${project}/${id}`;
  const logFile = jobFile(project, id, 'engine.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'w' });
  let bytes = 0;
  const child = engineChild([action, project, id, '--by', USER]);
  const capped = (d) => { if (bytes < cfg.engine.maxLogBytes) { bytes += d.length; log.write(d); } };
  child.stdout.on('data', capped);
  child.stderr.on('data', capped);
  const fail = action.startsWith('sequence') ? setSequenceStatus : setStatus;
  const stop = (error, event) => {
    killTree(child);
    // A preview that stops leaves the sequence status alone; only its preview slot records the error.
    // A stopped render keeps the approval: `failed: 'render'` lets the person render again without a new prepare.
    fail(project, id, action === 'sequence-preview' ? { preview: { file: null, error } } : { status: 'error', error, ...(action === 'render' ? { failed: 'render' } : {}) }, event, 'server');
  };
  const timer = setTimeout(() => stop(`${action} timed out after ${cfg.engine.runTimeoutMinutes} min`, `${action} timed out`), cfg.engine.runTimeoutMinutes * 60000);
  hold(key, { action, startedAt: Date.now() }, child, { kind: action.startsWith('sequence') ? 'sequence' : 'job', action, project, id });
  let closed = false;
  const done = new Promise((resolve) => child.on('close', () => { closed = true; clearTimeout(timer); release(key); log.end(); resolve(); }));
  // `kill(reason)` is for the API Director, which stops a prepare it started when its run is cancelled.
  return { started: action, done, kill: (reason) => { if (!closed) stop(reason, `${action} stopped`); } };
}

/**
 * One engine command on one asset (cli.mjs transcribe / shots): same caps as an engine run, one slot in `running`,
 * a kill timer and a capped log at `logFile`.
 */
function runAssetTask(action, project, asset, extra, logFile, minutes) {
  const key = `${project}/~${action}:${asset}`;
  if (running.has(key)) throw new StudioError(`${asset} is being worked on already (${action})`, 409);
  assertEngineSlot('Another render, prepare, transcript or analysis is running. Wait for it to finish.');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'w' });
  let bytes = 0;
  const child = engineChild([action, project, asset, ...extra]);
  const capped = (d) => { if (bytes < cfg.engine.maxLogBytes) { bytes += d.length; log.write(d); } };
  child.stdout.on('data', capped);
  child.stderr.on('data', capped);
  const timer = setTimeout(() => { killTree(child); capped(Buffer.from(`\nError: ${action} timed out after ${minutes} min\n`)); }, minutes * 60000);
  hold(key, { action, asset, startedAt: Date.now() }, child, { kind: 'asset', action, project, asset });
  child.on('close', () => { clearTimeout(timer); release(key); log.end(); });
  return { started: action, asset };
}

/** Speech-to-text for one asset: a capped log next to the transcript. */
const runTranscribe = (project, asset, lang) => runAssetTask('transcribe', project, asset, lang ? ['--lang', lang] : [], `${transcriptFile(project, asset).slice(0, -5)}.log`, cfg.engine.runTimeoutMinutes);

/** In-process ffmpeg work on one asset (make a clip): holds a `running` slot so it never overlaps a render. */
async function withAssetSlot(action, project, asset, fn) {
  const key = `${project}/~${action}:${asset}`;
  if (running.has(key)) throw new StudioError(`${asset} is being worked on already (${action})`, 409);
  assertEngineSlot('Another render, prepare, transcript or analysis is running. Wait for it to finish.');
  running.set(key, { action, asset, startedAt: Date.now() });
  try { return await fn(); } finally { running.delete(key); }
}

const lastError = (logFile) => (exists(logFile) ? fs.readFileSync(logFile, 'utf8').match(/Error: .*/)?.[0] || null : null);

/** For the Shots panel: the stored analysis, transcript availability, and whether an analysis is running or failed. */
function shotsFor(project, asset) {
  const r = loadShots(project, asset);
  const busy = running.has(`${project}/~shots:${asset}`);
  return { ...r, busy, error: busy || (r.shots && !r.shots.stale) ? null : lastError(within(footageDir(project, asset), 'analyse.log')) };
}

/** For the Brand tab: which assets have a transcript, which are being made, and the last error. */
function transcriptsFor(project) {
  const out = {};
  for (const a of listAssets(project).filter((x) => /\.(mp4|webm|mov|wav|mp3|m4a)$/i.test(x))) {
    const doc = loadTranscript(project, a);
    const busy = running.has(`${project}/~transcribe:${a}`);
    const error = !doc && !busy ? lastError(`${transcriptFile(project, a).slice(0, -5)}.log`) : null;
    if (doc || busy || error) out[a] = { busy, error, ...(doc ? { lang: doc.lang, segments: doc.segments.length, duration: doc.duration, stale: Boolean(doc.stale) } : {}) };
  }
  return out;
}

let previewBusy = false;

/* ---------- evidence: read-only git and CSV totals a person gathers for a brief (the Director has no path to it) ---------- */
const EVIDENCE_OUTPUT_BYTES = 2 * 1024 * 1024;
const EVIDENCE_START_SECONDS = 15; // node start-up on top of the git time budget
let evidenceBusy = false;

/** `cli.mjs evidence git … --json` as a child: no shell, key-free env, a kill timer, stdout and stderr capped. */
function runGitEvidence(args, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const child = engineChild(['evidence', 'git', ...args, '--json']);
    let out = '', err = '', over = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, (timeoutSeconds + EVIDENCE_START_SECONDS) * 1000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (out.length + d.length > EVIDENCE_OUTPUT_BYTES) { over = true; child.kill(); } else out += d; });
    child.stderr.on('data', (d) => { if (err.length < cfg.engine.maxLogBytes) err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return reject(new StudioError('The git search took too long: search fewer tickets or a shorter period', 504));
      if (over) return reject(new StudioError('The git search printed too much: narrow it', 413));
      let r = null;
      try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* reported below */ }
      if (!r) { console.error(`evidence git: ${err.slice(-2000)}`); return reject(new StudioError('The git search failed', 500)); }
      if (r.error) return reject(new StudioError(r.error, r.code || 400));
      resolve(r);
    });
  });
}

/* ---------- helpers ---------- */
function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** A JSON object body (empty = {}); null, an array or a bare value is a 400. */
async function readBody(req) {
  const buf = await readRaw(req, BODY_LIMIT, 'Request body too large');
  if (!buf.length) return {};
  let body;
  try { body = JSON.parse(buf.toString('utf8')); } catch { throw new StudioError('Body must be JSON', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudioError('Body must be a JSON object', 400);
  return body;
}

// Requests whose body was refused half read: the error answer goes out first, then the connection is dropped.
const REFUSED = new WeakSet();

function readRaw(req, limit, tooBig = `File is larger than ${limit / 1024 / 1024} MB`) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const refuse = () => { req.removeListener('data', onData); req.pause(); REFUSED.add(req); reject(new StudioError(tooBig, 413)); };
    function onData(c) {
      size += c.length;
      if (size > limit) return refuse();
      chunks.push(c);
    }
    if (Number(req.headers['content-length']) > limit) return refuse();
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The JSON error answer: a StudioError's own code and text, 400 for a broken %-escape, else 500 with `generic`. */
function sendError(req, res, err, generic) {
  const code = err instanceof StudioError ? err.code : err instanceof URIError ? 400 : 500;
  if (code === 500) console.error(err);
  if (res.headersSent) { res.destroy(); return; }
  if (REFUSED.has(req)) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); }
  send(res, code, { error: code === 500 ? generic : err instanceof URIError ? 'Bad %-encoding in the URL' : err.message });
}

// Uploaded files are shown in the UI's own origin: never let one run script or be sniffed as HTML.
const ASSET_HEADERS = { 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' };
// A hero banner runs its own inline script, sandboxed to an opaque origin: it can draw, never reach /api.
const BANNER_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; sandbox allow-scripts",
  'X-Content-Type-Options': 'nosniff',
};

function serveFile(req, res, file, extra = {}) {
  if (!exists(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(file).size;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && (type.startsWith('video/') || type.startsWith('audio/'))) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store', ...extra });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...extra });
  fs.createReadStream(file).pipe(res);
}

function providersPublic() {
  const p = readJson(PROVIDERS_FILE);
  return {
    default: p.default,
    providers: Object.fromEntries(Object.entries(p.providers).map(([k, v]) => [k, {
      kind: v.kind, label: v.label, model: v.model || null, note: v.note || '',
      keyEnv: v.keyEnv || null, hasKey: v.keyEnv ? Boolean(process.env[v.keyEnv]) : true,
    }])),
  };
}

// The job's background track for the preview (the brand's, or the script's look's when the brand has none): a built-in
// track or a project asset, at its mix level. A hand-edited bad look is ignored here, so the job still opens to fix it.
function musicFor(project, look) {
  const m = lookBrand(lookProblem(look) ? null : look, loadBrand(project)).music || {};
  if (!m.file) return null;
  const url = String(m.file).startsWith('library:') ? `/api/music/${encodeURIComponent(m.file.slice(8))}` : `/assets/${encodeURIComponent(project)}/${encodeURIComponent(m.file)}`;
  return { url, gainDb: Number(m.gainDb ?? -18) };
}

// Quick mode: the outline a generated script was built from (engine/quick.mjs), shown read-only in the Script tab.
// Nothing in the UI edits it, so a broken file only hides the panel instead of keeping the job from opening.
function outlineOf(project, id, script) {
  if (script?.generated !== 'outline') return null;
  try { return readJson(jobFile(project, id, 'outline.json'), null); } catch { return null; }
}

function jobDetail(project, id) {
  const brief = loadBrief(project, id);
  const status = getStatus(project, id);
  const f = (n) => jobFile(project, id, n);
  const { beats } = loadBriefTemplate(brief);
  const script = readJson(f('script.json'), null);
  const outline = outlineOf(project, id, script);
  return {
    brief, status, steps: STEPS,
    source: readJson(f('source.json'), null),
    script,
    ...(outline ? { outline } : {}),
    timing: readJson(f('timing.json'), null),
    has: {
      index: exists(f('index.html')), final: exists(f('final.mp4')), captions: exists(f('captions.srt')),
      voice: exists(f('voice.wav')), footage: exists(f('footage.wav')), sfx: exists(f('sfx.wav')),
    },
    running: running.get(`${project}/${id}`) || null,
    music: musicFor(project, script?.look),
    looks: LOOK_NAMES,
    template: beats,
    help: sceneHelp(beats),
    assets: listAssets(project),
    icons: iconsFor(project),
    brandIcons: Object.keys(loadBrandIcons(project)),
  };
}

const BLOCKED_WHILE_BUSY = ['preparing', 'rendering'];

// Refuse a voice that cannot speak the video's language before the Director spends a run on the script.
function assertVoiceFits(project, brief) {
  if (brief.voiceTake) return; // a recorded voice speaks any language
  const problem = voiceProblem(voiceFor(loadBrand(assertId(String(project || ''), 'project')), { lang: brief.lang || '', voice: brief.voice || '' }));
  if (problem) throw new StudioError(problem, 400);
}

/* ---------- routes ---------- */
// `review` is true for a request through the read-only review link: it never sees the providers.
async function api(req, res, url, review = false) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const m = req.method;

  if (m === 'GET' && parts[0] === 'state') {
    return send(res, 200, {
      user: USER, projects: listProjects(), templates: listTemplates(), ...(review ? {} : { providers: providersPublic() }), steps: STEPS, platforms: PLATFORMS,
      mix: { maxExtras: MAX_MIX_EXTRAS },
      running: [...running.entries()].map(([k, v]) => ({ job: k, ...v })),
    });
  }
  if (parts[0] === 'director') {
    if (m === 'GET' && parts.length === 1) {
      const p = url.searchParams.get('project');
      const providers = readJson(PROVIDERS_FILE);
      const backend = pickBackend(providers);
      return send(res, 200, {
        ...directorState(p ? assertId(p, 'project') : null, backend), ...directorProviders(cfg.director, providers),
        maxJobsPerRun: cfg.director.maxJobsPerRun, model: cfg.director.model ?? 'auto', models: DIRECTOR_MODELS, next: p ? nextRun(cfg.director, p, backend) : null,
      });
    }
    if (m === 'PUT' && parts[1] === 'model' && parts.length === 2) return send(res, 200, setDirectorModel(cfg.director, (await readBody(req)).model));
    if (m === 'PUT' && parts[1] === 'provider' && parts.length === 2) {
      setDefaultProvider(PROVIDERS_FILE, await readBody(req));
      return send(res, 200, directorProviders(cfg.director, readJson(PROVIDERS_FILE)));
    }
    if (m === 'POST' && parts[1] === 'run') {
      const body = await readBody(req);
      const project = assertId(String(body.project || ''), 'project');
      const job = body.job ? String(body.job) : null;
      // The seat prepares outside `running`; it starts only when an engine slot is free for it.
      if (pickBackend(readJson(PROVIDERS_FILE)).kind === 'seat' && running.size >= cfg.engine.maxConcurrentRuns) {
        throw new StudioError('A render, prepare, transcript or analysis is running. Start the Director when it has finished.', 429);
      }
      return send(res, 202, startDirector(cfg.director, {
        project, job, by: USER, engineBusy: (id) => running.has(`${project}/${id}`), runPrepare: (p, id) => runEngine('prepare', p, id),
      }));
    }
    if (m === 'POST' && parts[1] === 'cancel') return send(res, 200, cancelDirector());
    if (m === 'DELETE' && parts[1] === 'pause') { clearPause(); return send(res, 200, { ok: true }); }
  }
  if (parts[0] === 'generate' && parts[1] === 'models') {
    if (m === 'POST' && parts[2] === 'refresh' && parts.length === 3) return send(res, 200, await refreshModels(cfg.generate, readJson(PROVIDERS_FILE), { by: USER }));
    if (m === 'PUT' && parts.length === 2) return send(res, 200, saveModelDefaults(PROVIDERS_FILE, await readBody(req), fetchedModels()));
  }
  if (m === 'GET' && parts[0] === 'templates' && parts[1] && parts[2] === 'preview' && parts.length === 3) {
    // A viewer on the review link only sees previews already made here: no Chrome, no write, no shared busy flag.
    return send(res, 200, await templatePreview(assertId(url.searchParams.get('project') || '', 'project'), assertId(parts[1], 'template'), { readOnly: Boolean(review) }));
  }
  if (m === 'GET' && parts[0] === 'templates' && parts[1]) {
    return send(res, 200, { ...readTemplate(assertId(parts[1], 'template')), builtIn: isBuiltIn(parts[1]) });
  }
  if (parts[0] === 'evidence') {
    const ev = evidenceConfig(cfg.evidence);
    if (m === 'GET' && parts.length === 1) {
      return send(res, 200, { repos: repoAliases(ev), releasePattern: ev.releasePattern, maxCommits: ev.maxCommits, maxTickets: MAX_TICKETS, maxRanges: MAX_RANGES, maxCsvMB: MAX_CSV_BYTES / 1024 / 1024 });
    }
    if (m === 'POST' && parts[1] === 'git' && parts.length === 2) {
      const body = await readBody(req);
      const alias = String(body.repo || '');
      const s = gitSearch(body, ev);
      resolveRepo(alias, ev);
      if (evidenceBusy) throw new StudioError('Another evidence search is running. Wait for it to finish.', 429);
      evidenceBusy = true;
      try {
        const args = [alias, ...(s.since ? ['--since', s.since] : []), ...(s.until ? ['--until', s.until] : []),
          ...(s.tickets.length ? ['--tickets', s.tickets.join(',')] : []), ...(s.grep ? ['--grep', s.grep] : [])];
        return send(res, 200, await runGitEvidence(args, ev.timeoutSeconds));
      } finally { evidenceBusy = false; }
    }
    if (m === 'POST' && parts[1] === 'csv' && parts.length === 2) {
      // The CSV is read from the request and never stored.
      const q = url.searchParams;
      const name = String(q.get('name') || '');
      if (!/\.csv$/i.test(name)) throw new StudioError('Pick a .csv file', 415);
      if (Number(req.headers['content-length']) > MAX_CSV_BYTES) throw new StudioError(`The CSV is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB: export a shorter period`, 413);
      const text = decodeCsv(await readRaw(req, MAX_CSV_BYTES));
      if (!q.get('date')) return send(res, 200, { file: csvName(name), ...csvColumns(text) });
      return send(res, 200, csvEvidence(text, {
        file: name, dateCol: q.get('date'), valueCols: q.getAll('value'), groupCol: q.get('group'), ranges: q.getAll('range'), prefix: q.get('prefix'),
      }));
    }
  }
  if (m === 'GET' && parts[0] === 'options') {
    return send(res, 200, {
      voices: await listVoices(),
      music: MUSIC.map(({ id, label }) => ({ id: `library:${id}`, label, url: `/api/music/${id}` })),
      sfx: SFX.map(({ id, label }) => ({ id, label, url: `/api/sfx/${id}` })),
      assetTypes: Object.keys(ASSET_TYPES), maxAssetMB: MAX_ASSET_BYTES / 1024 / 1024, maxVideoMB: MAX_VIDEO_BYTES / 1024 / 1024,
      banner: { backdrops: BANNER_BACKDROPS, sizes: BANNER_SIZES, limits: BANNER_LIMITS },
    });
  }
  if (m === 'GET' && parts[0] === 'tts' && parts[1] === 'preview') {
    if (previewBusy) throw new StudioError('Another voice preview is being made, try again in a moment', 429);
    previewBusy = true;
    try {
      const wav = await previewVoice(path.join(DIRS.out, '_preview'), url.searchParams.get('provider'), url.searchParams.get('voice'), url.searchParams.get('speed'));
      return serveFile(req, res, wav);
    } finally { previewBusy = false; }
  }
  // The review link serves only tracks and sounds already built; it never starts ffmpeg.
  if (m === 'GET' && parts[0] === 'music' && parts[1]) {
    const file = musicPath(parts[1]);
    if (!review) await ensureMusic();
    return serveFile(req, res, file);
  }
  if (m === 'GET' && parts[0] === 'sfx' && parts[1] && parts.length === 2) {
    const file = sfxPath(parts[1]);
    if (!review) await ensureSfx();
    return serveFile(req, res, file);
  }
  if (m === 'GET' && parts[0] === 'jobs' && parts.length === 1) {
    const p = url.searchParams.get('project');
    return send(res, 200, listJobs(p || undefined));
  }
  if (parts[0] === 'jobs' && parts.length >= 3) {
    const [, project, id, action] = parts;
    assertId(project, 'project'); assertId(id, 'job');
    if (m === 'GET' && !action) return send(res, 200, jobDetail(project, id));
    loadBrief(project, id); // a sequence shares out/<project>/<id>/: job actions need a real brief
    if (m === 'GET' && action === 'review' && parts.length === 4) return send(res, 200, reviewOf(project, id));
    if (m === 'GET' && action === 'notes' && parts.length === 4) return send(res, 200, { notes: loadNotes(project, id) });
    if (m === 'DELETE' && action === 'notes' && parts.length === 5) {
      if (!/^\d{1,4}$/.test(parts[4])) throw new StudioError('Give the note number', 400);
      return send(res, 200, deleteNote(project, id, parts[4]));
    }
    if (m === 'DELETE' && !action) {
      if (running.has(`${project}/${id}`)) throw new StudioError('A prepare or render of this job is running. Wait for it to finish.', 409);
      if (directorHas(project, id)) throw new StudioError('The Director is working on this job. Wait for it to finish.', 409);
      return send(res, 200, deleteJob(project, id));
    }
    const body = await readBody(req);
    const st = getStatus(project, id);
    if (m === 'POST' && action === 'notes' && parts.length === 4) return send(res, 201, addNote(project, id, body, USER));
    if (m === 'PUT' && (action === 'source' || action === 'script')) {
      if (BLOCKED_WHILE_BUSY.includes(st.status)) throw new StudioError(`Job is ${st.status}; wait until it finishes`, 409);
      if (directorHas(project, id)) throw new StudioError('The Director is working on this job. Wait for it to finish.', 409);
      const file = jobFile(project, id, `${action}.json`);
      const before = readJson(file, null);
      if (!before) throw new StudioError(`No ${action}.json yet: the director has not written it`, 409);
      const after = body.doc;
      let warnings = [];
      if (action === 'source') {
        const errs = validateSource(after, { assets: listAssets(project) });
        if (errs.length) throw new StudioError(errs.join('; '), 400);
      } else {
        const brief = loadBrief(project, id);
        const r = validateScript(after, loadBriefTemplate(brief).beats, { assets: listAssets(project), icons: Object.keys(iconsFor(project)) });
        if (r.errors.length) throw new StudioError(r.errors.join('; '), 400);
        warnings = r.warnings;
      }
      const { doc, changed } = humanEdit(action, before, after, USER, String(body.note || '').slice(0, 200));
      if (!changed.length) return send(res, 200, { changed, warnings });
      writeJson(file, doc);
      const from = editDirtyFrom(action, doc, changed);
      if (from === null) {
        setStatus(project, id, {}, `${action}.json screenshots edited in UI (no claim changed): ${changed.join(', ')}`, USER);
        return send(res, 200, { changed, statusKept: true, warnings });
      }
      const dirtyFrom = Math.min(from, st.dirty_from || 99);
      setStatus(project, id, { status: 'dirty', dirty_from: dirtyFrom, step: dirtyFrom }, `${action}.json edited in UI: ${changed.join(', ')}`, USER);
      return send(res, 200, { changed, dirty_from: dirtyFrom, warnings });
    }
    if (m === 'POST' && action === 'approve') return send(res, 200, approve(project, id, USER));
    if (m === 'POST' && action === 'run') {
      if (directorHas(project, id)) throw new StudioError('The Director is working on this job. Wait for it to finish.', 409);
      const what = body.action;
      if (!['prepare', 'render'].includes(what)) throw new StudioError('action must be prepare or render', 400);
      assertNoDrafts(readJson(jobFile(project, id, 'script.json'), null));
      if (what === 'prepare' && st.status === 'dirty' && (st.dirty_from || 99) < 5) {
        throw new StudioError('This change needs the Director first: click Run Director, or type /studio run in Claude Code', 409);
      }
      if (what === 'render' && !canRender(st)) throw new StudioError('Approve the storyboard first', 409);
      return send(res, 202, { started: runEngine(what, project, id).started });
    }
  }
  if (m === 'POST' && parts[0] === 'briefs') {
    const body = await readBody(req);
    const brief = validateBrief({ ...body, createdBy: USER }, { providers: readJson(PROVIDERS_FILE) });
    assertVoiceFits(brief.project, brief);
    return send(res, 201, saveBrief(brief));
  }
  if (m === 'PUT' && parts[0] === 'briefs' && parts.length === 3) {
    const project = assertId(parts[1], 'project');
    const id = assertId(parts[2], 'job');
    if (running.has(`${project}/${id}`)) throw new StudioError('A prepare or render of this job is running. Wait for it to finish.', 409);
    if (directorHas(project, id)) throw new StudioError('The Director is working on this job. Wait for it to finish.', 409);
    const body = await readBody(req);
    assertVoiceFits(project, body);
    return send(res, 200, updateBrief(project, id, body, { providers: readJson(PROVIDERS_FILE), by: USER }));
  }
  if (parts[0] === 'sequences' && parts.length === 1) {
    if (m === 'GET') {
      const project = assertId(url.searchParams.get('project') || '', 'project');
      const sequences = listSequences(project).map((s) => ({ ...s, running: running.has(`${project}/${s.sequence.id}`) }));
      return send(res, 200, { sequences, transitions: transitionList(), fadeSeconds: FADE_SECONDS, minParts: MIN_PARTS, maxParts: MAX_PARTS, targetRange: TARGET_RANGE });
    }
    if (m === 'POST') return send(res, 201, createSequence(await readBody(req), USER));
  }
  // A transition's demo clip for the sequence form: built once per project with ffmpeg, no model.
  if (m === 'GET' && parts[0] === 'sequences' && parts[1] === 'transitions' && parts[3] === 'preview' && parts.length === 4) {
    if (previewBusy) throw new StudioError('Another preview is being made, try again in a moment', 429);
    previewBusy = true;
    try { return send(res, 200, await transitionPreview(assertId(url.searchParams.get('project') || '', 'project'), assertId(parts[2], 'transition'))); } finally { previewBusy = false; }
  }
  if (parts[0] === 'sequences' && parts.length >= 3) {
    const [, project, id, action] = parts;
    assertId(project, 'project'); assertId(id, 'sequence');
    const key = `${project}/${id}`;
    if (m === 'GET' && !action) {
      const sequence = loadSequence(project, id);
      return send(res, 200, { sequence, status: sequenceStatusView(project, id, sequence), budget: sequenceBudget(project, sequence), running: running.get(key) || null });
    }
    if (running.has(key)) throw new StudioError('This sequence is rendering. Wait for it to finish.', 409);
    if (m === 'PUT' && !action) return send(res, 200, updateSequence(project, id, await readBody(req), USER));
    if (m === 'DELETE' && !action) return send(res, 200, deleteSequence(project, id));
    if (m === 'POST' && (action === 'render' || action === 'preview')) {
      const seq = loadSequence(project, id);
      checkParts(project, seq.format, seq.parts);
      return send(res, 202, { started: runEngine(action === 'render' ? 'sequence' : 'sequence-preview', project, id).started });
    }
  }
  if (m === 'POST' && parts[0] === 'projects' && parts.length === 1) {
    const body = await readBody(req);
    const id = assertId(String(body.id || ''), 'project');
    const from = body.from ? assertId(String(body.from), 'project') : '';
    return send(res, 201, createProject({ id, name: String(body.name || '').trim(), site: String(body.site || ''), from }));
  }
  if (parts[0] === 'projects' && parts[1]) {
    const project = assertId(parts[1], 'project');
    if (m === 'DELETE' && parts.length === 2) {
      const body = await readBody(req);
      if ([...running.keys()].some((k) => k.startsWith(`${project}/`))) throw new StudioError('A prepare or render of this project is running. Wait for it to finish.', 409);
      if (directorHas(project)) throw new StudioError('The Director is working on this project. Wait for it to finish.', 409);
      if (generateHas(project)) throw new StudioError('A Gemini generation for this project is running. Wait for it to finish.', 409);
      return send(res, 200, deleteProject(project, String(body.confirm || '')));
    }
    if (m === 'GET' && parts.length === 2) {
      return send(res, 200, {
        id: project, brand: readJson(path.join(profileDir(project), 'brand.json')), voiceNotes: loadVoiceNotes(project), assets: listAssets(project),
        icons: loadBrandIcons(project), builtInIcons: ICONS, maxIconKB: MAX_ICON_BYTES / 1024, maxIcons: MAX_BRAND_ICONS,
        stt: sttStatus(), transcripts: transcriptsFor(project),
        // Key name, usage, prompts and who acknowledged the notice stay on 127.0.0.1.
        ...(review ? {} : { generate: generateState(cfg.generate, readJson(PROVIDERS_FILE), project) }),
      });
    }
    if (parts[2] === 'generate') {
      if (m === 'POST' && parts.length === 3) {
        return send(res, 202, startGenerate(cfg.generate, readJson(PROVIDERS_FILE), { project, body: await readBody(req), by: USER }));
      }
      if (m === 'DELETE' && parts[3] === 'pause' && parts.length === 4) { clearPauseFile(GENERATE_FILES.pause); return send(res, 200, { ok: true }); }
    }
    if (m === 'POST' && parts[2] === 'assets' && parts.length === 3) {
      const buf = await readRaw(req, maxBytesFor(url.searchParams.get('name')));
      const saved = saveAsset(project, url.searchParams.get('name'), buf, { replace: url.searchParams.get('replace') === '1' });
      // An upload over a generated file or a cut clip is neither any more.
      fs.rmSync(sidecarFile(project, saved.name), { force: true });
      fs.rmSync(clipSidecar(project, saved.name), { force: true });
      return send(res, 201, saved);
    }
    if (m === 'DELETE' && parts[2] === 'assets' && parts[3]) {
      const name = decodeURIComponent(parts[3]);
      deleteAsset(project, name, readJson(path.join(profileDir(project), 'brand.json'), {}));
      fs.rmSync(sidecarFile(project, name), { force: true });
      forgetFootage(project, name);
      return send(res, 200, { ok: true });
    }
    // Shots panel: ffmpeg scene cuts, thumbnails, transcript search and clip cutting. No model.
    if (parts[2] === 'footage' && parts[3]) {
      const asset = decodeURIComponent(parts[3]);
      const [, , , , sub, file] = parts;
      if (m === 'GET' && !sub) return send(res, 200, shotsFor(project, asset));
      if (m === 'GET' && sub === 'images' && file && parts.length === 6) return serveFile(req, res, footageImage(project, asset, decodeURIComponent(file)), ASSET_HEADERS);
      if (m === 'GET' && sub === 'find' && parts.length === 5) return send(res, 200, findWords(project, asset, url.searchParams.get('q') || ''));
      if (m === 'POST' && sub === 'analyse' && parts.length === 5) {
        loadShots(project, asset); // refuses a missing or non-video asset before a child starts
        return send(res, 202, runAssetTask('shots', project, asset, [], within(footageDir(project, asset), 'analyse.log'), cfg.footage.analyseTimeoutMinutes));
      }
      if (m === 'POST' && sub === 'preview' && parts.length === 5) {
        const body = await readBody(req);
        if (previewBusy) throw new StudioError('Another preview is being made, try again in a moment', 429);
        previewBusy = true;
        try { return send(res, 200, await previewFrame(project, asset, body)); } finally { previewBusy = false; }
      }
      if (m === 'POST' && sub === 'clip' && parts.length === 5) {
        const body = await readBody(req);
        return send(res, 201, await withAssetSlot('clip', project, asset, () => makeClip(project, asset, body, { by: USER })));
      }
    }
    if (m === 'POST' && parts[2] === 'assets' && parts[3] && parts[4] === 'transcribe') {
      const body = await readBody(req);
      const st = sttStatus();
      if (!st.available) throw new StudioError(`Speech-to-text is not set up: ${st.reason}`, 503);
      const lang = String(body.lang || '');
      if (lang && !/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) throw new StudioError('lang must look like en or es', 400);
      return send(res, 202, runTranscribe(project, decodeURIComponent(parts[3]), lang.split('-')[0]));
    }
    if (m === 'GET' && parts[2] === 'transcripts' && parts[3]) {
      const doc = loadTranscript(project, decodeURIComponent(parts[3]));
      if (!doc) throw new StudioError('No transcript yet', 404);
      return send(res, 200, doc);
    }
    if (m === 'POST' && parts[2] === 'icons') {
      const buf = await readRaw(req, MAX_ICON_BYTES);
      return send(res, 201, saveIcon(project, url.searchParams.get('name'), buf, { replace: url.searchParams.get('replace') === '1' }));
    }
    if (m === 'DELETE' && parts[2] === 'icons' && parts[3]) {
      deleteIcon(project, decodeURIComponent(parts[3]));
      return send(res, 200, { ok: true });
    }
    // Hero banner: a standalone WebGL page in the brand colours, built in this process. No child, no model.
    if (m === 'POST' && parts[2] === 'banner' && parts.length === 3) {
      const body = await readBody(req);
      const file = writeBanner(project, {
        backdrop: body.backdrop, ...(body.size ? parseBannerSize(body.size) : {}),
        headline: body.headline, subline: body.subline, button: body.button, parallax: body.parallax,
      });
      return send(res, 201, { path: path.relative(ROOT, file).split(path.sep).join('/'), url: `/banner/${encodeURIComponent(project)}/${encodeURIComponent(path.basename(file))}` });
    }
    if (m === 'PUT' && parts[2] === 'brand') {
      const body = await readBody(req);
      const brand = validateBrand(body.brand);
      writeJson(path.join(profileDir(project), 'brand.json'), brand);
      if (typeof body.voiceNotes === 'string') fs.writeFileSync(path.join(profileDir(project), 'voice.md'), body.voiceNotes.slice(0, 8000), 'utf8');
      return send(res, 200, { ok: true, brand });
    }
  }
  throw new StudioError('Not found', 404);
}

function serveJobFile(req, res, url) {
  const [, , project, id, ...rest] = url.pathname.split('/');
  const rel = decodeURIComponent(rest.join('/'));
  if (!JOB_FILE_RE.test(rel)) { res.writeHead(404).end(); return; }
  // index.html/vendor/*.js must run script to render the composition, so they go out plain. An asset
  // prepare copied in (the brand logo, an uploaded SVG, …) never needs to run: the sandbox CSP here
  // matches the /assets/<project>/<name> route it was copied from.
  return serveFile(req, res, within(jobDir(project, id), rel), rel.startsWith('assets/') ? ASSET_HEADERS : {});
}

function servePreviewFile(req, res, url) {
  const [, , project, template, ...rest] = url.pathname.split('/');
  const rel = decodeURIComponent(rest.join('/'));
  return serveFile(req, res, previewFile(project, template, rel), rel.startsWith('assets/') ? ASSET_HEADERS : {});
}

function serveTransitionPreview(req, res, url) {
  const [, , project, name] = url.pathname.split('/');
  return serveFile(req, res, transitionPreviewFile(project, decodeURIComponent(name || '')));
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host || '')) { res.writeHead(421).end('Wrong host'); return; }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if ((origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) || req.headers['x-studio'] !== '1') {
        throw new StudioError('Cross-site request refused', 403);
      }
    }
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/files/')) return serveJobFile(req, res, url);
    if (url.pathname.startsWith('/tpreview/')) return servePreviewFile(req, res, url);
    if (url.pathname.startsWith('/xpreview/')) return serveTransitionPreview(req, res, url);
    if (url.pathname.startsWith('/banner/')) {
      const [, , project, ...rest] = url.pathname.split('/');
      return serveFile(req, res, bannerFile(project, decodeURIComponent(rest.join('/'))), BANNER_HEADERS);
    }
    if (url.pathname.startsWith('/assets/')) {
      const [, , project, name] = url.pathname.split('/');
      return serveFile(req, res, within(path.join(profileDir(project), 'assets'), decodeURIComponent(name || '')), ASSET_HEADERS);
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(req, res, path.join(DIRS.ui, 'index.html'));
    if (/^\/ui\/[a-z0-9-]+\.(js|css)$/.test(url.pathname)) return serveFile(req, res, path.join(DIRS.ui, path.basename(url.pathname)));
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    res.writeHead(404).end();
  } catch (err) {
    sendError(req, res, err, 'Internal error, see the server console');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use: Motion Studio is probably running already. Open http://${host}:${port}`);
    console.error('To restart it, stop the other process first (close its terminal), or change server.port in config/studio.json.');
    process.exit(1);
  }
  throw err;
});

ensureMusic().catch((err) => console.error('Built-in music could not be generated:', err.message));

server.listen(port, host, () => {
  console.log(`Motion Studio UI: http://${host}:${port}  (local only)`);
  console.log('Director: click Run Director in the UI (Claude Code headless on your seat, or the API provider picked in the panel), or type /studio run in Claude Code');
});

/* ---------- read-only review link (opt-in: npm run ui:review) ---------- */
if (process.argv.includes('--review')) startReview();

function startReview() {
  let lan;
  try { lan = lanInterface(cfg.server.reviewHost || ''); } catch (err) { console.error(`Review link not started: ${err.message}`); return; }
  const ip = lan.address;
  console.log(`Review link on ${lan.name} (${ip})${cfg.server.reviewHost ? ', set by server.reviewHost' : ''}.`);
  if (lan.others.length) console.log(`Other private addresses: ${lan.others.join(', ')}. To use one, set server.reviewHost in config/studio.json and restart.`);
  const rport = Number(process.env.MOTION_STUDIO_REVIEW_PORT) || cfg.server.reviewPort || 4781;
  const code = newCode();
  const self = `${ip}:${rport}`;
  const base = { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  const review = http.createServer(async (req, res) => {
    try {
      if ((req.headers.host || '') !== self) { res.writeHead(421).end('Wrong host'); return; }
      const url = new URL(req.url, `http://${self}`);
      if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      const route = reviewRoute(req.method, url.pathname);
      if (!route) { res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 404 : 405, base).end(); return; }
      if (route === 'page' && url.searchParams.has('code')) {
        if (!codeMatches(url.searchParams.get('code'), code)) { res.writeHead(401, { ...base, 'Content-Type': 'text/plain; charset=utf-8' }).end('Wrong review code. Ask the person running Motion Studio for the link.'); return; }
        res.writeHead(302, { ...base, Location: '/', 'Set-Cookie': `${COOKIE}=${code}; HttpOnly; SameSite=Strict; Path=/` }).end();
        return;
      }
      if (!codeMatches(cookieCode(req.headers.cookie), code)) {
        res.writeHead(401, { ...base, 'Content-Type': 'text/plain; charset=utf-8' }).end('Open the review link (with its code) from the person running Motion Studio.');
        return;
      }
      for (const [k, v] of Object.entries(base)) res.setHeader(k, v);
      if (route === 'page') {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
        res.end(req.method === 'HEAD' ? undefined : reviewPage(fs.readFileSync(path.join(DIRS.ui, 'index.html'), 'utf8')));
        return;
      }
      if (route === 'ui') return serveFile(req, res, path.join(DIRS.ui, path.basename(url.pathname)));
      // The Director's state without its log: viewers see jobs, not the Director's output.
      if (route === 'director') return send(res, 200, { running: null, last: null, pause: null, tail: '', maxJobsPerRun: cfg.director.maxJobsPerRun });
      if (route === 'api') return await api(req, res, url, true);
      if (route === 'assets') {
        const [, , project, name] = url.pathname.split('/');
        return serveFile(req, res, within(path.join(profileDir(project), 'assets'), decodeURIComponent(name)), ASSET_HEADERS);
      }
      if (route === 'tpreview') return servePreviewFile(req, res, url);
      return serveJobFile(req, res, url);
    } catch (err) {
      sendError(req, res, err, 'Internal error');
    }
  });
  review.on('error', (err) => console.error(`Review link not started: ${err.code === 'EADDRINUSE' ? `port ${rport} is in use (server.reviewPort)` : err.message}`));
  review.listen(rport, ip, () => {
    console.log(`Review link (read-only, same network): http://${self}/?code=${code}`);
    console.log('Anyone with this link can watch storyboards and renders until you stop the server. Nothing can be edited from it.');
  });
}
