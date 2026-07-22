// ============ HARNESS — vue Orchestrateur (chat + modèle/raisonnement + mandat) ============
// H-61 : l'orchestrateur ne crée jamais une équipe seul. Il propose un mandat,
// l'opérateur clique — c'est le seul point de contrôle humain requis (H-61).

let hModelsCache = [];

async function hRenderGauges() {
  const res = await HarnessAPI.getOrchestratorGauges();
  const g = res.data;
  if (!g) { document.getElementById('hGaugeStrip').innerHTML = hPcAbsentBanner('les jauges de l\'orchestrateur'); return; }
  document.getElementById('hGaugeStrip').innerHTML = `
    <div class="gauge">
      <div class="gh"><span>Contexte utilisé</span></div>
      <div class="gv">${g.contextPct} %</div>
      <div class="usage-track" style="margin-top:6px;"><div class="usage-fill" style="width:${g.contextPct}%;background:${g.contextPct >= 75 ? 'var(--err)' : g.contextPct >= 50 ? 'var(--warn)' : 'var(--ok)'};"></div></div>
      <button class="compact-btn" onclick="hCompactContext()">Compacter maintenant</button>
    </div>
    <div class="gauge"><div class="gh"><span>Fin de fenêtre (five_hour)</span></div><div class="gv">${g.windowResetLabel.split(' · ')[0]}</div><div class="gs">${g.windowResetLabel}</div></div>
    <div class="gauge"><div class="gh"><span>$ consommés — fenêtre courante</span></div><div class="gv">${hMoney(g.costWindow)}</div><div class="gs">agrégé par compte, partagé par toutes les missions du compte (H-63)</div></div>`;
  hRenderMiniGauges(); hRenderQuotaStrip();
}
async function hCompactContext() {
  const res = await HarnessAPI.compactOrchestratorContext();
  hRenderGauges();
  showToast('Compaction manuelle effectuée — contexte ramené à ' + res.data.contextPct + ' %', 'ok');
}

async function hRenderModelSelector() {
  hModelsCache = (await HarnessAPI.getModels());
  const selModel = document.getElementById('hSelModel');
  selModel.innerHTML = hModelsCache.map((mo) => `<option value="${mo.id}" ${mo.enabled ? '' : 'disabled'} ${mo.id === HarnessState.orchModel.model ? 'selected' : ''}>${mo.label}</option>`).join('');
  hRefreshEffortOptions(); hRefreshModelToggles(); hUpdateModelHint();
}
function hRefreshEffortOptions() {
  const selEffort = document.getElementById('hSelEffort');
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  if (!mo || !mo.effort.length) { selEffort.innerHTML = `<option value="">— pas de raisonnement réglable —</option>`; selEffort.disabled = true; return; }
  selEffort.disabled = false;
  if (!mo.effort.includes(HarnessState.orchModel.effort)) HarnessState.orchModel.effort = mo.effort.includes('high') ? 'high' : mo.effort[0];
  selEffort.innerHTML = mo.effort.map((e) => `<option value="${e}" ${e === HarnessState.orchModel.effort ? 'selected' : ''}>${HARNESS_EFFORT_LABEL[e]}</option>`).join('');
}
function hRefreshModelToggles() {
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  const chkFast = document.getElementById('hChkFastMode');
  const chkUltra = document.getElementById('hChkUltracode');
  if (!mo || !mo.fastMode) HarnessState.orchModel.fastMode = false;
  chkFast.checked = HarnessState.orchModel.fastMode;
  chkFast.disabled = !(mo && mo.fastMode);
  const ultraOk = hSupportsUltracode(hModelsCache, mo && mo.id);
  if (!ultraOk) HarnessState.orchModel.ultracode = false;
  chkUltra.checked = HarnessState.orchModel.ultracode;
  chkUltra.disabled = !ultraOk;
}
function hUpdateModelHint() {
  const mo = hModelsCache.find((x) => x.id === HarnessState.orchModel.model) || hModelsCache[0];
  const hint = document.getElementById('hModelHint');
  if (!mo) return;
  if (!mo.enabled) hint.innerHTML = `<strong>Déconseillé par Chris pour ce rôle</strong> — jugé insuffisant (H-71), affiché pour transparence mais non sélectionnable.`;
  else if (!mo.effort.length) hint.textContent = `${mo.label} ne supporte ni effort ni raisonnement adaptatif.`;
  else if (HarnessState.orchModel.ultracode) hint.innerHTML = `<strong>ultracode actif</strong> — xhigh + orchestration de workflows permanente. Portée <strong>session</strong> seulement, jamais persisté.`;
  else if (HarnessState.orchModel.fastMode) hint.textContent = `Mode rapide actif sur ${mo.label} — seul ce modèle le déclare (supportsFastMode).`;
  else hint.textContent = `Niveaux de raisonnement pour ${mo.label} : ${mo.effort.map((e) => HARNESS_EFFORT_LABEL[e]).join(' · ')}. Change à chaud, sans redémarrer la session.`;
}

async function hSendOrchMessage() {
  const el = document.getElementById('hOrchInput');
  const text = (el.value || '').trim();
  if (!text) return;
  const chat = document.getElementById('hChatBody');
  const u = document.createElement('div'); u.className = 'bubble-u'; u.textContent = text; chat.appendChild(u);
  el.value = '';
  const res = await HarnessAPI.sendOrchestratorMessage(text, HarnessState.orchModel);
  const a = document.createElement('div'); a.className = 'bubble-a msg-in';
  a.innerHTML = `<p style="margin:0;">${escapeHtml(res.data ? res.data.reply : "PC absent — l'orchestrateur ne peut pas répondre pour l'instant, c'est un état normal (H-75).")}</p>`;
  chat.appendChild(a);
  document.getElementById('hChatScroll').scrollTop = document.getElementById('hChatScroll').scrollHeight;
}

function hIsTestable(txt) {
  if (!txt) return false;
  const t = txt.trim();
  if (t.length < 20) return false;
  return /(réussit|réussissent|passent|passe|atteint|observ|mesur|zéro|détecte|confirmé|sans erreur|tests? e2e|au moins|identique|contient les mêmes|rejeté|accepté|\d)/i.test(t);
}
async function hSubmitMandate() {
  const projet = document.getElementById('hFProjet').value;
  const but = document.getElementById('hFBut').value.trim();
  const critere = document.getElementById('hFCritere').value.trim();
  const perimetre = document.getElementById('hFPerimetre').value.trim();
  const budget = parseFloat(document.getElementById('hFBudget').value) || 12;
  if (!hIsTestable(critere)) {
    document.getElementById('hFCritereField').classList.add('has-error');
    const err = document.getElementById('hFCritereError');
    err.textContent = "Refusé au dispatch — critère d'arrêt non testable. Formule un état vérifiable, pas une intention.";
    err.classList.add('show');
    return;
  }
  document.getElementById('hFCritereField').classList.remove('has-error');
  document.getElementById('hFCritereError').classList.remove('show');
  closeModal('modalHMandat');
  const res = await HarnessAPI.proposeMandate({ projet, but, critere, perimetre, budget });
  hGoto('harness-orchestrateur');
  hAppendProposalToChat(res.data);
  showToast('Mandat transmis — en attente de ton autorisation', 'accent');
}
function hAppendProposalToChat(p) {
  const chat = document.getElementById('hChatBody');
  const u = document.createElement('div'); u.className = 'bubble-u'; u.textContent = `Lance une mission sur ${p.projet}.`; chat.appendChild(u);
  const a = document.createElement('div'); a.className = 'bubble-a msg-in';
  a.innerHTML = `<p style="margin:0 0 4px;">Je ne crée rien seul (H-61). Voici le mandat proposé — ton autorisation dispatche l'équipe.</p>
    <div class="mandate-card" id="hMandate_${p.id}">
      <div class="mh2">Proposition de mandat</div>
      <div class="mb">
        <div class="mrow"><div class="k">Projet</div><div class="v mono">${escapeHtml(p.projet)}</div></div>
        <div class="mrow"><div class="k">But</div><div class="v">${escapeHtml(p.but)}</div></div>
        <div class="mrow"><div class="k">Critère d'arrêt</div><div class="v">${escapeHtml(p.critere)}</div></div>
        <div class="mrow"><div class="k">Budget</div><div class="v mono">${hMoney(p.budget)} (indicatif)</div></div>
      </div>
      <div class="macts">
        <button class="btn btn-accent" onclick="hApproveProposal('${p.id}')">Autoriser</button>
        <button class="btn btn-ghost" style="color:var(--err);border-color:var(--err-soft);" onclick="hRejectProposal('${p.id}')">Refuser</button>
      </div>
    </div>`;
  chat.appendChild(a);
  document.getElementById('hChatScroll').scrollTop = document.getElementById('hChatScroll').scrollHeight;
}
function hStampProposal(id, label, color) {
  const card = document.getElementById('hMandate_' + id);
  if (!card) return;
  card.classList.add('resolved');
  const stamp = document.createElement('div');
  stamp.className = 'verdict-stamp'; stamp.style.color = color;
  stamp.textContent = label + ' à ' + new Date().toTimeString().slice(0, 8);
  card.appendChild(stamp);
}
async function hApproveProposal(id) {
  await HarnessAPI.approveProposal(id);
  hStampProposal(id, 'Autorisée', 'var(--ok)');
  hRenderParc();
  showToast('Mission dispatchée — visible dans le Parc', 'ok');
}
async function hRejectProposal(id) {
  await HarnessAPI.rejectProposal(id);
  hStampProposal(id, 'Refusée — aucune équipe créée', 'var(--err)');
  showToast('Proposition refusée', 'warn');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('hSelModel').addEventListener('change', (e) => {
    const mo = hModelsCache.find((x) => x.id === e.target.value);
    if (!mo || !mo.enabled) { e.target.value = HarnessState.orchModel.model; return; }
    HarnessState.orchModel.model = mo.id;
    hRefreshEffortOptions(); hRefreshModelToggles(); hUpdateModelHint();
    showToast(`Orchestrateur → ${mo.label}`, 'accent');
  });
  document.getElementById('hSelEffort').addEventListener('change', (e) => { HarnessState.orchModel.effort = e.target.value; hUpdateModelHint(); });
  document.getElementById('hChkFastMode').addEventListener('change', (e) => { HarnessState.orchModel.fastMode = e.target.checked; hUpdateModelHint(); });
  document.getElementById('hChkUltracode').addEventListener('change', (e) => { HarnessState.orchModel.ultracode = e.target.checked; hUpdateModelHint(); });
  document.getElementById('hBtnOrchSend').addEventListener('click', hSendOrchMessage);
  document.getElementById('hOrchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); hSendOrchMessage(); } });
  document.getElementById('hBtnNewMission').addEventListener('click', () => {
    if (!HarnessAPI._isPcOnline()) { showToast('PC absent — impossible de dispatcher pour l\'instant', 'warn'); return; }
    document.getElementById('hFCritereField').classList.remove('has-error');
    document.getElementById('hFCritereError').classList.remove('show');
    openModal('modalHMandat');
  });
  document.getElementById('hBtnSubmitMandate').addEventListener('click', hSubmitMandate);
});
