// The API worker's tools: bound to one project and job, writes only the two draft files, never render or approve.
import fs from 'node:fs';
import path from 'node:path';
import { StudioError, readJson, writeJson, assertFileName, within } from '../../engine/core.mjs';
import { jobDir, jobFile, getStatus, profileDir } from '../../engine/jobs.mjs';
import { claim, commit, fail } from '../../engine/pipeline.mjs';
import { fetchPage } from './fetch-page.mjs';

const KINDS = ['source', 'script'];
const KINDS_IMAGE = ['still', 'asset'];
const JOB_FILES = ['source.json', 'script.json', 'status.json', 'source.draft.json', 'script.draft.json', 'timing.json'];
// A claimed job, or one the Director is fixing after prepare; never queued, preparing, approved, rendering or done.
const WRITABLE = ['scripting', 'scripted', 'dirty', 'awaiting_review', 'error'];
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const str = (description, maxLength) => ({ type: 'string', description, maxLength });
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

/** null when `args` fits `schema` (object, string with enum or maxLength, object values), else what is wrong. */
export function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'needs its arguments as an object';
  const unknown = Object.keys(args).filter((k) => !Object.hasOwn(schema.properties, k));
  if (unknown.length) return `got an unknown argument ${unknown.join(', ')}`;
  const missing = schema.required.filter((k) => args[k] === undefined);
  if (missing.length) return `needs ${missing.join(' and ')}`;
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties[k];
    if (p.type === 'object' && (!v || typeof v !== 'object' || Array.isArray(v))) return `needs ${k} as an object`;
    if (p.type !== 'string') continue;
    if (typeof v !== 'string') return `needs ${k} as a string`;
    if (p.enum && !p.enum.includes(v)) return `needs ${k} as one of ${p.enum.join(', ')}`;
    if (p.maxLength && v.length > p.maxLength) return `needs ${k} of at most ${p.maxLength} characters`;
  }
  return null;
}

/** Width and height from a PNG IHDR, or null. */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

/** Width and height from the first JPEG start-of-frame marker, or null. */
export function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      const height = buf.readUInt16BE(i + 5), width = buf.readUInt16BE(i + 7);
      return width && height ? { width, height } : null;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const isWebp = (buf) => buf.length >= 16 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';

/** One still or brand asset as `{ kind, name, width, height, image: { mime, buf } }`; the loop sends `image` as an image part. */
export function readImage(ctx, kind, name) {
  const { project, job, g, counters } = ctx;
  if (!KINDS_IMAGE.includes(kind)) throw new StudioError('kind must be still or asset', 400);
  assertFileName(name, 'image');
  if (counters.images >= g.maxImagesPerJob) throw new StudioError(`Already read ${g.maxImagesPerJob} images for this job (maxImagesPerJob). Rely on lint for the rest.`, 429);
  if (!IMAGE_RE.test(name)) throw new StudioError('Only PNG, JPEG or WebP images can be read', 415);
  const file = kind === 'still' ? within(path.join(jobDir(project, job), 'stills'), name) : within(path.join(profileDir(project), 'assets'), name);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new StudioError(`No ${kind} named ${name}`, 404);
  if (stat.size > g.maxImageBytes) throw new StudioError(`${name} is ${stat.size} bytes, over the ${g.maxImageBytes}-byte limit (maxImageBytes)`, 413);
  const buf = fs.readFileSync(file);
  const png = pngSize(buf), jpeg = !png && jpegSize(buf), webp = !png && !jpeg && isWebp(buf);
  if (!png && !jpeg && !webp) throw new StudioError(`${name} is not a readable image`, 415);
  counters.images++;
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp';
  return { kind, name, width: (png || jpeg)?.width ?? null, height: (png || jpeg)?.height ?? null, image: { mime, buf } };
}

function assertWritable(project, job) {
  const { status } = getStatus(project, job);
  if (!WRITABLE.includes(status)) throw new StudioError(`Cannot write while the job is "${status}". Claim the job first.`, 409);
}

/** `{ status, duration, lint, stills }` (plus `message` when prepare ended in error) from status.json. */
function prepareResult(project, job) {
  const st = getStatus(project, job);
  const lint = st.lint ? { errors: st.lint.errors, warnings: st.lint.warnings, findings: st.lint.findings } : null;
  return { status: st.status, duration: st.duration ?? null, lint, stills: (st.stills || []).map(({ id, t, file }) => ({ id, t, file })), ...(st.status === 'error' ? { message: st.error } : {}) };
}

/**
 * The tools for one job: `[{ name, description, schema, run(args) }]`. `ctx` is
 * `{ project, job, by, hosts, g: director.api, runPrepare(project, job) → { done }, fetch, vision, counters?, signal?, lookup? }`
 * (`signal` stops `fetch_page`; `lookup` replaces the DNS lookup in tests).
 * `run` answers `{ error }` for arguments that fail the schema and for every StudioError; other errors throw.
 */
export function toolsFor(ctx) {
  const { project, job, by, g } = ctx;
  const counters = ctx.counters || {};
  for (const k of ['prepare', 'images', 'fetches']) counters[k] ??= 0;
  const list = [
    ['claim', 'Claim the job before any other step. Moves it to scripting.', schema(),
      () => ({ status: claim(project, job, by).status })],
    ['fetch_page', `Fetch one page of the brief's site as text, title and image list. Only the brand's allowed hosts, at most ${g.maxFetchesPerJob} per job.`, schema({ url: str('http(s) URL on an allowed host', 2000) }, ['url']),
      ({ url }) => {
        if (counters.fetches >= g.maxFetchesPerJob) throw new StudioError(`Already fetched ${g.maxFetchesPerJob} pages for this job (maxFetchesPerJob). Work from what you have, or fail the job.`, 429);
        counters.fetches++;
        return fetchPage(url, { hosts: ctx.hosts || [], fetch: ctx.fetch, g, signal: ctx.signal, lookup: ctx.lookup });
      }],
    ['read_job_file', "Read one of this job's files as JSON.", schema({ name: { type: 'string', enum: JOB_FILES } }, ['name']),
      ({ name }) => readJson(jobFile(project, job, name), null) ?? { error: `No ${name} yet` }],
    ['write_draft', 'Write the whole source or script draft. Commit it next.', schema({ kind: { type: 'string', enum: KINDS }, content: { type: 'object', description: 'The full source.json or script.json document' } }, ['kind', 'content']),
      ({ kind, content }) => {
        assertWritable(project, job);
        const bytes = Buffer.byteLength(JSON.stringify(content, null, 2) + '\n');
        if (bytes > g.maxDraftBytes) throw new StudioError(`The ${kind} draft is ${bytes} bytes, over the ${g.maxDraftBytes}-byte limit (maxDraftBytes). Write a shorter one.`, 413);
        writeJson(jobFile(project, job, `${kind}.draft.json`), content);
        return { bytes };
      }],
    ['commit', 'Validate the draft and commit it. Locked fields a person edited are kept; mechanical repairs (ids, icons, enum values, extra scenes) are listed.', schema({ kind: { type: 'string', enum: KINDS } }, ['kind']),
      ({ kind }) => {
        assertWritable(project, job);
        const { kept, repairs } = commit(project, job, kind, by);
        return { status: getStatus(project, job).status, kept, ...(repairs.length ? { repairs } : {}) };
      }],
    ['prepare', `Build the storyboard: timing, composition, stills and lint. At most ${g.maxPrepareRounds} times per job.`, schema(),
      async () => {
        if (counters.prepare >= g.maxPrepareRounds) throw new StudioError(`Prepare already ran ${g.maxPrepareRounds} times for this job (maxPrepareRounds). Fail the job with what is still wrong.`, 429);
        // A busy engine throws here (429) before anything starts, so it uses no round.
        const handle = await ctx.runPrepare(project, job);
        counters.prepare++;
        await handle?.done;
        return prepareResult(project, job);
      }],
    ...(ctx.vision ? [['read_image', `Look at one still of this job or one brand asset. At most ${g.maxImagesPerJob} per job.`, schema({ kind: { type: 'string', enum: KINDS_IMAGE }, name: str('File name, e.g. s1.png', 128) }, ['kind', 'name']),
      ({ kind, name }) => readImage({ ...ctx, counters }, kind, name)]] : []),
    ['fail', 'Stop the job with a reason the person can act on. Ends the job.', schema({ reason: str('What is wrong and how to fix it; cut at 300 characters', 2000) }, ['reason']),
      ({ reason }) => { const st = fail(project, job, reason, by); return { status: st.status, reason: st.error }; }],
    ['done', 'End the job once it is in awaiting_review.', schema({ summary: str('One or two sentences on what was made', 2000) }, ['summary']),
      () => ({ status: getStatus(project, job).status })],
  ];
  return list.map(([name, description, sch, impl]) => ({
    name, description, schema: sch,
    async run(args = {}) {
      const bad = checkArgs(sch, args);
      if (bad) return { error: `${name} ${bad}` };
      try { return await impl(args); } catch (err) {
        if (err instanceof StudioError) return { error: err.message };
        throw err;
      }
    },
  }));
}
