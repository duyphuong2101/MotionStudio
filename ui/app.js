import { SHOT_RE, bulletShot, shotField, shotAction, applyShot, assetKind, uploadProblem, parseNum, parseSay, sayText, paletteProblems, guessFont, MOTION_OPTIONS, motionOpt } from './shots.js';

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
  queued: 'waiting for Director', scripting: 'Director writing', scripted: 'scripted', dirty: 'edited, needs re-run',
  preparing: 'building storyboard', awaiting_review: 'awaiting review', approved: 'approved', rendering: 'rendering',
  done: 'done', error: 'error',
};
const BUSY = ['scripting', 'preparing', 'rendering'];
const WHO = { human: 'human', director: 'director', tool: 'tool' };
const FIELD_LABEL = {
  vo: 'Voice-over', layout: 'Layout', zoom: 'Zoom', nav: 'Nav item', page: 'Page title', data: 'Screen data', assistant: 'Assistant turns', title: 'Title', subtitle: 'Subtitle', kicker: 'Kicker', text: 'Text line', chip: 'Chip',
  stat: 'Number', icon: 'Icon', shots: 'Shots (image, focus, cursor, click)', pace: 'Pace', decor: 'Decor', check: 'Check mark', button: 'CTA button', url: 'URL', asset: 'Image', packLine: 'Pack line', source: 'Claim source',
  video: 'Video clip', sound: 'Sound', image: 'Cover art', name: 'Name', role: 'Role', in: 'Starts at (s)', out: 'Ends at (s)', code: 'Code', before: 'Before', after: 'After', lang: 'Window label', file: 'File name', files: 'Changed files', lines: 'Terminal lines', highlight: 'Lines to light up', periods: 'Periods', series: 'Series (one value per period)', values: 'Values', finish: 'Ends as', top: 'Bars shown', items: 'Items', points: 'Points', parts: 'Parts', labels: 'Axis labels', band: 'Highlight band', ref: 'Reference line', theme: 'Theme',
};

// Review link (npm run ui:review): the same UI, read-only. app.css hides the edit controls; the server refuses every write anyway.
const REVIEW = document.documentElement.dataset.review === '1';
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
const FORM_BTNS = { 'form:brief': '#bf-save, #bf-saverun', 'form:seq': '#sf-save', 'form:brand': '#br-save' };
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
    // Redraw what the lock disabled, so each control gets back its own state (e.g. "the Director is already running").
    if (key === jobKey() && S.detail) renderTop();
    else if (key === seqKey() && S.seqSel && !S.seqForm) renderSeqDetail();
    else if (FORM_BTNS[key]) $$(FORM_BTNS[key]).forEach((b) => { b.disabled = false; });
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
  $('#new-brief').addEventListener('click', () => openBriefForm({}));
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
  S.project = id; store.set('ms.project', id); S.sel = null; S.detail = null; S.briefForm = null; S.seqSel = null; S.seqForm = null;
  S.paneDirty = false; S.brandDirty = false; S.listHtml = null;
  $('#proj').value = id;
  $('#detail').innerHTML = '<p class="muted">Select a job on the left.</p>';
  renderBrand();
  resetTemplatePreviews();
  try { await refreshJobs(true); } catch (e) {
    $('#detail').innerHTML = `<div class="banner bad" role="alert"><p>Could not load ${esc(id)}: ${esc(e.message)}</p><button class="btn" type="button" id="proj-retry">Retry</button></div>`;
    $('#proj-retry').addEventListener('click', () => switchProject(id));
  }
}

function showTab(tab) {
  $$('#nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${tab}`));
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
  const what = briefFormDirty() ? (S.briefForm.edit ? 'your changes to the brief' : 'the new brief')
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
  $('#topstatus').textContent = `${active} running · ${review} awaiting review · ${queued} waiting for Director`;
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
      <span class="dot s-${esc(s.status)}" role="img" aria-label="Status: ${esc(STATUS[s.status] || s.status)}" title="${esc(STATUS[s.status] || s.status)}"></span>
      <span style="min-width:0;flex:1"><span class="t">${esc(j.brief.id)}</span><br>
      <span class="m">${esc(STATUS[s.status] || s.status)} · ${esc(tplName(j.brief))} · ${esc(j.brief.duration)}s</span>
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
function renderDetail() {
  $('#detail').innerHTML = `<div id="d-top"></div>
    <div class="subtabs" role="tablist">
      ${[['preview', 'Preview'], ['script', 'Script'], ['source', 'Source'], ['history', 'History']].map(([k, l]) => `<button role="tab" aria-selected="${S.sub === k}" class="${S.sub === k ? 'on' : ''}" data-sub="${k}">${l}</button>`).join('')}
    </div><div id="d-pane"></div>`;
  $$('#detail .subtabs button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.sub !== S.sub) goSub(b.dataset.sub); }));
  renderTop();
  renderPane();
}

// Switches the job's sub-tab. `jump` carries where to land: { t } seeks the preview, { scene } scrolls the Script tab to it.
function goSub(sub, jump = null) {
  if (!confirmDiscard()) return;
  S.sub = sub; S.paneDirty = false; S.jump = jump;
  $$('#detail .subtabs button').forEach((x) => { const on = x.dataset.sub === sub; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
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
    ? `<h3>Lint</h3><ul class="findings">${s.lint.findings.map((f) => `<li class="${esc(f.level)}">[${esc(f.level)}] ${f.scene ? `${esc(f.scene)} · ` : ''}${esc(f.el)}: ${esc(f.msg)}</li>`).join('')}</ul>` : '';
  $('#d-top').innerHTML = `<div class="head"><h2>${esc(b.id)}</h2>
      <span class="pill">${esc(tplName(b))}</span><span class="pill">${esc(b.format)}</span>${b.platform ? `<span class="pill">${esc(platformLabel(b.platform))}</span>` : ''}<span class="pill">${esc(b.duration)}s</span>
      ${b.lang ? `<span class="pill">${esc(langName(b.lang))}</span>` : ''}${b.voice ? `<span class="pill" title="Voice for this video">${esc(b.voice === 'none:' ? 'no voice' : b.voice.slice(b.voice.indexOf(':') + 1))}</span>` : ''}${b.voiceTake ? `<span class="pill" title="Recorded voice">recorded · ${esc(b.voiceTake)}</span>` : ''}
      <span class="pill">${esc(STATUS[s.status] || s.status)}</span>
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
    case 'scripted': return B('human', 'Script ready. The Director usually builds the storyboard itself, but you can run it now.', btn('prepare', 'Build storyboard (steps 5-7)', true));
    case 'dirty': {
      const drafts = (d.script?.scenes || []).filter((x) => x.draft).length;
      if (drafts) return B('warn', `${drafts} draft scene(s) waiting — click Run Director for this job.`, dirBtns('Run Director for this job'));
      if (s.dirty_from === 3) return B('warn', 'You changed the template. The Director writes a new script for it from the kept source. Your earlier script is in <code>script.prev.json</code>.', dirBtns('Run Director for this job'));
      if (s.dirty_from === 1) return B('warn', 'You edited the brief. The Director needs to redo the source and script. Fields you edited in the Script and Source tabs stay locked.', dirBtns('Run Director for this job'));
      return (s.dirty_from ?? 99) < 5
        ? B('warn', `You edited the source data. The Director needs to rewrite the script. The fields you edited are locked, so the Director won't overwrite them.`, dirBtns('Run Director for this job'))
        : B('warn', 'Script edited by hand. Re-run from step 5 to get a new storyboard.', btn('prepare', 'Re-run from step 5', true));
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
        + qaHtml(o.qa, base, (o.cuts || []).length ? d.brief.format : '')
        + (o.cuts || []).map((c) => qaHtml(c.qa, base, c.format)).join('');
    }
    case 'error':
      // failed: 'render' keeps the approval, so the same render can simply run again.
      if (s.failed === 'render') return B('bad', `Render failed: ${esc(String(s.error || 'unknown').replace(/\.$/, ''))}. The storyboard is still approved: retry the render, or edit the script and rebuild it.`, `${btn('render', 'Retry render', true)}${d.script ? btn('prepare', 'Re-run from step 5') : ''}${dirBtns('Run Director again')}`);
      return B('bad', `Error: ${esc(String(s.error || 'unknown').replace(/\.$/, ''))}. Run the Director again, or edit the script in the Script tab.`, `${dirBtns('Run Director again')}${d.script ? btn('prepare', 'Re-run from step 5') : ''}`);
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
  S.dirHtml = html;
  $('#director').innerHTML = html;
  const pre = $('#director pre');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

async function directorClick(e) {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  const what = b.dataset.dir;
  if (what === 'cancel' && !window.confirm('Stop the Director run? Jobs it was working on go to error.')) return;
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
  const src = S.detail.source;
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
    const r = await api(`/jobs/${jobPath()}/source`, { method: 'PUT', body: { doc, note: $('#src-note').value } });
    S.paneDirty = false;
    toast(!r.changed.length ? 'Nothing changed'
      : r.statusKept ? 'Screenshots saved. No claim changed, so the job status stays as it is.'
      : `Saved: ${r.changed.join(', ')}. Needs a Director run.`);
    await loadDetail(true);
  }, $('#src-err')));
  lockPane();
}

function paneScript(pane) {
  const d = S.detail, sc = d.script;
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
  const uploadHint = ` ${footage ? 'Upload clips' : 'Upload images'} in the Brand tab → Assets.`;
  const JSON_FIELDS = new Set(['data', 'assistant', 'shots', 'items', 'parts', 'people', 'points', 'labels', 'before', 'after', 'periods', 'series', 'values', 'lines', 'files', 'highlight', 'band', 'ref', 'photos']);
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

  const fieldHtml = (s, f) => {
    const id = esc(`sc-${s.id}-${f}`), sid = esc(s.id);
    const lk = locks[`scene:${s.id}.${f}`];
    const lock = lk ? `<span class="lock">locked by ${esc(lk.by)}</span>` : '';
    const label = `<label for="${id}">${esc(FIELD_LABEL[f] || f)} ${lock}</label>`;
    const { limits = {}, enums = {}, marks } = rulesFor(s.kind);
    const markable = marks === true && MARK_FIELDS.includes(f);
    const hint = (help.fields[s.kind]?.[f] || '') + (f === 'asset' || f === 'shots' ? uploadHint : '') + (markable ? MARK_HINT : '');
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
    if (f === 'asset') return `<div class="f">${label}<select ${attrs}><option value="">(none)</option>${images.map((a) => `<option ${s.asset === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>${tip}</div>`;
    if (f === 'video') return `<div class="f">${label}<select ${attrs}><option value="">(none)</option>${d.assets.filter((a) => /\.(mp4|webm|mov)$/i.test(a)).map((a) => `<option ${s.video === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>${tip}</div>`;
    if (f === 'sound') return `<div class="f">${label}<label class="chk"><input ${attrs} type="checkbox" ${s.sound ? 'checked' : ''}> Play the clip's own sound</label>${tip}</div>`;
    if (f === 'image') return `<div class="f">${label}<select ${attrs}><option value="">(none)</option>${pictures.map((a) => `<option ${s.image === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>${tip}</div>`;
    if (f === 'source') return `<div class="f">${label}${sourceSelect(s, attrs)}${shotNote(s)}${tip}</div>`;
    if (enums[f]) return `<div class="f">${label}<select ${attrs}><option value="">(default)</option>${enums[f].map((n) => `<option value="${esc(n)}"${s[f] === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>${tip}</div>`;
    if (JSON_FIELDS.has(f) || (s[f] && typeof s[f] === 'object')) {
      const txt = s[f] === undefined ? '' : JSON.stringify(s[f], null, 1);
      return `<details class="f jsonf" style="grid-column:1/-1"><summary>${esc(FIELD_LABEL[f] || f)} (JSON) ${lock}</summary>
        <textarea ${attrs} class="mono" rows="${Math.min(18, Math.max(4, txt.split('\n').length))}" data-json="1">${esc(txt)}</textarea>${tip}</details>`;
    }
    return `<div class="f">${label}<input ${attrs} value="${esc(s[f] ?? '')}"${max}>${tip}</div>`;
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
        ${s.draft ? draftHtml(s, fields) : `<div class="grid2">${fields.map((f) => fieldHtml(s, f)).join('')}</div>`}</div>${addRow(i + 1)}`;
    }).join('');
    drawChecks();
  };

  const saved = S.scriptWarnings;
  S.scriptWarnings = null;
  pane.innerHTML = `<fieldset class="stack ed" id="pane-ed" style="max-width:none">
    <details class="howto"><summary>How scenes work</summary><ul>
      <li>A scene is one shot on screen plus one voice line. It lasts as long as its voice line.</li>
      <li><b>Title</b>, <b>Kicker</b> and <b>Subtitle</b> are the on-screen text. The kicker is the small label above the title.</li>
      <li><b>Claim source</b> names the fact in the Source tab that backs the scene, e.g. <code>bullets[1]</code>. Nothing on screen may be invented.</li>
      <li><b>Pace</b> sets how long a scene holds: quick, normal or focus.</li>
      <li><b>JSON</b> fields hold lists and screen data. Tip: Duplicate a similar scene and edit the copy.</li>
      <li><b>Draft for Director</b>: pick the kind, the position and the claim source, write one line about what the scene should show, and the Director writes it on its next run.</li>
    </ul></details>
    <p class="muted">Edit, add, duplicate, delete or reorder scenes. Saving locks what you changed (and the scene order) and moves the job to "re-run from step 5". The template checks the order and required fields on save.</p>
    ${locks.scenes ? `<p class="lock">Scene order locked by ${esc(locks.scenes.by)}: the Director keeps this order.</p>` : ''}
    ${saved?.length ? `<div class="banner warn" role="status"><p>Saved with warnings:<br>${saved.map(esc).join('<br>')}</p></div>` : ''}
    <div class="scenes" id="sc-list"></div>
    <div class="savebar">
      <div id="sc-check" aria-live="polite"></div>
      <div class="row"><button class="btn p" id="sc-save">Save script</button>
        <input id="sc-note" class="note" maxlength="200" placeholder="Reason for the edit (optional)" aria-label="Reason for the edit">
        <span class="muted small">Then re-run from step 5 (step 4 with drafts).</span></div>
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

  const find = (id) => scenes.find((s) => s.id === id);
  const drawChecksSoon = () => queueMicrotask(drawChecks);
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
    if (f === 'source') {
      const field = imageField(s), shot = bulletShot(src, s.source);
      if (shotAction(s, field, shot, images[0]) === 'set') scenes[scenes.indexOf(s)] = applyShot(s, field, shot);
      draw();
      $(`#${CSS.escape(`sc-${s.id}-source`)}`)?.focus();
    }
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
    const r = await api(`/jobs/${jobPath()}/script`, { method: 'PUT', body: { doc, note: $('#sc-note').value } });
    S.paneDirty = false;
    S.scriptWarnings = r.warnings || null;
    const drafts = scenes.filter((s) => s.draft).length;
    toast(!r.changed.length ? 'Nothing changed'
      : drafts ? `Saved. ${drafts} draft scene(s) waiting — click Run Director for this job.`
      : `Saved ${r.changed.length} change(s). Click "Re-run from step 5".`);
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
    : '<p class="muted small">No sheet yet. It appears after the next prepare.</p>';
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
  const add = async () => {
    const text = $('#note-text', box).value.trim();
    if (!text) return;
    try { await api(`/jobs/${jobPath(project, id)}/notes`, { method: 'POST', body: { t: clock.t(), text } }); } catch (err) { toast(err.message); return; }
    fillNotes(box, project, id, clock);
  };
  $('#note-add', box).addEventListener('click', add);
  $('#note-text', box).addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
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
      <h3>Storyboard stills (step 7)</h3><div class="stills">${stills || '<span class="muted">None yet.</span>'}</div>
      <h3 style="margin-top:14px">Review sheet</h3><div id="revbox"><span class="muted small">Loading…</span></div>
      ${REVIEW ? '' : '<h3 style="margin-top:14px">Notes for the Director</h3><div id="notebox"><span class="muted small">Loading…</span></div>'}
      <h3 style="margin-top:14px">Timing (${esc(d.timing?.source || '')})</h3>
      <table class="mono timing"><tbody>${rows}</tbody></table>
    </div></div>`;
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
  if (view !== 'comp') {
    const v = $('video', pane);
    if (notebox && v) fillNotes(notebox, S.project, S.sel, { t: () => v.currentTime, go: (t) => { v.pause(); v.currentTime = t; } });
    if (v) {
      v.addEventListener('timeupdate', () => markScene(v.currentTime));
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
  const syncSound = (t, force) => {
    if (!soundOn()) return;
    for (const a of sounds) {
      if (Number.isFinite(a.duration) && t >= a.duration) { a.pause(); continue; }
      if (force || Math.abs(a.currentTime - t) > 0.15) a.currentTime = t;
      if (playing && a.paused) a.play().catch(() => {});
    }
  };
  const seek = (t) => {
    const w = frame.contentWindow;
    if (w && w.__ready) { w.seek(t); rng.value = t; tc.textContent = `${Number(t).toFixed(2)}s`; markScene(t); }
  };
  frame.addEventListener('load', () => { const wait = () => (frame.contentWindow?.__ready ? seek(jumpT ?? 0) : setTimeout(wait, 100)); wait(); });
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

/* ---------------- briefs ---------------- */
const FORMAT_NAME = { '9:16': 'vertical', '1:1': 'square', '16:9': 'landscape', '4:5': 'portrait', '2:3': 'tall', '21:9': 'ultrawide' };
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
  alsoFormats: $$('#bf-alsolist input:checked').map((x) => x.value), cutOnBeat: $('#bf-beat').checked, motionBlur: $('#bf-blur').checked,
});
// A new brief counts as unsaved once it has a message; an edit once any field differs from the stored brief.
function briefFormDirty() {
  if (!S.briefForm || !$('#bf')) return false;
  return S.briefForm.edit ? JSON.stringify(briefBody()) !== S.briefSnap : Boolean($('#bf-msg').value.trim());
}

const TPL_CHANGE_CONFIRM = 'Changing the template sends the job back to the Director for a new script. Your edits stay in script.prev.json.';
const TPL_CHANGE_NOTE = 'Changing the template or the mix sends the job back to the Director for a new script; the current script is kept as script.prev.json.';

function renderBriefForm(pre) {
  const st = S.state;
  const tpls = st.templates;
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const hasScript = pre.edit && pre.hasScript;
  const heading = pre.edit ? 'Edit brief' : pre.from ? `Duplicate of ${esc(pre.from)}` : 'New brief';
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
      <fieldset class="mix" id="bf-mix" aria-describedby="bf-mixhint"><legend>Mix in scenes from</legend><div class="row" id="bf-mixlist"></div><span class="muted hint" id="bf-mixhint"></span></fieldset>
      <div class="f"><label for="bf-plat">Platform</label><select id="bf-plat" aria-describedby="bf-plathint"></select><span class="muted hint" id="bf-plathint"></span></div>
      <div class="f"><label for="bf-fmt">Format</label><select id="bf-fmt"></select></div>
      <fieldset class="mix" id="bf-also" aria-describedby="bf-alsohint"><legend>Also make (same script and voice)</legend><div class="row" id="bf-alsolist"></div><span class="muted hint" id="bf-alsohint"></span></fieldset>
      <div class="f"><label for="bf-id">Job id</label>${pre.edit
        ? `<input id="bf-id" value="${esc(pre.id)}" readonly><span class="muted hint">The job id is the file name and cannot change.</span>`
        : '<input id="bf-id" maxlength="64" placeholder="auto from name + format">'}</div>
    </div>
    <div class="grid2">
      <div class="f"><label for="bf-lang">Language</label><select id="bf-lang" aria-describedby="bf-langhint"></select>
        <span class="muted hint" id="bf-langhint">The Director writes the script in this language.</span></div>
      <div class="f"><label for="bf-voice">Voice</label><select id="bf-voice" aria-describedby="bf-voicehint"></select>
        <span class="muted hint" id="bf-voicehint"></span></div>
      <div class="f"><label for="bf-take">Recorded voice</label><select id="bf-take" aria-describedby="bf-takehint">${opt('', 'None — use the brand voice', !pre.voiceTake)}${pre.voiceTake ? opt(pre.voiceTake, pre.voiceTake, true) : ''}</select>
        <span class="muted hint" id="bf-takehint">One take reading every voice line in order. Prepare matches it to the scenes.</span></div>
      <div class="f" style="grid-column:1/-1"><label class="chk"><input type="checkbox" id="bf-beat" ${pre.cutOnBeat ? 'checked' : ''} aria-describedby="bf-beathint"> Cut scenes on the music beat</label>
        <span class="muted hint" id="bf-beathint"></span>
        <label class="chk"><input type="checkbox" id="bf-blur" ${pre.motionBlur ? 'checked' : ''} aria-describedby="bf-blurhint"> Motion blur on fast moves</label>
        <span class="muted hint" id="bf-blurhint">Softens fast movement like a camera shutter. Rendering takes about 4 times as long; the storyboard does not change.</span></div>
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
  const syncAll = () => { syncMix(); syncPlatforms($('#bf-plat').value); syncFormats($('#bf-fmt').value); syncTpl(); syncAlso(); syncId(); };
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
    $('#bf-voicehint').textContent = !sel?.value ? `Uses the brand voice (${bv.tts || 'none'}${bv.voice ? ` · ${bv.voice}` : ''}).`
      : clash ? `This voice speaks ${vl}; the video is ${lang}. Pick a voice in that language.` : '';
    $('#bf-voicehint').classList.toggle('bad-t', clash);
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
  drawMix(); syncMix(); syncPlatforms(pre.platform); syncFormats(pre.format); syncTpl(); syncAlso(); syncId();
  S.briefSnap = pre.edit ? JSON.stringify(briefBody()) : null;
  $('#bf-tpl').addEventListener('change', () => { drawMix(); syncAll(); });
  $('#bf-mixlist').addEventListener('change', syncAll);
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
    const newScript = hasScript && (body.template !== pre.template || JSON.stringify(body.mix) !== JSON.stringify(pre.mix || []));
    if (newScript && !window.confirm(TPL_CHANGE_CONFIRM)) return;
    sendBrief(btn, run, body);
  };
  const sendBrief = (btn, run, body) => guarded('form:brief', btn, async () => {
    if (pre.edit) {
      const res = await api(`/briefs/${jobPath(S.project, pre.id)}`, { method: 'PUT', body });
      toast(res.newScript ? `Saved. ${pre.id} is back in the Director queue for a new script; the old one is in script.prev.json.`
        : res.requeued ? `Saved. ${pre.id} is back in the Director queue.` : res.rePrepare ? `Saved. Re-run ${pre.id} from step 5 to hear the new voice.` : res.changed.length ? `Saved brief ${pre.id}.` : 'Nothing changed.');
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
  $('#seqlist').innerHTML = S.seqs.length ? S.seqs.map((it) => {
    const { sequence: q, status: s, running } = it, stale = seqStale(it);
    const st = running ? 'rendering' : s.status;
    return `<button class="job ${S.seqSel === q.id ? 'on' : ''}" data-seq="${esc(q.id)}"${stale ? ` title="${esc(stale.reason)}"` : ''}>
      <span class="dot s-${esc(st)}" role="img" aria-label="Status: ${esc(SEQ_STATUS[st] || st)}" title="${esc(SEQ_STATUS[st] || st)}"></span>
      <span style="min-width:0;flex:1"><span class="t">${esc(q.title || q.id)}</span><br>
      <span class="m">${esc(SEQ_STATUS[st] || st)} · ${q.parts.length} parts · ${esc(q.format)}</span>
      ${stale ? '<br><span class="pill warn-t">Out of date — render again</span>' : ''}</span></button>`;
  }).join('') : '<p class="muted">No sequences yet.</p>';
  $$('#seqlist .job').forEach((b) => b.addEventListener('click', () => selectSequence(b.dataset.seq)));
  if (S.seqSel && !S.seqForm) {
    const it = seqItem(S.seqSel);
    if (!it || seqStamp(it) !== S.seqStamp) renderSeqDetail();
  }
}

// Leaves whatever the detail pane shows; false when the person keeps unsaved edits.
function leaveDetail() {
  if (!confirmDiscard()) return false;
  stopPlay();
  stageRo?.disconnect();
  stageRo = null;
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
    $('#sf-add').innerHTML = usable.map((j) => opt(j.brief.id, `${j.brief.id} · ${tplName(j.brief)} · ${partReady(j.brief.id, f) ? `${j.status.outputs.duration}s` : `not rendered (${STATUS[j.status.status] || j.status.status})`}`, j.brief.id === picked)).join('');
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
  frame.addEventListener('load', () => { const wait = () => (frame.contentWindow?.__ready ? seek(t) : setTimeout(wait, 100)); wait(); });
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
    <h2>Editing mid-way</h2><p>Editing Source locks that field and needs the Director to re-run from step 4. Editing Script locks that field and you click "Re-run from step 5" yourself. The Director never overwrites a locked field.</p>
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
    const a = Number($('#sh-in').value), b = Number($('#sh-out').value);
    $('#sh-len').textContent = $('#sh-in').value && $('#sh-out').value && b > a ? `${sec(b - a)} s` : '';
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
    $('#sh-strip').innerHTML = d ? d.shots.map((s) => `<button class="shot" type="button" role="listitem" data-sin="${s.start}" data-sout="${s.end}" aria-label="Shot ${s.n} at ${clock(s.start)}, set In">
      <img src="${imgUrl(s.thumb, d.stamp)}" alt="" loading="lazy"><span class="mono small">${clock(s.start)}</span></button>`).join('') : '';
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
    };
  };

  $('#sh-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => clearTimeout(poll), { once: true });
  $('#sh-preset').addEventListener('change', drawPreset);
  $('#sh-in').addEventListener('input', drawLen);
  $('#sh-out').addEventListener('input', drawLen);
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
  const sttOk = Boolean(d.stt?.available);
  let palette = (b.palette || []).map((p) => ({ ...p }));
  let fontFiles = (b.fonts.files || []).map((x) => ({ ...x }));
  const COLORS = [['primary', 'Primary'], ['primary2', 'Primary 2'], ['secondary', 'Accent'], ['bg', 'Background'], ['ink', 'Text'], ['muted', 'Muted text'], ['onPrimary', 'Text on primary']];
  const isImage = (a) => assetKind(a) === 'image';
  const isAudio = (a) => assetKind(a) === 'audio';
  const isVideo = (a) => assetKind(a) === 'video';
  const isFont = (a) => assetKind(a) === 'font';
  const GLYPH = { audio: '♪', video: '▶', font: 'Aa', model: '3D', other: '·' };
  const assetUrl = (a) => `/assets/${P}/${encodeURIComponent(a)}`;
  // Built-in tracks, voices and cut sounds come from /options; fetched again after the assets change.
  const refreshOptions = () => api('/options').then((o) => { S.options = opts = o; if ($('#br-assets')) drawAssets(); }).catch(() => {});
  const imgOptions = (sel) => `<option value="">(none)</option>${assets.filter(isImage).map((a) => `<option ${sel === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}`;
  // A brand box set by hand in brand.json (color, bg) stays selectable as "Custom box" so a save keeps it.
  const SUB_LOOKS = [['', 'Template default'], ['classic', 'Classic'], ['highlighter', 'Highlighter'], ['minimal', 'Minimal'], ['pill', 'Pill'], ['pop', 'Pop']];
  const subOptions = (s) => {
    const cur = s?.style || (s ? 'custom' : '');
    return [...SUB_LOOKS, ...(s && !s.style ? [['custom', 'Custom box (brand.json)']] : [])]
      .map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('');
  };
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
      <span class="muted hint" id="br-logobughint">Keeps the logo file fixed top-left in every scene, the dark-background logo on dark scenes; scenes then leave out their own logo. Needs a logo file. Applies on the next prepare.</span></div>

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
      <span class="muted hint" id="br-ffhint">Loaded in every video instead of Google Fonts. Give the file the family name you typed as Display or Body font, and one row per weight and style. Applies on the next prepare.</span></div>
    <div class="f" style="max-width:360px"><label for="br-motion">Motion style</label><select id="br-motion" aria-describedby="br-motionhint">
      ${MOTION_OPTIONS.map((o) => `<option value="${o.id}"${motionOpt(b.motion) === o ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <span class="muted hint" id="br-motionhint"></span></div>
    <div class="f" id="br-filmrow"><label class="chk"><input type="checkbox" id="br-film" ${b.film === false ? '' : 'checked'} aria-describedby="br-filmhint"> Film grain and vignette</label>
      <span class="muted hint" id="br-filmhint">A fine moving grain and slightly darker corners over every scene. Off keeps the frame clean and the rest of the cinematic motion. Applies on the next prepare.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-shine" ${b.shine ? 'checked' : ''} aria-describedby="br-shinehint"> Shine on buttons</label>
      <span class="muted hint" id="br-shinehint">A soft light band sweeps across the call-to-action button once it is in, and again near the end of a long scene. Applies on the next prepare.</span></div>
    <div class="f" id="br-carryrow"><label class="chk"><input type="checkbox" id="br-carry" ${b.carry ? 'checked' : ''} aria-describedby="br-carryhint"> Accent bar carries every cut</label>
      <span class="muted hint" id="br-carryhint">A short bar in the accent colour sits under each scene's kicker or heading and glides to the next one at every cut, so the film reads as one piece. Applies on the next prepare.</span></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-leaks" ${b.leaks ? 'checked' : ''} aria-describedby="br-leakshint"> Light leaks at cuts</label>
      <span class="muted hint" id="br-leakshint">A warm glow, with a touch of the accent colour, flares across the frame at every scene change and fades. Applies on the next prepare.</span></div>
    <div class="grid2"><div class="f"><label for="br-backdrop">Backdrop (WebGL)</label><select id="br-backdrop" aria-describedby="br-gfxhint">${[['', 'None'], ['mesh', 'Mesh gradient'], ['aurora', 'Aurora'], ['flow', 'Contour lines'], ['shapes', '3D shapes']].map(([v, l]) => `<option value="${v}"${(b.backdrop || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="f"><label for="br-wipe">Cut wipe (WebGL)</label><select id="br-wipe" aria-describedby="br-gfxhint">${[['', 'None'], ['liquid', 'Liquid wipe']].map(([v, l]) => `<option value="${v}"${(b.wipe || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <span class="muted hint" id="br-gfxhint">Drawn in the brand colours. The backdrop moves slowly behind every scene that has no background of its own; the wipe sweeps a band across the frame at every scene change. Applies on the next prepare.</span>
    <div class="grid2"><div class="f"><label for="br-substyle">Subtitles</label><select id="br-substyle" aria-describedby="br-subhint">${subOptions(b.subtitles)}</select></div>
      <div class="f"><label for="br-subfont">Subtitle font</label><select id="br-subfont">${['Roboto', 'Montserrat', 'Inter', 'brand'].map((x) => `<option value="${x}"${(b.subtitles?.font || 'Roboto') === x ? ' selected' : ''}>${x === 'brand' ? 'Brand body font' : x}</option>`).join('')}</select></div></div>
    <span class="muted hint" id="br-subhint">One look for every clip of this brand. Classic: white words on a light blurred box. Highlighter: the same, with a marker sweeping across the spoken word. Minimal: white words with a dark halo, fading softly. Pill: a pill in the marker colour slides from word to word. Pop: larger words pop in one by one as they are spoken. Each shows a few words at a time, sized for a phone and kept clear of player controls. Applies on the next prepare.</span>

    <h3>Voice-over</h3>
    <div class="grid2"><div class="f"><label for="br-tts">Voice engine</label><select id="br-tts">${engines.map((e) => `<option value="${esc(e.id)}" ${tts === e.id ? 'selected' : ''} ${e.available ? '' : 'disabled'}>${esc(e.label)}${e.available ? '' : ` (unavailable: ${esc(e.reason || '')})`}</option>`).join('')}</select></div>
      <div class="f"><label for="br-voice">Voice</label><select id="br-voice">${voiceOptions(tts, b.voice?.voice)}</select></div></div>
    <div class="row"><div class="f" style="width:160px"><label for="br-speed">Speed</label><input id="br-speed" type="number" min="0.6" max="1.5" step="0.05" value="${esc(b.voice?.speed ?? 1)}"></div>
      <button class="btn" type="button" id="br-vprev" style="align-self:flex-end">▶ Preview voice</button><audio id="br-vaudio" preload="none"></audio>
      <span class="muted mono" id="br-vnote" style="align-self:flex-end"></span></div>
    <div class="f"><label for="br-say">Say as</label><textarea id="br-say" rows="3" placeholder="AMAD = A M A D&#10;.NET = dot net" aria-describedby="br-sayhint">${esc(sayText(b.voice?.say))}</textarea>
      <span class="muted hint" id="br-sayhint">One word per line: the word as written, =, then what the voice says. Captions keep the written word. Applies on the next prepare.</span></div>

    <h3>Background music</h3>
    <div class="grid2"><div class="f"><label for="br-music">Track</label><select id="br-music">${musicOptions(b.music?.file || '')}</select></div>
      <div class="f"><label for="br-gain">Level under the voice (dB)</label><input id="br-gain" type="number" min="-40" max="0" step="1" value="${esc(b.music?.gainDb ?? -18)}"></div></div>
    <div class="f"><label class="chk"><input type="checkbox" id="br-duck" ${b.music?.duck ? 'checked' : ''} aria-describedby="br-duckhint"> Duck music under voice</label>
      <span class="muted hint" id="br-duckhint">Music dips while someone speaks and comes back up in the pauses. Applies to the next render.</span></div>
    <div class="row"><button class="btn" type="button" id="br-mprev">▶ Preview track</button><audio id="br-maudio" controls preload="none" style="height:32px"></audio></div>

    <h3>Cut sound</h3>
    <div class="grid2"><div class="f"><label for="br-sfx">Sound at each cut</label><select id="br-sfx" aria-describedby="br-sfxhint"><option value="none">None</option>${(opts.sfx || []).map((x) => `<option value="${esc(x.id)}"${b.sfx?.cut === x.id ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
      <div class="f"><label for="br-sfxgain">Level (dB)</label><input id="br-sfxgain" type="number" min="-30" max="0" step="1" value="${esc(b.sfx?.gainDb ?? -12)}"></div></div>
    <span class="muted hint" id="br-sfxhint">A soft sound where one scene cuts to the next (not at the start of the video), mixed under the voice and never ducked by it. A scene can pick its own in the Script tab. Applies on the next prepare.</span>
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
    <div class="grid2"><div class="f"><label for="gen-kind">Kind</label><select id="gen-kind"><option value="image">Image</option></select></div>
      <div class="f"><label for="gen-model">Model for this click</label><select id="gen-model"></select></div></div>
    <div class="f"><label for="gen-prompt">Prompt</label><textarea id="gen-prompt" rows="3" maxlength="${GEN_PROMPT_MAX}">${esc(`${b.name} product photo, brand colors ${b.colors.primary} and ${b.colors.secondary}, clean studio background`)}</textarea></div>
    <div class="grid2"><div class="f"><label for="gen-ar">Aspect ratio</label><select id="gen-ar"></select></div>
      <div class="f"><label for="gen-name">File name (optional)</label><input id="gen-name" class="mono" maxlength="80" placeholder="gen-yyyymmdd-hhmm.jpg"></div></div>
    <label class="muted" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="gen-replace"> Replace an existing file with the same name</label>
    <div class="row"><button class="btn p" type="button" id="gen-go">Generate</button><span class="small" id="gen-status" role="status"></span></div>
    <div class="err" role="alert" id="gen-err"></div>` : '<p class="muted" style="margin:0">Restart npm run ui to enable generation.</p>'}</div>

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
  const markDirty = () => { if (S.brandDirty) return; S.brandDirty = true; $('#br-state').textContent = 'Unsaved changes'; };
  $('#brf').addEventListener('input', markDirty);
  $('#brf').addEventListener('change', markDirty);
  // The hint follows the chosen motion style; the film box shows only for a style that draws film grain.
  const drawMotion = () => {
    const o = motionOpt($('#br-motion').value);
    $('#br-motionhint').textContent = o.hint;
    $('#br-filmrow').hidden = !o.film;
    $('#br-carryrow').hidden = !o.carry;
  };
  $('#br-motion').addEventListener('change', drawMotion);
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
    if (!gen || !$('#br-gen')) return;
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
    const u = gen.usage.images, c = gen.caps;
    const blocked = !gen.hasKey || Boolean(gen.error);
    let status;
    if (!gen.hasKey) status = `<span class="bad-t">Add ${esc(gen.keyEnv || 'GEMINI_API_KEY')} to .env in the Motion Studio folder (or set it in your environment), then restart npm run ui.</span>`;
    else if (gen.error) status = `<span class="bad-t">${esc(gen.error)}</span>`;
    else if (genMine()) status = '<span class="spin" aria-hidden="true"></span> Generating…';
    else if (gen.running) status = '<span class="muted">Another Gemini request is running</span>';
    else if (gen.pause) status = `<span class="bad-t">Paused until ${esc(when(gen.pause.until))}</span> · <button class="btn sm" type="button" id="gen-unpause">Clear pause</button>`;
    else if (u.day >= c.maxImagesPerDay) status = `<span class="bad-t">Daily image limit reached (${esc(c.maxImagesPerDay)}). Generate opens again tomorrow.</span>`;
    else if (u.month >= c.maxImagesPerMonth) status = `<span class="bad-t">Monthly image limit reached (${esc(c.maxImagesPerMonth)}). Generate opens again next month.</span>`;
    else status = `<span class="muted">Images: ${esc(u.day)}/${esc(c.maxImagesPerDay)} today · ${esc(u.month)}/${esc(c.maxImagesPerMonth)} this month</span>`;
    $('#gen-status').innerHTML = status;
    for (const id of ['#gen-dimg', '#gen-dvid', '#gen-refresh']) $(id).disabled = blocked || Boolean(gen.running);
    // Kind is Image only (no clip route on the server), so the image caps are the ones that close the button.
    const capped = u.day >= c.maxImagesPerDay ? 'The daily image limit is reached' : u.month >= c.maxImagesPerMonth ? 'The monthly image limit is reached' : '';
    $('#gen-go').disabled = blocked || Boolean(gen.running) || Boolean(gen.pause) || Boolean(capped);
    $('#gen-go').title = capped || (gen.pause ? 'Paused after a quota error' : gen.running ? 'Another Gemini request is running' : '');
  };
  let genPoll = 0;
  const watchGen = () => {
    clearTimeout(genPoll);
    if (!gen || !genMine()) return;
    genWasRunning = true;
    genPoll = setTimeout(async () => {
      if (!$('#br-gen')) return;
      try {
        const fresh = await api(`/projects/${P}`);
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
      if (!$('#br-assets')) return;
      try { transcripts = (await api(`/projects/${P}`)).transcripts || {}; drawAssets(); } catch { /* server restarting */ }
    }, 3000);
  };
  const drawAssets = () => {
    $('#br-assets').innerHTML = assets.map((a) => `<div class="asset">${isImage(a) ? `<img src="${assetUrl(a)}" alt="">` : `<div class="aud" aria-hidden="true">${GLYPH[assetKind(a)]}</div>`}
      <span>${esc(a)}</span>${genTag(a)}${sttHtml(a)}${isVideo(a) ? `<button class="btn sm" type="button" data-shots="${esc(a)}" title="Shots, transcript search and clip cutting">Shots</button>` : ''}<button class="btn sm" type="button" data-adel="${esc(a)}" aria-label="Delete ${esc(a)}">Delete</button></div>`).join('') || '<span class="muted">No files yet.</span>';
    watchTranscripts();
    const keep = (id, fn) => { const v = $(id).value; $(id).innerHTML = fn(v); };
    keep('#br-logo', imgOptions); keep('#br-logodark', imgOptions); keep('#br-music', musicOptions);
    drawLogoPreview();
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
  });
  box.addEventListener('change', (e) => {
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
    if (!$('#br-assets')) return;
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
        voice: { ...b.voice, tts: $('#br-tts').value, voice: $('#br-voice').value, speed: num('#br-speed', 'Voice speed', 0.6, 1.5), say: parseSay($('#br-say').value) ?? undefined },
        motion: $('#br-motion').value,
        film: motionOpt($('#br-motion').value).film && !$('#br-film').checked ? false : undefined,
        shine: $('#br-shine').checked,
        leaks: $('#br-leaks').checked,
        carry: motionOpt($('#br-motion').value).carry && $('#br-carry').checked ? true : undefined,
        backdrop: $('#br-backdrop').value || undefined,
        wipe: $('#br-wipe').value || undefined,
        subtitles: subValue(b.subtitles, $('#br-substyle').value, $('#br-subfont').value),
        music: { file: $('#br-music').value || null, gainDb: num('#br-gain', 'Music level (dB)', -40, 0), duck: $('#br-duck').checked },
        sfx: sfxOn ? { cut: $('#br-sfx').value, gainDb: num('#br-sfxgain', 'Cut sound level (dB)', -30, 0) } : undefined,
        sources: { allowedHosts: $('#br-hosts').value.split(',').map((x) => x.trim()).filter(Boolean) },
      };
      const saved = await api(`/projects/${P}/brand`, { method: 'PUT', body: { brand, voiceNotes: $('#br-notes').value } });
      // An empty host list is filled from the site on save: show what was stored.
      $('#br-hosts').value = saved.brand.sources.allowedHosts.join(', ');
      S.brandDirty = false;
      $('#br-state').textContent = `Saved → profiles/${project}/brand.json`;
      resetTemplatePreviews();
      S.state = await api('/state');
      fillProjects(); // the project picker shows the brand name
      toast('Brand saved. New jobs and jobs re-run from step 5 will use it.');
    }, $('#br-err'));
  });
}

boot().catch((e) => { $('#detail').innerHTML = `<p class="err" role="alert">Failed to load: ${esc(e.message)}</p>`; });
