// Notes a person pins to a moment of a job's video ("the cut here is too hard"), kept in out/<project>/<job>/notes.json
// and handed to the Director on its next run with the scene playing at that moment. A note never changes the job's
// status and is never a source for a claim. No model, no network.
import { readJson, writeJson, StudioError, round, nowIso } from './core.mjs';
import { jobFile, getStatus } from './jobs.mjs';

export const NOTES_FILE = 'notes.json';
export const MAX_NOTES = 40;
export const NOTE_CHARS = 300;

/** The job's notes in time order: [{ n, t, scene, text, by, at }]. */
export function loadNotes(project, id) {
  const doc = readJson(jobFile(project, id, NOTES_FILE), null);
  return Array.isArray(doc?.notes) ? doc.notes : [];
}

/** The scene playing at `t` in the job's current timing, or null before a storyboard. */
function sceneAt(project, id, t) {
  const timing = readJson(jobFile(project, id, 'timing.json'), null);
  const sc = timing?.scenes?.find((s) => t >= s.start && t < s.end) || timing?.scenes?.at(-1);
  return sc ? { scene: sc.id, duration: timing.duration } : null;
}

/** Adds one note at `t` seconds. `t` must fall inside the video; the text is one short request. */
export function addNote(project, id, input, by = 'ui') {
  const t = typeof input?.t === 'number' ? input.t : NaN;
  const text = String(input?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new StudioError('Write the note first', 400);
  if (text.length > NOTE_CHARS) throw new StudioError(`A note is at most ${NOTE_CHARS} characters`, 400);
  const at = sceneAt(project, id, Number.isFinite(t) ? t : 0);
  if (!at) throw new StudioError('No storyboard yet: notes are pinned to a moment of the preview', 409);
  if (!Number.isFinite(t) || t < 0 || t > at.duration) throw new StudioError(`t must be between 0 and ${at.duration} seconds`, 400);
  const notes = loadNotes(project, id);
  if (notes.length >= MAX_NOTES) throw new StudioError(`A job holds at most ${MAX_NOTES} notes. Delete the ones the Director has handled.`, 409);
  const note = { n: Math.max(0, ...notes.map((x) => x.n)) + 1, t: round(t, 2), scene: at.scene, text, by, at: nowIso() };
  writeJson(jobFile(project, id, NOTES_FILE), { notes: [...notes, note].sort((a, b) => a.t - b.t || a.n - b.n) });
  return note;
}

/** Deletes note `n`; an unknown number is a 404. */
export function deleteNote(project, id, n) {
  const notes = loadNotes(project, id);
  const keep = notes.filter((x) => x.n !== Number(n));
  if (keep.length === notes.length) throw new StudioError(`No note ${n} on this job`, 404);
  writeJson(jobFile(project, id, NOTES_FILE), { notes: keep });
  return { deleted: Number(n), notes: keep };
}

/** What the Director sees: time, scene and text. A job the Director never ran has no notes worth acting on yet. */
export function notesForDirector(project, id) {
  if (getStatus(project, id).status === 'queued') return [];
  return loadNotes(project, id).map(({ t, scene, text }) => ({ t, scene, text }));
}
