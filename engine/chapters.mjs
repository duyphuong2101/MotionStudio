// YouTube chapters for a rendered job (plan .ai/plans/publish-kit.md): the scenes grouped into chapters of at least
// CHAPTER_MIN seconds, each named from its first scene's on-screen title, the first at 0:00. YouTube shows chapters
// only with at least three of them, each 10 s or longer, so a shorter video gets none and says why. Pure; no model.
import { stripMarks } from './marks.mjs';

export const CHAPTER_MIN = 10;
export const CHAPTERS_MIN_COUNT = 3;
export const CHAPTERS_FILE = 'chapters.txt';
const NAME_MAX = 60;
// The on-screen fields that name a scene best, in order.
const NAME_FIELDS = ['title', 'kicker', 'headline', 'word', 'name', 'tagline', 'subtitle', 'text', 'quote'];

/** A scene's name: its first non-empty on-screen field, marks removed, cut at a word to NAME_MAX characters. */
export function sceneName(sc) {
  for (const f of NAME_FIELDS) {
    const v = typeof sc?.[f] === 'string' ? stripMarks(sc[f]).replace(/\s+/g, ' ').trim() : '';
    if (!v) continue;
    if (v.length <= NAME_MAX) return v;
    const cut = v.slice(0, NAME_MAX + 1).replace(/\s+\S*$/, '');
    return `${(cut || v.slice(0, NAME_MAX)).replace(/[\s,;:.-]+$/, '')}…`;
  }
  return '';
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function stamp(seconds) {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * { chapters: [{ at, name }], reason }: scenes walked in order, a chapter closed once it lasts CHAPTER_MIN seconds,
 * a short last chapter folded into the one before. A chapter takes the name of its first named scene, else "Part n".
 */
export function chaptersOf(timing, script) {
  const scenes = timing?.scenes || [];
  const duration = Number(timing?.duration) || 0;
  const byId = new Map((script?.scenes || []).map((s) => [s.id, s]));
  const groups = [];
  for (const s of scenes) {
    const g = groups.at(-1);
    if (!g || s.start - g.start >= CHAPTER_MIN) groups.push({ start: s.start, ids: [s.id] });
    else g.ids.push(s.id);
  }
  if (groups.length > 1 && duration - groups.at(-1).start < CHAPTER_MIN) groups.at(-2).ids.push(...groups.pop().ids);
  if (groups.length < CHAPTERS_MIN_COUNT) {
    return { chapters: [], reason: `YouTube shows chapters only when there are ${CHAPTERS_MIN_COUNT} or more of at least ${CHAPTER_MIN} s; this ${Math.round(duration)} s video makes ${groups.length}` };
  }
  const chapters = groups.map((g, i) => ({ at: i === 0 ? 0 : g.start, name: g.ids.map((id) => sceneName(byId.get(id))).find(Boolean) || `Part ${i + 1}` }));
  return { chapters, reason: null };
}

/** The lines to paste into a YouTube description: "0:00 Name" per chapter. */
export const chaptersText = (chapters) => chapters.map((c) => `${stamp(c.at)} ${c.name}`).join('\n') + (chapters.length ? '\n' : '');
