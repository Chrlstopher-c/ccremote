// ============ STATE ============
const prefs = loadPrefs();
const state = {
  pcOnline: null,
  sessions: [],
  activeSession: null,
  chatHistory: [],
  agentBusy: false,
  config: null,
  termInterval: null,
  currentConvId: null,
  convTitle: null,
};

function loadPrefs() {
  try {
    return { confirm: true, think: false, verbose: false, model: null, ...JSON.parse(localStorage.getItem('ccr_prefs') || '{}') };
  } catch { return { confirm: true, think: false, verbose: false, model: null }; }
}
function savePrefs() { localStorage.setItem('ccr_prefs', JSON.stringify(prefs)); }

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('ccr_history') || '[]'); } catch { return []; }
}
function saveHistory(h) { localStorage.setItem('ccr_history', JSON.stringify(h.slice(0, 200))); }

// ============ API ============
async function api(method, path, body) {
  const opts = { method, headers: {}, credentials: 'include' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return await r.json();
}

// ============ VIEW ROUTER ============
// ☠ Les CONTENEURS de vue portent eux aussi `data-view` (c'est ainsi que
// `switchView` les retrouve). Leur attacher un gestionnaire de clic faisait
// qu'un clic N'IMPORTE OÙ dans une vue remontait jusqu'à elle par propagation
// et la re-rendait entièrement : fil vidé puis reconstruit, animations d'entrée
// rejouées (clignotement) et sélection de texte en cours détruite. Seuls les
// éléments de NAVIGATION doivent déclencher un changement de vue.
document.querySelectorAll('[data-view]').forEach(el => {
  if (el.classList.contains('view')) return;
  el.addEventListener('click', () => { if (el.dataset.view) switchView(el.dataset.view); });
});

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  if (view === 'sessions') renderSessions();
  if (view === 'pc') renderPcView();
  if (view === 'history') renderHistory();
  if (view === 'settings') { renderClaudeAccounts(); refreshQuotaUsage(); refreshContextUsage(); }
  // ---- harness (orchestrateur + équipes) — voir static/harness-*.js ----
  if (view === 'harness-parc') hRenderParc();
  if (view === 'harness-escalades') hRenderEscalades();
  if (view === 'harness-comptes') hRenderComptes();
  if (view === 'harness-orchestrateur') hInitOrchestrateur();
  // ☠ Le parc, les escalades, les comptes et le détail d'une mission se
  // rafraîchissent d'eux-mêmes désormais (voir harness-parc.js) : sans ça, il
  // fallait recharger la page pour voir bouger quoi que ce soit, et une équipe
  // terminée restait affichée « en cours » (23/07).
  if (typeof hDemarrerRafraichissement === 'function') hDemarrerRafraichissement();
  const active = document.querySelector('.view.active');
  if (active) active.scrollTop = 0;
  closeSidebar();
}

// Router unique réutilisé par tout le harness — pas de logique de navigation dupliquée.
function hGoto(view) { switchView(view); }

// ============ MOBILE SIDEBAR ============
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.remove('hidden');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
}
document.querySelectorAll('.sidebarToggle').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); openSidebar(); }));
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

// ============ TOAST ============
function showToast(msg, type = 'ok') {
  const colors = {
    ok: { bg: 'var(--ok-soft)', fg: 'var(--ok)', icon: '<polyline points="20 6 9 17 4 12"/>' },
    err: { bg: 'var(--err-soft)', fg: 'var(--err)', icon: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent-2)', icon: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)', icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' },
  };
  const c = colors[type] || colors.ok;
  const toast = document.createElement('div');
  toast.className = 'msg-in flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 shadow-sm border';
  toast.style.cssText = 'background: var(--card); border-color: var(--line); min-width: 260px;';
  toast.innerHTML = `<div class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style="background: ${c.bg};"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.fg}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg></div><span class="text-[12.5px]" style="color: var(--ink);">${escapeHtml(msg)}</span>`;
  document.getElementById('toasts').appendChild(toast);
  setTimeout(() => { toast.style.transition = 'all 0.3s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3200);
}

// ============ MODAL ============
function openModal(id) { const m = document.getElementById(id); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModal(id) { const m = document.getElementById(id); m.classList.add('hidden'); m.classList.remove('flex'); }
document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[id^="modal"]').forEach(m => { m.classList.add('hidden'); m.classList.remove('flex'); });
}));
document.querySelectorAll('[id^="modal"]').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) { m.classList.add('hidden'); m.classList.remove('flex'); } });
});

function confirmAction(title, msg, onOk, opts = {}) {
  if (!prefs.confirm) { onOk(); return; }
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  const btn = document.getElementById('confirmOk');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.className = opts.danger ? 'btn-danger rounded-lg px-4 py-2 text-[12.5px] font-medium' : 'btn-accent rounded-lg px-4 py-2 text-[12.5px] font-medium';
  newBtn.addEventListener('click', () => { closeModal('modalConfirm'); onOk(); });
  openModal('modalConfirm');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ HISTORY ============
function addHistory(type, title, detail) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const h = loadHistory();
  h.unshift({ type, title, detail, time });
  saveHistory(h);
}

function renderHistory() {
  const container = document.getElementById('historyTimeline');
  const h = loadHistory();
  if (h.length === 0) {
    container.innerHTML = `<div class="text-center py-16 text-[13px]" style="color: var(--ink-3);">Aucune action pour l'instant</div>`;
    return;
  }
  const icons = {
    wake: { bg: 'var(--accent-soft)', fg: '#D97757', svg: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
    session: { bg: 'var(--bg-2)', fg: 'var(--ink-2)', svg: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>' },
    tool: { bg: 'var(--ok-soft)', fg: 'var(--ok)', svg: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  };
  container.innerHTML = h.map((e, i) => {
    const ic = icons[e.type] || icons.tool;
    return `<div class="hist-item flex gap-3.5 px-3 py-2.5 rounded-lg">
      <div class="shrink-0 flex flex-col items-center">
        <div class="w-8 h-8 rounded-full flex items-center justify-center" style="background: ${ic.bg};"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${ic.fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg></div>
        ${i < h.length - 1 ? `<div class="w-px flex-1 mt-1" style="background: var(--line);"></div>` : ''}
      </div>
      <div class="flex-1 pb-3">
        <div class="flex items-center justify-between"><span class="text-[13px] font-medium" style="color: var(--ink);">${escapeHtml(e.title)}</span><span class="text-[11px] mono" style="color: var(--ink-3);">${e.time}</span></div>
        <div class="text-[12px] mt-0.5" style="color: var(--ink-3);">${escapeHtml(e.detail)}</div>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  confirmAction('Effacer l\'historique', 'Supprimer tout l\'historique local ?', () => { saveHistory([]); renderHistory(); }, { danger: true });
});
