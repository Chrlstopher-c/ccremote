// ============ HARNESS — vue Escalades ============
// Ce qui arrive ici a franchi le plancher de déni (H-40/H-64) — le lead
// arbitre seul tout le reste, qui se lit dans le fil de chaque mission.

let hDenyTargetId = null;

async function hRenderEscalades() {
  const res = await HarnessAPI.getEscalades();
  const escalades = res.data || [];
  document.getElementById('hEscSub').textContent = `${escalades.length} demande${escalades.length > 1 ? 's' : ''} en attente · les demandes n'expirent jamais`;
  const online = HarnessAPI._isPcOnline();

  if (!escalades.length) {
    document.getElementById('hEscList').innerHTML = hPcAbsentBanner('les escalades') + `<div class="empty-state card">
      <div class="t">Aucune escalade en attente</div>
      <div class="s">Le lead arbitre seul tout ce qui reste sous le plancher de déni.</div>
    </div>`;
    return;
  }
  document.getElementById('hEscList').innerHTML = hPcAbsentBanner('les escalades') + escalades.map((e) => `
    <div class="card esc msg-in">
      <div class="h">
        <div style="min-width:0;">
          <div style="font-size:13px;font-weight:600;">${escapeHtml(e.title)}</div>
          <div class="mono" style="font-size:10.5px;color:var(--ink-3);margin-top:3px;">${escapeHtml(e.sub)}</div>
        </div>
        <span class="age ${e.old ? 'old' : ''}">${escapeHtml(e.age)}</span>
      </div>
      <div class="tool">${escapeHtml(e.tool)}</div>
      <div class="phrase">${escapeHtml(e.phrase)}</div>
      <div class="why"><strong>Raison de déclenchement</strong> — ${escapeHtml(e.why)}</div>
      ${e.path ? `<div class="path">${escapeHtml(e.path)}</div>` : ''}
      ${e.suggestions && e.suggestions.length ? `<div style="margin-top:9px;font-size:11.5px;color:var(--ink-3);">Suggestions du SDK : ${e.suggestions.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join(' ')}</div>` : ''}
      <div class="acts">
        <button class="btn btn-accent" onclick="hApproveEscalade('${e.id}')" ${online ? '' : 'disabled'}>Autoriser</button>
        <button class="btn btn-ghost" style="color:var(--err);border-color:var(--err-soft);" onclick="hOpenDenyModal('${e.id}')" ${online ? '' : 'disabled'}>Refuser…</button>
      </div>
      ${!online ? `<div class="hint" style="color:var(--err);margin-top:8px;">PC absent — le verdict n'atteindrait pas le worker.</div>` : ''}
    </div>
  `).join('');
}

async function hResolveEscalade(escId, verdict, reason) {
  await HarnessAPI.resolveEscalade(escId, verdict, reason);
  hRenderParc(); hRenderEscalades();
  if (HarnessState.selectedMissionId) hRenderMissionDetail(HarnessState.selectedMissionId);
  showToast(verdict === 'autorise' ? 'Autorisé — verdict réinjecté via requestId' : 'Refus transmis avec motif', verdict === 'autorise' ? 'ok' : 'warn');
}
function hApproveEscalade(id) { if (HarnessAPI._isPcOnline()) hResolveEscalade(id, 'autorise'); }
function hOpenDenyModal(id) {
  if (!HarnessAPI._isPcOnline()) return;
  hDenyTargetId = id;
  document.getElementById('hDenyReason').value = '';
  openModal('modalHDeny');
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hBtnConfirmDeny').addEventListener('click', () => {
    const reason = document.getElementById('hDenyReason').value.trim() || 'Refusé sans motif détaillé.';
    closeModal('modalHDeny');
    if (hDenyTargetId) hResolveEscalade(hDenyTargetId, 'refuse', reason);
    hDenyTargetId = null;
  });
});
