import { page, geometry, h, num, hasLogoBug, contentArea, themeClass, ACCENT_CSS } from '../kit.mjs';
import { logoHtml } from '../shared.mjs';
import { motionProfile } from '../../engine/brand.mjs';

const COLORS = ['var(--primary2)', 'var(--secondary)', '#16a34a', '#e11d48', '#7c3aed'];
// Line chart: the end value's font size (line-height 1) and the label size of a band or a reference line (1080 units).
const LVAL = { std: 64, stage: 80 }, MARK = { std: 28, stage: 34 };
// The end value's column: about this many em per tabular character, and this gap (1080 units) either side of it.
const CHAR_EM = 0.64, LV_GAP = 26;
/** A number as the page's fmt() writes it, to size the column that holds it. */
const valueText = (v, f, dec) => (f === 'money' ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  : f === 'pct' ? v.toFixed(dec) + '%' : f === 'dec' ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
const tone = (sc) => (sc.theme === 'dark' ? { dark: true } : {});
// A scene's `tone` colours its counted numbers: up green, down red.
const toneClass = (sc) => (sc.tone === 'up' ? ' tup' : sc.tone === 'down' ? ' tdn' : '');

// Warming-stripes palette: cool below the mean, warm above, near white at the mean.
const COOL = [8, 81, 156], MID = [247, 247, 247], WARM = [165, 15, 21];
const mixRgb = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
const hexRgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
export const stripeColor = (a, cool = COOL, warm = WARM) => (a < 0 ? mixRgb(MID, cool, Math.min(1, -a)) : mixRgb(MID, warm, Math.min(1, a)));

/**
 * Chart colours from the brand's custom colours, by name: chart-1..chart-6 for series (chart-1 also draws
 * the line), chart-cool / chart-warm for the stripes' ends, chart-mark for a highlighter behind key numbers.
 * A brand without them keeps the defaults.
 */
export function chartColors(brand) {
  const p = Object.fromEntries((brand.palette || []).filter((x) => /^#[0-9a-fA-F]{6}$/.test(x?.hex || '')).map((x) => [x.name, x.hex]));
  const series = [1, 2, 3, 4, 5, 6].map((k) => p['chart-' + k]).filter(Boolean);
  return {
    series: series.length ? series : COLORS,
    line: series[0] || 'var(--primary2)',
    fade: series.length > 0,
    cool: p['chart-cool'] ? hexRgb(p['chart-cool']) : COOL,
    warm: p['chart-warm'] ? hexRgb(p['chart-warm']) : WARM,
    mark: p['chart-mark'] || null,
  };
}

/** Per period: each series' rank (0 = longest bar), its share of that period's longest bar, and its value. */
export function raceFrames(periods, series) {
  return periods.map((_, k) => {
    const vals = series.map((x) => num(x.values[k]));
    const order = vals.map((v, j) => j).sort((a, b) => vals[b] - vals[a] || a - b);
    const max = Math.max(1e-9, ...vals);
    const rank = [];
    order.forEach((j, r) => { rank[j] = r; });
    return { rank, frac: vals.map((v) => v / max), vals };
  });
}

export function build(args) {
  return page({ ...args, title: 'data-story', ...parts(args) });
}

/** css, body, scenes and js for page(); a mixed video composes these from several templates. */
export function parts({ brand, script, size }) {
  const g = geometry(size);
  const { px, padX, port, land, short } = g;
  const C = chartColors(brand);
  const stage = motionProfile(brand).layout === 'stage';
  const A = contentArea(brand, g);
  // A portrait chart is narrow: its end value keeps the standard size so the plot keeps its width.
  const LV = stage && !port ? LVAL.stage : LVAL.std, MK = stage ? MARK.stage : MARK.std;
  const chartH = short ? 520 : port ? 700 : 420;
  const donut = short ? 480 : port ? 600 : 460;
  const rowH = short ? 92 : port ? 116 : 88;
  const scenes = [];
  const blocks = [];
  const head = (sc) => `${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd dtt" data-lint>${h(sc.title)}</div>`;
  for (const sc of script.scenes) {
    const id = sc.id;
    const f = sc.format || 'int';
    const dec = f === 'dec' || f === 'pct' ? 1 : f === 'money' ? 0 : 0;
    if (sc.kind === 'title') {
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}${sc.subtitle ? `<div class="dsub" data-lint>${h(sc.subtitle)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'title' });
    } else if (sc.kind === 'stat') {
      const ch = sc.change === undefined || sc.change === '' ? null : num(sc.change);
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="box center">${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}
        <div class="big${toneClass(sc)}"><b id="${id}-v" data-count="${num(sc.value)}" data-format="${h(f)}" data-dec="${dec}">0</b>${sc.unit ? `<small>${h(sc.unit)}</small>` : ''}</div>
        ${ch !== null ? `<div class="chg ${ch >= 0 ? 'up' : 'dn'}" id="${id}-chg">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}%</div>` : ''}
        <div class="dsub" data-lint>${h(sc.text)}</div></div></div>`);
      scenes.push({ id, kind: 'stat', ...tone(sc) });
    } else if (sc.kind === 'bars') {
      const items = (sc.items || []).slice(0, 6);
      const two = Array.isArray(sc.series) && sc.series.length === 2;
      const cols = sc.layout === 'columns';
      const max = Math.max(1, ...items.flatMap((x) => (two ? [num(x.value), num(x.value2)] : [num(x.value)])));
      const val = (bid, v) => {
        const b = `<b id="${bid}"${toneClass(sc) ? ` class="${toneClass(sc).trim()}"` : ''} data-count="${v}" data-format="${h(f)}" data-dec="${dec}">0</b>`;
        // A toned value colours its unit too (the wrapper carries the tone), so "295.0%" reads as one green number.
        return sc.unit ? `<span${toneClass(sc) ? ` class="${toneClass(sc).trim()}"` : ''}>${b}<small style="font-size:.7em;margin-left:.2em">${h(sc.unit)}</small></span>` : b;
      };
      // Two series: one colour per series, each item a pair of bars with its own value, and a legend above.
      // The label sits left of its pair, so three items take the height of three rows, not six.
      const pair = (x, k) => `<div class="bar two"><div class="bl"><span data-lint>${h(x.label)}</span></div><div class="bps">
          ${[[x.value, ''], [x.value2, 'x']].map(([v, sfx], j) => `<div class="bp"><div class="bt"><i id="${id}-b${k}${sfx}" style="background:${C.series[j]}" data-frac="${num(v) / max}"></i></div>${val(`${id}-bv${k}${sfx}`, num(v))}</div>`).join('')}</div></div>`;
      // Columns: each item a group of upright bars growing from a shared baseline, its value above and its label below.
      const col = (x, k) => `<div class="col"><div class="cps">${(two ? [[x.value, ''], [x.value2, 'x']] : [[x.value, '']]).map(([v, sfx], j) => `<div class="cp">${val(`${id}-bv${k}${sfx}`, num(v))}<div class="ct"><i id="${id}-b${k}${sfx}" style="background:${C.series[two ? j : k % C.series.length]}" data-frac="${num(v) / max}"></i></div></div>`).join('')}</div><div class="cl" data-lint>${h(x.label)}</div></div>`;
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="box">${head(sc)}${two ? `<div class="sleg">${sc.series.map((n, j) => `<span data-lint><i style="background:${C.series[j]}"></i>${h(n)}</span>`).join('')}</div>` : ''}<div class="bars${cols ? ' cols' : ''}">
        ${items.map((x, k) => {
          if (cols) return col(x, k);
          if (two) return pair(x, k);
          return `<div class="bar"><div class="bl"><span data-lint>${h(x.label)}</span>${val(`${id}-bv${k}`, num(x.value))}</div>
          <div class="bt"><i id="${id}-b${k}" style="background:${C.series[k % C.series.length]}" data-frac="${num(x.value) / max}"></i></div></div>`;
        }).join('')}</div>
        ${sc.text ? `<div class="dsub" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'bars', n: items.length, ...tone(sc) });
    } else if (sc.kind === 'line') {
      const pts = (sc.points || []).map((v) => num(v)).slice(0, 24);
      const Wc = land ? 1400 : 900, Hc = chartH;
      const ref = sc.ref && Number.isFinite(Number(sc.ref.value)) ? sc.ref : null;
      // A reference value outside the data widens the scale so its line stays on the chart.
      const all = ref ? [...pts, num(ref.value)] : pts;
      const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
      const xOf = (k) => Math.round((k / Math.max(1, pts.length - 1)) * Wc);
      // A band label sits at the top of the chart: the line then keeps clear of it (a peak ran through "Q3").
      const top = sc.band?.label ? 10 + Math.round(MK * 1.3) + 14 : 40;
      const yOf = (v) => Math.round(Hc - 20 - ((v - min) / span) * (Hc - 20 - top));
      const xy = pts.map((v, k) => [xOf(k), yOf(v)]);
      const line = xy.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' ');
      const last = xy[xy.length - 1] || [0, 0];
      // The end value sits right of the last point, centred on it: the plot leaves a column as wide as the value.
      const endText = valueText(pts[pts.length - 1] || 0, f, dec);
      const col = Math.round(endText.length * CHAR_EM * LV + LV_GAP * 2);
      const lvTop = Math.min(Hc - LV, Math.max(0, last[1] - LV / 2));
      const inPlot = (frac) => `calc((100% - ${px(col)}) * ${frac.toFixed(4)})`;
      const band = sc.band && Number.isInteger(sc.band.from) && Number.isInteger(sc.band.to) ? sc.band : null;
      const seg = Wc / Math.max(1, pts.length - 1);
      const bx = band ? [Math.max(0, Math.round(xOf(band.from) - seg / 2)), Math.min(Wc, Math.round(xOf(band.to) + seg / 2))] : null;
      const bmid = bx ? (bx[0] + bx[1]) / 2 / Wc : 0;
      const ry = ref ? yOf(num(ref.value)) : 0;
      blocks.push(`<div class="sc fill${themeClass(sc)}" id="g-${id}"><div class="box">${head(sc)}
        <div class="chart"><svg viewBox="0 0 ${Wc} ${Hc}" preserveAspectRatio="none" aria-hidden="true" style="width:calc(100% - ${px(col)})">${C.fade ? `<defs><linearGradient id="${id}-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.line}"/><stop offset="1" stop-color="${C.line}" stop-opacity="0"/></linearGradient></defs>` : ''}${bx ? `
          <rect class="band" id="${id}-band" x="${bx[0]}" y="0" width="${bx[1] - bx[0]}" height="${Hc}"/>` : ''}
          ${[0.25, 0.5, 0.75].map((q) => `<path class="grid" d="M0 ${Math.round(Hc * q)} H${Wc}"/>`).join('')}${ref ? `
          <path class="ref" id="${id}-ref" d="M0 ${ry} H${Wc}"/>` : ''}
          <path class="area" id="${id}-area"${C.fade ? ` fill="url(#${id}-grad)"` : ''} d="${line} L${Wc} ${Hc} L0 ${Hc} Z"/><path class="ln" id="${id}-ln" d="${line}"/>
          <circle class="dot" id="${id}-dot" cx="${last[0]}" cy="${last[1]}" r="12"/></svg>${band?.label ? `
          <div class="blab" id="${id}-bl" data-lint style="left:${inPlot(bx[0] / Wc)};width:${inPlot((bx[1] - bx[0]) / Wc)};justify-content:${bmid < 0.2 ? 'flex-start' : bmid > 0.8 ? 'flex-end' : 'center'}">${h(band.label)}</div>` : ''}${ref?.label ? `
          <div class="rlab" id="${id}-rl" data-lint style="top:calc(${((ry / Hc) * 100).toFixed(2)}% - ${px(MK + 10)})">${h(ref.label)}</div>` : ''}
          <div class="lval${toneClass(sc)}" id="${id}-lv" style="left:calc(100% - ${px(col - LV_GAP)});top:${px(lvTop)}" data-count="${pts[pts.length - 1] || 0}" data-format="${h(f)}" data-dec="${dec}">0</div>
          ${Array.isArray(sc.labels) ? `<div class="axis" style="right:${px(col)}"><span>${h(sc.labels[0] || '')}</span><span>${h(sc.labels[1] || '')}</span></div>` : ''}</div>
        ${sc.text ? `<div class="dsub" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'line', ...tone(sc) });
    } else if (sc.kind === 'donut') {
      const ps = (sc.parts || []).slice(0, 5);
      const total = ps.reduce((a, p) => a + num(p.value), 0) || 1;
      let acc = 0;
      const arcs = ps.map((p, k) => { const from = acc / total; acc += num(p.value); return { from, to: acc / total, k }; });
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}<div class="donutrow">
        <svg class="donut" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="74" class="dbg"/>
          ${arcs.map((a) => `<circle cx="100" cy="100" r="74" class="arc" id="${id}-arc${a.k}" stroke="${C.series[a.k % C.series.length]}" data-from="${a.from}" data-to="${a.to}" transform="rotate(-90 100 100)"/>`).join('')}</svg>
        <div class="legend">${ps.map((p, k) => `<div class="lg" id="${id}-lg${k}"><i style="background:${C.series[k % C.series.length]}"></i><span data-lint>${h(p.label)}</span><b data-count="${Math.round((num(p.value) / total) * 100)}" data-format="pct" data-dec="0">0</b></div>`).join('')}</div></div>
        ${sc.text ? `<div class="dsub" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'donut', n: ps.length });
    } else if (sc.kind === 'race') {
      const series = (sc.series || []).slice(0, 10);
      const periods = (sc.periods || []).slice(0, 12);
      const top = Math.min(series.length, Number(sc.top) || 5);
      const frames = raceFrames(periods, series);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}
        <div class="race" style="height:${px(top * rowH)}">${series.map((x, j) => `<div class="rrow" id="${id}-r${j}">
          <span class="rl" data-lint>${h(x.label)}</span><div class="rt"><i id="${id}-rb${j}" style="background:${C.series[j % C.series.length]}"></i></div>
          <b class="rv" id="${id}-rv${j}" data-format="${h(f)}" data-dec="${dec}">0</b></div>`).join('')}
          <div class="per" id="${id}-per" data-lint>${h(periods[0] || '')}</div></div>
        ${sc.text ? `<div class="dsub" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'race', n: series.length, top, periods, rank: frames.map((x) => x.rank), frac: frames.map((x) => x.frac), vals: frames.map((x) => x.vals) });
    } else if (sc.kind === 'stripes') {
      const vals = (sc.values || []).map((v) => num(v)).slice(0, 200);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const reach = Math.max(1e-9, ...vals.map((v) => Math.abs(v - mean)));
      const a = vals.map((v) => (v - mean) / reach);
      const w = 100 / (vals.length || 1);
      blocks.push(`<div class="sc fill" id="g-${id}"><div class="box">${head(sc)}
        <div class="stripes" id="${id}-st">${a.map((x, i) => `<i class="stp" id="${id}-s${i}" style="left:${(i * w).toFixed(3)}%;width:${(w + 0.08).toFixed(3)}%;background:${stripeColor(x, C.cool, C.warm)}"></i>`).join('')}
          <div class="mean" id="${id}-mean"></div></div>
        ${Array.isArray(sc.labels) ? `<div class="saxis"><span>${h(sc.labels[0])}</span><span>${h(sc.labels[1])}</span></div>` : ''}
        ${sc.text ? `<div class="dsub" data-lint>${h(sc.text)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'stripes', n: vals.length, a: a.map((x) => Math.round(x * 1000) / 1000), bars: sc.finish === 'bars' });
    } else if (sc.kind === 'cta') {
      const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true });
      blocks.push(`<div class="sc fill dark" id="g-${id}"><div class="box cta">${logo ? `<div class="clogo">${logo}</div>` : ''}
        ${sc.kicker ? `<div class="kick" data-lint>${h(sc.kicker)}</div>` : ''}<div class="hd ctat" data-lint>${h(sc.title)}</div>
        <div class="btn" id="${id}-btn" data-lint>${h(sc.button)}</div>${sc.url ? `<div class="curl" data-lint>${h(sc.url)}</div>` : ''}</div></div>`);
      scenes.push({ id, kind: 'cta', dark: true });
    }
  }
  // Rules for a line's band and reference line and for themed scenes are written only when a scene uses them.
  const lines = script.scenes.filter((s) => s.kind === 'line');
  const hasBand = lines.some((s) => s.band), hasRef = lines.some((s) => s.ref);
  // Written only when a scene uses them, so every other page stays byte for byte the same.
  const hasTone = script.scenes.some((s) => toneClass(s)), hasSeries = script.scenes.some((s) => s.kind === 'bars' && Array.isArray(s.series) && s.series.length === 2);
  const hasCols = script.scenes.some((s) => s.kind === 'bars' && s.layout === 'columns');
  const hasDark = script.scenes.some((s) => s.kind !== 'cta' && s.theme === 'dark'), hasAcc = script.scenes.some((s) => s.theme === 'accent');
  const css = `
.box{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:${px(port ? 120 : 90)} ${padX(land ? 220 : 90)};gap:${px(28)}}
.box.center{align-items:center;text-align:center}
.dtt{font-size:${px(port ? 92 : 80)}}.dsub{font-size:${px(42)};color:var(--muted);line-height:1.3}
.big{font-family:var(--display);font-weight:900;font-size:${px(port ? 250 : 230)};line-height:1;color:var(--primary2);font-variant-numeric:tabular-nums}${C.mark ? `
.big{color:var(--ink);padding:0 ${px(24)};background:linear-gradient(transparent 58%,${C.mark} 58%,${C.mark} 90%,transparent 90%) no-repeat;background-size:0% 100%}
.lval{color:var(--ink) !important;padding:0 ${px(10)};background:linear-gradient(transparent 55%,${C.mark} 55%,${C.mark} 92%,transparent 92%)}` : ''}.big small{font-size:${px(90)};margin-left:${px(12)}}
.chg{font-weight:800;font-size:${px(52)};border-radius:999px;padding:${px(8)} ${px(28)}}.chg.up{color:#15803d;background:#dcfce7}.chg.dn{color:#b91c1c;background:#fee2e2}${hasTone ? `
.tup{color:#15803d !important}.tdn{color:#b91c1c !important}.dark .tup{color:#4ade80 !important}.dark .tdn{color:#f87171 !important}` : ''}${hasSeries ? `
.sleg{display:flex;gap:${px(40)};font-size:${px(34)};font-weight:600;color:var(--muted)}.sleg span{display:flex;align-items:center;gap:${px(12)}}.sleg i{width:${px(24)};height:${px(24)};border-radius:${px(6)}}
.bar.two{display:grid;grid-template-columns:${px(port ? 300 : 440)} 1fr;align-items:center;gap:${px(28)}}.bar.two .bl{font-size:${px(38)};line-height:1.15}
.bp{display:grid;grid-template-columns:1fr auto;align-items:center;gap:${px(20)};font-size:${px(34)}}.bp + .bp{margin-top:${px(10)}}.bp .bt{margin-top:0;height:${px(22)}}.bp b{font-weight:700;min-width:${px(170)};text-align:right;font-variant-numeric:tabular-nums}` : ''}${hasCols ? `
.bars.cols{flex-direction:row;align-items:flex-start;justify-content:center;gap:${px(land ? 110 : port ? 36 : 60)}}.col{display:flex;flex-direction:column;align-items:center;gap:${px(22)};flex:0 1 ${px(land ? 440 : port ? 230 : 300)};min-width:0}
.cps{display:flex;align-items:flex-end;gap:${px(18)};height:${px(port ? 520 : 400)}}.cp{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:${px(14)};height:100%;font-size:${px(port ? 32 : 40)};font-weight:700;font-variant-numeric:tabular-nums}
.cp .ct{width:${px(land ? 96 : port ? 60 : 72)};height:calc(100% - ${px(60)});border-radius:${px(14)} ${px(14)} 0 0;background:rgba(15,23,42,.07);overflow:hidden;display:flex;align-items:flex-end}.cp .ct i{display:block;width:100%;height:0;border-radius:${px(14)} ${px(14)} 0 0}
.cl{font-size:${px(port ? 32 : 38)};font-weight:600;text-align:center;line-height:1.15}` : ''}
.bars{display:flex;flex-direction:column;gap:${px(26)}}
.bl{display:flex;justify-content:space-between;font-size:${px(40)};font-weight:600}.bl b{font-variant-numeric:tabular-nums}
.bt{height:${px(28)};border-radius:${px(14)};background:rgba(15,23,42,.07);overflow:hidden;margin-top:${px(10)}}.bt i{display:block;height:100%;border-radius:${px(14)};width:0}
.chart{position:relative;width:100%;height:${px(chartH)};margin-bottom:${px(44)}}.chart svg{width:100%;height:100%;overflow:visible}
.grid{stroke:rgba(15,23,42,.08);stroke-width:2;fill:none}.ln{fill:none;stroke:${C.line};stroke-width:7;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
${C.fade ? '.area{opacity:.3}' : '.area{fill:var(--primary2);opacity:.12}'}.dot{fill:${C.mark || C.line}${C.mark ? ';stroke:var(--ink);stroke-width:5' : ''}}
.lval{position:absolute;line-height:1;white-space:nowrap;font-family:var(--display);font-weight:900;font-size:${px(LVAL.std)};color:var(--primary2);font-variant-numeric:tabular-nums}
.axis{position:absolute;left:0;right:0;top:100%;display:flex;justify-content:space-between;font-size:${px(30)};color:var(--muted);margin-top:${px(10)}}
.donutrow{display:flex;flex-direction:${port ? 'column' : 'row'};align-items:center;gap:${px(60)}}
.donut{width:${px(donut)};height:${px(donut)};flex:none}.dbg{fill:none;stroke:rgba(15,23,42,.07);stroke-width:34}.arc{fill:none;stroke-width:34}
.legend{display:flex;flex-direction:column;gap:${px(22)};min-width:${px(380)}}
.lg{display:flex;align-items:center;gap:${px(16)};font-size:${px(42)};font-weight:600}.lg i{width:${px(26)};height:${px(26)};border-radius:50%;flex:none}.lg b{margin-left:auto;font-variant-numeric:tabular-nums}
.race{position:relative;width:100%}
.rrow{position:absolute;left:0;right:0;top:0;height:${px(rowH)};display:grid;grid-template-columns:${px(land ? 300 : 250)} 1fr ${px(land ? 220 : 190)};align-items:center;gap:${px(18)}}
.rl{font-size:${px(36)};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt{height:${px(rowH * 0.56)};border-radius:${px(10)};overflow:hidden}.rt i{display:block;height:100%;width:0;border-radius:${px(10)}}
.rv{font-size:${px(36)};text-align:right;font-variant-numeric:tabular-nums}
.per{position:absolute;right:0;bottom:${px(-110)};font-family:var(--display);font-weight:900;font-size:${px(port ? 120 : 104)};color:var(--primary2);opacity:.85;font-variant-numeric:tabular-nums}
.stripes{position:relative;width:100%;height:${px(chartH)};border-radius:${px(12)};overflow:hidden}
.stp{position:absolute;top:0;height:100%;display:block}
.mean{position:absolute;left:0;right:0;top:50%;height:${px(3)};background:var(--ink);opacity:0}
.saxis{display:flex;justify-content:space-between;font-size:${px(30)};color:var(--muted);margin-top:${px(-10)}}
.box.cta{align-items:flex-start}.ctat{font-size:${px(port ? 116 : 100)}}.curl{font-size:${px(38)};opacity:.8}
.clogo .brandlogo{height:${px(80)};max-width:${px(560)}}.clogo .txt{font-weight:800;font-size:${px(56)}}${hasBand ? `
.band{fill:var(--secondary);fill-opacity:.22}
.blab{position:absolute;top:${px(10)};display:flex;white-space:nowrap;font-weight:700;font-size:${px(MK)};letter-spacing:.06em;text-transform:uppercase}` : ''}${hasRef ? `
.ref{fill:none;stroke:var(--ink);stroke-opacity:.55;stroke-width:3;stroke-dasharray:14 10;vector-effect:non-scaling-stroke}
.rlab{position:absolute;left:0;line-height:1;font-weight:700;font-size:${px(MK)};color:var(--muted)}` : ''}${hasDark ? `
.dark .big{color:var(--secondary);background:none}.dark .box .dsub{color:var(--on);opacity:.75}.dark .bt{background:rgba(255,255,255,.12)}
.dark .grid{stroke:rgba(255,255,255,.12)}.dark .lval{color:var(--secondary)!important;background:none}.dark .axis{color:var(--on);opacity:.7}
.dark .ref{stroke:var(--on)}.dark .blab,.dark .rlab{color:var(--on)}` : ''}${hasAcc ? `${ACCENT_CSS}
.acc .big{color:var(--ink);background:none}.acc .box .dsub{color:var(--ink);opacity:.8}.acc .bt{background:rgba(15,23,42,.1)}.acc .bt i{background:var(--ink)!important}
.acc .grid{stroke:rgba(15,23,42,.14)}.acc .ln{stroke:var(--ink)}.acc .area{fill:var(--ink)}.acc .dot{fill:var(--ink);stroke:var(--ink)}
.acc .lval{color:var(--ink)!important;background:none}.acc .axis,.acc .rlab{color:var(--ink)}.acc .band{fill:var(--ink);fill-opacity:.1}.acc .ref{stroke:var(--ink)}` : ''}${stage ? `
.box.center,.box:has(> .bars),.box:has(> .chart){padding:${px(A.top)} ${padX(land ? 170 : 90)} ${px(A.bottom)}}
.box.center .kick{font-size:${px(40)}}.big{font-size:${px(port ? 270 : land ? 300 : 250)}}.big small{font-size:${px(land ? 120 : 100)}}.chg{font-size:${px(62)}}.box.center .dsub{font-size:${px(land ? 56 : 48)}}
.box:has(> .bars) .dtt,.box:has(> .chart) .dtt{font-size:${px(land ? 100 : port ? 96 : 80)}}.box:has(> .bars) .dsub,.box:has(> .chart) .dsub{font-size:${px(land ? 50 : 44)}}
.bars{gap:${px(30)}}.bl{font-size:${px(land || port ? 52 : 44)}}.bt{height:${px(36)};border-radius:${px(18)}}.bt i{border-radius:${px(18)}}
.bars:has(> :nth-child(4)){gap:${px(22)}}.bars:has(> :nth-child(4)) .bl{font-size:${px(44)}}.bars:has(> :nth-child(4)) .bt{height:${px(28)}}
.bars:has(> :nth-child(6)){gap:${px(18)}}.bars:has(> :nth-child(6)) .bl{font-size:${px(40)}}
.lval{font-size:${px(LV)}}.axis{font-size:${px(36)}}` : ''}`;
  const js = `
const intro = (sc, s) => { const g = $('g-' + sc.id); fadeUp(g.querySelector('.kick'), s + 0.05); fadeUp(g.querySelector('.dtt'), s + 0.12, { d: 0.6 }); return g; };
const KINDS = {
  title(sc, s) { const g = intro(sc, s); fadeUp(g.querySelector('.dsub'), s + 0.5); },
  stat(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.kick'), s + 0.05);
    pop(g.querySelector('.big'), s + 0.1, { from: 0.85 });
    countUp($(sc.id + '-v'), s + 0.15, 1.3);
    pop($(sc.id + '-chg'), s + 1.2);${C.mark ? `
    tl.fromTo(g.querySelector('.big'), { backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%', duration: 0.6, ease: X, immediateRender: false }, s + 1.3);\n` : ''}
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.4));
  },
  bars(sc, s) {
    const g = intro(sc, s);
    for (let k = 0; k < sc.n; k++) {
      const at = s + 0.45 + k * 0.18;
      const bar = $(sc.id + '-b' + k);${hasCols ? `
      // Columns grow upward from the baseline; rows grow to the right.
      const cols = !!bar.closest('.cols'), grow = (el, t) => tl.fromTo(el, cols ? { height: '0%' } : { width: '0%' }, { [cols ? 'height' : 'width']: (el.dataset.frac * 100) + '%', duration: 0.9, ease: X, immediateRender: false }, t);
      fadeUp(bar.closest(cols ? '.col' : '.bar'), at, { y: 16, d: 0.4 });
      grow(bar, at + 0.1);` : `
      fadeUp(bar.closest('.bar'), at, { y: 16, d: 0.4 });
      tl.fromTo(bar, { width: '0%' }, { width: (bar.dataset.frac * 100) + '%', duration: 0.9, ease: X, immediateRender: false }, at + 0.1);`}
      countUp($(sc.id + '-bv' + k), at + 0.1, 0.9);${hasSeries ? `
      // The second series grows a beat after the first.
      const b2 = $(sc.id + '-b' + k + 'x');
      if (b2) { ${hasCols ? 'grow(b2, at + 0.25)' : "tl.fromTo(b2, { width: '0%' }, { width: (b2.dataset.frac * 100) + '%', duration: 0.9, ease: X, immediateRender: false }, at + 0.25)"}; countUp($(sc.id + '-bv' + k + 'x'), at + 0.25, 0.9); }` : ''}
    }${hasSeries ? `
    fadeUp(g.querySelector('.sleg'), s + 0.3, { y: 14 });` : ''}
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.7));
  },
  line(sc, s) {
    const g = intro(sc, s);${hasBand || hasRef ? `
    // The highlighted span and the reference line settle in before the line draws across them.
    for (const [mark, lab] of [['-band', '-bl'], ['-ref', '-rl']]) {
      const el = $(sc.id + mark);
      if (el) { tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6, immediateRender: false }, s + 0.3); fadeUp($(sc.id + lab), s + 0.45, { y: 14 }); }
    }` : ''}
    draw($(sc.id + '-ln'), s + 0.4, 1.4);
    tl.fromTo($(sc.id + '-area'), { opacity: 0 }, { opacity: ${C.fade ? 0.3 : 0.12}, duration: 0.6, immediateRender: false }, s + 1.4);
    pop($(sc.id + '-dot'), s + 1.7, { from: 0 });
    tl.to($(sc.id + '-dot'), { scale: 1.5, duration: 0.4, yoyo: true, repeat: 3, transformOrigin: '50% 50%' }, s + 2.1);
    fadeUp($(sc.id + '-lv'), s + 1.6); countUp($(sc.id + '-lv'), s + 1.6, 0.8);
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.7));
  },
  donut(sc, s) {
    const g = intro(sc, s);
    for (let k = 0; k < sc.n; k++) {
      const arc = $(sc.id + '-arc' + k);
      tl.fromTo(arc, { drawSVG: (arc.dataset.from * 100) + '% ' + (arc.dataset.from * 100) + '%' }, { drawSVG: (arc.dataset.from * 100) + '% ' + (arc.dataset.to * 100) + '%', duration: 0.7, ease: XIO, immediateRender: false }, s + 0.4 + k * 0.45);
      const lg = $(sc.id + '-lg' + k);
      fadeUp(lg, s + 0.45 + k * 0.45, { y: 14 }); countUp(lg.querySelector('b'), s + 0.45 + k * 0.45, 0.7);
    }
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.75));
  },
  race(sc, s) {
    const g = intro(sc, s);
    const P = sc.periods.length, per = $(sc.id + '-per');
    // Each period gets an even share of the time the voice gives this scene.
    const t0 = s + 1.0, t1 = Math.max(t0 + 0.5 * (P - 1), cue(sc, 0.92)), seg = (t1 - t0) / Math.max(1, P - 1);
    fadeUp(per, s + 0.5, { y: 20 });
    const numTo = (el, a, b, at, d) => { const o = { v: a }; tl.fromTo(o, { v: a }, { v: b, duration: d, ease: 'none', immediateRender: false, onUpdate: () => { el.textContent = fmt(o.v, el.dataset.format, +el.dataset.dec); } }, at); };
    for (let j = 0; j < sc.n; j++) {
      const row = $(sc.id + '-r' + j), bar = $(sc.id + '-rb' + j), val = $(sc.id + '-rv' + j);
      const shown = (k) => (sc.rank[k][j] < sc.top ? 1 : 0);
      tl.set(row, { yPercent: sc.rank[0][j] * 100, opacity: 0 }, Math.max(0, s - 0.01));
      tl.to(row, { opacity: shown(0), duration: 0.35 }, s + 0.45 + sc.rank[0][j] * 0.08);
      tl.fromTo(bar, { width: '0%' }, { width: sc.frac[0][j] * 100 + '%', duration: 0.6, immediateRender: false }, s + 0.5);
      val.textContent = fmt(0, val.dataset.format, +val.dataset.dec);
      numTo(val, 0, sc.vals[0][j], s + 0.5, 0.6);
      for (let k = 1; k < P; k++) {
        const at = t0 + (k - 1) * seg;
        tl.to(row, { yPercent: sc.rank[k][j] * 100, opacity: shown(k), duration: Math.min(0.8, seg * 0.9), ease: 'power1.inOut' }, at);
        tl.to(bar, { width: sc.frac[k][j] * 100 + '%', duration: seg, ease: 'none' }, at);
        numTo(val, sc.vals[k - 1][j], sc.vals[k][j], at, seg);
      }
    }
    for (let k = 1; k < P; k++) tl.set(per, { textContent: sc.periods[k] }, t0 + (k - 1) * seg + seg * 0.5);
    tl.set(per, { textContent: sc.periods[0] }, Math.max(0, s - 0.01));
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.8));
  },
  stripes(sc, s) {
    const g = intro(sc, s);
    const els = [...g.querySelectorAll('.stp')];
    tl.fromTo(els, { scaleY: 0 }, { scaleY: 1, duration: 0.45, stagger: Math.min(0.03, 1.4 / sc.n), ease: X, transformOrigin: '50% 50%', immediateRender: false }, s + 0.4);
    fadeUp(g.querySelector('.saxis'), s + 0.6, { y: 12 });
    if (sc.bars) {
      // The same stripes become bars above or below the mean: how far each value sits from it.
      const at = Math.max(s + 2.2, cue(sc, 0.5));
      tl.to($(sc.id + '-mean'), { opacity: 0.5, duration: 0.4 }, at);
      els.forEach((el, i) => {
        const a = sc.a[i];
        tl.to(el, { top: (a >= 0 ? 50 - a * 46 : 50) + '%', height: Math.max(0.8, Math.abs(a) * 46) + '%', duration: 0.9, ease: XIO }, at + i * Math.min(0.008, 0.6 / sc.n));
      });
    }
    fadeUp(g.querySelector('.dsub'), cue(sc, 0.8));
  },
  cta(sc, s) {
    const g = $('g-' + sc.id);
    fadeUp(g.querySelector('.clogo'), s + 0.05); fadeUp(g.querySelector('.kick'), s + 0.1); fadeUp(g.querySelector('.ctat'), s + 0.2, { d: 0.7 });
    pop($(sc.id + '-btn'), s + 0.6); fadeUp(g.querySelector('.curl'), s + 0.9);
  },
};`;
  return { css, body: blocks.join('\n'), scenes, js };
}
