// ============ PC STATUS VIEW ============
let pcViewInterval = null;

function renderPcView() {
  fetchAndRenderMetrics();
  void renderPcQuotas();
  clearInterval(pcViewInterval);
  pcViewInterval = setInterval(() => {
    if (!document.querySelector('.view[data-view="pc"].active')) { clearInterval(pcViewInterval); return; }
    fetchAndRenderMetrics();
  }, 2000);
}

async function fetchAndRenderMetrics() {
  const status = await api('GET', '/api/status').catch(() => ({ pc_online: false }));
  document.getElementById('pcSubHeader').textContent = status.pc_online ? 'PC en ligne' : 'PC injoignable';
  if (!status.pc_online) return;
  const m = await api('GET', '/api/metrics').catch(() => null);
  if (!m) return;

  document.getElementById('pcCpuVal').textContent = m.cpu;
  document.getElementById('pcRamVal').textContent = `${m.mem_percent}% · ${(m.mem_used_mb / 1024).toFixed(1)}/${(m.mem_total_mb / 1024).toFixed(1)} GB`;
  document.getElementById('pcRamBar').style.width = m.mem_percent + '%';
  document.getElementById('pcTempVal').textContent = m.cpu_temp || '—';
  document.getElementById('pcDiskVal').textContent = `${m.disk_used_gb}/${m.disk_total_gb} GB`;
  const diskPct = m.disk_total_gb ? (m.disk_used_gb / m.disk_total_gb * 100) : 0;
  document.getElementById('pcDiskBar').style.width = diskPct + '%';

  document.getElementById('pcGpuUtil').textContent = m.gpu_util;
  document.getElementById('pcGpuMem').textContent = `${m.gpu_mem_used_mb}/${m.gpu_mem_total_mb} MB`;
  document.getElementById('pcGpuTemp').textContent = m.gpu_temp ? m.gpu_temp + ' °C' : '—';

  document.getElementById('netUp').textContent = m.net_up_kb;
  document.getElementById('netDown').textContent = m.net_down_kb;
}

document.getElementById('refreshPc').addEventListener('click', () => { fetchAndRenderMetrics(); showToast('Données actualisées', 'ok'); });

/**
 * Quotas par compte, sur la page « État du système ».
 *
 * ☠ Réutilise `hAccGaugeMini` plutôt que d'écrire un second rendu : deux
 * représentations d'une même mesure divergent toujours, et c'est sur ces
 * pourcentages qu'on décide de lancer ou non une équipe.
 */
async function renderPcQuotas() {
  const el = document.getElementById('pcQuotas');
  if (!el || typeof hListeComptes !== 'function') return;
  const comptes = hListeComptes(await HarnessAPI.getAccounts());
  if (comptes === null) {
    el.innerHTML = '<div class="rounded-xl border p-4 text-[12.5px]" style="border-color:var(--line);background:var(--card);color:var(--ink-3);">Pi injoignable — quotas indisponibles.</div>';
    return;
  }
  if (comptes.length === 0) {
    el.innerHTML = '<div class="rounded-xl border p-4 text-[12.5px]" style="border-color:var(--line);background:var(--card);color:var(--ink-3);">Aucun compte enregistré dans le registre.</div>';
    return;
  }
  el.innerHTML = `<div class="rounded-xl border p-4" style="border-color: var(--line); background: var(--card);">
      <div class="text-[10.5px] uppercase tracking-wider mb-3" style="color: var(--ink-3);">Quotas par compte (H-72)</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${comptes.map(hAccGaugeMini).join('')}</div>
    </div>`;
}
