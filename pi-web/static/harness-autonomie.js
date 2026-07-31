// ☠ `hEchappe`, `hConversationCourante` et `showToast` viennent des autres
// modules harness — l'ordre des <script> dans index.html les garantit chargés.

// ============================================================
// Fenêtre d'autonomie — déléguer une plage de travail à un fil
// ============================================================
// ☠ Une PLAGE DATÉE, pas un « mode nuit ». La différence n'est pas cosmétique :
// une échéance donne à l'orchestrateur de quoi arbitrer entre lancer une équipe
// de plus et consolider ce qui est fait. Un interrupteur ne lui apprend rien du
// temps qui reste.

function hLocalVersMs(valeur) {
  if (!valeur) return null;
  const t = new Date(valeur).getTime();
  return Number.isFinite(t) ? t : null;
}

function hOuvrirAutonomie() {
  const p = document.getElementById('hAutonomiePanneau');
  if (!p) return;
  const ouvert = p.style.display !== 'none';
  p.style.display = ouvert ? 'none' : '';
  if (ouvert) return;
  // Pré-remplissage utile : maintenant → dans 8 h. La plage la plus demandée,
  // et surtout deux champs déjà cohérents entre eux.
  const debut = document.getElementById('hAutoDebut');
  const fin = document.getElementById('hAutoFin');
  if (debut && !debut.value) debut.value = hPourInput(Date.now());
  if (fin && !fin.value) fin.value = hPourInput(Date.now() + 8 * 3600 * 1000);
}

function hPourInput(ms) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function hConversationCourante() {
  // ☠ Lue depuis l'état de la vue orchestrateur, jamais devinée : poser une
  // fenêtre sur le mauvais fil déléguerait l'autonomie à une conversation que
  // Chris n'a pas choisie.
  return (typeof hOrch !== 'undefined' && hOrch && hOrch.convId) || null;
}

async function hPoserAutonomie() {
  const retour = document.getElementById('hAutoRetour');
  const id = hConversationCourante();
  if (!id) { if (retour) retour.textContent = 'Ouvre d’abord une conversation.'; return; }
  const debut = hLocalVersMs(document.getElementById('hAutoDebut').value);
  const fin = hLocalVersMs(document.getElementById('hAutoFin').value);
  const objectif = document.getElementById('hAutoObjectif').value.trim();
  if (debut === null || fin === null) { retour.textContent = 'Renseigne un début ET une fin.'; return; }
  const r = await HarnessAPI.setAutonomie(id, debut, fin, objectif || null);
  retour.textContent = r.erreur ? `Refusé — ${r.erreur}` : r.effet || 'Autonomie déléguée.';
  if (!r.erreur) hMajLabelAutonomie(debut, fin);
}

async function hRetirerAutonomie() {
  const retour = document.getElementById('hAutoRetour');
  const id = hConversationCourante();
  if (!id) { if (retour) retour.textContent = 'Ouvre d’abord une conversation.'; return; }
  const r = await HarnessAPI.setAutonomie(id, null, null, null);
  retour.textContent = r.erreur ? `Refusé — ${r.erreur}` : r.effet || 'Autonomie retirée.';
  if (!r.erreur) hMajLabelAutonomie(null, null);
}

function hMajLabelAutonomie(debut, fin) {
  const el = document.getElementById('hAutonomieLabel');
  if (!el) return;
  if (debut === null || fin === null) { el.textContent = 'Autonomie'; el.style.color = ''; return; }
  const actif = Date.now() >= debut && Date.now() < fin;
  el.textContent = actif ? 'Autonomie active' : 'Autonomie programmée';
  el.style.color = actif ? 'var(--ok)' : 'var(--ink-2)';
}
