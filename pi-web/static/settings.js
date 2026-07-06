// ============ SETTINGS ============
function applySwitch(id, key) {
  const el = document.getElementById(id);
  el.classList.toggle('on', !!prefs[key]);
  el.addEventListener('click', () => { prefs[key] = !prefs[key]; el.classList.toggle('on', prefs[key]); savePrefs(); });
}
applySwitch('setting-confirm', 'confirm');
applySwitch('setting-think', 'think');
applySwitch('setting-verbose', 'verbose');

document.getElementById('resetBtn').addEventListener('click', () => {
  confirmAction('Réinitialiser ccremote', 'Efface la conversation, l\'historique et les préférences locales. Irréversible.', () => {
    localStorage.removeItem('ccr_prefs');
    localStorage.removeItem('ccr_history');
    location.reload();
  }, { danger: true });
});

function setModel(model) {
  prefs.model = model;
  savePrefs();
  document.getElementById('headerModel').textContent = model;
  document.querySelectorAll('.model-select').forEach(sel => { if (sel.value !== model) sel.value = model; });
}

function populateModelSelect(select, models, current) {
  select.classList.add('model-select');
  select.innerHTML = models.map(m => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`).join('');
  select.addEventListener('change', () => setModel(select.value));
}

async function loadConfig() {
  const cfg = await api('GET', '/api/config').catch(() => null);
  if (!cfg) return;
  state.config = cfg;
  if (!prefs.model || !cfg.models.includes(prefs.model)) { prefs.model = cfg.default_model; savePrefs(); }

  document.getElementById('pcHostLabel').textContent = cfg.pc_host;
  document.getElementById('headerHost').textContent = cfg.pc_host;
  document.getElementById('setHost').textContent = cfg.pc_host;
  document.getElementById('setMac').textContent = cfg.pc_mac;
  document.getElementById('headerModel').textContent = prefs.model;

  populateModelSelect(document.getElementById('modelSelect'), cfg.models, prefs.model);
  populateModelSelect(document.getElementById('modelBadge'), cfg.models, prefs.model);
}

// ============ COMPTE CLAUDE CODE ============
async function renderClaudeAccounts() {
  const el = document.getElementById('claudeAccounts');
  if (!el) return;
  el.innerHTML = `<div class="text-[12px]" style="color: var(--ink-3);">Chargement…</div>`;
  const data = await api('GET', '/api/claude-accounts').catch(() => null);
  if (!data || data.status !== 'ok') {
    el.innerHTML = `<div class="text-[12px]" style="color: var(--ink-3);">PC injoignable — impossible de lire les comptes.</div>`;
    return;
  }
  el.innerHTML = data.accounts.map(a => `
    <div class="flex items-center justify-between p-3 rounded-lg" style="background: var(--bg-2);">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full" style="background: ${a.active ? 'var(--ok)' : 'var(--line-2)'};"></span>
        <span class="text-[13px] mono" style="color: var(--ink);">${escapeHtml(a.label)}</span>
        ${a.active ? '<span class="badge" style="background: var(--ok-soft); color: var(--ok);">actif</span>' : ''}
      </div>
      ${a.active ? '' : `<button class="btn-ghost rounded-lg px-3 py-1.5 text-[11.5px] font-medium switch-account-btn" data-id="${a.id}">Activer</button>`}
    </div>`).join('');
  el.querySelectorAll('.switch-account-btn').forEach(btn => btn.addEventListener('click', () => {
    confirmAction(
      'Changer de compte Claude Code',
      'Les sessions tmux en cours vont être redémarrées pour charger le nouveau compte. Continuer ?',
      () => switchClaudeAccount(btn.dataset.id),
      { danger: true }
    );
  }));
}

async function switchClaudeAccount(id) {
  try {
    const resp = await api('POST', '/api/claude-accounts/switch', { account: id });
    if (resp.status === 'ok') {
      showToast('Compte changé — sessions redémarrées', 'ok');
      addHistory('session', 'Compte Claude Code changé', id);
    } else {
      showToast('Échec du changement de compte : ' + (resp.message || resp.status), 'err');
    }
  } catch (e) {
    showToast('Échec du changement de compte : ' + e.message, 'err');
  }
  renderClaudeAccounts();
  renderSessions();
  renderPanelSessions();
}

// ============ INIT ============
loadConfig();
renderClaudeAccounts();
renderPanelSessions();
fetchSessions().then(renderPanelSessions).catch(() => {});
