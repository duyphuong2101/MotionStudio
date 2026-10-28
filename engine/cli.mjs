#!/usr/bin/env node
import { StudioError, loadStudioConfig, round } from './core.mjs';
import { listJobs, loadBrief, jobFile, markDirty, STEPS } from './jobs.mjs';
import { directorContext } from './context.mjs';
import { claim, commit, fail, prepare, render, describe, qaJob, playJob, benchJob, BENCH_SECONDS, BENCH_WORKERS } from './pipeline.mjs';
import { MAX_WORKERS } from './frames.mjs';
import { renderSequence, previewSequence } from './sequences.mjs';
import { transcribeAsset } from './stt.mjs';
import { analyseFootage, findWords, makeClip } from './footage.mjs';
import { reviewOf, pacingTable, FLAG_TEXT } from './review.mjs';
import { gitEvidence, aliasForPath, csvEvidence, readCsvFile } from './evidence.mjs';
import { writeBanner, parseBannerSize, BANNER_BACKDROPS, BANNER_SIZES } from './banner.mjs';
import { makePackGlb, DEPTH_RANGE } from './pack-glb.mjs';

const USAGE = `Motion Studio engine

  node engine/cli.mjs list [--queued] [--project <p>]
  node engine/cli.mjs context <project> <job>       print brief, brand, voice notes, assets, template rules (for the director)
  node engine/cli.mjs claim   <project> <job> [--by name]
  node engine/cli.mjs commit  <project> <job> source|script [--by name]
  node engine/cli.mjs fail    <project> <job> --reason "<text>" [--by name]   stop a job before review: status error with that reason
  node engine/cli.mjs prepare <project> <job>       steps 5-7: timing, compose, stills + lint, play-through check
  node engine/cli.mjs playcheck <project> <job>     play a prepared job frame by frame again and print what overlaps (writes nothing)
  node engine/cli.mjs review  <project> <job>       pacing table (words per second, head, tail, silence) and the review sheet path (writes nothing)
  (approve)                                         a person approves the storyboard in the UI only; no command here approves
  node engine/cli.mjs render  <project> <job>       steps 9-11: frames, audio, final.mp4
  node engine/cli.mjs bench   <project> <job> [--seconds ${BENCH_SECONDS}] [--workers ${BENCH_WORKERS.join(',')}]   time the first seconds of a prepared job
        with each Chrome count, to pick config/studio.json → render.concurrency (writes nothing in the job)
  node engine/cli.mjs status  <project> <job>
  node engine/cli.mjs reset-dirty <project> <job> <step> [--force] [--by name]   send a job back to step 1-${STEPS.length} (status dirty);
        refused while it is scripting, preparing or rendering unless --force (for a job stuck after a crash)
  node engine/cli.mjs transcribe <project> <asset> [--lang en]   speech to text for a video or sound asset (local model), kept for the director
  node engine/cli.mjs shots   <project> <asset> [--force]   shots (scene cuts), thumbnails and letterbox bars of a video asset
  node engine/cli.mjs find    <project> <asset> "<words>"   where the words are said, from the asset's stored transcript
  node engine/cli.mjs clip    <project> <asset> --in <s> --out <s> --name <new.mp4> [--fill cover|blur-fill]
        [--crop-top <%>] [--crop-bottom <%>] [--crop x:y:w:h] [--blur x:y:w:h ...] [--keep cx:cy:rx:ry]
        [--gain <dB>] [--mute] [--speed <x>] [--smooth blend|motion|none] [--size 1920x1080] [--replace]   cut a new brand asset from a video asset
        (a slower clip blends neighbouring frames by default; motion follows the movement, up to 20 s out, and is slow to make)
  node engine/cli.mjs qa      <project> <job>       check a done job's final.mp4 again: loudness, black/frozen picture, size, captions
  node engine/cli.mjs sequence <project> <sequence>  join the parts' final.mp4 files into out/<project>/<sequence>/final.mp4
  node engine/cli.mjs sequence-preview <project> <sequence>  a quick low-resolution preview.mp4 of the same joins
  node engine/cli.mjs evidence git <repo> [--since 2026-01-01] [--until 2026-09-30] [--tickets OP-1,OP-2] [--grep "<text>"] [--json]
        read-only git: commits, merge PR and first release branch per ticket, as fact lines (repo = an alias in config/studio.json → evidence.repos)
  node engine/cli.mjs evidence csv <file.csv> --date <col> --value <col>[,<col>] [--group <col>] --range 2025-01..2025-09 [--range 2026-01..2026-09] [--prefix $] [--json]
        period totals and growth from a CSV export (e.g. GA4), as fact lines naming the file, column and ranges
  node engine/cli.mjs banner  <project> [--backdrop ${BANNER_BACKDROPS.join('|')}] [--size ${BANNER_SIZES.join('|')}] [--headline "<text>"]
        [--subline "<text>"] [--button "<text>"] [--parallax]   a standalone WebGL hero banner page in the brand colours,
        written to out/<project>/_banner/<backdrop>-<size>.html (no render, no model)
  node engine/cli.mjs pack-glb <project> --front <pack.png> [--back <back.png>] [--name <pack.glb>] [--depth ${DEPTH_RANGE[0]}-${DEPTH_RANGE[1]}]
        [--replace]   a soft 3D pack (rounded pillow, print round the rim) from its pictures, saved as a brand asset for a
        model scene or a product-demo hero; transparent or black margins are trimmed (a pack shot on white keeps its margin, cut it first)
`;

/** `banner` flags, in the shape writeBanner takes (it validates them). */
function bannerArgs(args) {
  const size = flag(args, 'size');
  return {
    backdrop: flag(args, 'backdrop'), headline: flag(args, 'headline'), subline: flag(args, 'subline'), button: flag(args, 'button'),
    parallax: args.includes('--parallax'), ...(size === undefined ? {} : parseBannerSize(size)),
  };
}

/** `evidence git|csv`: rows and paste-ready fact lines. Gathered by a person; the Director has no access to it. */
async function evidence(args) {
  const json = args.includes('--json');
  const sub = args.shift();
  if (sub === 'git') {
    const repoPath = flag(args, 'repo-path');
    const opts = { since: flag(args, 'since'), until: flag(args, 'until'), tickets: flag(args, 'tickets'), grep: flag(args, 'grep'), max: flag(args, 'max') };
    const [alias] = args.filter((a) => !a.startsWith('--'));
    const r = await gitEvidence(repoPath ? aliasForPath(repoPath) : alias, opts);
    if (json) return console.log(JSON.stringify(r));
    console.log(`${r.repo}: ${r.examined} commit(s) examined (cap ${r.cap}${r.capped ? ', reached: narrow the search' : ''}), release branches ${r.releasePattern}*${r.since || r.until ? `, ${r.since || '…'} to ${r.until || '…'}` : ''}`);
    for (const row of r.rows) {
      if (!row.found) { console.log(`  ${row.term}: ${row.skipped ? 'skipped (commit cap reached)' : 'no commits found'}`); continue; }
      console.log(`  ${row.term}: ${row.merged ? 'merged' : 'committed'} ${row.date}, ${row.release ? `first released in ${row.release}` : 'not in any release branch'}, ${row.commits.length} commit(s)`);
      for (const c of row.commits) console.log(`    ${c.date} ${c.sha} ${c.subject}`);
    }
    console.log(r.lines.length ? `\nFact lines:\n${r.lines.join('\n')}` : '\nNo fact lines.');
    return;
  }
  if (sub === 'csv') {
    const ranges = [];
    for (let v = flag(args, 'range'); v !== undefined; v = flag(args, 'range')) ranges.push(v);
    const opts = { dateCol: flag(args, 'date'), valueCols: flag(args, 'value'), groupCol: flag(args, 'group'), prefix: flag(args, 'prefix'), ranges };
    const [file] = args.filter((a) => !a.startsWith('--'));
    if (!file) throw new StudioError('Name the CSV file: evidence csv <file.csv> --date <col> --value <col> --range 2025-01..2025-09', 400);
    const r = csvEvidence(readCsvFile(file), { ...opts, file });
    if (json) return console.log(JSON.stringify(r));
    console.log(`${r.file}: ${r.ranges.map((x) => `${x.label} (${x.from} to ${x.to}, ${x.rows} rows)`).join(' vs ')}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    console.log(r.lines.length ? `\nFact lines:\n${r.lines.join('\n')}` : '\nNo fact lines.');
    return;
  }
  throw new StudioError('Use: evidence git <repo> … or evidence csv <file.csv> … (see help)', 400);
}

function flag(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** `a:b:c:d` → { [keys[0]]: a, … } as numbers. */
function tuple(v, keys, what) {
  const p = String(v ?? '').split(':');
  if (p.length !== keys.length) throw new StudioError(`--${what} takes ${keys.join(':')}`, 400);
  return Object.fromEntries(keys.map((k, i) => [k, Number(p[i])]));
}

/** `bench` flags: seconds of video (1-60) and the Chrome counts to try (1-MAX_WORKERS). */
function benchOptions(seconds, workers) {
  const secs = seconds === undefined ? BENCH_SECONDS : Number(seconds);
  if (!(secs >= 1 && secs <= 60)) throw new StudioError('--seconds takes 1 to 60', 400);
  const list = workers === undefined ? BENCH_WORKERS : String(workers).split(',').map(Number);
  if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_WORKERS)) throw new StudioError(`--workers takes Chrome counts from 1 to ${MAX_WORKERS}, e.g. 2,4,6`, 400);
  return { seconds: secs, workers: list };
}

/** Clip options from `clip` flags, in the shape makeClip takes (it validates them). */
function clipOptions(args) {
  const blurRegions = [];
  for (let b = flag(args, 'blur'); b !== undefined; b = flag(args, 'blur')) blurRegions.push(tuple(b, ['x', 'y', 'w', 'h'], 'blur'));
  const top = flag(args, 'crop-top'), bottom = flag(args, 'crop-bottom'), crop = flag(args, 'crop'), keep = flag(args, 'keep'), size = flag(args, 'size');
  const [width, height] = size ? size.split('x').map(Number) : [];
  return {
    in: flag(args, 'in'), out: flag(args, 'out'), name: flag(args, 'name'), fill: flag(args, 'fill'), gainDb: flag(args, 'gain'), speed: flag(args, 'speed'), smooth: flag(args, 'smooth'),
    mute: args.includes('--mute'), replace: args.includes('--replace'), blurRegions, width, height,
    ...(top || bottom ? { band: { top, bottom } } : {}),
    ...(crop ? { crop: tuple(crop, ['x', 'y', 'w', 'h'], 'crop') } : {}),
    ...(keep ? { keep: tuple(keep, ['cx', 'cy', 'rx', 'ry'], 'keep') } : {}),
  };
}

const DIRECTOR_QUEUE =(st) => st.status === 'queued' || (st.status === 'dirty' && (st.dirty_from ?? 99) <= 4);

async function main(argv) {
  const args = [...argv];
  const cmd = args.shift();
  const by = flag(args, 'by', process.env.USERNAME || process.env.USER || 'cli');
  const projectFilter = flag(args, 'project', undefined);
  const lang = flag(args, 'lang', '');
  const reason = flag(args, 'reason', '');
  const queuedOnly = args.includes('--queued');
  const bench = cmd === 'bench' ? benchOptions(flag(args, 'seconds'), flag(args, 'workers')) : null;
  const banner = cmd === 'banner' ? bannerArgs(args) : null;
  const [project, id, extra] = args.filter((a) => !a.startsWith('--'));

  switch (cmd) {
    case 'list': {
      const max = loadStudioConfig().director.maxJobsPerRun;
      let jobs = listJobs(projectFilter);
      if (queuedOnly) jobs = jobs.filter((j) => DIRECTOR_QUEUE(j.status)).slice(0, max);
      if (!jobs.length) return console.log(queuedOnly ? 'No jobs waiting for the director.' : 'No jobs.');
      for (const j of jobs) {
        const s = j.status;
        console.log(`${j.brief.project}/${j.brief.id}\t${s.status}${s.dirty_from ? ` (from step ${s.dirty_from})` : ''}\tstep ${s.step}\t${j.brief.template}${j.brief.mix?.length ? ` +${j.brief.mix.length}` : ''}\t${j.brief.director}`);
      }
      if (queuedOnly) console.log(`\n(capped at ${max} jobs per run)`);
      return;
    }
    case 'context': console.log(JSON.stringify(directorContext(project, id), null, 2)); return;
    case 'claim': console.log(JSON.stringify(claim(project, id, by).status)); return;
    case 'commit': console.log(JSON.stringify(commit(project, id, extra, by))); return;
    case 'fail': console.log(`error: ${fail(project, id, reason, by).error}`); return;
    case 'prepare': {
      const st = await prepare(project, id, by);
      console.log(`${st.status}: ${st.duration}s, lint ${st.lint?.errors ?? 0} error(s), ${st.lint?.warnings ?? 0} warning(s)`);
      for (const f of st.lint?.findings || []) console.log(`  [${f.level}] ${f.scene ? f.scene + ' ' : ''}${f.el}: ${f.msg}`);
      for (const s of st.stills || []) console.log(`  still ${s.file} @ ${s.t}s`);
      if (st.status === 'error') process.exitCode = 2;
      return;
    }
    case 'playcheck': {
      for (const p of await playJob(project, id)) {
        const errors = p.findings.filter((f) => f.level === 'error').length;
        console.log(`${p.format}: ${p.duration}s, ${p.frames} frames every ${round(p.step, 3)}s in ${p.seconds}s, ${errors} error(s), ${p.findings.length - errors} warning(s)`);
        for (const f of p.findings) console.log(`  [${f.level}] ${f.scene ? `${f.scene} ` : ''}${f.el}: ${f.msg}`);
        if (errors) process.exitCode = 2;
      }
      return;
    }
    case 'review': {
      loadBrief(project, id);
      const { pacing: p, sheet } = reviewOf(project, id);
      if (!p) throw new StudioError('This job has no timing yet: run prepare first', 409);
      for (const line of pacingTable(p)) console.log(line);
      const t = p.thresholds;
      console.log(`\nspeech ${p.totals.speech}s of ${p.duration}s, silence ${Math.round(p.totals.silence * 100)}% (limit ${Math.round(t.maxSilence * 100)}%)`);
      const flagged = [...p.scenes.flatMap((r) => r.flags.map((f) => `${r.id}: ${FLAG_TEXT[f]}`)), ...p.totals.flags.map((f) => `job: ${FLAG_TEXT[f]}`)];
      console.log(flagged.length ? `flags (fast > ${t.fastWps} w/s, long tail > ${t.slowTail}s, silence > ${Math.round(t.maxSilence * 100)}%):\n  ${flagged.join('\n  ')}` : 'flags: none');
      console.log(sheet ? `sheet: ${jobFile(project, id, sheet)}` : 'sheet: none yet (it appears on the next prepare)');
      return;
    }
    // Approval stays in the UI so no coding agent, named or not, can pass the person's review from a shell.
    case 'approve': {
      const { host, port } = loadStudioConfig().server;
      throw new StudioError(`A person approves in the UI: open http://${host}:${port}, pick the job, then Approve. The CLI cannot approve.`, 403);
    }
    case 'render': {
      const st = await render(project, id, by);
      console.log(`${st.status}: ${JSON.stringify(st.outputs)}`);
      return;
    }
    case 'bench': {
      const r = await benchJob(project, id, { ...bench, onRun: (x) => console.log(`  ${x.workers} Chrome(s): ${x.seconds}s, ${x.fps} frames/s`) });
      console.log(`${r.frames} frames (${r.seconds}s of video). Fastest: ${r.best.workers} Chrome(s). render.concurrency is ${r.configured ?? 'unset (4)'}.`);
      if (r.results.length < 2) console.log('Only one Chrome count fits this machine and length (at most half the CPU threads, one second of video each).');
      return;
    }
    case 'sequence': {
      const st = await renderSequence(project, id, by);
      console.log(`${st.status}: ${st.outputs.duration}s, ${st.outputs.parts.length} parts, ${st.outputs.transition}`);
      return;
    }
    case 'sequence-preview': {
      const st = await previewSequence(project, id, by);
      console.log(`preview: ${st.preview.width}x${st.preview.height}, ${st.preview.duration}s, joins ${st.preview.transitions.join(', ') || 'none'}`);
      return;
    }
    case 'status': console.log(JSON.stringify(describe(project, id), null, 2)); return;
    case 'transcribe': {
      const doc = await transcribeAsset(project, id, { lang });
      console.log(`${doc.asset}: ${doc.duration}s, language ${doc.lang}, ${doc.segments.length} segments in ${doc.seconds}s`);
      for (const sg of doc.segments) console.log(`  [${sg.start.toFixed(2)} → ${sg.end.toFixed(2)}] ${sg.text}`);
      return;
    }
    case 'shots': {
      const doc = await analyseFootage(project, id, { force: args.includes('--force') });
      const bars = doc.bars ? `${doc.bars.color} bars (crop ${doc.bars.crop.w}:${doc.bars.crop.h}:${doc.bars.crop.x}:${doc.bars.crop.y})` : 'no bars';
      console.log(`${doc.asset}: ${doc.duration}s, ${doc.width}x${doc.height}${doc.fps ? ` @ ${doc.fps} fps` : ''}, ${doc.hasAudio ? 'sound' : 'no sound'}, ${bars}, ${doc.shots.length} shots${doc.truncated ? ' (capped)' : ''}`);
      for (const s of doc.shots) console.log(`  #${s.n}\t${clock(s.start)} → ${clock(s.end)}\tthumbs/${s.thumb}`);
      return;
    }
    case 'find': {
      const r = findWords(project, id, extra);
      console.log(`${r.total} hit(s) for "${r.query}" in ${r.asset}${r.stale ? ' (transcript is older than the file: transcribe it again)' : ''}`);
      for (const h of r.hits) console.log(`  [${clock(h.start)} → ${clock(h.end)}] ${h.text}`);
      return;
    }
    case 'clip': {
      const r = await makeClip(project, id, clipOptions(args), { by });
      console.log(`${r.name}: ${round(r.sidecar.out - r.sidecar.in, 3)}s from ${r.sidecar.source} (${r.sidecar.in} → ${r.sidecar.out}), ${r.sidecar.width}x${r.sidecar.height}, ${r.sidecar.fill}${r.sidecar.sound ? `, sound ${r.sidecar.gainDb} dB` : ', no sound'}, ${Math.round(r.bytes / 1024)} KB`);
      return;
    }
    case 'qa': {
      const { qa } = (await qaJob(project, id, by)).outputs;
      console.log(`QA ${qa.passed ? 'passed' : 'failed'}: ${qa.errors} error(s), ${qa.warnings} warning(s)${qa.loudness !== null ? `, ${qa.loudness} LUFS` : ''}`);
      for (const f of qa.findings) console.log(`  [${f.level}] ${f.check}: ${f.msg}`);
      if (!qa.passed) process.exitCode = 2;
      return;
    }
    case 'evidence': return evidence(args);
    case 'banner': console.log(writeBanner(project, banner)); return;
    case 'pack-glb': {
      const r = await makePackGlb(project, { front: flag(args, 'front'), back: flag(args, 'back'), name: flag(args, 'name'), depth: flag(args, 'depth', 0.3), replace: args.includes('--replace') });
      console.log(`${r.name}: ${r.bytes} bytes, pack ${r.crop.w}x${r.crop.h} at ${r.crop.x},${r.crop.y}, aspect ${r.aspect}`);
      return;
    }
    case 'reset-dirty': {
      const st = markDirty(project, id, extra, { force: args.includes('--force'), by });
      console.log(`${st.status} from step ${st.dirty_from}`);
      return;
    }
    default:
      console.log(USAGE);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((err) => {
  // `--json` callers (the UI server's evidence route) read the error and its code from stdout.
  if (process.argv.includes('--json') && err instanceof StudioError) console.log(JSON.stringify({ error: err.message, code: err.code }));
  console.error(err instanceof StudioError ? `Error: ${err.message}` : err.stack || err.message);
  process.exitCode = 1;
});
