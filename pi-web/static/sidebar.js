// ============ SIDEBAR / PC STATUS ============
function setPcOnline(online) {
  state.pcOnline = online;
  const dot = document.getElementById('pcStatusDot');
  const text = document.getElementById('pcStatusText');
  if (online === null) {
    dot.innerHTML = '<span class="w-2 h-2 rounded-full" style="background: var(--ink-3);"></span>';
    text.textContent = 'Vérification…';
    text.style.color = 'var(--ink-3)';
  } else if (online) {
    dot.innerHTML = '<span class="w-2 h-2 rounded-full dot-live" style="background: var(--ok);"></span><span class="absolute w-2 h-2 rounded-full ripple" style="background: var(--ok);"></span>';
    text.textContent = 'PC en ligne';
    text.style.color = 'var(--ink)';
  } else {
    dot.innerHTML = '<span class="w-2 h-2 rounded-full" style="background: var(--err);"></span>';
    text.textContent = 'PC éteint';
    text.style.color = 'var(--ink-3)';
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
    document.getElementById('cpuBar').style.width = m.cpu + '%';
    document.getElementById('cpuVal').textContent = m.cpu + '%';
    document.getElementById('ramBar').style.width = m.mem_percent + '%';
    document.getElementById('ramVal').textContent = m.mem_percent + '%';
    document.getElementById('uptimeText').textContent = 'Uptime · ' + formatUptime(m.uptime_s);
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
