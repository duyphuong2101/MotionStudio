// The beat pulse (brief `beatPulse`, timing.pulse from prepare, engine/beats.mjs pulseTimes): every scene group
// swells a little on the beat, and more with a soft white flash on the music's drops. drawPulse(t), which seek(t)
// calls, sets each group's CSS `scale` property from the time alone: it composes with the `transform` the renderer,
// a camera push or a blend writes. A page without timing.pulse gets none of this code.
// Every bump rises and falls on a cosine, peaking on its beat: a one-frame jump read as a twitch. A scene whose main
// picture or clip covers PULSE_PICTURE of the frame takes only the drops: a beat swell on a photo looks like a shake.

// Peak sizes, rise and fall (seconds) of a beat and of a drop, and the drop's flash.
export const PULSE = { beat: 0.005, beatUp: 0.12, beatDown: 0.45, hit: 0.025, hitUp: 0.1, hitDown: 0.8, flash: 0.35, flashUp: 0.05, flashDown: 0.35 };
export const PULSE_PICTURE = 0.3;

export const pulseOn = (timing) => Boolean(timing?.pulse && (timing.pulse.beats?.length || timing.pulse.hits?.length));

export const PULSE_CSS = '\n#pulsefx{position:absolute;inset:0;z-index:21;pointer-events:none;background:#fff;mix-blend-mode:screen;opacity:0}';
export const PULSE_HTML = '\n  <div id="pulsefx" aria-hidden="true"></div>';

/** pulseFind() (build() calls it) and drawPulse(t). */
export const PULSE_JS = `
const PZ = ${JSON.stringify(PULSE)};
const PCALM = new Set();
function pulseFind() {
  for (const sc of D.scenes) {
    const g = $('g-' + sc.id);
    if (!g) continue;
    for (const el of g.querySelectorAll('img, video')) if (el.offsetWidth * el.offsetHeight >= ${PULSE_PICTURE} * D.W * D.H) { PCALM.add(sc.id); break; }
  }
}
// 0 → 1 → 0 on a cosine, at its peak \`up\` seconds in.
function pulseBump(d, up, down) {
  if (d <= 0 || d >= up + down) return 0;
  return d < up ? (1 - Math.cos(Math.PI * d / up)) / 2 : (1 + Math.cos(Math.PI * (d - up) / down)) / 2;
}
function drawPulse(t) {
  let a = 0, h = 0, f = 0;
  for (const b of D.pulse.beats) { if (b - PZ.beatUp >= t) break; a = Math.max(a, PZ.beat * pulseBump(t - b + PZ.beatUp, PZ.beatUp, PZ.beatDown)); }
  for (const x of D.pulse.hits) {
    if (x - PZ.hitUp >= t) break;
    h = Math.max(h, PZ.hit * pulseBump(t - x + PZ.hitUp, PZ.hitUp, PZ.hitDown));
    f = Math.max(f, PZ.flash * pulseBump(t - x + PZ.flashUp, PZ.flashUp, PZ.flashDown));
  }
  const at = (v) => (v > 0.0002 ? (1 + v).toFixed(4) : '');
  for (const sc of D.scenes) { const g = $('g-' + sc.id); if (g) g.style.scale = at(PCALM.has(sc.id) ? h : Math.max(a, h)); }
  $('pulsefx').style.opacity = f > 0.005 ? f.toFixed(3) : '0';
}`;
