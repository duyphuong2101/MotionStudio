// The Settings tab: one card per provider (its key, Connect for its model list, the models the Assistant may use)
// and the models each use takes (Director, Generate, Assistant). A key goes to the server and never comes back: the
// field is never filled, and the server answers with whether a key is set and where it comes from. Not on the
// review link.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const MAX_LISTED = 80;

const SOURCE = { file: 'Saved in .env', environment: 'Set in your environment (it wins over .env)' };

function badge(p) {
  if (!p.api) return '<span class="st-badge ok">Uses this computer\'s Claude Code login</span>';
  if (!p.hasKey) return '<span class="st-badge">No key</span>';
  if (p.connected?.models?.length) return `<span class="st-badge ok">Connected · ${p.connected.models.length} models</span>`;
  return '<span class="st-badge warn">Key set · not connected</span>';
}

function modelList(p, s, filter) {
  const list = p.connected?.models || [];
  if (!list.length) return p.hasKey ? '<p class="muted small">Click Connect to list the models this key can use.</p>' : '';
  const chosen = new Set(s.assistant.models);
  const f = (filter || '').toLowerCase();
  const shown = list.filter((m) => !f || m.id.toLowerCase().includes(f) || m.label.toLowerCase().includes(f));
  return `<div class="st-models">
    <div class="st-models-head"><span class="small muted">Use in the Assistant</span>
      <input class="st-filter" type="search" placeholder="Filter ${list.length} models" value="${esc(filter || '')}" data-st-filter="${esc(p.id)}" aria-label="Filter ${esc(p.label)} models"></div>
    <ul>${shown.slice(0, MAX_LISTED).map((m) => {
      const ref = `${p.id}:${m.id}`;
      return `<li><label><input type="checkbox" data-st-use="${esc(ref)}" ${chosen.has(ref) ? 'checked' : ''}> <span>${esc(m.label)}</span>${m.label !== m.id ? ` <code>${esc(m.id)}</code>` : ''}</label></li>`;
    }).join('')}</ul>
    ${shown.length > MAX_LISTED ? `<p class="muted small">${shown.length - MAX_LISTED} more: type to filter.</p>` : ''}
  </div>`;
}

function providerCard(p, s, ui) {
  if (!p.api) {
    return `<article class="st-card"><header><h3>${esc(p.label)}</h3>${badge(p)}</header>
      <p class="muted small">Runs the Director with Claude Code on this computer's login. No key and nothing to connect here; the Assistant never uses the seat.</p></article>`;
  }
  const env = p.source === 'environment';
  const busy = ui.busy === p.id;
  return `<article class="st-card" data-provider="${esc(p.id)}"><header><h3>${esc(p.label)}</h3>${badge(p)}</header>
    ${p.note ? `<p class="muted small">${esc(p.note)}</p>` : ''}
    <form class="st-key" data-st-key="${esc(p.keyEnv)}" autocomplete="off">
      <label class="small" for="st-key-${esc(p.id)}"><code>${esc(p.keyEnv)}</code> ${p.hasKey ? `· ${esc(SOURCE[p.source] || 'set')}` : ''}</label>
      ${env ? '' : `<div class="st-row">
        <input id="st-key-${esc(p.id)}" type="password" autocomplete="new-password" spellcheck="false" placeholder="${p.hasKey ? 'Paste a new key to replace it' : 'Paste your API key'}">
        <button class="btn sm p" type="submit">Save key</button>
        ${p.source === 'file' ? `<button class="btn sm" type="button" data-st-remove="${esc(p.keyEnv)}">Remove</button>` : ''}
      </div>`}
    </form>
    <div class="st-row">
      <button class="btn sm" type="button" data-st-connect="${esc(p.id)}" ${p.hasKey && !busy ? '' : 'disabled'}>${busy ? 'Connecting…' : p.connected ? 'Connect again' : 'Connect'}</button>
      <span class="muted small">${p.connected?.fetchedAt ? `Model list fetched ${esc(when(p.connected.fetchedAt))}` : 'One request for the model list; no model runs.'}</span>
    </div>
    ${modelList(p, s, ui.filters[p.id])}
  </article>`;
}

const options = (list, value, empty) => [
  ...(empty ? [`<option value="">${esc(empty)}</option>`] : []),
  ...(value && !list.some((m) => m.id === value) ? [`<option value="${esc(value)}" selected>${esc(value)}</option>`] : []),
  ...list.map((m) => `<option value="${esc(m.id)}" ${m.id === value ? 'selected' : ''}>${esc(m.label)}</option>`),
].join('');

function directorCard(s) {
  const d = s.director;
  const api = s.providers.filter((p) => p.api);
  const sel = api.find((p) => p.id === d.default);
  const list = sel?.connected?.models || [];
  const field = (name, value) => (list.length
    ? `<select id="st-dir-${name}">${options(list, value, name === 'strongModel' ? 'Same as the model' : 'Pick a model')}</select>`
    : `<input id="st-dir-${name}" value="${esc(value)}" placeholder="Connect ${esc(sel?.label || 'the provider')} to pick from its list">`);
  return `<article class="st-card"><header><h3>Director</h3></header>
    <form id="st-director">
      <div class="f"><label for="st-dir-default">Writes the script</label><select id="st-dir-default">
        <option value="seat" ${d.default === 'seat' ? 'selected' : ''}>Claude seat</option>
        ${api.map((p) => `<option value="${esc(p.id)}" ${p.id === d.default ? 'selected' : ''}>${esc(p.label)}${p.hasKey ? '' : ' (no key)'}</option>`).join('')}
      </select></div>
      ${d.default === 'seat'
        ? `<div class="f"><label for="st-dir-seat">Model</label><select id="st-dir-seat">${options(d.seatModels, d.seatModel)}</select></div>`
        : `<div class="f"><label for="st-dir-model">Model</label>${field('model', sel?.model || '')}</div>
           <div class="f"><label for="st-dir-strongModel">Model for hard jobs</label>${field('strongModel', sel?.strongModel || '')}</div>
           <label class="small"><input type="checkbox" id="st-dir-vision" ${sel?.vision ? 'checked' : ''}> The model reads pictures</label>`}
      <div class="st-row"><button class="btn sm p" type="submit">Save</button><span class="muted small">Used from the next Run Director.</span></div>
    </form></article>`;
}

function generateCard(s) {
  const g = s.generate;
  return `<article class="st-card"><header><h3>Generate (Brand tab)</h3></header>
    <form id="st-generate">
      <div class="f"><label for="st-gen-image">Image model</label><select id="st-gen-image">${options(g.image, g.defaults.image)}</select></div>
      <div class="f"><label for="st-gen-video">Clip model</label><select id="st-gen-video">${options(g.video, g.defaults.video)}</select></div>
      <div class="st-row"><button class="btn sm p" type="submit">Save</button><span class="muted small">${g.fetchedAt ? `From the Gemini list fetched ${esc(when(g.fetchedAt))}` : 'Connect Gemini to list its image and clip models.'}</span></div>
    </form></article>`;
}

function assistantCard(s) {
  const a = s.assistant;
  const label = (ref) => {
    const [id, ...rest] = ref.split(':');
    const model = rest.join(':');
    const p = s.providers.find((x) => x.id === id);
    const m = p?.connected?.models?.find((x) => x.id === model);
    return `${m?.label || model} · ${p?.label || id}`;
  };
  return `<article class="st-card"><header><h3>Assistant</h3></header>
    <form id="st-assistant">
      <label class="small"><input type="checkbox" id="st-as-freeform" ${a.freeform ? 'checked' : ''}> Let a model read lines the commands do not know</label>
      <div class="f"><span class="small muted">Models in the Assistant's list (tick them in a provider card)</span>
        <ul class="st-chosen">${a.models.length ? a.models.map((r) => `<li><span>${esc(label(r))}</span><button type="button" class="as-icon" data-st-drop="${esc(r)}" aria-label="Remove ${esc(label(r))}">×</button></li>`).join('') : '<li class="muted small">None yet</li>'}</ul></div>
      <div class="f"><label for="st-as-max">Asks per day</label><input id="st-as-max" type="number" min="1" max="2000" step="1" value="${esc(a.maxAsksPerDay)}"> <span class="muted small">${esc(a.usedToday)} used today</span></div>
      <div class="st-row"><button class="btn sm p" type="submit">Save</button><span class="muted small">The model only names what you meant; every change is still a card you approve.</span></div>
    </form></article>`;
}

/**
 * Mounts the Settings tab. `ctx`: { api(path, opts), toast(msg), review: boolean, changed(): after a save (the
 * Director panel and the Assistant reload) }. Renders on `show()`.
 */
export function mountSettings(ctx) {
  const root = document.getElementById('tab-settings');
  const navBtn = document.querySelector('#nav [data-tab="settings"]');
  if (!root) return null;
  if (ctx.review) { if (navBtn) navBtn.hidden = true; return null; }
  const ui = { s: null, busy: null, filters: {}, error: null };

  function render() {
    const s = ui.s;
    if (!s) { root.innerHTML = `<h2>Settings</h2><p class="muted">${ui.error ? esc(ui.error) : 'Loading…'}</p>`; return; }
    root.innerHTML = `<h2>Settings</h2>
      <p class="muted small">Keys stay on this computer, in the gitignored .env next to Motion Studio. A saved key is never shown again. Connect makes one request for a provider's model list (${esc(s.connect.usedToday)} of ${esc(s.connect.maxConnectsPerDay)} today).</p>
      <h3 class="st-sec">Providers</h3>
      <div class="st-grid">${s.providers.map((p) => providerCard(p, s, ui)).join('')}</div>
      <h3 class="st-sec">Models in use</h3>
      <div class="st-grid">${directorCard(s)}${generateCard(s)}${assistantCard(s)}</div>`;
  }

  async function load() {
    try { ui.s = await ctx.api('/settings'); ui.error = null; } catch (e) { ui.error = `Could not load settings: ${e.message}`; }
    render();
  }

  async function act(fn, done) {
    try { const r = await fn(); if (r?.keys) ui.s = r; else await load(); if (done) ctx.toast(done); ctx.changed(); } catch (e) { ctx.toast(e.message); }
    render();
  }

  const saveAssistant = (models, extra = {}) => act(() => ctx.api('/settings/assistant', { method: 'PUT', body: {
    freeform: extra.freeform ?? ui.s.assistant.freeform, models, maxAsksPerDay: extra.maxAsksPerDay ?? ui.s.assistant.maxAsksPerDay,
  } }), extra.done || 'Assistant models saved');

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('[data-st-key]')) {
      const input = f.querySelector('input[type=password]');
      const value = input.value;
      input.value = '';
      if (!value.trim()) { ctx.toast('Paste a key first'); return; }
      act(() => ctx.api(`/settings/keys/${encodeURIComponent(f.dataset.stKey)}`, { method: 'PUT', body: { value } }), `${f.dataset.stKey} saved. Click Connect to list its models.`);
    } else if (f.id === 'st-director') {
      const def = root.querySelector('#st-dir-default').value;
      if (def === 'seat' && ui.s.director.default === 'seat') {
        act(() => ctx.api('/director/model', { method: 'PUT', body: { model: root.querySelector('#st-dir-seat').value } }), 'Director model saved');
      } else if (def === 'seat') {
        act(() => ctx.api('/director/provider', { method: 'PUT', body: { default: 'seat' } }), 'Director: Claude seat');
      } else if (def !== ui.s.director.default) {
        act(() => ctx.api('/director/provider', { method: 'PUT', body: { default: def } }), 'Director provider saved. Pick its models next.');
      } else {
        const v = (id) => root.querySelector(id)?.value.trim() ?? '';
        act(() => ctx.api('/director/provider', { method: 'PUT', body: { default: def, model: v('#st-dir-model'), strongModel: v('#st-dir-strongModel'), vision: root.querySelector('#st-dir-vision').checked } }), 'Director models saved');
      }
    } else if (f.id === 'st-generate') {
      act(() => ctx.api('/generate/models', { method: 'PUT', body: { image: root.querySelector('#st-gen-image').value, video: root.querySelector('#st-gen-video').value } }), 'Generate models saved');
    } else if (f.id === 'st-assistant') {
      saveAssistant(ui.s.assistant.models, { freeform: root.querySelector('#st-as-freeform').checked, maxAsksPerDay: Number(root.querySelector('#st-as-max').value), done: 'Assistant saved' });
    }
  });

  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-st-remove]');
    if (rm) {
      if (!window.confirm(`Remove ${rm.dataset.stRemove} from .env? Features that use it stop until you add a key again.`)) return;
      act(() => ctx.api(`/settings/keys/${encodeURIComponent(rm.dataset.stRemove)}`, { method: 'DELETE' }), `${rm.dataset.stRemove} removed`);
      return;
    }
    const c = e.target.closest('[data-st-connect]');
    if (c) {
      ui.busy = c.dataset.stConnect; render();
      act(() => ctx.api(`/settings/providers/${encodeURIComponent(ui.busy)}/connect`, { method: 'POST' }), 'Connected').finally(() => { ui.busy = null; render(); });
      return;
    }
    const drop = e.target.closest('[data-st-drop]');
    if (drop) saveAssistant(ui.s.assistant.models.filter((r) => r !== drop.dataset.stDrop));
  });

  root.addEventListener('change', (e) => {
    const use = e.target.closest('[data-st-use]');
    if (use) {
      const ref = use.dataset.stUse;
      const now = ui.s.assistant.models.filter((r) => r !== ref);
      saveAssistant(use.checked ? [...now, ref] : now);
    } else if (e.target.id === 'st-dir-default') {
      // Switching the Director's writer saves at once, so its model fields show that provider's list.
      root.querySelector('#st-director').requestSubmit();
    }
  });

  root.addEventListener('input', (e) => {
    const f = e.target.closest('[data-st-filter]');
    if (!f) return;
    ui.filters[f.dataset.stFilter] = f.value;
    const pos = f.selectionStart;
    render();
    const again = root.querySelector(`[data-st-filter="${CSS.escape(f.dataset.stFilter)}"]`);
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  return { show: load };
}
