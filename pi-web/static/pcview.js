// ============ PC STATUS VIEW ============
let pcViewInterval = null;

function renderPcView() {
  fetchAndRenderMetrics();
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
