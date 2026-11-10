// Keep the subject in frame (plan .ai/plans/publish-kit.md): with the brief's `reframe`, prepare finds one focus point
// per clip with the local matte model (engine/matte.mjs clipFocus) and crops around it instead of the middle. Two
// crops exist: ffmpeg's, for footage cut to the frame (cutClips, fit cover), and the page's, for a clip a page
// cover-fits full frame (`.vbg video[data-clip]`, explainer stage and reel scenes), where each page size gets its own
// object-position. Without the brief flag nothing here runs and every file is as before.
import { clipFocus, matteConfig, matteStatus } from './matte.mjs';

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** ffmpeg's cover crop to width × height, centred on `focus` ({ x, y } 0-1 of the source) or on the middle. */
export function coverCrop(width, height, focus = null) {
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase`;
  if (!focus) return `${scale},crop=${width}:${height}`;
  // Commas inside an expression are escaped: they would end the filter.
  const x = `max(0\\,min(iw-ow\\,iw*${focus.x}-ow/2))`, y = `max(0\\,min(ih-oh\\,ih*${focus.y}-oh/2))`;
  return `${scale},crop=${width}:${height}:${x}:${y}`;
}

/**
 * The CSS object-position that puts `focus` of a src-sized picture as near the middle of a cover-fitted box as the
 * picture allows. An axis with nothing to crop stays 50%. Pure, for tests.
 */
export function objectPosition(src, box, focus) {
  const s = Math.max(box.width / src.width, box.height / src.height);
  const axis = (len, boxLen, f) => {
    const over = len * s - boxLen;
    return over < 0.5 ? 0.5 : clamp01((f * len * s - boxLen / 2) / over);
  };
  return { x: axis(src.width, box.width, focus.x), y: axis(src.height, box.height, focus.y) };
}

/** The page rules for one page size: one object-position per clip with a focus and a known size. Empty when none. */
export function reframeCss(clips, box) {
  // Scene ids are a-z, 0-9 and dashes (SCENE_ID_RE); anything else never reaches the selector.
  return clips.filter((c) => c.focus && c.width && c.height && /^[a-z0-9][a-z0-9-]*$/.test(c.id)).map((c) => {
    const p = objectPosition({ width: c.width, height: c.height }, box, c.focus);
    return `.vbg video[data-clip="${c.id}"]{object-position:${pct(p.x)} ${pct(p.y)}}`;
  }).join('\n');
}

/** `html` with `css` in its own style element at the end of the head; unchanged when there is no css. */
export function withReframeCss(html, css) {
  if (!css) return html;
  const at = html.indexOf('</head>');
  return at < 0 ? html : `${html.slice(0, at)}<style id="reframe">\n${css}\n</style>\n${html.slice(at)}`;
}

/**
 * Sets `focus` on each clip that can be cropped (at most matte.maxPerJob) and returns the notes for the review: why
 * nothing was reframed, or which clip showed no subject. Footage shown whole (`fit: contain`) is never cropped; a
 * motion scene's clip may be, by its page. `segment` is for tests.
 */
export async function focusClips(clips, { cfg, footage = false, segment = null } = {}) {
  const opts = matteConfig(cfg);
  const pictures = clips.filter((c) => c.hasVideo && !(footage && c.fit === 'contain'));
  if (!pictures.length) return [];
  const st = segment ? { available: true } : matteStatus(opts);
  if (!st.available) return [`Keep the subject in frame is on, but ${st.reason}; clips are cropped in the middle`];
  const notes = [];
  for (const [k, c] of pictures.entries()) {
    if (k >= opts.maxPerJob) { notes.push(`${c.id}: cropped in the middle, a job reframes at most ${opts.maxPerJob} clips`); continue; }
    c.focus = await clipFocus(c.file, c.from, c.seconds, { opts, segment });
    if (!c.focus) notes.push(`${c.id}: no subject found, cropped in the middle`);
  }
  return notes;
}
