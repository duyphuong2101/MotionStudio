// The Assistant panel: a sibling of the main column (opening it narrows the page), a transcript of turns, suggestion
// pills for an empty panel, a composer with a model select, help, speech input and send, and an approval card for
// every write. The server side (server/assistant.mjs) parses first; with a model picked, a line it does not know
// goes once to that model (server/assistant-model.mjs). The panel never shows on the review link.
const TICK_MS = 15000;
const STORE_KEY = 'ms.assistant.open';
const MODEL_KEY = 'ms.assistant.model';
const SKELETONS = 3;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minutesLeft = (iso) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 60000));
const expired = (iso) => Date.now() >= Date.parse(iso);

const rowsHtml = (rows) => (rows?.length ? `<dl class="as-rows">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '');

function cardHtml(turn) {
  const p = turn.answer?.proposal;
  if (!p) return '';
  const a = turn.approval || { phase: 'pending' };
  const body = `<div class="as-card-head">${esc(p.preview.title)}</div>${rowsHtml(p.preview.rows)}`;
  if (a.phase === 'approved') return `<div class="as-card done" data-phase="approved">${body}<p class="as-ok">${esc(a.result.text)}</p>${rowsHtml(a.result.rows)}</div>`;
  if (a.phase === 'rejected') return `<div class="as-card" data-phase="rejected">${body}<p class="muted">Cancelled. Nothing was changed.</p></div>`;
  if (a.phase === 'conflict') return `<div class="as-card" data-phase="conflict">${body}<p class="as-bad">This request expired or was already used.</p><button class="btn sm" data-as-again="${turn.id}">Ask again</button></div>`;
  const working = a.phase === 'approving' || a.phase === 'rejecting';
  const gone = expired(p.expiresAt);
  return `<div class="as-card" data-phase="${esc(a.phase)}">${body}
    ${a.phase === 'failed' ? `<p class="as-bad" role="alert">${esc(a.message)}</p>` : ''}
    <div class="as-actions">
      <button class="btn p sm" data-as-approve="${turn.id}" ${gone || working ? 'disabled' : ''}>${a.phase === 'approving' ? 'Approving…' : 'Approve'}</button>
      <button class="btn sm" data-as-reject="${turn.id}" ${gone || working ? 'disabled' : ''}>${a.phase === 'rejecting' ? 'Cancelling…' : 'Cancel'}</button>
      <span class="as-expiry ${gone ? 'as-bad' : 'muted'}">${gone ? 'Expired' : `expires in ${minutesLeft(p.expiresAt)} min`}</span>
    </div></div>`;
}

function turnHtml(turn, labelOf) {
  const you = `<div class="as-you"><span>You</span>${esc(turn.text)}</div>`;
  if (turn.status === 'pending') return `<li class="as-turn">${you}<div class="as-ans muted">${turn.model ? `Asking ${esc(labelOf(turn.model))}…` : 'Thinking…'}</div></li>`;
  if (turn.status === 'failed') return `<li class="as-turn">${you}<div class="as-ans as-bad" role="alert">${esc(turn.error)}</div></li>`;
  const a = turn.answer;
  const via = a.via ? `<div class="as-via muted small">via ${esc(labelOf(a.via))}</div>` : '';
  return `<li class="as-turn">${you}<div class="as-ans">${esc(a.text)}${a.proposal ? '' : rowsHtml(a.rows)}${cardHtml(turn)}${via}</div></li>`;
}

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

/**
 * Mounts the panel. `ctx`: { api(path, opts), toast(msg), project(): current project id, changed(kind): refresh
 * 'jobs' | 'sequences' | 'brand' after an approved write, review: boolean }. Returns { toggle, refreshScope }.
 */
export function mountAssistant(ctx) {
  const panel = document.getElementById('assistant');
  const toggleBtn = document.getElementById('assistant-toggle');
  if (!panel || !toggleBtn) return null;
  if (ctx.review) { toggleBtn.hidden = true; panel.hidden = true; return null; }

  const st = { open: false, caps: null, suggested: null, suggestedFor: null, turns: [], busy: false, seq: 0, tick: null, model: '', listening: null };
  try { st.open = sessionStorage.getItem(STORE_KEY) === '1'; st.model = localStorage.getItem(MODEL_KEY) ?? ''; } catch { /* no storage */ }

  const $ = (sel) => panel.querySelector(sel);
  const transcript = () => $('#as-transcript');
  const input = () => $('#as-input');
  const labelOf = (id) => st.caps?.models?.find((m) => m.id === id)?.label || id;

  function emptyHtml(project) {
    const sug = st.suggestedFor === project ? st.suggested : null;
    const pills = !sug
      ? Array.from({ length: SKELETONS }, () => '<div class="as-skel" aria-hidden="true"></div>').join('')
      : sug.error ? `<p class="muted small">${esc(sug.error)}</p>`
        : sug.suggestions.map((s) => `<button class="as-pill" data-as-ask="${esc(s.ask)}">${esc(s.text)}</button>`).join('');
    return `<div class="as-empty">
      <div class="as-empty-title">Assistant</div>
      <p class="muted">Answers come from this project's files.<br>Ask in your own words.</p>
      <div class="as-chips" ${!sug ? 'aria-busy="true"' : ''}>${pills}</div>
    </div>`;
  }

  function render() {
    document.body.classList.toggle('with-assistant', st.open);
    panel.hidden = !st.open;
    toggleBtn.setAttribute('aria-pressed', String(st.open));
    toggleBtn.classList.toggle('on', st.open);
    if (!st.open) return;
    const project = ctx.project();
    $('#as-scope').textContent = st.suggested?.scope?.label || project || '';
    const box = transcript();
    if (!st.turns.length) box.innerHTML = emptyHtml(project);
    else {
      box.innerHTML = `<ul class="as-turns" role="log" aria-live="polite">${st.turns.map((t) => turnHtml(t, labelOf)).join('')}</ul>`;
      box.scrollTop = box.scrollHeight;
    }
    renderSend();
    $('#as-clear').hidden = !st.turns.length;
    panel.setAttribute('aria-busy', String(st.busy));
    const pending = st.turns.some((t) => t.answer?.proposal && (!t.approval || t.approval.phase === 'pending' || t.approval.phase === 'failed'));
    clearInterval(st.tick); st.tick = null;
    if (pending) st.tick = setInterval(render, TICK_MS);
  }

  function renderSend() { $('#as-send').disabled = st.busy || !input().value.trim(); }

  function renderModels() {
    const sel = $('#as-model');
    const models = st.caps?.models || [];
    const groups = [...new Set(models.map((m) => m.providerLabel))];
    sel.innerHTML = [`<option value="">Commands only</option>`, ...groups.map((g) => `<optgroup label="${esc(g)}">${models.filter((m) => m.providerLabel === g)
      .map((m) => `<option value="${esc(m.id)}" ${m.hasKey ? '' : 'disabled'}>${esc(m.label)}${m.hasKey ? '' : ' (no key)'}</option>`).join('')}</optgroup>`)].join('');
    const ready = models.filter((m) => m.hasKey);
    if (!ready.some((m) => m.id === st.model)) st.model = ready.length && !stored() ? ready[0].id : '';
    sel.value = st.model;
    sel.title = !models.length ? 'No model picked for the Assistant yet (Settings → Assistant)' : !ready.length ? 'Add a key for these providers in Settings' : 'A line the commands do not know goes once to this model, which only names what you meant';
  }
  const stored = () => { try { return localStorage.getItem(MODEL_KEY) !== null; } catch { return false; } };

  async function loadSuggestions() {
    const project = ctx.project();
    if (!project) return;
    st.suggestedFor = project; st.suggested = null;
    try { st.suggested = await ctx.api(`/assistant/suggestions?project=${encodeURIComponent(project)}`); }
    catch (e) { st.suggested = { error: 'Suggestions are not available right now. You can still type a command.', suggestions: [] }; }
    if (st.suggestedFor === project) render();
  }

  async function loadCaps() {
    try { st.caps = await ctx.api('/assistant/capabilities'); } catch { st.caps = null; }
    renderModels();
  }

  async function send(text) {
    const project = ctx.project();
    const t = String(text || '').trim();
    if (!t || st.busy || !project) return;
    const turn = { id: ++st.seq, text: t, status: 'pending', model: st.model || null };
    st.turns.push(turn); st.busy = true; render();
    try {
      turn.answer = await ctx.api('/assistant/ask', { method: 'POST', body: { project, text: t, ...(st.model ? { model: st.model } : {}) } });
      turn.status = 'answered';
    } catch (e) { turn.status = 'failed'; turn.error = e.message; }
    st.busy = false; render();
  }

  async function approve(turn) {
    const p = turn.answer?.proposal;
    if (!p) return;
    turn.approval = { phase: 'approving' }; render();
    try {
      const result = await ctx.api(`/assistant/approvals/${encodeURIComponent(p.id)}/approve`, { method: 'POST' });
      turn.approval = { phase: 'approved', result };
      ctx.toast(result.text);
      ctx.changed(result.changed);
    } catch (e) {
      turn.approval = e.status === 409 && /expired|already used/i.test(e.message) ? { phase: 'conflict' } : { phase: 'failed', message: e.message };
    }
    render();
  }

  async function reject(turn) {
    const p = turn.answer?.proposal;
    if (!p) return;
    turn.approval = { phase: 'rejecting' }; render();
    try { await ctx.api(`/assistant/approvals/${encodeURIComponent(p.id)}/reject`, { method: 'POST' }); turn.approval = { phase: 'rejected' }; }
    catch (e) { turn.approval = { phase: 'failed', message: e.message }; }
    render();
  }

  const turnOf = (el) => st.turns.find((t) => t.id === Number(el.dataset.asApprove || el.dataset.asReject || el.dataset.asAgain));

  function grow() {
    const el = input();
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  /** The browser's own speech recognition (Chrome, Edge); the button is hidden where there is none. */
  function listen() {
    const btn = $('#as-mic');
    if (st.listening) { st.listening.stop(); return; }
    const rec = new Recognition();
    rec.lang = document.documentElement.lang || navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const base = input().value;
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      input().value = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${said}`;
      grow(); renderSend();
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') ctx.toast(`Speech input failed: ${e.error}`); };
    rec.onend = () => { st.listening = null; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); input().focus(); };
    st.listening = rec;
    btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
    rec.start();
  }

  panel.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-as-ask]');
    if (chip) {
      const ask = chip.dataset.asAsk;
      if (ask.endsWith(' ')) { input().value = ask; grow(); renderSend(); input().focus(); } else send(ask);
      return;
    }
    const b = e.target.closest('[data-as-approve], [data-as-reject], [data-as-again]');
    if (!b) return;
    const turn = turnOf(b);
    if (!turn) return;
    if (b.dataset.asApprove) approve(turn);
    else if (b.dataset.asReject) reject(turn);
    else send(turn.text);
  });
  $('#as-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const el = input();
    const text = el.value;
    el.value = ''; grow(); renderSend();
    send(text);
  });
  input().addEventListener('input', () => { grow(); renderSend(); });
  input().addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#as-form').requestSubmit(); }
  });
  $('#as-model').addEventListener('change', (e) => {
    st.model = e.target.value;
    try { localStorage.setItem(MODEL_KEY, st.model); } catch { /* no storage */ }
  });
  $('#as-help').addEventListener('click', () => send('/help'));
  const mic = $('#as-mic');
  if (Recognition) { mic.hidden = false; mic.addEventListener('click', listen); }
  $('#as-clear').addEventListener('click', () => { st.turns = []; render(); loadSuggestions(); });
  $('#as-close').addEventListener('click', () => { toggle(); toggleBtn.focus(); });

  function toggle() {
    st.open = !st.open;
    try { sessionStorage.setItem(STORE_KEY, st.open ? '1' : '0'); } catch { /* no storage */ }
    render();
    if (st.open) { if (!st.caps) loadCaps(); if (!st.turns.length) loadSuggestions(); input().focus(); }
  }
  toggleBtn.addEventListener('click', toggle);

  render();
  if (st.open) { loadCaps(); loadSuggestions(); }
  return {
    toggle,
    /** Settings changed a key or the model list: fetch the composer's choices again. */
    reloadModels() { loadCaps(); },
    /** The project changed: the transcript belongs to the old one, so it is cleared. */
    refreshScope() { st.turns = []; st.suggested = null; render(); if (st.open) loadSuggestions(); },
  };
}
