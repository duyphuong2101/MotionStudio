// Export for an editor (plan .ai/plans/art-direction.md E6): a rendered job as pieces a person can finish in an
// editor. out/<project>/<job>/export/ gets one clip per scene cut from the rendered picture (frame exact, no sound),
// the sound stems (voice, footage sound, cut sounds, music as the final mix places it), the captions and timeline.xml,
// a Final Cut Pro 7 XML sequence that Premiere Pro and DaVinci Resolve open with every clip and stem in place. CapCut
// takes the clips and stems, not the timeline. No model, no network; every ffmpeg call has a timeout.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StudioError, readJson, within, loadStudioConfig } from './core.mjs';
import { getStatus, setStatus, jobDir, jobFile, loadBrief, loadBrand } from './jobs.mjs';
import { ffmpeg, mediaTimeoutMs, BT709_TAGS } from './media.mjs';
import { musicStemArgs, SPEECH_FILES } from './pipeline.mjs';
import { SFX_FILE } from './sfx.mjs';
import { scriptBrand } from './looks.mjs';

export const EXPORT_DIR = 'export';
const SCENE_CRF = 16;

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (n) => String(n).padStart(2, '0');

/** Each scene as whole frames: [{ id, name, from, frames }] laid end to end from frame 0. Pure, for tests. */
export function sceneFrames(timing, fps) {
  const scenes = timing.scenes || [];
  const total = Math.round(timing.duration * fps);
  return scenes.map((s, i) => {
    const from = Math.round(s.start * fps);
    const to = i + 1 < scenes.length ? Math.round(scenes[i + 1].start * fps) : total;
    return { id: s.id, name: `${pad2(i + 1)}-${s.id}.mp4`, from, frames: Math.max(1, to - from) };
  });
}

/** ffmpeg args for one scene clip: input-seeked to its first frame, exactly `frames` frames, re-encoded. */
export const sceneClipArgs = (video, { from, frames }, fps, out) => ['-y', '-ss', (from / fps).toFixed(4), '-i', video, '-an', '-frames:v', String(frames),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...BT709_TAGS, '-crf', String(SCENE_CRF), '-preset', 'veryfast', '-movflags', '+faststart', out];

/**
 * timeline.xml: an FCP 7 XML (xmeml 5) sequence. V1 holds the scene clips end to end; each stem is its own audio track
 * from frame 0. Paths are absolute file URLs to the export folder (an editor relinks by name if it moves). Pure, for tests.
 */
export function timelineXml({ title, fps, width, height, total, scenes, stems, dir }) {
  const rate = `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`;
  const url = (rel) => xml(pathToFileURL(path.join(dir, rel)).href.replace('file:///', 'file://localhost/'));
  const video = scenes.map((s, i) => `
          <clipitem id="clip-v${i + 1}">
            <name>${xml(s.name)}</name><duration>${s.frames}</duration>${rate}
            <start>${s.from}</start><end>${s.from + s.frames}</end><in>0</in><out>${s.frames}</out>
            <file id="file-v${i + 1}"><name>${xml(s.name)}</name><pathurl>${url(`scenes/${s.name}`)}</pathurl>${rate}<duration>${s.frames}</duration>
              <media><video><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></video></media></file>
          </clipitem>`).join('');
  const audio = stems.map((f, i) => `
        <track>
          <clipitem id="clip-a${i + 1}">
            <name>${xml(f)}</name><duration>${total}</duration>${rate}
            <start>0</start><end>${total}</end><in>0</in><out>${total}</out>
            <file id="file-a${i + 1}"><name>${xml(f)}</name><pathurl>${url(`stems/${f}`)}</pathurl>${rate}<duration>${total}</duration>
              <media><audio><channelcount>${f === 'music.wav' ? 2 : 1}</channelcount></audio></media></file>
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
        </track>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${xml(title)}</name><duration>${total}</duration>${rate}
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
        <track>${video}
        </track>
      </video>
      <audio>${audio}
      </audio>
    </media>
  </sequence>
</xmeml>
`;
}

/** Writes the export of a rendered job and records it in status.outputs.export; a failure lands in exportError. */
export async function exportJob(project, id, by = 'engine') {
  try {
    return await writeExport(project, id, by);
  } catch (err) {
    setStatus(project, id, { exportError: err.message }, 'export failed', by);
    throw err;
  }
}

async function writeExport(project, id, by) {
  const st = getStatus(project, id);
  if (st.status !== 'done') throw new StudioError('Render the video first: the export is cut from the rendered video', 409);
  const dir = jobDir(project, id);
  const video = within(dir, 'video.mp4');
  if (!fs.existsSync(video)) throw new StudioError('The rendered picture (video.mp4) is gone: render again, then export', 409);
  const timing = readJson(jobFile(project, id, 'timing.json'), null);
  if (!timing?.scenes?.length) throw new StudioError('This job has no timing.json: rebuild the storyboard and render it first', 409);
  const o = st.outputs || {};
  const fps = o.fps || loadStudioConfig().render.fps;
  const out = within(dir, EXPORT_DIR);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(out, 'stems'), { recursive: true });
  const scenes = sceneFrames(timing, fps);
  for (const s of scenes) await ffmpeg(sceneClipArgs(video, s, fps, path.join(out, 'scenes', s.name)), { timeoutMs: mediaTimeoutMs(s.frames / fps) });
  const stems = [];
  for (const f of [...SPEECH_FILES, SFX_FILE]) {
    if (!fs.existsSync(path.join(dir, f))) continue;
    fs.copyFileSync(path.join(dir, f), path.join(out, 'stems', f));
    stems.push(f);
  }
  const script = readJson(jobFile(project, id, 'script.json'), null);
  const musicArgs = await musicStemArgs(project, scriptBrand(script, loadBrand(project)), { duration: timing.duration, musicShift: timing.music?.shift || 0, out: path.join(out, 'stems', 'music.wav') });
  if (musicArgs) { await ffmpeg(musicArgs, { timeoutMs: mediaTimeoutMs(timing.duration) }); stems.push('music.wav'); }
  if (fs.existsSync(path.join(dir, 'captions.srt'))) fs.copyFileSync(path.join(dir, 'captions.srt'), path.join(out, 'captions.srt'));
  const total = Math.round(timing.duration * fps);
  const title = loadBrief(project, id)?.subject || id;
  fs.writeFileSync(path.join(out, 'timeline.xml'), timelineXml({ title, fps, width: o.width, height: o.height, total, scenes, stems, dir: out }), 'utf8');
  const record = { dir: EXPORT_DIR, scenes: scenes.length, stems, timeline: 'timeline.xml', at: new Date().toISOString() };
  return setStatus(project, id, { outputs: { ...o, export: record }, exportError: null }, `exported for an editor: ${scenes.length} scene clip(s), ${stems.length} stem(s)`, by);
}
