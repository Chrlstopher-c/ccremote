// ============ HARNESS — barre de sûreté (H-57) + lien Pi↔PC + démarrage ============
// PAUSE GLOBALE et ARRÊT D'URGENCE sont deux commandes séparées, jamais confondues
// (H-57). Elles ne passent jamais par l'orchestrateur (H-57 ☠).

const HARNESS_SAFETY_HTML = `
  <button class="btnPause">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
    <span class="pauseLabel">PAUSE GLOBALE</span>
  </button>
  <div class="safety-gap"></div>
  <button class="btnStop" title="Arrêt d'urgence">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#B5524A" stroke-width="2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
  </button>`;

let hParcPaused = false;

function hInitSafetyBars() {
  document.querySelectorAll('.harness-safety-bar').forEach((b) => { b.innerHTML = HARNESS_SAFETY_HTML; });
}

function hApplyLinkVisuals(up) {
  document.getElementById('hLinkDot').style.background = up ? 'var(--ok)' : 'var(--err)';
  document.getElementById('hLinkDot').classList.toggle('dot-live', up);
  document.getElementById('hLinkText').textContent = up ? 'PC en ligne' : 'PC absent';
  document.getElementById('hLinkText').style.color = up ? '' : 'var(--err)';
  document.getElementById('hLinkWire').classList.toggle('down', !up);
  document.getElementById('hLinkBanner').classList.toggle('show', !up);
  document.querySelectorAll('.harness-safety-bar').forEach((b) => b.classList.toggle('link-down', !up));
}

document.addEventListener('DOMContentLoaded', () => {
  hInitSafetyBars();

  document.addEventListener('click', (e) => {
    if (e.target.closest('.btnPause')) {
      if (!HarnessAPI._isPcOnline()) { showToast('PC absent — la pause n\'atteindrait pas les workers', 'warn'); return; }
      document.getElementById('hPauseTitle').textContent = hParcPaused ? 'Reprendre le parc' : 'Mettre tout le parc en pause';
      document.getElementById('hPauseDesc').innerHTML = hParcPaused
        ? 'Les files d\'entrée retenues seront relâchées et les missions reprendront leur tour.'
        : 'Les missions actives seront interrompues sur leur tour en cours. <strong>Les sessions restent vivantes, le contexte est intégralement préservé.</strong> Reprise instantanée.';
      openModal('modalHPause');
    }
    if (e.target.closest('.btnStop')) {
      if (!HarnessAPI._isPcOnline()) { showToast('PC absent — l\'arrêt n\'atteindrait pas les workers', 'warn'); return; }
      hResetArm();
      openModal('modalHStop');
    }
  });

  document.getElementById('hBtnConfirmPause').addEventListener('click', hDoPause);
  hWireEmergencyStop();

  // ---- simulateurs de démo, panneau Paramètres (jamais en production réelle) ----
  const pcToggle = document.getElementById('hSimPcToggle');
  if (pcToggle) pcToggle.addEventListener('click', () => {
    const up = !HarnessAPI._isPcOnline();
    HarnessAPI._setPcOnline(up);
    hApplyLinkVisuals(up);
    pcToggle.textContent = up ? 'Simuler une absence de PC' : 'Simuler le retour du PC';
    const activeView = document.querySelector('.view.active')?.dataset.view;
    if (activeView === 'harness-parc') hRenderParc();
    if (activeView === 'harness-mission' && HarnessState.selectedMissionId) hRenderMissionDetail(HarnessState.selectedMissionId);
    if (activeView === 'harness-escalades') hRenderEscalades();
    if (activeView === 'harness-comptes') hRenderComptes();
    showToast(up ? 'PC de retour — reconnexion propre (H-75)' : 'PC absent — état normal affiché, pas une erreur (H-75)', up ? 'ok' : 'warn');
  });
});

async function hDoPause() {
  closeModal('modalHPause');
  hParcPaused = !hParcPaused;
  if (hParcPaused) await HarnessAPI.pauseGlobal(); else await HarnessAPI.resumeGlobal();
  document.querySelectorAll('.btnPause').forEach((b) => b.classList.toggle('engaged', hParcPaused));
  document.querySelectorAll('.pauseLabel').forEach((l) => l.textContent = hParcPaused ? 'REPRENDRE LE PARC' : 'PAUSE GLOBALE');
  showToast(hParcPaused ? 'Parc en pause — sessions vivantes, contexte intégralement préservé' : 'Parc repris — files relâchées', hParcPaused ? 'warn' : 'ok');
}

/* ---- arrêt d'urgence : geste armé (maintien 1,5 s), jamais un simple clic ---- */
function hWireEmergencyStop() {
  const armTrack = document.getElementById('hArmTrack');
  const armFill = document.getElementById('hArmFill');
  const armLabel = document.getElementById('hArmLabel');
  let armTimer = null, armStart = 0;
  window.hResetArm = function () { armFill.style.width = '0%'; armTrack.classList.remove('armed'); armLabel.textContent = 'Maintenir 1,5 s pour armer'; };
  function armDown() {
    armStart = Date.now();
    armTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - armStart) / 1500);
      armFill.style.width = (p * 100) + '%';
      if (p > 0.5) armTrack.classList.add('armed');
      if (p >= 1) { clearInterval(armTimer); armTimer = null; fireStop(); }
    }, 30);
  }
  function armUp() { if (armTimer) { clearInterval(armTimer); armTimer = null; window.hResetArm(); } }
  async function fireStop() {
    armLabel.textContent = 'ARRÊT DÉCLENCHÉ';
    const res = await HarnessAPI.emergencyStop();
    setTimeout(() => {
      closeModal('modalHStop');
      hRenderParc();
      showToast(`Arrêt d'urgence — ${res.data.stopped} session(s) fermée(s), worktrees intacts`, 'err');
      window.hResetArm();
    }, 500);
  }
  ['pointerdown'].forEach((ev) => armTrack.addEventListener(ev, (e) => { e.preventDefault(); armDown(); }));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => armTrack.addEventListener(ev, armUp));
}

/* ---- rendu initial du harness ---- */
hApplyLinkVisuals(true);
hRenderTeamTree();
hRenderMiniGauges();
