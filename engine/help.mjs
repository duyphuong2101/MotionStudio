// Plain-English help for the Script tab: one sentence per scene kind, one hint per field.
// A template's beats.json `help` sets `kinds[kind]` and may override a field hint for all its kinds
// (`fields[field]`) or for one kind (`fields["<kind>.<field>"]`). FIELD_HELP covers fields that mean
// the same in every template.
import { splitKind } from './mix.mjs';

export const FIELD_HELP = {
  vo: 'What the voice says during this scene. One or two short sentences; the scene lasts as long as this line.',
  title: 'The main on-screen line. Keep it short enough to read without sound.',
  subtitle: 'A smaller line under the title.',
  kicker: 'A tiny label above the title, e.g. "Step 1" or "New".',
  text: 'One supporting sentence shown on screen.',
  source: 'Which fact in the Source tab backs what this scene shows. Every claim needs one.',
  pace: 'How long the scene holds: quick cuts through, normal, focus lingers on it.',
  button: 'The button label, e.g. "Book a demo".',
  url: 'A short web address under the button, e.g. example.com.',
  icon: 'An icon that says what the point means: built-in or uploaded in the Brand tab. It morphs from the previous icon.',
  asset: 'An image from the project assets shown in this scene.',
  chip: 'A short tag under the text, e.g. "Up to 12 hours".',
  stat: 'The number to show: a value and a short unit (4 characters at most).',
  decor: 'The background pattern behind the scene.',
  check: 'Adds a tick mark that confirms the point.',
  packLine: 'A short line on the product pack, e.g. size or variant.',
  value: 'The number to show. It must come from the Source tab.',
  unit: 'A short unit after the number, e.g. %, h or ★.',
  format: 'How the number is written: int 1,284 · dec 4.8 · pct 40% · money $31,200.',
  change: 'Up or down change next to the number, in percent (e.g. 3.1 or -2).',
  tone: 'up colours the numbers green (growth), down colours them red; leave empty for the brand colour.',
  quote: "The customer's words, copied from the Source tab.",
  author: 'Who said it, e.g. "Ana R." or "Verified buyer".',
  role: 'Their role or company.',
  rating: 'Star rating from 1 to 5.',
  date: 'The date, e.g. 2026-11-20 or "Nov 20".',
  time: 'Start time, e.g. 10:00 AM ET.',
  place: 'Where: a city, a venue or "Online".',
  people: 'JSON list of speakers: [{ "name": "…", "role": "…" }].',
  items: 'JSON list of the items this scene shows. Copy the shape of a similar scene.',
  nodes: 'JSON list of box labels, drawn in order with arrows, e.g. ["Request", "Review", "Done"].',
  points: 'JSON list of numbers for the line, oldest first.',
  labels: 'JSON axis labels for the first and last point, e.g. ["Mon", "Sun"].',
  parts: 'JSON list of slices: [{ "label": "Web", "value": 62 }].',
  before: 'JSON for the "before" side: { "label", "title", "items": ["…"] }.',
  after: 'JSON for the "after" side: { "label", "title", "items": ["…"] }.',
  layout: 'Which app screen to draw: dashboard, table, detail or form; same keeps the previous screen.',
  zoom: 'Zoom on part of the frame.',
  nav: 'The nav item to highlight, by its label in the app menu.',
  page: 'The page title in the app header.',
  data: 'JSON for the screen. Its shape depends on the layout; duplicate a scene with the same layout and edit it.',
  assistant: 'JSON for the assistant panel: { "turns": [...] } with questions, answers and approvals.',
  shots: 'JSON list of up to 4 screenshots: { "asset", "focus": {x,y,w,h} or null, "cursor": {x,y}, "click": true }.',
  move: 'Camera move on the photo: in, out, left or right.',
  align: 'Where the headline sits: bottom, center or top.',
  tagline: 'A short line under the logo.',
  style: 'How the logo appears: draw (a ring), burst (rays) or slide (color panels).',
  theme: 'Light or dark background.',
  now: 'The new price, a number like 19.99.',
  was: 'The old price, shown struck through.',
  currency: 'Currency sign, e.g. $ or €.',
  badge: 'A small badge, e.g. "30% OFF".',
  code: 'The coupon code, typed into the ticket.',
  days: 'Countdown start: days.',
  hours: 'Countdown start: hours.',
  minutes: 'Countdown start: minutes.',
  seconds: 'Countdown start: seconds.',
  in: 'Where the clip starts, in seconds.',
  out: 'Where the clip ends, in seconds. Empty plays to the end.',
  name: 'Speaker name for the lower third.',
  fit: 'cover fills the frame and may crop; contain shows the whole clip.',
  sfx: "The sound at the cut into this scene: whoosh, hit (e.g. on a big number), riser, click or none. Empty uses the brand's cut sound.",
};

/** Help per scene kind of a (possibly composed) beats: { kinds: { kind: text }, fields: { kind: { field: text } } }. */
export function sceneHelp(beats) {
  const kinds = {}, fields = {};
  for (const [key, spec] of Object.entries(beats.fields || {})) {
    const { tpl, kind } = splitKind(key);
    const h = (tpl ? beats.sources?.[tpl]?.help : beats.help) || {};
    kinds[key] = h.kinds?.[kind] || '';
    fields[key] = Object.fromEntries([...spec.required, ...spec.optional]
      .map((f) => [f, h.fields?.[`${kind}.${f}`] || h.fields?.[f] || FIELD_HELP[f] || '']));
  }
  return { kinds, fields };
}
