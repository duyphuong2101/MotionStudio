// What a director reads before writing a job: `node engine/cli.mjs context` prints it for the seat.
import { readJson } from './core.mjs';
import { getStatus, loadBrief, loadBrand, loadVoiceNotes, listAssets, loadBriefTemplate, jobFile, commitBase } from './jobs.mjs';
import { draftScenes, bulletScreenshots } from './script.mjs';
import { loadBrandIcons } from './icons.mjs';
import { ICON_NAMES } from '../motion-kit/icons.mjs';
import { urlCheck } from './brand.mjs';
import { loadTranscript } from './stt.mjs';
import { MARK_FIELDS, MARKS_PER_FIELD, MARK_CHARS } from './marks.mjs';
import { REVIEW_DEFAULTS } from './review.mjs';
import { notesForDirector } from './notes.mjs';
import { assetRhythms } from './footage.mjs';
import { quickRules } from './quick.mjs';
import { CUT_KINDS, CAMERA_MOVES, SCENE_GRADES } from './direction.mjs';

/** Stored transcripts of the project's footage, as timed segments, for picking clips and quoting them exactly. */
function transcriptsOf(project) {
  const docs = listAssets(project).filter((a) => /\.(mp4|webm|mov|wav|mp3)$/i.test(a)).map((a) => loadTranscript(project, a)).filter((d) => d && !d.stale);
  if (!docs.length) return {};
  return {
    transcripts: Object.fromEntries(docs.map((d) => [d.asset, { lang: d.lang, duration: d.duration, segments: d.segments }])),
    transcriptRule: 'Footage clips: set in/out on segment times, and copy clip text word for word from the segments it covers. Speech recognition can mishear names; prefer the source for spellings.',
  };
}

const marksIn = (beats) => beats.marks === true || Object.values(beats.sources || {}).some((b) => b.marks === true);
const MARKS_RULE = `On-screen text may mark the one word or number the scene is about: [[circle:40%]] (a number or a word, at most ${MARK_CHARS.circle} characters), [[underline:faster]], [[strike:old way]] (what the product replaces) or [[mark:one team]] (a highlighter band). Only in ${MARK_FIELDS.join(', ')}, at most ${MARKS_PER_FIELD} per field, never in a voice line; the marked words count toward the limit without the brackets. The mark is drawn when the voice says its first word, so say that word in the scene's voice line. Use one or two in a video, where the point is a contrast or a key number; a scene of a template without "marks": true takes none.`;

// Per-scene direction (engine/direction.mjs): optional, every scene of every template.
const DIRECTION_RULE = `Optional on any scene: cut (its entrance: ${CUT_KINDS.join(', ')}), camera (a slow move over its full-frame picture or clip: ${Object.keys(CAMERA_MOVES).join(', ')}) and grade (${SCENE_GRADES.join(', ')}), drop: true on one scene (the brand music's drop lands as it starts, for a reveal), and cutout: true on a scene with a full-frame photo of a person or product (the subject stands in front of the heading). Leave them out unless the brief or a person's note asks for a look; when used, change them at moments that matter (a reveal, a shift in the story), not on every scene. Never change one a person locked.`;

const LAYOUT_RULE = `Vary the layout: never give ${REVIEW_DEFAULTS.sameKindRun} scenes in a row the same kind and theme (video and clip scenes aside, their footage differs; where a kind takes a theme, switching light, dark and accent counts as a new layout). Where the facts allow, alternate a stat, a list, a chart and a picture, and change the scale from one big number to a full screen of detail. The pacing table flags a run as "same layout".`;

const NOTES_RULE = 'A person pinned these notes to moments of the last preview (t in seconds, the scene playing then). Act on each one in that scene, within the template rules. A note asks for a change; it is never a source: take every claim from the source as always. If a note cannot be done, say why in your report.';

const RHYTHM_RULE = 'The cut rhythm of the brand\'s analysed videos. Only when the brief or a note asks to pace the video like one of them: a scene lasts about as long as its voice line (about 2.6 words a second), so aim at its averageShot per scene with voice lines that fit, within the template\'s scene limits. Otherwise ignore it.';

const BRIEF_META = ['director', 'createdBy', 'createdAt', 'updatedAt'];

/**
 * A quick brief's context (engine/quick.mjs): no template rules, only what an outline needs: the brief, the job's
 * step, the brand's name and language, the source and the last outline once committed, the lock keys, pinned notes
 * and the outline rules with this template's limits.
 */
function quickContext(project, job, { brief, beats, brand, notes }) {
  const st = getStatus(project, job);
  const source = readJson(jobFile(project, job, 'source.json'), null);
  const outline = readJson(jobFile(project, job, 'outline.json'), null);
  // The committed script's locks, or before one the locks a template, mix or quick change carried over.
  const locks = Object.keys(commitBase(project, job, 'script')?.locks || {});
  const check = urlCheck(brief.url, brand.sources?.allowedHosts);
  // Only the brief fields the person filled in: an empty one, or who made the brief when, tells an outline nothing.
  const given = Object.fromEntries(Object.entries(brief).filter(([k, v]) => !BRIEF_META.includes(k)
    && v !== '' && v !== false && !(Array.isArray(v) && !v.length)));
  return {
    brief: given, status: { status: st.status, step: st.step, dirty_from: st.dirty_from ?? null, ...(st.error ? { error: st.error } : {}) },
    brand: { name: brand.name, voice: { lang: brand.voice?.lang } }, voiceNotes: loadVoiceNotes(project),
    ...(check ? { urlCheck: check } : {}),
    ...(source ? { source } : {}),
    ...(outline ? { outline } : {}),
    ...(locks.length ? { locks } : {}),
    ...(notes.length ? { notes, notesRule: NOTES_RULE } : {}),
    quick: quickRules(beats, { brandIcons: Object.keys(loadBrandIcons(project)) }),
  };
}

/**
 * Brief, status, brand, voice notes, URL check, assets, template rules, layout rule, pinned notes, reference rhythm,
 * transcripts, icons, bullet screenshots and draft scenes. A quick brief gets the quick context instead, unless a
 * person left draft scenes: filling those needs the template rules.
 */
export function directorContext(project, job) {
  const brief = loadBrief(project, job);
  const { beats } = loadBriefTemplate(brief);
  const script = readJson(jobFile(project, job, 'script.json'), null);
  const drafts = draftScenes(script).map((s) => ({
    id: s.id, kind: s.kind, position: script.scenes.indexOf(s) + 1, source: s.source ?? null, note: s.draft.note, by: s.draft.by,
  }));
  const brand = loadBrand(project);
  const notes = notesForDirector(project, job);
  if (brief.quick === true && beats.quick && !brief.mix?.length && !drafts.length) return quickContext(project, job, { brief, beats, brand, notes });
  const screenshots = bulletScreenshots(readJson(jobFile(project, job, 'source.json'), null));
  const carried = script ? null : commitBase(project, job, 'script');
  const assets = listAssets(project);
  const rhythms = assetRhythms(project, assets);
  return {
    brief, status: getStatus(project, job), brand, voiceNotes: loadVoiceNotes(project),
    urlCheck: urlCheck(brief.url, brand.sources?.allowedHosts),
    assets, template: beats,
    ...(marksIn(beats) ? { marksRule: MARKS_RULE } : {}),
    layoutRule: LAYOUT_RULE,
    directionRule: DIRECTION_RULE,
    ...(notes.length ? { notes, notesRule: NOTES_RULE } : {}),
    ...(rhythms.length ? { referenceRhythm: rhythms, rhythmRule: RHYTHM_RULE } : {}),
    ...transcriptsOf(project),
    icons: { builtIn: ICON_NAMES, brand: Object.keys(loadBrandIcons(project)) },
    ...(screenshots.length ? {
      screenshots,
      screenshotRule: 'A scene whose source is one of these bullets shows that image: put it in shots[0].asset (shot/screen) or asset. Never change a bullet asset a person locked (locks["bullets.asset"]).',
    } : {}),
    ...(drafts.length ? {
      drafts,
      draftRule: 'A person left these scenes for you in script.json. Fill only them: keep id, kind, position and source, follow the note and the template rules, take every claim from that source, then delete the "draft" key. Copy every other scene unchanged.',
    } : {}),
    ...(carried ? {
      carriedLocks: carried.scenes,
      carriedLocksRule: 'A person locked these fields before the template or mix changed, and they still fit the new rules. Write a scene with the same id and kind to keep them; the person\'s values win over yours on commit. Any other scene id drops them.',
    } : {}),
  };
}
