// ============ HARNESS — barre de sûreté + lien Pi↔PC + démarrage ============
//
// ☠ La PAUSE GLOBALE a été SUPPRIMÉE le 01/08, pas désactivée. Elle n'a jamais
// rien mis en pause : `pauseGlobal()` marquait un champ sur la base de
// démonstration en mémoire et rendait `{ paused: true }` ; aucune route serveur
// n'a jamais existé. Le bouton s'allumait, la modale décrivait précisément ce
// que la pause faisait et ne faisait pas, et les workers continuaient.
//
// Un contrôle de sûreté qui ment est PIRE que son absence : on croit le parc
// arrêté, donc on ne fait pas le geste qui l'arrêterait vraiment. Le laisser
// grisé « en attendant » aurait gardé la même promesse à l'écran. L'arrêt
// d'urgence, lui, est réel (`/safety/emergency-stop`) — c'est la seule commande
// de sûreté du produit, et elle ne passe jamais par l'orchestrateur (H-57 ☠).

// ☠ Pleine largeur et libellé depuis qu'il est SEUL : le carré de 54 px se
// justifiait à côté de la pause, il ne se lit plus tout seul dans une barre vide.
const HARNESS_SAFETY_HTML = `
  <button class="btnStop" title="Arrêt d'urgence">
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
    <span>ARRÊT D'URGENCE</span>
  </button>`;

function hInitSafetyBars() {
  document.querySelectorAll('.harness-safety-bar').forEach((b) => { b.innerHTML = HARNESS_SAFETY_HTML; });
}

// ☠ Le pied de barre nomme les MACHINES, il ne dit plus « PC ». Depuis le
// 01/08 il y en a plusieurs (`trinityarch`, `vps-e411b5c7`) et « PC en ligne »
// ne désigne plus rien : on ne savait pas laquelle était là, ni combien.
//
// ☠ Une machine HORS LIGNE reste nommée, en rouge. La masquer laisserait croire
// qu'elle n'existe pas, alors que des missions vivent peut-être dessus (H-75 :
// l'absence est un état, pas une disparition).
function hApplyLinkVisuals(up, machines) {
  const liste = Array.isArray(machines) ? machines : null;
  const enLigne = liste === null ? [] : liste.filter((m) => m.enLigne);

  document.getElementById('hLinkDot').style.background = up ? 'var(--ok)' : 'var(--err)';
  document.getElementById('hLinkDot').classList.toggle('dot-live', up);

  const texte = document.getElementById('hLinkText');
  if (liste === null || liste.length === 0) {
    texte.textContent = up ? 'Machine en ligne' : 'Aucune machine';
  } else if (liste.length === 1) {
    texte.textContent = liste[0].id;
  } else {
    texte.textContent = `${enLigne.length}/${liste.length} machines`;
  }
  texte.style.color = up ? '' : 'var(--err)';

  // Ligne du dessous : les NOMS, chacun coloré selon son propre état. C'est la
  // seule façon de voir d'un coup d'œil laquelle des deux est tombée.
  const fil = document.getElementById('hLinkWire');
  if (liste === null || liste.length === 0) {
    fil.textContent = 'lien';
    fil.classList.toggle('down', !up);
  } else if (liste.length === 1) {
    fil.textContent = liste[0].enLigne ? 'en ligne' : 'hors ligne';
    fil.classList.toggle('down', !liste[0].enLigne);
  } else {
    fil.classList.remove('down');
    fil.innerHTML = liste
      .map((m) => `<span style="color: ${m.enLigne ? 'var(--ok)' : 'var(--err)'};">${hEchappe(m.id)}</span>`)
      .join('<span class="sb-dot">·</span>');
  }

  // ☠ Gardé : le bandeau vivait dans la barre d'onglets, supprimée le 01/08.
  // Sans garde, une TypeError ici abandonnait la suite de la fonction — donc la
  // désactivation des commandes de sûreté quand le PC tombe. L'absence reste
  // dite par le pied de barre, en rouge.
  document.getElementById('hLinkBanner')?.classList.toggle('show', !up);
  document.querySelectorAll('.harness-safety-bar').forEach((b) => b.classList.toggle('link-down', !up));
}

/**
 * ☠ CE SONDAGE MANQUAIT. `hApplyLinkVisuals(true)` était appelée UNE FOIS au
 * chargement avec un booléen écrit en dur : le pied de barre affichait « PC en
 * ligne » quoi qu'il arrive, et `_isPcOnline()` — dont dépendent le garde-fou de
 * l'arrêt d'urgence et les bandeaux « PC absent » — restait à sa valeur de
 * départ. Un indicateur d'état qui ne peut pas changer d'état n'informe de rien.
 */
async function hSonderMachines() {
  const rep = await HarnessAPI.getMachines().catch(() => null);
  const liste = rep && Array.isArray(rep.data) ? rep.data : null;
  const up = liste === null ? false : liste.some((m) => m.enLigne);
  HarnessAPI._setPcOnline(up);
  hApplyLinkVisuals(up, liste);
}

const H_SONDAGE_MACHINES_MS = 10_000;

document.addEventListener('DOMContentLoaded', () => {
  hInitSafetyBars();

  document.addEventListener('click', (e) => {
    if (e.target.closest('.btnStop')) {
      if (!HarnessAPI._isPcOnline()) { showToast('PC absent — l\'arrêt n\'atteindrait pas les workers', 'warn'); return; }
      hResetArm();
      openModal('modalHStop');
    }
  });

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
    if (activeView === 'harness-comptes') hRenderComptes();
    showToast(up ? 'PC de retour — reconnexion propre (H-75)' : 'PC absent — état normal affiché, pas une erreur (H-75)', up ? 'ok' : 'warn');
  });
});

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
// ☠ `null` et non `true` : au premier rendu on ne SAIT pas, et le sondage qui
// suit tranchera. Afficher « en ligne » par défaut, c'était affirmer sans avoir
// mesuré — l'exact défaut que ce sondage corrige.
hApplyLinkVisuals(false, null);
void hSonderMachines();
setInterval(hSonderMachines, H_SONDAGE_MACHINES_MS);
hRenderTeamTree();
hRenderMiniGauges();
