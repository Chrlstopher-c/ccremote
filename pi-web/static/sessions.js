// ============ SESSIONS ============
async function fetchSessions() {
  const d = await api('GET', '/api/sessions');
  state.sessions = d.sessions || [];
  document.getElementById('sessionBadge').textContent = state.sessions.length;
  return state.sessions;
}

function timeAgo(createdTs) {
  if (!createdTs) return '';
  const s = Math.floor(Date.now() / 1000) - createdTs;
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}

async function renderSessions() {
  const list = document.getElementById('sessionsList');
  list.innerHTML = `<div class="text-center py-16 text-[13px]" style="color: var(--ink-3);">Chargement…</div>`;
  const sessions = await fetchSessions().catch(() => []);
  if (sessions.length === 0) {
    list.innerHTML = `<div class="text-center py-16"><div class="text-[14px]" style="color: var(--ink-3);">Aucune session active</div><button class="btn-accent rounded-lg px-4 py-2 text-[12.5px] mt-4" onclick="openModal('modalNewSession')">Lancer une session</button></div>`;
    return;
  }
  list.innerHTML = sessions.map(s => `
    <div class="rounded-xl border p-4 lift" data-menu="session" data-name="${escapeHtml(s.name)}" data-k="sess:${escapeHtml(s.name)}" style="border-color: var(--line); background: var(--card);">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2.5">
          <span class="w-2 h-2 rounded-full ${s.attached ? 'dot-live' : ''}" style="background: ${s.attached ? 'var(--ok)' : 'var(--ink-3)'};"></span>
          <span class="text-[14px] font-medium mono" style="color: var(--ink);">${escapeHtml(s.name)}</span>
          <span class="badge" style="background: ${s.attached ? 'var(--ok-soft)' : 'var(--bg-2)'}; color: ${s.attached ? 'var(--ok)' : 'var(--ink-3)'};">${s.attached ? 'Attachée' : 'Détachée'}</span>
        </div>
        <span class="text-[11px]" style="color: var(--ink-3);">${timeAgo(s.created)}</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-accent rounded-lg px-3 py-1.5 text-[11.5px] font-medium open-term" data-name="${escapeHtml(s.name)}">Ouvrir terminal</button>
        <button class="btn-ghost rounded-lg px-3 py-1.5 text-[11.5px] font-medium kill-btn" data-name="${escapeHtml(s.name)}" style="color: var(--err); border-color: var(--err-soft);">Terminer</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.open-term').forEach(b => b.addEventListener('click', () => openTerminal(b.dataset.name)));
  list.querySelectorAll('.kill-btn').forEach(b => b.addEventListener('click', () => killSession(b.dataset.name)));
}

async function killSession(name) {
  confirmAction('Terminer la session', `Voulez-vous vraiment terminer la session ${name} ?`, async () => {
    await api('POST', `/api/kill?session=${encodeURIComponent(name)}`);
    showToast('Session terminée', 'ok');
    addHistory('session', `Session ${name} terminée`, '');
    if (state.activeSession === name) closeTerminal();
    renderSessions();
    renderPanelSessions();
  }, { danger: true });
}

document.getElementById('newSessionBtn').addEventListener('click', openNewSessionModal);
document.getElementById('newSessionBtn2').addEventListener('click', openNewSessionModal);
function openNewSessionModal() { document.getElementById('nsPcStatus').textContent = state.pcOnline ? 'PC en ligne' : 'PC éteint'; openModal('modalNewSession'); }

document.getElementById('nsCreate').addEventListener('click', async () => {
  const name = document.getElementById('nsName').value.trim() || 'claude';
  closeModal('modalNewSession');
  try {
    const resp = await api('POST', `/api/launch?session=${encodeURIComponent(name)}`);
    showToast(`Session ${name} : ${resp.status}`, 'accent');
    addHistory('session', `Session ${name} lancée`, resp.status);
    renderSessions();
    renderPanelSessions();
  } catch (e) { showToast('Échec du lancement : ' + e.message, 'err'); }
});

// ============ RIGHT PANEL + TERMINAL ============
function renderPanelSessions() {
  const list = document.getElementById('panelSessionList');
  if (!list) return;
  list.innerHTML = state.sessions.map(s => {
    const isActive = s.name === state.activeSession;
    return `<div class="rounded-lg p-3 cursor-pointer lift panel-session ${isActive ? 'border-2' : 'border'}" data-name="${escapeHtml(s.name)}" style="background: var(--card); border-color: ${isActive ? 'var(--accent)' : 'var(--line)'};">
      <div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full ${s.attached ? 'dot-live' : ''}" style="background: ${s.attached ? 'var(--ok)' : 'var(--ink-3)'};"></span><span class="text-[12px] font-medium mono" style="color: var(--ink);">${escapeHtml(s.name)}</span></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.panel-session').forEach(el => el.addEventListener('click', () => openTerminal(el.dataset.name)));
}

function openTerminal(name) {
  state.activeSession = name;
  document.getElementById('rightPanel').style.display = 'flex';
  document.getElementById('activeSessionLabel').textContent = name;
  document.getElementById('termLiveBadge').style.display = 'flex';
  renderPanelSessions();
  loadTerminal();
  clearInterval(state.termInterval);
  state.termInterval = setInterval(loadTerminal, 1500);
}

function closeTerminal() {
  clearInterval(state.termInterval);
  state.activeSession = null;
  document.getElementById('rightPanel').style.display = 'none';
}

function stripAnsi(str) { return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, ''); }

async function loadTerminal() {
  if (!state.activeSession) return;
  const d = await api('GET', `/api/capture?session=${encodeURIComponent(state.activeSession)}`).catch(() => null);
  const box = document.getElementById('termOutput');
  if (!d) return;
  const atBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 40;
  box.textContent = stripAnsi(d.output || '');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

document.getElementById('termSend').addEventListener('click', sendTermCommand);
document.getElementById('termInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTermCommand(); });

async function sendTermCommand() {
  const input = document.getElementById('termInput');
  if (!state.activeSession || !input.value.trim()) return;
  await api('POST', `/api/send?session=${encodeURIComponent(state.activeSession)}`, { keys: input.value });
  input.value = '';
  setTimeout(loadTerminal, 300);
}

document.getElementById('togglePanel').addEventListener('click', () => {
  const p = document.getElementById('rightPanel');
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
});
document.getElementById('closePanel').addEventListener('click', closeTerminal);

// ============ RESIZABLE PANEL (desktop) ============
const PANEL_MIN = 280, PANEL_MAX = 640;
const rightPanelEl = document.getElementById('rightPanel');
const resizeHandle = document.getElementById('panelResizeHandle');

const savedWidth = parseInt(localStorage.getItem('ccr_panel_width'), 10);
if (savedWidth >= PANEL_MIN && savedWidth <= PANEL_MAX) rightPanelEl.style.width = savedWidth + 'px';

resizeHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  resizeHandle.classList.add('dragging');
  resizeHandle.setPointerCapture(e.pointerId);
  const startX = e.clientX, startWidth = rightPanelEl.getBoundingClientRect().width;

  function onMove(ev) {
    const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth - (ev.clientX - startX)));
    rightPanelEl.style.width = next + 'px';
  }
  function onUp() {
    resizeHandle.classList.remove('dragging');
    localStorage.setItem('ccr_panel_width', Math.round(rightPanelEl.getBoundingClientRect().width));
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
});
