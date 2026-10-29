// Remotion import (`node engine/cli.mjs import-remotion`, a person's tool, never the Director's): reads a Remotion
// project's source files as plain text and writes a queued brief from what it can read statically. Nothing in the
// folder is run, imported, installed or fetched (Remotion needs a paid company licence for teams over three).
// Every fact line names the file it came from, so the Director's "never invent a claim" rule holds.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, StudioError, assertId, assertFileName, within, exists, readJson } from './core.mjs';
import { validateBrief, saveBrief, loadTemplate, profileDir, briefFile } from './jobs.mjs';
import { saveAsset, cleanAssetName, maxBytesFor } from './assets.mjs';

export const REMOTION_CAPS = { files: 400, bytes: 4 * 1024 * 1024, fileBytes: 512 * 1024, depth: 12, texts: 40, textChars: 160, scenes: 30, assets: 20 };
// validateBrief's caps on the text fields this import fills.
const BRIEF_CAPS = { message: 400, subject: 64, facts: 2000, notes: 1000 };
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build']);
const SOURCE_RE = /\.(tsx|ts|jsx|js|json)$/i;
const JSX_RE = /\.(tsx|jsx|js)$/i;
const SKIP_JSON = /^(package(-lock)?|tsconfig.*|.*\.config)\.json$/i;
const TEXT_KEYS = ['title', 'subtitle', 'text', 'label', 'heading', 'headline', 'caption', 'tagline', 'quote', 'description', 'cta'];
const MEDIA_TAGS = ['Img', 'Video', 'Audio', 'OffthreadVideo'];
const SEQUENCE_TAGS = ['Sequence', 'Series.Sequence', 'TransitionSeries.Sequence'];
const SERIES_TAGS = ['Series', 'TransitionSeries'];
const DEFAULT_FPS = 30;
const DEFAULT_SECONDS = 30;
const DEFAULT_TEMPLATE = 'explainer';

// A JS string literal whose quote is capture group n and whose body is group n + 1 (one line, escapes allowed).
const quoted = (n) => `(['"\`])((?:\\\\.|(?!\\${n})[^\\\\\\n])*)\\${n}`;
const LITERAL_RE = new RegExp(`^${quoted(1)}$`);
const STATIC_RE = new RegExp(`\\bstaticFile\\(\\s*${quoted(1)}\\s*\\)`, 'g');
const KEY_STR_RE = new RegExp(`\\b(?:${TEXT_KEYS.join('|')})\\s*[:=]\\s*\\{?\\s*${quoted(1)}`, 'g');
const CHILD_STR_RE = new RegExp(`>\\s*\\{\\s*${quoted(1)}\\s*\\}\\s*<`, 'g');
const PROP_RE = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${quoted(2)}|(-?\\d+(?:\\.\\d+)?)\\b)`, 'g');
const JSX_TEXT_RE = />([^<>{}]+)(?=[<{])/g;
const CODE_LIKE = /[;=[\]]|=>|&&|\|\|/;
// `if (count > limit) {` reads like text between > and {: an unbalanced parenthesis gives it away.
const codeLike = (s) => CODE_LIKE.test(s) || (s.match(/\(/g) || []).length !== (s.match(/\)/g) || []).length;
const COMMENT_RE = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;
const CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^;\n]+)/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const isDynamic = (q, body) => q === '`' && body.includes('${');
const unescapeJs = (s) => s.replace(/\\[nrt]/g, ' ').replace(/\\(.)/g, '$1');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The Remotion project folder a person named, as its real path; refused when missing or not a folder. */
export function remotionRoot(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw new StudioError('Name the Remotion project folder: import-remotion <project> <dir>', 400);
  const abs = path.resolve(dir.trim());
  let real;
  try { real = fs.realpathSync(abs); } catch { throw new StudioError(`No folder at ${abs}`, 404); }
  if (!fs.statSync(real).isDirectory()) throw new StudioError(`${abs} is not a folder: name the Remotion project folder`, 400);
  return real;
}

/**
 * The source files under `root` as { rel, text }, in name order. Links are never followed; node_modules, out, dist,
 * build and hidden folders are skipped; file count, total bytes, file size and depth are capped.
 */
export function readSources(root, caps = REMOTION_CAPS) {
  const files = [], skipped = [];
  let bytes = 0, capped = false;
  const visit = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort(byName); } catch (err) { skipped.push(`${rel || '.'}: not readable (${err.code || err.message})`); return; }
    for (const e of entries) {
      if (capped) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { skipped.push(`${r}: a link, not followed`); continue; }
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (depth >= caps.depth) { skipped.push(`${r}: deeper than ${caps.depth} folders`); continue; }
        visit(within(dir, e.name), r, depth + 1);
        continue;
      }
      if (!e.isFile() || !SOURCE_RE.test(e.name) || /\.d\.ts$/i.test(e.name)) continue;
      const file = within(dir, e.name);
      const size = fs.lstatSync(file).size;
      if (size > caps.fileBytes) { skipped.push(`${r}: larger than ${caps.fileBytes} bytes`); continue; }
      if (files.length >= caps.files || bytes + size > caps.bytes) { capped = true; return; }
      bytes += size;
      files.push({ rel: r, text: fs.readFileSync(file, 'utf8') });
    }
  };
  visit(root, '', 0);
  return { files, bytes, capped, skipped };
}

/** Index of the `}` closing the `{` at `open`, skipping strings; -1 when it never closes. */
function closeBrace(src, open) {
  let depth = 0, quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The attribute text of a JSX tag whose name ends at `at`, and where the tag ends; `>` inside braces or strings is skipped. */
function scanTag(src, at) {
  let depth = 0, quote = null;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return { raw: src.slice(at, i), end: i + 1, selfClosing: src[i - 1] === '/' };
  }
  return null;
}

/** name → { str } for a quoted attribute or { expr } for the expression inside `{…}`. */
function attrsOf(text) {
  const out = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?=["'{])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const i = re.lastIndex, c = text[i];
    const j = c === '{' ? closeBrace(text, i) : text.indexOf(c, i + 1);
    if (j < 0) break;
    out[m[1]] = c === '{' ? { expr: text.slice(i + 1, j).trim() } : { str: text.slice(i + 1, j) };
    re.lastIndex = j + 1;
  }
  return out;
}

const tagRe = (name, flags = 'g') => new RegExp(`<${name.replace('.', '\\.')}(?=[\\s/>])`, flags);

/** Every opening `<name …>` tag in `src`: { at, end, selfClosing, raw, attrs }. */
function* tags(src, name) {
  const re = tagRe(name);
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const t = scanTag(src, re.lastIndex);
    if (!t) return;
    yield { at: m.index, ...t, attrs: attrsOf(t.raw) };
    re.lastIndex = t.end;
  }
}

/** Where the `</name>` closing the tag that ends at `from` starts (nested tags of the same name counted). */
function blockEnd(src, name, from) {
  const esc = name.replace('.', '\\.');
  const re = new RegExp(`<${esc}(?=[\\s/>])|</${esc}\\s*>`, 'g');
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0][1] === '/') { if (--depth === 0) return m.index; continue; }
    const t = scanTag(src, re.lastIndex);
    if (!t) break;
    if (!t.selfClosing) depth++;
    re.lastIndex = t.end;
  }
  return src.length;
}

/** A number from `30`, `9 * FPS`, `90 + 60` or `fps / 2` with known constants; null for anything else. */
export function evalNumber(expr, consts = {}) {
  const sub = String(expr ?? '').replace(/[A-Za-z_$][\w$]*/g, (id) => (Number.isFinite(consts[id]) ? String(consts[id]) : '?'));
  if (!/^[\d\s.+*/]+$/.test(sub)) return null;
  let total = 0;
  for (const term of sub.split('+')) {
    const parts = term.split(/([*/])/);
    const first = parts[0].trim();
    if (!first) return null;
    let v = Number(first);
    for (let k = 1; k < parts.length; k += 2) {
      const n = parts[k + 1].trim();
      if (!n) return null;
      v = parts[k] === '*' ? v * Number(n) : v / Number(n);
    }
    total += v;
  }
  return Number.isFinite(total) ? total : null;
}

const strValue = (v) => {
  if (!v) return null;
  if ('str' in v) return v.str;
  const m = LITERAL_RE.exec(v.expr);
  return m && !isDynamic(m[1], m[2]) ? unescapeJs(m[2]) : null;
};
const numValue = (v, consts) => (v ? evalNumber('str' in v ? v.str : v.expr, consts) : null);

/** Number constants declared in any file (`const FPS = 30`, `const LEN = 9 * FPS`), first declaration wins. */
function constantsOf(files) {
  const consts = {};
  // Two passes, so a constant may use one declared later in name order.
  for (let pass = 0; pass < 2; pass++) {
    for (const { rel, text } of files) {
      if (/\.json$/i.test(rel)) continue;
      for (const m of text.matchAll(CONST_RE)) {
        if (m[1] in consts) continue;
        const v = evalNumber(m[2].trim(), consts);
        if (v !== null) consts[m[1]] = v;
      }
    }
  }
  return consts;
}

/** String and number values of an object literal such as `defaultProps={{ title: 'Hi', speed: 2 }}`. */
function objectLiteral(v) {
  const props = {};
  if (!v?.expr) return props;
  for (const m of v.expr.matchAll(PROP_RE)) {
    if (m[3] !== undefined) { if (!isDynamic(m[2], m[3])) props[m[1]] = unescapeJs(m[3]); } else props[m[1]] = Number(m[4]);
  }
  return props;
}

/** Raw on-screen text candidates of a piece of code, in the order they appear. */
function textsOf(code, jsx) {
  const found = [];
  if (jsx) {
    for (const m of code.matchAll(JSX_TEXT_RE)) if (!codeLike(m[1])) found.push([m.index, m[1]]);
    for (const m of code.matchAll(CHILD_STR_RE)) if (!isDynamic(m[1], m[2])) found.push([m.index, unescapeJs(m[2])]);
  }
  for (const m of code.matchAll(KEY_STR_RE)) if (!isDynamic(m[1], m[2])) found.push([m.index, unescapeJs(m[2])]);
  return found.sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

/** Strings under the text keys (title, label, …) of a JSON value. */
function jsonTexts(value, out, depth = 0) {
  if (depth > 8) return out;
  if (Array.isArray(value)) for (const v of value) jsonTexts(v, out, depth + 1);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') { if (TEXT_KEYS.includes(k)) out.push(v); } else jsonTexts(v, out, depth + 1);
    }
  }
  return out;
}

/** One line of visible text, or null for code, a path, a URL, a colour or a file name. */
export function cleanText(raw, max = REMOTION_CAPS.textChars) {
  const entity = (all, e) => (e[0] !== '#' ? ENTITIES[e.toLowerCase()] ?? all : Number(e.slice(1)) <= 0x10ffff ? String.fromCodePoint(Number(e.slice(1))) : all);
  const t = String(raw).replace(/&(#\d{1,7}|[a-z]+);/gi, entity)
    .replace(/\s+/g, ' ').trim();
  if (t.length < 2 || !/\p{L}{2}/u.test(t)) return null;
  if (/^\S*[/\\:#@]\S*$/.test(t) || /^[\w-]+\.[a-z0-9]{2,4}$/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Compositions, sequences, texts and media references of one source file. */
function extractFile({ rel, text }, consts) {
  if (/\.json$/i.test(rel)) {
    if (SKIP_JSON.test(path.posix.basename(rel))) return { texts: [] };
    try { return { texts: jsonTexts(JSON.parse(text), []) }; } catch { return { texts: [] }; }
  }
  const code = text.replace(COMMENT_RE, ' ');
  const jsx = JSX_RE.test(rel);
  const num = (v) => numValue(v, consts);
  const compositions = [...tags(code, 'Composition')].map(({ attrs: a }) => ({
    file: rel, id: strValue(a.id), width: num(a.width), height: num(a.height), fps: num(a.fps), frames: num(a.durationInFrames), props: objectLiteral(a.defaultProps),
  }));
  const sequences = [];
  for (const tag of SEQUENCE_TAGS) {
    for (const t of tags(code, tag)) {
      const body = t.selfClosing ? '' : code.slice(t.end, blockEnd(code, tag, t.end));
      // A <Sequence> without `from` starts at 0; a series sequence gets its start from its place below.
      const from = t.attrs.from ? num(t.attrs.from) : 0;
      sequences.push({ at: t.at, tag, name: strValue(t.attrs.name), frames: num(t.attrs.durationInFrames), from, offset: num(t.attrs.offset) || 0, texts: textsOf(body, jsx) });
    }
  }
  // A Series (or TransitionSeries) plays its sequences one after another; a transition overlaps its two neighbours.
  const series = SERIES_TAGS.flatMap((tag) => [...tags(code, tag)].map((t) => t.at));
  const transitions = [...tags(code, 'TransitionSeries.Transition')].map((t) => ({ at: t.at, transition: evalNumber(/durationInFrames\s*:\s*([^,})]+)/.exec(t.raw)?.[1]?.trim(), consts) ?? 0 }));
  const runs = new Map();
  for (const e of [...sequences, ...transitions].sort((a, b) => a.at - b.at)) {
    const group = series.filter((at) => at < e.at).length;
    const run = runs.get(group) ?? 0;
    if ('transition' in e) { runs.set(group, run - e.transition); continue; }
    if (e.tag === 'Sequence') continue;
    const start = run + e.offset;
    e.from = Number.isFinite(start) ? start : null;
    runs.set(group, Number.isFinite(e.frames) ? start + e.frames : NaN);
  }
  const refs = [...code.matchAll(STATIC_RE)].filter((m) => !isDynamic(m[1], m[2])).map((m) => m[2]);
  for (const tag of MEDIA_TAGS) for (const t of tags(code, tag)) { const s = strValue(t.attrs.src); if (s) refs.push(s); }
  const propTexts = compositions.flatMap((c) => Object.values(c.props).filter((v) => typeof v === 'string'));
  return { compositions, sequences: sequences.sort((a, b) => a.at - b.at), refs, texts: [...propTexts, ...textsOf(code, jsx)] };
}

const seconds = (frames, fps) => (Number.isFinite(frames) ? Math.round((frames / fps) * 100) / 100 : null);

/** Everything the import can read from a Remotion project folder without running it. */
export function readRemotion(dir, caps = REMOTION_CAPS) {
  const root = remotionRoot(dir);
  const read = readSources(root, caps);
  const consts = constantsOf(read.files);
  const per = read.files.map((f) => ({ rel: f.rel, ...extractFile(f, consts) }));
  const compositions = per.flatMap((p) => p.compositions || []).map((c) => ({ ...c, seconds: seconds(c.frames, c.fps || DEFAULT_FPS) }));
  const fpsOf = (rel) => compositions.find((c) => c.file === rel && c.fps)?.fps || compositions[0]?.fps || DEFAULT_FPS;
  const scenes = per.flatMap((p) => (p.sequences || []).map((s) => ({
    file: p.rel, tag: s.tag, name: s.name, from: seconds(s.from, fpsOf(p.rel)), seconds: seconds(s.frames, fpsOf(p.rel)),
    texts: [...new Set(s.texts.map((x) => cleanText(x, caps.textChars)).filter(Boolean))],
  })));
  const seen = new Set(), texts = [];
  let textsCapped = false;
  for (const p of per) {
    for (const raw of p.texts) {
      const t = cleanText(raw, caps.textChars);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      if (texts.length < caps.texts) texts.push({ file: p.rel, text: t }); else textsCapped = true;
    }
  }
  const refs = [];
  for (const p of per) for (const ref of p.refs || []) if (!refs.some((r) => r.ref === ref)) refs.push({ file: p.rel, ref });
  return {
    root, files: read.files.length, bytes: read.bytes, capped: read.capped, skipped: read.skipped, compositions,
    scenes: scenes.slice(0, caps.scenes), scenesCapped: scenes.length > caps.scenes, texts, textsCapped, refs,
  };
}

/** The format of `formats` closest in aspect to width × height; 16:9 (or the first) when the size is unknown. */
export function nearestFormat(width, height, formats) {
  if (!(width > 0 && height > 0)) return formats.includes('16:9') ? '16:9' : formats[0];
  const want = Math.log(width / height);
  const off = (f) => { const [a, b] = f.split(':').map(Number); return Math.abs(Math.log(a / b) - want); };
  return formats.reduce((best, f) => (off(f) < off(best) ? f : best));
}

/** A job id from a composition id: `remotion-<slug>`. */
export const jobIdFor = (compId) => {
  const slug = String(compId || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `remotion-${slug || 'import'}`.slice(0, 64).replace(/-+$/, '');
};

const sceneLine = (s, i) => {
  const span = s.seconds === null ? 'length not readable' : s.from === null ? `${s.seconds} s` : `${s.from}-${Math.round((s.from + s.seconds) * 100) / 100} s`;
  return `${i + 1}. ${s.name || s.tag} ${span} (${s.file})${s.texts[0] ? `: "${s.texts[0].slice(0, 40)}"` : ''}`;
};
const sizeText = (c) => `${c.width && c.height ? ` ${c.width}x${c.height}` : ''}${c.fps ? ` at ${c.fps} fps` : ''}${c.seconds !== null ? `, ${c.seconds} s` : ''}`;

/** Notes for the Director: what was read, the composition, the scene rhythm, the assets. Fits BRIEF_CAPS.notes. */
function notesFor(read, comp, { template, duration, range: [lo, hi], assets }) {
  const head = [
    `Imported from the Remotion project ${path.basename(read.root)}: its files were read as text, nothing was run.`,
    comp ? `Composition ${comp.id || '(no id)'}${sizeText(comp)}.` : 'No <Composition> found: the format and length are defaults.',
    comp?.seconds && (comp.seconds < lo || comp.seconds > hi) ? `${template} makes ${lo}-${hi} s, so the brief asks ${duration} s.` : '',
    assets.length ? `Assets saved in the brand: ${assets.join(', ')}.` : '',
    read.compositions.length > 1 ? `Other compositions: ${read.compositions.filter((c) => c !== comp).map((c) => `${c.id || '(no id)'}${sizeText(c)}`).join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  if (!read.scenes.length) return head.slice(0, BRIEF_CAPS.notes);
  let notes = `${head} Scenes found (mirror this rhythm):`;
  for (const [i, s] of read.scenes.entries()) {
    const line = ` ${sceneLine(s, i)};`;
    if (notes.length + line.length > BRIEF_CAPS.notes - 2) { notes += ' …'; break; }
    notes += line;
  }
  return notes.replace(/;$/, '.').slice(0, BRIEF_CAPS.notes);
}

/** Fact lines that name their file, as many as fit BRIEF_CAPS.facts. */
function factsFor(texts) {
  const lines = [];
  let size = 0, dropped = 0;
  for (const { file, text } of texts) {
    const line = `Remotion ${file}: "${text}"`;
    const next = size + (lines.length ? 1 : 0) + line.length;
    if (next > BRIEF_CAPS.facts) { dropped++; continue; }
    lines.push(line);
    size = next;
  }
  return { facts: lines.join('\n'), lines: lines.length, dropped };
}

/**
 * The brief input for what `read` found (validateBrief still checks it): format from the composition size, length from
 * its frames (inside the template's range), facts with their files, notes with the scenes and their seconds.
 */
export function remotionBrief(read, { project, job, template = DEFAULT_TEMPLATE, composition, by = 'cli', assets = [] } = {}) {
  const { beats } = loadTemplate(template);
  let comp = read.compositions[0] || null;
  if (composition) {
    comp = read.compositions.find((c) => c.id === composition) || null;
    if (!comp) throw new StudioError(`No composition ${composition} in this project. Found: ${read.compositions.map((c) => c.id).filter(Boolean).join(', ') || 'none'}`, 404);
  }
  const id = assertId(job || jobIdFor(comp?.id), 'job');
  const [lo, hi] = beats.durations;
  const sceneSum = read.scenes.reduce((a, s) => a + (s.seconds || 0), 0);
  const length = comp?.seconds || sceneSum || DEFAULT_SECONDS;
  const duration = Math.min(hi, Math.max(lo, Math.round(length * 10) / 10));
  const { facts, lines, dropped } = factsFor(read.texts);
  const name = comp?.id ? ` ${comp.id}` : '';
  return {
    brief: {
      project, id, template, format: nearestFormat(comp?.width, comp?.height, beats.formats), duration,
      subject: (comp?.id || '').slice(0, BRIEF_CAPS.subject),
      message: `Remake the Remotion video${name} in this brand: keep its message, its scene order and its rhythm.`.slice(0, BRIEF_CAPS.message),
      facts, notes: notesFor(read, comp, { template, duration, range: beats.durations, assets }), createdBy: by,
    },
    facts: { lines, dropped },
  };
}

/** The file a public/ reference names, refused when it is remote, leaves public/, is a link or sits behind a linked folder. */
export function publicFile(root, ref) {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) throw new StudioError('a remote file, not downloaded', 400);
  const parts = ref.split(/[\\/]+/).filter((p) => p && p !== '.');
  if (!parts.length || parts.includes('..')) throw new StudioError('a path that leaves public/', 400);
  const file = within(root, 'public', ...parts);
  let st;
  try { st = fs.lstatSync(file); } catch { throw new StudioError('not found in public/', 404); }
  if (st.isSymbolicLink() || !st.isFile()) throw new StudioError('a link or a folder, not a file', 400);
  if (!fs.realpathSync(file).startsWith(root + path.sep)) throw new StudioError('outside the project folder (a linked folder)', 400);
  return { file, size: st.size };
}

/** Saves each referenced public/ file into the brand's assets through saveAsset; the rest are reported with why. */
function saveRefs(project, read, caps) {
  const saved = [], skipped = [];
  for (const { file: from, ref } of read.refs.slice(0, caps.assets)) {
    try {
      const { file, size } = publicFile(read.root, ref);
      const name = assertFileName(cleanAssetName(path.basename(file)), 'asset');
      if (size > maxBytesFor(name)) throw new StudioError(`larger than the ${Math.round(maxBytesFor(name) / 1048576)} MB asset cap`, 413);
      const buf = fs.readFileSync(file);
      const have = within(profileDir(project), 'assets', name);
      if (exists(have)) {
        if (!fs.readFileSync(have).equals(buf)) throw new StudioError(`a different ${name} is already in the brand`, 409);
        saved.push({ ref, name, from, existing: true });
        continue;
      }
      saved.push({ ref, from, ...saveAsset(project, name, buf) });
    } catch (err) {
      skipped.push({ ref, from, reason: err.message });
    }
  }
  for (const { ref, file } of read.refs.slice(caps.assets)) skipped.push({ ref, from: file, reason: `over the cap of ${caps.assets} assets` });
  return { saved, skipped };
}

/**
 * import-remotion: reads `dir`, saves the public/ files it references into the brand, and writes a queued brief
 * (validateBrief + saveBrief, as the UI's New brief does; no status.json yet, so the job reads as queued).
 */
export function importRemotion(project, dir, { job, template, composition, by = 'cli', caps = REMOTION_CAPS } = {}) {
  assertId(project, 'project');
  if (!exists(within(profileDir(project), 'brand.json'))) throw new StudioError(`Unknown project: ${project}. Create it in the UI first.`, 404);
  if (template !== undefined) assertId(template, 'template');
  const read = readRemotion(dir, caps);
  const opts = { project, job, template: template || DEFAULT_TEMPLATE, composition, by };
  const providers = readJson(within(DIRS.config, 'providers.json'), null) || undefined;
  // Checked before any asset is saved, so a refused brief leaves the brand as it was.
  const first = remotionBrief(read, opts);
  if (exists(briefFile(project, first.brief.id))) throw new StudioError(`Brief ${project}/${first.brief.id} already exists. Pick another id with --job.`, 409);
  validateBrief(first.brief, { providers });
  const assets = saveRefs(project, read, caps);
  const { brief: input, facts } = remotionBrief(read, { ...opts, assets: assets.saved.map((a) => a.name) });
  const brief = saveBrief(validateBrief(input, { providers }));
  return { brief, read, assets, facts };
}
