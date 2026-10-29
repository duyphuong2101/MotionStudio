import { round } from './core.mjs';
import { wordsOf, MAX_HOLD } from './script.mjs';

/** A scene's `hold`: quiet seconds after its sound ends, before the next scene's gap (0 when absent or blank). */
export const sceneHold = (sc) => round(Math.min(MAX_HOLD, Math.max(0, Number(sc?.hold) || 0)), 3);

/** The pace entry for one scene: an extra template's own table in a mixed script (`byKind`), else the template's. */
export function resolvePace(paceCfg, sc) {
  if (!paceCfg) return null;
  return (paceCfg.byKind?.[sc.kind] || paceCfg)[sc.pace || 'normal'] || null;
}

/**
 * The pause before a scene's voice (`lead`) and after it (`tail`). `tight` (a motion profile with `tight`) takes both from
 * `cfg.tight`, and a pace's own tail may only shorten it; the last scene always keeps `lastSceneHold`.
 */
export function sceneGaps(cfg, pace, last, tight = false) {
  if (!tight) return { lead: cfg.leadIn, tail: last ? cfg.lastSceneHold : (pace?.tail ?? cfg.tailOut) };
  const { leadIn, tailOut } = cfg.tight;
  return { lead: leadIn, tail: last ? cfg.lastSceneHold : Math.min(pace?.tail ?? tailOut, tailOut) };
}

/**
 * Estimated timing when no TTS track exists. Same shape a TTS adapter must write
 * to words.json, so the template does not care where the numbers came from.
 */
export function estimateTiming(script, cfg, lang = 'en', paceCfg = null, fixed = null, snap = null, tight = false) {
  const wps = cfg.wordsPerSecond[lang] ?? cfg.wordsPerSecond[String(lang).split('-')[0]] ?? cfg.wordsPerSecond.default;
  const scenes = [];
  const words = [];
  let t = 0;
  script.scenes.forEach((sc, idx) => {
    const ws = wordsOf(sc.vo);
    const last = idx === script.scenes.length - 1;
    const speak = ws.length / wps;
    // A template with a pace table lets quick scenes cut short and focus scenes hold longer per shot.
    const pace = resolvePace(paceCfg, sc);
    const shots = Array.isArray(sc.shots) && sc.shots.length ? sc.shots.length : 1;
    const minScene = pace ? Math.max(pace.minScene, shots * pace.perShot) : cfg.minScene;
    const { lead, tail } = sceneGaps(cfg, pace, last, tight);
    // With a beat grid, a scene grows to end on the next beat (fixed footage lengths stay as they are).
    const hold = sceneHold(sc);
    const raw = (fixed?.[sc.id] ?? Math.max(minScene, lead + speak + tail)) + hold;
    const dur = snap && fixed?.[sc.id] === undefined ? snap(t + raw) - t : raw;
    ws.forEach((w, i) => {
      const start = t + lead + i / wps;
      words.push({ w, start: round(start), end: round(start + 1 / wps - 0.04), scene: sc.id });
    });
    scenes.push({ id: sc.id, start: round(t), end: round(t + dur), ...(hold ? { hold } : {}) });
    t += dur;
  });
  return { source: 'estimated', lang, wordsPerSecond: wps, duration: round(t), scenes, words };
}

/** Seconds → "HH:MM:SS,mmm" as SRT writes it. */
export function srtTime(s) {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
}

export const CUE_LINE = 42;

/** Splits text into at most two lines of CUE_LINE characters, breaking at the space nearest the middle. */
export function wrapCue(text) {
  if (text.length <= CUE_LINE) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/**
 * Words of one scene grouped into readable cues: at most two lines, a new cue after a sentence ends
 * once the cue has some length. Each cue runs from its first word to just after its last.
 */
export function cuesOf(words, sceneEnd) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  for (const w of words) {
    const text = [...cur, w].map((x) => x.w).join(' ');
    if (cur.length && text.length > CUE_LINE * 2) flush();
    cur.push(w);
    const len = cur.map((x) => x.w).join(' ').length;
    if (/[.!?]["')\]]?$/.test(w.w) && len >= CUE_LINE / 2) flush();
  }
  flush();
  return cues.map((ws, i) => {
    const next = cues[i + 1]?.[0].start ?? sceneEnd;
    return { start: ws[0].start, end: Math.max(ws[0].start + 0.3, Math.min(ws[ws.length - 1].end + 0.3, next - 0.02, sceneEnd)), text: wrapCue(ws.map((x) => x.w).join(' ')) };
  });
}

export function toSrt(timing, script) {
  const cues = script.scenes.flatMap((sc) => {
    const sceneT = timing.scenes.find((s) => s.id === sc.id);
    return sceneT ? cuesOf(timing.words.filter((w) => w.scene === sc.id), sceneT.end) : [];
  });
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}
