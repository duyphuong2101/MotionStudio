// The beat pulse (brief `beatPulse`, timing.pulse from prepare, engine/beats.mjs pulseTimes): every scene group
// punches in a little on the beat, and harder with a short white flash on the music's drops. drawPulse(t), which
// seek(t) calls, sets each group's CSS `scale` property from the time alone: it composes with the `transform` the
// renderer, a camera push or a blend writes. A page without timing.pulse gets none of this code.

// Peak size and decay (seconds) of a beat and of a drop, and the drop's flash.
export const PULSE = { beat: 0.012, beatDecay: 0.09, hit: 0.045, hitDecay: 0.16, flash: 0.45, flashDecay: 0.12 };

export const pulseOn = (timing) => Boolean(timing?.pulse && (timing.pulse.beats?.length || timing.pulse.hits?.length));

export const PULSE_CSS = '\n#pulsefx{position:absolute;inset:0;z-index:21;pointer-events:none;background:#fff;mix-blend-mode:screen;opacity:0}';
export const PULSE_HTML = '\n  <div id="pulsefx" aria-hidden="true"></div>';

export const PULSE_JS = `
const PZ = ${JSON.stringify(PULSE)};
function drawPulse(t) {
  let a = 0, f = 0;
  for (const b of D.pulse.beats) { if (b > t) break; const d = t - b; if (d < 6 * PZ.beatDecay) a = Math.max(a, PZ.beat * Math.exp(-d / PZ.beatDecay)); }
  for (const h of D.pulse.hits) {
    if (h > t) break;
    const d = t - h;
    if (d < 6 * PZ.hitDecay) { a = Math.max(a, PZ.hit * Math.exp(-d / PZ.hitDecay)); f = Math.max(f, PZ.flash * Math.exp(-d / PZ.flashDecay)); }
  }
  const s = a > 0.0005 ? (1 + a).toFixed(4) : '';
  for (const sc of D.scenes) { const g = $('g-' + sc.id); if (g) g.style.scale = s; }
  $('pulsefx').style.opacity = f > 0.005 ? f.toFixed(3) : '0';
}`;
