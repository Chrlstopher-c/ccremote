// ☠ `hEchappe`, `hConversationCourante` et `showToast` viennent des autres
// modules harness — l'ordre des <script> dans index.html les garantit chargés.

// ============================================================
// Rappels — voir et contrôler ce que l'orchestrateur a programmé
// ============================================================
// ☠ Pas de création ici, et c'est délibéré : une consigne de rappel est un
// texte réinjecté à l'orchestrateur, qu'il doit pouvoir exploiter sans
// contexte. C'est lui qui la rédige, avec ses outils. L'écran donne la
// visibilité et le contrôle — voir, mettre en pause, reprendre, supprimer.
//
// ☠ Le compte à rebours est calculé AU RENDU, à partir d'un horodatage absolu
// rendu par le serveur. Un « dans 7 min » figé côté serveur vieillirait entre
// deux rafraîchissements et afficherait un délai faux.

let hRappelsTimer = null;
let hRappelsDernierRendu = '';
const H_RAPPELS_POLL_MS = 15000;

function hRappelEcheance(ms) {
  if (ms === null) return '—';
  const delta = Math.round((ms - Date.now()) / 60000);
  if (delta <= 0) return 'imminent';
  if (delta < 60) return `dans ${delta} min`;
  const h = Math.floor(delta / 60);
  return h < 24 ? `dans ${h} h ${String(delta % 60).padStart(2, '0')}` : `dans ${Math.floor(h / 24)} j`;
}

function hRappelEtat(r) {
  if (r.state === 'en_pause') return { texte: 'en pause', couleur: 'var(--warn, #d89b3c)' };
  if (r.state === 'termine') return { texte: 'terminé', couleur: 'var(--ink-3)' };
  return { texte: hRappelEcheance(r.nextAt), couleur: 'var(--ok, #6ba368)' };
}

function hRappelCarte(r) {
  const etat = hRappelEtat(r);
  const cadence = r.everyMinutes === null ? 'unique' : `toutes les ${r.everyMinutes} min`;
  const tirs = r.maxFires === null ? `${r.fired} tir(s)` : `${r.fired}/${r.maxFires} tir(s)`;
  const incident = r.lastError
    ? `<div class="text-[10.5px] mt-1" style="color: var(--err);">${hEchappe(r.lastError)}</div>`
    : '';
  // Un rappel terminé n'offre que la suppression : le reprendre ferait tirer
  // une seconde fois un one-shot déjà consommé.
  const actions =
    r.state === 'termine'
      ? `<button data-rappel="${hEchappe(r.id)}" data-action="delete" class="text-[11px] px-2 py-1 rounded-md hover:bg-black/5" style="color: var(--err);">Supprimer</button>`
      : `<button data-rappel="${hEchappe(r.id)}" data-action="${r.state === 'en_pause' ? 'resume' : 'pause'}" class="text-[11px] px-2 py-1 rounded-md hover:bg-black/5" style="color: var(--ink-2);">${r.state === 'en_pause' ? 'Reprendre' : 'Mettre en pause'}</button>
         <button data-rappel="${hEchappe(r.id)}" data-action="delete" class="text-[11px] px-2 py-1 rounded-md hover:bg-black/5" style="color: var(--err);">Supprimer</button>`;

  return `
    <div class="rounded-lg border px-3 py-2.5" style="border-color: var(--line); background: var(--bg-3);">
      <div class="flex items-center gap-2">
        <span class="text-[12.5px] font-medium" style="color: var(--ink);">${hEchappe(r.label)}</span>
        <span class="text-[10.5px] px-1.5 py-0.5 rounded-full" style="background: var(--bg-2); color: ${etat.couleur};">${hEchappe(etat.texte)}</span>
        <span class="text-[10.5px]" style="color: var(--ink-3);">${hEchappe(cadence)} · ${hEchappe(tirs)}</span>
      </div>
      <div class="text-[11.5px] mt-1.5" style="color: var(--ink-2); white-space: pre-wrap;">${hEchappe(r.instruction)}</div>
      ${incident}
      <div class="flex gap-1.5 mt-2">${actions}</div>
    </div>`;
}

async function hRenderRappels() {
  const id = hConversationCourante();
  const liste = document.getElementById('hRappelsListe');
  const badge = document.getElementById('hRappelsCount');
  if (!id) {
    if (liste) liste.innerHTML = '<div class="text-[12px]" style="color: var(--ink-3);">Ouvre une conversation.</div>';
    if (badge) badge.style.display = 'none';
    return;
  }
  const r = await HarnessAPI.getRappels(id);
  const actifs = r.rappels.filter((x) => x.state === 'actif').length;
  if (badge) {
    badge.textContent = String(actifs);
    badge.style.display = actifs > 0 ? '' : 'none';
  }
  if (!liste) return;

  if (r.erreur) {
    liste.innerHTML = `<div class="text-[12px]" style="color: var(--err);">${hEchappe(r.erreur)}</div>`;
    return;
  }
  if (r.rappels.length === 0) {
    liste.innerHTML =
      '<div class="text-[12px] py-3" style="color: var(--ink-3);">Aucun rappel. Demande à l’orchestrateur d’en programmer un.</div>';
    hRappelsDernierRendu = '';
    return;
  }

  // Même garde que sur les notifications : ne réécrire le DOM que si l'état a
  // changé, sinon un rendu périodique détruirait la sélection de texte.
  const empreinte = r.rappels.map((x) => `${x.id}:${x.state}:${x.fired}:${x.nextAt}`).join('|');
  if (empreinte === hRappelsDernierRendu) return;
  hRappelsDernierRendu = empreinte;

  liste.innerHTML = r.rappels.map(hRappelCarte).join('');
  liste.querySelectorAll('[data-rappel]').forEach((el) => {
    el.addEventListener('click', () => hActionRappel(el.dataset.rappel, el.dataset.action));
  });
}

async function hActionRappel(rappelId, action) {
  const id = hConversationCourante();
  if (!id) return;
  if (action === 'delete' && !window.confirm('Supprimer ce rappel définitivement ?')) return;
  const r = await HarnessAPI.actionRappel(id, rappelId, action);
  // ☠ Un échec DOIT être visible : croire avoir coupé un rappel qui continue de
  // tirer est exactement le genre d'écran qui ment.
  if (r.erreur) showToast(`Rappel — ${r.erreur}`, 'warn');
  else if (r.effet) showToast(r.effet, 'ok');
  hRappelsDernierRendu = '';
  await hRenderRappels();
}

function hOuvrirRappels() {
  const p = document.getElementById('hRappelsPanneau');
  if (!p) return;
  const ouvert = p.style.display !== 'none';
  p.style.display = ouvert ? 'none' : '';
  if (!ouvert) {
    hRappelsDernierRendu = '';
    void hRenderRappels();
  }
}

// Le badge vit même panneau fermé : Chris doit voir qu'un rappel tourne sur ce
// fil sans avoir à l'ouvrir.
function hDemarrerRappels() {
  if (hRappelsTimer !== null) return;
  void hRenderRappels();
  hRappelsTimer = setInterval(() => void hRenderRappels(), H_RAPPELS_POLL_MS);
}

document.addEventListener('DOMContentLoaded', hDemarrerRappels);
