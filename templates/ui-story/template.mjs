import { iconSet, TICK, DECOR } from '../../motion-kit/icons.mjs';
import { logoHtml } from '../shared.mjs';
import { page, h, asset, camera, hasLogoBug } from '../kit.mjs';
import { motionProfile } from '../../engine/brand.mjs';

// Raw 1920×1080 px: the template lists only 16:9, where the kit's unit U is 1.
const APP = { x: 210, y: 30, w: 1500, h: 844, bar: 34 };
// Shot scenes: a screenshot (beats.json shots.imageSize) scaled into the window below its bar; the cursor keeps the drawn one's 30 px width.
const IMG = { width: 1920, height: 1080 };
const SHOT_BASE = APP.w / IMG.width;
const SHOT_CURSOR = { w: Math.round(30 / SHOT_BASE), h: Math.round(40 / SHOT_BASE) };
const SHOT_RING = Math.round(70 / SHOT_BASE);
const RAIL = 220;
const TOP = 60;
const PANEL = 480;
// The compact subtitle line under the app window; the caption sits CAP_GAP above it (CAP_BOTTOM fits one line).
const SUB_BOTTOM = 54;
const CAP_GAP = 6;
const CAP_BOTTOM = 99;
// Line captions (motion profile caps 'lines') are one element per line (sub-<scene>-<k>), and a profile with a camera
// push scales every scene group in around its centre, which moves the caption label down towards them: lift it by
// that much more (k = the push beyond 1, e.g. 0.03).
const LINES_SUB = " || $('sub-' + sc.id + '-0')";
const PUSH_LIFT = (k) => ` + Math.ceil((sub.offsetTop - D.H / 2) * ${k})`;
// The band under the app window that fades its bottom edge behind the subtitles.
const BAND = 1080 - APP.y - APP.h - APP.bar + 10;
// With the brand's corner logo the app window moves right so the logo area stays clear.
const BUG_CLEAR = 60;

const TONES = {
  brand: ['#2563eb', '#e8efff'], warn: ['#8a4f00', '#fdf1df'], bad: ['#b8002a', '#fde7ec'],
  teal: ['#008078', '#e0f2f1'], ok: ['#3f6f1f', '#e8f3df'], muted: ['#475569', '#eef1f5'],
};
const tone = (t) => TONES[t] || TONES.muted;

const ICONS = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a6 6 0 0 0-4-5.6',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  repeat: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  check: 'M5 4h14v16H5zM8.5 12l2.5 2.5 4.5-5',
  chat: 'M4 5h16v11H9l-5 4z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.5-1.5L17 5l-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v1l-2 1 1 3 2-.3 1.5 1.5L7 21l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .3 1-3-2-1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
};
const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.home}"/></svg>`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sparkPath = (pts, w, hgt) => {
  const vals = (pts || []).map(num);
  if (vals.length < 2) return { line: '', area: '' };
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const xy = vals.map((v, i) => [Math.round((i / (vals.length - 1)) * w), Math.round(hgt - 4 - ((v - min) / span) * (hgt - 8))]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  return { line, area: `${line} L${w} ${hgt} L0 ${hgt} Z`, end: xy[xy.length - 1] };
};

function cell(v) {
  if (v && typeof v === 'object') {
    if (v.badge) { const [fg, bg] = tone(v.tone); return `<span class="badge" style="color:${fg};background:${bg}">${h(v.badge)}</span>`; }
    if (v.button) return `<span class="btn sm">${h(v.button)}</span>`;
    return `<span class="${v.link ? 'lnk' : ''}">${h(v.text)}</span>`;
  }
  return h(v);
}

function dashboardHtml(id, d) {
  const kpis = (d.kpis || []).slice(0, 4).map((k, i) => {
    const [fg] = tone(k.tone);
    let viz = '';
    if (Array.isArray(k.ring) && k.ring.length) {
      const total = k.ring.reduce((a, r) => a + num(r.value), 0) || 1;
      let acc = 0;
      const arcs = k.ring.map((r, j) => {
        const from = acc / total; acc += num(r.value);
        const col = j === 0 ? '#2563eb' : '#c8102e';
        return `<circle class="ringseg" cx="32" cy="32" r="24" stroke="${col}" data-from="${from}" data-to="${acc / total}" transform="rotate(-90 32 32)"/>`;
      }).join('');
      const legend = k.ring.map((r, j) => `<div class="lg"><i style="background:${j === 0 ? '#2563eb' : '#c8102e'}"></i>${h(r.label)}<b>${h(r.value)}</b></div>`).join('');
      viz = `<div class="ringrow"><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" class="ringbg"/>${arcs}</svg><div class="legend">${legend}</div></div>`;
    } else if (Array.isArray(k.spark)) {
      const p = sparkPath(k.spark, 220, 46);
      viz = `<svg class="spark" width="220" height="46" viewBox="0 0 220 46" aria-hidden="true"><path class="sa" d="${p.area}" fill="${fg}" opacity=".12"/><path class="sl" d="${p.line}" stroke="${fg}"/>${p.end ? `<circle class="sd" cx="${p.end[0]}" cy="${p.end[1]}" r="4" fill="${fg}"/>` : ''}</svg>`;
    }
    return `<div class="kpi" id="${id}-k${i}"><div class="kl">${h(k.label)}</div><div class="kv" style="color:${fg}" data-count="${num(k.value)}" data-format="${h(k.format || 'int')}">0</div>${viz}</div>`;
  }).join('');
  const queue = (d.queue?.rows || []).slice(0, 6).map((r, i) => {
    const [fg, bg] = tone(r.tone);
    return `<div class="qrow" id="${id}-q${i}"><span class="chip" style="color:${fg};background:${bg}">${h(r.chip)}</span>
      <div class="qt"><b>${h(r.title)}</b><span>${h(r.detail)}</span></div>
      <span class="btn sm">Mark contacted</span><span class="btn sm">Ask</span><span class="btn sm">Open</span></div>`;
  }).join('');
  const side = (d.side?.rows || []).slice(0, 6).map((r, i) => `<div class="srow" id="${id}-s${i}"><div><span class="lnk">${h(r.label)}</span><span class="sub">${h(r.sub)}</span></div><b>${h(r.value)}</b></div>`).join('');
  return `<div class="ph"><h1>${h(d.heading || '')}</h1><p>${h(d.sub || '')}</p></div>
    <div class="kpis">${kpis}</div>
    <div class="cols"><div class="card queue"><div class="ch">${h(d.queue?.title || '')}</div>${queue}</div>
    <div class="card side"><div class="ch">${h(d.side?.title || '')}</div>${side}</div></div>`;
}

function tableHtml(id, d) {
  const filters = (d.filters || []).slice(0, 5).map((f, i) => `<span class="${i === 0 ? 'search' : 'facet'}">${i === 0 ? icon('search', 16) : ''}${h(f)}</span>`).join('');
  const head = (d.columns || []).map((c) => `<th>${h(c)}</th>`).join('');
  const rows = (d.rows || []).slice(0, 10).map((r, i) => `<tr id="${id}-r${i}">${r.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('');
  return `<div class="ph"><h1>${h(d.heading || '')}</h1>${d.sub ? `<p>${h(d.sub)}</p>` : ''}</div>
    <div class="filters">${filters}</div>
    <div class="card tbl"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>${d.footer ? `<div class="tf">${h(d.footer)}</div>` : ''}</div>`;
}

const initials = (t) => String(t || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const toastHtml = (id, text) => (text ? `<div class="toast" id="${id}-toast"><b>✓</b>${h(text)}</div>` : '');

function detailHtml(id, d) {
  const badge = d.badge ? (() => { const [fg, bg] = tone(d.badge.tone); return `<span class="badge big" id="${id}-badge" style="color:${fg};background:${bg}">${h(d.badge.text)}</span>`; })() : '';
  const acts = (d.actions || []).slice(0, 5).map((a, i) => `<span class="btn${i === (d.primary ?? -1) ? ' pri' : ''}" id="${id}-a${i}">${h(a)}</span>`).join('');
  const cards = (d.cards || []).slice(0, 4).map((c) => `<div class="card dc"><div class="ch">${h(c.title)}</div>${(c.rows || []).slice(0, 5).map((r) => `<div class="kvr"><span>${h(r.label)}</span><b>${h(r.value)}</b></div>`).join('')}</div>`).join('');
  const t = d.table;
  const table = t ? `<div class="card tbl dtl"><div class="ch">${h(t.title || '')}</div><table><thead><tr>${(t.columns || []).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${(t.rows || []).slice(0, 5).map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="ph dh"><div class="av">${h(initials(d.title))}</div><div class="dt"><h1>${h(d.title || '')}</h1><p>${h(d.sub || '')}</p></div>${badge}<div class="acts">${acts}</div></div>
    <div class="dcards" style="grid-template-columns:repeat(${Math.max(1, Math.min(4, (d.cards || []).length))},1fr)">${cards}</div>${table}${toastHtml(id, d.click?.toast)}`;
}

function fieldsHtml(id, sections) {
  return (sections || []).slice(0, 3).map((sec, si) => `<div class="card fs"><div class="ch">${h(sec.title)}</div><div class="fields">${(sec.fields || []).slice(0, 6).map((f, fi) =>
    `<div class="fld"><label>${h(f.label)}</label><div class="inp" id="${id}-f${si}-${fi}"><span class="val" data-value="${h(f.value)}"></span><span class="phd2">${h(f.placeholder || '')}</span></div></div>`).join('')}</div></div>`).join('');
}

function formHtml(id, d) {
  const submit = d.submit ? `<span class="btn pri wide" id="${id}-submit" data-busy="${h(d.submit.busy || 'Saving…')}">${h(d.submit.label)}</span>` : '';
  if (d.modal) {
    return `<div class="modalbg"></div><div class="modal"><div class="mh">${h(d.heading || '')}<span>✕</span></div>${fieldsHtml(id, d.sections)}<div class="mf"><span class="btn">Cancel</span>${submit}</div></div>${toastHtml(id, d.submit?.toast)}`;
  }
  const lines = d.lines || {};
  const sr = d.search;
  const items = `<div class="card fs"><div class="ch">${h(lines.title || 'Items')}</div>
    ${sr ? `<div class="psearch" id="${id}-search">${icon('search', 16)}<span class="val" data-value="${h(sr.query)}"></span><span class="phd2">${h(sr.label || 'Search products')}</span></div>
    <div class="pdrop" id="${id}-drop"><div class="pitem" id="${id}-pick"><b>${h(sr.result)}</b><span>${h(sr.resultSub || '')}</span></div></div>` : ''}
    <table class="ltab"><thead><tr>${(lines.columns || []).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>
    ${(lines.rows || []).slice(0, 4).map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}
    ${sr?.line ? `<tr class="newline" id="${id}-newline">${sr.line.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>` : ''}</tbody></table></div>`;
  const tots = (d.totals || []).slice(0, 5);
  const totals = tots.map((t, i) => `<div class="tot${i === tots.length - 1 ? ' grand' : ''}"><span>${h(t.label)}</span><b data-count="${num(t.value)}" data-from="${num(t.from)}" data-format="${h(t.format || 'money')}"></b></div>`).join('');
  return `<div class="ph"><h1>${h(d.heading || '')}</h1><p>${h(d.sub || '')}</p></div>
    <div class="fgrid"><div class="fmain">${fieldsHtml(id, d.sections)}${items}</div>
    <div class="card fside"><div class="ch">Summary</div>${totals}${d.reason ? `<div class="fld"><label>Reason (for the audit log)</label><div class="inp" id="${id}-reason"><span class="val" data-value="${h(d.reason)}"></span></div></div>` : ''}${submit}</div></div>${toastHtml(id, d.submit?.toast)}`;
}

function viewHtml(s) {
  const d = s.data || {};
  const body = s.layout === 'table' ? tableHtml(s.id, d) : s.layout === 'detail' ? detailHtml(s.id, d) : s.layout === 'form' ? formHtml(s.id, d) : dashboardHtml(s.id, d);
  const click = s.layout === 'detail' && d.click ? (() => {
    const [fg, bg] = tone(d.click.badge?.tone);
    return ` data-click="${Number(d.click.action) || 0}" data-nb="${h(d.click.badge?.text || '')}" data-nfg="${fg}" data-nbg="${bg}"`;
  })() : '';
  return `<div class="view${s.layout === 'form' && d.modal ? ' modalview' : ''}" id="v-${s.id}" data-layout="${h(s.layout)}"${click}>${body}</div>`;
}

function beatHtml(s) {
  const st = s.stat;
  return `<div class="btx" id="bt-${s.id}">${s.kicker ? `<div class="bk">${h(s.kicker)}</div>` : ''}<div class="bh" data-lint>${h(s.title)}</div>
    ${st ? `<div class="bn"><span data-count="${num(st.value)}" data-format="${h(st.format || 'int')}">0</span><small>${h(st.unit || '')}</small></div>` : ''}
    ${s.subtitle ? `<div class="bs">${h(s.subtitle)}</div>` : ''}</div>
    <svg class="bdecor" id="bd-${s.id}" viewBox="0 0 900 620" aria-hidden="true">${(DECOR[s.decor || 'none'] || []).map((p) => `<path d="${p}"/>`).join('')}</svg>`;
}

function turnHtml(sid, k, t) {
  const id = `${sid}-t${k}`;
  if (t.type === 'suggestions') {
    return `<div class="turn sugg" id="${id}"><div class="sh">${icon('spark', 16)} Try asking</div>${(t.items || []).slice(0, 4).map((s, i) => `<span class="sg" id="${id}-i${i}">${icon('search', 14)}${h(s)}</span>`).join('')}</div>`;
  }
  if (t.type === 'user') return `<div class="turn user" id="${id}"><span class="bub">${h(t.text)}</span></div>`;
  const rows = (t.rows || []).slice(0, 6).map((r, i) => `<div class="arow" id="${id}-r${i}"><div><b>${h(r.label)}</b>${r.value ? `<span>${h(r.value)}</span>` : ''}</div><span class="btn sm">Open</span></div>`).join('');
  let analytics = '';
  if (t.analytics) {
    const a = t.analytics;
    const kp = (a.kpis || []).slice(0, 4).map((x, i) => {
      const up = num(x.change) >= 0;
      return `<div class="ak" id="${id}-ak${i}"><span>${h(x.label)}</span><b data-count="${num(x.value)}" data-format="${h(x.format || 'int')}">0</b><i class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(num(x.change)).toFixed(1)}%</i></div>`;
    }).join('');
    const p = sparkPath(a.series, 400, 90);
    const bars = (a.bars || []).slice(0, 4).map((b, i) => {
      const up = num(b.change) >= 0;
      return `<div class="ab" id="${id}-ab${i}"><div class="abl"><span>${h(b.name)}</span><span>${h(b.valueText)} <i class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'}${Math.abs(num(b.change)).toFixed(1)}%</i></span></div><div class="abt"><i data-frac="${Math.max(0, Math.min(1, num(b.fraction)))}"></i></div></div>`;
    }).join('');
    analytics = `<div class="acard" id="${id}-an"><div class="at">${h(a.title || '')}</div><div class="akg">${kp}</div>
      <svg class="aline" width="400" height="90" viewBox="0 0 400 90" aria-hidden="true"><path class="sa" d="${p.area}"/><path class="sl" d="${p.line}"/></svg>
      <div class="abs">${bars}</div></div>`;
  }
  let approval = '';
  if (t.approval) {
    const ap = t.approval;
    approval = `<div class="apcard" id="${id}-ap"><div class="apt">${h(ap.summary)}</div>
      ${(ap.facts || []).slice(0, 4).map((f, i) => `<div class="apf" id="${id}-f${i}"><span>${h(f.label)}</span><b>${h(f.value)}</b></div>`).join('')}
      ${ap.note ? `<div class="apn">${h(ap.note)}</div>` : ''}
      <div class="apb"><span class="btn pri" id="${id}-approve">Approve</span><span class="btn">Cancel</span><span class="exp">expires in 30 min</span></div></div>`;
  }
  let result = '';
  if (t.result) {
    result = `<div class="rescard" id="${id}-res"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="#3f6f1f"/><path class="rck" d="M7 13.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div><b>${h(t.result.text)}</b>${(t.result.rows || []).slice(0, 3).map((r) => `<span>${h(r.label)}${r.value ? ` · ${h(r.value)}` : ''}</span>`).join('')}</div></div>`;
  }
  return `<div class="turn ans" id="${id}"><div class="dots" id="${id}-dots"><i></i><i></i><i></i></div>
    ${t.source ? `<div class="src" id="${id}-src">${h(t.source)}</div>` : ''}
    <div class="atx" id="${id}-tx">${h(t.text)}</div>${rows}${analytics}${approval}${result}</div>`;
}

export function build(args) {
  return page({ ...args, title: 'ui-story', ...parts(args) });
}

// Runs inside uiStory() (written only when the script has a shot scene): a screenshot covers the drawn UI inside the
// window; camera, cursor, click and highlight follow app-walkthrough's screen scenes, in image px inside #shcam.
// With `cued` (a shot of the script names a `cue` word) a cued shot starts as the voice says that word, and the
// shots between two known starts share the time evenly; without it every shot gets an even slot, as before. A cued
// shot too short for its highlight to fade in and out shows none (two tweens would overlap on #shhl).
const CUE_TIMES = `
    // A cued shot starts just before the voice says its word (after the previous shot's word); the rest share the gaps.
    const ws = words(sc.id), T = [];
    let from = 0;
    sc.shots.forEach((sh) => {
      const hit = sh.cue ? ws.findIndex((w, i) => i >= from && w.w.toLowerCase().replace(/[^a-z0-9]/g, '') === sh.cue) : -1;
      if (hit >= 0) from = hit + 1;
      T.push(hit >= 0 ? ws[hit].start - 0.3 : null);
    });
    if (T[0] === null || T[0] < s + 0.15) T[0] = s + 0.15;
    for (let k = 1; k < n; k++) {
      if (T[k] !== null) continue;
      let j = k; while (j < n && T[j] === null) j++;
      const tb = j < n ? T[j] : e, ta = T[k - 1];
      for (let m = k; m < j; m++) T[m] = ta + ((tb - ta) * (m - k + 1)) / (j - k + 1);
      k = j - 1;
    }
    // At least 1.2 s per shot, so a click and its highlight can play before the next shot comes in.
    for (let k = 1; k < n; k++) T[k] = Math.min(Math.max(T[k], T[k - 1] + 1.2), e - 1.2 * (n - k));`;
const shotJs = (cued) => `
  const SHOT_MOVE = { quick: 0.55, normal: 0.9, focus: 1.1 };
  let shotUp = false, shotLayer = null, shCur = { x: 960, y: 620 };
  const hideShots = (t) => {
    tl.to('#shots', { opacity: 0, duration: 0.3 }, t).set([shotLayer, '#shcursor', '#shhl'], { opacity: 0 }, t + 0.35);
    shotUp = false; shotLayer = null;
  };
  const shotScene = (sc, s, e, idx, last) => {
    liftCap(sc);
    const prev = idx > 0 ? D.scenes[idx - 1] : null;
    if (!prev || (prev.kind !== 'ui' && prev.kind !== 'shot')) tl.to('#app', { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.8 }, s - 0.2);
    else if (prev.zoom === 'assistant') tl.to('#app', { scale: 1, x: 0, y: 0, duration: 0.8, ease: XIO }, s + 0.15);
    const n = sc.shots.length, slot = (e - s - 0.15) / n, move = SHOT_MOVE[sc.pace] || SHOT_MOVE.normal;${cued ? CUE_TIMES : ''}
    sc.shots.forEach((sh, k) => {
      ${cued ? 'const t0 = T[k], slot = (k + 1 < n ? T[k + 1] : e) - t0, layer = $(sh.layer);' : 'const t0 = s + 0.15 + slot * k, layer = $(sh.layer);'}
      if (!shotUp) {
        tl.set(layer, { opacity: 1 }, t0).set('#shcam', { x: 0, y: 0, scale: 1 }, t0)
          .fromTo('#shots', { opacity: 0 }, { opacity: 1, duration: 0.35, immediateRender: false }, t0);
        shotUp = true;
      } else if (layer !== shotLayer) {
        tl.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.35, immediateRender: false }, t0).to(shotLayer, { opacity: 0, duration: 0.35 }, t0 + 0.1);
      }
      tl.to('#shcam', { x: sh.cam.x, y: sh.cam.y, scale: sh.cam.z, duration: move, ease: XIO }, t0);
      // A slow drift keeps a held shot alive; zooming about the image centre never shows a blank edge.
      const hold = slot - move;
      if (hold > 0.6 && sc.pace !== 'quick') {
        const z2 = sh.cam.z * 1.025;
        tl.to('#shcam', { scale: z2, x: sh.cam.x - (z2 - sh.cam.z) * 960, y: sh.cam.y - (z2 - sh.cam.z) * 540, duration: hold, ease: 'none' }, t0 + move);
      }
      if (sh.highlight${cued ? ' && slot > move * 0.7 + 0.8' : ''}) {
        const f = sh.focus, pad = 10;
        tl.set('#shhl', { left: f.x - pad, top: f.y - pad, width: f.w + pad * 2, height: f.h + pad * 2, borderWidth: 4 / sh.cam.z }, t0)
          .fromTo('#shhl', { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, t0 + move * 0.7)
          .to('#shhl', { opacity: 0, duration: 0.3 }, t0 + slot - 0.3);
      }
      if (sh.cursor) {
        const k1 = 1 / sh.cam.z, dur = Math.min(0.9, slot * 0.35);
        tl.set('#shcursor', { opacity: 1 }, t0 + 0.05)
          .fromTo('#shcursor', { x: shCur.x, y: shCur.y, scale: k1 }, { x: sh.cursor.x, y: sh.cursor.y, scale: k1, duration: dur, ease: XIO, immediateRender: false }, t0 + 0.1);
        shCur = { x: sh.cursor.x, y: sh.cursor.y };
        if (sh.click) {
          const tc = t0 + 0.2 + dur;
          tl.to('#shcursor', { scale: k1 * 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: 'none' }, tc)
            .fromTo('#shring', { left: sh.cursor.x, top: sh.cursor.y, scale: 0.3 * k1, opacity: 0.9 }, { scale: 1.4 * k1, opacity: 0, duration: 0.55, immediateRender: false }, tc);
        }
      } else {
        tl.to('#shcursor', { opacity: 0, duration: 0.2 }, t0);
      }
      shotLayer = layer;
    });
    if (last) return;
    const next = D.scenes[idx + 1].kind;
    if (next === 'ui' || next === 'shot') return;
    // A beat or another template's scene follows: the window leaves as it does after a ui scene (a cta fades it itself).
    if (next === 'beat' || foreign(idx + 1)) tl.to('#app', { opacity: 0, scale: 0.94, duration: 0.5, ease: XI }, e - 0.25);
    hideShots(e + 0.5);
  };`;

/** Kit page parts: the app window, the beat layer, one group per scene and the shared icon layer. */
export function parts({ brand, script, icons }) {
  const MK = iconSet(icons);
  const M = motionProfile(brand), lift = Math.round((M.push - 1) * 1000) / 1000;
  const app = script.app || {};
  const nav = (app.nav || []).slice(0, 10);
  const scenes = script.scenes.map((sc) => ({
    id: sc.id, kind: sc.kind, pace: sc.pace || 'normal', dark: sc.kind === 'title' || sc.kind === 'cta',
    layout: sc.layout || null, nav: sc.nav || null, page: sc.page || null, zoom: sc.zoom || 'none',
    icon: sc.icon ? MK[sc.icon] || null : null, check: !!sc.check, stat: !!sc.stat,
    modal: sc.layout === 'form' && !!sc.data?.modal,
    turns: (sc.assistant?.turns || []).map((t) => ({
      type: t.type, pick: Number.isInteger(t.pick) ? t.pick : null, text: t.type === 'user' ? String(t.text || '') : null,
      rows: (t.rows || []).length, analytics: !!t.analytics, bars: (t.analytics?.bars || []).length, kpis: (t.analytics?.kpis || []).length,
      approval: !!t.approval, facts: (t.approval?.facts || []).length, approve: !!t.approval?.approve, result: !!t.result, source: !!t.source,
    })),
    ...(sc.kind === 'shot' ? { shots: (sc.shots || []).map((sh, k) => ({
      layer: `shot-${sc.id}-${k}`, cam: camera(sh.focus, IMG), focus: sh.focus || null,
      cursor: sh.cursor || null, click: !!sh.click && !!sh.cursor, highlight: !!sh.highlight && !!sh.focus,
      ...(sh.cue ? { cue: String(sh.cue).toLowerCase().replace(/[^a-z0-9]/g, '') } : {}),
    })) } : {}),
  }));
  // Everything a shot scene adds to the page is written only when the script has one, so other pages stay byte for byte the same.
  const shotScenes = script.scenes.filter((s) => s.kind === 'shot');
  const hasShots = shotScenes.length > 0, hasCue = shotScenes.some((s) => (s.shots || []).some((sh) => sh.cue));
  const shotLayer = hasShots ? `
    <div id="shots"><div id="shview"><div id="shcam">${shotScenes.flatMap((s) => (s.shots || []).map((sh, k) =>
    `<img class="shimg" id="shot-${s.id}-${k}" src="${asset(sh.asset)}" alt="">`)).join('')}<div id="shhl"></div><div id="shring"></div>
      <svg id="shcursor" viewBox="0 0 34 44" aria-hidden="true"><path d="M3 2 L3 34 L11 26 L17 40 L23 37 L17 24 L29 24 Z" fill="#111" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg></div></div></div>` : '';
  const views = script.scenes.filter((s) => s.kind === 'ui' && s.layout && s.layout !== 'same').map((s) =>
    viewHtml(s)).join('\n');
  const beatScenes = script.scenes.filter((s) => s.kind === 'beat');
  const firstIcon = scenes.find((s) => s.icon)?.icon || MK.drop;
  const turns = script.scenes.filter((s) => s.assistant?.turns?.length).map((s) => s.assistant.turns.map((t, k) => turnHtml(s.id, k, t)).join('')).join('');
  const navHtml = nav.map((n, i) => `<div class="nv" id="nav-${i}" data-label="${h(n.label)}">${icon(n.icon)}<span>${h(n.label)}</span></div>`).join('');
  // Title and cta cards leave the logo to the kit's corner logo when the brand shows one.
  const logo = hasLogoBug(brand) ? '' : logoHtml(brand, { onDark: true, fallbackText: false });
  const lg = logo ? `<div class="lg">${logo}</div>` : '';
  // The kicker · title line that sat above the old subtitles of ui scenes (on beat scenes the beat layer hid it);
  // the js lifts it above the kit's subtitle pill.
  const cap = (s) => (s.kind === 'ui' || s.kind === 'shot' ? `<div class="ui-cap" data-lint>${h(s.kicker ? `${s.kicker} · ${s.title}` : s.title)}</div>` : '');
  const group = (s) => {
    // `logo: false` keeps the brand logo off a title card (e.g. a film that shows its logo only at the end).
    if (s.kind === 'title') return `<div class="sc full" id="g-${s.id}">${s.logo === false ? '' : lg}<div class="t" data-lint>${h(s.title)}</div>${s.subtitle ? `<div class="s" data-lint>${h(s.subtitle)}</div>` : ''}</div>`;
    if (s.kind === 'cta') return `<div class="sc full${s.icon ? ' withicon' : ''}" id="g-${s.id}">${lg}<div class="t" data-lint>${h(s.title)}</div><div class="b" data-lint>${h(s.button)}</div>${s.url ? `<div class="u" data-lint>${h(s.url)}</div>` : ''}</div>`;
    return `<div class="sc capg" id="g-${s.id}">${s.kind === 'ui' || s.kind === 'shot' ? '<div class="ui-band"></div>' : ''}${cap(s)}</div>`;
  };

  const css = `
#rail .logo{display:flex;align-items:center;gap:10px}.raillogo{height:28px;max-width:60px;object-fit:contain}
.full .lg .brandlogo{height:76px;max-width:520px;object-fit:contain;object-position:left center}
#stage{background:radial-gradient(1400px 900px at 50% 35%,#ffffff,var(--bg))}
#app{--line:#e6e8ec;--page:#f6f8fb;position:absolute;left:${APP.x + (brand.logoBug ? BUG_CLEAR : 0)}px;top:${APP.y}px;width:${APP.w}px;height:${APP.h + APP.bar}px;border-radius:16px;overflow:hidden;background:var(--page);
  box-shadow:0 40px 90px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.08);transform-origin:50% 50%}
#wbar{height:${APP.bar}px;background:#eef1f5;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #e1e5ea}
#wbar i{width:11px;height:11px;border-radius:50%}#wbar i:nth-child(1){background:#f26d5f}#wbar i:nth-child(2){background:#f5bd4f}#wbar i:nth-child(3){background:#5dc466}
#ui{position:absolute;left:0;top:${APP.bar}px;width:${APP.w}px;height:${APP.h}px}
#rail{position:absolute;left:0;top:0;bottom:0;width:${RAIL}px;background:var(--primary);color:#cbd5e1;padding:14px 12px}
#rail .logo{font-weight:800;color:#fff;font-size:19px;padding:8px 10px 18px}
.nv{position:relative;z-index:1;display:flex;align-items:center;gap:12px;height:42px;padding:0 12px;border-radius:9px;font-size:15.5px}
.nv.on{color:#fff}
#navhl{position:absolute;left:12px;width:${RAIL - 24}px;height:42px;border-radius:9px;background:rgba(255,255,255,.12);top:0}
.ic{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
#top{position:absolute;left:${RAIL}px;right:0;top:0;height:${TOP}px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 24px;gap:16px}
#top .pt{font-weight:600;font-size:17px;min-width:200px}
#top .sb{margin-left:auto;width:380px;height:38px;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;gap:8px;padding:0 12px;color:#94a3b8;font-size:14.5px}
#content{position:absolute;left:${RAIL}px;right:0;top:${TOP}px;bottom:0;overflow:hidden}
.view{position:absolute;inset:0;padding:22px 26px;opacity:0}
.ph h1{margin:0;font-size:25px;font-family:var(--display)}.ph p{margin:4px 0 14px;color:var(--muted);font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;height:148px;overflow:hidden}
.kl{font-size:14px;color:#334155}.kv{font-size:32px;font-weight:700;margin:4px 0 6px;font-variant-numeric:tabular-nums}
.spark path.sl{fill:none;stroke-width:2.4}.ringrow{display:flex;gap:12px;align-items:center}
.ringbg{fill:none;stroke:#eef1f5;stroke-width:9}.ringseg{fill:none;stroke-width:9}
.legend{font-size:12.5px;color:#334155;flex:1}.lg{display:flex;align-items:center;gap:6px}.lg i{width:8px;height:8px;border-radius:50%}.lg b{margin-left:auto}
.cols{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-top:14px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.ch{font-weight:600;font-size:15.5px;padding:14px 18px;border-bottom:1px solid var(--line)}
.qrow{display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid #f0f2f5}
.chip,.badge{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.qt{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13.5px}.qt b{font-size:14.5px}.qt span{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;height:34px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#2563eb;font-weight:600;font-size:14px;white-space:nowrap}
.btn.sm{height:30px;padding:0 11px;font-size:13px}.btn.pri{background:#2563eb;color:#fff;border-color:#2563eb}
.srow{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid #f0f2f5;font-size:14px}
.srow .sub{display:block;color:var(--muted);font-size:13px}.lnk{color:#2563eb;font-weight:500}
.filters{display:flex;gap:10px;margin-bottom:14px}
.filters span{height:38px;border:1px solid var(--line);background:#fff;border-radius:9px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:14px;color:#64748b}
.filters .search{width:360px}
.tbl table{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{text-align:left;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:11px 14px;border-bottom:1px solid var(--line);background:#fafbfc}
.tbl td{padding:12px 14px;border-bottom:1px solid #f0f2f5;white-space:nowrap}
.tf{padding:12px 16px;color:var(--muted);font-size:13px}
#panel{position:absolute;top:0;right:0;bottom:0;width:${PANEL}px;background:#fff;border-left:1px solid var(--line);box-shadow:-24px 0 50px rgba(15,23,42,.12);z-index:4;transform:translateX(${PANEL + 40}px)}
#panel .phd{height:${TOP}px;display:flex;align-items:center;gap:10px;padding:0 20px;border-bottom:1px solid var(--line);font-weight:700;font-size:17px}
#panel .phd span{font-weight:400;color:var(--muted);font-size:14px}
#logwrap{position:absolute;left:0;right:0;top:${TOP}px;bottom:96px;overflow:hidden}
#log{position:absolute;left:0;right:0;top:0;padding:16px 20px;display:flex;flex-direction:column;gap:14px}
#composer{position:absolute;left:16px;right:16px;bottom:16px;height:66px;border:1.5px solid #c7d2fe;border-radius:12px;padding:12px 14px;font-size:15px;color:#94a3b8}
#composer .typed{color:var(--ink)}#composer .send{position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:8px;background:#2563eb;opacity:.45}
.turn{opacity:0}
.sugg .sh{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;gap:6px;align-items:center;margin-bottom:8px}
.sg{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:14.5px;margin-top:8px}
.user{display:flex;justify-content:flex-end}.bub{background:#2563eb;color:#fff;border-radius:16px 16px 4px 16px;padding:10px 15px;font-size:15px;max-width:380px}
.dots{display:flex;gap:5px;height:16px;align-items:center}.dots i{width:7px;height:7px;border-radius:50%;background:#94a3b8}
.src{font-size:12.5px;color:var(--muted);background:#f6f8fb;border-radius:8px;padding:6px 10px;margin-bottom:8px}
.atx{font-size:15px;line-height:1.5}
.arow{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-top:8px;font-size:14px}
.arow b{display:block;font-weight:600}.arow span{color:var(--muted);font-size:13px}
.acard{border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:10px}
.at{font-weight:600;font-size:14px;margin-bottom:8px}.akg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ak{border:1px solid var(--line);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;font-size:12.5px;color:var(--muted)}
.ak b{font-size:20px;color:var(--ink);font-variant-numeric:tabular-nums}.ak i,.abl i{font-style:normal;font-size:12px}.up{color:#3f6f1f}.dn{color:#b8002a}
.aline{display:block;margin:10px 0 4px}.aline .sl{fill:none;stroke:#2563eb;stroke-width:2.4}.aline .sa{fill:#2563eb;opacity:.1}
.ab{margin-top:8px;font-size:13px}.abl{display:flex;justify-content:space-between}.abt{height:6px;background:#eef1f5;border-radius:3px;margin-top:4px;overflow:hidden}.abt i{display:block;height:100%;background:#2563eb;border-radius:3px;width:0}
.apcard{border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:10px}
.apt{font-weight:700;font-size:15.5px;margin-bottom:6px}
.apf{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid #f0f2f5;font-size:14px}.apf span{color:var(--muted);font-size:12.5px}
.apn{background:#fdf6e7;color:#8a4f00;border-radius:8px;padding:8px 10px;margin:10px 0;font-size:14px}
.apb{display:flex;gap:10px;align-items:center}.exp{margin-left:auto;color:var(--muted);font-size:13px}
.rescard{display:flex;gap:12px;align-items:flex-start;border:1px solid #cfe3bf;background:#f3f9ee;border-radius:12px;padding:12px 14px;margin-top:10px;font-size:14px;opacity:0}
.rescard span{display:block;color:var(--muted);margin-top:2px}
#cursor{position:absolute;left:0;top:0;width:30px;height:40px;z-index:20;opacity:0;filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))}
#ring{position:absolute;left:0;top:0;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;border:4px solid #2563eb;opacity:0;z-index:19}
.capg{z-index:11}
.ui-band{position:absolute;left:0;right:0;bottom:0;height:${BAND}px;background:linear-gradient(to bottom,rgba(255,255,255,0),var(--bg) 30%)}
.ui-cap{position:absolute;left:240px;right:240px;bottom:${CAP_BOTTOM}px;text-align:center;font-size:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--primary2)}
.full{position:absolute;inset:0;background:var(--primary);color:var(--on);display:flex;flex-direction:column;justify-content:center;padding:0 180px;gap:26px;z-index:9}
.full .t{font-family:var(--display);font-weight:800;font-size:128px;line-height:1;letter-spacing:-.03em}
.full .s{font-size:42px;opacity:.85}
.full .b{align-self:flex-start;background:var(--secondary);color:var(--ink);font-weight:800;font-size:44px;padding:26px 52px;border-radius:999px}
.full .u{font-size:32px;opacity:.8}
.dh{display:flex;align-items:center;gap:16px;margin-bottom:16px}.dh p{margin:4px 0 0}
.av{width:56px;height:56px;border-radius:50%;background:#e8efff;color:#2563eb;display:grid;place-items:center;font-weight:700;font-size:20px;flex:none}
.dt{flex:1;min-width:0}.badge.big{font-size:14px;padding:5px 14px}
.acts{display:flex;gap:8px}
.dcards{display:grid;gap:14px}.dc{padding-bottom:6px}
.kvr{display:flex;justify-content:space-between;gap:12px;padding:9px 18px;font-size:14px;border-bottom:1px solid #f4f5f7}.kvr span{color:var(--muted)}.kvr b{font-weight:600;text-align:right}
.dtl{margin-top:14px}
.toast{position:absolute;right:26px;top:18px;display:flex;align-items:center;gap:10px;background:#0f172a;color:#fff;border-radius:10px;padding:12px 18px;font-size:15px;box-shadow:0 14px 30px rgba(15,23,42,.3);opacity:0;z-index:6}
.toast b{width:22px;height:22px;border-radius:50%;background:#3f6f1f;display:grid;place-items:center;font-size:13px}
.fgrid{display:grid;grid-template-columns:1fr 330px;gap:14px}.fmain{display:flex;flex-direction:column;gap:14px;min-width:0}
.fields{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;padding:14px 18px}
.fld{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted)}.fside .fld{padding:6px 18px 12px}
.inp{height:38px;border:1px solid #d5d9e0;border-radius:8px;display:flex;align-items:center;padding:0 12px;font-size:14.5px;color:var(--ink);background:#fff;position:relative;overflow:hidden;white-space:nowrap}
.inp .phd2,.psearch .phd2{color:#a0aab8}
.psearch{margin:14px 18px 0;height:40px;border:1px solid #d5d9e0;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:14.5px;color:var(--ink)}
.pdrop{margin:6px 18px 0;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 26px rgba(15,23,42,.12);background:#fff;opacity:0;overflow:hidden}
.pitem{padding:10px 14px;display:flex;flex-direction:column;font-size:14px}.pitem span{color:var(--muted);font-size:13px}
.ltab{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px}.ltab th{text-align:left;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:10px 18px;border-bottom:1px solid var(--line)}
.ltab td{padding:11px 18px;border-bottom:1px solid #f0f2f5;white-space:nowrap}.newline{opacity:0}
.fside{align-self:start;padding-bottom:16px}.tot{display:flex;justify-content:space-between;padding:10px 18px;font-size:14.5px}.tot span{color:var(--muted)}
.tot.grand{border-top:1px solid var(--line);margin-top:4px;font-size:17px;font-weight:700}.tot.grand span{color:var(--ink)}
.btn.wide{display:flex;justify-content:center;margin:10px 18px 0;height:42px;font-size:15px}
.modalview .modalbg{position:absolute;inset:0;background:rgba(15,23,42,.45)}
.modal{position:absolute;left:50%;top:50%;width:760px;margin-left:-380px;margin-top:-210px;background:#fff;border-radius:14px;box-shadow:0 30px 70px rgba(15,23,42,.35);overflow:hidden}
.modal .mh{display:flex;justify-content:space-between;padding:16px 20px;font-weight:700;font-size:18px;border-bottom:1px solid var(--line)}.modal .mh span{color:var(--muted)}
.modal .card{border:0;border-radius:0}.modal .mf{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--line)}.modal .btn.wide{margin:0;width:200px}
#beat{position:absolute;inset:0;z-index:8;opacity:0;background:radial-gradient(1200px 800px at 30% 45%,#ffffff,var(--bg))}
#iconlayer{position:absolute;inset:0;z-index:10;opacity:0;pointer-events:none}
#bicon{position:absolute;left:270px;top:240px;width:440px;height:493px;overflow:visible;transform-origin:50% 50%}
#bshape{fill:none;stroke:var(--primary);stroke-width:4;stroke-linejoin:round}#bfill{fill:var(--secondary)}
#btick{fill:none;stroke:#fff;stroke-width:8;stroke-linecap:round;stroke-linejoin:round}
.btx{position:absolute;left:880px;top:330px;width:860px;opacity:0}
.bk{font-size:24px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--primary2);margin-bottom:14px}
.bh{font-family:var(--display);font-weight:800;font-size:76px;line-height:1.05;letter-spacing:-.02em;color:var(--ink)}
.bn{font-family:var(--display);font-weight:800;font-size:150px;line-height:1;color:var(--primary2);margin-top:18px;font-variant-numeric:tabular-nums}.bn small{font-size:56px;margin-left:10px}
.bs{font-size:32px;color:var(--muted);margin-top:18px;max-width:780px}
.bdecor{position:absolute;left:140px;top:250px;width:700px;height:482px;overflow:visible}.bdecor path{fill:none;stroke:var(--primary2);stroke-width:6;stroke-linecap:round}
.full.withicon{padding-left:880px}
${hasShots ? `#shots{position:absolute;left:0;top:${APP.bar}px;width:${APP.w}px;height:${APP.h}px;overflow:hidden;z-index:21;opacity:0;background:var(--page)}
#shview{position:absolute;left:0;top:0;width:${IMG.width}px;height:${IMG.height}px;transform:scale(${SHOT_BASE});transform-origin:0 0}
#shcam{position:absolute;left:0;top:0;width:${IMG.width}px;height:${IMG.height}px;transform-origin:0 0}
.shimg{position:absolute;left:0;top:0;width:${IMG.width}px;height:${IMG.height}px;opacity:0}
#shhl{position:absolute;border:4px solid var(--primary2);border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.32);opacity:0;pointer-events:none}
#shring{position:absolute;left:0;top:0;width:${SHOT_RING}px;height:${SHOT_RING}px;margin:-${SHOT_RING / 2}px 0 0 -${SHOT_RING / 2}px;border-radius:50%;border:5px solid #2563eb;opacity:0}
#shcursor{position:absolute;left:0;top:0;width:${SHOT_CURSOR.w}px;height:${SHOT_CURSOR.h}px;opacity:0;transform-origin:0 0;filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))}
` : ''}`;

  const body = `
  <div id="app">
    <div id="wbar"><i></i><i></i><i></i></div>
    <div id="ui">
      <div id="rail"><div class="logo">${logoHtml(brand, { onDark: true, cls: 'raillogo', fallbackText: false })}<span>${h(app.name || brand.name)}</span></div><div id="navbox" style="position:relative"><div id="navhl"></div>${navHtml}</div></div>
      <div id="top"><span class="pt" id="ptitle"></span><span class="sb">${icon('search', 16)}${h(app.search || 'Search')}</span></div>
      <div id="content">${views}</div>
      <div id="panel"><div class="phd">Assistant <span>All customers</span></div>
        <div id="logwrap"><div id="log">${turns}</div></div>
        <div id="composer"><span class="typed" id="typed"></span><span id="ph">Ask anything about this console…</span><i class="send"></i></div></div>
    </div>
    <div id="ring"></div>
    <svg id="cursor" viewBox="0 0 34 44" aria-hidden="true"><path d="M3 2 L3 34 L11 26 L17 40 L23 37 L17 24 L29 24 Z" fill="#111" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>${shotLayer}
  </div>
  <div id="beat">${beatScenes.map(beatHtml).join('')}</div>
  ${script.scenes.map(group).join('\n  ')}
  <div id="iconlayer"><svg id="bicon" viewBox="0 0 100 112" aria-hidden="true"><path id="bshape" d="${firstIcon}"/><path id="bfill" d="${firstIcon}"/><path id="btick" d="${TICK}"/></svg></div>`;

  // Runs inside the kit script, which already defines D, $, tl, fmt, X, XI, XIO and build().
  const js = `
const uiFmt = (v, f) => (f === 'pct' ? v.toFixed(2) + '%' : fmt(v, f === 'money' ? f : 'int'));
function posIn(el, rootId) { let x = 0, y = 0; for (let n = el; n && n.id !== rootId; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; }
function uiCount(el, at, dur) {
  const target = +el.dataset.count, f = el.dataset.format, o = { v: 0 };
  tl.to(o, { v: target, duration: dur, ease: 'power2.out', onUpdate: () => { el.textContent = uiFmt(o.v, f); } }, at);
}
// A neighbour scene from another template (mixed page) carries a namespaced kind.
const foreign = (i) => !!D.scenes[i] && D.scenes[i].kind.includes('.');
const liftCap = (sc) => {
  const cap = $('g-' + sc.id).querySelector('.ui-cap'), sub = $('sub-' + sc.id)${M.caps === 'lines' ? LINES_SUB : ''};
  if (cap && sub) cap.style.bottom = (D.H - sub.offsetTop + ${CAP_GAP}${lift > 0 ? PUSH_LIFT(lift) : ''}) + 'px';
};

// The state and DOM reads start with the first scene, inside the kit's build() (fonts and layout ready).
let uiScene = null;
const KINDS = Object.fromEntries(['title', 'ui', 'beat', 'cta'${hasShots ? ", 'shot'" : ''}].map((k) => [k, (...a) => (uiScene ||= uiStory())(...a)]));

function uiStory() {
  let cur = { x: 760, y: 520 };
  let curVisible = false;
  let navIdx = -1;
  let shown = [];
  let panelOpen = false;
  let iconShown = false;
  gsap.set('#bshape', { drawSVG: '0%' });
  gsap.set('#bfill', { opacity: 0 });
  gsap.set('#btick', { drawSVG: '0%', opacity: 0 });
  gsap.set('.bdecor path', { drawSVG: '0%' });
  const typeInto = (box, at, dur) => {
    const val = box.querySelector('.val'), ph = box.querySelector('.phd2');
    tl.to(box, { borderColor: '#2563eb', boxShadow: '0 0 0 3px rgba(37,99,235,.15)', duration: 0.15 }, at);
    if (ph) tl.set(ph, { display: 'none' }, at);
    tl.to(val, { text: val.dataset.value, duration: dur, ease: 'none' }, at + 0.05);
    tl.to(box, { borderColor: '#d5d9e0', boxShadow: '0 0 0 0px rgba(37,99,235,0)', duration: 0.2 }, at + dur + 0.1);
  };
  const showIcon = (path, at) => {
    if (!iconShown) {
      tl.set(['#bshape', '#bfill'], { attr: { d: path } }, at - 0.05)
        .fromTo('#bshape', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.1, immediateRender: false }, at)
        .set('#bshape', { strokeDasharray: 'none' }, at + 1.2)
        .fromTo('#bfill', { opacity: 0 }, { opacity: 1, duration: 0.5, immediateRender: false }, at + 0.7);
      iconShown = true;
    } else {
      tl.to(['#bshape', '#bfill'], { morphSVG: path, duration: 0.9, ease: XIO }, at - 0.1);
    }
    tl.fromTo('#bicon', { scale: 0.9 }, { scale: 1, duration: 0.8, immediateRender: false }, at);
  };
  let logY = 0;
  const logH = $('logwrap').offsetHeight;
  const navTop = (i) => $('nav-' + i).offsetTop;
  gsap.set('#app', { opacity: 0, scale: 0.95, y: 24 });

  let hideAt = null;
  const moveCursor = (target, at, dur = 0.6, click = true) => {
    if (!curVisible || (hideAt !== null && hideAt <= at)) { tl.fromTo('#cursor', { opacity: 0, x: cur.x, y: cur.y }, { opacity: 1, duration: 0.15, immediateRender: false }, at); curVisible = true; }
    tl.to('#cursor', { x: target.x, y: target.y, duration: dur, ease: XIO }, at);
    cur = target;
    if (click) {
      tl.to('#cursor', { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: '0 0' }, at + dur)
        .fromTo('#ring', { x: target.x, y: target.y, scale: 0.3, opacity: 0.9 }, { scale: 1.3, opacity: 0, duration: 0.5, immediateRender: false }, at + dur);
    }
    hideAt = at + dur + 0.9;
    tl.to('#cursor', { opacity: 0, duration: 0.3 }, hideAt);
    return at + dur + (click ? 0.2 : 0);
  };
  const centerOf = (el, inLog = false) => { const p = posIn(el, 'app'); return { x: p.x + Math.min(p.w * 0.45, 60), y: p.y + p.h / 2 + (inLog ? logY : 0) }; };
  const scrollTo = (el, at) => {
    const bottom = el.offsetTop + el.offsetHeight + 16;
    const want = Math.min(0, logH - bottom);
    if (want < logY) { tl.to('#log', { y: want, duration: 0.45, ease: XIO }, at); logY = want; }
  };${hasShots ? shotJs(hasCue) : ''}

  return (sc, s, e, { last, i: idx, g }) => {
    if (sc.kind === 'ui') liftCap(sc);
    if (sc.kind === 'title' || sc.kind === 'cta') {
      if (sc.kind === 'cta') tl.to('#app', { opacity: 0, scale: 0.92, duration: 0.6, ease: XI }, s - 0.2);
      if (sc.kind === 'cta' && idx > 0 && D.scenes[idx - 1].kind === 'beat') tl.to('#beat', { opacity: 0, duration: 0.4 }, s);
      if (sc.kind === 'cta' && sc.icon) {
        tl.to('#iconlayer', { opacity: 1, duration: 0.3 }, s - 0.1);
        tl.to('#btick', { opacity: 0, duration: 0.2 }, s - 0.1);
        showIcon(sc.icon, s + 0.1);
        tl.to('#bshape', { stroke: '#ffffff', duration: 0.5 }, s);
      }
      tl.fromTo(g.children, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.18 }, s + 0.15);
      return;
    }
    if (sc.kind === 'beat') {
      const prevKind = idx > 0 ? D.scenes[idx - 1].kind : null;
      const nextKind = last ? null : D.scenes[idx + 1].kind;
      if (prevKind === 'ui') tl.to('#app', { opacity: 0, scale: 0.94, duration: 0.5, ease: XI }, s - 0.25);
      if (prevKind !== 'beat') {
        tl.fromTo('#beat', { opacity: 0 }, { opacity: 1, duration: 0.45, immediateRender: false }, s - 0.2)
          .fromTo('#iconlayer', { opacity: 0 }, { opacity: 1, duration: 0.4, immediateRender: false }, s + 0.1);
      }
      if (sc.icon) showIcon(sc.icon, prevKind === 'beat' ? s : s + 0.2);
      const bt = $('bt-' + sc.id);
      tl.fromTo(bt, { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, s + 0.15)
        .fromTo(bt.children, { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.15 }, s + 0.15);
      const n = bt.querySelector('.bn span');
      if (n) uiCount(n, s + 0.4, 1.4);
      const paths = $('bd-' + sc.id).querySelectorAll('path');
      if (paths.length) tl.fromTo(paths, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.1, stagger: 0.15, immediateRender: false }, s + 0.3);
      if (sc.check) tl.set('#btick', { opacity: 1 }, s + 0.9).fromTo('#btick', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6, immediateRender: false }, s + 0.9);
      if (!last) {
        tl.to(bt, { opacity: 0, y: -16, duration: 0.3, ease: XI }, e - 0.35);
        if (paths.length) tl.to(paths, { drawSVG: '100% 100%', duration: 0.4, ease: XI }, e - 0.4);
        if (sc.check) tl.to('#btick', { opacity: 0, duration: 0.25 }, e - 0.35);
      }
      if (nextKind !== 'beat' && nextKind !== 'cta') {
        tl.to('#beat', { opacity: 0, duration: 0.4, ease: XI }, e - 0.3).to('#iconlayer', { opacity: 0, duration: 0.3 }, e - 0.3);
      }
      return;
    }
${hasShots ? "    if (sc.kind === 'shot') return shotScene(sc, s, e, idx, last);\n" : ''}    // ---------- ui scene: schedule beats one after another ----------
    const beats = [];
    const add = (d, fn) => beats.push({ d, fn });${hasShots ? `
    // After a shot the screenshot leaves as this scene's view comes in, or at once when the view stays.
    const fromShot = shotUp;
    if (fromShot && !(sc.layout && sc.layout !== 'same')) add(0.01, (t) => hideShots(t));` : ''}
    if (idx > 0 && D.scenes[idx - 1].kind !== 'ui') add(0.01, (t) => tl.to('#app', { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.8 }, t - 0.35));
    const ni = sc.nav ? D.navLabels.indexOf(sc.nav) : -1;
    if (ni >= 0 && ni !== navIdx) {
      const first = navIdx < 0;
      add(first ? 0.2 : 0.85, (t, k) => {
        let tt = t;
        if (!first) tt = moveCursor(centerOf($('nav-' + ni)), t, 0.55 * k);
        tl.to('#navhl', { y: navTop(ni), duration: first ? 0.01 : 0.35, ease: XIO }, tt - 0.1);
        if (navIdx >= 0) tl.set('#nav-' + navIdx, { attr: { class: 'nv' } }, tt);
        tl.set('#nav-' + ni, { attr: { class: 'nv on' } }, tt);
      });
      navIdx = ni;
    }
    if (sc.page) add(0.01, (t) => tl.to('#ptitle', { text: sc.page, duration: 0.01 }, t));
    if (sc.layout && sc.layout !== 'same') {
      const v = $('v-' + sc.id);
      const hide = sc.modal ? [] : shown.slice();
      shown = sc.modal ? [...shown, v] : [v];
      add(sc.pace === 'quick' ? 0.9 : 1.6, (t, k) => {
        if (hide.length) tl.to(hide, { opacity: 0, duration: 0.3 }, t);${hasShots ? '\n        if (fromShot) hideShots(t);' : ''}
        tl.fromTo(v, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, t);
        const head = v.querySelector('.ph');
        if (head) tl.fromTo(head, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, t + 0.05);
        if (sc.modal) {
          tl.fromTo(v.querySelector('.modalbg'), { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, t)
            .fromTo(v.querySelector('.modal'), { y: 30, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.45, immediateRender: false }, t + 0.1);
        } else if (v.dataset.layout === 'detail') {
          tl.fromTo(v.querySelectorAll('.acts .btn'), { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.06 }, t + 0.2);
          tl.fromTo(v.querySelectorAll('.card'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08 * k }, t + 0.25);
          tl.fromTo(v.querySelectorAll('.kvr, .dtl tbody tr'), { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.025 }, t + 0.45);
        } else if (v.dataset.layout === 'form') {
          tl.fromTo(v.querySelectorAll('.card'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08 * k }, t + 0.2);
          v.querySelectorAll('.tot b').forEach((b) => tl.set(b, { textContent: uiFmt(+b.dataset.from, b.dataset.format) }, t));
        } else if (v.dataset.layout === 'dashboard') {
          const kp = [...v.querySelectorAll('.kpi')];
          tl.fromTo(kp, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.08 * k }, t + 0.15);
          v.querySelectorAll('.kv').forEach((el, i) => uiCount(el, t + 0.25 + i * 0.08, 1.1 * k));
          v.querySelectorAll('.spark .sl').forEach((p, i) => tl.fromTo(p, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.9 * k, ease: 'power2.out', immediateRender: false }, t + 0.35 + i * 0.08));
          v.querySelectorAll('.spark .sa, .spark .sd').forEach((p) => tl.fromTo(p, { opacity: 0 }, { opacity: p.classList.contains('sa') ? 0.12 : 1, duration: 0.4, immediateRender: false }, t + 1.0 * k));
          v.querySelectorAll('.ringseg').forEach((p, i) => tl.fromTo(p, { drawSVG: '0% 0%' }, { drawSVG: (p.dataset.from * 100) + '% ' + (p.dataset.to * 100) + '%', duration: 0.8 * k, immediateRender: false }, t + 0.35 + i * 0.15));
          tl.fromTo(v.querySelectorAll('.card'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.1 }, t + 0.4 * k);
          tl.fromTo(v.querySelectorAll('.qrow'), { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, stagger: 0.09 * k }, t + 0.6 * k);
          tl.fromTo(v.querySelectorAll('.srow'), { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.06 * k }, t + 0.7 * k);
        } else {
          tl.fromTo(v.querySelectorAll('.filters span'), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.05 }, t + 0.1);
          tl.fromTo(v.querySelector('.card'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, t + 0.15);
          tl.fromTo(v.querySelectorAll('tbody tr'), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, stagger: 0.045 }, t + 0.25);
        }
      });
    }
    if (sc.layout === 'detail' || sc.layout === 'form') {
      const v = $('v-' + sc.id);
      if (sc.layout === 'detail' && v.dataset.click !== undefined) {
        add(1.4, (t) => {
          const btn = $(sc.id + '-a' + v.dataset.click);
          const tt = moveCursor(centerOf(btn), t, 0.6);
          tl.to(btn, { scale: 0.94, duration: 0.08, yoyo: true, repeat: 1 }, tt - 0.2);
          const badge = $(sc.id + '-badge');
          if (badge && v.dataset.nb) tl.to(badge, { text: v.dataset.nb, color: v.dataset.nfg, backgroundColor: v.dataset.nbg, duration: 0.3 }, tt);
          const toast = $(sc.id + '-toast');
          if (toast) tl.fromTo(toast, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, immediateRender: false }, tt + 0.15);
        });
      }
      if (sc.layout === 'form') {
        v.querySelectorAll('.fields .inp').forEach((box) => {
          const len = (box.querySelector('.val').dataset.value || '').length;
          const d = Math.min(0.9, Math.max(0.3, len / 30));
          add(d + 0.15, (t, k) => typeInto(box, t, d * k));
        });
        const search = $(sc.id + '-search');
        if (search) {
          const q = (search.querySelector('.val').dataset.value || '').length;
          add(Math.max(0.5, q / 14) + 0.2, (t, k) => typeInto(search, t, Math.max(0.5, q / 14) * k));
          add(0.35, (t) => tl.fromTo($(sc.id + '-drop'), { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.25, immediateRender: false }, t));
          add(1.1, (t) => {
            const tt = moveCursor(centerOf($(sc.id + '-pick')), t, 0.55);
            tl.to($(sc.id + '-drop'), { opacity: 0, duration: 0.2 }, tt);
            const nl = $(sc.id + '-newline');
            if (nl) tl.fromTo(nl, { opacity: 0, backgroundColor: '#e8efff' }, { opacity: 1, backgroundColor: 'rgba(232,239,255,0)', duration: 0.9, immediateRender: false }, tt + 0.05);
            v.querySelectorAll('.tot b').forEach((b) => {
              const o = { v: +b.dataset.from };
              tl.to(o, { v: +b.dataset.count, duration: 0.7, ease: 'power2.out', onUpdate: () => { b.textContent = uiFmt(o.v, b.dataset.format); } }, tt + 0.1);
            });
          });
        }
        const reason = $(sc.id + '-reason');
        if (reason) add(0.9, (t, k) => typeInto(reason, t, 0.7 * k));
        const submit = $(sc.id + '-submit');
        if (submit) {
          add(1.3, (t) => {
            const tt = moveCursor(centerOf(submit), t, 0.6);
            tl.to(submit, { scale: 0.95, duration: 0.08, yoyo: true, repeat: 1 }, tt - 0.2).to(submit, { text: submit.dataset.busy, duration: 0.01 }, tt);
            const toast = $(sc.id + '-toast');
            if (toast) tl.fromTo(toast, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, immediateRender: false }, tt + 0.25);
          });
        }
      }
    }
    if (sc.turns.length && !panelOpen) {
      add(1.0, (t) => {
        const ai = D.navLabels.indexOf('Assistant');
        let tt = t;
        if (ai >= 0) { tt = moveCursor(centerOf($('nav-' + ai)), t, 0.55); if (navIdx >= 0) tl.set('#nav-' + navIdx, { attr: { class: 'nv' } }, tt); tl.set('#nav-' + ai, { attr: { class: 'nv on' } }, tt); tl.to('#navhl', { y: navTop(ai), duration: 0.35, ease: XIO }, tt - 0.1); navIdx = ai; }
        tl.to('#panel', { x: 0, duration: 0.55, ease: X }, tt);
      });
      panelOpen = true;
    }
    if (!sc.turns.length && panelOpen && sc.layout !== 'same') {
      add(0.4, (t) => tl.to('#panel', { x: ${PANEL + 40}, duration: 0.4, ease: XI }, t));
      panelOpen = false;
    }
    if (sc.zoom === 'assistant') add(0.01, (t) => tl.to('#app', { scale: 1.16, x: -150, y: 8, duration: 0.9, ease: XIO }, t));
    else if (idx > 0 && D.scenes[idx - 1].zoom === 'assistant') add(0.01, (t) => tl.to('#app', { scale: 1, x: 0, y: 0, duration: 0.8, ease: XIO }, t));

    sc.turns.forEach((tn, k) => {
      const el = $(sc.id + '-t' + k);
      if (tn.type === 'suggestions') {
        add(0.6, (t) => { tl.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 }, t); tl.fromTo(el.querySelectorAll('.sg'), { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.08 }, t + 0.1); scrollTo(el, t); });
        if (tn.pick !== null && $(sc.id + '-t' + k + '-i' + tn.pick)) add(0.8, (t) => { const b = $(sc.id + '-t' + k + '-i' + tn.pick); const tt = moveCursor(centerOf(b, true), t, 0.55); tl.to(b, { backgroundColor: '#e8efff', borderColor: '#93b4f8', duration: 0.15 }, tt - 0.2); });
      } else if (tn.type === 'user') {
        const typed = Math.min(1.8, Math.max(0.5, tn.text.length / 26));
        add(typed + 0.35, (t, kk) => {
          tl.set('#ph', { opacity: 0 }, t).to('#typed', { text: tn.text, duration: typed * kk, ease: 'none' }, t)
            .set('#typed', { text: '' }, t + typed * kk + 0.2).set('#ph', { opacity: 1 }, t + typed * kk + 0.2)
            .fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3 }, t + typed * kk + 0.2);
          scrollTo(el, t + typed * kk + 0.2);
        });
      } else {
        add(0.55, (t) => { tl.set(el, { opacity: 1 }, t).fromTo($(el.id + '-dots').children, { opacity: 0.25 }, { opacity: 1, duration: 0.18, stagger: 0.1, yoyo: true, repeat: 1 }, t); scrollTo($(el.id + '-dots'), t); });
        add(0.75, (t) => {
          tl.set($(el.id + '-dots'), { display: 'none' }, t);
          if (tn.source) tl.fromTo($(el.id + '-src'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, t);
          tl.fromTo($(el.id + '-tx'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45 }, t + 0.05);
        });
        for (let r = 0; r < tn.rows; r++) add(0.22, (t) => { const row = $(el.id + '-r' + r); tl.fromTo(row, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: 0.3 }, t); scrollTo(row, t); });
        if (tn.analytics) {
          add(1.9, (t, kk) => {
            const an = $(el.id + '-an');
            tl.fromTo(an, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4 }, t);
            scrollTo(an, t);
            an.querySelectorAll('.ak').forEach((a, i) => { tl.fromTo(a, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.3 }, t + 0.15 + i * 0.07); uiCount(a.querySelector('b'), t + 0.2 + i * 0.07, 0.9 * kk); });
            tl.fromTo(an.querySelector('.aline .sl'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0 * kk, ease: 'power2.inOut', immediateRender: false }, t + 0.5);
            tl.fromTo(an.querySelector('.aline .sa'), { opacity: 0 }, { opacity: 0.1, duration: 0.5, immediateRender: false }, t + 1.2 * kk);
            an.querySelectorAll('.abt i').forEach((b, i) => tl.fromTo(b, { width: '0%' }, { width: (b.dataset.frac * 100) + '%', duration: 0.6, immediateRender: false }, t + 0.9 * kk + i * 0.1));
          });
        }
        if (tn.approval) {
          add(1.1, (t) => {
            const ap = $(el.id + '-ap');
            tl.fromTo(ap, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4 }, t);
            tl.fromTo(ap.querySelectorAll('.apf, .apn, .apb'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.1 }, t + 0.15);
            scrollTo(ap, t);
          });
          if (tn.approve) {
            add(1.0, (t) => {
              const btn = $(el.id + '-approve');
              const tt = moveCursor(centerOf(btn, true), t, 0.6);
              tl.to(btn, { scale: 0.94, duration: 0.08, yoyo: true, repeat: 1 }, tt - 0.2).to(btn, { text: 'Approving…', duration: 0.01 }, tt);
            });
          }
        }
        if (tn.result) {
          add(0.9, (t) => {
            const r = $(el.id + '-res');
            if (tn.approval) tl.to($(el.id + '-ap'), { opacity: 0.45, duration: 0.3 }, t);
            tl.fromTo(r, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4 }, t + 0.1)
              .fromTo(r.querySelector('.rck'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.45, immediateRender: false }, t + 0.35);
            scrollTo(r, t + 0.1);
          });
        }
      }
    });

    // Fit the beats into the scene: compress when long, leave a hold at the end when short.
    // Leave the last 0.6 s for the result (toast, answer) to be seen before the cut.
    const avail = Math.max(0.5, e - s - 0.95);
    const total = beats.reduce((a, b) => a + b.d, 0);
    const k = total > avail ? avail / total : 1;
    let t = s + 0.15;
    beats.forEach((b) => { b.fn(t, k); t += b.d * k; });
    if (foreign(idx + 1)) tl.to('#app', { opacity: 0, scale: 0.94, duration: 0.5, ease: XI }, e - 0.25);
  };
}`;

  // Lead-owned subtitle style: the compact line under the app window, ink words on the light page.
  const subs = { size: 30, weight: 600, side: 240, bottom: SUB_BOTTOM, pill: false, color: '#cbd5e1', lit: brand.colors?.ink };
  // The redrawn app window is one surface: its labels stay put under a parallax brand (the camera still drifts).
  return { css, body, scenes, js, extra: { navLabels: nav.map((n) => n.label) }, particles: false, subs, ...(M.layers ? { layers: false } : {}) };
}
