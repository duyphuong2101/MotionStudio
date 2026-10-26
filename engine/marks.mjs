// Text marks: a script may mark a word or short phrase in its on-screen text, e.g. "Cut costs by [[circle:40%]]".
// templates/kit.mjs draws the mark (a hand-drawn circle, underline or strike, or a highlighter band) when the
// voice says the marked word. Only templates whose beats.json sets `marks: true` (the kit renderers) take them.
export const MARK_STYLES = ['circle', 'underline', 'strike', 'mark'];
// The on-screen fields a mark may sit in; a kicker, button, url or code never takes one.
export const MARK_FIELDS = ['title', 'subtitle', 'text', 'tagline', 'quote'];
export const MARKS_PER_FIELD = 2;
// A circle goes round a word or a number, not a sentence. It never wraps, so it must fit one line of the largest
// title at 9:16 (140 units on an 860-unit line); an underline or strike wraps and is drawn on each line.
export const MARK_CHARS = { circle: 10, underline: 40, strike: 40, mark: 40 };

const ANY = /\[\[([^[\]]*)\]\]/g;
const ONE = /^(circle|underline|strike|mark):(.+)$/s;

/** The text as it reads on screen: every valid mark replaced by its words. */
export const stripMarks = (s) => String(s ?? '').replace(ANY, (m, inner) => {
  const x = ONE.exec(inner);
  return x ? x[2] : m;
});

export const hasMarkup = (s) => typeof s === 'string' && (s.includes('[[') || s.includes(']]'));

/** Problems with the marks in one field's text, as messages without the scene id. */
export function markErrors(text, field) {
  const errs = [];
  let n = 0;
  for (const [, inner] of String(text).matchAll(ANY)) {
    const x = ONE.exec(inner);
    if (!x) { errs.push(`${field}: "[[${inner}]]" is not a mark; write [[circle:word]], [[underline:…]], [[strike:…]] or [[mark:…]]`); continue; }
    const words = x[2].trim();
    if (!words || words !== x[2]) errs.push(`${field}: a mark must hold words with no space at either end`);
    else if (words.length > MARK_CHARS[x[1]]) errs.push(`${field}: a ${x[1]} mark holds at most ${MARK_CHARS[x[1]]} characters`);
    n += 1;
  }
  if (n > MARKS_PER_FIELD) errs.push(`${field}: at most ${MARKS_PER_FIELD} marks`);
  if (hasMarkup(String(text).replace(ANY, ''))) errs.push(`${field}: unmatched [[ or ]]`);
  return errs;
}

// Mark paths in a unit box (0..1 of the drawn area), scaled to the marked text when the page builds.
export const MARK_PATHS = {
  circle: 'M.55 .07C.8 .04 .99 .24 .97 .52C.95 .83 .7 .96 .45 .93C.19 .9 .02 .74 .03 .47C.04 .22 .25 .09 .51 .1C.61 .1 .69 .13 .76 .19',
  underline: 'M0 .62C.2 .3 .44 .82 .66 .5S.9 .38 1 .5',
  strike: 'M0 .62L1 .38',
};

const MARK_HTML = /\[\[(circle|underline|strike|mark):([^[\]<>]{1,300})\]\]/g;

/**
 * Turns marks in composition HTML (already escaped) into spans the kit animates. Inside a tag (an attribute)
 * a mark becomes its plain words. Returns { html, count }.
 */
export function marksToHtml(html) {
  let count = 0;
  const out = html.split(/(<[^>]*>)/).map((seg, i) => seg.replace(MARK_HTML, (m, style, words) => {
    if (i % 2) return words;
    count += 1;
    return style === 'mark' ? `<span class="mk mk-mark">${words}</span>`
      : `<span class="mk mk-${style}"><span class="mkt">${words}</span><svg class="mks" aria-hidden="true"><path d="${MARK_PATHS[style]}"/></svg></span>`;
  })).join('');
  return { html: out, count };
}
