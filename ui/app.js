import { SHOT_RE, bulletShot, shotField, shotAction, applyShot, assetKind, assetPick, uploadProblem, parseNum, parseSay, sayText, paletteProblems, guessFont, MOTION_OPTIONS, motionOpt, insertClip, CUT_OPTIONS, CAMERA_OPTIONS, SCENE_GRADE_OPTIONS } from './shots.js';
import { mountAssistant } from './assistant.js';
import { mountSettings } from './settings.js';
import { HOLD_MAX, HOLD_STEP, CUE_LEAD, roundHold, fmtSec, sceneSpans, totalOf, moveItem, dropIndex, cueWord, snapWord, stepWord, shotTimes, cueRange, sfxOptions, takesCue, editScript } from './timeline.js';

const S = {
  state: null, project: null, jobs: [], briefForm: null, sel: null, detail: null, sub: 'preview', view: 'auto', paneDirty: false, lastStamp: null,
  seqs: [], seqMeta: null, seqSel: null, seqForm: null, seqStamp: null,
  director: null, dirHtml: null, dirLogOpen: null, scriptWarnings: null,
  listMode: 'jobs', jobFilter: 'all', listHtml: null, brandDirty: false,
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const slug = (v) => v.toLowerCase().replace(/\u0111/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// Square brackets mark a placeholder; validateScript warns while one is left in a voice line.
const PLACEHOLDER_VO = '[Write what the voice says in this scene]';
const DRAFT_NOTE_MAX = 300; // engine/script.mjs DRAFT_NOTE_MAX
const GEN_PROMPT_MAX = 2000; // server/generate.mjs MAX_PROMPT_CHARS
const GEN_REFS_MAX = 3; // server/generate.mjs MAX_REFS; engine/brand.mjs MAX_CLIP_REFS
const CLIP_BRIEF_MAX = 1500; // engine/brand.mjs MAX_CLIP_BRIEF
const GEN_CLIP_NOTE = 'One click makes one clip on your Gemini key, billed per second of clip (no free tier). Google picks the length; it usually takes 1-3 minutes.';
// A prompt over the Generate cap, as the fix: '' when it fits.
const promptCut = (text) => (text.length > GEN_PROMPT_MAX ? `${text.length}/${GEN_PROMPT_MAX} characters: cut ${text.length - GEN_PROMPT_MAX}` : '');
// Up to GEN_REFS_MAX brand pictures (.png, .jpg, .webp) as checkboxes with thumbnails; the rest close once that many are picked.
const refPickerHtml = (pictures, picked, url) => (pictures.length
  ? pictures.map((a) => `<label class="refpick-item"><input type="checkbox" value="${esc(a)}"${picked.includes(a) ? ' checked' : ''}><img src="${url(a)}" alt=""><span class="mono">${esc(a)}</span></label>`).join('')
  : '<span class="muted">No pictures yet: upload .png, .jpg or .webp files under Assets.</span>');
const pickedRefs = (el) => $$('input:checked', el).map((i) => i.value);
const capRefs = (el) => { const full = pickedRefs(el).length >= GEN_REFS_MAX; $$('input', el).forEach((i) => { i.disabled = full && !i.checked; }); };
const MAX_CUTS = 3; // engine/jobs.mjs MAX_CUTS: extra formats per brief
const MAX_FONT_FILES = 8; // engine/brand.mjs fontFiles cap
const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
// URL-safe path parts: a project and a job (or sequence) id, and a file path under out/ that may hold folders.
const jobPath = (project = S.project, id = S.sel) => `${encodeURIComponent(project)}/${encodeURIComponent(id)}`;
const fileUrl = (base, file) => `${base}/${esc(encodeURI(String(file)))}`;
const MARK_FIELDS = ['title', 'subtitle', 'text', 'tagline', 'quote']; // engine/marks.mjs MARK_FIELDS
const MARK_SYNTAX = '[[underline:]]'.length;
const MARK_HINT = ' Mark a word (at most 2): [[circle:40%]], [[underline:faster]], [[strike:old way]] or [[mark:one team]]; drawn as the voice says it.';
const GEN_NOTICE = 'Your prompt and this brand\'s text go to Google under your own Gemini API key and billing. Keep billing on: the free tier may use prompts to improve Google products.';
// Icon paths come from the server already checked (M/L/C/Z and numbers only); esc() keeps that true here too.
const iconSvg = (d) => (d ? `<svg viewBox="0 0 100 112" aria-hidden="true"><path d="${esc(d)}"/></svg>` : '');

const STATUS = {
  queued: 'waiting for Director', scripting: 'Director writing', scripted: 'script ready', dirty: 'edited, needs a rebuild',
  preparing: 'building storyboard', awaiting_review: 'awaiting review', approved: 'approved', rendering: 'rendering',
  done: 'done', error: 'error',
};
// A job's status in plain words; an edited job says what it needs next.
const statusText = (s) => (s.status === 'dirty' ? ((s.dirty_from ?? 99) < 5 ? 'needs the Director' : 'needs a new storyboard') : STATUS[s.status] || s.status);
// The voice engine a brand names but this machine cannot run, as a sentence; '' when it runs or /options is not loaded.
const missingEngine = (tts, voices = S.options?.voices) => {
  const id = String(tts || '').toLowerCase() === 'windows' ? 'sapi' : String(tts || '').toLowerCase();
  const e = (voices || []).find((x) => x.id === id);
  if (!e || e.available) return '';
  return id === 'kokoro' ? `No Kokoro voice model on this machine (${e.reason}). Copy the models/kokoro/ folder from a teammate.` : `${e.label} is not available here (${e.reason}).`;
};
const BUSY = ['scripting', 'preparing', 'rendering'];
const WHO = { human: 'human', director: 'director', tool: 'tool' };
const FIELD_LABEL = {
  vo: 'Voice-over', layout: 'Layout', zoom: 'Zoom', nav: 'Nav item', page: 'Page title', data: 'Screen data', assistant: 'Assistant turns', title: 'Title', subtitle: 'Subtitle', kicker: 'Kicker', text: 'Text line', chip: 'Chip',
  stat: 'Number', icon: 'Icon', shots: 'Shots (image, focus, cursor, click)', pace: 'Pace', decor: 'Decor', check: 'Check mark', button: 'CTA button', url: 'URL', asset: 'Image', packLine: 'Pack line', source: 'Claim source',
  video: 'Video clip', sound: 'Sound', image: 'Cover art', model: '3D model', lottie: 'Animation (Lottie)', spin: 'Spin', view: 'Camera pose', path: 'Camera path', explode: 'Exploded parts', gap: 'Part gap', decal: 'Decal', env: 'Lighting', shadow: 'Shadow', loop: 'Loop', fit: 'Fit', name: 'Name', role: 'Role', in: 'Starts at (s)', out: 'Ends at (s)', code: 'Code', before: 'Before', after: 'After', lang: 'Window label', file: 'File name', files: 'Changed files', lines: 'Terminal lines', highlight: 'Lines to light up', periods: 'Periods', series: 'Series (one value per period)', values: 'Values', finish: 'Ends as', top: 'Bars shown', items: 'Items', points: 'Points', parts: 'Parts', labels: 'Axis labels', band: 'Highlight band', ref: 'Reference line', theme: 'Theme',
};

// Review link (npm run ui:review): the same UI, read-only. app.css hides the edit controls; the server refuses every write anyway.
const REVIEW = document.documentElement.dataset.review === '1';
// The Script tab's look that keeps the brand as set (engine/looks.mjs BRAND_LOOK); the job route lists the others.
const LOOK_BRAND = 'brand';
// Every write (and TTS, which the review link never runs) passes here first: api(), uploads, the CSV and the voice sample.
function assertWritable() {
  if (REVIEW) throw new Error('This is a read-only review link. Changes are made on the Motion Studio computer.');
}
const OFFLINE = 'Lost connection to the Studio server.';
const offline = () => Object.assign(new Error(OFFLINE), { offline: true });

/** fetch() for /api with the X-Studio header; a network failure throws an error marked `offline`. */
async function send(path, { method = 'GET', headers = {}, body } = {}) {
  if (method !== 'GET') assertWritable();
  let r;
  try { r = await fetch(`/api${path}`, { method, headers: { 'X-Studio': '1', ...headers }, body }); } catch { throw offline(); }
  return r;
}
async function sendJson(path, opts) {
  const r = await send(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `${r.status} ${r.statusText}`), { status: r.status });
  return data;
}
const api =(path, { method = 'GET', body } = {}) => sendJson(path, {
  method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
});

/** POSTs one file with upload progress (fetch has none); resolves to the server's JSON, rejects with its error text. */
function postFile(path, file, type, onProgress) {
  assertWritable();
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api${path}`);
    x.setRequestHeader('X-Studio', '1');
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onerror = () => reject(offline());
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(data); else reject(new Error(data.error || `${x.status} ${x.statusText}`));
    };
    x.send(file);
  });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

/**
 * Make cloud voice (server/voice-cloud.mjs): shown only when the brand has a cloud voice id. One click makes the
 * missing lines on the person's own key; while it runs the panel polls, and it stops polling once it leaves the page.
 */
async function cloudVoicePanel(box, jp) {
  if (!box) return;
  let st;
  try { st = await api(`/jobs/${jp}/cloud-voice`); } catch { return; }
  if (!box.isConnected || !st.voice) { box.innerHTML = ''; return; }
  const run = st.running, last = st.last;
  const left = st.missing.length;
  const why = st.error || (!st.hasKey ? `Add ${st.keyEnv} to .env, then restart npm run ui.` : st.pause ? `Paused until ${new Date(st.pause.until).toLocaleString('en-US')} after a quota or rate limit.` : '');
  box.innerHTML = `<div class="banner" role="group" aria-label="Cloud voice"><p><b>Cloud voice</b> (ElevenLabs ${esc(st.voice.voice)}): ${st.lines - left} of ${st.lines} lines made${left ? `, missing ${esc(st.missing.join(', '))}` : ''}.
    Today ${st.usage.lines} lines, ${st.usage.chars} characters${st.caps ? ` of ${st.caps.maxLinesPerDay} and ${st.caps.maxCharsPerDay}` : ''}.</p>
    ${run ? `<p class="muted">Making line ${run.made + 1} of ${run.lines}…</p>` : last?.message ? `<p class="${last.status === 'error' ? 'err' : 'muted'}">${esc(last.message)}</p>` : ''}
    ${why ? `<p class="warn-t small">${esc(why)}</p>` : ''}
    <div class="row"><button class="btn" type="button" id="sc-cloud-go" ${run || !left || why ? 'disabled' : ''}>Make cloud voice (${left} line${left === 1 ? '' : 's'})</button>
      ${st.pause ? '<button class="btn" type="button" id="sc-cloud-unpause">Clear pause</button>' : ''}
      <span class="muted small">Each line is made once on your key; then rebuild the storyboard.</span></div></div>`;
  box.querySelector('#sc-cloud-go')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api(`/jobs/${jp}/cloud-voice`, { method: 'POST', body: {} }); } catch (err) { toast(err.message); }
    cloudVoicePanel(box, jp);
  });
  box.querySelector('#sc-cloud-unpause')?.addEventListener('click', async () => {
    try { await api(`/jobs/${jp}/cloud-voice/pause`, { method: 'DELETE' }); } catch (err) { toast(err.message); }
    cloudVoicePanel(box, jp);
  });
  if (run) setTimeout(() => { if (box.isConnected) cloudVoicePanel(box, jp); }, 2000);
}

async function busy(btn, fn, errBox) {
  if (btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${old}`;
  if (errBox) errBox.textContent = '';
  try {
    return await fn();
  } catch (e) {
    if (errBox) errBox.textContent = e.message; else toast(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

// One action at a time per job, sequence or form ("job:<project>/<id>", "seq:…", "form:brief"…). While one runs,
// every action control for that key renders disabled (applyLocks runs after each re-render) and a second click,
// an Enter submit or a poll redraw cannot start another.
const INFLIGHT = new Set();
const jobKey = (id = S.sel) => `job:${S.project}/${id}`;
const seqKey = (id = S.seqSel) => `seq:${S.project}/${id}`;
const FORM_BTNS = { 'form:brief': '#bf-save, #bf-saverun', 'form:script': '#ss-check, #ss-save', 'form:seq': '#sf-save', 'form:brand': '#br-save' };
const lockedNow = () => [
  S.sel && INFLIGHT.has(jobKey()) ? '#d-top [data-act], #d-edit, #d-del' : '',
  S.seqSel && INFLIGHT.has(seqKey()) ? '#sq-render, .sq-preview, #sq-edit, #sq-del' : '',
  ...Object.entries(FORM_BTNS).map(([k, sel]) => (INFLIGHT.has(k) ? sel : '')),
].filter(Boolean);
function applyLocks() {
  for (const sel of lockedNow()) $$(sel).forEach((b) => { b.disabled = true; });
  lockPane();
}
async function guarded(key, btn, fn, errBox) {
  if (INFLIGHT.has(key) || btn.disabled) return;
  INFLIGHT.add(key);
  const run = busy(btn, fn, errBox);
  applyLocks();
  try { return await run; } finally {
    INFLIGHT.delete(key);
    const msg = errBox?.textContent, boxId = errBox?.id;
    // Redraw what the lock disabled, so each control gets back its own state (e.g. "the Director is already running").
    if (key === jobKey() && S.detail) renderTop();
    else if (key === seqKey() && S.seqSel && !S.seqForm) renderSeqDetail();
    else if (FORM_BTNS[key]) $$(FORM_BTNS[key]).forEach((b) => { b.disabled = false; });
    // The redraw writes a fresh, empty error box: the message the action just failed with goes back into it.
    const box = msg && boxId ? document.getElementById(boxId) : null;
    if (box && box !== errBox) box.textContent = msg;
  }
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// Review mode: every field stays readable but cannot change (the project picker and preview controls still work).
function lockForReview() {
  const KEEP = '#proj, #rng, #snd, .transport *';
  const TEXT = 'textarea, input:not([type]), input[type=text], input[type=number], input[type=url], input[type=search]';
  let queued = false;
  const lock = () => {
    queued = false;
    for (const x of $$('#main input, #main textarea, #main select, #dlg input, #dlg textarea, #dlg select')) {
      if (x.matches(KEEP)) continue;
      if (x.matches(TEXT)) x.readOnly = true; else x.disabled = true;
    }
  };
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(lock); } }).observe(document.body, { childList: true, subtree: true });
  lock();
  $('#topstatus').insertAdjacentHTML('beforebegin', '<span class="ro-badge" title="Watch only. Edits, approvals and renders happen on the Motion Studio computer.">Read-only review</span>');
}

/* ---------------- boot ---------------- */
async function boot() {
  if (REVIEW) lockForReview();
  S.state = await api('/state');
  const saved = store.get('ms.project');
  S.project = S.state.projects.some((p) => p.id === saved) ? saved : S.state.projects[0]?.id;
  fillProjects();
  $('#proj').addEventListener('change', () => {
    if (!confirmDiscard(true)) { $('#proj').value = S.project; return; }
    switchProject($('#proj').value);
  });
  $('#new-proj').addEventListener('click', openNewProject);
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  $('#listmode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setListMode(b.dataset.mode); });
  $('#jobfilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    S.jobFilter = b.dataset.filter; store.set('ms.jobFilter', S.jobFilter);
    drawJobList();
  });
  S.jobFilter = store.get('ms.jobFilter') || 'all';
  // A blank brief starts on the Explainer, the general template with a quick mode.
  $('#new-brief').addEventListener('click', () => openBriefForm({ template: 'explainer' }));
  $('#new-script').addEventListener('click', openSceneScriptForm);
  $('#new-seq').addEventListener('click', () => { if (S.seqMeta) openSeqForm({}); });
  $('#director').addEventListener('click', directorClick);
  $('#director').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-dir-model], [data-dir-provider]');
    if (!sel) return;
    try {
      if (sel.matches('[data-dir-provider]')) {
        const r = await api('/director/provider', { method: 'PUT', body: { default: sel.value } });
        S.dirDraft = null;
        toast(`Director: ${r.default === 'seat' ? 'Claude seat' : r.providers.find((x) => x.id === r.default)?.label || r.default}. Used from the next run.`);
      } else {
        const r = await api('/director/model', { method: 'PUT', body: { model: sel.value } });
        toast(`Director model: ${r.models.find((x) => x.id === r.model)?.label || r.model}. Used from the next run.`);
      }
    } catch (err) { toast(err.message); }
    S.dirHtml = null;
    refreshDirector();
  });
  $('#director').addEventListener('input', (e) => {
    const f = e.target.closest('[data-dir-pf]'), id = S.director?.default, p = dirProv(id);
    if (!f || !p) return;
    const base = S.dirDraft?.id === id ? S.dirDraft : { id, model: p.model, strongModel: p.strongModel, vision: p.vision };
    S.dirDraft = { ...base, [f.dataset.dirPf]: f.type === 'checkbox' ? f.checked : f.value };
  });
  $('#director').addEventListener('toggle', (e) => { if (e.target.matches('details')) S.dirLogOpen = e.target.open; }, true);
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); });
  window.addEventListener('beforeunload', (e) => { if (hasUnsaved(true) || S.uploading) e.preventDefault(); });
  renderTemplates(); renderBrand(); renderHelp();
  S.assistant = mountAssistant({
    api, toast, review: REVIEW, project: () => S.project,
    changed: (kind) => { if (kind === 'brand') { S.brandDirty = false; renderBrand(); } else if (kind === 'sequences') refreshSequences(); else refreshJobs(false); },
  });
  // A saved key, provider or model changes what the Director panel and the Assistant offer.
  S.settings = mountSettings({ api, toast, review: REVIEW, changed: () => { S.dirHtml = null; refreshDirector(); S.assistant?.reloadModels(); } });
  await refreshJobs(true);
  setInterval(poll, 2500);
}

// After this many failed polls in a row (about 5 s) the screen says its data is no longer live.
const POLL_FAILS_SHOWN = 2;
let pollFails = 0;
function connBanner(err) {
  const on = Boolean(err);
  $('#conn').hidden = !on;
  document.documentElement.classList.toggle('stale', on);
  if (on) $('#conn').textContent = err.offline ? `${OFFLINE} Retrying…` : `Could not refresh: ${err.message}. Retrying…`;
}
async function poll() {
  if (!$('#tab-jobs').classList.contains('on') || document.hidden) return;
  try {
    await refreshJobs(false);
    if (pollFails) { pollFails = 0; connBanner(null); }
  } catch (e) {
    pollFails += 1;
    if (pollFails >= POLL_FAILS_SHOWN) connBanner(e);
  }
}

function fillProjects() {
  $('#proj').innerHTML = S.state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.brand.name || p.id)}</option>`).join('');
  $('#proj').value = S.project;
}

async function switchProject(id) {
  stopPreview();
  S.project = id; store.set('ms.project', id); S.sel = null; S.detail = null; S.briefForm = null; S.seqSel = null; S.seqForm = null;
  S.paneDirty = false; S.brandDirty = false; S.listHtml = null; S.seqListHtml = null;
  $('#proj').value = id;
  $('#detail').innerHTML = '<p class="muted">Select a job on the left.</p>';
  renderBrand();
  resetTemplatePreviews();
  S.assistant?.refreshScope();
  try { await refreshJobs(true); } catch (e) {
    $('#detail').innerHTML = `<div class="banner bad" role="alert"><p>Could not load ${esc(id)}: ${esc(e.message)}</p><button class="btn" type="button" id="proj-retry">Retry</button></div>`;
    $('#proj-retry').addEventListener('click', () => switchProject(id));
  }
}

function showTab(tab) {
  $$('#nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${tab}`));
  if (tab === 'settings') S.settings?.show();
}

function setListMode(mode) {
  S.listMode = mode;
  $$('#listmode button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#side-jobs').hidden = mode !== 'jobs';
  $('#side-seqs').hidden = mode !== 'seqs';
}

/* ---------------- unsaved changes ---------------- */
// withBrand: leaving the project or the page also drops unsaved Brand edits; switching jobs does not.
const hasUnsaved = (withBrand) => briefFormDirty() || S.paneDirty || seqFormDirty() || (withBrand && S.brandDirty);
const jobBusy = () => { const d = S.detail; return Boolean(d && (BUSY.includes(d.status.status) || d.running || dirOnJob() || INFLIGHT.has(jobKey()))); };
const busyWhy = () => {
  const d = S.detail;
  if (dirOnJob()) return 'The Director is working on this job.';
  if (d.running) return `The engine is running ${d.running.action}.`;
  if (BUSY.includes(d.status.status)) return `The job is ${STATUS[d.status.status]}.`;
  return 'An action on this job is still running.';
};
// The Script and Source editors pause while the job is busy: a save then would race the Director or the engine.
function lockPane() {
  const ed = $('#pane-ed');
  if (!ed || REVIEW) return;
  const on = jobBusy();
  ed.disabled = on;
  $('#pane-lock').textContent = on ? `${busyWhy()} Editing is paused until it finishes.` : '';
}
function confirmDiscard(withBrand = false) {
  if (!hasUnsaved(withBrand)) return true;
  const what = briefFormDirty() ? (S.briefForm.sceneScript ? 'the pasted scene script' : S.briefForm.edit ? 'your changes to the brief' : 'the new brief')
    : S.paneDirty ? `your unsaved ${S.sub === 'source' ? 'Source' : 'Script'} edits`
      : seqFormDirty() ? 'your changes to the sequence' : 'your unsaved Brand edits';
  return window.confirm(`Discard ${what}?`);
}

/* ---------------- new project ---------------- */
function openNewProject() {
  if (!confirmDiscard(true)) return;
  const dlg = $('#dlg');
  dlg.setAttribute('aria-label', 'New project');
  dlg.innerHTML = `<form method="dialog" class="stack" id="np" novalidate>
    <h2 style="margin:0">New project</h2>
    <p class="muted" style="margin:0">One project per brand. It gets its own brand settings, assets and briefs.</p>
    <div class="f"><label for="np-name">Brand name</label><input id="np-name" maxlength="80" placeholder="Acme Analytics" required></div>
    <div class="grid2">
      <div class="f"><label for="np-id">Project id</label><input id="np-id" maxlength="64" placeholder="auto from name"></div>
      <div class="f"><label for="np-from">Start from</label><select id="np-from"><option value="">Default look</option>${S.state.projects.map((p) => `<option value="${esc(p.id)}">Copy look of ${esc(p.brand.name || p.id)}</option>`).join('')}</select></div>
    </div>
    <div class="f"><label for="np-site">Website (optional)</label><input id="np-site" maxlength="120" placeholder="acme.com">
      <span class="muted hint">The director may only read pages on this site. You can add more hosts later.</span></div>
    <p class="muted mono" id="np-path" style="margin:0"></p>
    <div class="err" role="alert" id="np-err"></div>
    <div class="row"><button class="btn p" type="submit" id="np-save">Create project</button><button class="btn" type="button" id="np-cancel">Cancel</button></div>
  </form>`;
  const idOf = () => $('#np-id').value.trim() || slug($('#np-name').value) || '';
  const sync = () => { $('#np-path').textContent = idOf() ? `→ profiles/${idOf()}/` : ''; };
  ['np-name', 'np-id'].forEach((x) => $(`#${x}`).addEventListener('input', sync));
  $('#np-cancel').addEventListener('click', () => dlg.close());
  $('#np').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('#np-save'), async () => {
      const made = await api('/projects', { method: 'POST', body: { id: idOf(), name: $('#np-name').value.trim(), site: $('#np-site').value.trim(), from: $('#np-from').value } });
      S.state = await api('/state');
      S.project = made.id;
      fillProjects();
      dlg.close();
      switchProject(made.id);
      $('#nav [data-tab="brand"]').click();
      toast(`Created project ${made.id}. Set its colors and logo here.`);
    }, $('#np-err'));
  });
  dlg.showModal();
  $('#np-name').focus();
}

function openDeleteProject(project, name, assetCount) {
  const dlg = $('#dlg');
  dlg.setAttribute('aria-label', 'Delete project');
  const jobs = S.project === project ? S.jobs.length : 0;
  const last = S.state.projects.length <= 1;
  dlg.innerHTML = `<form method="dialog" class="stack" id="dp" novalidate>
    <h2 style="margin:0">Delete ${esc(name || project)}?</h2>
    <ul style="margin:0;padding-left:18px">
      <li>${jobs} brief${jobs === 1 ? '' : 's'} and every video, still and script made from them (<code>briefs/${esc(project)}</code>, <code>out/${esc(project)}</code>)</li>
      <li>Brand settings, tone of voice and ${assetCount} asset${assetCount === 1 ? '' : 's'} (<code>profiles/${esc(project)}</code>)</li>
    </ul>
    <p class="muted" style="margin:0">Everything moves to <code>trash/${esc(project)}-&lt;time&gt;/</code>. To bring it back, move those folders back and reload. To free the disk space, delete that folder.</p>
    ${last ? '<p class="err" style="margin:0">This is the only project. Create another one before deleting it.</p>' : `
    <div class="f"><label for="dp-confirm">Type <b class="mono">${esc(project)}</b> to confirm</label><input id="dp-confirm" autocomplete="off" spellcheck="false"></div>`}
    <div class="err" role="alert" id="dp-err"></div>
    <div class="row">${last ? '' : '<button class="btn bad" type="submit" id="dp-go" disabled>Delete project</button>'}<button class="btn" type="button" id="dp-cancel">Cancel</button></div>
  </form>`;
  $('#dp-cancel').addEventListener('click', () => dlg.close());
  if (!last) {
    $('#dp-confirm').addEventListener('input', () => { $('#dp-go').disabled = $('#dp-confirm').value.trim() !== project; });
    $('#dp').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('#dp-confirm').value.trim() !== project) return;
      busy($('#dp-go'), async () => {
        const res = await api(`/projects/${encodeURIComponent(project)}`, { method: 'DELETE', body: { confirm: project } });
        S.state = await api('/state');
        S.project = S.state.projects[0].id;
        fillProjects();
        dlg.close();
        switchProject(S.project);
        $('#nav [data-tab="jobs"]').click();
        toast(`Deleted ${project}. Its folders are in trash/${res.trash}.`);
      }, $('#dp-err'));
    });
  }
  dlg.showModal();
  (last ? $('#dp-cancel') : $('#dp-confirm')).focus();
}

/* ---------------- jobs list ---------------- */
// "To do" is every job that is not finished; the Done filter shows the rendered ones.
const JOB_FILTERS = [['all', 'All', () => true], ['todo', 'To do', (s) => s !== 'done'], ['done', 'Done', (s) => s === 'done']];

async function refreshJobs(selectFirst) {
  S.jobs = await api(`/jobs?project=${encodeURIComponent(S.project)}`);
  const active = S.jobs.filter((j) => BUSY.includes(j.status.status)).length;
  const review = S.jobs.filter((j) => j.status.status === 'awaiting_review').length;
  const queued = S.jobs.filter((j) => j.status.status === 'queued' || (j.status.status === 'dirty' && (j.status.dirty_from ?? 99) < 5)).length;
  // A live region: rewriting it every poll makes a screen reader repeat it.
  const top = `${active} running · ${review} awaiting review · ${queued} waiting for Director`;
  if ($('#topstatus').textContent !== top) $('#topstatus').textContent = top;
  drawJobList();
  await refreshDirector();
  await refreshSequences();
  if (selectFirst && !S.sel && !S.briefForm && !S.seqSel && !S.seqForm && S.jobs[0]) return selectJob(S.jobs[0].brief.id);
  if (S.sel) await loadDetail(false);
}

function drawJobList() {
  const show = (JOB_FILTERS.find(([k]) => k === S.jobFilter) || JOB_FILTERS[0])[2];
  const jobs = S.jobs.filter((j) => show(j.status.status));
  const chips = JOB_FILTERS.map(([k, label, fn]) => `<button type="button" class="chip${S.jobFilter === k ? ' on' : ''}" data-filter="${k}" aria-pressed="${S.jobFilter === k}">${label} ${S.jobs.filter((j) => fn(j.status.status)).length}</button>`).join('');
  const list = jobs.length ? jobs.map((j) => {
    const s = j.status;
    const pr = s.progress && s.progress.total ? Math.round((s.progress.frame / s.progress.total) * 100) : null;
    return `<button class="job ${S.sel === j.brief.id ? 'on' : ''}" data-id="${esc(j.brief.id)}"${s.status === 'error' && s.error ? ` title="Error: ${esc(s.error)}"` : ''}>
      <span class="dot s-${esc(s.status)}" role="img" aria-label="Status: ${esc(statusText(s))}" title="${esc(statusText(s))}"></span>
      <span style="min-width:0;flex:1"><span class="t">${esc(j.brief.id)}</span>${j.brief.quick ? ' <span class="pill" title="Quick video: built from an outline">quick</span>' : ''}<br>
      <span class="m">${esc(statusText(s))} · ${esc(tplName(j.brief))} · ${esc(j.brief.duration)}s</span>
      ${pr !== null ? `<span class="bar"><i style="width:${pr}%"></i></span>` : ''}</span></button>`;
  }).join('') : S.jobs.length ? '<p class="muted">No job matches this filter.</p>' : '<p class="muted">No jobs yet. Click New brief to write the first one.</p>';
  $('#n-jobs').textContent = S.jobs.length;
  // Redrawing an unchanged list every poll would drop keyboard focus from the list.
  const html = chips + list;
  if (html === S.listHtml) return;
  S.listHtml = html;
  $('#jobfilter').innerHTML = chips;
  $('#joblist').innerHTML = list;
  $$('#joblist .job').forEach((b) => b.addEventListener('click', () => selectJob(b.dataset.id)));
}

async function selectJob(id) {
  if (!confirmDiscard()) return;
  S.briefForm = null; S.seqSel = null; S.seqForm = null;
  S.sel = id; S.sub = 'preview'; S.view = 'auto'; S.cut = null; S.paneDirty = false; S.lastStamp = null; S.paneKey = null;
  $$('#joblist .job').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  $$('#seqlist .job').forEach((b) => b.classList.remove('on'));
  await loadDetail(true);
}

async function loadDetail(full) {
  const d = await api(`/jobs/${jobPath()}`);
  const statusStamp = d.status.updatedAt || 'none';
  const D = S.director || {};
  const stamp = `${statusStamp}|${d.running ? d.running.action : ''}|${dirOnJob()}|${Boolean(D.running)}|${Boolean(D.pause)}`;
  const changed = stamp !== S.lastStamp;
  const s = d.status;
  const paneKey = `${s.status}|${s.step}|${s.dirty_from}|${(s.stills || []).map((x) => x.t).join(',')}|${d.has.final}|${s.outputs?.renderSeconds ?? ''}`;
  const paneChanged = paneKey !== S.paneKey;
  S.detail = d;
  S.lastStamp = stamp;
  S.paneKey = paneKey;
  if (full) return renderDetail();
  if (changed) renderTop();
  if (paneChanged && !S.paneDirty) renderPane();
  lockPane();
}

/* ---------------- detail ---------------- */
const SUBS = [['preview', 'Preview'], ['script', 'Script'], ['source', 'Source'], ['history', 'History']];

function renderDetail() {
  $('#detail').innerHTML = `<div id="d-top"></div>
    <div class="subtabs" role="tablist" aria-label="Job">
      ${SUBS.map(([k, l]) => `<button role="tab" id="st-${k}" aria-controls="d-pane" aria-selected="${S.sub === k}" tabindex="${S.sub === k ? 0 : -1}" class="${S.sub === k ? 'on' : ''}" data-sub="${k}">${l}</button>`).join('')}
    </div><div id="d-pane" role="tabpanel" aria-labelledby="st-${S.sub}"></div>`;
  $$('#detail .subtabs button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.sub !== S.sub) goSub(b.dataset.sub); }));
  // Arrow keys move between the tabs, as the tab pattern expects (Tab itself goes on into the pane).
  $('#detail .subtabs').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const keys = SUBS.map(([k]) => k), next = keys[(keys.indexOf(S.sub) + step + keys.length) % keys.length];
    e.preventDefault();
    goSub(next);
    $(`#st-${next}`)?.focus();
  });
  renderTop();
  renderPane();
}

// Switches the job's sub-tab. `jump` carries where to land: { t } seeks the preview, { scene } scrolls the Script tab to it.
function goSub(sub, jump = null) {
  if (!confirmDiscard()) return;
  S.sub = sub; S.paneDirty = false; S.jump = jump;
  $$('#detail .subtabs button').forEach((x) => { const on = x.dataset.sub === sub; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
  $('#d-pane')?.setAttribute('aria-labelledby', `st-${sub}`);
  // Landing on a scene scrolls to that scene; otherwise bring the tab bar into view.
  if (!jump?.scene) $('#detail .subtabs')?.scrollIntoView({ block: 'start' });
  renderPane();
}

function renderTop() {
  const d = S.detail, b = d.brief, s = d.status;
  const rail = d.steps.map((st) => {
    const cls = s.status === 'done' ? 'done' : st.n < s.step ? 'done' : st.n === s.step ? 'cur' : '';
    return `<div class="rs ${cls}"><b>${st.n}</b>${esc(st.label)}<br><span class="who">${WHO[st.who]}</span></div>`;
  }).join('');
  const busyNow = BUSY.includes(s.status) || Boolean(d.running);
  const findings = (s.lint?.findings || []).length
    ? `<h3>Layout checks</h3><ul class="findings">${s.lint.findings.map((f) => `<li class="${esc(f.level)}">[${esc(f.level)}] ${f.scene ? `${esc(f.scene)} · ` : ''}${esc(f.el)}: ${esc(f.msg)}</li>`).join('')}</ul>` : '';
  $('#d-top').innerHTML = `<div class="head"><h2>${esc(b.id)}</h2>
      <span class="pill">${esc(tplName(b))}</span>${b.quick ? '<span class="pill" title="Quick video: built from an outline">quick</span>' : ''}<span class="pill">${esc(b.format)}</span>${b.platform ? `<span class="pill">${esc(platformLabel(b.platform))}</span>` : ''}<span class="pill">${esc(b.duration)}s</span>
      ${b.lang ? `<span class="pill">${esc(langName(b.lang))}</span>` : ''}${b.voice ? `<span class="pill" title="Voice for this video">${esc(b.voice === 'none:' ? 'no voice' : b.voice.slice(b.voice.indexOf(':') + 1))}</span>` : ''}${b.voiceTake ? `<span class="pill" title="Recorded voice">recorded · ${esc(b.voiceTake)}</span>` : ''}
      <span class="pill">${esc(statusText(s))}</span>
      <span class="hbtns"><button class="btn sm" id="d-edit" ${busyNow ? 'disabled title="Wait until the job finishes"' : ''}>Edit brief</button>
      <button class="btn sm" id="d-dup">Duplicate</button>
      <button class="btn sm" id="d-del" ${busyNow || dirOnJob() ? 'disabled title="Wait until the job finishes"' : ''}>Delete…</button></span></div>
    <div class="rail" aria-label="Steps">${rail}</div>
    ${banner()}<div class="err" role="alert" id="d-err"></div>${findings}`;
  $$('#d-top [data-act]').forEach((btn) => btn.addEventListener('click', () => act(btn)));
  $('#d-dup').addEventListener('click', () => openBriefForm({ ...b, subject: b.subject || b.sku || '', from: b.id, id: '' }));
  $('#d-del').addEventListener('click', (e) => {
    if (!confirmDiscard() || !window.confirm(`Delete job ${b.id}? Its brief, script, stills and video move to trash/.`)) return;
    guarded(jobKey(b.id), e.currentTarget, async () => {
      const r = await api(`/jobs/${jobPath(S.project, b.id)}`, { method: 'DELETE' });
      stopPreview();
      S.sel = null; S.detail = null; S.paneDirty = false;
      $('#detail').innerHTML = NO_SELECTION;
      toast(`Deleted ${b.id}. Its files are in trash/${r.trash}.`);
      await refreshJobs(true);
    }, $('#d-err'));
  });
  $('#d-edit').addEventListener('click', () => openBriefForm({
    ...b, subject: b.subject || b.sku || '', edit: true, hasScript: Boolean(d.script), started: Boolean(d.script || d.source),
  }));
  applyLocks();
}

// The QA receipt of a finished render: a one-line verdict that opens to its findings.
function qaHtml(qa, base, label = '') {
  if (!qa) return '';
  const tone = !qa.passed ? 'bad' : qa.warnings ? 'warn' : 'ok';
  const head = `${label ? `${label} · ` : ''}QA ${qa.passed ? 'passed' : 'failed'}${qa.errors ? ` · ${qa.errors} error(s)` : ''}${qa.warnings ? ` · ${qa.warnings} warning(s)` : ''}${qa.loudness !== null && qa.loudness !== undefined ? ` · ${qa.loudness} LUFS` : ''}`;
  const items = (qa.findings || []).map((f) => `<li class="${f.level === 'error' ? 'error' : 'warning'}">${esc(f.check)}: ${esc(f.msg)}</li>`).join('');
  return `<details class="qa ${tone}"><summary>${esc(head)}</summary>
    ${items ? `<ul class="findings">${items}</ul>` : '<p class="muted small">Length, size, audio, loudness, black and frozen picture, and captions all look right.</p>'}
    ${qa.receipt ? `<a class="small" href="${base}/${esc(qa.receipt)}" target="_blank" rel="noopener">Full receipt (${esc(qa.receipt)})</a>` : ''}</details>`;
}

function banner() {
  const d = S.detail, s = d.status, r = d.running;
  const B = (cls, text, buttons = '') => `<div class="banner ${cls}"><p>${text}</p>${buttons}</div>`;
  const btn = (act, label, p = false) => `<button class="btn ${p ? 'p' : ''}" data-act="${act}">${label}</button>`;
  const D = S.director || {};
  const dirBtns = (label) => `<button class="btn p" data-act="director"${D.running || D.pause ? ` disabled title="${D.pause ? `Paused: ${esc(dirPauseWhat())}` : 'The Director is already running'}"` : ''}>${label}</button><button class="btn" data-copy="${esc(studioCmd([S.sel]))}">Copy command</button>`;
  if (r && s.status !== 'rendering') return B('busy', `<span class="spin" aria-hidden="true"></span> Engine running <code>${esc(r.action)}</code>…`);
  if (dirOnJob()) return B('busy', '<span class="spin" aria-hidden="true"></span> The Director is working on this job. Its log is under the job list.');
  switch (s.status) {
    case 'queued': return B('', 'Waiting for the Director. Run it here (Claude Code on your seat, or the API provider you picked), or type <code>/studio run</code> in Claude Code.', dirBtns('Run Director for this job'));
    case 'scripting': return B('busy', 'Director is writing <code>source.json</code> and <code>script.json</code>.');
    case 'scripted': return B('human', 'Script ready. The Director usually builds the storyboard itself, but you can run it now.', btn('prepare', 'Build storyboard', true));
    case 'dirty': {
      const drafts = (d.script?.scenes || []).filter((x) => x.draft).length;
      if (drafts) return B('warn', `${drafts} draft scene(s) waiting — click Run Director for this job.`, dirBtns('Run Director for this job'));
      if (s.dirty_from === 3) return B('warn', 'You changed the template. The Director writes a new script for it from the kept source. Your earlier script is in <code>script.prev.json</code>.', dirBtns('Run Director for this job'));
      if (s.dirty_from === 1) return B('warn', 'You edited the brief. The Director needs to redo the source and script. Fields you edited in the Script and Source tabs stay locked.', dirBtns('Run Director for this job'));
      return (s.dirty_from ?? 99) < 5
        ? B('warn', `You edited the source data. The Director needs to rewrite the script. The fields you edited are locked, so the Director won't overwrite them.`, dirBtns('Run Director for this job'))
        : B('warn', 'Script edited by hand. Rebuild the storyboard to see and hear it.', btn('prepare', 'Rebuild storyboard', true));
    }
    case 'preparing': return B('busy', '<span class="spin" aria-hidden="true"></span> Building storyboard…');
    case 'awaiting_review': return B('human', 'Storyboard ready. Check the preview and stills, edit the script if needed, then approve to render. Changed the brand or the voice? Rebuild the storyboard to apply it.', `${btn('prepare', 'Rebuild storyboard')}${btn('approve', 'Approve, allow render', true)}`);
    case 'approved': return B('ok', `Approved by ${esc(s.approvedBy || '')}.`, btn('render', 'Render video', true));
    case 'rendering': {
      const p = s.progress?.total ? Math.round((s.progress.frame / s.progress.total) * 100) : 0;
      return B('busy', `<span class="spin" aria-hidden="true"></span> Rendering frame ${s.progress?.frame ?? 0}/${s.progress?.total ?? '?'} (${p}%)`);
    }
    case 'done': {
      const o = s.outputs || {}, base = `/files/${jobPath()}`;
      return B('ok', `Done: ${esc(o.width)}x${esc(o.height)}, ${esc(o.fps)}fps, ${esc(o.duration)}s, audio ${esc(o.audio)}, render ${esc(o.renderSeconds)}s.`,
        `<a class="btn p" href="${base}/final.mp4" download="${esc(S.sel)}.mp4">Download MP4</a>
         ${(o.cuts || []).map((c) => `<a class="btn" href="${fileUrl(base, c.final)}" download="${esc(S.sel)}-${esc(c.format.replace(':', 'x'))}.mp4">Download ${esc(c.format)}</a>`).join('')}
         <a class="btn" href="${base}/captions.srt" download="${esc(S.sel)}.srt">Download captions</a>
         ${o.alpha ? `<a class="btn" href="${fileUrl(base, o.alpha)}" download="${esc(S.sel)}-alpha.mov" title="ProRes 4444 with transparency, to lay over footage in an editor">Download with transparency (.mov)</a>` : ''}
         ${o.html?.file ? `<a class="btn" href="${base}/video.html" download="${esc(S.sel)}.html" title="One file that plays in any browser, no server needed (${esc(o.html.mb)} MB)">Download HTML video</a>` : ''}${btn('render', 'Render again')}`)
        + `<div class="banner"><p>${o.export ? `Exported for an editor: <code>out/${esc(S.project)}/${esc(S.sel)}/${esc(o.export.dir)}/</code> holds ${esc(o.export.scenes)} scene clip(s), the stems (${esc(o.export.stems.join(', ') || 'none')}), the captions and <code>${esc(o.export.timeline)}</code>, which Premiere Pro and DaVinci Resolve open as a timeline. CapCut takes the clips and stems.`
          : 'Finish it in an editor: Export writes one clip per scene, the voice, music and sound stems, the captions and a timeline for Premiere Pro or DaVinci Resolve.'}${s.exportError ? ` <span class="bad">Last export failed: ${esc(s.exportError)}</span>` : ''}</p>${btn('export', o.export ? 'Export again' : 'Export for editor')}</div>`
        + qaHtml(o.qa, base, (o.cuts || []).length ? d.brief.format : '')
        + (o.cuts || []).map((c) => qaHtml(c.qa, base, c.format)).join('');
    }
    case 'error':
      // failed: 'render' keeps the approval, so the same render can simply run again.
      if (s.failed === 'render') return B('bad', `Render failed: ${esc(String(s.error || 'unknown').replace(/\.$/, ''))}. The storyboard is still approved: retry the render, or edit the script and rebuild it.`, `${btn('render', 'Retry render', true)}${d.script ? btn('prepare', 'Rebuild storyboard') : ''}${dirBtns('Run Director again')}`);
      return B('bad', `Error: ${esc(String(s.error || 'unknown').replace(/\.$/, ''))}. Run the Director again, or edit the script in the Script tab.`, `${dirBtns('Run Director again')}${d.script ? btn('prepare', 'Rebuild storyboard') : ''}`);
    default: return '';
  }
}

async function act(btn) {
  const a = btn.dataset.act;
  if (INFLIGHT.has(jobKey()) || !confirmDiscard()) return;
  // The person chose to drop the unsaved edits: show the saved script again.
  if (S.paneDirty) { S.paneDirty = false; renderPane(); }
  await guarded(jobKey(), btn, async () => {
    if (a === 'approve') await api(`/jobs/${jobPath()}/approve`, { method: 'POST', body: {} });
    else if (a === 'director') await api('/director/run', { method: 'POST', body: { project: S.project, job: S.sel } });
    else await api(`/jobs/${jobPath()}/run`, { method: 'POST', body: { action: a } });
    toast(a === 'approve' ? 'Approved' : a === 'director' ? 'Director started' : `Started ${a}`);
    await refreshJobs(false);
  }, $('#d-err'));
}

/* ---------------- director (the Claude seat or the picked API provider, one click = one run) ---------------- */
const studioCmd = (ids) => `/studio run ${ids.map((id) => `${S.project}/${id}`).join(' ')}`;
const dirQueue = () => S.jobs.filter((j) => j.status.status === 'queued' || (j.status.status === 'dirty' && (j.status.dirty_from ?? 99) < 5))
  .map((j) => j.brief.id).slice(0, S.director?.maxJobsPerRun ?? 5);
const dirOnJob = () => { const r = S.director?.running; return Boolean(r && r.project === S.project && r.jobs.includes(S.sel)); };

async function refreshDirector() {
  S.director = await api(`/director?project=${encodeURIComponent(S.project)}`);
  renderDirector();
}

const dirProv = (id) => (S.director?.providers || []).find((p) => p.id === id);
const dirPauseWhat = () => { const id = S.director?.pause?.provider; return id ? `${dirProv(id)?.label || id} quota or spend limit` : 'Claude usage limit reached'; };

/** The Director select (Claude seat or one API provider), its model fields, and where the next click goes. */
function dirBackendHtml() {
  const { running: r, providers, default: sel = 'seat', backend, usage, caps, model, models } = S.director;
  if (!providers) return '';
  const lock = r ? ' disabled title="Change the Director when the run has finished"' : '';
  const opts = [`<option value="seat"${sel === 'seat' ? ' selected' : ''}>Claude seat</option>`, ...providers.map((p) =>
    `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}${p.hasKey ? '' : ' disabled'}>${esc(p.label)}${p.hasKey ? '' : ' (no key)'}</option>`)];
  const p = dirProv(sel);
  const v = S.dirDraft?.id === sel ? S.dirDraft : p;
  const text = (k, label, hint) => `<label>${label} <input data-dir-pf="${k}" value="${esc(v[k])}" maxlength="80" spellcheck="false" autocomplete="off" placeholder="${hint}"${lock}></label>`;
  const fields = p
    ? `${text('model', 'Model', 'model id')}${text('strongModel', 'Strong model', 'same as Model')}
       <label><input type="checkbox" data-dir-pf="vision"${v.vision ? ' checked' : ''}${lock}> Vision</label>
       <button class="btn sm" data-dir="provider"${lock}>Save</button>`
    : models ? `<label>Model <select data-dir-model${lock}>${models.map((m) => `<option value="${esc(m.id)}" ${m.id === model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>` : '';
  const u = backend?.kind === 'api' && usage?.[backend.provider];
  const status = sel !== 'seat' && backend?.kind === 'seat' ? `${p?.label || sel} is selected but ${backend.reason || 'it cannot run'}: runs use the Claude seat.`
    : u ? `${backend.label} calls today: ${u.day}/${caps?.maxCallsPerDay ?? '?'} (this month: ${u.month}).` : '';
  return `<div class="dir-row dir-cfg"><label>Director <select data-dir-provider${lock}>${opts.join('')}</select></label>${fields}</div>`
    + (p?.note ? `<p class="muted small">${esc(p.note)}</p>` : '')
    + (status ? `<p class="${u ? 'muted' : 'warn'}" role="status">${esc(status)}</p>` : '');
}

function renderDirector() {
  const { running: r, last, pause, tail, next } = S.director;
  const queue = dirQueue();
  const runCount = next?.jobs.length ?? queue.length;
  const on = !next?.label ? '' : next.backend?.kind === 'api' ? next.label : `Claude seat (${next.label})`;
  const runLabel = on ? `Run Director: ${runCount} job${runCount === 1 ? '' : 's'} on ${on}` : `Run Director for queued jobs (${queue.length})`;
  const runTitle = next?.jobs.length ? next.jobs.map((j) => `${j.id}: ${j.why}`).join('\n') + (next.waiting ? `\n${next.waiting} more wait for the next run` : '') : '';
  const runOn = r && (r.backend === 'api' ? r.model : `Claude seat${r.model ? `, ${r.model}` : ''}`);
  const line = r ? `<p role="status"><span class="spin" aria-hidden="true"></span> Director running${r.project === S.project ? '' : ` on ${esc(r.project)}`}${runOn ? ` (${esc(runOn)})` : ''}: <code>${esc(r.command)}</code></p>`
    : pause ? `<p class="warn" role="status">Paused: ${esc(dirPauseWhat())}. Director runs are blocked until ${esc(new Date(pause.until).toLocaleString('en-US'))}.</p>`
    : last ? `<p class="${last.status === 'done' ? '' : 'bad'}" role="status">Last run ${esc(last.status)}: ${esc(last.message)}</p>` : '';
  const html = `<div class="dir-row">
      ${queue.length || r ? `<button class="btn p sm" data-dir="run" ${r || pause || !queue.length ? 'disabled' : ''}${runTitle ? ` title="${esc(runTitle)}"` : ''}>${esc(runLabel)}</button>`
        + (next?.waiting && !r ? `<span class="muted">${next.waiting} more wait for the next run</span>` : '')
        : '<span class="muted">Director: no job waiting.</span>'}
      ${r ? '<button class="btn sm" data-dir="cancel">Cancel run</button>' : ''}
      ${queue.length ? `<button class="btn sm" data-copy="${esc(studioCmd(queue))}">Copy command</button>` : ''}
      ${pause && !r ? '<button class="btn sm" data-dir="unpause">Clear pause</button>' : ''}
    </div>${dirBackendHtml()}${line}
    ${tail ? `<details class="dir-log"${S.dirLogOpen ?? r ? ' open' : ''}><summary>Director log (latest run)</summary><pre>${esc(tail)}</pre></details>` : ''}`;
  if (html === S.dirHtml) return;
  // A poll must not wipe a model id being typed; the next poll after the field loses focus redraws.
  if (document.activeElement?.matches?.('#director input[data-dir-pf]')) return;
  // While a run writes, usually only its log grew: update the log text alone, so the focus stays on "Cancel run"
  // and someone reading higher up is not thrown to the bottom.
  const head = html.replace(/<pre>[\s\S]*<\/pre>/, '');
  const pre = $('#director pre');
  if (pre && S.dirHtml && head === S.dirHtml.replace(/<pre>[\s\S]*<\/pre>/, '')) {
    const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
    S.dirHtml = html;
    pre.textContent = tail;
    if (atEnd) pre.scrollTop = pre.scrollHeight;
    return;
  }
  S.dirHtml = html;
  $('#director').innerHTML = html;
  const fresh = $('#director pre');
  if (fresh) fresh.scrollTop = fresh.scrollHeight;
}

async function directorClick(e) {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  const what = b.dataset.dir;
  if (what === 'cancel' && !window.confirm('Stop the Director run? Jobs it was working on go to error.')) return;
  if (what === 'run' && S.paneDirty && !window.confirm('You have unsaved Script or Source edits. The Director may rewrite that file, and saving them after it would be refused. Run the Director anyway?')) return;
  await busy(b, async () => {
    if (what === 'run') await api('/director/run', { method: 'POST', body: { project: S.project } });
    if (what === 'cancel') await api('/director/cancel', { method: 'POST', body: {} });
    if (what === 'unpause') await api('/director/pause', { method: 'DELETE' });
    if (what === 'provider') {
      const f = (k) => $(`#director [data-dir-pf="${k}"]`);
      await api('/director/provider', { method: 'PUT', body: { default: S.director.default, model: f('model').value.trim(), strongModel: f('strongModel').value.trim(), vision: f('vision').checked } });
      S.dirDraft = null;
    }
    toast({ run: 'Director started', cancel: 'Director run cancelled', unpause: 'Pause cleared', provider: 'Director saved. Used from the next run.' }[what]);
    S.dirHtml = null;
    await refreshJobs(false);
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(`Copied: ${text}`); } catch { window.prompt('Copy this command into Claude Code:', text); }
}

/* ---------------- panes ---------------- */
function renderPane() {
  const old = $('#d-pane');
  if (!old) return;
  stopPlay();
  stageRo?.disconnect();
  stageRo = null;
  const pane = old.cloneNode(false);
  old.replaceWith(pane);
  if (S.sub === 'preview') return panePreView(pane);
  if (S.sub === 'script') return paneScript(pane);
  if (S.sub === 'source') return paneSource(pane);
  return paneHistory(pane);
}

let playing = false, raf = 0, sounds = [];
let stageRo = null; // the preview stage's ResizeObserver: one at a time, dropped when the pane is redrawn
function stopPlay() { playing = false; cancelAnimationFrame(raf); sounds.forEach((a) => a.pause()); }

function paneHistory(pane) {
  const h = [...(S.detail.status.history || [])].reverse();
  pane.innerHTML = h.length ? `<div class="hist">${h.map((x) => `<div>${esc(x.at.replace('T', ' ').slice(0, 19))} · ${esc(x.by)} · ${esc(x.event)}</div>`).join('')}</div>` : '<p class="muted">No history yet.</p>';
}

function paneSource(pane) {
  const src = S.detail.source, stamp = S.detail.stamps?.source;
  if (!src) { pane.innerHTML = '<p class="muted">The Director has not written source.json yet.</p>'; return; }
  const locks = src.locks || {};
  const lockTag = (k) => (locks[k] ? `<span class="lock">locked by ${esc(locks[k].by)}</span>` : '');
  pane.innerHTML = `<fieldset class="stack ed" id="pane-ed">
    <p class="muted">Every claim in the video must come from here. Editing here locks that field and asks the Director to rewrite the script.</p>
    <div class="f"><label for="src-name">Product name ${lockTag('name')}</label><input id="src-name" value="${esc(src.name)}"></div>
    <div class="f"><span class="flabel" id="src-bl">Bullets ${lockTag('bullets')} ${locks['bullets.asset'] ? `<span class="lock">screenshots locked by ${esc(locks['bullets.asset'].by)}</span>` : ''}</span><div id="src-bullets" class="scenes" role="group" aria-labelledby="src-bl"></div>
      <button class="btn" id="src-add" type="button">+ Add bullet</button></div>
    ${(src.facts || []).length ? `<div class="f"><span class="flabel" id="src-fl">Other facts (read-only)</span><div class="mono" role="group" aria-labelledby="src-fl">${src.facts.map((f) => `${esc(f.text)} · <span class="muted">${esc(f.ref)}</span>`).join('<br>')}</div></div>` : ''}
    <div class="savebar">
      <div class="row"><button class="btn p" id="src-save">Save source</button>
        <input id="src-note" class="note" maxlength="200" placeholder="Reason for the edit (optional), e.g. drop claim pending QA" aria-label="Reason for the edit">
        <span class="muted small">Needs a Director run. Screenshots alone keep the status.</span></div>
      <p class="warn-t small" id="pane-lock" role="status"></p>
      <div class="err" role="alert" id="src-err"></div></div></fieldset>`;
  let bullets = src.bullets.map((b) => ({ ...b }));
  const shots = S.detail.assets.filter((a) => SHOT_RE.test(a));
  const shotUrl = (a) => `/assets/${encodeURIComponent(S.project)}/${encodeURIComponent(a)}`;
  const shotOptions = (sel) => `<option value="">(none)</option>${shots.map((a) => `<option ${sel === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}${sel && !shots.includes(sel) ? `<option value="${esc(sel)}" selected>${esc(sel)} (missing)</option>` : ''}`;
  const thumb = (i, a) => `<img class="bthumb" id="b-img-${i}" alt="${a ? `Screenshot ${esc(a)}` : ''}"${a ? ` src="${shotUrl(a)}"` : ' hidden'}>`;
  const draw = () => {
    $('#src-bullets').innerHTML = bullets.map((b, i) => `<div class="scene"><div class="grid2">
      <div class="f"><label for="b-t-${i}">Text</label><textarea id="b-t-${i}" data-i="${i}" data-k="text">${esc(b.text)}</textarea></div>
      <div class="f"><label for="b-r-${i}">Source (ref)</label><input id="b-r-${i}" data-i="${i}" data-k="ref" value="${esc(b.ref)}">
      <button class="btn" type="button" data-del="${i}" aria-label="Delete bullet ${i + 1}">Delete</button></div>
      <div class="f"><label for="b-a-${i}">Screenshot (optional)</label>
        <div class="row"><select id="b-a-${i}" data-i="${i}" data-k="asset" aria-describedby="b-a-${i}-h">${shotOptions(b.asset)}</select>${thumb(i, b.asset)}</div>
        <span class="hint muted" id="b-a-${i}-h">The image that shows this claim. Upload images in the Brand tab → Assets.</span></div></div></div>`).join('');
  };
  draw();
  pane.addEventListener('input', (e) => {
    S.paneDirty = true;
    const el = e.target;
    if (el.dataset.k !== 'asset') { if (el.dataset.k) bullets[+el.dataset.i][el.dataset.k] = el.value; return; }
    const b = bullets[+el.dataset.i];
    if (el.value) b.asset = el.value; else delete b.asset;
    $(`#b-img-${el.dataset.i}`).outerHTML = thumb(el.dataset.i, b.asset);
  });
  pane.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { bullets.splice(+del.dataset.del, 1); S.paneDirty = true; draw(); }
  });
  $('#src-add').addEventListener('click', () => { bullets.push({ text: '', ref: '' }); S.paneDirty = true; draw(); });
  $('#src-save').addEventListener('click', (e) => guarded(jobKey(), e.currentTarget, async () => {
    const doc = { ...src, name: $('#src-name').value.trim(), bullets };
    delete doc.locks;
    const r = await api(`/jobs/${jobPath()}/source`, { method: 'PUT', body: { doc, note: $('#src-note').value, stamp } });
    S.paneDirty = false;
    toast(!r.changed.length ? 'Nothing changed'
      : r.statusKept ? 'Screenshots saved. No claim changed, so the job status stays as it is.'
      : `Saved: ${r.changed.join(', ')}. Needs a Director run.`);
    await loadDetail(true);
  }, $('#src-err')));
  lockPane();
}

function paneScript(pane) {
  const d = S.detail, sc = d.script, stamp = d.stamps?.script;
  if (!sc) { pane.innerHTML = '<p class="muted">The Director has not written script.json yet.</p>'; return; }
  const tpl = d.template, locks = sc.locks || {};
  const help = d.help || { kinds: {}, fields: {} };
  const scenes = sc.scenes.map((s) => JSON.parse(JSON.stringify(s)));
  const kinds = Object.keys(tpl.fields);
  // Footage templates pick video files for their clips; every other template picks images.
  const footage = tpl.audio === 'footage';
  // A footage template picks clips for asset (sound files too when it plays sound only); image always picks pictures.
  const clipRe = tpl.footage === 'audio' ? /\.(mp4|webm|mov|wav|mp3)$/i : /\.(mp4|webm|mov)$/i;
  const pictures = d.assets.filter((a) => /\.(png|jpe?g|webp|svg)$/i.test(a));
  const images = footage ? d.assets.filter((a) => clipRe.test(a)) : pictures;
  const uploadHint = ' Upload… adds a file to the brand assets and picks it here.';
  const JSON_FIELDS = new Set(['data', 'assistant', 'shots', 'items', 'parts', 'people', 'points', 'labels', 'before', 'after', 'periods', 'series', 'values', 'lines', 'files', 'highlight', 'band', 'ref', 'photos', 'view', 'path', 'explode', 'decal']);
  // Code listings keep their line breaks and indentation, so they get a monospace text area.
  const BLOCK_FIELDS = new Set(['code', 'before', 'after']);

  // A mixed brief's extra kinds are "<template>.<kind>"; their limits and enums live in tpl.sources[<template>].
  const tplOf = (kind) => (kind.includes('.') ? kind.slice(0, kind.indexOf('.')) : '');
  const bare = (kind) => kind.slice(kind.indexOf('.') + 1);
  const rulesFor = (kind) => tpl.sources?.[tplOf(kind)] || tpl;
  const newId = (kind) => { const k = bare(kind); let n = 1; while (scenes.some((s) => s.id === `${k}-${n}`)) n++; return `${k}-${n}`; };
  const defaultFor = (f, kind, at) => {
    const r = rulesFor(kind);
    switch (f) {
      case 'vo': return PLACEHOLDER_VO;
      case 'title': return 'New scene';
      case 'kicker': return 'New';
      case 'text': return 'New line';
      case 'chip': return 'New';
      case 'button': return 'Book a walkthrough';
      case 'icon': return Object.keys(d.icons)[0];
      case 'stat': return { value: 1, unit: '' };
      case 'source': return '';
      case 'shots': return images.length ? [{ asset: images[0], focus: null }] : [];
      case 'layout': return scenes.slice(0, at).some((s) => s.kind === kind && s.layout) ? 'same' : (r.enums?.layout || ['same'])[0];
      default: return (r.enums?.[f] || [])[0] ?? '';
    }
  };
  const makeScene = (kind, at) => {
    const s = { id: newId(kind), kind, ...structuredClone(tpl.defaults?.[kind] || {}) };
    for (const f of tpl.fields[kind].required) if (s[f] === undefined) s[f] = defaultFor(f, kind, at);
    return s;
  };

  // Claim source choices: the job's source.json bullets and facts, then the brief's own lines.
  const src = d.source || {};
  const refs = [
    ...(src.bullets || []).map((b, i) => [`bullets[${i}]`, b.text]),
    ...(src.facts || []).map((b, i) => [`facts[${i}]`, b.text]),
    ...(d.brief.message ? [['brief.message', d.brief.message]] : []),
    ...(d.brief.cta ? [['brief.cta', d.brief.cta]] : []),
  ];
  const sourceSelect = (s, attrs) => {
    const v = s.source ?? '';
    const known = !v || refs.some(([r]) => r === v);
    return `<select ${attrs}><option value="">(none)</option>${refs.map(([r, t]) => `<option value="${esc(r)}"${r === v ? ' selected' : ''}>${esc(`${r} — ${cut(String(t ?? ''), 70)}`)}</option>`).join('')}${known ? '' : `<option value="${esc(v)}" selected>${esc(v)}</option>`}</select>`;
  };

  // Quick mode: what the Director's outline said (outline.json, engine/quick.mjs), read-only; the scenes below are what
  // the engine built from it. Every value is printed as text, whatever its type.
  const outlineHtml = (o) => {
    const part = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const txt = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v));
    const head = part(o.headline), cta = part(o.cta), points = (Array.isArray(o.points) ? o.points : []).map(part);
    const srcLine = (r) => {
      if (!txt(r)) return '';
      const line = refs.find(([k]) => k === txt(r))?.[1];
      return `<span class="small muted">Source <code>${esc(txt(r))}</code> ${line ? esc(`— ${cut(String(line), 90)}`) : '(not in source.json)'}</span>`;
    };
    const voice = (x) => (txt(x.say) && txt(x.say) !== txt(x.text) ? `<span class="small">Voice: ${esc(txt(x.say))}</span>` : '');
    const num = (n) => (n && typeof n === 'object' ? `${txt(n.value)}${txt(n.unit) ? ` ${txt(n.unit)}` : ''}` : '');
    const extras = (p) => {
      const list = [txt(p.tag) && `tag ${txt(p.tag)}`, num(p.number) && `number ${num(p.number)}`, txt(p.icon) && `icon ${txt(p.icon)}`].filter(Boolean);
      return list.length ? `<span class="small muted">${esc(list.join(' · '))}</span>` : '';
    };
    const mood = esc(txt(o.mood) || 'not set (default)');
    return `<details class="howto outline"><summary>Outline from the Director <span class="muted small">${points.length} point(s), mood ${mood}</span></summary>
      <dl class="olist">
        <dt>Headline</dt><dd><b>${esc(txt(head.text))}</b>${voice(head)}${srcLine(head.source)}</dd>
        <dt>Points</dt><dd><ol>${points.map((p) => `<li><span><b>${esc(txt(p.label))}</b> ${esc(txt(p.text))}</span>${extras(p)}${voice(p)}${srcLine(p.source)}</li>`).join('')}</ol></dd>
        ${txt(cta.text) || txt(cta.button) ? `<dt>Call to action</dt><dd><span>${esc(txt(cta.text))}${txt(cta.button) ? ` <span class="pill">${esc(txt(cta.button))}</span>` : ''}</span>${voice(cta)}${srcLine(cta.source)}</dd>` : ''}
        <dt>Mood</dt><dd>${mood}${txt(o.lang) ? ` · language ${esc(txt(o.lang))}` : ''}</dd>
      </dl></details>`;
  };

  // A bullet's screenshot fills the scene's image field (shots[0].asset or asset); footage templates take clips, not images.
  const imageField = (s) => {
    const spec = tpl.fields[s.kind];
    return footage || !spec ? '' : shotField([...spec.required, ...spec.optional]);
  };
  const shotNote = (s) => {
    const shot = bulletShot(src, s.source);
    if (!shot) return '';
    const offer = shotAction(s, imageField(s), shot, images[0]);
    return `<span class="hint muted">📷 ${esc(shot)}${offer ? ` <button class="btn sm" type="button" data-useshot="${esc(s.id)}">Use bullet screenshot (${esc(shot)})</button>` : ''}</span>`;
  };

  // The template's sequence check (validateScript), so the picker can refuse a kind before the save does.
  const seqError = (list) => {
    let i = 0;
    for (const slot of tpl.sequence) {
      let n = 0;
      while (i < list.length && slot.kind.includes(list[i]) && n < slot.max) { i++; n++; }
      if (n < slot.min) return `position ${i + 1} needs ${slot.min === slot.max ? slot.min : `${slot.min}-${slot.max}`} ${slot.kind.map(bare).join('/')} scene(s)`;
    }
    return i < list.length ? `a ${bare(list[i])} scene cannot be at position ${i + 1}` : '';
  };
  const whyNot = (k, at) => {
    const now = scenes.map((s) => s.kind);
    if (seqError(now) || !seqError([...now.slice(0, at), k, ...now.slice(at)])) return '';
    const slots = tpl.sequence.filter((sl) => sl.kind.includes(k));
    const max = slots.reduce((a, sl) => a + sl.max, 0);
    const used = now.filter((x) => slots.some((sl) => sl.kind.includes(x))).length;
    return used >= max ? `at most ${max} in this video` : 'not allowed at this position';
  };

  // A cta's image is its background photo; everywhere else the shared label.
  const labelOf = (s, f) => (f === 'image' && bare(s.kind) === 'cta' ? 'Background photo' : FIELD_LABEL[f] || f);
  const fieldHtml = (s, f) => {
    const id = esc(`sc-${s.id}-${f}`), sid = esc(s.id);
    const lk = locks[`scene:${s.id}.${f}`];
    const lock = lk ? `<span class="lock">locked by ${esc(lk.by)}</span>` : '';
    const label = `<label for="${id}">${esc(labelOf(s, f))} ${lock}</label>`;
    const { limits = {}, enums = {}, marks } = rulesFor(s.kind);
    const markable = marks === true && MARK_FIELDS.includes(f);
    const pick = assetPick(f, footage ? tpl.footage || true : false);
    const hint = (help.fields[s.kind]?.[f] || '') + (pick ? uploadHint : f === 'shots' ? ' Upload images in the Brand tab → Assets.' : '') + (markable ? MARK_HINT : '');
    const tip = hint ? `<span class="hint muted" id="${id}-h">${esc(hint.trim())}</span>` : '';
    const attrs = `id="${id}" data-s="${sid}" data-f="${esc(f)}"${hint ? ` aria-describedby="${id}-h"` : ''}`;
    // A mark's [[style:…]] does not count toward the limit; the server checks the text as it reads on screen.
    const max = limits[f] ? ` maxlength="${limits[f] + (markable ? 2 * MARK_SYNTAX : 0)}"` : '';
    if (f === 'vo') return `<div class="f" style="grid-column:1/-1">${label}<textarea ${attrs}>${esc(s.vo)}</textarea>${tip}</div>`;
    if (BLOCK_FIELDS.has(f)) return `<div class="f" style="grid-column:1/-1">${label}<textarea ${attrs} class="mono" spellcheck="false" rows="${Math.min(18, Math.max(4, String(s[f] ?? '').split('\n').length + 1))}">${esc(s[f] ?? '')}</textarea>${tip}</div>`;
    if (f === 'stat') return `<div class="f">${label}<div class="row"><input ${attrs.replace(`data-f="${f}"`, 'data-f="stat.value"')} type="number" step="any" value="${esc(s.stat?.value)}" style="width:110px"><input aria-label="Unit" data-s="${sid}" data-f="stat.unit" value="${esc(s.stat?.unit)}" maxlength="12" style="width:120px"></div>${tip}</div>`;
    if (f === 'check') return `<div class="f">${label}<label class="chk"><input ${attrs} type="checkbox" ${s.check ? 'checked' : ''}> Show a tick mark</label>${tip}</div>`;
    if (f === 'icon') {
      const opt = (n) => `<option ${s.icon === n ? 'selected' : ''}>${esc(n)}</option>`;
      const own = Object.keys(d.icons).filter((n) => d.brandIcons.includes(n));
      const builtIn = Object.keys(d.icons).filter((n) => !d.brandIcons.includes(n));
      return `<div class="f">${label}<div class="row iconpick"><select ${attrs}><option value="">(none)</option>
        <optgroup label="Built-in">${builtIn.map(opt).join('')}</optgroup>${own.length ? `<optgroup label="This brand">${own.map(opt).join('')}</optgroup>` : ''}</select>
        <span class="iconprev" id="${id}-prev">${iconSvg(d.icons[s.icon])}</span></div>${tip}</div>`;
    }
    // A file field: the brand assets of its type, and an Upload button that adds one and picks it.
    if (pick) {
      const list = d.assets.filter((a) => pick.re.test(a));
      const known = !s[f] || list.includes(s[f]);
      return `<div class="f">${label}<div class="row"><select ${attrs}><option value="">(none)</option>${list.map((a) => `<option ${s[f] === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}${known ? '' : `<option selected>${esc(s[f])}</option>`}</select>
        <button class="btn sm" type="button" data-pickup="${id}">Upload…</button><input type="file" id="${id}-file" data-ups="${sid}" data-upf="${esc(f)}" accept="${pick.accept}" hidden></div>
        <span class="small" id="${id}-up" role="status"></span>${tip}</div>`;
    }
    if (f === 'sound') return `<div class="f">${label}<label class="chk"><input ${attrs} type="checkbox" ${s.sound ? 'checked' : ''}> Play the clip's own sound</label>${tip}</div>`;
    if (f === 'shadow') return `<div class="f">${label}<label class="chk"><input ${attrs} type="checkbox" ${s.shadow === false ? '' : 'checked'}> Soft shadow under the model</label>${tip}</div>`;
    if (f === 'source') return `<div class="f">${label}${sourceSelect(s, attrs)}${shotNote(s)}${tip}</div>`;
    if (enums[f]) return `<div class="f">${label}<select ${attrs}><option value="">(default)</option>${enums[f].map((n) => `<option value="${esc(n)}"${s[f] === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>${tip}</div>`;
    if (JSON_FIELDS.has(f) || (s[f] && typeof s[f] === 'object')) {
      const txt = s[f] === undefined ? '' : JSON.stringify(s[f], null, 1);
      return `<details class="f jsonf" style="grid-column:1/-1"><summary>${esc(FIELD_LABEL[f] || f)} (JSON) ${lock}</summary>
        <textarea ${attrs} class="mono" rows="${Math.min(18, Math.max(4, txt.split('\n').length))}" data-json="1">${esc(txt)}</textarea>${tip}</details>`;
    }
    return `<div class="f">${label}<input ${attrs} value="${esc(s[f] ?? '')}"${max}>${tip}</div>`;
  };

  // A scene's direction: its entrance, a camera move over its main picture or clip, its own colour grade.
  const directionHtml = (s, i) => {
    const sid = esc(s.id), id = (f) => esc(`sc-${s.id}-${f}`);
    const opts = (list, cur, none) => `<option value="">${none}</option>${list.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}`;
    const set = [s.cut, s.camera, s.grade, s.drop, s.cutout].filter((v) => v !== undefined).length;
    const custom = s.camera && typeof s.camera === 'object';
    return `<details class="more"><summary>Direction <span class="muted">· ${set ? `${set} set` : 'as the brand'}</span></summary><div class="grid2">
      ${i === 0 ? '' : `<div class="f"><label for="${id('cut')}">Cut into this scene</label><select id="${id('cut')}" data-s="${sid}" data-f="cut">${opts(CUT_OPTIONS, s.cut, "The brand's cut")}</select></div>`}
      <div class="f"><label for="${id('camera')}">Camera</label><select id="${id('camera')}" data-s="${sid}" data-f="camera">${custom ? '<option value="" disabled selected>Custom (from script.json)</option>' : ''}${opts(CAMERA_OPTIONS, s.camera, 'Still')}</select></div>
      <div class="f"><label for="${id('grade')}">Colour grade</label><select id="${id('grade')}" data-s="${sid}" data-f="grade">${opts(SCENE_GRADE_OPTIONS, s.grade, "The brand's grade")}</select></div>
      <div class="f"><label class="chk"><input type="checkbox" id="${id('drop')}" data-s="${sid}" data-f="drop" ${s.drop === true ? 'checked' : ''}> The music's drop lands here</label>
        <label class="chk"><input type="checkbox" id="${id('cutout')}" data-s="${sid}" data-f="cutout" ${s.cutout === true ? 'checked' : ''}> Subject in front of the text</label></div></div>
      <span class="hint muted">The camera moves over the scene's main picture or clip, the one that fills most of the frame. The grade applies to this scene's pictures and clips. The drop moves the brand music so its drop (where it gets loud) starts with this scene; one scene per video. Subject in front of the text cuts the person or product out of the scene's picture and puts it over the heading (needs a segmentation model in models/matte/). Applies when the storyboard is rebuilt.</span></details>`;
  };

  const draftHtml = (s, fields) => `<div class="draftbox">
      <p>The Director writes this scene from your request on its next run. Its kind, position and claim source stay as you set them.</p>
      <div class="f"><label for="sc-${esc(s.id)}-note">Request for the Director</label>
        <input id="sc-${esc(s.id)}-note" data-s="${esc(s.id)}" data-f="draft.note" maxlength="${DRAFT_NOTE_MAX}" value="${esc(s.draft.note || '')}" placeholder="e.g. show the Subscriptions page with 3 active plans" aria-describedby="sc-${esc(s.id)}-note-h">
        <span class="hint muted" id="sc-${esc(s.id)}-note-h">One line, ${DRAFT_NOTE_MAX} characters at most: what the scene should show. The claim comes from the source below.</span></div>
      ${fields.includes('source') ? fieldHtml(s, 'source') : ''}</div>`;

  // Problems the save would refuse (bad) or that the storyboard would show (warn), listed before the save.
  const checks = () => {
    const out = [];
    const seq = seqError(scenes.map((s) => s.kind));
    if (seq) out.push(['bad', `Scene order: ${seq}. Move, add or delete a scene.`]);
    for (const s of scenes) {
      const spec = tpl.fields[s.kind];
      if (!spec) continue;
      if (s.draft) { if (!String(s.draft.note || '').trim()) out.push(['bad', `${s.id}: write the request for the Director.`]); continue; }
      const miss = spec.required.filter((f) => s[f] === undefined || s[f] === null || s[f] === '' || (Array.isArray(s[f]) && !s[f].length));
      if (miss.length) out.push(['bad', `${s.id}: fill ${miss.map((f) => FIELD_LABEL[f] || f).join(', ')}.`]);
      // An emptied Number field leaves no value, never a silent 0.
      else if (s.stat && [...spec.required, ...spec.optional].includes('stat') && !Number.isFinite(s.stat.value)) out.push(['bad', `${s.id}: fill ${FIELD_LABEL.stat} with a number.`]);
      if (String(s.vo ?? '').trim() === PLACEHOLDER_VO) out.push(['warn', `${s.id}: replace the placeholder voice line.`]);
    }
    const n = scenes.filter((s) => s.draft).length;
    if (n) out.push(['info', `${n} draft scene(s): saving sends this job back to the Director.`]);
    return out;
  };
  const drawChecks = () => {
    const c = checks();
    $('#sc-check').innerHTML = c.length ? `<ul class="findings">${c.map(([lv, m]) => `<li class="${lv === 'bad' ? 'error' : lv === 'warn' ? 'warning' : ''}">${esc(m)}</li>`).join('')}</ul>` : '';
  };

  const timingOf = (id) => d.timing?.scenes.find((x) => x.id === id);
  const stillOf = (id) => (d.status.stills || []).find((x) => x.id === id);
  const stillBase = `/files/${jobPath()}`, stillStamp = encodeURIComponent(d.status.updatedAt || '');
  // The still is from the last storyboard; a scene edited since then shows its old look until the next prepare.
  const stillBtn = (s) => {
    const st = stillOf(s.id);
    return st ? `<button class="sthumb" type="button" data-goto="${esc(st.t)}" title="Play this scene in Preview from ${esc(st.t)}s" aria-label="Show ${esc(s.id)} in Preview at ${esc(st.t)}s">
      <img src="${fileUrl(stillBase, st.file)}?v=${stillStamp}" alt="" loading="lazy"><span>▶ ${esc(st.t)}s</span></button>` : '';
  };
  const kindOpt = (k, at, first) => {
    const why = whyNot(k, at), about = help.kinds[k] || '';
    return `<option value="${esc(k)}"${why ? ' disabled' : first ? ' selected' : ''} title="${esc(why || about)}">${esc(`${bare(k)}${why ? ` (${why})` : about ? ` — ${cut(about, 80)}` : ''}`)}</option>`;
  };
  const kindOpts = (at) => {
    const first = kinds.find((k) => !whyNot(k, at));
    const opt = (k) => kindOpt(k, at, k === first);
    return !tpl.mixed ? kinds.map(opt).join('')
      : [tpl.lead, ...tpl.mix].map((id) => `<optgroup label="${esc(tpl.sources[id]?.label || id)}">${kinds.filter((k) => (tplOf(k) || tpl.lead) === id).map(opt).join('')}</optgroup>`).join('');
  };
  // A position where no kind fits gets no add row at all.
  const addRow = (at) => {
    if (!kinds.some((k) => !whyNot(k, at))) return '';
    return `<div class="addrow"><select data-addkind="${at}" aria-label="Kind of the new scene at position ${at + 1}">${kindOpts(at)}</select>
      <button class="btn" type="button" data-add="${at}">+ Add scene here</button>
      <button class="btn" type="button" data-add="${at}" data-asdraft="1">+ Draft for Director</button></div>`;
  };

  // The files a scene uses (every file field its kind has), each with a preview: Upload new replaces it, Remove clears
  // an optional one, Add fills an empty one. The fields below hold the same values; this is the quick way in.
  const assetSrc = (a) => `/assets/${encodeURIComponent(S.project)}/${encodeURIComponent(a)}`;
  const GLYPHS = { video: '▶', model: '3D', animation: '✦', audio: '♪' };
  const mediaStrip = (s, spec) => {
    const fields = [...spec.required, ...spec.optional].filter((f) => assetPick(f));
    if (!fields.length) return '<p class="muted small media-none">This scene kind uses no picture, clip or model.</p>';
    return `<div class="media" aria-label="Files in ${esc(s.id)}">${fields.map((f) => {
      const id = esc(`sc-${s.id}-${f}`), v = s[f], req = spec.required.includes(f);
      const kind = v ? assetKind(v) : '';
      const prev = !v ? '<span class="mprev empty" aria-hidden="true">+</span>'
        : kind === 'image' ? `<img class="mprev" src="${assetSrc(v)}" alt="">` : `<span class="mprev glyph" aria-hidden="true">${GLYPHS[kind] || '·'}</span>`;
      return `<div class="mitem">${prev}<div class="mtxt"><span class="small muted">${esc(labelOf(s, f))}${req ? '' : ' (optional)'}</span><span class="mono small">${v ? esc(v) : 'none'}</span>
        <span class="row"><button class="btn sm" type="button" data-pickup="${id}">${v ? 'Upload new…' : 'Add…'}</button>${v && !req ? `<button class="btn sm" type="button" data-mclear="${esc(s.id)}:${esc(f)}">Remove</button>` : ''}</span></div></div>`;
    }).join('')}</div>`;
  };

  const draw = () => {
    $('#sc-list').innerHTML = addRow(0) + scenes.map((s, i) => {
      const t = timingOf(s.id);
      const spec = tpl.fields[s.kind] || { required: [], optional: [] };
      const fields = [...spec.required, ...spec.optional];
      return `<div class="scene${s.draft ? ' is-draft' : ''}" data-i="${i}" data-sid="${esc(s.id)}"><div class="sh">${stillBtn(s)}<b>${i + 1}. ${esc(s.id)}</b><span class="pill">${esc(s.kind)}</span>
        ${s.draft ? '<span class="pill draft">draft for Director</span>' : ''}
        ${t ? `<span class="mono muted">${t.start.toFixed(2)}s → ${t.end.toFixed(2)}s</span>` : '<span class="mono muted">new</span>'}
        <span class="sbtns">
          <button class="btn sm" type="button" data-move="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(s.id)} up">↑</button>
          <button class="btn sm" type="button" data-move="${i}:1" ${i === scenes.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(s.id)} down">↓</button>
          <button class="btn sm" type="button" data-todraft="${i}">${s.draft ? 'Write it myself' : 'Draft for Director'}</button>
          <button class="btn sm" type="button" data-dup="${i}" aria-label="Duplicate ${esc(s.id)}">Duplicate</button>
          <button class="btn sm" type="button" data-del="${i}" aria-label="Delete ${esc(s.id)}">Delete</button>
        </span></div>
        ${help.kinds[s.kind] ? `<p class="muted kindhelp">${esc(help.kinds[s.kind])}</p>` : ''}
        ${s.draft ? '' : mediaStrip(s, spec)}
        ${s.draft ? draftHtml(s, fields) : `<div class="grid2">${fields.map((f) => fieldHtml(s, f)).join('')}</div>${directionHtml(s, i)}`}</div>${addRow(i + 1)}`;
    }).join('');
    drawChecks();
  };

  const saved = S.scriptWarnings;
  S.scriptWarnings = null;
  // The script's look (engine/looks.mjs); undefined keeps the brand. Picking Brand on a script without one changes nothing.
  let look = sc.look;
  pane.innerHTML = `<fieldset class="stack ed" id="pane-ed" style="max-width:none">
    <details class="howto"><summary>How scenes work</summary><ul>
      <li>A scene is one shot on screen plus one voice line. It lasts as long as its voice line.</li>
      <li><b>Title</b>, <b>Kicker</b> and <b>Subtitle</b> are the on-screen text. The kicker is the small label above the title.</li>
      <li><b>Claim source</b> names the fact in the Source tab that backs the scene, e.g. <code>bullets[1]</code>. Nothing on screen may be invented.</li>
      <li><b>Pace</b> sets how long a scene holds: quick, normal or focus.</li>
      <li><b>JSON</b> fields hold lists and screen data. Tip: Duplicate a similar scene and edit the copy.</li>
      <li><b>Draft for Director</b>: pick the kind, the position and the claim source, write one line about what the scene should show, and the Director writes it on its next run.</li>
    </ul></details>
    <p class="muted">Edit, add, duplicate, delete or reorder scenes. Saving locks what you changed (and the scene order) and moves the job to "needs a new storyboard". The template checks the order and required fields on save.</p>
    ${locks.scenes ? `<p class="lock">Scene order locked by ${esc(locks.scenes.by)}: the Director keeps this order.</p>` : ''}
    ${sc.generated === 'outline' ? `<div class="banner" role="note"><p><b>Built from an outline (quick mode).</b>${REVIEW ? '' : ' Your edits lock as usual; the Director\'s next run writes a new outline and keeps locked fields.'}</p></div>` : ''}
    ${d.outline ? outlineHtml(d.outline) : ''}
    <div class="f lookrow"><label for="sc-look">Look ${locks.look ? `<span class="lock">locked by ${esc(locks.look.by)}</span>` : ''}</label>
      <select id="sc-look" aria-describedby="sc-look-h">${[LOOK_BRAND, ...(d.looks || [])].map((n) => `<option value="${esc(n)}"${n === (look ?? LOOK_BRAND) ? ' selected' : ''}>${esc(n === LOOK_BRAND ? 'Brand (as set in the Brand tab)' : n[0].toUpperCase() + n.slice(1))}</option>`).join('')}</select>
      <span class="hint muted" id="sc-look-h">Motion, backdrop, cut sound and music for this video. What the Brand tab sets wins; the look fills the rest. Applies when the storyboard is rebuilt.</span></div>
    ${saved?.length ? `<div class="banner warn" role="status"><p>Saved with warnings:<br>${saved.map(esc).join('<br>')}</p></div>` : ''}
    ${REVIEW ? '' : '<div id="sc-cloud" aria-live="polite"></div>'}
    <div class="scenes" id="sc-list"></div>
    <div class="savebar">
      <div id="sc-check" aria-live="polite"></div>
      <div class="row"><button class="btn p" id="sc-save">Save script</button>
        <input id="sc-note" class="note" maxlength="200" placeholder="Reason for the edit (optional)" aria-label="Reason for the edit">
        <span class="muted small">Then rebuild the storyboard, or run the Director when there are drafts.</span></div>
      <p class="warn-t small" id="pane-lock" role="status"></p>
      <div class="err" role="alert" id="sc-err"></div></div></fieldset>`;
  draw();
  if (S.jump?.scene) {
    const el = pane.querySelector(`[data-sid="${CSS.escape(S.jump.scene)}"]`);
    S.jump = null;
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
      el.classList.add('flash');
      el.querySelector('textarea,input,select')?.focus({ preventScroll: true });
    }
  }

  if (!REVIEW) cloudVoicePanel($('#sc-cloud'), jobPath());
  const find = (id) => scenes.find((s) => s.id === id);
  const drawChecksSoon = () => queueMicrotask(drawChecks);
  $('#sc-look').addEventListener('change', (e) => {
    look = e.target.value === LOOK_BRAND && sc.look === undefined ? undefined : e.target.value;
    S.paneDirty = true;
  });
  pane.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.f) return;
    S.paneDirty = true;
    const s = find(el.dataset.s);
    const f = el.dataset.f;
    drawChecksSoon();
    if (f === 'draft.note') s.draft = { ...s.draft, note: el.value };
    else if (f === 'stat.value') {
      const v = parseNum(el.value);
      s.stat = { ...(s.stat || {}), value: v };
      if (!Number.isFinite(v)) delete s.stat.value;
    }
    else if (f === 'stat.unit') s.stat = { ...(s.stat || {}), unit: el.value };
    else if (f === 'check') { if (el.checked) s.check = true; else delete s.check; }
    else if (f === 'sound') { if (el.checked) s.sound = true; else delete s.sound; }
    else if (f === 'drop' || f === 'cutout') { if (el.checked) s[f] = true; else delete s[f]; }
    else if (f === 'shadow') s.shadow = el.checked;
    else if (f === 'in' || f === 'out') { if (el.value === '') delete s[f]; else s[f] = Number(el.value); }
    else if (f === 'icon') {
      if (el.value) s.icon = el.value; else delete s.icon;
      const prev = $(`#${CSS.escape(`sc-${s.id}-icon-prev`)}`);
      if (prev) prev.innerHTML = iconSvg(d.icons[el.value]);
    }
    else if (el.dataset.json) {
      if (!el.value.trim()) { delete s[f]; el.setCustomValidity(''); return; }
      try { s[f] = JSON.parse(el.value); el.setCustomValidity(''); } catch { el.setCustomValidity('Invalid JSON'); }
    } else if (el.tagName === 'SELECT' && el.value === '') delete s[f];
    else s[f] = el.value;
    // A file picked in a field shows at once in the scene's file strip.
    if (assetPick(f)) { draw(); $(`#${CSS.escape(`sc-${s.id}-${f}`)}`)?.focus(); }
    if (f === 'source') {
      const field = imageField(s), shot = bulletShot(src, s.source);
      if (shotAction(s, field, shot, images[0]) === 'set') scenes[scenes.indexOf(s)] = applyShot(s, field, shot);
      draw();
      $(`#${CSS.escape(`sc-${s.id}-source`)}`)?.focus();
    }
  });
  // Upload from a file field: the file goes to the brand assets (the Brand tab's checks and route), then the scene picks it.
  pane.addEventListener('click', (e) => {
    if (REVIEW) return;
    const b = e.target.closest('button[data-pickup]');
    if (b) $(`#${CSS.escape(b.dataset.pickup)}-file`)?.click();
    const c = e.target.closest('button[data-mclear]');
    if (c) {
      const [sid, f] = c.dataset.mclear.split(':');
      delete find(sid)[f];
      S.paneDirty = true;
      draw();
    }
  });
  pane.addEventListener('change', async (e) => {
    const el = e.target;
    if (!el.dataset.upf || !el.files?.length) return;
    const file = el.files[0], s = find(el.dataset.ups), f = el.dataset.upf;
    el.value = '';
    const st = $(`#${CSS.escape(`sc-${s.id}-${f}`)}-up`);
    const say = (text, cls) => { if (st) { st.className = `small ${cls}`; st.textContent = text; } };
    try {
      const o = S.options || (S.options = await api('/options'));
      const why = uploadProblem(file, o.assetTypes, o.maxAssetMB * 1024 * 1024, o.maxVideoMB * 1024 * 1024);
      if (why) { say(why, 'bad-t'); return; }
      const data = await postFile(`/projects/${encodeURIComponent(S.project)}/assets?name=${encodeURIComponent(file.name)}&replace=0`, file, 'application/octet-stream', (p) => say(`uploading ${Math.round(p * 100)}%`, 'muted'));
      if (!d.assets.includes(data.name)) d.assets = [...d.assets, data.name].sort();
      s[f] = data.name;
      S.paneDirty = true;
      draw();
      toast(`Uploaded ${data.name} and picked it for ${s.id}`);
    } catch (err) { say(err.message, 'bad-t'); }
  });
  pane.addEventListener('click', (e) => {
    const go = e.target.closest('button[data-goto]');
    if (go) { goSub('preview', { t: Number(go.dataset.goto) }); return; }
    const b = e.target.closest('button[data-move],button[data-dup],button[data-del],button[data-add],button[data-todraft],button[data-useshot]');
    if (!b) return;
    if (b.dataset.useshot) {
      const i = scenes.findIndex((s) => s.id === b.dataset.useshot);
      scenes[i] = applyShot(scenes[i], imageField(scenes[i]), bulletShot(src, scenes[i].source));
    } else if (b.dataset.todraft) {
      const s = scenes[Number(b.dataset.todraft)];
      if (s.draft) delete s.draft; else s.draft = { note: '' };
    } else if (b.dataset.move) {
      const [i, dir] = b.dataset.move.split(':').map(Number);
      const j = i + dir;
      if (j < 0 || j >= scenes.length) return;
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    } else if (b.dataset.dup) {
      const i = Number(b.dataset.dup);
      const copy = JSON.parse(JSON.stringify(scenes[i]));
      copy.id = newId(copy.kind);
      scenes.splice(i + 1, 0, copy);
    } else if (b.dataset.del) {
      const i = Number(b.dataset.del);
      if (!window.confirm(`Delete scene "${scenes[i].id}"?`)) return;
      scenes.splice(i, 1);
    } else if (b.dataset.add) {
      const at = Number(b.dataset.add);
      const kind = pane.querySelector(`select[data-addkind="${at}"]`).value;
      const why = kinds.includes(kind) ? whyNot(kind, at) : 'pick a kind first';
      if (why) { $('#sc-err').textContent = `Cannot add ${bare(kind)} here: ${why}.`; return; }
      const s = makeScene(kind, at);
      if (b.dataset.asdraft) s.draft = { note: '' };
      scenes.splice(at, 0, s);
      $('#sc-err').textContent = '';
    }
    S.paneDirty = true;
    draw();
  });
  $('#sc-save').addEventListener('click', (e) => guarded(jobKey(), e.currentTarget, async () => {
    const bad = pane.querySelector('textarea[data-json]:invalid');
    if (bad) throw new Error(`Fix the JSON in ${bad.dataset.s} → ${bad.dataset.f} first`);
    const doc = { ...sc, scenes };
    delete doc.locks;
    if (look === undefined) delete doc.look; else doc.look = look;
    const r = await api(`/jobs/${jobPath()}/script`, { method: 'PUT', body: { doc, note: $('#sc-note').value, stamp } });
    S.paneDirty = false;
    S.scriptWarnings = r.warnings || null;
    const drafts = scenes.filter((s) => s.draft).length;
    toast(!r.changed.length ? 'Nothing changed'
      : drafts ? `Saved. ${drafts} draft scene(s) waiting — click Run Director for this job.`
      : `Saved ${r.changed.length} change(s). Click "Rebuild storyboard".`);
    await loadDetail(true);
  }, $('#sc-err')));
  lockPane();
}

// The job's frame size, as the engine picks it (sizeFor): one size per format, else the template's single size.
function frameSize(d) {
  const s = d.template?.sizes?.[d.brief?.format];
  const [w, h] = s || (d.template?.size ? [d.template.size.width, d.template.size.height] : [1080, 1920]);
  return { w: Number(w) || 1080, h: Number(h) || 1920 };
}

// Review sheet and pacing table (engine/review.mjs), fetched once per job and storyboard.
const PACE_FLAGS = { fast: 'fast', slowTail: 'long tail', dead: 'no sound', repeat: 'same layout', silence: 'too much silence' };
let reviewCache = { key: '', data: null };

async function fillReview(box, project, id, stamp) {
  const base = `/files/${jobPath(project, id)}`, key = `${base}|${stamp}`;
  if (reviewCache.key !== key) {
    try { reviewCache = { key, data: await api(`/jobs/${jobPath(project, id)}/review`) }; } catch (err) {
      if (box.isConnected) box.innerHTML = `<p class="err">${esc(err.message)}</p>`;
      return;
    }
  }
  if (box.isConnected) box.innerHTML = reviewHtml(reviewCache.data, base, stamp);
}

function reviewHtml({ pacing: p, sheet, cuts }, base, stamp) {
  if (!p) return '<p class="muted small">No timing yet. The pacing table appears after prepare.</p>';
  const t = p.thresholds, pct = (v) => `${Math.round(v * 100)}%`;
  const n = (v) => (v === null || v === undefined ? '–' : Number(v).toFixed(2));
  const cell = (v, flagged) => `<td${flagged ? ' class="flag"' : ''}>${v}</td>`;
  const names = (flags) => esc(flags.map((f) => PACE_FLAGS[f] || f).join(', '));
  const rows = p.scenes.map((s) => `<tr data-sid="${esc(s.id)}"><td><b>${esc(s.id)}</b></td>${cell(n(s.length))}${cell(s.words, s.flags.includes('dead'))}${cell(n(s.wps), s.flags.includes('fast'))}${cell(n(s.head))}${cell(n(s.tail), s.flags.includes('slowTail'))}${cell(pct(s.silence))}<td class="fl">${names(s.flags)}</td></tr>`).join('');
  const tot = p.totals;
  const foot = `<tr><td><b>total</b></td>${cell(n(p.duration))}${cell(tot.words)}${cell(n(tot.wps))}<td></td><td></td>${cell(pct(tot.silence), tot.flags.includes('silence'))}<td class="fl">${names(tot.flags)}</td></tr>`;
  const img = sheet
    ? `<a class="sheet" href="${fileUrl(base, sheet)}?v=${stamp}" target="_blank" rel="noopener" title="Open the full-size sheet"><img src="${fileUrl(base, sheet)}?v=${stamp}" alt="Review sheet: three frames per scene, in, middle and before the cut" loading="lazy"></a>
      <p class="muted small">Main format, one row per scene: in, middle, before the cut. Click to open full size.</p>`
    : '<p class="muted small">No sheet yet. It appears after the next storyboard build.</p>';
  const cutImg = cuts
    ? `<a class="sheet" href="${fileUrl(base, cuts)}?v=${stamp}" target="_blank" rel="noopener" title="Open the full-size cut sheet"><img src="${fileUrl(base, cuts)}?v=${stamp}" alt="Cut sheet: frames close around every cut" loading="lazy"></a>
      <p class="muted small">One row per cut, frames from just before to just after it. A row that turns in one frame from one picture to another is a hard cut.</p>`
    : '';
  return `${img}${cutImg}<div class="tscroll"><table class="mono timing pacing"><thead><tr><th>scene</th><th>length</th><th>words</th><th>w/s</th><th>head</th><th>tail</th><th>silence</th><th>flags</th></tr></thead>
    <tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <p class="muted small">Flagged: faster than ${esc(t.fastWps)} words/s, a tail over ${esc(t.slowTail)}s before the cut, no voice or clip sound, ${esc(t.sameKindRun ?? 3)} or more scenes of one kind in a row (footage aside), silence over ${pct(t.maxSilence)} of the video.</p>`;
}

// Notes pinned to a moment of the preview (engine/notes.mjs). The Director reads them on its next run; the review
// link shows none. `clock` reads and moves the playhead of whichever player the tab shows.
async function fillNotes(box, project, id, clock) {
  let notes;
  try { notes = (await api(`/jobs/${jobPath(project, id)}/notes`)).notes; } catch (err) {
    if (box.isConnected) box.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    return;
  }
  if (!box.isConnected) return;
  const items = notes.map((n) => `<li><button class="linkbtn mono" type="button" data-nt="${esc(n.t)}" title="Go to this moment">${esc(Number(n.t).toFixed(2))}s</button>
    <span class="muted">${esc(n.scene)}</span> ${esc(n.text)} <button class="linkbtn" type="button" data-ndel="${esc(n.n)}" aria-label="Delete note ${esc(n.n)}">Delete</button></li>`).join('');
  box.innerHTML = `<ul class="notes">${items || '<li class="muted small">No notes yet.</li>'}</ul>
    <div class="row"><input id="note-text" maxlength="300" placeholder="What should change at this moment?" aria-label="Note at the playhead" style="flex:1">
    <button class="btn" id="note-add" type="button">Add at playhead</button></div>
    <p class="muted small">Stop the preview where something is off and say what should change. The Director reads each note, with the scene playing then, the next time it runs on this job.</p>`;
  $$('[data-nt]', box).forEach((b) => b.addEventListener('click', () => clock.go(+b.dataset.nt)));
  $$('[data-ndel]', box).forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/jobs/${jobPath(project, id)}/notes/${encodeURIComponent(b.dataset.ndel)}`, { method: 'DELETE' }); } catch (err) { toast(err.message); return; }
    fillNotes(box, project, id, clock);
  }));
  // One post at a time: a double Enter, or Enter then a click, would pin the same note twice.
  let sending = false;
  const add = async () => {
    const text = $('#note-text', box).value.trim();
    if (!text || sending) return;
    sending = true;
    try { await api(`/jobs/${jobPath(project, id)}/notes`, { method: 'POST', body: { t: clock.t(), text } }); } catch (err) { toast(err.message); return; } finally { sending = false; }
    fillNotes(box, project, id, clock);
  };
  $('#note-add', box).addEventListener('click', add);
  // Enter while an input method is still composing a word (Vietnamese, Japanese …) picks the word, not the note.
  $('#note-text', box).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) add(); });
}

function panePreView(pane) {
  const d = S.detail, s = d.status, base = `/files/${jobPath()}`;
  const stamp = encodeURIComponent(s.updatedAt || '');
  // Extra cuts share the script and voice; each has its own page, stills and (after render) its own MP4.
  const cuts = s.cuts || [];
  const cut = cuts.find((c) => c.format === S.cut) || null;
  const pageFile = cut ? cut.page : 'index.html';
  const finalFile = cut ? (s.outputs?.cuts || []).find((c) => c.format === cut.format)?.final || null : (d.has.final ? 'final.mp4' : null);
  const stillList = (cut ? cut.stills : s.stills) || [];
  const view = !finalFile ? 'comp' : S.view === 'auto' ? 'video' : S.view;
  if (!d.has.index && !d.has.final) {
    pane.innerHTML = '<p class="muted">No storyboard yet. The preview appears after step 7.</p>';
    return;
  }
  const { w, h } = cut ? { w: cut.width, h: cut.height } : frameSize(d), ar = `aspect-ratio:${w}/${h}`;
  const tracks = [d.has.voice && 'voice.wav', d.has.footage && 'footage.wav', d.has.sfx && 'sfx.wav'].filter(Boolean);
  if (d.music) tracks.push('music');
  const stills = stillList.map((x) => `<button class="still" data-t="${esc(x.t)}" data-sid="${esc(x.id)}"><img src="${fileUrl(base, x.file)}?v=${stamp}" style="${ar}" alt="Still ${esc(x.id)}" loading="lazy"><span>${esc(x.id)} · ${esc(x.t)}s</span></button>`).join('');
  const rows = (d.timing?.scenes || []).map((t) => {
    const sc = d.script?.scenes.find((x) => x.id === t.id);
    return `<tr data-sid="${esc(t.id)}"><td class="mono">${t.start.toFixed(2)}</td><td><b>${esc(t.id)}</b>
      ${sc ? `<button class="linkbtn" type="button" data-editscene="${esc(t.id)}" aria-label="Edit ${esc(t.id)} in the Script tab">Edit in Script</button>` : ''}<br><span class="muted">${esc(sc?.vo || '')}</span></td></tr>`;
  }).join('');
  pane.innerHTML = `<div class="preview${w > h ? ' wide' : ''}">
    <div>
      ${cuts.length ? `<div class="seg cuts" role="group" aria-label="Format">${[{ format: d.brief.format, main: true }, ...cuts].map((c) => {
        const on = c.main ? !cut : cut?.format === c.format;
        return `<button type="button" data-cut="${c.main ? '' : esc(c.format)}" class="${on ? 'on' : ''}" aria-pressed="${on}">${esc(c.format)}${c.main ? ' · main' : ''}</button>`;
      }).join('')}</div>` : ''}
      <div class="row" style="margin-bottom:8px">
        ${finalFile ? `<button class="btn ${view === 'video' ? 'p' : ''}" data-view="video">Video</button>` : ''}
        ${d.has.index ? `<button class="btn ${view === 'comp' ? 'p' : ''}" data-view="comp">Composition</button>` : ''}
      </div>
      <div class="stagebox" id="stagebox" style="${ar}">${view === 'video'
        ? `<video controls playsinline preload="metadata" ${stillList[0] ? `poster="${fileUrl(base, stillList[0].file)}?v=${stamp}"` : ''} src="${fileUrl(base, finalFile)}?v=${stamp}"></video>`
        : `<iframe id="comp" title="Composition preview" src="${fileUrl(base, pageFile)}?v=${stamp}" style="width:${w}px;height:${h}px" tabindex="-1"></iframe>`}</div>
      ${view === 'comp' ? `<div class="transport"><button class="btn p" id="pl">▶ Play</button><input type="range" id="rng" min="0" max="${d.timing?.duration || 20}" step="0.0333" value="0" aria-label="Seek"><span class="mono" id="tc">0.00s</span>
        ${tracks.length ? `<label class="chk"><input type="checkbox" id="snd" ${S.sound === false ? '' : 'checked'}> Sound</label>` : ''}</div>
        <p class="muted small" style="margin:0">The exact page the renderer captures frame by frame.${tracks.length ? ` ${[d.has.voice && 'Voice', d.music && 'music', d.has.sfx && 'cut sounds'].filter(Boolean).join(' and ')} play along; the render evens out the loudness.` : ' No sound yet: the brand has no voice or music.'}${d.timing?.beat ? ` Scenes end on the beat (${d.timing.beat.bpm} BPM).` : ''}</p>` : ''}
    </div>
    <div>
      <h3>Storyboard stills</h3><div class="stills">${stills || '<span class="muted">None yet.</span>'}</div>
      <h3 style="margin-top:14px">Review sheet</h3><div id="revbox"><span class="muted small">Loading…</span></div>
      ${REVIEW ? '' : '<h3 style="margin-top:14px">Notes for the Director</h3><div id="notebox"><span class="muted small">Loading…</span></div>'}
      <h3 style="margin-top:14px">Timing (${esc(d.timing?.source || '')})</h3>
      <table class="mono timing"><tbody>${rows}</tbody></table>
    </div></div>
    ${d.script && d.timing ? '<section class="tl" id="tl" aria-labelledby="tl-h"></section>' : ''}`;
  $$('[data-view]', pane).forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; renderPane(); }));
  $$('[data-cut]', pane).forEach((b) => b.addEventListener('click', () => { S.cut = b.dataset.cut || null; S.view = 'auto'; renderPane(); }))
  $$('[data-editscene]', pane).forEach((b) => b.addEventListener('click', () => goSub('script', { scene: b.dataset.editscene })));
  fillReview($('#revbox', pane), S.project, S.sel, stamp);
  const jumpT = S.jump?.t ?? null;
  S.jump = null;
  // The scene under the playhead is marked in the stills and the timing table.
  let curScene = null;
  const markScene = (t) => {
    const sc = (d.timing?.scenes || []).find((x) => t >= x.start && t < x.end) || null;
    if (sc?.id === curScene) return;
    curScene = sc?.id ?? null;
    $$('[data-sid]', pane).forEach((el) => el.classList.toggle('cur', el.dataset.sid === curScene));
  };
  const notebox = $('#notebox', pane);
  // The Timeline seeks whichever player the tab shows; `play` is set once the composition's player exists.
  let play = null;
  const tl = $('#tl', pane) ? mountTimeline($('#tl', pane), (t) => play?.(t)) : null;
  if (view !== 'comp') {
    const v = $('video', pane);
    if (notebox && v) fillNotes(notebox, S.project, S.sel, { t: () => v.currentTime, go: (t) => { v.pause(); v.currentTime = t; } });
    if (v) {
      play = (t) => { v.currentTime = t; };
      v.addEventListener('timeupdate', () => { markScene(v.currentTime); tl?.at(v.currentTime); });
      if (jumpT !== null) v.addEventListener('loadedmetadata', () => { v.currentTime = jumpT; markScene(jumpT); }, { once: true });
      $$('.still', pane).forEach((b) => b.addEventListener('click', () => { v.currentTime = +b.dataset.t; }));
    }
    return;
  }
  const box = $('#stagebox'), frame = $('#comp');
  const fit = () => { frame.style.transform = `scale(${box.clientWidth / w})`; };
  fit();
  stageRo = new ResizeObserver(fit);
  stageRo.observe(box);
  const rng = $('#rng'), tc = $('#tc'), pl = $('#pl');
  // voice.wav, footage.wav and sfx.wav start at t = 0 of the composition, so their clock is the page's clock.
  // The music plays at its mix level under the voice, as the render will place it.
  sounds = tracks.map((f) => (f === 'music'
    ? Object.assign(new Audio(d.music.url), { preload: 'auto', volume: Math.min(1, 10 ** (d.music.gainDb / 20) * 4) })
    : Object.assign(new Audio(`${base}/${f}?v=${stamp}`), { preload: 'auto' })));
  const soundOn = () => sounds.length && $('#snd')?.checked;
  $('#snd')?.addEventListener('change', () => { S.sound = $('#snd').checked; if (!soundOn()) sounds.forEach((a) => a.pause()); else if (playing) syncSound(+rng.value, true); });
  // A scene's `drop` moves the music (timing.music.shift): positive plays it from later in the track, negative starts it late.
  const offs = tracks.map((f) => (f === 'music' ? Number(d.timing?.music?.shift) || 0 : 0));
  const syncSound = (t, force) => {
    if (!soundOn()) return;
    sounds.forEach((a, i) => {
      const at = t + offs[i];
      if (at < 0 || (Number.isFinite(a.duration) && at >= a.duration)) { a.pause(); return; }
      if (force || Math.abs(a.currentTime - at) > 0.15) a.currentTime = at;
      if (playing && a.paused) a.play().catch(() => {});
    });
  };
  const seek = (t) => {
    const w = frame.contentWindow;
    if (w && w.__ready) { w.seek(t); rng.value = t; tc.textContent = `${Number(t).toFixed(2)}s`; markScene(t); tl?.at(t); }
  };
  play = (t) => { stopPlay(); pl.textContent = '▶ Play'; seek(t); };
  frame.addEventListener('load', () => waitReady(frame, () => seek(jumpT ?? 0)));
  if (notebox) fillNotes(notebox, S.project, S.sel, { t: () => +rng.value, go: (t) => { stopPlay(); pl.textContent = '▶ Play'; seek(t); } });
  rng.addEventListener('input', () => { stopPlay(); pl.textContent = '▶ Play'; seek(+rng.value); });
  pl.addEventListener('click', () => {
    if (playing) { stopPlay(); pl.textContent = '▶ Play'; return; }
    const dur = +rng.max;
    const start = +rng.value >= dur - 0.05 ? 0 : +rng.value;
    let prevT = start, prevNow = performance.now();
    playing = true; pl.textContent = '❚❚ Pause';
    syncSound(start, true);
    const loop = (now) => {
      if (!playing) return;
      // While a track plays it is the clock, so picture and voice cannot drift apart; past its end the wall clock takes over.
      const lead = soundOn() ? sounds.find((a) => !a.paused && !a.ended) : null;
      const t = Math.min(dur, lead ? lead.currentTime : prevT + (now - prevNow) / 1000);
      prevT = t; prevNow = now;
      seek(t);
      syncSound(t);
      if (t >= dur) { stopPlay(); pl.textContent = '▶ Play'; return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
  $$('.still', pane).forEach((b) => b.addEventListener('click', () => { stopPlay(); pl.textContent = '▶ Play'; seek(+b.dataset.t); }));
}

/* ---------------- timeline (Preview tab) ---------------- */
// Reorder scenes, pause after a line (`hold`), pick the sound at each cut and move ui-story shot cues. Every edit saves
// the script through the Script tab's route: it locks like any person edit and sends the job back to step 5.
const TL_MIN_PPS = 28; // px per second at the least; a long video scrolls sideways
const TL_BLOCK_MIN = 18; // px: a very short scene still shows its grip
const TL_GAP = 4; // px between blocks, .tl-block margin-right: a block's box ends that much before its cut
const TL_SETTLE_MS = 180;
const TL_KEY_REST_MS = 700; // keyboard nudges save once the keys rest
const TL_TICKS = [1, 2, 5, 10, 15, 30, 60];

/** Draws the Timeline into `box` and wires it; `go(t)` seeks the preview. Returns { at(t) } for the playhead. */
function mountTimeline(box, go) {
  const tpl = () => S.detail.template;
  const bareKind = (k) => k.slice(k.indexOf('.') + 1);
  let work = structuredClone(S.detail.script);
  let spans = [], pps = TL_MIN_PPS, sel = null, timer = 0, saving = false, lastFocus = null;
  const labels = new Map();
  const editable = () => !REVIEW && !saving && !jobBusy();
  // The preview plays the last storyboard: after an edit its times no longer match the blocks.
  const stale = () => S.detail.status.status === 'dirty';
  const oldStart = (id) => S.detail.timing?.scenes.find((x) => x.id === id)?.start ?? 0;
  const say = (text, bad = false) => { $('#tl-st', box).textContent = bad ? '' : text; $('#tl-err', box).textContent = bad ? text : ''; };
  const scene = (id) => work.scenes.find((s) => s.id === id);
  const blockWidth = (len) => `${(Math.max(TL_BLOCK_MIN, len * pps) - TL_GAP).toFixed(1)}px`;

  const cutHtml = (sc, i) => {
    if (!i) return '';
    const opts = sfxOptions(tpl(), sc.kind), sound = sc.sfx || S.detail.cutSound;
    const what = `Cut into ${sc.id}: ${sound}${sc.sfx ? '' : ' (brand)'}`;
    return `<button type="button" class="tl-cut${sc.sfx ? ' own' : ''}${sel === sc.id ? ' on' : ''}" data-cut="${esc(sc.id)}"${opts ? ` aria-pressed="${sel === sc.id}"` : ' aria-disabled="true"'}
      aria-label="${esc(what)}" title="${esc(opts ? `${what}. Click, then pick a sound below, or drag a sound here.` : `${what}. This template uses the brand's cut sound.`)}">${esc(sound)}</button>`;
  };
  const shotsHtml = (sc, sp) => {
    if (!takesCue(S.detail.brief.template, sc.kind) || !Array.isArray(sc.shots)) return '';
    return shotTimes(sc.shots, sp.words, sp.length).map((x, k) => {
      const cue = sc.shots[k]?.cue;
      return `<button type="button" class="tl-shot${cue ? ' cued' : ''}" data-shot="${esc(sc.id)}:${k}" style="left:${(x.t * pps).toFixed(1)}px"
        aria-label="${esc(`Shot ${k + 1} of ${sc.id}: ${cue ? `starts on "${cue}"` : 'no cue word'}. Arrow keys pick the word, Delete clears it.`)}">${k + 1}${cue ? ` ${esc(cue)}` : ''}</button>`;
    }).join('');
  };
  const blockHtml = (sp, i) => {
    const sc = work.scenes[i];
    const len = `${fmtSec(sp.base)}${sp.hold ? ` + ${fmtSec(sp.hold)}` : ''}`;
    return `<div class="tl-block${sp.estimated ? ' est' : ''}" role="listitem" tabindex="0" data-i="${i}" data-id="${esc(sp.id)}" style="width:${blockWidth(sp.length)}"
        aria-label="${esc(`${i + 1}. ${sp.id}, ${bareKind(sp.kind)}, ${len}${sp.estimated ? ', estimated' : ''}. Arrow keys move it, Enter plays it.`)}" title="${esc(`${sp.id} · ${sp.kind} · ${len}${sp.estimated ? ' (estimated: not prepared yet)' : ''}`)}">
      <span class="tl-lab"><b>${esc(sp.id)}</b> <span class="muted">${esc(bareKind(sp.kind))}</span></span>
      <span class="tl-len mono">${esc(len)}</span>
      <span class="tl-hold" style="width:${(sp.hold * pps).toFixed(1)}px"${sp.hold ? '' : ' hidden'}></span>
      <span class="tl-grip" role="slider" tabindex="0" data-grip="${i}" aria-label="${esc(`Pause after the line of ${sp.id}`)}" aria-valuemin="0" aria-valuemax="${HOLD_MAX}" aria-valuenow="${sp.hold}" aria-valuetext="${esc(fmtSec(sp.hold))}"></span>
      ${cutHtml(sc, i)}${shotsHtml(sc, sp)}</div>`;
  };

  const draw = (focus = null) => {
    const d = S.detail;
    spans = sceneSpans(work, d.timing);
    const total = totalOf(spans);
    pps = Math.max(TL_MIN_PPS, ((box.clientWidth || 640) - 24) / Math.max(total, 1));
    const tick = TL_TICKS.find((x) => x * pps >= 48) || 60;
    const ruler = Array.from({ length: Math.floor(total / tick) + 1 }, (_, k) => `<span style="left:${(k * tick * pps).toFixed(1)}px">${k * tick}s</span>`).join('');
    const cues = work.scenes.some((sc) => takesCue(d.brief.template, sc.kind) && Array.isArray(sc.shots));
    const pickable = work.scenes.some((sc, i) => i && sfxOptions(tpl(), sc.kind));
    const choices = [...new Set(work.scenes.flatMap((sc) => sfxOptions(tpl(), sc.kind) || []))];
    const chips = pickable ? `<span class="small muted" id="tl-pick">${sel ? esc(`Sound at the cut into ${sel}:`) : 'Click a cut, then a sound, or drag a sound onto a cut:'}</span>
      ${choices.map((n) => `<button type="button" class="tl-chip" draggable="true" data-snd="${esc(n)}">${esc(n)}</button>`).join('')}
      <button type="button" class="tl-chip" draggable="true" data-snd="">${esc(`brand (${d.cutSound})`)}</button>`
      : `<span class="small muted">${esc(`This template uses the brand's cut sound (${d.cutSound}) at every cut.`)}</span>`;
    box.innerHTML = `<div class="tl-head"><h3 id="tl-h">Timeline</h3><span class="mono muted" id="tl-total">${esc(`${fmtSec(total)}${d.brief.duration ? ` · brief ${d.brief.duration} s` : ''}`)}</span>
        <span class="muted small">${REVIEW ? 'Scene lengths, cuts and shot cues of this storyboard.' : `Drag a scene to reorder it, drag its right edge for up to ${HOLD_MAX} s of quiet after its line${cues ? ', drag a shot number onto a word' : ''}. Each change saves.`}</span></div>
      <div class="tl-scroll"><div class="tl-inner" style="width:${(total * pps + TL_BLOCK_MIN).toFixed(0)}px">
        <div class="tl-ruler" aria-hidden="true">${ruler}</div>
        <div class="tl-track${cues ? ' cues' : ''}" role="list" aria-label="Scenes in order">${spans.map(blockHtml).join('')}</div>
        <div class="tl-play" hidden></div>
      </div></div>
      <div class="tl-sounds" role="group" aria-label="Cut sounds">${chips}</div>
      <p class="small ${stale() ? 'warn-t' : 'muted'}" id="tl-note">${stale() ? 'Lengths are from the last storyboard and the preview still plays it. Rebuild the storyboard to hear these changes.' : 'Lengths come from the voice; only a pause after a line makes a scene longer.'}</p>
      <p class="small" id="tl-st" role="status"></p><div class="err" role="alert" id="tl-err"></div>`;
    const f = focus || S.tlFocus;
    S.tlFocus = null;
    if (f) $(f, box)?.focus();
    if (S.tlMsg) { say(S.tlMsg.text, S.tlMsg.bad); S.tlMsg = null; }
  };

  // One save at a time: keyboard nudges gather in `labels` (the latest per target) and go out once the keys rest.
  const edit = (e, label, focus, now = true) => {
    work = editScript(work, e);
    labels.set(e.order ? `order:${e.moved}` : e.hold !== undefined ? `hold:${e.hold}` : e.sfx !== undefined ? `sfx:${e.sfx}` : `cue:${e.cue}:${e.shot}`, label);
    lastFocus = focus;
    draw(focus);
    clearTimeout(timer);
    timer = setTimeout(flush, now ? 0 : TL_KEY_REST_MS);
  };
  const flush = async () => {
    if (saving || !labels.size) return;
    const note = `Timeline: ${[...labels.values()].join('; ')}`.slice(0, 200), focus = lastFocus;
    const doc = editScript(work, {});
    labels.clear();
    saving = true;
    INFLIGHT.add(jobKey());
    let msg;
    try {
      const r = await api(`/jobs/${jobPath()}/script`, { method: 'PUT', body: { doc, note, stamp: S.detail.stamps?.script } });
      msg = { text: r.changed.length ? `Saved: ${note.slice(10)}. Rebuild the storyboard to hear it.` : 'Nothing changed.' };
      if (r.warnings?.length) msg.text += ` Warnings: ${r.warnings.join('; ')}`;
    } catch (err) { msg = { text: err.message, bad: true }; }
    saving = false;
    INFLIGHT.delete(jobKey());
    S.tlMsg = msg; S.tlFocus = focus;
    // The first edit sends the job back to step 5, which redraws the whole pane and mounts a fresh Timeline.
    try { await loadDetail(false); } catch (err) { S.tlMsg = { text: err.message, bad: true }; }
    if (!box.isConnected) return;
    work = structuredClone(S.detail.script);
    draw();
  };

  // Pointer drags: a block moves, a grip sets the pause, a shot number snaps to a word. A press without a drag plays.
  const drag = (e, el, { onMove, onDrop, onClick }) => {
    const x0 = e.clientX;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return;
      if (!editable()) return;
      moved = true;
      onMove(ev.clientX - x0);
    };
    const end = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (ev.type === 'pointercancel') { draw(); return; }
      if (moved) onDrop(); else onClick?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  const paintHold = (block, sp, v) => {
    const len = `${fmtSec(sp.base)}${v ? ` + ${fmtSec(v)}` : ''}`;
    block.style.width = blockWidth(sp.base + v);
    const hold = $('.tl-hold', block);
    hold.style.width = `${(v * pps).toFixed(1)}px`;
    hold.hidden = !v;
    $('.tl-len', block).textContent = len;
    $('#tl-total', box).textContent = fmtSec(totalOf(spans) - sp.hold + v);
    say(`${sp.id}: ${len}`);
  };

  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const block = e.target.closest('.tl-block');
    if (!block || e.target.closest('.tl-cut')) return;
    const i = Number(block.dataset.i), sp = spans[i];
    const grip = e.target.closest('.tl-grip'), shot = e.target.closest('.tl-shot');
    if (grip) {
      e.preventDefault();
      let v = sp.hold;
      return drag(e, grip, {
        onMove: (dx) => { v = roundHold(sp.hold + dx / pps); paintHold(block, sp, v); },
        onDrop: () => (v === sp.hold ? draw() : edit({ hold: sp.id, value: v }, `pause after ${sp.id} ${fmtSec(v)}`, `.tl-block[data-id="${CSS.escape(sp.id)}"] .tl-grip`)),
      });
    }
    if (shot) {
      e.preventDefault();
      const k = Number(shot.dataset.shot.split(':').pop()), sc = scene(sp.id);
      const times = shotTimes(sc.shots, sp.words, sp.length), { lo, hi } = cueRange(times, k);
      let w = -1;
      return drag(e, shot, {
        onMove: (dx) => {
          if (!sp.words.length) { say(`${sp.id} has no word timing yet: build the storyboard first.`, true); return; }
          w = snapWord(sp.words, times[k].t + CUE_LEAD + dx / pps, lo, hi);
          if (w < 0) return;
          shot.style.left = `${((sp.words[w].at - CUE_LEAD) * pps).toFixed(1)}px`;
          shot.textContent = `${k + 1} ${cueWord(sp.words[w].w)}`;
        },
        onDrop: () => {
          const v = w >= 0 ? cueWord(sp.words[w].w) : '';
          if (!v || v === sc.shots[k].cue) { draw(); return; }
          edit({ cue: sp.id, shot: k, value: v }, `shot ${k + 1} of ${sp.id} on "${v}"`, `[data-shot="${CSS.escape(`${sp.id}:${k}`)}"]`);
        },
        onClick: () => go(oldStart(sp.id) + times[k].t),
      });
    }
    let to = i;
    const track = block.parentElement, blocks = [...track.children];
    const left0 = blocks.map((b) => b.offsetLeft), wide = blocks.map((b) => b.offsetWidth + TL_GAP);
    drag(e, block, {
      onMove: (dx) => {
        track.classList.add('sorting');
        block.classList.add('drag');
        block.style.transform = `translateX(${dx}px)`;
        to = dropIndex(spans, i, sp.start + sp.length / 2 + dx / pps);
        // The other blocks slide aside to open the slot it would land in.
        let x = left0[0];
        moveItem(blocks.map((_, j) => j), i, to).forEach((j) => {
          if (j !== i) blocks[j].style.transform = `translateX(${(x - left0[j]).toFixed(1)}px)`;
          x += wide[j];
        });
      },
      onDrop: () => {
        const from = block.getBoundingClientRect().left;
        if (to === i) draw();
        else edit({ order: moveItem(work.scenes.map((s) => s.id), i, to), moved: sp.id }, `moved ${sp.id} to place ${to + 1}`, `.tl-block[data-id="${CSS.escape(sp.id)}"]`);
        // The redraw puts the others where they already slid to; the dropped block glides from the pointer into its slot.
        const now = $(`.tl-block[data-id="${CSS.escape(sp.id)}"]`, box);
        if (now && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          now.animate([{ transform: `translateX(${(from - now.getBoundingClientRect().left).toFixed(1)}px)` }, { transform: 'none' }], { duration: TL_SETTLE_MS, easing: 'ease-out' });
        }
      },
      onClick: () => go(oldStart(sp.id)),
    });
  });

  box.addEventListener('keydown', (e) => {
    const el = e.target;
    const block = el.closest?.('.tl-block');
    if (!block) return;
    const i = Number(block.dataset.i), sp = spans[i];
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (el.classList.contains('tl-grip')) {
      const v = e.key === 'Home' ? 0 : e.key === 'End' ? HOLD_MAX : dir ? roundHold(sp.hold + dir * HOLD_STEP * (e.shiftKey ? 10 : 1)) : null;
      if (v === null) return;
      e.preventDefault();
      if (!editable() || v === sp.hold) return;
      edit({ hold: sp.id, value: v }, `pause after ${sp.id} ${fmtSec(v)}`, `.tl-block[data-id="${CSS.escape(sp.id)}"] .tl-grip`, false);
      return;
    }
    if (el.classList.contains('tl-shot')) {
      const k = Number(el.dataset.shot.split(':').pop()), sc = scene(sp.id);
      const times = shotTimes(sc.shots, sp.words, sp.length), { lo, hi } = cueRange(times, k);
      const focus = `[data-shot="${CSS.escape(`${sp.id}:${k}`)}"]`;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (editable() && sc.shots[k].cue) edit({ cue: sp.id, shot: k, value: '' }, `shot ${k + 1} of ${sp.id} without a cue`, focus, false);
        return;
      }
      if (!dir || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
      e.preventDefault();
      if (!editable()) return;
      const from = times[k].word >= 0 ? times[k].word : snapWord(sp.words, times[k].t + CUE_LEAD, lo, hi) - dir;
      const w = stepWord(sp.words, from, dir, lo, hi);
      if (w >= 0) edit({ cue: sp.id, shot: k, value: cueWord(sp.words[w].w) }, `shot ${k + 1} of ${sp.id} on "${cueWord(sp.words[w].w)}"`, focus, false);
      return;
    }
    if (el !== block) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(oldStart(sp.id)); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const to = i + dir;
    if (!editable() || to < 0 || to >= spans.length) return;
    edit({ order: moveItem(work.scenes.map((s) => s.id), i, to), moved: sp.id }, `moved ${sp.id} to place ${to + 1}`, `.tl-block[data-id="${CSS.escape(sp.id)}"]`, false);
  });

  // Cut sounds: pick a cut, then a sound chip; or drag a chip onto a cut.
  const setSound = (id, value) => {
    const sc = scene(id), opts = sfxOptions(tpl(), sc.kind);
    if (!opts) { say(`The cut into ${id} takes the brand's cut sound: this kind of scene has no sound of its own.`, true); return; }
    if (value && !opts.includes(value)) { say(`The cut into ${id} can be ${opts.join(', ')}.`, true); return; }
    if ((sc.sfx || '') === value) return;
    sel = null;
    edit({ sfx: id, value }, `sound at the cut into ${id}: ${value || `brand (${S.detail.cutSound})`}`, `[data-cut="${CSS.escape(id)}"]`);
  };
  box.addEventListener('click', (e) => {
    const cut = e.target.closest('.tl-cut'), chip = e.target.closest('.tl-chip');
    if (cut) {
      if (cut.getAttribute('aria-disabled') === 'true') { say(cut.title); return; }
      if (!editable()) return;
      sel = sel === cut.dataset.cut ? null : cut.dataset.cut;
      draw(`[data-cut="${CSS.escape(cut.dataset.cut)}"]`);
    } else if (chip) {
      if (!editable()) return;
      if (!sel) { say('Click the cut first, then the sound.', true); return; }
      setSound(sel, chip.dataset.snd);
    }
  });
  box.addEventListener('dragstart', (e) => {
    const chip = e.target.closest?.('.tl-chip');
    if (chip) e.dataTransfer.setData('text/x-tl-sound', chip.dataset.snd);
  });
  box.addEventListener('dragover', (e) => {
    const cut = e.target.closest?.('.tl-cut');
    if (!cut || cut.getAttribute('aria-disabled') === 'true' || ![...e.dataTransfer.types].includes('text/x-tl-sound') || !editable()) return;
    e.preventDefault();
    cut.classList.add('over');
  });
  box.addEventListener('dragleave', (e) => e.target.closest?.('.tl-cut')?.classList.remove('over'));
  box.addEventListener('drop', (e) => {
    const cut = e.target.closest?.('.tl-cut');
    if (!cut || ![...e.dataTransfer.types].includes('text/x-tl-sound')) return;
    e.preventDefault();
    setSound(cut.dataset.cut, e.dataTransfer.getData('text/x-tl-sound'));
  });

  draw();
  return {
    at(t) {
      const line = $('.tl-play', box);
      if (!line) return;
      // Once the script changed, the preview's clock belongs to the old order: no playhead over the new one.
      line.hidden = stale();
      if (!stale()) line.style.left = `${(t * pps).toFixed(1)}px`;
    },
  };
}

/* ---------------- briefs ---------------- */
const FORMAT_NAME ={ '9:16': 'vertical', '1:1': 'square', '16:9': 'landscape', '4:5': 'portrait', '2:3': 'tall', '21:9': 'ultrawide' };
// Field labels follow what the template films: a product, an app, an event, a topic...
const SUBJECT_HINTS = {
  product: { subject: 'Product name', subjectPh: 'MegaMax', url: 'Product page' },
  app: { subject: 'App or feature', subjectPh: 'CSR console', url: 'App, docs or release notes page' },
  event: { subject: 'Event name', subjectPh: 'Spring launch', url: 'Event page' },
  brand: { subject: 'Brand or campaign', subjectPh: 'Summer campaign', url: 'Brand or campaign page' },
  topic: { subject: 'Topic', subjectPh: 'Q3 results', url: 'Article, report or data page' },
  people: { subject: 'Customer or speaker', subjectPh: 'Anna, operations lead', url: 'Case study or interview page' },
};
const TEMPLATE_SUBJECT = {
  'product-demo': 'product', promo: 'product', 'social-teaser': 'product', lifestyle: 'product', 'before-after': 'product',
  'app-walkthrough': 'app', 'ui-story': 'app', 'feature-launch': 'app', event: 'event', 'logo-reveal': 'brand',
  'data-story': 'topic', explainer: 'topic', 'code-story': 'app', audiogram: 'people', testimonial: 'people', 'talking-head': 'people',
};
const LANGS = [['en', 'English'], ['en-gb', 'English (UK)'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['vi', 'Vietnamese'], ['ja', 'Japanese'], ['zh', 'Chinese']];
const langName = (code) => LANGS.find(([c]) => c === code)?.[1] || code;
const subjectHint = (tpl) => SUBJECT_HINTS[TEMPLATE_SUBJECT[tpl]] || { subject: 'Subject', subjectPh: 'Short name', url: 'Reference page' };
const tplName = (b) => [b.template, ...(b.mix || [])].join(' + ');
const platformLabel = (id) => S.state.platforms.find((p) => p.id === id)?.label || id;
const formatLabel = (f, short) => {
  const main = short ? [] : S.state.platforms.filter((p) => p.formats[0] === f).map((p) => p.label);
  return `${f} ${FORMAT_NAME[f] || ''}${main.length ? ` · ${main.join(', ')}` : ''}`;
};
// The brief form opens in the job detail pane; a saved new brief is a new job, an edit rewrites that job's brief.
function openBriefForm(prefill) {
  if (!confirmDiscard()) return;
  stopPreview();
  if (S.sel) S.prevSel = S.sel;
  S.briefForm = prefill; S.sel = null; S.detail = null; S.paneDirty = false; S.seqSel = null; S.seqForm = null;
  $$('#joblist .job, #seqlist .job').forEach((x) => x.classList.remove('on'));
  renderBriefForm(prefill);
}

function closeBriefForm() {
  S.briefForm = null;
  const back = S.jobs.some((j) => j.brief.id === S.prevSel) ? S.prevSel : S.jobs[0]?.brief.id;
  if (back) selectJob(back); else $('#detail').innerHTML = '<p class="muted">No jobs yet. Click New brief to write the first one.</p>';
}

// Ticked extras, in the stored brief's order first so an unchanged mix compares equal on edit.
const mixPicked = () => {
  const prev = S.briefForm?.mix || [];
  const at = (id) => (prev.includes(id) ? prev.indexOf(id) : prev.length);
  return $$('#bf-mixlist input:checked').map((x) => x.value).sort((a, b) => at(a) - at(b));
};
const briefBody = () => ({
  template: $('#bf-tpl').value, mix: mixPicked(), format: $('#bf-fmt').value, platform: $('#bf-plat').value,
  duration: parseNum($('#bf-dur').value), url: $('#bf-url').value.trim(),
  subject: $('#bf-subj').value.trim(), message: $('#bf-msg').value.trim(), facts: $('#bf-facts').value.trim(),
  cta: $('#bf-cta').value.trim(), notes: $('#bf-notes').value.trim(), lang: $('#bf-lang').value, voice: $('#bf-voice').value, voiceTake: $('#bf-take').value,
  alsoFormats: $$('#bf-alsolist input:checked').map((x) => x.value), cutOnBeat: $('#bf-beat').checked, beatPulse: $('#bf-pulse').checked, motionBlur: $('#bf-blur').checked,
  quick: $('#bf-quick').checked,
});
// A new brief counts as unsaved once it has a message; an edit once any field differs from the stored brief.
function briefFormDirty() {
  if (S.briefForm?.sceneScript) return Boolean($('#ss-text')?.value.trim());
  if (!S.briefForm || !$('#bf')) return false;
  return S.briefForm.edit ? JSON.stringify(briefBody()) !== S.briefSnap : Boolean($('#bf-msg').value.trim());
}

const TPL_CHANGE_CONFIRM = 'Changing the template, the mix or quick mode sends the job back to the Director for a new script. Your edits stay in script.prev.json.';
const TPL_CHANGE_NOTE = 'Changing the template, the mix or quick mode sends the job back to the Director for a new script; the current script is kept as script.prev.json.';

function renderBriefForm(pre) {
  const st = S.state;
  const tpls = st.templates;
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const hasScript = pre.edit && pre.hasScript;
  const heading = pre.edit ? 'Edit brief' : pre.from ? `Duplicate of ${esc(pre.from)}` : 'New brief';
  // A new brief starts in quick mode where the template has one; an edit or a duplicate keeps what the brief says.
  const quickInit = pre.quick ?? (!pre.edit && !pre.from);
  const moreOpen = Boolean(pre.mix?.length || pre.alsoFormats?.length || pre.voiceTake || pre.cutOnBeat || pre.beatPulse || pre.motionBlur);
  const editNote = !pre.edit ? ''
    : pre.started ? '<div class="banner warn"><p>The Director already worked on this job. Saving a change sends it back to the Director: the next Director run redoes the source and script. Fields you edited in the Script and Source tabs stay locked.</p></div>'
      : '<p class="muted" style="margin:0">The Director has not run yet. Saving only updates the brief file.</p>';
  $('#detail').innerHTML = `<div class="head"><h2>${heading}</h2><span class="pill">${esc(S.project)}</span></div>
  <form class="stack" id="bf" novalidate>
    <div class="grid2">
      <div class="f"><label for="bf-tpl">Template</label><select id="bf-tpl" ${hasScript ? 'aria-describedby="bf-tplhint"' : ''}>${tpls.map((t) => opt(t.id, t.label, t.id === pre.template)).join('')}</select>
        <span class="muted hint" id="bf-tplabout"></span>
        ${hasScript ? `<span class="muted hint" id="bf-tplhint">${TPL_CHANGE_NOTE}</span>` : ''}</div>
      <div class="f"><label for="bf-dur">Duration (seconds)</label><input id="bf-dur" type="number" value="${esc(pre.duration ?? 20)}"><span class="muted mono" id="bf-durhint"></span></div>
      <div class="f"><label for="bf-plat">Platform</label><select id="bf-plat" aria-describedby="bf-plathint"></select><span class="muted hint" id="bf-plathint"></span></div>
      <div class="f"><label for="bf-fmt">Format</label><select id="bf-fmt"></select></div>
      <div class="f"><label for="bf-lang">Language</label><select id="bf-lang" aria-describedby="bf-langhint"></select>
        <span class="muted hint" id="bf-langhint">The Director writes the script in this language.</span></div>
      <div class="f"><label for="bf-voice">Voice</label><select id="bf-voice" aria-describedby="bf-voicehint"></select>
        <span class="muted hint" id="bf-voicehint"></span></div>
      <div class="f" style="grid-column:1/-1" id="bf-quickrow"><label class="chk"><input type="checkbox" id="bf-quick" ${quickInit ? 'checked' : ''} aria-describedby="bf-quickhint"> Quick video (outline)</label>
        <span class="muted hint" id="bf-quickhint"></span></div>
    </div>
    <h3 style="margin:6px 0 -4px">Content</h3>
    <div class="grid2">
      <div class="f"><label for="bf-subj" id="bf-subjl">Subject</label><input id="bf-subj" maxlength="64" value="${esc(pre.subject || '')}"></div>
      <div class="f"><label for="bf-url" id="bf-urll">Reference page</label><input id="bf-url" type="url" placeholder="https:// (optional)" value="${esc(pre.url || '')}"></div>
    </div>
    <div class="f"><label for="bf-msg">Key message</label><textarea id="bf-msg" maxlength="400" placeholder="What should the viewer remember?">${esc(pre.message || '')}</textarea></div>
    <div class="f"><label for="bf-facts">Facts (optional, one per line)</label><textarea id="bf-facts" maxlength="2000" placeholder="Closes the month in 2 days instead of 5&#10;Used by 40 finance teams">${esc(pre.facts || '')}</textarea>
      <span class="muted hint">Use this when there is no page to read. The director puts a claim on screen only if it comes from the page or from these lines.</span>
      ${evidencePanel()}</div>
    <div class="grid2">
      <div class="f"><label for="bf-cta">CTA</label><input id="bf-cta" maxlength="80" placeholder="Try a free sample" value="${esc(pre.cta || '')}"></div>
      <div class="f"><label for="bf-notes">Notes for the Director</label><input id="bf-notes" maxlength="1000" value="${esc(pre.notes || '')}"></div>
    </div>
    <details class="more" id="bf-more" ${moreOpen ? 'open' : ''}><summary>More options <span class="muted">· mix, extra sizes, recorded voice, beat, motion blur, job id</span></summary>
    <div class="grid2">
      <fieldset class="mix" id="bf-mix" aria-describedby="bf-mixhint"><legend>Mix in scenes from</legend><div class="row" id="bf-mixlist"></div><span class="muted hint" id="bf-mixhint"></span></fieldset>
      <fieldset class="mix" id="bf-also" aria-describedby="bf-alsohint"><legend>Also make (same script and voice)</legend><div class="row" id="bf-alsolist"></div><span class="muted hint" id="bf-alsohint"></span></fieldset>
      <div class="f"><label for="bf-take">Recorded voice</label><select id="bf-take" aria-describedby="bf-takehint">${opt('', 'None — use the brand voice', !pre.voiceTake)}${pre.voiceTake ? opt(pre.voiceTake, pre.voiceTake, true) : ''}</select>
        <span class="muted hint" id="bf-takehint">One take reading every voice line in order. The storyboard build matches it to the scenes.</span></div>
      <div class="f"><label for="bf-id">Job id</label>${pre.edit
        ? `<input id="bf-id" value="${esc(pre.id)}" readonly><span class="muted hint">The job id is the file name and cannot change.</span>`
        : '<input id="bf-id" maxlength="64" placeholder="auto from name + format">'}</div>
      <div class="f" style="grid-column:1/-1"><label class="chk"><input type="checkbox" id="bf-beat" ${pre.cutOnBeat ? 'checked' : ''} aria-describedby="bf-beathint"> Cut scenes on the music beat</label>
        <span class="muted hint" id="bf-beathint"></span>
        <label class="chk"><input type="checkbox" id="bf-pulse" ${pre.beatPulse ? 'checked' : ''} aria-describedby="bf-pulsehint"> Pulse on the beat</label>
        <span class="muted hint" id="bf-pulsehint">The picture punches in a little on the beat, and harder with a short flash on the music's drop. A scene's Direction can ask for the drop to land on it.</span>
        <label class="chk"><input type="checkbox" id="bf-blur" ${pre.motionBlur ? 'checked' : ''} aria-describedby="bf-blurhint"> Motion blur on fast moves</label>
        <span class="muted hint" id="bf-blurhint">Softens fast movement like a camera shutter. Rendering takes about 4 times as long; the storyboard does not change.</span></div>
    </div></details>
    ${editNote}
    <div class="row"><button class="btn p" type="submit" id="bf-save">${pre.edit ? 'Save changes' : 'Save brief'}</button>
      ${pre.edit ? '' : '<button class="btn" type="button" id="bf-saverun">Save and run Director</button>'}
      <button class="btn" type="button" id="bf-cancel">Cancel</button><span class="muted mono" id="bf-path"></span></div>
    <p class="muted small">Save brief only writes a file to briefs/. The Director (Claude Code on your seat, or the API provider you picked) runs only when you click a Run Director button or type /studio run in Claude Code.</p>
    <div class="err" role="alert" id="bf-err"></div>
  </form>`;
  const tpl = () => tpls.find((x) => x.id === $('#bf-tpl').value);
  const maxExtras = st.mix.maxExtras;
  // A mixed video can only use the formats the lead and every ticked extra share.
  const fmts = () => {
    const extras = mixPicked().map((id) => tpls.find((x) => x.id === id)).filter(Boolean);
    return tpl().formats.filter((f) => extras.every((x) => x.formats.includes(f)));
  };
  const serves = (formats, p) => p.formats.some((f) => formats.includes(f));
  // The extras on offer depend on the lead; ticks survive a lead change unless the new lead is that template.
  let picked = pre.mix || [];
  const drawMix = () => {
    if ($('#bf-mixlist input')) picked = mixPicked();
    const t = tpl();
    const list = t.mixable?.length ? tpls.filter((x) => x.id !== t.id && x.mixable?.length) : [];
    $('#bf-mixlist').innerHTML = list.map((x) => `<label class="chk"><input type="checkbox" value="${esc(x.id)}" ${picked.includes(x.id) ? 'checked' : ''}>
      ${esc(x.label)} <span class="muted">· adds ${esc(x.mixable.join(', '))}</span></label>`).join('');
  };
  const syncMix = () => {
    const t = tpl(), n = mixPicked().length;
    $('#bf-mix').hidden = !t.mixable?.length;
    $$('#bf-mixlist input').forEach((x) => { x.disabled = !x.checked && n >= maxExtras; });
    const f = fmts();
    $('#bf-mixhint').textContent = !t.mixable?.length ? 'This template cannot mix with others.'
        : !n ? `Optional: add body scenes from up to ${maxExtras} other templates. ${t.label} still opens and closes the video.`
          : `${f.length ? `Formats these templates share: ${f.join(', ')}.` : 'No shared format. Untick a template.'}${n >= maxExtras ? ` At most ${maxExtras} templates.` : ''}`;
  };
  // Every platform stays listed; one the template (or the mix) cannot serve says which format it needs.
  const syncPlatforms = (want) => {
    const t = tpl(), f = fmts(), mixed = mixPicked().length > 0;
    $('#bf-plat').innerHTML = opt('', 'Any platform', !want) + st.platforms.map((p) => {
      const ok = serves(f, p);
      const label = ok ? p.label : `${p.label} — needs ${p.formats.join(' or ')}, ${mixed ? 'these templates share' : 'this template makes'} ${f.join(', ') || 'no format'}`;
      return `<option value="${esc(p.id)}" ${ok ? '' : 'disabled'} ${ok && p.id === want ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const blocked = st.platforms.filter((p) => !serves(f, p));
    const others = mixed ? [] : tpls.filter((x) => x.id !== t.id)
      .map((x) => ({ x, n: blocked.filter((p) => serves(x.formats, p)).length }))
      .filter((c) => c.n).sort((a, b) => b.n - a.n).slice(0, 3);
    $('#bf-plathint').textContent = blocked.length
      ? `${mixed ? 'This mix' : 'This template'} cannot serve ${blocked.map((p) => p.label).join(', ')}.${others.length ? ` Try ${others.map((c) => c.x.label).join(', ')}.` : ''}`
      : '';
  };
  // With a platform picked, its formats come in its order of preference, limited to what the template(s) make.
  const syncFormats = (want) => {
    const f = fmts();
    const p = st.platforms.find((x) => x.id === $('#bf-plat').value);
    const list = p ? p.formats.filter((x) => f.includes(x)) : f;
    $('#bf-fmt').innerHTML = list.map((f) => opt(f, `${formatLabel(f, Boolean(p))}${p && f === p.formats[0] ? ` · best for ${p.label}` : ''}`, f === want)).join('');
  };
  const syncTpl = () => {
    const t = tpl(), h = subjectHint(t.id);
    $('#bf-dur').min = t.durations[0]; $('#bf-dur').max = t.durations[1];
    $('#bf-durhint').textContent = `${t.durations[0]}-${t.durations[1]} s for this template`;
    $('#bf-tplabout').textContent = t.description || '';
    $('#bf-subjl').textContent = h.subject;
    $('#bf-subj').placeholder = h.subjectPh;
    $('#bf-urll').textContent = h.url;
  };
  const syncId = () => {
    let id = $('#bf-id').value;
    if (!id) {
      const base = `${slug($('#bf-subj').value || 'video')}-${$('#bf-fmt').value.replace(':', 'x')}`;
      const taken = new Set(S.jobs.map((j) => j.brief.id));
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    }
    $('#bf-path').textContent = `→ briefs/${S.project}/${id}.json`;
    return id;
  };
  // Extra cuts: any other format the template (or the mix) makes; footage templates make one format for now.
  let alsoPicked = [...(pre.alsoFormats || [])];
  const syncAlso = () => {
    if ($('#bf-alsolist input')) alsoPicked = $$('#bf-alsolist input:checked').map((x) => x.value);
    const t = tpl(), main = $('#bf-fmt').value;
    const list = t.audio === 'footage' ? [] : fmts().filter((f) => f !== main);
    $('#bf-also').hidden = !list.length;
    $('#bf-alsolist').innerHTML = list.map((f) => `<label class="chk"><input type="checkbox" value="${esc(f)}" ${alsoPicked.includes(f) ? 'checked' : ''}> ${esc(formatLabel(f, true))}</label>`).join('');
    const n = $$('#bf-alsolist input:checked').length;
    $$('#bf-alsolist input').forEach((x) => { x.disabled = !x.checked && n >= MAX_CUTS; });
    $('#bf-alsohint').textContent = n ? `${n + 1} videos from one script: rendering takes about ${n + 1} times as long.` : `Optional: up to ${MAX_CUTS} more sizes, e.g. a vertical cut for Shorts.`;
  };
  // Quick mode (engine/jobs.mjs validateBrief): only a template with a quick block, never with a mix. The tick the
  // person chose comes back when the box is allowed again.
  let quickWanted = quickInit === true;
  const quickTpls = tpls.filter((x) => x.quick).map((x) => x.label).join(', ');
  const syncQuick = () => {
    const t = tpl(), mixed = mixPicked().length > 0, box = $('#bf-quick');
    const can = Boolean(t.quick) && !mixed;
    box.disabled = !can;
    box.checked = can && quickWanted;
    $('#bf-quickhint').textContent = !t.quick ? `${t.label} has no quick mode yet. Quick mode works with ${quickTpls}.`
      : mixed ? 'Quick mode does not take a mix. Untick the mixed templates to use it.'
        : `The Director writes a short outline (a headline, ${t.quick.points[0]}-${t.quick.points[1]} points, a call to action); the engine builds the script from it. Good for a simple video or a smaller model.`;
  };
  const syncAll = () => { syncMix(); syncPlatforms($('#bf-plat').value); syncFormats($('#bf-fmt').value); syncTpl(); syncAlso(); syncQuick(); syncId(); };
  // Language and voice default to the brand's; a voice says which language it speaks, and Kokoro here speaks English only.
  const bv = S.state.projects.find((p) => p.id === S.project)?.brand?.voice || {};
  const brandLang = String(bv.lang || 'en').toLowerCase();
  const pickedLang = () => $('#bf-lang').value || brandLang;
  $('#bf-lang').innerHTML = opt('', `Brand default (${langName(brandLang)})`, !pre.lang)
    + LANGS.map(([c, n]) => opt(c, `${n} · ${c}`, c === pre.lang)).join('')
    + (pre.lang && !LANGS.some(([c]) => c === pre.lang) ? opt(pre.lang, pre.lang, true) : '');
  const voiceLang = (engine, v) => (engine === 'kokoro' ? ({ a: 'en', b: 'en-gb' }[v.id[0]] || null) : engine === 'sapi' ? String(v.culture || '').toLowerCase() || null : null);
  const syncVoiceHint = () => {
    const sel = $('#bf-voice').selectedOptions[0];
    const vl = sel?.dataset.lang, lang = pickedLang();
    const clash = Boolean(sel?.value && vl && vl.split('-')[0] !== lang.split('-')[0]);
    const missing = !sel?.value && missingEngine(bv.tts);
    $('#bf-voicehint').textContent = missing ? `${missing} This video would have music only: pick a Windows voice here, or set one on the Brand tab.`
      : !sel?.value ? `Uses the brand voice (${bv.tts || 'none'}${bv.voice ? ` · ${bv.voice}` : ''}).`
        : clash ? `This voice speaks ${vl}; the video is ${lang}. Pick a voice in that language.` : '';
    $('#bf-voicehint').classList.toggle('bad-t', clash || Boolean(missing));
  };
  const fillVoices = (opts) => {
    const groups = (opts?.voices || []).filter((e) => e.available && e.voices.length).map((e) => `<optgroup label="${esc(e.label)}">${e.voices.map((v) => {
      const val = `${e.id}:${v.id}`, vl = voiceLang(e.id, v), off = e.id === 'kokoro' && !vl;
      return `<option value="${esc(val)}" data-lang="${esc(vl || '')}" ${val === pre.voice ? 'selected' : ''} ${off ? 'disabled' : ''}>${esc(v.label)}${off ? ' (needs a phonemizer this machine lacks)' : ''}</option>`;
    }).join('')}</optgroup>`).join('');
    const known = !pre.voice || pre.voice === 'none:' || (opts?.voices || []).some((e) => e.voices.some((v) => `${e.id}:${v.id}` === pre.voice));
    $('#bf-voice').innerHTML = opt('', 'Brand default', !pre.voice) + opt('none:', 'No voice-over (music only)', pre.voice === 'none:') + groups
      + (known ? '' : opt(pre.voice, `${pre.voice} (not on this machine)`, true));
    syncVoiceHint();
    if (S.briefForm?.edit) S.briefSnap = JSON.stringify(briefBody());
  };
  const music = S.state.projects.find((p) => p.id === S.project)?.brand?.music?.file;
  $('#bf-beathint').textContent = music ? `Each scene stretches a little so it ends on a beat of ${music.replace(/^library:/, '')}. Works best with music that has a steady beat.`
    : 'The brand has no background music yet: set one on the Brand tab first.';
  $('#bf-beat').disabled = !music && !pre.cutOnBeat;
  $('#bf-pulse').disabled = !music && !pre.beatPulse;
  fillVoices(S.options);
  if (!S.options) api('/options').then((o) => { S.options = o; if ($('#bf-voice')) fillVoices(o); }).catch(() => {});
  // Recorded takes are the project's audio assets; a take no longer in the assets stays listed so the brief keeps it.
  api(`/projects/${encodeURIComponent(S.project)}`).then((d) => {
    if (!$('#bf-take')) return;
    const takes = (d.assets || []).filter((a) => /\.(wav|mp3|m4a)$/i.test(a));
    const cur = $('#bf-take').value;
    $('#bf-take').innerHTML = opt('', 'None — use the brand voice', !cur) + takes.map((a) => opt(a, a, a === cur)).join('')
      + (cur && !takes.includes(cur) ? opt(cur, `${cur} (not in the assets)`, true) : '');
  }).catch(() => {});
  $('#bf-lang').addEventListener('change', syncVoiceHint);
  $('#bf-voice').addEventListener('change', syncVoiceHint);
  drawMix(); syncMix(); syncPlatforms(pre.platform); syncFormats(pre.format); syncTpl(); syncAlso(); syncQuick(); syncId();
  S.briefSnap = pre.edit ? JSON.stringify(briefBody()) : null;
  $('#bf-tpl').addEventListener('change', () => { drawMix(); syncAll(); });
  $('#bf-mixlist').addEventListener('change', syncAll);
  $('#bf-quick').addEventListener('change', (e) => { quickWanted = e.target.checked; });
  $('#bf-plat').addEventListener('change', () => { syncFormats($('#bf-fmt').value); syncAlso(); syncId(); });
  $('#bf-fmt').addEventListener('change', syncAlso);
  $('#bf-alsolist').addEventListener('change', syncAlso);
  ['bf-subj', 'bf-id', 'bf-fmt'].forEach((id) => $(`#${id}`).addEventListener('input', syncId));
  $('#bf-cancel').addEventListener('click', closeBriefForm);
  // "Save and run Director" is the same person click as Run Director on the job, done in one step.
  const save = (btn, run) => {
    if (INFLIGHT.has('form:brief')) return;
    const body = { id: syncId(), project: S.project, ...briefBody() };
    if (body.duration === null) { $('#bf-err').textContent = 'Set the duration in seconds.'; $('#bf-dur').focus(); return; }
    const newScript = hasScript && (body.template !== pre.template || JSON.stringify(body.mix) !== JSON.stringify(pre.mix || []) || body.quick !== (pre.quick === true));
    if (newScript && !window.confirm(TPL_CHANGE_CONFIRM)) return;
    sendBrief(btn, run, body);
  };
  const sendBrief = (btn, run, body) => guarded('form:brief', btn, async () => {
    if (pre.edit) {
      const res = await api(`/briefs/${jobPath(S.project, pre.id)}`, { method: 'PUT', body });
      toast(res.newScript ? `Saved. ${pre.id} is back in the Director queue for a new script; the old one is in script.prev.json.`
        : res.requeued ? `Saved. ${pre.id} is back in the Director queue.` : res.rePrepare ? `Saved. Rebuild the storyboard of ${pre.id} to hear the new voice.` : res.changed.length ? `Saved brief ${pre.id}.` : 'Nothing changed.');
    } else {
      await api('/briefs', { method: 'POST', body });
      toast(`Saved brief ${body.id}. Waiting for Director.`);
    }
    S.briefForm = null;
    if (run) {
      try {
        await api('/director/run', { method: 'POST', body: { project: S.project, job: body.id } });
        toast(`Saved brief ${body.id}. Director started.`);
      } catch (err) { toast(`Saved brief ${body.id}, but the Director did not start: ${err.message}`); }
    }
    await refreshJobs(false);
    await selectJob(body.id);
  }, $('#bf-err'));
  $('#bf').addEventListener('submit', (e) => { e.preventDefault(); save($('#bf-save'), false); });
  applyLocks();
  $('#bf-saverun')?.addEventListener('click', (e) => save(e.currentTarget, true));
  wireEvidence();
}

/* ---------------- new from script ---------------- */
// A person's scene script and the brand's clips become a scripted job (engine/scenescript.mjs): no Director, no model.
const SCRIPT_CHARS = 64 * 1024; // engine/scenescript.mjs SCENE_SCRIPT_CAPS.chars
const scriptPart = (p) => `${p.id}: ${p.assets.length ? p.assets.join(', ') : p.kind === 'title' ? 'title card' : 'closing card'}${p.in !== undefined ? ` ${p.in}–${p.out} s` : ''}${p.hold ? `, holds the last frame ${p.hold} s` : ''}${p.kind === 'video' && !p.sound ? ', no sound' : ''}`;

function openSceneScriptForm() {
  if (!confirmDiscard()) return;
  stopPreview();
  if (S.sel) S.prevSel = S.sel;
  S.briefForm = { sceneScript: true }; S.sel = null; S.detail = null; S.paneDirty = false; S.seqSel = null; S.seqForm = null;
  $$('#joblist .job, #seqlist .job').forEach((x) => x.classList.remove('on'));
  const P = encodeURIComponent(S.project);
  $('#detail').innerHTML = `<div class="head"><h2>New from script</h2><span class="pill">${esc(S.project)}</span></div>
  <form class="stack" id="ss" novalidate>
    <p class="muted" style="margin:0">Paste a scene script: <code>TITLE:</code> with a <code>VOICE:</code> line for the opening card, then
      <code>SCENE 1 — TITLE (0–4 seconds)</code> blocks, each with <code>CLIP: name.mp4 0:00-0:04</code> (one or more) or <code>IMAGES:</code> (2-4 pictures),
      and optional <code>VOICE:</code> and <code>ON SCREEN:</code> lines. An <code>End card:</code> takes its own <code>VOICE:</code> and <code>BUTTON:</code>.
      Other lines stay as notes. The job is an explainer with every field locked as you wrote it; no Director runs.<br>
      A script with no <code>TITLE</code> and no <code>End card</code> makes a <b>clip reel</b> instead: the clips full frame with their own sound, no cards, no subtitles.
      <code>Cảnh 1 – Title</code> works too, a scene's length may sit in its text (<code>an 8-second video</code>), and <code>ACTION:</code>, <code>CAMERA:</code> or <code>AUDIO:</code> sections stay with their scene.</p>
    <div class="f"><label for="ss-text">Scene script</label><textarea id="ss-text" maxlength="${SCRIPT_CHARS}" spellcheck="false"></textarea></div>
    <div class="grid2">
      <div class="f"><label for="ss-file">Or load a .txt or .md file</label><input type="file" id="ss-file" accept=".txt,.md,text/plain,text/markdown" aria-describedby="ss-filest">
        <span class="muted hint" id="ss-filest" role="status"></span></div>
      <div class="f"><label for="ss-id">Job id</label><input id="ss-id" maxlength="64" placeholder="auto from VIDEO ID or TITLE"></div>
      <div class="f ss-drop" id="ss-drop" style="grid-column:1/-1"><label for="ss-media">Clips and pictures <span class="muted">· pick several at once, or drop them here</span></label>
        <input type="file" id="ss-media" multiple accept=".mp4,.webm,.mov,.png,.jpg,.jpeg,.webp" aria-describedby="ss-up">
        <span class="muted hint" id="ss-up" role="status">Uploaded to this brand's assets, as in the Brand tab. The script names them by file name.</span>
        <ul class="ss-uploaded" id="ss-list" aria-label="Files uploaded from this form"></ul></div>
    </div>
    <div class="row"><button class="btn" type="button" id="ss-check">Check script</button><button class="btn p" type="submit" id="ss-save">Create job</button>
      <button class="btn" type="button" id="ss-cancel">Cancel</button><span class="muted mono" id="ss-path"></span></div>
    <div id="ss-rows" aria-live="polite"></div>
    <div class="err" role="alert" id="ss-err"></div>
  </form>`;
  let fileName = '';
  const body = (check) => ({ text: $('#ss-text').value, job: $('#ss-id').value.trim(), file: fileName, check });
  const syncPath = (id) => { const j = $('#ss-id').value.trim() || id; $('#ss-path').textContent = j ? `→ briefs/${S.project}/${j}.json` : ''; };

  // Generate clip (server/generate.mjs): one click makes one clip for one scene; nothing starts on its own.
  const project = S.project;
  let last = null, gen = null, making = null, genTimer = 0;
  const prompts = {}; // edited prompts by scene number, kept while the composed prompt stays the same
  const formAlive = () => Boolean($('#ss')?.isConnected) && Boolean(S.briefForm?.sceneScript) && S.project === project;
  const sceneOf = (row) => last?.scenes?.find((s) => row.at === `Scene ${s.n}`);
  const promptOf = (s) => (prompts[s.n]?.base === s.prompt ? prompts[s.n].text : s.prompt);
  const genPanel = (s) => `<details class="ss-gen"><summary class="btn sm">Generate clip</summary>
      <div class="f"><label for="ss-gp-${s.n}">Clip prompt for scene ${s.n} <span class="muted">(edit it before the click)</span></label><textarea id="ss-gp-${s.n}" data-gp="${s.n}" spellcheck="false">${esc(promptOf(s))}</textarea></div>
      <div class="row"><button class="btn p sm" type="button" data-gg="${s.n}">Make clip for scene ${s.n}</button><span class="small" data-gc="${s.n}"></span></div></details>`;
  const genHead = () => (last?.scenes?.length ? `<div class="banner" role="group" aria-label="Generate clips"><p class="small" style="margin:0">
      <b>Generate clip:</b> ${esc(last.clip.aspect)}, reference pictures ${last.clip.refs.length ? esc(last.clip.refs.join(', ')) : 'none (text only)'}${last.clip.brief ? '' : ', no clip brief yet'} (Brand tab → Clip defaults). ${esc(GEN_CLIP_NOTE)} The saved clip goes into its scene's CLIP line; check the script again after each one.</p>
      <label class="small" id="ss-genackrow" style="display:inline-flex;gap:6px;align-items:center"${gen?.notice ? ' hidden' : ''}><input type="checkbox" id="ss-genack"> ${esc(GEN_NOTICE)} I understand.</label>
      <p class="small" id="ss-genstate" role="status" style="margin:0"></p></div>` : '');
  // Why no clip can start now, or ''.
  const genBlock = () => {
    if (!gen) return 'Restart npm run ui to enable generation.';
    if (!gen.hasKey) return `Add ${gen.keyEnv || 'GEMINI_API_KEY'} to .env in the Motion Studio folder (or set it in your environment), then restart npm run ui.`;
    if (gen.error) return gen.error;
    if (gen.running && !making) return 'Another Gemini request is running.';
    if (gen.pause) return `Paused until ${new Date(gen.pause.until).toLocaleString('en-US')} after a Gemini quota or spend limit. Clear it in the Brand tab.`;
    const u = gen.usage.videos, c = gen.caps;
    if (u.day >= c.maxVideosPerDay) return `Daily clip limit reached (${c.maxVideosPerDay}, generate.maxVideosPerDay).`;
    if (u.month >= c.maxVideosPerMonth) return `Monthly clip limit reached (${c.maxVideosPerMonth}, generate.maxVideosPerMonth).`;
    return '';
  };
  const drawPromptState = (ta) => {
    const n = ta.dataset.gp, text = ta.value.trim(), over = promptCut(text), why = genBlock();
    const out = $(`[data-gc="${n}"]`), btn = $(`[data-gg="${n}"]`);
    if (out) { out.className = `small ${over ? 'bad-t' : 'muted'}`; out.textContent = over || `${text.length}/${GEN_PROMPT_MAX} characters`; }
    if (btn) {
      btn.disabled = Boolean(over || !text || why || making);
      btn.title = over ? 'Cut the prompt first' : !text ? 'Write a prompt first' : why || (making ? 'A clip is being made' : '');
    }
  };
  const drawGenState = () => {
    const st = $('#ss-genstate');
    if (!st) return;
    const why = genBlock(), u = gen?.usage?.videos, c = gen?.caps;
    st.innerHTML = making ? `<span class="spin" aria-hidden="true"></span> Making the clip for scene ${esc(making.n)}, usually 1-3 minutes…`
      : why ? `<span class="bad-t">${esc(why)}</span>` : `<span class="muted">Clips: ${esc(u.day)}/${esc(c.maxVideosPerDay)} today · ${esc(u.month)}/${esc(c.maxVideosPerMonth)} this month</span>`;
    $('#ss-genackrow')?.toggleAttribute('hidden', Boolean(gen?.notice));
    $$('[data-gp]').forEach(drawPromptState);
  };
  const loadGen = async () => { try { gen = (await api(`/projects/${P}`)).generate || null; } catch { /* the next check tries again */ } };
  // Polls while this form's clip is made; once it is saved, its name goes into that scene's CLIP line.
  const watchClip = () => {
    clearTimeout(genTimer);
    genTimer = setTimeout(async () => {
      if (!formAlive() || !making) return;
      await loadGen();
      if (!formAlive()) return;
      if (gen?.running?.project === project) { drawGenState(); watchClip(); return; }
      const done = gen?.last, n = making.n;
      making = null;
      if (done?.status === 'done') {
        const next = insertClip($('#ss-text').value, n, done.name);
        if (next !== null) $('#ss-text').value = next;
        toast(next === null ? `Saved ${done.name}. Scene ${n} is not in the text any more: add it to its CLIP line.` : `Saved ${done.name} into scene ${n}'s CLIP line. Check the script.`);
      } else if (done) $('#ss-err').textContent = `Scene ${n}: ${done.message}`;
      drawGenState();
    }, 3000);
  };
  const makeClip = async (n) => {
    const text = $(`[data-gp="${n}"]`)?.value.trim() || '';
    $('#ss-err').textContent = '';
    const over = promptCut(text);
    if (over) { $('#ss-err').textContent = `Scene ${n}: the prompt is ${over}.`; return; }
    if (making || !last) return;
    making = { n };
    drawGenState();
    try {
      await api(`/projects/${P}/generate`, { method: 'POST', body: {
        kind: 'video', prompt: text, aspectRatio: last.clip.aspect, refs: last.clip.refs, unique: true,
        name: `${$('#ss-id').value.trim() || last.id}-scene-${n}.mp4`, acknowledged: Boolean($('#ss-genack')?.checked),
      } });
    } catch (err) {
      making = null;
      $('#ss-err').textContent = `Scene ${n}: ${err.message}`;
      drawGenState();
      return;
    }
    watchClip();
  };
  $('#ss-rows').addEventListener('input', (e) => {
    const ta = e.target.closest('[data-gp]');
    const s = ta && last?.scenes?.find((x) => String(x.n) === ta.dataset.gp);
    if (!s) return;
    prompts[s.n] = { base: s.prompt, text: ta.value };
    drawPromptState(ta);
  });
  $('#ss-rows').addEventListener('click', (e) => {
    const go = e.target.closest('[data-gg]');
    if (go && !go.disabled) makeClip(Number(go.dataset.gg));
  });

  const drawRows = (r) => {
    last = r;
    const inRows = new Set(r.rows.flatMap((x) => [...x.errors, ...x.warnings]));
    const loose = [...r.errors, ...r.warnings].filter((x) => !inRows.has(x));
    const head = r.errors.length ? `<p class="small bad-t">${r.errors.length} problem(s) to fix before Create job.</p>`
      : `<p class="small">Ready: job ${esc(r.id)}${r.exists ? ' <span class="bad-t">(this id is taken: set another job id)</span>' : ''}, ${esc(['explainer', ...r.mix].join(' + '))} ${esc(r.format)}, about ${esc(r.duration)} s.</p>`;
    $('#ss-rows').innerHTML = `${head}${loose.length ? `<ul class="small">${loose.map((x) => `<li class="${r.errors.includes(x) ? 'bad-t' : 'warn-t'}">${esc(x)}</li>`).join('')}</ul>` : ''}
      ${genHead()}
      <ol class="ss-rows">${r.rows.map((row) => `<li class="${row.errors.length ? 'bad' : ''}">
        <div><b>${esc(row.at)}</b> ${esc(row.title)}${row.span ? ` <span class="muted mono">${esc(row.span[0])}–${esc(row.span[1])} s</span>` : ''}</div>
        ${row.parts.map((p) => `<div class="mono small">${esc(scriptPart(p))}</div>`).join('')}
        ${row.errors.map((x) => `<div class="small bad-t">${esc(x)}</div>`).join('')}${row.warnings.map((x) => `<div class="small warn-t">${esc(x)}</div>`).join('')}
        ${sceneOf(row) ? genPanel(sceneOf(row)) : ''}</li>`).join('')}</ol>
      ${r.notes.length ? `<ul class="muted small">${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    syncPath(r.id);
    drawGenState();
  };
  const check = (btn) => guarded('form:script', btn, async () => {
    if (!$('#ss-text').value.trim()) throw new Error('Paste the scene script first.');
    const r = await api(`/projects/${P}/scene-script`, { method: 'POST', body: body(true) });
    await loadGen();
    drawRows(r);
  }, $('#ss-err'));
  $('#ss-check').addEventListener('click', (e) => check(e.currentTarget));
  $('#ss').addEventListener('submit', (e) => {
    e.preventDefault();
    guarded('form:script', $('#ss-save'), async () => {
      if (!$('#ss-text').value.trim()) throw new Error('Paste the scene script first.');
      const r = await api(`/projects/${P}/scene-script`, { method: 'POST', body: body(false) });
      S.briefForm = null;
      toast(`Created ${r.brief.id}: ${r.script.scenes.length} scenes, locked as written. Build the storyboard next.`);
      await refreshJobs(false);
      await selectJob(r.brief.id);
    }, $('#ss-err'));
  });
  $('#ss-cancel').addEventListener('click', closeBriefForm);
  $('#ss-id').addEventListener('input', () => syncPath(''));
  $('#ss-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.(txt|md)$/i.test(f.name)) { $('#ss-err').textContent = 'Load a .txt or .md file.'; return; }
    if (f.size > SCRIPT_CHARS * 4) { $('#ss-err').textContent = `${f.name} is larger than ${SCRIPT_CHARS * 4 / 1024} KB.`; return; }
    $('#ss-text').value = await f.text();
    fileName = f.name;
    $('#ss-err').textContent = '';
    // The picker is cleared so the same file can be loaded again; this line says what was loaded.
    $('#ss-filest').className = 'hint ok-t';
    $('#ss-filest').textContent = `Loaded ${f.name} · ${$('#ss-text').value.length} characters`;
  });
  $('#ss-text').addEventListener('input', () => { if (!$('#ss-text').value.trim()) fileName = ''; });
  // Uploads go through the Brand tab's asset route and checks, one file at a time; a name the server cleaned is said.
  const uploaded = [];
  const uploadMedia = async (files) => {
    if (!files.length) return;
    const say = (text, cls = 'muted') => { const st = $('#ss-up'); if (st) { st.className = `hint ${cls}`; st.textContent = text; } };
    const done = [], failed = [];
    S.uploading = (S.uploading || 0) + 1;
    try {
      const o = S.options || (S.options = await api('/options'));
      // A name already in the assets is used as it is: the script names files, so it needs no second copy.
      const have = new Set((await api(`/projects/${P}`)).assets || []);
      for (const [i, f] of files.entries()) {
        if (have.has(f.name)) { done.push(`${f.name} (already in assets, kept)`); continue; }
        const why = uploadProblem(f, o.assetTypes, o.maxAssetMB * 1024 * 1024, o.maxVideoMB * 1024 * 1024);
        if (why) { failed.push(`${f.name}: ${why}`); continue; }
        try {
          const data = await postFile(`/projects/${P}/assets?name=${encodeURIComponent(f.name)}&replace=0`, f, 'application/octet-stream', (p) => say(`Uploading ${i + 1} of ${files.length}: ${Math.round(p * 100)}%`));
          done.push(data.name === f.name ? data.name : `${f.name} saved as ${data.name}`);
        } catch (err) { failed.push(`${f.name}: ${err.message}`); }
      }
    } catch (err) { failed.push(err.message); } finally { S.uploading -= 1; }
    say([done.length ? `${done.length} of ${files.length} file(s) ready in this brand's assets.` : '', failed.join(' ')].filter(Boolean).join(' '), failed.length ? 'bad-t' : 'ok-t');
    uploaded.push(...done);
    if ($('#ss-list')) $('#ss-list').innerHTML = uploaded.map((n) => `<li class="mono">${esc(n)}</li>`).join('');
    if (done.length && $('#ss-text')?.value.trim()) check($('#ss-check'));
  };
  $('#ss-media').addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    uploadMedia(files);
  });
  const drop = $('#ss-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadMedia([...(e.dataTransfer?.files || [])]); });
  applyLocks();
  $('#ss-text').focus();
}

/* ---------------- evidence (brief form) ---------------- */
// Fact lines with their source, from read-only git or a CSV export. Insert only edits the Facts box; the person saves the brief.
const FACTS_MAX = 2000; // engine/jobs.mjs validateBrief facts cap
const evidencePanel = () => `<details class="evidence" id="ev"><summary>Add evidence from git or a CSV export</summary>
  <div class="seg" role="tablist" aria-label="Evidence source">
    <button type="button" role="tab" id="ev-tgit" aria-controls="ev-git" aria-selected="true" class="on" data-ev="git">Git</button>
    <button type="button" role="tab" id="ev-tcsv" aria-controls="ev-csv" aria-selected="false" data-ev="csv">CSV</button></div>
  <div id="ev-git" role="tabpanel" aria-labelledby="ev-tgit" class="stack">
    <div class="grid2">
      <div class="f"><label for="ev-repo">Repo</label><select id="ev-repo" aria-describedby="ev-repohint"></select><span class="muted hint" id="ev-repohint"></span></div>
      <div class="f"><label for="ev-tickets">Tickets</label><input id="ev-tickets" maxlength="400" placeholder="OP-8254, OP-8049"></div>
      <div class="f"><label for="ev-grep">Or text in commit messages</label><input id="ev-grep" maxlength="100" placeholder="Catalog feed"></div>
      <div class="f"><label for="ev-since">Period (optional)</label><div class="row"><input id="ev-since" type="date" aria-label="Since"><span class="muted">to</span><input id="ev-until" type="date" aria-label="Until"></div></div>
    </div>
    <div class="row"><button class="btn" type="button" id="ev-gitrun">Find commits</button><span class="muted small">Read-only git on this computer: commits, the merging PR and the first release branch.</span></div>
  </div>
  <div id="ev-csv" role="tabpanel" aria-labelledby="ev-tcsv" class="stack" hidden>
    <div class="f"><label for="ev-file">CSV export (e.g. GA4)</label><input id="ev-file" type="file" accept=".csv,text/csv" aria-describedby="ev-filehint">
      <span class="muted hint" id="ev-filehint">Read for this calculation only; the file is not stored.</span></div>
    <div class="grid2" id="ev-cols" hidden>
      <div class="f"><label for="ev-date">Date column</label><select id="ev-date"></select></div>
      <div class="f"><label for="ev-group">Split by (optional)</label><select id="ev-group"></select></div>
      <fieldset class="mix"><legend>Values to sum</legend><div class="row" id="ev-vals"></div></fieldset>
      <div class="f"><label for="ev-r1">Period</label><input id="ev-r1" placeholder="2025-01..2025-09"></div>
      <div class="f"><label for="ev-r2">Later period to compare (optional)</label><input id="ev-r2" placeholder="2026-01..2026-09"></div>
      <div class="f"><label for="ev-prefix">Currency sign for revenue-like columns (optional)</label><input id="ev-prefix" maxlength="3" placeholder="$"></div>
    </div>
    <div class="row"><button class="btn" type="button" id="ev-csvrun" disabled>Compute totals</button></div>
  </div>
  <div id="ev-out"></div>
  <div class="err" role="alert" id="ev-err"></div>
</details>`;

function wireEvidence() {
  const box = $('#ev');
  if (!box) return;
  const err = $('#ev-err');
  let cfg = null, file = null;
  const num = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
  box.addEventListener('toggle', () => {
    if (!box.open || cfg) return;
    api('/evidence').then((c) => {
      cfg = c;
      $('#ev-repo').innerHTML = c.repos.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
      $('#ev-repohint').textContent = c.repos.length ? `Release branches: ${c.releasePattern}…; up to ${c.maxCommits} commits per search.` : 'No repo set up: add one to config/studio.json → evidence.repos.';
      $('#ev-gitrun').disabled = !c.repos.length;
    }).catch((e) => { err.textContent = e.message; });
  });
  // Enter in an evidence field runs that search; it must not submit (save) the brief.
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const run = e.target.closest('#ev-git') ? $('#ev-gitrun') : $('#ev-csvrun');
    if (!run.disabled) run.click();
  });
  $$('#ev [role=tab]').forEach((t) => t.addEventListener('click', () => {
    for (const x of $$('#ev [role=tab]')) {
      const on = x === t;
      x.classList.toggle('on', on);
      x.setAttribute('aria-selected', String(on));
      $(`#ev-${x.dataset.ev}`).hidden = !on;
    }
  }));

  const showResult = (table, lines, note) => {
    $('#ev-out').innerHTML = `<div class="tscroll">${table}</div>${note ? `<p class="muted small">${esc(note)}</p>` : ''}
      ${lines.length ? `<fieldset class="ev-lines"><legend>Fact lines</legend>${lines.map((l, i) => `<label class="chk"><input type="checkbox" value="${i}" checked><span>${esc(l)}</span></label>`).join('')}</fieldset>
      <div class="row"><button class="btn p" type="button" id="ev-insert">Insert into facts</button><span class="muted small">Then save the brief to keep them.</span></div>`
        : '<p class="muted">No fact lines: nothing matched.</p>'}`;
    $('#ev-insert')?.addEventListener('click', () => {
      const picked = $$('#ev-out .ev-lines input:checked').map((x) => lines[Number(x.value)]);
      if (!picked.length) { err.textContent = 'Tick at least one line.'; return; }
      const facts = $('#bf-facts'), cur = facts.value.replace(/\s+$/, '');
      const have = new Set(cur.split('\n').map((s) => s.trim()));
      const add = picked.filter((l) => !have.has(l));
      const next = [cur, ...add].filter(Boolean).join('\n');
      if (next.length > FACTS_MAX) { err.textContent = `Facts would be ${next.length} characters; the limit is ${FACTS_MAX}. Untick some lines or shorten the facts.`; return; }
      facts.value = next;
      err.textContent = '';
      toast(add.length ? `Added ${add.length} line(s) to Facts. Save the brief to keep them.` : 'Those lines are in Facts already.');
    });
  };

  $('#ev-gitrun').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    $('#ev-out').innerHTML = '';
    const r = await api('/evidence/git', {
      method: 'POST', body: { repo: $('#ev-repo').value, tickets: $('#ev-tickets').value, grep: $('#ev-grep').value, since: $('#ev-since').value, until: $('#ev-until').value },
    });
    const rows = r.rows.map((x) => `<tr><td class="mono">${esc(x.term)}</td>${x.found
      ? `<td>${esc(`${x.merged ? 'merged' : 'committed'} ${x.date}`)}</td><td class="mono">${esc(x.release || 'not in any release branch')}</td><td class="n">${x.commits.length}</td>`
      : `<td colspan="3" class="muted">${x.skipped ? 'skipped: commit cap reached' : 'no commits found'}</td>`}</tr>`).join('');
    showResult(`<table class="timing evt"><thead><tr><th>Search</th><th>Date</th><th>First release</th><th>Commits</th></tr></thead><tbody>${rows}</tbody></table>`,
      r.lines, `${r.examined} commit(s) examined in ${r.repo}.${r.capped ? ` The cap of ${r.cap} was reached: narrow the search.` : ''}`);
  }, err));

  const postCsv = (q) => sendJson(`/evidence/csv?${q}`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: file });
  $('#ev-file').addEventListener('change', async () => {
    file = $('#ev-file').files[0] || null;
    $('#ev-cols').hidden = true;
    $('#ev-csvrun').disabled = true;
    $('#ev-out').innerHTML = '';
    err.textContent = '';
    if (!file) return;
    try {
      const c = await postCsv(new URLSearchParams({ name: file.name }));
      const opts = (list, sel) => list.map((x) => `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
      const values = c.numberColumns.filter((x) => !c.dateColumns.includes(x));
      $('#ev-date').innerHTML = opts(c.columns, c.dateColumns[0]);
      $('#ev-group').innerHTML = `<option value="">No split</option>${opts(c.columns.filter((x) => !values.includes(x)))}`;
      $('#ev-vals').innerHTML = (values.length ? values : c.columns).map((x) => `<label class="chk"><input type="checkbox" value="${esc(x)}"> ${esc(x)}</label>`).join('');
      $('#ev-filehint').textContent = `${c.rows} rows, ${c.columns.length} columns. Read for this calculation only; the file is not stored.`;
      $('#ev-cols').hidden = false;
      $('#ev-csvrun').disabled = false;
    } catch (e2) { err.textContent = e2.message; }
  });
  $('#ev-csvrun').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    $('#ev-out').innerHTML = '';
    const q = new URLSearchParams({ name: file.name, date: $('#ev-date').value });
    $$('#ev-vals input:checked').forEach((x) => q.append('value', x.value));
    [$('#ev-r1').value.trim(), $('#ev-r2').value.trim()].filter(Boolean).forEach((v) => q.append('range', v));
    if ($('#ev-group').value) q.set('group', $('#ev-group').value);
    if ($('#ev-prefix').value.trim()) q.set('prefix', $('#ev-prefix').value.trim());
    const r = await postCsv(q);
    const two = r.ranges.length === 2;
    const rows = r.rows.map((x) => `<tr><td>${esc(x.column)}</td>${r.groupCol ? `<td>${esc(x.group ?? 'all')}</td>` : ''}${x.totals.map((t) => `<td class="n">${num(t)}</td>`).join('')}${two ? `<td class="n">${x.growth === null ? '–' : `${x.growth > 0 ? '+' : ''}${x.growth}%`}</td>` : ''}</tr>`).join('');
    const head = `<th>Value</th>${r.groupCol ? `<th>${esc(r.groupCol)}</th>` : ''}${r.ranges.map((x) => `<th>${esc(x.label)} <span class="muted">(${x.rows} rows)</span></th>`).join('')}${two ? '<th>Growth</th>' : ''}`;
    showResult(`<table class="timing evt"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`, r.lines, r.warnings.join(' '));
  }, err));
}

/* ---------------- sequences ---------------- */
// A sequence joins finished job videos (one format) into one MP4. The server re-checks every part and its frame size.
const SEQ_STATUS = { draft: 'not rendered', rendering: 'rendering', done: 'done', error: 'error' };
const NO_SELECTION = '<p class="muted">Select a job or a sequence on the left.</p>';
const seqItem = (id) => S.seqs.find((x) => x.sequence.id === id);
const jobById = (id) => S.jobs.find((j) => j.brief.id === id);
const partReady = (id, format) => {
  const j = jobById(id);
  return Boolean(j && j.status.status === 'done' && j.status.outputs?.final && j.brief.format === format);
};
const transitionOf = (id) => S.seqMeta.transitions.find((t) => t.id === id) || { id, label: id, seconds: 0 };
const transitionLabel = (id) => { const t = transitionOf(id); return t.seconds ? `${t.label} (${t.seconds} s)` : t.label; };
// The transition of each join (between part i and i + 1): the list where it has one, else the sequence default.
const joinsOf = (parts, transition, transitions) => parts.slice(1).map((_, i) => transitions?.[i] || transition);
// One label for the joins: the shared preset, or "mixed" when they differ.
const joinsLabel = (parts, transition, transitions) => {
  const ids = [...new Set(joinsOf(parts, transition, transitions))];
  return ids.length <= 1 ? transitionLabel(ids[0] || transition) : `mixed transitions (${ids.length})`;
};
// A part's length now, by the rule of sequenceBudget (engine/sequences.mjs): render, storyboard, else the brief (an estimate).
const partLength = (j) => {
  const s = j.status;
  if (s.status === 'done' && Number(s.outputs?.duration) > 0) return { d: Number(s.outputs.duration), from: 'render' };
  const rewrite = ['queued', 'scripting', 'scripted'].includes(s.status) || (s.status === 'dirty' && (s.dirty_from ?? 99) < 5);
  if (!rewrite && Number(s.duration) > 0) return { d: Number(s.duration), from: 'storyboard' };
  return { d: Number(j.brief.duration) || 0, from: 'brief' };
};
// The form's budget before saving, in the shape the server's sequenceBudget returns.
const budgetOf = (parts, transition, transitions, format, target = null) => {
  const joins = joinsOf(parts, transition, transitions);
  let end = 0;
  const list = parts.map((id, i) => {
    const start = i ? end - transitionOf(joins[i - 1]).seconds : 0;
    const j = jobById(id);
    if (!j) { end = start; return { id, duration: 0, from: 'missing', estimate: true, start, planned: null, status: null, ready: false, problem: 'missing' }; }
    const len = partLength(j), ready = partReady(id, format);
    end = start + len.d;
    return { id, duration: len.d, from: len.from, estimate: len.from === 'brief', start, planned: j.brief.duration, status: j.status.status, ready, problem: ready ? null : j.brief.format !== format ? 'size' : 'render' };
  });
  return { parts: list, total: end, target, estimate: list.some((p) => p.estimate), notReady: [...new Set(list.filter((p) => !p.ready).map((p) => p.id))] };
};
const mmss = (t) => { const r = Math.round(t); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
const secs = (t) => `${Math.round(t * 10) / 10} s`;
const notReadyLabel = (p) => (p.problem === 'missing' ? 'job not found' : p.problem === 'size' ? 'other frame size' : `not rendered: ${STATUS[p.status] || p.status}`);

// The film against its target: one segment per part (striped while its length is an estimate) and a target mark.
function budgetHtml(b) {
  if (!b?.parts.length) return '';
  const scale = Math.max(b.total, b.target || 0) || 1;
  const pct = (x) => `${Math.max(0, Math.min(100, (x / scale) * 100)).toFixed(2)}%`;
  const over = Boolean(b.target && b.total > b.target);
  const segs = b.parts.map((p, i) => {
    const end = i < b.parts.length - 1 ? b.parts[i + 1].start : b.total;
    const tip = `${i + 1}. ${p.id} · ${secs(p.duration)}${p.estimate ? ' (estimate)' : ''}`;
    return `<span class="bseg${p.estimate ? ' est' : ''}${p.ready ? '' : ' nr'}" style="width:${pct(end - p.start)}" title="${esc(tip)}"></span>`;
  }).join('');
  const marks = b.target ? `${over ? `<span class="bover" style="left:${pct(b.target)};width:${pct(b.total - b.target)}"></span>` : ''}<span class="btarget" style="left:${pct(b.target)}"></span>` : '';
  const sum = b.target
    ? `${mmss(b.total)} of ${mmss(b.target)} target · ${over ? `${secs(b.total - b.target)} over` : `${secs(b.target - b.total)} left`}`
    : `${mmss(b.total)} in total · no target set`;
  return `<div class="budget${over ? ' over' : ''}"><div class="bbar" role="img" aria-label="${esc(sum)}">${segs}${marks}</div>
    <p class="mono bsum">${esc(sum)}${b.estimate ? '<span class="muted"> · striped parts are estimates from their brief duration</span>' : ''}</p></div>`;
}
// A part changed after the render: the server marks the sequence's status stale and says why.
const seqStale = (it) => (it.status?.stale ? { reason: it.status.staleReason || 'A part changed after this sequence was rendered.' } : null);
const seqStamp = (it) => `${it.status.updatedAt}|${it.running}|${it.sequence.updatedAt}|${JSON.stringify(it.budget)}|${seqStale(it)?.reason ?? ''}`;
const seqFormDirty = () => Boolean(S.seqForm?.dirty && $('#sf'));
const seqPath = (id) => `/sequences/${encodeURIComponent(S.project)}/${encodeURIComponent(id)}`;

async function refreshSequences() {
  S.seqMeta = await api(`/sequences?project=${encodeURIComponent(S.project)}`);
  S.seqs = S.seqMeta.sequences;
  $('#n-seqs').textContent = S.seqs.length;
  const listHtml = S.seqs.length ? S.seqs.map((it) => {
    const { sequence: q, status: s, running } = it, stale = seqStale(it);
    const st = running ? 'rendering' : s.status;
    return `<button class="job ${S.seqSel === q.id ? 'on' : ''}" data-seq="${esc(q.id)}"${stale ? ` title="${esc(stale.reason)}"` : ''}>
      <span class="dot s-${esc(st)}" role="img" aria-label="Status: ${esc(SEQ_STATUS[st] || st)}" title="${esc(SEQ_STATUS[st] || st)}"></span>
      <span style="min-width:0;flex:1"><span class="t">${esc(q.title || q.id)}</span><br>
      <span class="m">${esc(SEQ_STATUS[st] || st)} · ${q.parts.length} parts · ${esc(q.format)}</span>
      ${stale ? '<br><span class="pill warn-t">Out of date — render again</span>' : ''}</span></button>`;
  }).join('') : '<p class="muted">No sequences yet.</p>';
  // Rewritten only when it changed: a poll every 2.5 s would otherwise take the keyboard focus off the list.
  if (listHtml !== S.seqListHtml) {
    S.seqListHtml = listHtml;
    $('#seqlist').innerHTML = listHtml;
    $$('#seqlist .job').forEach((b) => b.addEventListener('click', () => selectSequence(b.dataset.seq)));
  }
  if (S.seqSel && !S.seqForm) {
    const it = seqItem(S.seqSel);
    if (!it || seqStamp(it) !== S.seqStamp) renderSeqDetail();
  }
}

// Leaves whatever the detail pane shows; false when the person keeps unsaved edits.
/** Calls `then` once a composition frame says it is ready; gives up when the frame leaves the page or after ~30 s. */
function waitReady(frame, then, tries = 300) {
  if (!frame.isConnected || tries <= 0) return;
  if (frame.contentWindow?.__ready) then();
  else setTimeout(() => waitReady(frame, then, tries - 1), 100);
}

// Whatever replaces the job detail (another job, a project, the brief form, a delete) stops the preview with it:
// otherwise its voice and music play on with no Play button left to stop them.
function stopPreview() {
  stopPlay();
  stageRo?.disconnect();
  stageRo = null;
}

function leaveDetail() {
  if (!confirmDiscard()) return false;
  stopPreview();
  S.sel = null; S.detail = null; S.briefForm = null; S.paneDirty = false; S.seqSel = null; S.seqForm = null; S.seqStamp = null;
  $$('#joblist .job, #seqlist .job').forEach((b) => b.classList.remove('on'));
  return true;
}

function selectSequence(id) {
  if (!leaveDetail()) return;
  S.seqSel = id;
  $$('#seqlist .job').forEach((b) => b.classList.toggle('on', b.dataset.seq === id));
  renderSeqDetail();
}

// The row between two parts: the transition that joins them, read-only or as a select.
function joinRow(i, id, select = false) {
  const inner = select
    ? `<select data-join="${i}" aria-label="Transition before part ${i + 2}">${S.seqMeta.transitions.map((t) => `<option value="${esc(t.id)}" ${t.id === id ? 'selected' : ''}>${esc(transitionLabel(t.id))}</option>`).join('')}</select>`
    : `<span class="pill">${esc(transitionLabel(id))}</span>`;
  return `<li class="join"><span class="n">↓</span><span class="muted">then</span>${inner}</li>`;
}

// One part (a budget entry): its template, length now against its brief duration, and whether it can be joined yet.
function partRow(p, i, buttons = '') {
  const j = jobById(p.id);
  const FROM = { render: 'rendered', storyboard: 'storyboard', brief: 'estimate from the brief' };
  const long = !p.estimate && p.planned && p.duration > p.planned + 0.5;
  const len = p.problem === 'missing' ? '' : `<span class="mono ${long ? 'warn-t' : 'muted'}" title="${esc(FROM[p.from] || '')}">${p.estimate ? '~' : ''}${esc(secs(p.duration))}${p.planned ? ` / ${esc(p.planned)} s brief` : ''}</span>`;
  return `<li><span class="n">${i + 1}</span><b>${esc(p.id)}</b><span class="pill">${esc(j ? tplName(j.brief) : '?')}</span>${len}
    <span class="pill${p.ready ? '' : ' warn-t'}">${esc(p.ready ? 'rendered' : notReadyLabel(p))}</span>${buttons}</li>`;
}

function renderSeqDetail() {
  const it = seqItem(S.seqSel);
  if (!it) { S.seqSel = null; $('#detail').innerHTML = NO_SELECTION; return; }
  S.seqStamp = seqStamp(it);
  const { sequence: q, status: s } = it;
  const busyNow = it.running || s.status === 'rendering';
  const b = it.budget || budgetOf(q.parts, q.transition, q.transitions, q.format, q.targetDuration ?? null);
  const notReady = b.notReady;
  const o = s.outputs || {};
  const base = `/files/${encodeURIComponent(S.project)}/${encodeURIComponent(q.id)}`;
  const stamp = encodeURIComponent(s.updatedAt || '');
  // Each render is its own "<title> v<N>.mp4"; sequences rendered before versions wrote final.mp4.
  const film = o.final || 'final.mp4';
  const renderBtn = (label, p = false) => `<button class="btn ${p ? 'p' : ''}" id="sq-render" ${notReady.length ? 'disabled title="Some parts are not ready"' : ''}>${label}</button>`;
  const previewing = it.running?.action === 'sequence-preview';
  const pv = s.preview || null;
  const previewBtn = (label) => `<button class="btn sq-preview" type="button" ${notReady.length ? 'disabled title="Some parts are not ready"' : ''}>${label}</button>`;
  let banner;
  if (previewing) banner = `<div class="banner busy"><p><span class="spin" aria-hidden="true"></span> Making a quick preview of the ${q.parts.length} parts and their joins…</p></div>`;
  else if (busyNow) banner = `<div class="banner busy"><p><span class="spin" aria-hidden="true"></span> Joining ${q.parts.length} videos with ffmpeg…</p></div>`;
  else if (s.status === 'done') {
    banner = `<div class="banner ok"><p>Done: ${esc(o.width)}x${esc(o.height)}, ${esc(o.fps)}fps, ${esc(o.duration)}s, ${esc(transitionLabel(o.transition))}, render ${esc(o.renderSeconds)}s.</p>
      <a class="btn p" href="${base}/${encodeURIComponent(film)}" download="${esc(film)}">Download MP4${o.version ? ` (v${esc(o.version)})` : ''}</a>
      ${o.captions ? `<a class="btn" href="${base}/captions.srt" download="${esc(q.id)}.srt">Download captions</a>` : ''}${renderBtn('Render again')}</div>${qaHtml(o.qa, base)}`;
  } else if (s.status === 'error') banner = `<div class="banner bad"><p>Error: ${esc(s.error || 'unknown')}</p>${renderBtn('Render again')}</div>`;
  else if (notReady.length) banner = `<div class="banner warn"><p>Draft: ${notReady.length} of ${new Set(q.parts).size} parts are not rendered yet. Preview and render open up once every part is done.</p>${previewBtn('Quick preview')}${renderBtn('Render sequence', true)}</div>`;
  else banner = `<div class="banner human"><p>Not rendered yet. Check the joins with a quick preview, then render: rendering joins the parts' finished MP4 files with ffmpeg.</p>${previewBtn('Quick preview')}${renderBtn('Render sequence', true)}</div>`;
  const { w, h } = frameSize({ template: S.state.templates.find((t) => t.formats.includes(q.format)), brief: { format: q.format } });
  const player = (file, caption) => `<div class="stagebox seqvideo${w > h ? ' wide' : ''}" style="aspect-ratio:${w}/${h}"><video controls playsinline preload="metadata" src="${base}/${file}?v=${stamp}"></video></div>${caption ? `<p class="muted mono" style="margin:4px 0 12px">${caption}</p>` : ''}`;
  const busyAny = busyNow || previewing;
  let video = '';
  if (s.status === 'done' && !busyAny) video = player(encodeURIComponent(film), '');
  else if (!busyAny && pv?.file) video = player('preview.mp4', `Quick preview: ${esc(pv.width)}x${esc(pv.height)}, ${esc(pv.duration)}s, made in ${esc(pv.renderSeconds)}s. The render keeps these joins at full size. ${previewBtn('Preview again')}`);
  else if (!busyAny && pv?.error) video = `<p class="err" style="margin:0 0 12px">Preview failed: ${esc(pv.error)}</p>`;
  const joins = joinsOf(q.parts, q.transition, q.transitions);
  const stale = seqStale(it);
  const staleBanner = stale && !busyAny ? `<div class="banner warn" role="status"><p><b>Out of date — render again.</b> ${esc(stale.reason)}</p></div>` : '';
  $('#detail').innerHTML = `<div class="head"><h2>${esc(q.title || q.id)}</h2>
      <span class="pill">${esc(q.id)}</span><span class="pill">${esc(q.format)}</span>
      <span class="pill">${esc(joinsLabel(q.parts, q.transition, q.transitions))}</span><span class="pill">${b.estimate ? 'about ' : ''}${esc(mmss(b.total))}${b.target ? ` / ${esc(mmss(b.target))} target` : ''}</span>${q.musicBed ? '<span class="pill">one music track</span>' : ''}
      <span class="pill">${esc(previewing ? 'previewing' : busyNow ? 'rendering' : SEQ_STATUS[s.status] || s.status)}</span>
      <span class="hbtns"><button class="btn sm" id="sq-edit" ${busyAny ? 'disabled title="Wait until the render finishes"' : ''}>Edit sequence</button>
      <button class="btn sm" id="sq-del" ${busyAny ? 'disabled' : ''}>Delete…</button></span></div>
    ${staleBanner}${banner}<div class="err" role="alert" id="sq-err"></div>
    ${notReady.length && !busyAny ? `<p class="warn-t" style="margin:0 0 12px">Not ready: ${esc(notReady.join(', '))}. Render them in the Jobs list, or remove them, before the sequence can render.</p>` : ''}
    ${video}<h3>Length</h3>${budgetHtml(b)}
    <h3>Parts, in play order</h3><ol class="seqparts">${b.parts.map((p, i) => (i ? joinRow(i - 1, joins[i - 1]) : '') + partRow(p, i)).join('')}</ol>`;
  $('#sq-edit').addEventListener('click', () => openSeqForm({ ...q, edit: true }));
  $$('.sq-preview').forEach((b) => b.addEventListener('click', () => guarded(seqKey(q.id), b, async () => {
    await api(`${seqPath(q.id)}/preview`, { method: 'POST', body: {} });
    toast('Started a quick preview');
    await refreshSequences();
  }, $('#sq-err'))));
  $('#sq-del').addEventListener('click', (e) => {
    if (INFLIGHT.has(seqKey(q.id)) || !window.confirm(`Delete sequence ${q.id}? Its file and video move to trash/.`)) return;
    guarded(seqKey(q.id), e.currentTarget, async () => {
      const r = await api(seqPath(q.id), { method: 'DELETE' });
      S.seqSel = null;
      $('#detail').innerHTML = NO_SELECTION;
      toast(`Deleted ${q.id}. Its files are in trash/${r.trash}.`);
      await refreshSequences();
    }, $('#sq-err'));
  });
  $('#sq-render')?.addEventListener('click', (e) => guarded(seqKey(q.id), e.currentTarget, async () => {
    await api(`${seqPath(q.id)}/render`, { method: 'POST', body: {} });
    toast('Started sequence render');
    await refreshSequences();
  }, $('#sq-err')));
  applyLocks();
}

function openSeqForm(pre) {
  if (!leaveDetail()) return;
  S.seqForm = { ...pre, dirty: false };
  renderSeqForm(pre);
}

function renderSeqForm(pre) {
  const meta = S.seqMeta;
  const formats = [...new Set(S.state.templates.flatMap((t) => t.formats))];
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  // Any job in the format can be a part; one that is not rendered yet makes the sequence a draft.
  const usableOf = (f) => S.jobs.filter((j) => j.brief.format === f);
  const doneOf = (f) => S.jobs.filter((j) => partReady(j.brief.id, f));
  const startFormat = pre.format || formats.find((f) => usableOf(f).length >= meta.minParts) || formats[0];
  const [tMin, tMax] = meta.targetRange;
  let parts = [...(pre.parts || [])];
  // One transition per join; the top select fills the joins that have none and can reset them all.
  let transitions = [...(pre.transitions || [])];
  $('#detail').innerHTML = `<div class="head"><h2>${pre.edit ? 'Edit sequence' : 'New sequence'}</h2><span class="pill">${esc(S.project)}</span></div>
  <form class="stack" id="sf" novalidate>
    <div class="banner human"><p>A sequence plays videos one after another as one MP4. Any job in the sequence's format can be a part, rendered or not: set the order, transitions and music now, and render the sequence once every part is done. ${meta.minParts}-${meta.maxParts} parts; the same video may appear twice.</p></div>
    <div class="grid2">
      <div class="f"><label for="sf-title">Title (optional)</label><input id="sf-title" maxlength="80" value="${esc(pre.title || '')}" placeholder="Spring launch, full cut"></div>
      <div class="f"><label for="sf-id">Sequence id</label>${pre.edit
        ? `<input id="sf-id" value="${esc(pre.id)}" readonly><span class="muted hint">The id is the file name and cannot change.</span>`
        : '<input id="sf-id" maxlength="64" placeholder="auto from title + format"><span class="muted hint">Cannot be the id of a job in this project.</span>'}</div>
      <div class="f"><label for="sf-fmt">Format</label><select id="sf-fmt">${formats.map((f) => opt(f, `${formatLabel(f, true)} · ${usableOf(f).length} jobs, ${doneOf(f).length} rendered`, f === startFormat)).join('')}</select></div>
      <div class="f"><label for="sf-target">Target length in seconds (optional)</label><input id="sf-target" type="number" min="${tMin}" max="${tMax}" step="1" value="${esc(pre.targetDuration ?? '')}" placeholder="200 for 3:20" aria-describedby="sf-targethint">
        <span class="muted hint" id="sf-targethint">${tMin}-${tMax} s. The sequence page shows every part's length against it.</span></div>
      <div class="f"><label for="sf-tr">Transition for all joins</label><select id="sf-tr">${meta.transitions.map((t) => opt(t.id, transitionLabel(t.id), t.id === (pre.transition || 'cut'))).join('')}</select><span class="muted hint">Sets every join below; each join can then take its own. Neighbours overlap by the transition's length.</span></div>
    </div>
    <div class="f"><span class="flabel" id="sf-xl">Transition demo</span><div class="tprev xprev" id="sf-xprev" role="group" aria-labelledby="sf-xl"></div><span class="muted hint">Two sample scenes in this brand's colours, joined with the transition above. Built once per project with ffmpeg.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="sf-bed" ${(pre.edit ? pre.musicBed : pre.musicBed !== false) ? 'checked' : ''} aria-describedby="sf-bedhint"> One music track for the whole film</label>
      <span class="muted hint" id="sf-bedhint">Plays the brand music once under every part instead of restarting it in each video. Each part keeps its own voice.</span></div>
    <div class="f"><label for="sf-add">Add a part</label><div class="row"><select id="sf-add" style="flex:1 1 220px"></select><button class="btn" type="button" id="sf-addbtn">+ Add part</button></div>
      <span class="muted hint" id="sf-addhint"></span></div>
    <div class="f"><span class="flabel" id="sf-pl">Parts, in play order</span><ol class="seqparts" id="sf-parts" aria-labelledby="sf-pl"></ol></div>
    <div id="sf-budget"></div>
    <div class="row"><button class="btn p" type="submit" id="sf-save">${pre.edit ? 'Save changes' : 'Save sequence'}</button><button class="btn" type="button" id="sf-cancel">Cancel</button><span class="muted mono" id="sf-path"></span></div>
    <p class="muted mono">Saving writes a file to sequences/. Rendering joins the parts with ffmpeg; no model is called.</p>
    <div class="err" role="alert" id="sf-err"></div>
  </form>`;
  const fmt = () => $('#sf-fmt').value;
  const syncId = () => {
    let id = pre.edit ? pre.id : $('#sf-id').value.trim();
    if (!id) {
      const base = `${slug($('#sf-title').value) || 'sequence'}-${fmt().replace(':', 'x')}`;
      const taken = new Set([...S.jobs.map((j) => j.brief.id), ...S.seqs.map((x) => x.sequence.id)]);
      id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    }
    $('#sf-path').textContent = `→ sequences/${S.project}/${id}.json`;
    return id;
  };
  const draw = () => {
    const f = fmt(), usable = usableOf(f), full = parts.length >= meta.maxParts, picked = $('#sf-add').value;
    const nDone = doneOf(f).length;
    $('#sf-add').innerHTML = usable.map((j) => opt(j.brief.id, `${j.brief.id} · ${tplName(j.brief)} · ${partReady(j.brief.id, f) ? `${j.status.outputs.duration}s` : `not rendered (${statusText(j.status)})`}`, j.brief.id === picked)).join('');
    $('#sf-add').disabled = $('#sf-addbtn').disabled = !usable.length || full;
    $('#sf-addhint').textContent = !usable.length ? `No ${f} jobs in ${S.project} yet. Write a brief in this format first.`
      : full ? `A sequence takes at most ${meta.maxParts} parts.` : `${usable.length} ${f} job${usable.length === 1 ? '' : 's'} to choose from, ${nDone} rendered.`;
    const dflt = $('#sf-tr').value;
    transitions = parts.slice(1).map((_, i) => transitions[i] || dflt);
    const target = Number($('#sf-target').value);
    const b = budgetOf(parts, dflt, transitions, f, Number.isInteger(target) && target > 0 ? target : null);
    $('#sf-parts').innerHTML = parts.length ? b.parts.map((p, i) => (i ? joinRow(i - 1, transitions[i - 1], true) : '') + partRow(p, i, `<span class="sbtns">
        <button class="btn sm" type="button" data-pmove="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.id)} up">↑</button>
        <button class="btn sm" type="button" data-pmove="${i}:1" ${i === parts.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.id)} down">↓</button>
        <button class="btn sm" type="button" data-pdel="${i}" aria-label="Remove ${esc(p.id)}">Remove</button></span>`)).join('')
      : `<li class="muted">No parts yet. Add at least ${meta.minParts}.</li>`;
    $('#sf-budget').innerHTML = parts.length ? `<p class="muted mono" style="margin:0 0 4px">${parts.length} part${parts.length === 1 ? '' : 's'}${b.notReady.length ? `, ${b.notReady.length} not rendered yet: a draft until they are` : ''}</p>${budgetHtml(b)}` : '';
    syncId();
  };
  draw();
  const changed = () => { S.seqForm.dirty = true; };
  $('#sf').addEventListener('input', changed);
  $('#sf-fmt').addEventListener('change', () => {
    const before = parts.length;
    parts = parts.filter((p) => jobById(p)?.brief.format === fmt());
    if (parts.length < before) toast(`Removed ${before - parts.length} part(s) that are not ${fmt()}.`);
    draw();
  });
  $('#sf-target').addEventListener('input', draw);
  $('#sf-tr').addEventListener('change', () => { transitions = transitions.map(() => $('#sf-tr').value); draw(); loadTransitionPreview($('#sf-xprev'), $('#sf-tr').value); });
  loadTransitionPreview($('#sf-xprev'), $('#sf-tr').value);
  $('#sf-parts').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-join]');
    if (!sel) return;
    transitions[Number(sel.dataset.join)] = sel.value;
    changed(); draw();
    loadTransitionPreview($('#sf-xprev'), sel.value);
  });
  $('#sf-parts').addEventListener('focusin', (e) => {
    const sel = e.target.closest('select[data-join]');
    if (sel && $('#sf-xprev').dataset.key !== `${S.project}/${sel.value}`) loadTransitionPreview($('#sf-xprev'), sel.value);
  });
  ['sf-title', 'sf-id'].forEach((x) => $(`#${x}`).addEventListener('input', syncId));
  $('#sf-addbtn').addEventListener('click', () => {
    const v = $('#sf-add').value;
    if (!v || parts.length >= meta.maxParts) return;
    parts.push(v); changed(); draw();
  });
  $('#sf-parts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pmove],button[data-pdel]');
    if (!b) return;
    if (b.dataset.pdel) {
      const i = Number(b.dataset.pdel);
      parts.splice(i, 1);
      // The join that led into the removed part goes with it (the first part takes its following join along).
      transitions.splice(Math.max(0, i - 1), 1);
    } else {
      const [i, d] = b.dataset.pmove.split(':').map(Number);
      if (i + d < 0 || i + d >= parts.length) return;
      [parts[i], parts[i + d]] = [parts[i + d], parts[i]];
    }
    changed(); draw();
  });
  $('#sf-cancel').addEventListener('click', () => {
    S.seqForm = null;
    if (pre.edit) selectSequence(pre.id);
    else $('#detail').innerHTML = NO_SELECTION;
  });
  $('#sf').addEventListener('submit', (e) => {
    e.preventDefault();
    guarded('form:seq', $('#sf-save'), async () => {
      const body = { id: syncId(), project: S.project, title: $('#sf-title').value.trim(), format: fmt(), transition: $('#sf-tr').value, transitions, parts, musicBed: $('#sf-bed').checked,
        targetDuration: $('#sf-target').value.trim() ? Number($('#sf-target').value) : null };
      if (pre.edit) {
        const r = await api(seqPath(pre.id), { method: 'PUT', body });
        toast(!r.changed.length ? 'Nothing changed.' : `Saved ${pre.id}.${r.changed.some((k) => !['title', 'targetDuration'].includes(k)) ? ' Render it again to update the video.' : ''}`);
      } else {
        await api('/sequences', { method: 'POST', body });
        toast(parts.every((p) => partReady(p, body.format)) ? `Saved sequence ${body.id}. Click Render sequence to make the MP4.` : `Saved draft sequence ${body.id}. Render it once every part is done.`);
      }
      S.seqForm = null;
      await refreshSequences();
      selectSequence(body.id);
    }, $('#sf-err'));
  });
}

/* ---------------- templates / help ---------------- */
function renderTemplates() {
  const all = S.state.templates;
  const nameOf = (id) => all.find((t) => t.id === id)?.label || id;
  const pacing = (t) => t.sequence.map((s) => `${s.kind.join('|')}×${s.min === s.max ? s.min : `${s.min}-${s.max}`}`).join(' → ');
  $('#tab-tpl').innerHTML = `<h2>Templates</h2>
    <p class="muted" style="margin-top:0;max-width:80ch">Every template is built in. Pick one when you write a brief, and tick others marked mixable to add their scenes; the director writes the script within its rules, and the Script tab lets you add, reorder and edit its scenes.</p>
    <div class="cards tcards">${all.map((t) => `<div class="card">
      <div class="tprev" data-tprev="${esc(t.id)}" title="Hover to play a sample in this project's brand"><span class="tprev-msg">Preview</span></div>
      <div class="t">${esc(t.label)} <span class="pill">${esc(t.id)}</span></div>
      ${t.extends ? `<div class="mono" style="color:var(--accent)">uses the ${esc(nameOf(t.extends))} renderer</div>` : ''}
      <div class="muted">${esc(t.description)}</div>
      <div class="mono">format: ${esc(t.formats.join(', '))} · ${t.durations[0]}-${t.durations[1]}s</div>
      <div class="mono">pacing: ${esc(pacing(t))}</div>
      ${t.mixable?.length ? `<div class="mono">mixable: adds ${esc(t.mixable.join(', '))}</div>` : ''}
      <div class="row" style="margin-top:auto"><button class="btn sm" type="button" data-usetpl="${esc(t.id)}">Use this template</button></div>
    </div>`).join('')}</div>`;
  $('#tab-tpl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-usetpl]');
    if (!b || !confirmDiscard()) return;
    S.paneDirty = false;
    showTab('jobs'); setListMode('jobs');
    const t = all.find((x) => x.id === b.dataset.usetpl);
    openBriefForm({ template: t.id, duration: Math.max(t.durations[0], Math.min(20, t.durations[1])) });
  });
  const io = new IntersectionObserver((seen) => {
    for (const e of seen) if (e.isIntersecting && e.target.dataset.project !== S.project) loadTemplatePreview(e.target);
  }, { rootMargin: '200px' });
  $$('[data-tprev]').forEach((box) => {
    io.observe(box);
    const card = box.closest('.card');
    card.addEventListener('mouseenter', () => box.player?.play());
    card.addEventListener('mouseleave', () => box.player?.stop());
    box.addEventListener('click', () => box.player?.toggle()); // touch screens have no hover
  });
}

// Review link: the server builds one template preview at a time and answers 429 meanwhile,
// so previews load one after another here and a 429 is asked again after a short wait.
const PREVIEW_RETRY_MS = 1500;
const PREVIEW_TRIES = 10;
let previewQueue = Promise.resolve();
function fetchPreview(path) {
  if (!REVIEW) return api(path);
  const run = previewQueue.then(async () => {
    for (let n = 1; ; n += 1) {
      try { return await api(path); } catch (e) {
        if (e.status !== 429 || n >= PREVIEW_TRIES) throw e;
        await new Promise((ok) => { setTimeout(ok, PREVIEW_RETRY_MS); });
      }
    }
  });
  previewQueue = run.catch(() => {});
  return run;
}

// A template card's preview: the template's sample scenes in this project's brand, played through seek(t).
async function loadTemplatePreview(box) {
  box.player?.stop();
  box.ro?.disconnect();
  box.ro = null;
  box.dataset.project = S.project;
  box.player = null;
  box.innerHTML = `<span class="tprev-msg"><span class="spin" aria-hidden="true"></span> ${REVIEW ? 'Loading preview…' : 'Building preview…'}</span>`;
  let p;
  try { p = await fetchPreview(`/templates/${encodeURIComponent(box.dataset.tprev)}/preview?project=${encodeURIComponent(S.project)}`); } catch (err) {
    box.innerHTML = `<span class="tprev-msg">${esc(err.message)}</span>`;
    return;
  }
  if (box.dataset.project !== S.project) return;
  box.innerHTML = `<iframe title="${esc(box.dataset.tprev)} preview" tabindex="-1" src="${esc(p.url)}?v=${Date.now()}" style="width:${p.width}px;height:${p.height}px"></iframe>
    <span class="tprev-tag">${esc(p.format)} · ${Math.round(p.duration)}s · hover to play</span>`;
  const frame = $('iframe', box);
  const fit = () => {
    const k = Math.min(box.clientWidth / p.width, box.clientHeight / p.height);
    frame.style.transform = `translate(${(box.clientWidth - p.width * k) / 2}px, ${(box.clientHeight - p.height * k) / 2}px) scale(${k})`;
  };
  fit();
  box.ro = new ResizeObserver(fit);
  box.ro.observe(box);
  let t = p.poster, playing = false, prev = 0;
  const seek = (x) => { const w = frame.contentWindow; if (w?.__ready) w.seek(x); };
  frame.addEventListener('load', () => waitReady(frame, () => seek(t)));
  const loop = (now) => {
    if (!playing) return;
    t = (t + Math.min(0.1, (now - prev) / 1000)) % p.duration;
    prev = now;
    seek(t);
    requestAnimationFrame(loop);
  };
  box.player = {
    play() { if (playing || !frame.contentWindow?.__ready) return; playing = true; prev = performance.now(); box.classList.add('playing'); requestAnimationFrame(loop); },
    stop() { playing = false; box.classList.remove('playing'); },
    toggle() { if (playing) this.stop(); else this.play(); },
  };
}

// The demo clip of a sequence transition, looping muted; the latest request wins when the select changes quickly.
async function loadTransitionPreview(box, id) {
  if (!box) return;
  const key = `${S.project}/${id}`;
  box.dataset.key = key;
  box.innerHTML = '<span class="tprev-msg"><span class="spin" aria-hidden="true"></span> Building demo…</span>';
  let p;
  try { p = await api(`/sequences/transitions/${encodeURIComponent(id)}/preview?project=${encodeURIComponent(S.project)}`); } catch (err) {
    if (box.dataset.key === key) box.innerHTML = `<span class="tprev-msg">${esc(err.message)}</span>`;
    return;
  }
  if (box.dataset.key !== key) return;
  box.innerHTML = `<video autoplay muted loop playsinline src="${esc(p.url)}?v=${Date.now()}"></video><span class="tprev-tag">${esc(p.label)} · ${esc(p.duration)}s</span>`;
}

// The brand changed: previews already built show the old one, so they rebuild when next seen.
function resetTemplatePreviews() {
  $$('[data-tprev]').forEach((box) => {
    box.player?.stop();
    if (!box.dataset.project) return;
    delete box.dataset.project;
    if (box.offsetParent) loadTemplatePreview(box);
  });
}

function renderHelp() {
  $('#tab-help').innerHTML = `<div class="help"><h2>How a video gets made</h2><ol>
    <li><b>Brief</b> (human): click New brief above the job list, or Duplicate brief or Edit brief on a job. It only writes a file. Editing a brief after the Director ran sends the job back to the Director; a new template or mix gets a new script, and the old one is kept as <code>script.prev.json</code>.</li>
    <li><b>Director picks job</b>: click <b>Run Director</b> (one job, or the queued jobs of this project). The Director select next to it says who writes the script: Claude Code on your seat (headless, on this computer's logged-in seat), or the API provider you picked, with your own key from <code>.env</code> or the environment and the model ids you type. Either way the Director has a fixed tool list that cannot render or approve. A provider without a key shows "(no key)", and while its key or model is missing, runs use the seat. You can also open Claude Code in the Motion Studio folder and type <code>/studio run</code>. Up to 5 jobs per run. If Claude or the provider reports a usage or spend limit, runs pause until it resets.</li>
    <li><b>Source</b> (director): reads the reference page, or the facts written in the brief, and writes <code>source.json</code>; every claim has a ref.</li>
    <li><b>Script</b> (director): writes <code>script.json</code> following the template's pacing frame.</li>
    <li><b>Timing</b> (tool): estimated from word count. With TTS, timing comes from the real voice-over. Footage clips (Talking head) last exactly their trimmed length.</li>
    <li><b>Compose scenes</b> (tool): the template generates <code>index.html</code> with a GSAP timeline and a <code>seek(t)</code> function.</li>
    <li><b>Lint + stills</b> (tool): Chrome captures one frame per scene and checks the safe area and text overflow.</li>
    <li><b>Review</b> (human): check the preview, edit in the Script or Source tab if needed, then approve.</li>
    <li><b>Render</b> (tool): Chrome captures every frame, ffmpeg encodes H.264.</li>
    <li><b>Audio + export</b> (tool): mixes voice, footage sound and music if present, normalises to -14 LUFS, exports <code>final.mp4</code> + captions.</li>
    <li><b>Done</b>: download the MP4 from the Jobs tab.</li></ol>
    <p><b>Sequences</b>: to play several finished videos as one MP4 (say a logo reveal, a product demo and a testimonial), switch the list to <b>Sequences</b>, click New sequence, pick the parts in order, choose a transition (cut, crossfade, dips, wipes, slides, zoom punch, whip pan, spin, film dissolve and more) and render it. Any job in the same format can be a part: set up the film early as a draft, give it a target length to see every part against it, and render once every part is done.</p>
    <h2>Editing mid-way</h2><p>Editing Source locks that field and needs the Director to re-run from step 4. Editing Script locks that field and you click "Rebuild storyboard" yourself. The Director never overwrites a locked field.</p>
    <h2>Reviewing</h2><p>The Composition preview plays the voice-over in sync, so you can hear the storyboard before you approve. Background music is mixed in at render.</p>
    <h2>Cleaning up</h2><p><b>Delete…</b> on a job moves its brief and output to <code>trash/</code>. A job that a sequence plays must leave the sequence first. Deleting a project (Brand tab) moves the whole project to <code>trash/</code>.</p></div>`;
}

/* ---------------- transcripts ---------------- */
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
async function openTranscript(project, asset) {
  const doc = await api(`/projects/${encodeURIComponent(project)}/transcripts/${encodeURIComponent(asset)}`);
  const plain = doc.segments.map((sg) => `[${clock(sg.start)}–${clock(sg.end)}] ${sg.text}`).join('\n');
  const dlg = $('#dlg');
  dlg.setAttribute('aria-label', `Transcript of ${asset}`);
  dlg.innerHTML = `<div class="stack" style="max-width:none">
    <h2 style="margin:0">Transcript · ${esc(asset)}</h2>
    <p class="muted small" style="margin:0">${esc(doc.model)} · language ${esc(doc.lang)} · ${doc.duration}s of media · made ${esc(doc.madeAt.slice(0, 16).replace('T', ' '))}${doc.stale ? ' · the file changed since: transcribe it again' : ''}.
      Speech recognition can mishear names and numbers; check them against the source. The Director reads this to pick clips and copy what is said.</p>
    <div class="tlist">${doc.segments.map((sg) => `<div><span class="mono muted">${clock(sg.start)}–${clock(sg.end)}</span> ${esc(sg.text)}</div>`).join('') || '<span class="muted">No speech found.</span>'}</div>
    <div class="row"><button class="btn" type="button" id="tr-copy">Copy with times</button><button class="btn p" type="button" id="tr-close">Close</button></div></div>`;
  $('#tr-copy').addEventListener('click', () => copyText(plain));
  $('#tr-close').addEventListener('click', () => dlg.close());
  dlg.showModal();
}

/* ---------------- footage: shots, transcript search, clips (ffmpeg on this computer) ---------------- */
// Clip playback speeds, inside engine/footage.mjs SPEED (0.25-4).
const CLIP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
const CLIP_PRESETS = [['cover', 'Cover (fill the frame)'], ['band', 'Crop bottom captions'], ['blur-fill', 'Vertical to 16:9 blur-fill'], ['keep', 'Blur background, keep subject']];
const CLIP_SIZES = [['1920x1080', '16:9 · 1920×1080'], ['1080x1920', '9:16 · 1080×1920'], ['1080x1080', '1:1 · 1080×1080']];
const sec = (v) => Math.round(v * 100) / 100;

async function openShots(project, asset, onMade) {
  if (REVIEW) return;
  const base = `/projects/${encodeURIComponent(project)}/footage/${encodeURIComponent(asset)}`;
  const imgUrl = (name, v) => `/api${base}/images/${encodeURIComponent(name)}?v=${encodeURIComponent(v)}`;
  const stem = asset.replace(/\.[^.]+$/, '');
  const dlg = $('#dlg');
  dlg.setAttribute('aria-label', `Shots of ${asset}`);
  dlg.innerHTML = `<div class="stack shots" style="max-width:none">
    <h2 style="margin:0">Shots · ${esc(asset)}</h2>
    <div class="row" id="sh-head"><span class="muted small"><span class="spin" aria-hidden="true"></span> Loading…</span></div>
    <div class="shotstrip" id="sh-strip" role="list" aria-label="Shots: click one to set In"></div>
    <form class="row" id="sh-findf"><div class="f" style="flex:1 1 260px"><label for="sh-q">Find words in the transcript</label>
      <input id="sh-q" type="search" maxlength="200" placeholder="e.g. best newcomer"></div><button class="btn" type="submit" id="sh-find" style="align-self:flex-end">Find</button></form>
    <div class="small muted" id="sh-tnote"></div>
    <div class="tlist" id="sh-hits" hidden></div>
    <div class="grid2">
      <div class="row"><div class="f" style="width:120px"><label for="sh-in">In (s)</label><input id="sh-in" type="number" min="0" step="0.01"></div>
        <div class="f" style="width:120px"><label for="sh-out">Out (s)</label><input id="sh-out" type="number" min="0" step="0.01"></div>
        <span class="muted small mono" id="sh-len" style="align-self:flex-end;padding-bottom:8px"></span></div>
      <div class="f"><label for="sh-preset">Preset</label><select id="sh-preset">${CLIP_PRESETS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
    </div>
    <div class="f" id="sh-bandrow" hidden style="width:220px"><label for="sh-band">Crop off the bottom (%)</label><input id="sh-band" type="number" min="1" max="45" step="1" value="12"></div>
    <div class="row" id="sh-keeprow" hidden>${['cx', 'cy', 'rx', 'ry'].map((k) => `<div class="f" style="width:110px"><label for="sh-${k}">${{ cx: 'Centre X', cy: 'Centre Y', rx: 'Radius X', ry: 'Radius Y' }[k]} (px)</label><input id="sh-${k}" type="number" min="0" step="1"></div>`).join('')}
      <span class="muted small hint" style="align-self:flex-end">Source pixels. Inside the ellipse stays sharp; everything else is blurred.</span></div>
    <label class="chk small" id="sh-barsrow" hidden><input type="checkbox" id="sh-bars" checked> <span id="sh-barstext"></span></label>
    <div class="row"><div class="f" style="width:200px"><label for="sh-size">Output</label><select id="sh-size">${CLIP_SIZES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <div class="f" style="width:120px"><label for="sh-gain">Gain (dB)</label><input id="sh-gain" type="number" min="-24" max="12" step="0.5" value="0"></div>
      <label class="chk" style="align-self:flex-end;padding-bottom:8px"><input type="checkbox" id="sh-mute"> Mute</label></div>
    <div class="row"><div class="f" style="width:160px"><label for="sh-speed">Speed</label><select id="sh-speed">${CLIP_SPEEDS.map((v) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${v === 1 ? 'Normal (1×)' : `${v}×${v < 1 ? ' slower' : ' faster'}`}</option>`).join('')}</select></div>
      <div class="f" id="sh-smoothrow" hidden style="width:300px"><label for="sh-smooth">Slow motion</label><select id="sh-smooth" aria-describedby="sh-smoothhint">
        <option value="blend">Blend frames (quick)</option><option value="motion">Follow the motion (slow to make, up to 20 s)</option><option value="none">Repeat frames</option></select>
        <span class="muted small hint" id="sh-smoothhint">A slower clip needs frames between the real ones. Blend mixes neighbours; Follow the motion draws new ones and can take a few minutes.</span></div></div>
    <div class="row"><div class="f" style="flex:1 1 260px"><label for="sh-name">New file name</label><input id="sh-name" class="mono" maxlength="80" value="${esc(`${stem}-clip.mp4`)}"></div>
      <label class="chk" style="align-self:flex-end;padding-bottom:8px"><input type="checkbox" id="sh-replace"> Replace existing</label></div>
    <img class="shotprev" id="sh-prev" alt="Preview frame at the In point" hidden>
    <div class="row"><button class="btn" type="button" id="sh-pv">Preview frame</button><button class="btn p" type="button" id="sh-make">Make clip</button>
      <span class="muted small" id="sh-state" role="status"></span><span style="flex:1"></span><button class="btn" type="button" id="sh-close">Close</button></div>
    <div class="err" role="alert" id="sh-err"></div></div>`;
  let st = null;
  let poll = 0;
  const shots = () => st?.shots || null;
  const drawLen = () => {
    const a = Number($('#sh-in').value), b = Number($('#sh-out').value), sp = Number($('#sh-speed').value) || 1;
    // At another speed the clip lasts the span over the speed.
    $('#sh-len').textContent = $('#sh-in').value && $('#sh-out').value && b > a ? `${sec(b - a)} s${sp !== 1 ? ` → ${sec((b - a) / sp)} s` : ''}` : '';
    $('#sh-smoothrow').hidden = sp >= 1;
  };
  const setRange = (a, b) => {
    const end = shots()?.duration;
    $('#sh-in').value = sec(Math.max(0, a));
    if (b !== undefined) $('#sh-out').value = sec(end ? Math.min(end, b) : b);
    drawLen();
  };
  const drawPreset = () => {
    const p = $('#sh-preset').value;
    $('#sh-bandrow').hidden = p !== 'band';
    $('#sh-keeprow').hidden = p !== 'keep';
  };
  const draw = () => {
    const d = shots();
    let head;
    if (st.busy) head = '<span class="small"><span class="spin" aria-hidden="true"></span> Finding shots and bars…</span>';
    else if (!d) head = `<span class="muted small">Not analysed yet. Finding shots reads the whole video once (no upload, no model).</span><button class="btn sm" type="button" id="sh-run">Find shots</button>`;
    else {
      const bars = d.bars ? ` · ${d.bars.color} bars` : '';
      head = `<span class="muted small">${d.duration} s · ${d.width}×${d.height}${d.fps ? ` · ${d.fps} fps` : ''} · ${d.hasAudio ? 'sound' : 'no sound'}${bars} · ${d.shots.length} shots${d.truncated ? ' (capped)' : ''}${d.rhythm ? ` · a cut every ${esc(d.rhythm.averageShot)} s on average (${esc(d.rhythm.cutsPerMinute)} a minute)` : ''}${d.stale ? ' · the file changed since' : ''}</span>
        ${d.stale ? '<button class="btn sm" type="button" id="sh-run">Find shots again</button>' : ''}`;
    }
    $('#sh-head').innerHTML = `${head}${st.error ? `<span class="bad-t small">${esc(st.error)}</span>` : ''}`;
    // A list item holds the button: role="listitem" on the button itself would take away its button role.
    $('#sh-strip').innerHTML = d ? d.shots.map((s) => `<div role="listitem"><button class="shot" type="button" data-sin="${s.start}" data-sout="${s.end}" aria-label="Shot ${s.n} at ${clock(s.start)}, set In">
      <img src="${imgUrl(s.thumb, d.stamp)}" alt="" loading="lazy"><span class="mono small">${clock(s.start)}</span></button></div>`).join('') : '';
    const t = st.transcript;
    $('#sh-q').disabled = !t;
    $('#sh-find').disabled = !t;
    $('#sh-tnote').textContent = t ? (t.stale ? 'The transcript is older than the file: transcribe it again for exact times.' : '') : 'No transcript yet: close this and click Transcribe on the file to search what is said.';
    if (d?.bars) $('#sh-barstext').textContent = `Crop away the ${d.bars.color} bars (top ${d.bars.top}, bottom ${d.bars.bottom}, left ${d.bars.left}, right ${d.bars.right} px)`;
    $('#sh-barsrow').hidden = !d?.bars;
    const mute = $('#sh-mute');
    if (d && !d.hasAudio) { mute.checked = true; mute.disabled = true; }
    if (d && $('#sh-cx').value === '') {
      $('#sh-cx').value = Math.round(d.width / 2); $('#sh-cy').value = Math.round(d.height * 0.45);
      $('#sh-rx').value = Math.round(d.width * 0.22); $('#sh-ry').value = Math.round(d.height * 0.4);
    }
    if (d && $('#sh-in').value === '' && d.shots[0]) setRange(d.shots[0].start, d.shots[0].end);
    clearTimeout(poll);
    if (st.busy) {
      poll = setTimeout(async () => {
        if (!dlg.open) return;
        try { st = await api(base); draw(); } catch (err) { $('#sh-err').textContent = err.message; }
      }, 2500);
    }
  };
  const options = () => {
    const n = (id) => ($(id).value === '' ? undefined : Number($(id).value));
    const p = $('#sh-preset').value;
    const [width, height] = $('#sh-size').value.split('x').map(Number);
    const d = shots();
    return {
      in: n('#sh-in'), out: n('#sh-out'), width, height, fill: p === 'blur-fill' ? 'blur-fill' : 'cover',
      ...(p === 'band' ? { band: { bottom: n('#sh-band') } } : {}),
      ...(p === 'keep' ? { keep: { cx: n('#sh-cx'), cy: n('#sh-cy'), rx: n('#sh-rx'), ry: n('#sh-ry') } } : {}),
      ...(d?.bars && $('#sh-bars').checked ? { crop: d.bars.crop } : {}),
      gainDb: n('#sh-gain') ?? 0, mute: $('#sh-mute').checked,
      ...(n('#sh-speed') !== 1 ? { speed: n('#sh-speed') } : {}),
      ...(n('#sh-speed') < 1 ? { smooth: $('#sh-smooth').value } : {}),
    };
  };

  $('#sh-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => clearTimeout(poll), { once: true });
  $('#sh-preset').addEventListener('change', drawPreset);
  $('#sh-in').addEventListener('input', drawLen);
  $('#sh-out').addEventListener('input', drawLen);
  $('#sh-speed').addEventListener('change', drawLen);
  $('#sh-head').addEventListener('click', (e) => {
    if (e.target.id !== 'sh-run') return;
    busy(e.target, async () => {
      await api(`${base}/analyse`, { method: 'POST' });
      st = { ...st, busy: true, error: null };
      draw();
    }, $('#sh-err'));
  });
  $('#sh-strip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sin]');
    if (!b) return;
    const a = Number(b.dataset.sin);
    const out = Number($('#sh-out').value);
    setRange(a, !$('#sh-out').value || out <= a ? Number(b.dataset.sout) : undefined);
    for (const x of $$('#sh-strip .shot')) x.setAttribute('aria-pressed', String(x === b));
  });
  $('#sh-findf').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('#sh-find'), async () => {
      const r = await api(`${base}/find?q=${encodeURIComponent($('#sh-q').value)}`);
      const box = $('#sh-hits');
      box.hidden = false;
      box.innerHTML = r.hits.length ? `${r.hits.map((h) => {
        const [a, b] = h.segment ? [h.segment.start, h.segment.end] : [h.start, h.end];
        return `<button class="hit" type="button" data-hin="${sec(a - 0.2)}" data-hout="${sec(b + 0.2)}" title="Set In and Out around this line"><span class="mono muted">${clock(h.start)}</span> ${esc(h.text)}</button>`;
      }).join('')}${r.total > r.hits.length ? `<span class="muted small">${r.total - r.hits.length} more not shown</span>` : ''}` : '<span class="muted">Not found. Try fewer or other words.</span>';
    }, $('#sh-err'));
  });
  $('#sh-hits').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hin]');
    if (b) setRange(Number(b.dataset.hin), Number(b.dataset.hout));
  });
  $('#sh-pv').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await api(`${base}/preview`, { method: 'POST', body: options() });
    const img = $('#sh-prev');
    img.src = imgUrl(r.image, `${Date.now()}`);
    img.hidden = false;
    $('#sh-state').textContent = `Frame at ${clock(r.at)}, ${r.width}×${r.height}`;
  }, $('#sh-err')));
  $('#sh-make').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    $('#sh-state').textContent = 'Encoding the clip on this computer…';
    try {
      const r = await api(`${base}/clip`, { method: 'POST', body: { ...options(), name: $('#sh-name').value.trim(), replace: $('#sh-replace').checked } });
      $('#sh-state').textContent = `Saved ${r.name} (${Math.round(r.bytes / 1024)} KB)`;
      toast(`Made ${r.name}`);
      onMade(r.name);
    } catch (err) { $('#sh-state').textContent = ''; throw err; }
  }, $('#sh-err')));

  dlg.showModal();
  try { st = await api(base); draw(); } catch (err) { $('#sh-head').innerHTML = ''; $('#sh-err').textContent = err.message; }
}

/* ---------------- brand ---------------- */
async function renderBrand() {
  if (!S.project) return;
  const old = $('#tab-brand');
  const box = old.cloneNode(false);
  old.replaceWith(box);
  const project = S.project, P = encodeURIComponent(project);
  S.brandDirty = false;
  let d, opts;
  box.innerHTML = '<p class="muted"><span class="spin" aria-hidden="true"></span> Loading the brand…</p>';
  try {
    [d, opts] = await Promise.all([api(`/projects/${P}`), S.options ? Promise.resolve(S.options) : api('/options')]);
  } catch (e) {
    if (!box.isConnected) return;
    box.innerHTML = `<div class="banner bad" role="alert"><p>Could not load the brand of ${esc(project)}: ${esc(e.message)}</p><button class="btn" type="button" id="br-retry">Retry</button></div>`;
    $('#br-retry').addEventListener('click', renderBrand);
    return;
  }
  // A project switch while this loaded drew a newer Brand tab already.
  if (!box.isConnected || project !== S.project) return;
  S.options = opts;
  const b = d.brand;
  let assets = d.assets;
  let icons = d.icons;
  let transcripts = d.transcripts || {};
  let gen = d.generate || null;
  // Picked reference pictures: this click's (from the brand's defaults) and the brand's own clipRefs.
  let genRefs = [...(b.clipRefs || [])];
  let clipRefs = [...(b.clipRefs || [])];
  const sttOk = Boolean(d.stt?.available);
  let palette = (b.palette || []).map((p) => ({ ...p }));
  let fontFiles = (b.fonts.files || []).map((x) => ({ ...x }));
  const COLORS = [['primary', 'Primary'], ['primary2', 'Primary 2'], ['secondary', 'Accent'], ['bg', 'Background'], ['ink', 'Text'], ['muted', 'Muted text'], ['onPrimary', 'Text on primary']];
  const isImage = (a) => assetKind(a) === 'image';
  const isAudio = (a) => assetKind(a) === 'audio';
  const isVideo = (a) => assetKind(a) === 'video';
  const isFont = (a) => assetKind(a) === 'font';
  const GLYPH = { audio: '♪', video: '▶', font: 'Aa', model: '3D', animation: '✦', other: '·' };
  const assetUrl = (a) => `/assets/${P}/${encodeURIComponent(a)}`;
  // A timer or an await of this tab can end after a project switch drew a new Brand tab with the same element ids:
  // `$('#br-…')` would then find the new tab and fill it with this project's assets (dropping its logo and music).
  const alive = () => box.isConnected && project === S.project;
  // Built-in tracks, voices and cut sounds come from /options; fetched again after the assets change.
  const refreshOptions = () => api('/options').then((o) => { S.options = opts = o; if (alive()) drawAssets(); }).catch(() => {});
  const imgOptions = (sel) => `<option value="">(none)</option>${assets.filter(isImage).map((a) => `<option ${sel === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}`;
  // A brand box set by hand in brand.json (color, bg) stays selectable as "Custom box" so a save keeps it.
  const SUB_LOOKS = [['', 'Template default'], ['classic', 'Classic'], ['highlighter', 'Highlighter'], ['minimal', 'Minimal'], ['pill', 'Pill'], ['pop', 'Pop']];
  const subOptions = (s) => {
    const cur = s?.style || (s ? 'custom' : '');
    return [...SUB_LOOKS, ...(s && !s.style ? [['custom', 'Custom box (brand.json)']] : [])]
      .map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('');
  };
  const BACKDROP_NAMES = { mesh: 'Mesh gradient', aurora: 'Aurora', flow: 'Contour lines', shapes: '3D shapes' };
  // The grade select's value: "look:<id>" or "lut:<file.cube>".
  const gradeOptions = (g) => {
    const cur = g?.look ? `look:${g.look}` : g?.lut ? `lut:${g.lut}` : '';
    const luts = assets.filter((a) => /\.cube$/i.test(a));
    return `<option value="">None</option>
      <optgroup label="Built-in looks">${(opts.grades || []).map((x) => `<option value="look:${esc(x.id)}"${cur === `look:${x.id}` ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>
      <optgroup label="Your LUTs (.cube)">${luts.map((a) => `<option value="lut:${esc(a)}"${cur === `lut:${a}` ? ' selected' : ''}>${esc(a)}</option>`).join('') || '<option disabled>No .cube uploaded</option>'}</optgroup>`;
  };
  const gradeValue = (v, pct) => {
    if (!v) return undefined;
    const [kind, name] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    const amount = pct < 100 ? pct / 100 : undefined;
    return kind === 'lut' ? { lut: name, amount } : { look: name, amount };
  };
  const bn = opts.banner;
  const subValue = (s, style, font) => style === 'custom' ? s : style ? { ...(s?.style ? s : {}), style, font } : undefined;
  const musicOptions = (sel) => `<option value="">(none)</option>
    <optgroup label="Built-in tracks">${opts.music.map((m) => `<option value="${esc(m.id)}" ${sel === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</optgroup>
    <optgroup label="Project files">${assets.filter(isAudio).map((a) => `<option ${sel === a ? 'selected' : ''}>${esc(a)}</option>`).join('') || '<option disabled>No audio uploaded</option>'}</optgroup>`;
  const engines = opts.voices;
  const engineOf = (id) => engines.find((e) => e.id === id) || engines[0];
  const voiceOptions = (engineId, sel) => {
    const e = engineOf(engineId);
    if (!e.voices.length) return '<option value="">(no voices)</option>';
    return e.voices.map((v) => `<option value="${esc(v.id)}" ${sel === v.id ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  };
  const tts = String(b.voice?.tts || 'kokoro').toLowerCase() === 'windows' ? 'sapi' : String(b.voice?.tts || 'kokoro').toLowerCase();
  // Advanced motion fields the brand sets; the section stays closed and says how many.
  const fxOn = [b.film === false, b.shine, b.carry, b.leaks, b.confetti, b.reveal, b.ease, b.backdrop, b.wipe, b.blend].filter(Boolean).length;

  box.innerHTML = `<h2>Brand · ${esc(project)}</h2><form class="stack" id="brf" novalidate style="max-width:860px">
    <h3>Identity</h3>
    <div class="grid2"><div class="f"><label for="br-name">Name</label><input id="br-name" value="${esc(b.name)}"></div>
      <div class="f"><label for="br-logotext">Logo text (used when there is no logo file)</label><input id="br-logotext" maxlength="40" value="${esc(b.logoText)}"></div></div>
    <div class="grid2"><div class="f"><label for="br-logo">Logo file (light backgrounds)</label><select id="br-logo">${imgOptions(b.logo)}</select>
        <div class="logoprev light" id="lp-light"></div></div>
      <div class="f"><label for="br-logodark">Logo file on dark backgrounds (optional)</label><select id="br-logodark">${imgOptions(b.logoDark)}</select>
        <div class="logoprev dark" id="lp-dark"></div></div></div>
    <p class="muted mono" style="margin:0">Upload logo files (.svg, .png, .jpg, .webp) under Assets below, then pick them here.</p>
    <div class="f"><label class="chk"><input type="checkbox" id="br-logobug" ${b.logoBug ? 'checked' : ''} aria-describedby="br-logobughint"> Corner logo on every scene</label>
      <span class="muted hint" id="br-logobughint">Keeps the logo file fixed top-left in every scene, the dark-background logo on dark scenes; scenes then leave out their own logo. Needs a logo file. Applies when the storyboard is rebuilt.</span></div>

    <h3>Colors</h3>
    <div class="grid2">${COLORS.map(([k, l]) => `<div class="swatch"><input type="color" id="brc-${k}" value="${esc(b.colors[k])}" aria-label="${l}"><input class="hex mono" data-hexfor="brc-${k}" value="${esc(b.colors[k])}" maxlength="7" aria-label="${l} hex"><span>${l}</span></div>`).join('')}</div>
    <div class="f"><span class="flabel" id="br-pall">Custom colors <span class="muted">(templates get them as CSS variables: --c-name)</span></span><div id="br-palette" class="palette" role="group" aria-labelledby="br-pall"></div>
      <button class="btn" type="button" id="br-addcolor">+ Add color</button></div>

    <h3>Type</h3>
    <div class="grid2"><div class="f"><label for="br-fd">Display font</label><input id="br-fd" value="${esc(b.fonts.display)}"></div>
      <div class="f"><label for="br-fb">Body font</label><input id="br-fb" value="${esc(b.fonts.body)}"></div></div>
    <div class="f"><label for="br-gf">Google Fonts query</label><input id="br-gf" class="mono" value="${esc(b.fonts.googleFonts)}"></div>
    <div class="f"><span class="flabel" id="br-ffl">Font files (licensed fonts uploaded under Assets)</span>
      <div id="br-fonts" class="fontfiles" role="group" aria-labelledby="br-ffl" aria-describedby="br-ffhint"></div>
      <div class="row"><button class="btn" type="button" id="br-addfont">+ Add font file</button></div>
      <span class="muted hint" id="br-ffhint">Loaded in every video instead of Google Fonts. Give the file the family name you typed as Display or Body font, and one row per weight and style. Applies when the storyboard is rebuilt.</span></div>
    <div class="f" style="max-width:360px"><label for="br-motion">Motion style</label><select id="br-motion" aria-describedby="br-motionhint">
      ${MOTION_OPTIONS.map((o) => `<option value="${o.id}"${motionOpt(b.motion) === o ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <span class="muted hint" id="br-motionhint"></span></div>
    <details class="more" id="br-fx"><summary>Advanced motion <span class="muted">· ${fxOn ? `${fxOn} set` : 'all off'}: grain, shine, light leaks, confetti, reveal, curve, backdrop, wipe, blend</span></summary>
    <p class="muted small" style="margin:0 0 8px">Leave these off and each video's Look (Script tab) picks a matching set. What you set here wins over the Look.</p>
    <div class="f" id="br-filmrow"><label class="chk"><input type="checkbox" id="br-film" ${b.film === false ? '' : 'checked'} aria-describedby="br-filmhint"> Film grain and vignette</label>
      <span class="muted hint" id="br-filmhint">A fine moving grain and slightly darker corners over every scene. Off keeps the frame clean and the rest of the cinematic motion. Applies when the storyboard is rebuilt.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-shine" ${b.shine ? 'checked' : ''} aria-describedby="br-shinehint"> Shine on buttons</label>
      <span class="muted hint" id="br-shinehint">A soft light band sweeps across the call-to-action button once it is in, and again near the end of a long scene. Applies when the storyboard is rebuilt.</span></div>
    <div class="f" id="br-carryrow"><label class="chk"><input type="checkbox" id="br-carry" ${b.carry ? 'checked' : ''} aria-describedby="br-carryhint"> Accent bar carries every cut</label>
      <span class="muted hint" id="br-carryhint">A short bar in the accent colour sits under each scene's kicker or heading and glides to the next one at every cut, so the film reads as one piece. Applies when the storyboard is rebuilt.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-leaks" ${b.leaks ? 'checked' : ''} aria-describedby="br-leakshint"> Light leaks at cuts</label>
      <span class="muted hint" id="br-leakshint">A warm glow, with a touch of the accent colour, flares across the frame at every scene change and fades. Applies when the storyboard is rebuilt.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-confetti" ${b.confetti ? 'checked' : ''} aria-describedby="br-confettihint"> Confetti on the call to action</label>
      <span class="muted hint" id="br-confettihint">A short burst of pieces in the brand colours flies from the call-to-action button as it lands. Applies when the storyboard is rebuilt.</span></div>
    <div class="f" id="br-revealrow" style="max-width:360px"><label for="br-reveal">Heading reveal</label><select id="br-reveal" aria-describedby="br-revealhint">
      ${[['', 'Whole heading'], ['chars', 'Letter by letter'], ['lines', 'Line by line, out of a mask']].map(([v, l]) => `<option value="${v}"${(b.reveal || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted hint" id="br-revealhint">How headings come in. Cinematic and Editorial reveal headings word by word on their own. Applies when the storyboard is rebuilt.</span></div>
    <div class="f" style="max-width:360px"><label for="br-ease">Movement curve</label><select id="br-ease" aria-describedby="br-easehint">
      ${[['', "The motion style's own"], ['snappy', 'Snappy: fast start, quiet stop'], ['soft', 'Soft: eases in and out'], ['spring', 'Spring: overshoots a little, then settles']].map(([v, l]) => `<option value="${v}"${(b.ease || '') === v ? ' selected' : ''}>${l}</option>`).join('')}${b.ease && !['snappy', 'soft', 'spring'].includes(b.ease) ? `<option value="${esc(b.ease)}" selected>Custom curve (from brand.json)</option>` : ''}</select>
      <span class="muted hint" id="br-easehint">The curve every move without its own curve follows, so the brand moves the same way in every video. Applies when the storyboard is rebuilt.</span></div>
    <div class="grid2"><div class="f"><label for="br-backdrop">Backdrop (WebGL)</label><select id="br-backdrop" aria-describedby="br-gfxhint">${[['', 'None'], ...Object.entries(BACKDROP_NAMES)].map(([v, l]) => `<option value="${v}"${(b.backdrop || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="f"><label for="br-wipe">Cut wipe (WebGL)</label><select id="br-wipe" aria-describedby="br-gfxhint">${[['', 'None'], ['liquid', 'Liquid wipe'], ['iris', 'Iris'], ['burn', 'Burn'], ['glitch', 'Glitch'], ['flash', 'Flash through white']].map(([v, l]) => `<option value="${v}"${(b.wipe || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <span class="muted hint" id="br-gfxhint">Drawn in the brand colours. The backdrop moves slowly behind every scene that has no background of its own; the wipe sweeps a band across the frame at every scene change. Applies when the storyboard is rebuilt.</span>
    <div class="f" style="max-width:360px"><label for="br-blend">Cut blend</label><select id="br-blend" aria-describedby="br-blendhint">${[['', 'None'], ['whip', 'Whip pan'], ['zoom', 'Zoom through'], ['warp', 'Cross warp'], ['split', 'Colour split']].map(([v, l]) => `<option value="${v}"${(b.blend || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted hint" id="br-blendhint">Both scenes show for half a second around every scene change and are mixed: they slide past with a motion blur, zoom through, bend into each other, or split into colours. It replaces the cut wipe, so picking one sets the other to None. Applies when the storyboard is rebuilt.</span></div>
    </details>
    <div class="grid2"><div class="f"><label for="br-grade">Colour grade</label><select id="br-grade" aria-describedby="br-gradehint">${gradeOptions(b.grade)}</select></div>
      <div class="f"><label for="br-gradeamt">Grade strength (%)</label><input id="br-gradeamt" type="number" min="10" max="100" step="5" value="${Math.round((b.grade?.amount ?? 1) * 100)}" aria-describedby="br-gradehint"></div></div>
    <span class="muted hint" id="br-gradehint">One colour look over every clip and photo in the video, so footage from different cameras looks like one film. Upload your own .cube LUT as an asset to use it here. Logos, app screens and the brand colours of text and shapes keep their true colours. Applies when the storyboard is rebuilt.</span>
    <div class="grid2"><div class="f"><label for="br-substyle">Subtitles</label><select id="br-substyle" aria-describedby="br-subhint">${subOptions(b.subtitles)}</select></div>
      <div class="f"><label for="br-subfont">Subtitle font</label><select id="br-subfont">${['Roboto', 'Montserrat', 'Inter', 'brand'].map((x) => `<option value="${x}"${(b.subtitles?.font || 'Roboto') === x ? ' selected' : ''}>${x === 'brand' ? 'Brand body font' : x}</option>`).join('')}</select></div></div>
    <span class="muted hint" id="br-subhint">One look for every clip of this brand. Classic: white words on a light blurred box. Highlighter: the same, with a marker sweeping across the spoken word. Minimal: white words with a dark halo, fading softly. Pill: a pill in the marker colour slides from word to word. Pop: larger words pop in one by one as they are spoken. Each shows a few words at a time, sized for a phone and kept clear of player controls. Applies when the storyboard is rebuilt.</span>

    <h3>Voice-over</h3>
    <div class="grid2"><div class="f"><label for="br-tts">Voice engine</label><select id="br-tts">${engines.map((e) => `<option value="${esc(e.id)}" ${tts === e.id ? 'selected' : ''} ${e.available ? '' : 'disabled'}>${esc(e.label)}${e.available ? '' : ` (unavailable: ${esc(e.reason || '')})`}</option>`).join('')}</select></div>
      <div class="f"><label for="br-voice">Voice</label><select id="br-voice">${voiceOptions(tts, b.voice?.voice)}</select></div></div>
    ${missingEngine(tts, engines) ? `<div class="banner warn"><p>${esc(missingEngine(tts, engines))} Until then every video of this brand has music only. Pick Windows voices above to get a voice now.</p></div>` : ''}
    <div class="f"><label for="br-cloud">Cloud voice id (ElevenLabs, optional)</label><input id="br-cloud" maxlength="40" pattern="[A-Za-z0-9]{8,40}" value="${esc(b.voice?.cloud?.voice || '')}" aria-describedby="br-cloudhint">
      <span class="muted hint" id="br-cloudhint">With a voice id here and ELEVENLABS_API_KEY in .env, each job gets a Make cloud voice button in its Script tab: every line is made once on your key, with word times for the captions. Lines not made keep the voice above.</span></div>
    <div class="row"><div class="f" style="width:160px"><label for="br-speed">Speed</label><input id="br-speed" type="number" min="0.6" max="1.5" step="0.05" value="${esc(b.voice?.speed ?? 1)}"></div>
      <button class="btn" type="button" id="br-vprev" style="align-self:flex-end">▶ Preview voice</button><audio id="br-vaudio" preload="none"></audio>
      <span class="muted mono" id="br-vnote" style="align-self:flex-end"></span></div>
    <div class="f"><label for="br-say">Say as</label><textarea id="br-say" rows="3" placeholder="AMAD = A M A D&#10;.NET = dot net" aria-describedby="br-sayhint">${esc(sayText(b.voice?.say))}</textarea>
      <span class="muted hint" id="br-sayhint">One word per line: the word as written, =, then what the voice says. Captions keep the written word. Applies when the storyboard is rebuilt.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-cleanup" ${b.voice?.cleanup ? 'checked' : ''} aria-describedby="br-cleanuphint"> Clean up recorded voice</label>
      <span class="muted hint" id="br-cleanuphint">For a voice take recorded at home or on a phone: removes low rumble, steady background noise and harsh "s" sounds, and evens out the level. Leave it off for a studio recording. Applies when the storyboard is rebuilt.</span></div>

    <h3>Background music</h3>
    <div class="grid2"><div class="f"><label for="br-music">Track</label><select id="br-music">${musicOptions(b.music?.file || '')}</select></div>
      <div class="f"><label for="br-gain">Level under the voice (dB)</label><input id="br-gain" type="number" min="-40" max="0" step="1" value="${esc(b.music?.gainDb ?? -18)}"></div></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-duck" ${b.music?.duck ? 'checked' : ''} aria-describedby="br-duckhint"> Duck music under voice</label>
      <span class="muted hint" id="br-duckhint">Music dips while someone speaks and comes back up in the pauses. Applies to the next render.</span></div>
    <div class="row"><button class="btn" type="button" id="br-mprev">▶ Preview track</button><audio id="br-maudio" controls preload="none" style="height:32px"></audio></div>

    <h3>Cut sound</h3>
    <div class="grid2"><div class="f"><label for="br-sfx">Sound at each cut</label><select id="br-sfx" aria-describedby="br-sfxhint"><option value="none">None</option>${(opts.sfx || []).map((x) => `<option value="${esc(x.id)}"${b.sfx?.cut === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <div class="f"><label for="br-sfxgain">Level (dB)</label><input id="br-sfxgain" type="number" min="-30" max="0" step="1" value="${esc(b.sfx?.gainDb ?? -12)}"></div></div>
    <span class="muted hint" id="br-sfxhint">A soft sound where one scene cuts to the next (not at the start of the video), mixed under the voice and never ducked by it. A scene can pick its own in the Script tab. Applies when the storyboard is rebuilt.</span>
    <div class="row"><button class="btn" type="button" id="br-sprev">▶ Preview sound</button><audio id="br-saudio" preload="none"></audio></div>

    <h3>Sources and tone</h3>
    <div class="grid2"><div class="f"><label for="br-site">Site</label><input id="br-site" value="${esc(b.site)}"></div>
      <div class="f"><label for="br-hosts">Allowed data hosts (comma-separated)</label><input id="br-hosts" value="${esc((b.sources?.allowedHosts || []).join(', '))}"></div></div>
    <div class="f"><label for="br-notes">Tone of voice (voice.md)</label><textarea id="br-notes" rows="6">${esc(d.voiceNotes)}</textarea></div>
    <div class="savebar">
      <div class="row"><button class="btn p" type="submit" id="br-save">Save brand</button><span class="muted small" id="br-state">→ profiles/${esc(project)}/brand.json</span></div>
      <div class="err" role="alert" id="br-err"></div></div>
  </form>

  <h3 style="margin-top:22px">Assets · profiles/${esc(project)}/assets</h3>
  <div class="drop" id="br-drop" tabindex="0" role="button" aria-label="Upload files">
    <b>Drop files here</b> or <u>choose files</u> · ${opts.assetTypes.map((t) => '.' + t).join(' ')} · up to ${opts.maxAssetMB} MB each, video up to ${opts.maxVideoMB} MB
    <input type="file" id="br-file" multiple accept="${opts.assetTypes.map((t) => '.' + t).join(',')}" hidden>
  </div>
  <label class="muted" style="display:inline-flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="br-replace"> Replace existing files with the same name</label>
  <ul class="uplist" id="br-uplist" aria-label="Uploads" aria-live="polite" hidden></ul>
  <div class="err" role="alert" id="br-uerr"></div>
  <div class="assets" id="br-assets"></div>

  <h3 style="margin-top:22px">Generate with Gemini</h3>
  <div class="gen" id="br-gen">${gen ? `
    <p class="small" style="margin:0">${esc(GEN_NOTICE)}</p>
    <label class="small" id="gen-ackrow" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="gen-ack"> I understand</label>
    <div class="row gen-models">
      <div class="f"><label for="gen-dimg">Default image model</label><select id="gen-dimg"></select></div>
      <div class="f"><label for="gen-dvid">Default clip model</label><select id="gen-dvid"></select></div>
      <button class="btn" type="button" id="gen-refresh">Refresh models</button>
    </div>
    <div class="small" id="gen-fetched"></div>
    <p class="muted small" style="margin:0">A listed model can still be refused by Google: a retired id stays in the list for a while.</p>
    <div class="grid2"><div class="f"><label for="gen-kind">Kind</label><select id="gen-kind"><option value="image">Image</option><option value="video">Clip (Gemini Omni, with sound)</option></select></div>
      <div class="f"><label for="gen-model">Model for this click</label><select id="gen-model"></select></div></div>
    <p class="muted small" id="gen-cliphint" style="margin:0" hidden>${esc(GEN_CLIP_NOTE)}</p>
    <div class="f"><label for="gen-prompt">Prompt</label><textarea id="gen-prompt" rows="3" maxlength="${GEN_PROMPT_MAX}">${esc(`${b.name} product photo, brand colors ${b.colors.primary} and ${b.colors.secondary}, clean studio background`)}</textarea></div>
    <div class="f" id="gen-refrow"><span class="flabel" id="gen-refl">Reference pictures <span class="muted">(optional, up to ${GEN_REFS_MAX}: the image or clip keeps their subject, e.g. one character)</span></span>
      <div class="refpick" id="gen-refs" role="group" aria-labelledby="gen-refl"></div></div>
    <div class="grid2"><div class="f"><label for="gen-ar">Aspect ratio</label><select id="gen-ar"></select></div>
      <div class="f"><label for="gen-name">File name (optional)</label><input id="gen-name" class="mono" maxlength="80" placeholder="gen-yyyymmdd-hhmm.jpg"></div></div>
    <label class="muted" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="gen-replace"> Replace an existing file with the same name</label>
    <div class="row"><button class="btn p" type="button" id="gen-go">Generate</button><span class="small" id="gen-status" role="status"></span></div>
    <div class="err" role="alert" id="gen-err"></div>` : '<p class="muted" style="margin:0">Restart npm run ui to enable generation.</p>'}
    <details class="more" id="br-clipdef"${b.clipBrief || b.clipRefs?.length ? ' open' : ''}><summary>Clip defaults for New from script <span class="muted">· the start of every scene's Generate clip</span></summary>
      <div class="f"><label for="br-clipbrief">Clip brief</label><textarea id="br-clipbrief" rows="6" maxlength="${CLIP_BRIEF_MAX}" aria-describedby="br-clipbriefhint">${esc(b.clipBrief || '')}</textarea>
        <span class="muted hint" id="br-clipbriefhint">The character and style block every clip shares: who the character is, what they wear, the look and the light. Each scene's prompt adds its title, its description lines and the aspect. At most ${CLIP_BRIEF_MAX} characters.</span></div>
      <div class="f"><span class="flabel" id="br-clipl">Default reference pictures <span class="muted">(up to ${GEN_REFS_MAX})</span></span>
        <div class="refpick" id="br-cliprefs" role="group" aria-labelledby="br-clipl"></div></div>
      <div class="row"><button class="btn" type="button" id="br-clipsave">Save clip defaults</button><span class="muted small">Saved with the brand, as Save brand does.</span></div>
    </details></div>

  <h3 style="margin-top:22px">Hero banner</h3>
  <div class="gen" id="br-banner">
    <p class="muted small" style="margin:0">A standalone web page with the backdrop moving in the saved brand colours, for a website hero. It opens in a new tab and is saved under out/${esc(project)}/_banner/. The button links to # until you set its link on your site.</p>
    <div class="grid2"><div class="f"><label for="hb-backdrop">Backdrop</label><select id="hb-backdrop">${bn.backdrops.map((v) => `<option value="${esc(v)}"${(b.backdrop || 'mesh') === v ? ' selected' : ''}>${esc(BACKDROP_NAMES[v] || v)}</option>`).join('')}</select></div>
      <div class="f"><label for="hb-size">Size</label><select id="hb-size">${bn.sizes.map((v) => `<option value="${esc(v)}">${esc(v.replace('x', ' × '))}</option>`).join('')}</select></div></div>
    <div class="f"><label for="hb-headline">Headline (optional)</label><input id="hb-headline" maxlength="${bn.limits.headline}"></div>
    <div class="f"><label for="hb-subline">Subline (optional)</label><input id="hb-subline" maxlength="${bn.limits.subline}"></div>
    <div class="grid2"><div class="f"><label for="hb-button">Button text (optional)</label><input id="hb-button" maxlength="${bn.limits.button}"></div>
      <div class="f" style="align-self:flex-end"><label class="chk"><input type="checkbox" id="hb-parallax"> Follow the pointer (parallax)</label></div></div>
    <div class="row"><button class="btn p" type="button" id="hb-go">Export hero banner</button><span class="small" id="hb-status" role="status"></span></div>
    <div class="err" role="alert" id="hb-err"></div>
  </div>

  <h3 style="margin-top:22px">Icons · profiles/${esc(project)}/icons.json</h3>
  <p class="muted" style="margin:0 0 8px;max-width:80ch">Upload filled (solid) SVG icons. Each file becomes one shape that morphs into the others in beat, step, offer and CTA scenes. Outline-only icons are refused: outline the strokes before export. The file name becomes the icon name.</p>
  <div class="drop" id="br-idrop" tabindex="0" role="button" aria-label="Upload icons">
    <b>Drop .svg icons here</b> or <u>choose files</u> · up to ${d.maxIconKB} KB each, ${d.maxIcons} per brand
    <input type="file" id="br-ifile" multiple accept=".svg,image/svg+xml" hidden>
  </div>
  <label class="muted" style="display:inline-flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="br-ireplace"> Replace icons with the same name</label>
  <ul class="uplist" id="br-iuplist" aria-label="Icon uploads" aria-live="polite" hidden></ul>
  <div class="err" role="alert" id="br-ierr"></div>
  <div class="icons" id="br-icons"></div>
  <details class="icons-builtin"><summary class="muted">Built-in icons (${Object.keys(d.builtInIcons).length})</summary>
    <div class="icons">${Object.entries(d.builtInIcons).map(([n, p]) => `<div class="iconcard">${iconSvg(p)}<span>${esc(n)}</span></div>`).join('')}</div></details>

  <div class="danger">
    <h3>Delete project</h3>
    <p class="muted" style="margin:0 0 10px">Removes this brand, its briefs, jobs, videos and assets from the tool. The folders move to <code>trash/</code>, so a mistake can still be undone by hand.</p>
    <button class="btn bad" type="button" id="br-del">Delete project…</button>
  </div>`;

  $('#br-del').addEventListener('click', () => openDeleteProject(project, b.name, assets.length));
  $('#br-clipsave').addEventListener('click', () => $('#brf').requestSubmit());
  $('#hb-go').addEventListener('click', async () => {
    const go = $('#hb-go');
    go.disabled = true;
    $('#hb-err').textContent = '';
    $('#hb-status').textContent = 'Building…';
    try {
      const r = await api(`/projects/${P}/banner`, { method: 'POST', body: {
        backdrop: $('#hb-backdrop').value, size: $('#hb-size').value, headline: $('#hb-headline').value,
        subline: $('#hb-subline').value, button: $('#hb-button').value, parallax: $('#hb-parallax').checked,
      } });
      if (!box.isConnected) return;
      window.open(r.url, '_blank', 'noopener');
      $('#hb-status').innerHTML = `Saved to <code>${esc(r.path)}</code> · <a href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>`;
    } catch (e) {
      if (!box.isConnected) return;
      $('#hb-status').textContent = '';
      $('#hb-err').textContent = e.message;
    } finally { go.disabled = false; }
  });
  const markDirty = () => { if (S.brandDirty) return; S.brandDirty = true; $('#br-state').textContent = 'Unsaved changes'; };
  $('#brf').addEventListener('input', markDirty);
  $('#brf').addEventListener('change', markDirty);
  // The hint follows the chosen motion style; the film box shows only for a style that draws film grain.
  const drawMotion = () => {
    const o = motionOpt($('#br-motion').value);
    $('#br-motionhint').textContent = o.hint;
    $('#br-filmrow').hidden = !o.film;
    $('#br-carryrow').hidden = !o.carry;
    $('#br-revealrow').hidden = !o.reveal;
  };
  $('#br-motion').addEventListener('change', drawMotion);
  // A brand takes a cut wipe or a cut blend, not both (validateBrand).
  $('#br-wipe').addEventListener('change', () => { if ($('#br-wipe').value) $('#br-blend').value = ''; });
  $('#br-blend').addEventListener('change', () => { if ($('#br-blend').value) $('#br-wipe').value = ''; });
  drawMotion();
  const drawLogoPreview = () => {
    const l = $('#br-logo').value, dk = $('#br-logodark').value || l;
    $('#lp-light').innerHTML = l ? `<img src="${assetUrl(l)}" alt="">` : '<span class="muted">No logo</span>';
    $('#lp-dark').innerHTML = dk ? `<img src="${assetUrl(dk)}" alt="">` : '<span class="muted">No logo</span>';
  };
  const drawPalette = () => {
    $('#br-palette').innerHTML = palette.length ? palette.map((p, i) => `<div class="swatch">
      <input type="color" data-pi="${i}" data-pk="hex" value="${esc(p.hex)}" aria-label="Color ${i + 1}">
      <input class="hex mono" data-pi="${i}" data-pk="hexText" value="${esc(p.hex)}" maxlength="7" aria-label="Hex ${i + 1}">
      <input class="mono" data-pi="${i}" data-pk="name" value="${esc(p.name)}" placeholder="name, e.g. highlight" maxlength="24" aria-label="Name ${i + 1}" style="width:180px">
      <code>--c-${esc(p.name || 'name')}</code>
      <button class="btn sm" type="button" data-prm="${i}" aria-label="Remove color ${i + 1}">Remove</button></div>`).join('') : '<span class="muted">None yet.</span>';
  };
  // brand.fonts.files: one row per uploaded font file, with the family, weight and style it is loaded as.
  const drawFonts = () => {
    const files = assets.filter(isFont);
    const fileOpts = (sel) => files.map((a) => `<option value="${esc(a)}"${a === sel ? ' selected' : ''}>${esc(a)}</option>`).join('')
      + (sel && !files.includes(sel) ? `<option value="${esc(sel)}" selected>${esc(sel)} (not in the assets)</option>` : '');
    $('#br-fonts').innerHTML = fontFiles.length ? fontFiles.map((x, i) => `<div class="row fontrow">
      <select data-fi="${i}" data-fk="file" aria-label="Font file ${i + 1}">${fileOpts(x.file)}</select>
      <input data-fi="${i}" data-fk="family" value="${esc(x.family)}" maxlength="40" placeholder="Family, e.g. Gilroy" aria-label="Family of font file ${i + 1}">
      <select data-fi="${i}" data-fk="weight" aria-label="Weight of font file ${i + 1}">${FONT_WEIGHTS.map((w) => `<option value="${w}"${Number(x.weight) === w ? ' selected' : ''}>${w}</option>`).join('')}</select>
      <select data-fi="${i}" data-fk="style" aria-label="Style of font file ${i + 1}">${['normal', 'italic'].map((s) => `<option${x.style === s ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn sm" type="button" data-frm="${i}" aria-label="Remove font file ${i + 1}">Remove</button></div>`).join('')
      : `<span class="muted">${files.length ? 'None yet: the fonts come from Google Fonts.' : 'No font files uploaded. Upload .woff2, .woff, .ttf or .otf files under Assets first.'}</span>`;
    const unused = files.filter((a) => !fontFiles.some((x) => x.file === a));
    $('#br-addfont').disabled = !unused.length || fontFiles.length >= MAX_FONT_FILES;
    $('#br-addfont').title = !files.length ? 'Upload a font file under Assets first' : !unused.length ? 'Every uploaded font file is in the list' : fontFiles.length >= MAX_FONT_FILES ? `At most ${MAX_FONT_FILES} font files` : '';
  };
  // Video and sound files can be transcribed by the local speech model; the Director then picks clips from the words.
  const sttHtml = (a) => {
    if (isImage(a)) return '';
    const t = transcripts[a];
    if (t?.busy) return '<span class="muted small"><span class="spin" aria-hidden="true"></span> Transcribing…</span>';
    const view = t?.segments !== undefined ? `<button class="btn sm" type="button" data-tview="${esc(a)}">Transcript${t.stale ? ' (old)' : ''}</button>` : '';
    const run = sttOk ? `<button class="btn sm" type="button" data-trun="${esc(a)}" title="Speech to text on this computer">${t?.segments !== undefined ? 'Again' : 'Transcribe'}</button>` : '';
    return `${view}${run}${t?.error ? `<span class="bad-t small">${esc(t.error)}</span>` : ''}`;
  };
  const when = (iso) => new Date(iso).toLocaleString('en-US');
  const genTag = (a) => {
    const g = gen?.generated?.[a];
    return g ? `<span class="pill" title="${esc(`${g.model} · ${when(g.madeAt)}`)}">Generated</span>` : '';
  };
  // Gemini panel: every choice comes from the server's generate state; the key itself never reaches the page.
  const modelOptions = (kind, sel) => {
    const list = gen.models.available.filter((m) => m.kind === kind);
    const known = list.some((m) => m.id === sel);
    return `${sel && !known ? `<option value="${esc(sel)}" selected>${esc(sel)}${list.length ? ' (not in the fetched list)' : ''}</option>` : ''}${list.map((m) => `<option value="${esc(m.id)}" title="${esc(m.description)}" ${m.id === sel ? 'selected' : ''}>${esc(m.displayName)} (${esc(m.id)})</option>`).join('')}`;
  };
  let genWasRunning = false;
  const genMine = () => gen.running?.project === project;
  const drawGen = () => {
    if (!gen || !alive() || !$('#br-gen')) return;
    const { defaults, available, fetchedAt } = gen.models;
    const kind = $('#gen-kind').value;
    const pick = $('#gen-model').value;
    $('#gen-dimg').innerHTML = modelOptions('image', defaults.image);
    $('#gen-dvid').innerHTML = modelOptions('video', defaults.video);
    $('#gen-model').innerHTML = modelOptions(kind, available.some((m) => m.id === pick && m.kind === kind) ? pick : defaults[kind]);
    const keep = $('#gen-ar').value;
    const ratios = gen.options?.[kind]?.aspectRatios || [];
    $('#gen-ar').innerHTML = ratios.map((r) => `<option ${r === keep ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const missing = available.length ? Object.entries(defaults).filter(([k, id]) => !available.some((m) => m.id === id && m.kind === k)).map(([, id]) => id) : [];
    $('#gen-fetched').innerHTML = `<span class="muted">${fetchedAt ? `Model list fetched ${esc(when(fetchedAt))}` : 'Click Refresh models to see what your key can reach'}</span>${missing.map((id) => `<br><span class="bad-t">${esc(id)} is not in the fetched list</span>`).join('')}`;
    $('#gen-ackrow').hidden = Boolean(gen.notice);
    const clip = kind === 'video';
    $('#gen-cliphint').hidden = !clip;
    $('#gen-name').placeholder = `gen-yyyymmdd-hhmm.${clip ? 'mp4' : 'jpg'}`;
    const c = gen.caps;
    // The kind picked is the one whose caps close the button.
    const k = clip ? { u: gen.usage.videos, day: c?.maxVideosPerDay, month: c?.maxVideosPerMonth, what: 'clip' } : { u: gen.usage.images, day: c?.maxImagesPerDay, month: c?.maxImagesPerMonth, what: 'image' };
    const blocked = !gen.hasKey || Boolean(gen.error);
    let status;
    if (!gen.hasKey) status = `<span class="bad-t">Add ${esc(gen.keyEnv || 'GEMINI_API_KEY')} to .env in the Motion Studio folder (or set it in your environment), then restart npm run ui.</span>`;
    else if (gen.error) status = `<span class="bad-t">${esc(gen.error)}</span>`;
    else if (genMine()) status = `<span class="spin" aria-hidden="true"></span> ${gen.running.kind === 'video' ? 'Making a clip, usually 1-3 minutes…' : 'Generating…'}`;
    else if (gen.running) status = '<span class="muted">Another Gemini request is running</span>';
    else if (gen.pause) status = `<span class="bad-t">Paused until ${esc(when(gen.pause.until))}</span> · <button class="btn sm" type="button" id="gen-unpause">Clear pause</button>`;
    else if (k.u.day >= k.day) status = `<span class="bad-t">Daily ${k.what} limit reached (${esc(k.day)}). Generate opens again tomorrow.</span>`;
    else if (k.u.month >= k.month) status = `<span class="bad-t">Monthly ${k.what} limit reached (${esc(k.month)}). Generate opens again next month.</span>`;
    else {
      const iu = gen.usage.images, vu = gen.usage.videos;
      status = `<span class="muted">Images: ${esc(iu.day)}/${esc(c.maxImagesPerDay)} today · ${esc(iu.month)}/${esc(c.maxImagesPerMonth)} this month · Clips: ${esc(vu.day)}/${esc(c.maxVideosPerDay)} today · ${esc(vu.month)}/${esc(c.maxVideosPerMonth)} this month</span>`;
    }
    $('#gen-status').innerHTML = status;
    for (const id of ['#gen-dimg', '#gen-dvid', '#gen-refresh']) $(id).disabled = blocked || Boolean(gen.running);
    const capped = k.u.day >= k.day ? `The daily ${k.what} limit is reached` : k.u.month >= k.month ? `The monthly ${k.what} limit is reached` : '';
    $('#gen-go').disabled = blocked || Boolean(gen.running) || Boolean(gen.pause) || Boolean(capped);
    $('#gen-go').title = capped || (gen.pause ? 'Paused after a quota error' : gen.running ? 'Another Gemini request is running' : '');
  };
  let genPoll = 0;
  const watchGen = () => {
    clearTimeout(genPoll);
    if (!gen || !genMine()) return;
    genWasRunning = true;
    genPoll = setTimeout(async () => {
      if (!alive() || !$('#br-gen')) return;
      try {
        const fresh = await api(`/projects/${P}`);
        if (!alive()) return;
        gen = fresh.generate;
        if (!genMine() && genWasRunning) {
          genWasRunning = false;
          if (gen.last?.status === 'done') { assets = fresh.assets; toast(gen.last.message); drawAssets(); refreshOptions(); } else if (gen.last) $('#gen-err').textContent = gen.last.message;
        }
        drawGen();
      } catch { /* server restarting */ }
      watchGen();
    }, 3000);
  };
  const reloadGen = async () => { gen = (await api(`/projects/${P}`)).generate; drawGen(); watchGen(); };
  let poll = 0;
  const watchTranscripts = () => {
    clearTimeout(poll);
    if (!Object.values(transcripts).some((t) => t.busy)) return;
    poll = setTimeout(async () => {
      if (!alive()) return;
      try {
        const fresh = await api(`/projects/${P}`);
        if (!alive()) return;
        transcripts = fresh.transcripts || {};
        drawAssets();
      } catch { /* server restarting */ }
    }, 3000);
  };
  const drawAssets = () => {
    if (!alive()) return;
    $('#br-assets').innerHTML = assets.map((a) => `<div class="asset">${isImage(a) ? `<img src="${assetUrl(a)}" alt="">` : `<div class="aud" aria-hidden="true">${GLYPH[assetKind(a)]}</div>`}
      <span>${esc(a)}</span>${genTag(a)}${sttHtml(a)}${isVideo(a) ? `<button class="btn sm" type="button" data-shots="${esc(a)}" title="Shots, transcript search and clip cutting">Shots</button>` : ''}<button class="btn sm" type="button" data-adel="${esc(a)}" aria-label="Delete ${esc(a)}">Delete</button></div>`).join('') || '<span class="muted">No files yet.</span>';
    watchTranscripts();
    const keep = (id, fn) => { const v = $(id).value; $(id).innerHTML = fn(v); };
    keep('#br-logo', imgOptions); keep('#br-logodark', imgOptions); keep('#br-music', musicOptions);
    drawLogoPreview();
    const pictures = assets.filter((a) => SHOT_RE.test(a));
    genRefs = genRefs.filter((a) => pictures.includes(a));
    clipRefs = clipRefs.filter((a) => pictures.includes(a));
    for (const [id, picked] of [['#gen-refs', genRefs], ['#br-cliprefs', clipRefs]]) {
      const el = $(id);
      if (!el) continue;
      el.innerHTML = refPickerHtml(pictures, picked, assetUrl);
      capRefs(el);
    }
    // A transcript poll redraws the assets; it must not take the focus from a family name being typed.
    if (!$('#br-fonts').contains(document.activeElement)) drawFonts();
  };
  const drawIcons = () => {
    $('#br-icons').innerHTML = Object.entries(icons).map(([n, p]) => `<div class="iconcard">${iconSvg(p)}<span>${esc(n)}</span>
      <button class="btn sm" type="button" data-idel="${esc(n)}" aria-label="Delete icon ${esc(n)}">Delete</button></div>`).join('') || '<span class="muted">No brand icons yet. Scenes use the built-in ones.</span>';
  };
  drawPalette();
  drawAssets();
  drawIcons();
  drawGen();
  watchGen();
  if (gen) {
    // Not busy(): it rewrites the control's innerHTML, which would drop a select's options.
    const saveDefaults = async () => {
      $('#gen-err').textContent = '';
      try {
        gen.models.defaults = (await api('/generate/models', { method: 'PUT', body: { image: $('#gen-dimg').value, video: $('#gen-dvid').value } })).models;
        toast('Saved the default models');
      } catch (err) { $('#gen-err').textContent = err.message; } finally { drawGen(); }
    };
    $('#gen-dimg').addEventListener('change', saveDefaults);
    $('#gen-dvid').addEventListener('change', saveDefaults);
    $('#gen-kind').addEventListener('change', drawGen);
    $('#gen-refresh').addEventListener('click', async (e) => {
      await busy(e.currentTarget, async () => {
        const r = await api('/generate/models/refresh', { method: 'POST' });
        gen.models = { ...gen.models, available: r.models, fetchedAt: r.fetchedAt };
        toast(`Found ${r.models.length} image and clip models`);
      }, $('#gen-err'));
      drawGen();
    });
    $('#gen-go').addEventListener('click', async (e) => {
      await busy(e.currentTarget, async () => {
        await api(`/projects/${P}/generate`, {
          method: 'POST',
          body: {
            kind: $('#gen-kind').value, prompt: $('#gen-prompt').value, aspectRatio: $('#gen-ar').value, model: $('#gen-model').value,
            refs: genRefs,
            name: $('#gen-name').value.trim(), replace: $('#gen-replace').checked, acknowledged: $('#gen-ack').checked,
          },
        });
        await reloadGen();
      }, $('#gen-err'));
      drawGen();
    });
    $('#gen-status').addEventListener('click', (e) => {
      if (e.target.id !== 'gen-unpause') return;
      busy(e.target, async () => {
        await api(`/projects/${P}/generate/pause`, { method: 'DELETE' });
        await reloadGen();
      }, $('#gen-err'));
    });
  }

  box.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.hexfor && /^#[0-9a-fA-F]{6}$/.test(el.value)) $(`#${el.dataset.hexfor}`).value = el.value;
    if (el.id?.startsWith('brc-')) { const t = box.querySelector(`[data-hexfor="${el.id}"]`); if (t) t.value = el.value; }
    if (el.dataset.pi !== undefined) {
      const p = palette[+el.dataset.pi];
      if (el.dataset.pk === 'name') { p.name = el.value.trim().toLowerCase(); el.parentElement.querySelector('code').textContent = `--c-${p.name || 'name'}`; }
      if (el.dataset.pk === 'hex') { p.hex = el.value; el.parentElement.querySelector('[data-pk="hexText"]').value = el.value; }
      if (el.dataset.pk === 'hexText' && /^#[0-9a-fA-F]{6}$/.test(el.value)) { p.hex = el.value; el.parentElement.querySelector('[data-pk="hex"]').value = el.value; }
    }
    if (el.dataset.fi !== undefined) {
      const x = fontFiles[+el.dataset.fi];
      x[el.dataset.fk] = el.dataset.fk === 'weight' ? Number(el.value) : el.dataset.fk === 'family' ? el.value.trim() : el.value;
    }
    // The clip defaults sit next to Generate, outside the brand form, and save with it.
    if (el.id === 'br-clipbrief') markDirty();
  });
  box.addEventListener('change', (e) => {
    const refBox = e.target.closest('#gen-refs, #br-cliprefs');
    if (refBox) {
      capRefs(refBox);
      if (refBox.id === 'gen-refs') genRefs = pickedRefs(refBox);
      else { clipRefs = pickedRefs(refBox); markDirty(); }
    }
    if (e.target.id === 'br-logo' || e.target.id === 'br-logodark') drawLogoPreview();
    if (e.target.id === 'br-tts') { $('#br-voice').innerHTML = voiceOptions(e.target.value, ''); $('#br-vnote').textContent = ''; }
  });
  $('#br-addcolor').addEventListener('click', () => { palette.push({ name: '', hex: '#2563eb' }); drawPalette(); markDirty(); });
  // A new row takes the first font file not in the list yet, with the family, weight and style its name suggests.
  $('#br-addfont').addEventListener('click', () => {
    const file = assets.filter(isFont).find((a) => !fontFiles.some((x) => x.file === a));
    if (!file || fontFiles.length >= MAX_FONT_FILES) return;
    fontFiles.push(guessFont(file, $('#br-fd').value.trim() || b.fonts.display));
    drawFonts(); markDirty();
  });
  box.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-prm]');
    if (rm) { palette.splice(+rm.dataset.prm, 1); drawPalette(); markDirty(); return; }
    const frm = e.target.closest('[data-frm]');
    if (frm) { fontFiles.splice(+frm.dataset.frm, 1); drawFonts(); markDirty(); return; }
    const idel = e.target.closest('[data-idel]');
    if (idel) {
      const n = idel.dataset.idel;
      if (!window.confirm(`Delete icon ${n}?`)) return;
      await busy(idel, async () => {
        await api(`/projects/${P}/icons/${encodeURIComponent(n)}`, { method: 'DELETE' });
        const { [n]: _gone, ...rest } = icons;
        icons = rest;
        drawIcons();
        toast(`Deleted icon ${n}`);
      }, $('#br-ierr'));
      return;
    }
    const trun = e.target.closest('[data-trun]');
    if (trun) {
      await busy(trun, async () => {
        await api(`/projects/${P}/assets/${encodeURIComponent(trun.dataset.trun)}/transcribe`,{ method: 'POST', body: { lang: b.voice?.lang || '' } });
        transcripts = { ...transcripts, [trun.dataset.trun]: { busy: true } };
        drawAssets();
        toast(`Transcribing ${trun.dataset.trun} on this computer…`);
      }, $('#br-uerr'));
      return;
    }
    const tview = e.target.closest('[data-tview]');
    if (tview) { await busy(tview, () => openTranscript(project, tview.dataset.tview), $('#br-uerr')); return; }
    const shotsBtn = e.target.closest('[data-shots]');
    if (shotsBtn) {
      openShots(project, shotsBtn.dataset.shots, (name) => { if (!assets.includes(name)) assets = [...assets, name].sort(); drawAssets(); });
      return;
    }
    const del = e.target.closest('[data-adel]');
    if (del) {
      if (!window.confirm(`Delete ${del.dataset.adel}?`)) return;
      await busy(del, async () => {
        await api(`/projects/${P}/assets/${encodeURIComponent(del.dataset.adel)}`, { method: 'DELETE' });
        assets = assets.filter((a) => a !== del.dataset.adel);
        if (gen) delete gen.generated[del.dataset.adel];
        drawAssets();
        refreshOptions();
        toast(`Deleted ${del.dataset.adel}`);
      }, $('#br-uerr'));
    }
  });
  $('#br-vprev').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const q = new URLSearchParams({ provider: $('#br-tts').value, voice: $('#br-voice').value, speed: $('#br-speed').value });
    assertWritable(); // the review link never runs TTS
    const r = await send(`/tts/preview?${q}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const a = $('#br-vaudio');
    a.src = URL.createObjectURL(await r.blob());
    $('#br-vnote').textContent = 'Playing sample…';
    await a.play().catch(() => { $('#br-vnote').textContent = 'Click again to play'; });
  }, $('#br-err')));
  $('#br-mprev').addEventListener('click', () => {
    const v = $('#br-music').value;
    if (!v) return;
    const m = opts.music.find((x) => x.id === v);
    const a = $('#br-maudio');
    a.src = m ? m.url : assetUrl(v);
    a.play().catch(() => {});
  });
  // The library file at the chosen level, as the mix will place it (clamped: an audio element cannot go above 1).
  $('#br-sprev').addEventListener('click', () => {
    const s = (opts.sfx || []).find((x) => x.id === $('#br-sfx').value);
    if (!s) return;
    const a = $('#br-saudio');
    a.src = s.url;
    a.volume = Math.min(1, 10 ** ((Number($('#br-sfxgain').value) || 0) / 20) * 4);
    a.play().catch(() => {});
  });

  // One status line per file of this batch: refused before sending (type, size), its progress, then done or the server's error.
  const uploadBatch = async (files, list, check, send, done) => {
    const ul = $(list);
    ul.hidden = !files.length;
    ul.innerHTML = files.map((f, i) => `<li data-up="${i}"><span class="mono">${esc(f.name)}</span> <span class="up-st muted">waiting</span></li>`).join('');
    const st = (i, text, cls = 'muted') => { const el = $(`[data-up="${i}"] .up-st`, ul); if (el) { el.className = `up-st ${cls}`; el.textContent = text; } };
    S.uploading = (S.uploading || 0) + 1;
    try {
      for (const [i, f] of files.entries()) {
        const why = check(f);
        if (why) { st(i, why, 'bad-t'); continue; }
        try {
          const data = await send(f, (p) => st(i, `uploading ${Math.round(p * 100)}%`));
          st(i, 'done', 'ok-t');
          done(data);
        } catch (err) { st(i, err.message, 'bad-t'); }
      }
    } finally { S.uploading -= 1; }
  };
  const upload = async (files) => {
    $('#br-uerr').textContent = '';
    const replace = $('#br-replace').checked ? '1' : '0';
    let added = 0;
    await uploadBatch(files, '#br-uplist',
      (f) => uploadProblem(f, opts.assetTypes, opts.maxAssetMB * 1024 * 1024, opts.maxVideoMB * 1024 * 1024),
      (f, onP) => postFile(`/projects/${P}/assets?name=${encodeURIComponent(f.name)}&replace=${replace}`, f, 'application/octet-stream', onP),
      (data) => {
        added += 1;
        if (!assets.includes(data.name)) assets = [...assets, data.name].sort();
        if (gen) delete gen.generated[data.name];
      });
    if (!alive()) return;
    drawAssets();
    if (added) { toast(`Uploaded ${added} file${added === 1 ? '' : 's'}`); refreshOptions(); }
  };
  const drop = $('#br-drop');
  drop.addEventListener('click', () => $('#br-file').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#br-file').click(); } });
  $('#br-file').addEventListener('change', (e) => { upload([...e.target.files]); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); });

  const uploadIcons = async (files) => {
    $('#br-ierr').textContent = '';
    const replace = $('#br-ireplace').checked ? '1' : '0';
    await uploadBatch(files, '#br-iuplist',
      (f) => uploadProblem(f, ['svg'], d.maxIconKB * 1024),
      (f, onP) => postFile(`/projects/${P}/icons?name=${encodeURIComponent(f.name)}&replace=${replace}`, f, 'image/svg+xml', onP),
      (data) => { icons = { ...icons, [data.name]: data.d }; });
    if ($('#br-icons')) drawIcons();
  };
  const idrop = $('#br-idrop');
  idrop.addEventListener('click', () => $('#br-ifile').click());
  idrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#br-ifile').click(); } });
  $('#br-ifile').addEventListener('change', (e) => { uploadIcons([...e.target.files]); e.target.value = ''; });
  idrop.addEventListener('dragover', (e) => { e.preventDefault(); idrop.classList.add('over'); });
  idrop.addEventListener('dragleave', () => idrop.classList.remove('over'));
  idrop.addEventListener('drop', (e) => { e.preventDefault(); idrop.classList.remove('over'); uploadIcons([...e.dataTransfer.files]); });

  $('#brf').addEventListener('submit', (e) => {
    e.preventDefault();
    guarded('form:brand', $('#br-save'), async () => {
      const bad = paletteProblems(palette);
      if (bad.length) throw new Error(bad.join('\n'));
      // An emptied number field is refused, never saved as 0 dB (full volume) or a default speed.
      const num = (id, label, min, max) => {
        const v = parseNum($(id).value);
        if (v === null || !(v >= min && v <= max)) throw new Error(`${label} must be a number from ${min} to ${max}.`);
        return v;
      };
      const sfxOn = $('#br-sfx').value !== 'none';
      const brand = {
        ...b, name: $('#br-name').value.trim(), logoText: $('#br-logotext').value.trim(), site: $('#br-site').value.trim(),
        logo: $('#br-logo').value || null, logoDark: $('#br-logodark').value || null, logoBug: $('#br-logobug').checked,
        colors: Object.fromEntries(COLORS.map(([k]) => [k, $(`#brc-${k}`).value])),
        palette,
        fonts: { ...b.fonts, display: $('#br-fd').value.trim(), body: $('#br-fb').value.trim(), googleFonts: $('#br-gf').value.trim(), files: fontFiles },
        voice: { ...b.voice, tts: $('#br-tts').value, voice: $('#br-voice').value, speed: num('#br-speed', 'Voice speed', 0.6, 1.5), say: parseSay($('#br-say').value) ?? undefined, cleanup: $('#br-cleanup').checked || undefined,
          cloud: $('#br-cloud').value.trim() ? { provider: 'elevenlabs', voice: $('#br-cloud').value.trim(), ...(b.voice?.cloud?.model ? { model: b.voice.cloud.model } : {}) } : undefined },
        motion: $('#br-motion').value,
        film: motionOpt($('#br-motion').value).film && !$('#br-film').checked ? false : undefined,
        shine: $('#br-shine').checked,
        leaks: $('#br-leaks').checked,
        confetti: $('#br-confetti').checked || undefined,
        reveal: motionOpt($('#br-motion').value).reveal && $('#br-reveal').value ? $('#br-reveal').value : undefined,
        ease: $('#br-ease').value || undefined,
        carry: motionOpt($('#br-motion').value).carry && $('#br-carry').checked ? true : undefined,
        backdrop: $('#br-backdrop').value || undefined,
        wipe: $('#br-wipe').value || undefined,
        blend: $('#br-blend').value || undefined,
        grade: gradeValue($('#br-grade').value, num('#br-gradeamt', 'Grade strength (%)', 10, 100)),
        subtitles: subValue(b.subtitles, $('#br-substyle').value, $('#br-subfont').value),
        music: { file: $('#br-music').value || null, gainDb: num('#br-gain', 'Music level (dB)', -40, 0), duck: $('#br-duck').checked },
        sfx: sfxOn ? { cut: $('#br-sfx').value, gainDb: num('#br-sfxgain', 'Cut sound level (dB)', -30, 0) } : undefined,
        sources: { allowedHosts: $('#br-hosts').value.split(',').map((x) => x.trim()).filter(Boolean) },
        clipBrief: $('#br-clipbrief').value.trim() || undefined,
        clipRefs: clipRefs.length ? clipRefs : undefined,
      };
      const saved = await api(`/projects/${P}/brand`, { method: 'PUT', body: { brand, voiceNotes: $('#br-notes').value } });
      // An empty host list is filled from the site on save: show what was stored.
      $('#br-hosts').value = saved.brand.sources.allowedHosts.join(', ');
      S.brandDirty = false;
      $('#br-state').textContent = `Saved → profiles/${project}/brand.json`;
      resetTemplatePreviews();
      S.state = await api('/state');
      fillProjects(); // the project picker shows the brand name
      toast('Brand saved. New jobs and rebuilt storyboards use it.');
    }, $('#br-err'));
  });
}

boot().catch((e) => { $('#detail').innerHTML = `<p class="err" role="alert">Failed to load: ${esc(e.message)}</p>`; });
