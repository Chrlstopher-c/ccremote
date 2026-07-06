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

// ============ INIT ============
loadConfig();
renderPanelSessions();
fetchSessions().then(renderPanelSessions).catch(() => {});
