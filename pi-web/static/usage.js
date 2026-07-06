// ============ UTILISATION (contexte + quotas API) ============
const WINDOW_LABELS = { minute: 'minute', hour: 'heure', day: 'jour' };
const KIND_LABELS = { requests: 'Requêtes', tokens: 'Tokens' };

function usageRatioColor(ratio) {
  if (ratio >= 0.9) return 'var(--err)';
  if (ratio >= 0.7) return 'var(--warn)';
  return 'var(--ok)';
}

function formatNum(n) { return new Intl.NumberFormat('fr-FR').format(n); }

function renderContextUsage(usage) {
  if (!usage || usage.tokens_limit == null) return;
  const ratio = Math.min(1, usage.tokens_used / usage.tokens_limit);
  const pct = Math.round(ratio * 100);

  const bar = document.getElementById('ctxUsageBar');
  if (bar) { bar.style.width = `${pct}%`; bar.style.background = usageRatioColor(ratio); }
  const label = document.getElementById('ctxUsageLabel');
  if (label) label.textContent = `${formatNum(usage.tokens_used)} / ${formatNum(usage.tokens_limit)} tokens (${pct}%)`;

  const pill = document.getElementById('headerContextUsage');
  if (pill) {
    pill.textContent = `${pct}% contexte`;
    pill.style.color = ratio >= 0.9 ? 'var(--err)' : ratio >= 0.7 ? 'var(--warn)' : 'var(--ink-3)';
  }
}

function renderQuotaUsage(payload) {
  const quotas = payload && payload.quotas;
  const grid = document.getElementById('quotaGrid');
  if (!grid) return;
  if (!quotas) {
    grid.innerHTML = `<div class="text-[12px]" style="color: var(--ink-3);">Aucun appel effectué depuis le démarrage du serveur.</div>`;
    return;
  }

  const rows = [];
  for (const window of ['minute', 'hour', 'day']) {
    for (const kind of ['requests', 'tokens']) {
      const w = quotas[kind][window];
      if (w.limit == null) continue;
      const ratio = Math.min(1, 1 - w.remaining / w.limit);
      rows.push(`
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-[11px] mono" style="color: var(--ink-3);">${KIND_LABELS[kind]} / ${WINDOW_LABELS[window]}</span>
            <span class="text-[11px] mono" style="color: var(--ink-2);">${formatNum(w.limit - w.remaining)} / ${formatNum(w.limit)}</span>
          </div>
          <div class="usage-track"><div class="usage-fill" style="width: ${Math.round(ratio * 100)}%; background: ${usageRatioColor(ratio)};"></div></div>
        </div>`);
    }
  }
  grid.innerHTML = rows.length
    ? rows.join('')
    : `<div class="text-[12px]" style="color: var(--ink-3);">Aucun appel effectué depuis le démarrage du serveur.</div>`;

  const updatedEl = document.getElementById('quotaUpdatedAt');
  if (updatedEl) {
    if (!payload.updated_at) { updatedEl.textContent = ''; }
    else {
      const secAgo = Math.max(0, Math.round(Date.now() / 1000 - payload.updated_at));
      updatedEl.textContent = secAgo < 60 ? `il y a ${secAgo}s` : `il y a ${Math.round(secAgo / 60)}min`;
    }
  }
}

async function refreshQuotaUsage() {
  const data = await api('GET', '/api/agent/usage').catch(() => null);
  if (data) renderQuotaUsage(data);
}

async function refreshContextUsage() {
  const data = await api('POST', '/api/agent/context-usage', { history: state.chatHistory, model: prefs.model })
    .catch(() => null);
  if (data) renderContextUsage(data);
}

refreshContextUsage();
refreshQuotaUsage();
