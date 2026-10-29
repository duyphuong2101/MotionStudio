// The one non-Claude model path: a person clicks Generate (or Refresh models) in the Brand tab and the
// local server makes one capped request to the Gemini API with the person's own key from the environment.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, StudioError, assertId, assertFileName, within, readJson, writeJson, exists, nowIso, round } from '../engine/core.mjs';
import { profileDir, listAssets } from '../engine/jobs.mjs';
import { cleanAssetName, saveAsset, moveAssetFile } from '../engine/assets.mjs';
import { probeMedia } from '../engine/media.mjs';
import { usage, countUse, readPause } from './caps.mjs';
import { fetchJson, fetchToFile, redact, flatLine, GONE_RE } from './http.mjs';

// Moved to http.mjs; still exported here for tests/generate.test.mjs.
export { redact };

const API = 'https://generativelanguage.googleapis.com/v1beta';
const API_ORIGIN = new URL(API).origin;
export const MAX_PROMPT_CHARS = 2000;
export const MAX_MODEL_PAGES = 5;
const MAX_REFS = 3;
export const MAX_REF_BYTES = 8 * 1024 * 1024;
// First run only: the person's picks in config/providers.json → gemini.models replace these.
export const FALLBACK_MODELS = { image: 'gemini-nano-banana-2.1', video: 'gemini-omni-1.1-flash' };
// Omni takes no clip length: the model picks it, and generate.maxVideoSeconds refuses a longer clip after the download.
export const GENERATE_OPTIONS = {
  image: { aspectRatios: ['16:9', '9:16', '1:1', '4:5'] },
  video: { aspectRatios: ['16:9', '9:16'], maxRefs: MAX_REFS },
};
const IMAGE_SIZES = ['512', '1K'];
const CLIP_RESOLUTION = '720p';
const CLIP_MIME = 'video/mp4';
const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const REF_MIME = { ...IMAGE_MIME, webp: 'image/webp' };
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const KIND_EXT = { image: Object.keys(IMAGE_MIME), video: ['mp4'] };
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const KINDS = {
  image: { label: 'image', counter: 'images', perDay: 'maxImagesPerDay', perMonth: 'maxImagesPerMonth' },
  video: { label: 'clip', counter: 'videos', perDay: 'maxVideosPerDay', perMonth: 'maxVideosPerMonth' },
};
const NUMERIC_CAPS = ['maxImagesPerDay', 'maxImagesPerMonth', 'maxVideosPerDay', 'maxVideosPerMonth', 'maxRefreshesPerDay', 'requestTimeoutSeconds',
  'maxResponseBytes', 'maxVideoBytes', 'maxVideoSeconds', 'pollSeconds', 'maxPollMinutes', 'pauseMinutes', 'maxLogBytes'];

/** State files under one folder: `logs/generate/` in the server, a temp folder in tests. */
export const filesIn = (dir) => ({
  dir,
  images: path.join(dir, 'images.json'),
  videos: path.join(dir, 'videos.json'),
  refreshes: path.join(dir, 'refreshes.json'),
  pause: path.join(dir, 'pause.json'),
  models: path.join(dir, 'models.json'),
  notice: path.join(dir, 'notice.json'),
});
export const FILES = filesIn(path.join(ROOT, 'logs', 'generate'));

/* ---------- pure parts (tested) ---------- */
export function assertGenerateConfig(g) {
  const bad = NUMERIC_CAPS.find((k) => !(typeof g?.[k] === 'number' && g[k] > 0));
  if (bad) throw new StudioError(`config/studio.json generate.${bad} must be a positive number`, 503);
  if (!IMAGE_SIZES.includes(g.imageSize)) throw new StudioError(`config/studio.json generate.imageSize must be one of ${IMAGE_SIZES.join(', ')}`, 503);
  return g;
}

/** The choices the UI offers, from the fixed table and the config caps. */
export const optionsFor = (g) => ({
  image: { ...GENERATE_OPTIONS.image, size: g.imageSize },
  video: { ...GENERATE_OPTIONS.video },
});

/** One click's request, checked against the options: `refs` (clips only) names 0-MAX_REFS brand pictures; `unique` takes a free name. */
export function validateRequest(body, options) {
  const b = body && typeof body === 'object' ? body : {};
  const kind = b.kind;
  if (!Object.hasOwn(options, kind)) throw new StudioError(`kind must be ${Object.keys(options).join(' or ')}`, 400);
  const o = options[kind];
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new StudioError('Write a prompt first', 400);
  if (prompt.length > MAX_PROMPT_CHARS) throw new StudioError(`The prompt is ${prompt.length} characters, limit ${MAX_PROMPT_CHARS}: cut ${prompt.length - MAX_PROMPT_CHARS}`, 400);
  const aspectRatio = b.aspectRatio ?? o.aspectRatios[0];
  if (!o.aspectRatios.includes(aspectRatio)) throw new StudioError(`Aspect ratio must be one of ${o.aspectRatios.join(', ')}`, 400);
  const refs = b.refs ?? [];
  if (!Array.isArray(refs) || refs.some((r) => typeof r !== 'string')) throw new StudioError('refs must be a list of picture names', 400);
  if (refs.length && !o.maxRefs) throw new StudioError('Reference pictures are for clips only', 400);
  if (refs.length > (o.maxRefs || 0)) throw new StudioError(`Pick at most ${o.maxRefs} reference pictures`, 400);
  if (new Set(refs).size !== refs.length) throw new StudioError('A reference picture is picked twice', 400);
  const model = b.model ? String(b.model) : null;
  if (model && !MODEL_RE.test(model)) throw new StudioError('Invalid model id', 400);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  return { kind, prompt, aspectRatio, refs, model, name, replace: b.replace === true, unique: b.unique === true, acknowledged: b.acknowledged === true };
}

/** The picked pictures for a clip, base64: image assets listed in this brand only, each at most MAX_REF_BYTES. */
export function readRefs(project, names) {
  const listed = listAssets(project);
  return names.map((name) => {
    try { assertFileName(name, 'picture'); } catch { throw new StudioError(`"${String(name).slice(0, 80)}" is not a file in this brand's assets`, 400); }
    const mime = REF_MIME[path.extname(name).slice(1).toLowerCase()];
    if (!mime) throw new StudioError(`${name} is not a picture: a reference is a .png, .jpg or .webp asset`, 400);
    if (!listed.includes(name)) throw new StudioError(`${name} is not in this brand's assets. Upload it first.`, 404);
    const file = within(profileDir(project), 'assets', name);
    const st = fs.statSync(file);
    if (!st.isFile()) throw new StudioError(`${name} is not a file`, 400);
    if (st.size > MAX_REF_BYTES) throw new StudioError(`${name} is larger than ${MAX_REF_BYTES / 1024 / 1024} MB: pick a smaller picture`, 413);
    return { name, mime, data: fs.readFileSync(file).toString('base64') };
  });
}

const keyHeaders = (key) => ({ 'content-type': 'application/json', 'x-goog-api-key': key });

/** POST /interactions for one image. The key goes in the header only, never the URL. */
export function imageRequest({ model, prompt, aspectRatio, size, mime = 'image/jpeg' }, key) {
  return {
    url: `${API}/interactions`,
    init: {
      method: 'POST',
      headers: keyHeaders(key),
      body: JSON.stringify({ model, input: prompt, response_format: { type: 'image', mime_type: mime, aspect_ratio: aspectRatio, image_size: size } }),
    },
  };
}

const mimeForName = (name) => IMAGE_MIME[path.extname(name).slice(1).toLowerCase()];

/** The first image item in the interaction's steps, decoded, under the byte cap. */
export function imageFromInteraction(json, maxBytes) {
  const items = (Array.isArray(json?.steps) ? json.steps : []).flatMap((s) => (Array.isArray(s?.content) ? s.content : []));
  const img = items.find((c) => c?.type === 'image' && typeof c.data === 'string' && c.data);
  if (!img) throw new StudioError('Google answered without an image. Try another prompt or model.', 502);
  const mime = img.mime_type || 'image/jpeg';
  if (!MIME_EXT[mime]) throw new StudioError(`Google answered with ${String(mime).slice(0, 40)}, not a JPEG or PNG image`, 502);
  if (Math.floor(img.data.length * 3 / 4) > maxBytes) throw new StudioError(`The image is larger than ${maxBytes} bytes (generate.maxResponseBytes)`, 413);
  return { buf: Buffer.from(img.data, 'base64'), mime };
}

const extForMime = (mime) => MIME_EXT[mime];

/**
 * POST /interactions for one clip: the reference pictures in order, then the prompt; `reference_to_video` with
 * pictures, `text_to_video` without. The answer comes inline. The key goes in the header only.
 */
export function videoRequest({ model, prompt, aspectRatio, refs = [] }, key) {
  const input = [...refs.map((r) => ({ type: 'image', data: r.data, mime_type: r.mime })), { type: 'text', text: prompt }];
  return {
    url: `${API}/interactions`,
    init: {
      method: 'POST',
      headers: keyHeaders(key),
      body: JSON.stringify({
        model, input,
        generation_config: { video_config: { task: refs.length ? 'reference_to_video' : 'text_to_video' } },
        response_format: { type: 'video', aspect_ratio: aspectRatio, resolution: CLIP_RESOLUTION },
        store: false, background: false, stream: false,
      }),
    },
  };
}

/** Where a `uri` answer is downloaded: a `files/<id>` name or a URL, on the API host only, since the key goes with it. */
export function videoDownloadUrl(uri) {
  const s = String(uri ?? '').trim();
  const file = /^files\/([A-Za-z0-9_-]{1,128})(?::download)?$/.exec(s);
  if (file) return `${API}/files/${file[1]}:download?alt=media`;
  let u = null;
  try { u = new URL(s); } catch { /* refused below */ }
  if (!u || u.origin !== API_ORIGIN || u.username || u.password) {
    throw new StudioError(`Google answered with a clip link that is not on ${API_ORIGIN}. It was not fetched.`, 502);
  }
  if (!u.searchParams.has('alt')) u.searchParams.set('alt', 'media');
  return u.href;
}

/**
 * The first video item in the interaction's steps: inline `{ delivery, buf }` under the byte cap, or `{ delivery, url }`
 * when Google sent a `uri` instead. An inline answer past generate.maxResponseBytes already stopped in fetchJson
 * (413): one click is one call, so it is never asked again with `delivery: "uri"`.
 */
export function videoFromInteraction(json, maxBytes) {
  const items = (Array.isArray(json?.steps) ? json.steps : []).flatMap((s) => (Array.isArray(s?.content) ? s.content : []));
  const v = items.find((c) => c?.type === 'video' && ((typeof c.data === 'string' && c.data) || (typeof c.uri === 'string' && c.uri)));
  if (!v) throw new StudioError('Google answered without a clip. Try another prompt or model.', 502);
  const mime = v.mime_type || CLIP_MIME;
  if (mime !== CLIP_MIME) throw new StudioError(`Google answered with ${String(mime).slice(0, 40)}, not an MP4 clip`, 502);
  if (typeof v.data === 'string' && v.data) {
    if (Math.floor(v.data.length * 3 / 4) > maxBytes) throw new StudioError(`The clip is larger than ${maxBytes} bytes (generate.maxResponseBytes)`, 413);
    return { delivery: 'inline', buf: Buffer.from(v.data, 'base64') };
  }
  return { delivery: 'uri', url: videoDownloadUrl(v.uri) };
}

const SHAPE_ITEMS = 20;
const typeName = (v) => (typeof v === 'string' ? v.slice(0, 40) : typeof v);
const listOf = (v) => (Array.isArray(v) ? v.slice(0, SHAPE_ITEMS) : []);

/** The answer's shape for the generate log: keys, step and content types, mime types, data lengths. Never data, a uri or text. */
export function shapeOf(json) {
  return {
    keys: json && typeof json === 'object' ? Object.keys(json).slice(0, SHAPE_ITEMS).map(typeName) : [],
    steps: listOf(json?.steps).map((s) => ({
      type: typeName(s?.type),
      content: listOf(s?.content).map((c) => ({
        type: typeName(c?.type),
        ...(c?.mime_type !== undefined ? { mime_type: typeName(c.mime_type) } : {}),
        ...(typeof c?.data === 'string' ? { dataChars: c.data.length } : {}),
        ...(c?.uri !== undefined ? { uri: true } : {}),
      })),
    })),
  };
}

/** The probed clip against generate.maxVideoSeconds: 502 when it is no playable video, 422 past the ceiling. */
export function assertClipLength(info, maxSeconds) {
  if (!info?.hasVideo || !(info.duration > 0)) throw new StudioError('Google sent a file that is not a playable clip. Nothing was saved.', 502);
  if (info.duration > maxSeconds) {
    throw new StudioError(`The clip runs ${round(info.duration, 1)} s, longer than ${maxSeconds} s (generate.maxVideoSeconds). It was not saved; Google still bills it.`, 422);
  }
  return info.duration;
}

/** GET /models, one page. Metadata only: it generates nothing. */
export function modelsRequest(pageToken, key) {
  const q = new URLSearchParams({ pageSize: '200', ...(pageToken ? { pageToken } : {}) });
  return { url: `${API}/models?${q}`, init: { method: 'GET', headers: keyHeaders(key) } };
}

// The Model resource has no output-modality field: images pinned by the 2026-10-15 probe, Omni clips by the
// 2026-10-29 docs (the Veo previews were shut down on 2026-10-22).
const kindOf = (id, displayName, methods) => {
  if (!methods.includes('generateContent')) return null;
  if (/omni/i.test(id)) return 'video';
  if (/image|banana/i.test(id) || /image|banana/i.test(displayName)) return 'image';
  return null;
};

export function filterModels(resources) {
  return (Array.isArray(resources) ? resources : []).flatMap((m) => {
    const id = String(m?.name || '').replace(/^models\//, '');
    const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [];
    const displayName = String(m?.displayName || id).slice(0, 80);
    const kind = MODEL_RE.test(id) ? kindOf(id, displayName, methods) : null;
    return kind ? [{ id, displayName, description: String(m?.description || '').slice(0, 160), methods, kind }] : [];
  });
}

const versionOf = (id) => Math.max(-Infinity, ...(id.match(/\d+(?:\.\d+)?/g) || []).map(Number));
const COLLATOR = new Intl.Collator('en', { numeric: true });

/** Newest first: highest version number, GA before its -preview twin, then id descending; no number last. */
export function sortModels(list) {
  return [...list].sort((a, b) => (versionOf(b.id) - versionOf(a.id))
    || (/-preview$/.test(a.id) - /-preview$/.test(b.id))
    || COLLATOR.compare(b.id, a.id));
}

export function assertKnownModel(kind, id, list, defaults) {
  const ok = list ? list.some((m) => m.id === id && m.kind === kind) : id === defaults?.[kind];
  if (!ok) throw new StudioError(`Model ${id} is not in the fetched list. Click Refresh models or pick another.`, 400);
  return id;
}

const pad = (n) => String(n).padStart(2, '0');

/** The person's file name, cleaned like an upload, or gen-<yyyymmdd>-<hhmm>.<ext>. */
export function assetNameFor(kind, custom, now = new Date()) {
  const ext = KIND_EXT[kind][0];
  const raw = custom
    ? (/\.[a-z0-9]+$/i.test(custom) ? custom : `${custom}.${ext}`)
    : `gen-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${ext}`;
  const name = cleanAssetName(raw);
  const got = path.extname(name).slice(1).toLowerCase();
  if (!KIND_EXT[kind].includes(got)) throw new StudioError(`A generated ${kind === 'video' ? 'clip' : 'image'} is saved as .${KIND_EXT[kind].join(' or .')}`, 400);
  return name;
}

export const sidecarFile = (project, asset) => within(profileDir(project), 'generated', `${assertFileName(asset, 'asset')}.json`);

/** What the UI shows on a "Generated" tag, only for assets that still exist. */
export function generatedFor(project) {
  const out = {};
  for (const name of listAssets(project)) {
    const f = sidecarFile(project, name);
    if (!exists(f)) continue;
    const s = readJson(f, null);
    if (s) out[name] = { kind: s.kind, model: s.model, madeAt: s.madeAt, prompt: String(s.prompt || '').slice(0, 300) };
  }
  return out;
}

export function readNotice(file) {
  const n = readJson(file, null);
  return n && typeof n.acknowledgedAt === 'string' ? { acknowledgedAt: n.acknowledgedAt, by: n.by || null } : null;
}

/** The person's saved default per kind, or the first-run fallback. */
export function modelDefaults(providers) {
  const saved = providers?.providers?.gemini?.models || {};
  return Object.fromEntries(Object.entries(FALLBACK_MODELS).map(([k, v]) => [k, typeof saved[k] === 'string' && MODEL_RE.test(saved[k]) ? saved[k] : v]));
}

/** The list from the last Refresh models click, or null before the first one. */
export const fetchedModels = (files = FILES) => {
  const list = readJson(files.models, null)?.models;
  return Array.isArray(list) ? list : null;
};

/** Saves the person's picks into config/providers.json, changing nothing but gemini.models. */
export function saveModelDefaults(providersFile, picks, list) {
  const raw = readJson(providersFile);
  const gem = raw?.providers?.gemini;
  if (!gem) throw new StudioError('config/providers.json has no gemini provider', 503);
  const defaults = modelDefaults(raw);
  const models = Object.fromEntries(Object.keys(FALLBACK_MODELS).map((kind) => [kind, assertKnownModel(kind, String(picks?.[kind] ?? ''), list, defaults)]));
  gem.models = models;
  writeJson(providersFile, raw);
  return { models };
}

/* ---------- state ---------- */
let current = null;
let last = null;

const when = (iso) => new Date(iso).toLocaleString('en-US');

const noKeyMessage = (keyEnv) => `Add ${keyEnv} to .env in the Motion Studio folder (or set it in your environment), then restart npm run ui.`;

function keyFor(providers, env) {
  const keyEnv = providers?.providers?.gemini?.keyEnv;
  if (!keyEnv) throw new StudioError('config/providers.json has no gemini.keyEnv', 503);
  if (!env[keyEnv]) throw new StudioError(noKeyMessage(keyEnv), 503);
  return { keyEnv, key: env[keyEnv] };
}

function assertFree(files) {
  if (current) throw new StudioError('A Gemini request is already running. Wait for it to finish.', 409);
  const pause = readPause(files.pause);
  if (pause) throw new StudioError(`Paused until ${when(pause.until)} after a Gemini quota or spend limit. Wait, or clear the pause.`, 429);
}

// Appends one redacted line, control characters flattened so a prompt or Google's text cannot forge a line;
// past generate.maxLogBytes the file starts over.
function logLine(ctx, name, text) {
  const file = within(ctx.files.dir, name);
  const line = `${nowIso()} ${redact(flatLine(text), ctx.key)}\n`;
  fs.mkdirSync(ctx.files.dir, { recursive: true });
  const size = exists(file) ? fs.statSync(file).size : 0;
  if (size + Buffer.byteLength(line) > ctx.g.maxLogBytes) fs.writeFileSync(file, `[log restarted at generate.maxLogBytes]\n${line}`);
  else fs.appendFileSync(file, line);
}

/**
 * One request to Google through `fetchJson` (timeout per call, or `ctx.signal` for a whole refresh; byte cap;
 * no redirects), then quota → pause file, a refused model → "Refresh models".
 */
async function callGoogle(ctx, { url, init }) {
  const { g, key } = ctx;
  const answer = await fetchJson(ctx.fetch, {
    url, init, who: 'Google', keys: key, signal: ctx.signal,
    timeoutMs: ctx.timeoutMs ?? g.requestTimeoutSeconds * 1000, timeoutLabel: ctx.timeoutLabel ?? 'generate.requestTimeoutSeconds',
    maxBytes: g.maxResponseBytes, label: 'generate.maxResponseBytes',
  });
  checkAnswer(ctx, answer);
  if (!answer.json) throw new StudioError('Google answered something that is not JSON', 502);
  return answer.json;
}

/** A `uri` clip streamed to `file` from the API host only, under generate.maxVideoBytes, with the clip call's timeout. */
async function downloadClip(ctx, url, file) {
  const answer = await fetchToFile(ctx.fetch, {
    url, init: { method: 'GET', headers: { 'x-goog-api-key': ctx.key } }, who: 'Google', keys: ctx.key, file,
    timeoutMs: ctx.timeoutMs, timeoutLabel: ctx.timeoutLabel, maxBytes: ctx.g.maxVideoBytes, label: 'generate.maxVideoBytes',
  });
  // A refused download is not a refused model.
  checkAnswer({ ...ctx, model: null }, answer);
  return answer.bytes;
}

/** Quota → pause file; a refused model → "Refresh models"; any other non-2xx → 502. */
function checkAnswer(ctx, { res, json, text }) {
  const { g, key } = ctx;
  const msg = redact(String(json?.error?.message || text || res.statusText).slice(0, 300), key);
  if (res.status === 429 || json?.error?.status === 'RESOURCE_EXHAUSTED') {
    const until = new Date(ctx.now().getTime() + g.pauseMinutes * 60000).toISOString();
    writeJson(ctx.files.pause, { until, reason: msg, at: nowIso(), project: ctx.project || null });
    throw new StudioError(`Gemini quota or spend limit reached. Paused until ${when(until)}.`, 429);
  }
  if (!res.ok) {
    if (ctx.model && (res.status === 404 || (res.status < 500 && GONE_RE.test(msg)))) {
      throw new StudioError(`Model ${ctx.model} is listed but Google refused it: ${msg}. Click Refresh models and pick another.`, 502);
    }
    throw new StudioError(`Google answered ${res.status}: ${msg}`, 502);
  }
}

const MAX_NAME_TRIES = 99;

/** `name`, or the first free `<stem>-2.<ext>`, `-3`… in the project's assets. */
function freeAssetName(project, name) {
  const dir = path.join(profileDir(project), 'assets');
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  for (let i = 1; i <= MAX_NAME_TRIES; i++) {
    const n = i === 1 ? name : `${stem}-${i}${ext}`;
    if (!exists(within(dir, n))) return n;
  }
  throw new StudioError(`No free file name for ${name}. Delete or rename some assets.`, 409);
}

async function runImage(ctx, req, run) {
  const mime = mimeForName(run.name);
  const json = await callGoogle(ctx, imageRequest({ model: run.model, prompt: req.prompt, aspectRatio: req.aspectRatio, size: ctx.g.imageSize, mime }, ctx.key));
  const img = imageFromInteraction(json, ctx.g.maxResponseBytes);
  // Another format than asked: the overwrite check was for the old name, so never replace. The call is paid, so a taken name gets a suffix.
  const same = img.mime === mime;
  const replace = same && req.replace;
  const target = same ? run.name : `${run.name.replace(/\.[^.]+$/, '')}.${extForMime(img.mime)}`;
  const saved = saveAsset(ctx.project, replace ? target : freeAssetName(ctx.project, target), img.buf, { replace });
  writeJson(sidecarFile(ctx.project, saved.name), {
    provider: 'gemini', kind: 'image', model: run.model, prompt: req.prompt, aspectRatio: req.aspectRatio, size: ctx.g.imageSize,
    madeAt: nowIso(), by: run.by, key: `personal (${ctx.keyEnv})`, bytes: saved.bytes, responseId: typeof json.id === 'string' ? json.id : null,
  });
  return saved;
}

/**
 * One clip: the call, the clip written to a part file beside the assets (inline) or streamed there (uri), probed
 * against generate.maxVideoSeconds, then moved into the assets with its sidecar. One shape line goes to the log
 * whatever happens, so the first real clip settles what the docs leave open.
 */
async function runVideo(ctx, req, run, refs) {
  const started = Date.now();
  const task = refs.length ? 'reference_to_video' : 'text_to_video';
  const shape = { task, refs: refs.length, answer: false };
  const dir = within(profileDir(ctx.project), 'generated');
  const part = within(dir, `${run.name}.part`);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(part, { force: true });
  try {
    const json = await callGoogle(ctx, videoRequest({ model: run.model, prompt: req.prompt, aspectRatio: req.aspectRatio, refs }, ctx.key));
    Object.assign(shape, { answer: true }, shapeOf(json));
    const clip = videoFromInteraction(json, ctx.g.maxResponseBytes);
    shape.delivery = clip.delivery;
    if (clip.delivery === 'inline') fs.writeFileSync(part, clip.buf, { flag: 'wx' });
    else await downloadClip(ctx, clip.url, part);
    shape.bytes = fs.statSync(part).size;
    let info;
    try { info = await ctx.probe(part); } catch { throw new StudioError('Google sent a file whose length could not be read. Nothing was saved.', 502); }
    Object.assign(shape, { duration: round(info.duration, 2), width: info.width, height: info.height, audio: info.hasAudio });
    const seconds = assertClipLength(info, ctx.g.maxVideoSeconds);
    const saved = moveAssetFile(ctx.project, req.replace ? run.name : freeAssetName(ctx.project, run.name), part, { replace: req.replace, maxBytes: ctx.g.maxVideoBytes });
    writeJson(sidecarFile(ctx.project, saved.name), {
      provider: 'gemini', kind: 'video', model: run.model, prompt: req.prompt, aspectRatio: req.aspectRatio, resolution: CLIP_RESOLUTION, task,
      references: refs.map((r) => r.name), delivery: clip.delivery, seconds: round(seconds, 2), bytes: saved.bytes,
      madeAt: nowIso(), by: run.by, key: `personal (${ctx.keyEnv})`, responseId: typeof json.id === 'string' ? json.id : null,
    });
    return saved;
  } finally {
    fs.rmSync(part, { force: true });
    shape.seconds = round((Date.now() - started) / 1000, 1);
    try { logLine(ctx, `${ctx.project}.log`, `${run.by} clip shape: ${JSON.stringify(shape)}`); } catch { /* the result still reaches the UI */ }
  }
}

/** Starts one generation in the background after every cap check; the UI polls `generateState`. */
export function startGenerate(g, providers, { project, body, by, fetch = globalThis.fetch, env = process.env, now = () => new Date(), files = FILES, probe = probeMedia }) {
  assertGenerateConfig(g);
  const { keyEnv, key } = keyFor(providers, env);
  const req = validateRequest(body, optionsFor(g));
  if (!exists(profileDir(project))) throw new StudioError('Unknown project', 404);
  assertFree(files);
  const k = KINDS[req.kind];
  const used = usage(files[k.counter], now());
  if (used.day >= g[k.perDay]) throw new StudioError(`Daily ${k.label} limit reached (${g[k.perDay]}, generate.${k.perDay})`, 429);
  if (used.month >= g[k.perMonth]) throw new StudioError(`Monthly ${k.label} limit reached (${g[k.perMonth]}, generate.${k.perMonth})`, 429);
  const notice = readNotice(files.notice);
  if (!notice && !req.acknowledged) throw new StudioError('Tick the notice first', 400);
  const defaults = modelDefaults(providers);
  const model = assertKnownModel(req.kind, req.model || defaults[req.kind], fetchedModels(files), defaults);
  let name = assetNameFor(req.kind, req.name, now());
  if (exists(within(profileDir(project), 'assets', name)) && !req.replace) {
    if (!req.unique) throw new StudioError(`${name} already exists. Tick "Replace existing" to overwrite it.`, 409);
    name = freeAssetName(project, name);
  }
  const refs = readRefs(project, req.refs);

  const video = req.kind === 'video';
  // A clip is made in one synchronous call that takes 1-3 minutes, past requestTimeoutSeconds: maxPollMinutes bounds it.
  const ctx = { g, key, keyEnv, fetch, now, files, project, model, probe, ...(video ? { timeoutMs: g.maxPollMinutes * 60000, timeoutLabel: 'generate.maxPollMinutes' } : {}) };
  if (!notice) writeJson(files.notice, { acknowledgedAt: nowIso(), by });
  countUse(files[k.counter], now());
  logLine(ctx, `${project}.log`, `${by} ${req.kind} ${model} ${name} ${req.aspectRatio}${refs.length ? ` refs ${req.refs.join(',')}` : ''}: ${req.prompt.slice(0, 200)}`);
  const run = { project, kind: req.kind, model, name, by, startedAt: nowIso(), status: 'running' };
  current = run;
  (video ? runVideo(ctx, req, run, refs) : runImage(ctx, req, run))
    .then((saved) => {
      run.status = 'done';
      run.message = saved.name === run.name ? `Generated ${saved.name}`
        : video ? `Generated ${saved.name} (${run.name} was taken meanwhile)` : `Generated ${saved.name} (Google sent another format than ${run.name} asked for)`;
      run.name = saved.name;
    })
    .catch((err) => { run.status = 'error'; run.message = redact(err instanceof StudioError ? err.message : `Generation failed: ${err?.message}`, key); })
    .finally(() => {
      run.endedAt = nowIso();
      try { logLine(ctx, `${project}.log`, `${run.status}: ${run.message}`); } catch { /* the result still reaches the UI */ }
      current = null;
      last = run;
    });
  return { started: req.kind, name, model };
}

const MODELS_LOG = '_models.log';

/**
 * One Refresh models click: what the key reaches, metadata only. Shares the slot, byte caps and pause; its own
 * daily cap; one timeout (requestTimeoutSeconds) for all pages together.
 */
export async function refreshModels(g, providers, { by, fetch = globalThis.fetch, env = process.env, now = () => new Date(), files = FILES }) {
  assertGenerateConfig(g);
  const { keyEnv, key } = keyFor(providers, env);
  assertFree(files);
  if (usage(files.refreshes, now()).day >= g.maxRefreshesPerDay) throw new StudioError(`Daily model refresh limit reached (${g.maxRefreshesPerDay}, generate.maxRefreshesPerDay)`, 429);
  const ctx = { g, key, keyEnv, fetch, now, files, project: null, model: null, signal: AbortSignal.timeout(g.requestTimeoutSeconds * 1000) };
  countUse(files.refreshes, now());
  current = { project: null, kind: 'models', by, startedAt: nowIso(), status: 'running' };
  try {
    const all = [];
    let token = null;
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
      const json = await callGoogle(ctx, modelsRequest(token, key));
      if (Array.isArray(json.models)) all.push(...json.models);
      token = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null;
      if (!token) break;
    }
    const models = sortModels(filterModels(all));
    const stored = { fetchedAt: nowIso(), by, models };
    writeJson(files.models, stored);
    const count = (kind) => models.filter((m) => m.kind === kind).length;
    logLine(ctx, MODELS_LOG, `${by} models refreshed: ${count('image')} image, ${count('video')} video (of ${all.length})`);
    return stored;
  } catch (err) {
    try { logLine(ctx, MODELS_LOG, `${by} models refresh failed: ${err?.message}`); } catch { /* the error still reaches the UI */ }
    throw err;
  } finally {
    current = null;
  }
}

export const generateHas = (project) => Boolean(current && current.project === project);

const publicRun = (r) => r && { project: r.project, kind: r.kind, model: r.model, name: r.name, by: r.by, startedAt: r.startedAt, endedAt: r.endedAt || null, status: r.status, message: r.message || null };

/** What the Brand tab shows: options, caps, usage, models, pause, notice, generated tags. Never the key. */
export function generateState(g, providers, project, { env = process.env, files = FILES } = {}) {
  let error = null;
  try { assertGenerateConfig(g); } catch (e) { error = e.message; }
  const keyEnv = providers?.providers?.gemini?.keyEnv || null;
  const now = new Date();
  return {
    hasKey: Boolean(keyEnv && env[keyEnv]),
    keyEnv,
    error,
    options: error ? null : optionsFor(g),
    models: { defaults: modelDefaults(providers), available: fetchedModels(files) || [], fetchedAt: readJson(files.models, null)?.fetchedAt || null },
    caps: error ? null : Object.fromEntries(Object.values(KINDS).flatMap((k) => [[k.perDay, g[k.perDay]], [k.perMonth, g[k.perMonth]]])),
    usage: { images: usage(files.images, now), videos: usage(files.videos, now) },
    running: publicRun(current),
    last: last && last.project === assertId(project, 'project') ? publicRun(last) : null,
    pause: readPause(files.pause),
    notice: readNotice(files.notice),
    generated: generatedFor(project),
  };
}
