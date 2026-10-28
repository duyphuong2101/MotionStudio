// What the API worker sends: a system prompt (API header + the shared director rules + the script or the quick rules)
// and the job's context.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadStudioConfig } from '../../engine/core.mjs';
import { directorContext } from '../../engine/context.mjs';

const rulesFile = (name) => path.join(ROOT, 'server', 'worker', name);
const SHARED_RULES = rulesFile('director-prompt.md');
// Full-script rules, or the outline rules for a job whose context is a quick context (it carries `quick`).
const MODE_RULES = { script: rulesFile('director-script.md'), quick: rulesFile('director-quick.md') };
// Used while config/studio.json has no director.api block (the Data design values).
const API_DEFAULTS = { maxTurnsPerJob: 40, maxImagesPerJob: 8, maxPrepareRounds: 3 };
const MAX_SEGMENTS = 400;
const HOST_REASON = "The brief URL host <host> is not in this brand's allowed hosts. Add it in Brand → Allowed data hosts (or clear the URL), then click Run Director again.";

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rules = (file) => fs.readFileSync(file, 'utf8').trimEnd();

function imageLines(vision, g) {
  return vision ? {
    still: `\`read_image\` with kind \`still\` and a still's file name from the \`prepare\` result (at most ${plural(g.maxImagesPerJob, 'image')} per job)`,
    image: '`read_image` with kind `asset` and a name from `assets`, or kind `still`',
    note: 'You can read stills and asset images with `read_image`.',
  } : {
    still: 'not available: rely on lint and the `prepare` result',
    image: 'not available',
    note: 'You cannot see images; rely on lint and the context. Where a rule says to read an image first, take the choice that needs no look (a shot with `focus: null` and no cursor, no bullet `asset` you set yourself) and say so in your report.',
  };
}

// The header lines that differ between a full script and an outline (quick mode).
const MODE = {
  script: {
    drafts: 'two drafts (source and script)',
    draft: 'script',
    read: 'template rules (`sequence`, `fields`, `limits`, `enums`)',
    step: 'Script: follow "Script (step 4)" below.',
    files: '`source.json`, `script.json`, `status.json`, `timing.json`, the drafts',
    layout: ', and look for three scenes of one kind in a row in `script.json` ("same layout", the context\'s `layoutRule`)',
    commit: 'its result lists the fields it kept locked and any `repairs`',
  },
  quick: {
    drafts: 'two drafts (the source, then an outline the engine expands into the script)',
    draft: 'outline',
    read: 'the `quick` block (the outline fields with their limits, `moods`, `icons`, an example `shape`)',
    step: 'Outline: follow "Outline (step 4)" below.',
    files: '`source.json`, `outline.json`, `script.json`, `status.json`, `timing.json`, the drafts',
    layout: '',
    commit: 'its result lists the fields it kept locked, any `repairs`, `warnings` and `notes`',
  },
};

/**
 * The API header for one provider, with the caps from `d` (config director), followed by the shared rules and the
 * rules of the job's mode: the full script, or the outline when `quick` (the job's context is a quick context).
 */
export function systemPrompt({ provider = null, d = loadStudioConfig().director, vision = false, quick = false } = {}) {
  const g = { ...API_DEFAULTS, ...d.api };
  const fixRounds = Math.max(0, g.maxPrepareRounds - 1);
  const img = imageLines(vision, g);
  const mode = quick ? 'quick' : 'script';
  const m = MODE[mode];
  const header = `# Motion Studio director (API)

You are the director for Motion Studio, running on ${provider?.label || 'an API provider'} with tools. The project and the job are fixed for this conversation; the first message names them and holds the job's context. You write ${m.drafts}, commit them, and hand off to the deterministic engine. You never render and never approve: a person approves in the UI.

## Hard limits

- Answer with tool calls. No tool takes a project, a job or a path; never ask for one.
- Your only writes are \`write_draft\` (the source draft or the ${m.draft} draft). Never render, never approve, never change the status, the brand, templates or engine code.
- At most ${plural(g.maxTurnsPerJob, 'turn')} and ${plural(d.jobTimeoutMinutes, 'minute')} for this job.
- Fix rounds: \`prepare\` runs at most ${plural(g.maxPrepareRounds, 'time')} per job, the first build and at most ${plural(fixRounds, 'fix round')}, whatever the fix is for (lint, pacing or stills).
- Fetch only with \`fetch_page\`, and only hosts in the brand's \`sources.allowedHosts\`. The context's \`urlCheck\` is \`{ host, allowed }\` (null when the brief has no URL). When \`allowed\` is false, do not claim and do not fetch: call \`fail\` with the reason "${HOST_REASON}"
- To stop a job you cannot finish (a stuck job, a source with no usable claim, a lint that still fails after the last fix round when the job is not already \`error\`), call \`fail\` with a reason: what is wrong and how the person fixes it, in one or two plain English sentences, at most 300 characters. The person sees it in the UI. \`fail\` works only before the storyboard (\`queued\`, \`scripting\`, \`scripted\`, \`dirty\`).
- ${img.note}

## Steps

1. Read all of the context: brief, brand, voice notes, assets, ${m.read}, current status, \`urlCheck\`, and any existing \`locks\`.
2. \`claim\`.
3. Source: follow "Source (step 3)" below.
4. ${m.step}
5. Storyboard: follow "Storyboard (steps 5-7)" below.
6. When the job is in \`awaiting_review\`, call \`done\` with your report: the job, its duration and anything the reviewer should look at.

## Actions

The rules below name actions. Here each one is a tool call:

| Action | Tool |
|---|---|
| read the context | the first message; \`read_job_file\` reads a job file again |
| claim the job | \`claim\` |
| fetch the brief page | \`fetch_page\` with the brief URL; take the product name, image URLs and feature bullets word for word from its \`title\`, \`text\` and \`images\` |
| read a job file (${m.files}) | \`read_job_file\` |
| write the source draft | \`write_draft\` with kind \`source\` and the whole JSON as \`content\` |
| commit the source | \`commit\` with kind \`source\` |
| write the ${m.draft} draft | \`write_draft\` with kind \`${m.draft}\` and the whole JSON as \`content\` |
| commit the ${m.draft} | \`commit\` with kind \`${m.draft}\`; ${m.commit} |
| build the storyboard | \`prepare\`; its result holds the status, the duration, the lint findings and the stills |
| read the pacing | \`read_job_file\` with \`timing.json\`: compare each voice line's words with its time ("fast" is well over 2.6 words per second) and each scene's length with its voice ("long tail")${m.layout} |
| read each still | ${img.still} |
| read an image | ${img.image} |
| fail the job with a reason | \`fail\` with \`reason\` |
| your report | the \`summary\` of \`done\` |
`;
  return `${header}\n${rules(SHARED_RULES)}\n\n${rules(MODE_RULES[mode])}\n`;
}

/** The first user message: the job's director context, with each transcript cut to its first segments. */
export function contextMessage(project, job, ctx = directorContext(project, job)) {
  if (ctx.transcripts) {
    ctx.transcripts = Object.fromEntries(Object.entries(ctx.transcripts).map(([asset, t]) => [asset,
      (t.segments?.length || 0) > MAX_SEGMENTS ? { ...t, segments: t.segments.slice(0, MAX_SEGMENTS), segmentsTotal: t.segments.length } : t]));
  }
  return `Job ${project}/${job}. Context:\n${JSON.stringify(ctx)}`;
}

/**
 * The system prompt and the first message for one job, from one read of its context: the quick rules when the
 * context is a quick context, else the full-script rules. `opts` are systemPrompt's `provider`, `d` and `vision`.
 */
export function jobPrompt(project, job, opts = {}) {
  const ctx = directorContext(project, job);
  return { system: systemPrompt({ ...opts, quick: Boolean(ctx.quick) }), context: contextMessage(project, job, ctx) };
}
