import { page, geometry, h, hasLogoBug, contentArea } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { motionProfile } from '../../engine/brand.mjs';

export function build(args) {
  return page({ ...args, title: 'code-story', ...parts(args) });
}

/* ---------- build-time helpers: everything visible is decided here, the page only animates it ---------- */

const KEYWORDS = new Set(('abstract as async await break case catch class const continue def default defer delete do elif else enum export extends '
  + 'false final finally fn for from func function go if impl implements import in interface is lambda let match mod module mut new nil None '
  + 'not null of or package pass private protected pub public raise return self static struct super switch this throw throws trait true True '
  + 'False try type typeof use using var void while with yield').split(' '));
const TOKEN_RE = /(\/\/.*$|#(?![\w-]*\()(?!\{).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)/g;

/** One source line → escaped HTML with token classes (comment, string, number, keyword, call). */
export function highlightLine(line) {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    out += h(line.slice(last, m.index));
    const [all, comment, str, num, word] = m;
    const cls = comment ? 'tc' : str ? 'ts' : num ? 'tn' : KEYWORDS.has(word) ? 'tk' : line[m.index + all.length] === '(' ? 'tf' : '';
    out += cls ? `<span class="${cls}">${h(all)}</span>` : h(all);
    last = m.index + all.length;
  }
  return out + h(line.slice(last));
}

export const linesOf = (text) => String(text ?? '').replace(/\r/g, '').replace(/\t/g, '  ').split('\n');

/** Line diff by longest common subsequence: [{ op: ' ' | '-' | '+', text }]. Inputs are capped, so O(n·m) is small. */
export function lineDiff(before, after) {
  const a = linesOf(before), b = linesOf(after);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', text: a[i++] }); else out.push({ op: '+', text: b[j++] });
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] });
  while (j < b.length) out.push({ op: '+', text: b[j++] });
  return out;
}

/** Font size (px at U=1) so the longest line fits the panel: never above `max`, never below 16. */
const fitFont = (lines, panelW, max) => Math.max(16, Math.min(max, Math.floor(panelW / (Math.max(20, ...lines.map((l) => l.length)) * 0.61))));

const itemText = (x) => (typeof x === 'string' ? x : x?.text ?? '');
const itemDone = (x) => (typeof x === 'string' ? true : x?.done !== false);

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, size }) {
  const g = geometry(size);
  const { px, padX, port, land, W, U } = g;
  // Stage layout: the checklist is centred between the corner logo and the subtitles, in larger type.
  const stage = motionProfile(brand).layout === 'stage';
  const A = contentArea(brand, g);
  const panelW = (land ? Math.min(W, (size.height * 16) / 9) - 2 * 150 : W - 2 * 90) / U;
  const scenes = [];
  const blocks = [];
  const head = (sc) => `${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}${sc.title ? `<div class="hd ctt" data-lint>${h(sc.title)}</div>` : ''}`;
  const sub = (sc) => (sc.text ? `<div class="csub" data-lint>${h(sc.text)}</div>` : '');
  const panel = (id, label, inner, fs) => `<div class="win" id="${id}-win" style="--fs:${px(fs)}"><div class="bar"><i></i><i></i><i></i>${label ? `<span>${h(label)}</span>` : ''}</div><div class="code">${inner}</div></div>`;
  for (const sc of script.scenes) {
    const id = sc.id;
    if (sc.kind === 'title') {
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="ttl">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="hd tt" data-lint><span class="caret">&gt;_</span> ${h(sc.title)}</div>${sc.subtitle ? `<div class="tsub" data-lint>${h(sc.subtitle)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'title', dark: true });
    } else if (sc.kind === 'code') {
      const lines = linesOf(sc.code).slice(0, 18);
      const hi = new Set((Array.isArray(sc.highlight) ? sc.highlight : []).map(Number));
      const fs = fitFont(lines, panelW - 120, port ? 30 : 34);
      const inner = lines.map((l, k) => `<div class="ln${hi.has(k + 1) ? ' hl' : ''}" id="${id}-l${k}"><b>${k + 1}</b><code>${highlightLine(l) || ' '}</code></div>`).join('');
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}${panel(id, sc.lang || '', inner, fs)}${sub(sc)}</div></div>`);
      scenes.push({ id, kind: 'code', n: lines.length, hi: [...hi].filter((x) => x >= 1 && x <= lines.length).map((x) => x - 1) });
    } else if (sc.kind === 'diff') {
      const ops = lineDiff(sc.before, sc.after).slice(0, 30);
      const fs = fitFont(ops.map((o) => `  ${o.text}`), panelW - 80, port ? 28 : 32);
      const cls = { ' ': 'ctx', '-': 'del', '+': 'add' };
      const inner = ops.map((o, k) => `<div class="ln ${cls[o.op]}" id="${id}-l${k}"><b>${o.op === ' ' ? '' : o.op === '-' ? '−' : '+'}</b><code>${highlightLine(o.text) || ' '}</code></div>`).join('');
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}${panel(id, sc.file || '', inner, fs)}${sub(sc)}</div></div>`);
      scenes.push({ id, kind: 'diff', ops: ops.map((o) => o.op) });
    } else if (sc.kind === 'tree') {
      const files = (sc.files || []).slice(0, 12);
      const most = Math.max(1, ...files.map((f) => (Number(f.added) || 0) + (Number(f.removed) || 0)));
      const rows = files.map((f, k) => {
        const p = String(f.path || ''), cut = p.lastIndexOf('/') + 1, add = Number(f.added) || 0, del = Number(f.removed) || 0;
        return `<div class="frow" id="${id}-f${k}"><span class="fp" data-lint><i>${h(p.slice(0, cut))}</i>${h(p.slice(cut))}</span>
          <span class="fn">${add ? `<em class="pa">+${add}</em>` : ''} ${del ? `<em class="pd">−${del}</em>` : ''}</span>
          <span class="fb"><i class="ba" id="${id}-a${k}" data-w="${((add / most) * 100).toFixed(2)}"></i><i class="bd" id="${id}-d${k}" data-w="${((del / most) * 100).toFixed(2)}"></i></span></div>`;
      }).join('');
      const totA = files.reduce((s, f) => s + (Number(f.added) || 0), 0), totD = files.reduce((s, f) => s + (Number(f.removed) || 0), 0);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}<div class="tree">${rows}
        <div class="ftot" id="${id}-tot">${files.length} file${files.length === 1 ? '' : 's'} · <em class="pa">+${totA}</em> <em class="pd">−${totD}</em></div></div>${sub(sc)}</div></div>`);
      scenes.push({ id, kind: 'tree', n: files.length });
    } else if (sc.kind === 'terminal') {
      const lines = (sc.lines || []).slice(0, 14).map((l) => (typeof l === 'string' ? { out: l } : l));
      const fs = fitFont(lines.map((l) => `$ ${l.cmd ?? l.out ?? ''}`), panelW - 60, port ? 28 : 32);
      const tone = (t) => (/^(✓|✔|PASS|ok\b|Done|Success)/i.test(t) ? ' good' : /^(✗|✖|FAIL|Error|ERR!?)/i.test(t) ? ' bad' : '');
      const inner = lines.map((l, k) => (l.cmd !== undefined
        ? `<div class="ln cmd" id="${id}-l${k}"><b>$</b><code id="${id}-c${k}" data-text="${h(l.cmd)}"></code></div>`
        : `<div class="ln out${tone(String(l.out ?? ''))}" id="${id}-l${k}"><b></b><code>${h(l.out ?? '')}</code></div>`)).join('');
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="box">${head(sc)}${panel(id, 'terminal', inner, fs)}</div></div>`);
      scenes.push({ id, kind: 'terminal', dark: true, kinds: lines.map((l) => (l.cmd !== undefined ? 'c' : 'o')), len: lines.map((l) => String(l.cmd ?? '').length) });
    } else if (sc.kind === 'checklist') {
      const items = (sc.items || []).slice(0, 8);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}<div class="check">${items.map((x, k) => `<div class="ci" id="${id}-i${k}">
        <span class="cb"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="${id}-t${k}" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="ct" id="${id}-x${k}" data-text="${h(itemText(x))}" data-lint></span></div>`).join('')}</div>${sub(sc)}</div></div>`);
      scenes.push({ id, kind: 'checklist', n: items.length, done: items.map(itemDone), len: items.map((x) => itemText(x).length) });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="ttl">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  const css = `
.ttl{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(110)} ${padX(130)};gap:${px(26)}}
.tt{font-size:${px(port ? 110 : 100)}}.tsub{font-size:${px(44)};opacity:.75}.caret{color:var(--secondary);font-family:ui-monospace,Consolas,monospace}
.box{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(port ? 120 : 80)} ${padX(land ? 150 : 90)};gap:${px(28)}}
.ctt{font-size:${px(port ? 80 : 68)}}.csub{font-size:${px(38)};color:var(--muted);line-height:1.3}
.win{background:#0d1117;border-radius:${px(18)};box-shadow:0 ${px(24)} ${px(60)} rgba(2,6,23,.35);overflow:hidden;font-size:var(--fs)}
.bar{display:flex;align-items:center;gap:${px(10)};padding:${px(16)} ${px(22)};background:#161b22}.bar i{width:${px(16)};height:${px(16)};border-radius:50%;background:#30363d}
.bar i:nth-child(1){background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
.bar span{margin-left:${px(14)};font:500 ${px(26)} ui-monospace,Consolas,monospace;color:#8b949e}
.code{padding:${px(18)} 0;font-family:ui-monospace,Consolas,'Courier New',monospace;line-height:1.5;color:#e6edf3}
.ln{display:flex;align-items:baseline;white-space:pre;padding:0 ${px(24)} 0 0;overflow:hidden}
.ln b{flex:none;width:3.2em;text-align:right;padding-right:1em;color:#6e7681;font-weight:400}.ln code{font:inherit;white-space:pre}
.ln.hl{background:rgba(56,139,253,.18);box-shadow:inset ${px(5)} 0 0 var(--secondary)}
.ln.del{background:rgba(248,81,73,.16)}.ln.del b{color:#f85149}.ln.add{background:rgba(63,185,80,.18)}.ln.add b{color:#3fb950}
.ln.cmd b{color:var(--secondary)}.ln.out{color:#c9d1d9}.ln.good{color:#3fb950}.ln.bad{color:#f85149}
.tk{color:#ff7b72}.ts{color:#a5d6ff}.tn{color:#79c0ff}.tc{color:#8b949e;font-style:italic}.tf{color:#d2a8ff}
.tree{display:flex;flex-direction:column;gap:${px(14)};max-width:${px(1400)}}
.frow{display:grid;grid-template-columns:1fr ${px(170)} ${px(port ? 220 : 340)};align-items:center;gap:${px(18)};font:500 ${px(port ? 30 : 34)} ui-monospace,Consolas,monospace}
.fp{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fp i{font-style:normal;color:var(--muted)}
.fn{text-align:right;font-size:.85em}.pa{color:#16a34a;font-style:normal;font-weight:700}.pd{color:#dc2626;font-style:normal;font-weight:700}
.fb{display:flex;height:${px(18)};border-radius:${px(9)};overflow:hidden;background:rgba(15,23,42,.08)}.fb i{display:block;height:100%;width:0}.ba{background:#16a34a}.bd{background:#dc2626}
.ftot{margin-top:${px(10)};font:600 ${px(34)} ui-monospace,Consolas,monospace;color:var(--muted)}
.check{display:flex;flex-direction:column;gap:${px(24)}}
.ci{display:flex;align-items:center;gap:${px(24)};font-size:${px(port ? 46 : 44)};font-weight:600}
.cb{flex:none;width:${px(52)};height:${px(52)};border:${px(4)} solid var(--muted);border-radius:${px(10)};display:grid;place-items:center}
.cb svg{width:80%;height:80%;overflow:visible}.cb path{fill:none;stroke:var(--primary2);stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round}
.ctat{font-size:${px(port ? 116 : 100)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}${stage ? `
.box:has(> .check){padding:${px(A.top)} ${padX(land ? 170 : 90)} ${px(A.bottom)};gap:${px(34)}}
.box:has(> .check) .ctt{font-size:${px(land ? 92 : port ? 96 : 76)}}.box:has(> .check) .csub{font-size:${px(land ? 46 : 40)}}
.check{gap:${px(28)}}.ci{font-size:${px(land || port ? 58 : 46)};gap:${px(28)}}.cb{width:${px(64)};height:${px(64)}}
.check:has(> :nth-child(6)){gap:${px(18)}}.check:has(> :nth-child(6)) .ci{font-size:${px(land || port ? 48 : 40)}}.check:has(> :nth-child(6)) .cb{width:${px(54)};height:${px(54)}}` : ''}`;
  const js = `
const lead = (sc, s) => { const g = $('g-' + sc.id); fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.ctt'), s + 0.1, { d: 0.6 }); fadeUp($(sc.id + '-win'), s + 0.25, { y: 30 }); return g; };
const typeFor = (len) => Math.min(1.6, 0.25 + len * 0.045);
const KINDS = {
  title(sc, s) { const g = $('g-' + sc.id); fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.tt'), s + 0.15, { d: 0.7 }); fadeUp(g.querySelector('.tsub'), s + 0.6); },
  code(sc, s) {
    const g = lead(sc, s);
    for (let k = 0; k < sc.n; k++) tl.fromTo($(sc.id + '-l' + k), { opacity: 0, x: -14 * U }, { opacity: 1, x: 0, duration: 0.3, immediateRender: false }, s + 0.45 + k * Math.min(0.12, 1.4 / sc.n));
    sc.hi.forEach((k, i) => tl.fromTo($(sc.id + '-l' + k), { backgroundColor: 'rgba(56,139,253,0)' }, { backgroundColor: 'rgba(56,139,253,.32)', duration: 0.4, yoyo: true, repeat: 1, immediateRender: false }, cue(sc, 0.45) + i * 0.15));
    fadeUp(g.querySelector('.csub'), cue(sc, 0.7));
  },
  diff(sc, s) {
    const g = lead(sc, s);
    // Context and removed lines show first; at the cue the removed lines fade and strike, then the added lines open in place.
    const at = Math.max(s + 1.0, cue(sc, 0.35));
    sc.ops.forEach((op, k) => {
      const ln = $(sc.id + '-l' + k);
      if (op === '+') {
        tl.set(ln, { height: 0, opacity: 0 }, Math.max(0, s - 0.01));
        tl.to(ln, { height: 'auto', opacity: 1, duration: 0.45, ease: XIO }, at + 0.45 + k * 0.05);
      } else {
        tl.fromTo(ln, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, s + 0.45 + k * 0.04);
        if (op === '-') tl.to(ln, { opacity: 0.45, textDecoration: 'line-through', duration: 0.3 }, at + k * 0.03);
      }
    });
    fadeUp(g.querySelector('.csub'), cue(sc, 0.75));
  },
  tree(sc, s) {
    const g = lead(sc, s);
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.45 + k * Math.min(0.16, 1.6 / sc.n);
      fadeUp($(sc.id + '-f' + k), at, { y: 14, d: 0.4 });
      for (const p of ['-a', '-d']) { const b = $(sc.id + p + k); tl.fromTo(b, { width: '0%' }, { width: b.dataset.w + '%', duration: 0.7, immediateRender: false }, at + 0.15); }
    }
    fadeUp($(sc.id + '-tot'), s + 0.6 + sc.n * Math.min(0.16, 1.6 / sc.n));
    fadeUp(g.querySelector('.csub'), cue(sc, 0.75));
  },
  terminal(sc, s) {
    lead(sc, s);
    let at = s + 0.6;
    sc.kinds.forEach((k, i) => {
      const ln = $(sc.id + '-l' + i);
      tl.fromTo(ln, { opacity: 0 }, { opacity: 1, duration: 0.01, immediateRender: false }, at);
      if (k === 'c') { typeText($(sc.id + '-c' + i), at, typeFor(sc.len[i])); at += typeFor(sc.len[i]) + 0.25; } else at += 0.12;
    });
    for (let i = 0; i < sc.kinds.length; i++) tl.set($(sc.id + '-l' + i), { opacity: 0 }, Math.max(0, s - 0.01));
  },
  checklist(sc, s) {
    const g = lead(sc, s);
    const span = Math.max(1.2, cue(sc, 0.85) - (s + 0.5)), step = span / Math.max(1, sc.n);
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.5 + k * step;
      fadeUp($(sc.id + '-i' + k), at, { y: 12, d: 0.35 });
      typeText($(sc.id + '-x' + k), at + 0.1, Math.min(step * 0.6, typeFor(sc.len[k])));
      if (sc.done[k]) draw($(sc.id + '-t' + k), at + 0.1 + Math.min(step * 0.6, typeFor(sc.len[k])), 0.35);
      else tl.set($(sc.id + '-t' + k), { drawSVG: '0%' }, Math.max(0, s - 0.01));
    }
    fadeUp(g.querySelector('.csub'), cue(sc, 0.9));
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js };
}
