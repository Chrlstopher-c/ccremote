// ============ SIDEBAR / PC STATUS ============
/**
 * ☠ Chaque accès est GARDÉ. La carte CPU/RAM de la barre latérale a été retirée
 * (ses chiffres vivent dans « État du système »), et ces identifiants n'existent
 * plus. Sans garde, `dot.innerHTML` lève une TypeError à chaque sondage — soit
 * toutes les cinq secondes, en silence dans la console, avec pour effet de
 * couper la mise à jour de TOUT ce qui suit dans la fonction.
 */
function setPcOnline(online) {
  state.pcOnline = online;
  const dot = document.getElementById('pcStatusDot');
  const text = document.getElementById('pcStatusText');
  if (dot) {
    dot.innerHTML = online === null
      ? '<span class="w-2 h-2 rounded-full" style="background: var(--ink-3);"></span>'
      : online
        ? '<span class="w-2 h-2 rounded-full dot-live" style="background: var(--ok);"></span><span class="absolute w-2 h-2 rounded-full ripple" style="background: var(--ok);"></span>'
        : '<span class="w-2 h-2 rounded-full" style="background: var(--err);"></span>';
  }
  if (text) {
    text.textContent = online === null ? 'Vérification…' : online ? 'PC en ligne' : 'PC éteint';
    text.style.color = online ? 'var(--ink)' : 'var(--ink-3)';
  }
  const nsEl = document.getElementById('nsPcStatus');
  if (nsEl) {
    if (online) { nsEl.style.background = 'var(--ok-soft)'; nsEl.style.color = 'var(--ok)'; nsEl.textContent = 'PC en ligne'; }
    else { nsEl.style.background = 'var(--err-soft)'; nsEl.style.color = 'var(--err)'; nsEl.textContent = 'PC éteint'; }
  }
}

function formatUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function pollSidebar() {
  try {
    const status = await api('GET', '/api/status');
    setPcOnline(status.pc_online);
    if (!status.pc_online) return;
    const m = await api('GET', '/api/metrics');
    const poser = (id, appliquer) => { const el = document.getElementById(id); if (el) appliquer(el); };
    poser('cpuBar', (el) => { el.style.width = m.cpu + '%'; });
    poser('cpuVal', (el) => { el.textContent = m.cpu + '%'; });
    poser('ramBar', (el) => { el.style.width = m.mem_percent + '%'; });
    poser('ramVal', (el) => { el.textContent = m.mem_percent + '%'; });
    poser('uptimeText', (el) => { el.textContent = 'Uptime · ' + formatUptime(m.uptime_s); });
  } catch { setPcOnline(null); }
}

document.getElementById('wakeBtn').addEventListener('click', () => {
  if (state.pcOnline) { showToast('Le PC est déjà en ligne', 'warn'); return; }
  confirmAction('Réveiller le PC', 'Envoyer un magic packet Wake-on-LAN au PC distant ?', wakePc);
});

async function wakePc() {
  await api('POST', '/api/wake');
  showToast('Magic packet envoyé', 'accent');
  addHistory('wake', 'PC réveillé via Wake-on-LAN', 'Magic packet envoyé');
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const status = await api('GET', '/api/status').catch(() => ({ pc_online: false }));
    if (status.pc_online) { setPcOnline(true); showToast('PC en ligne', 'ok'); return; }
  }
}

document.getElementById('shutdownBtn').addEventListener('click', () => {
  if (!state.pcOnline) { showToast('Le PC est déjà éteint', 'warn'); return; }
  confirmAction('Éteindre le PC', 'Le PC va s\'éteindre proprement. Il faudra le réveiller via Wake-on-LAN pour y accéder à nouveau. Continuer ?', shutdownPc, { danger: true });
});

async function shutdownPc() {
  await api('POST', '/api/shutdown');
  showToast('Extinction en cours…', 'warn');
  addHistory('wake', 'PC éteint', 'Arrêt demandé via l\'interface');
  setPcOnline(false);
}

setInterval(pollSidebar, 4000);
pollSidebar();
