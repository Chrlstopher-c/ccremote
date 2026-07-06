// ============ UTILISATION (contexte + quotas API) ============
const WINDOW_LABELS = { minute: 'minute', hour: 'heure', day: 'jour' };
const KIND_LABELS = { requests: 'Requêtes', tokens: 'Tokens' };
const KEY_LABELS = { key1: 'Clé #1', key2: 'Clé #2' };

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

function quotaBarsHtml(quotas) {
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
  return rows.join('');
}

function renderQuotaUsage(payload) {
  const grid = document.getElementById('quotaGrid');
  const byKeyEl = document.getElementById('quotaByKey');
  const countEl = document.getElementById('quotaKeyCount');
  if (!grid) return;

  const keyLabels = payload && payload.keys ? Object.keys(payload.keys) : [];
  if (countEl) countEl.textContent = keyLabels.length > 1 ? `${keyLabels.length} clés` : (keyLabels[0] ? KEY_LABELS[keyLabels[0]] || keyLabels[0] : '');

  const combinedQuotas = payload && payload.combined && payload.combined.quotas;
  const bars = combinedQuotas ? quotaBarsHtml(combinedQuotas) : '';
  grid.innerHTML = bars || `<div class="text-[12px]" style="color: var(--ink-3);">Aucun appel effectué depuis le démarrage du serveur.</div>`;

  if (byKeyEl) {
    byKeyEl.innerHTML = keyLabels.map(label => {
      const info = payload.keys[label];
      const active = label === payload.active_key;
      const w = info.quotas.requests.minute;
      const detail = w.limit == null
        ? 'aucun appel encore'
        : `${formatNum(w.limit - w.remaining)} / ${formatNum(w.limit)} req/min`;
      return `
        <div class="flex items-center justify-between px-3 py-2 rounded-lg text-[12px]" style="background: var(--bg-2);">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full" style="background: ${active ? 'var(--ok)' : 'var(--line-2)'};"></span>
            <span style="color: var(--ink);">${KEY_LABELS[label] || label}</span>
            ${active ? '<span class="badge" style="background: var(--ok-soft); color: var(--ok);">active</span>' : ''}
          </div>
          <span class="mono" style="color: var(--ink-3);">${detail}</span>
        </div>`;
    }).join('') || `<div class="text-[12px]" style="color: var(--ink-3);">Aucune clé configurée.</div>`;
  }

  const updatedEl = document.getElementById('quotaUpdatedAt');
  if (updatedEl) {
    const updatedAt = payload && payload.combined && payload.combined.updated_at;
    if (!updatedAt) { updatedEl.textContent = ''; }
    else {
      const secAgo = Math.max(0, Math.round(Date.now() / 1000 - updatedAt));
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
