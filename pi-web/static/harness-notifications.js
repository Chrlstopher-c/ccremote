// ============================================================
// Notifications — ce que le parc a fait pendant qu'on regardait ailleurs
// ============================================================
// ☠ Le clic sur une carte n'est PAS décoratif : il ouvre la conversation
// orchestrateur d'où venait l'équipe. Sans `conversationId`, la carte reste
// affichée mais inerte — mieux qu'un clic qui mène au mauvais fil.
//
// ☠ Deux marqueurs distincts, jamais fondus en un : « lu » (par Chris) et
// « transmis » (à l'orchestrateur). La nuit, le second arrive sans le premier ;
// en session, l'inverse est courant. C'est précisément ce que Chris regarde
// pour savoir si son orchestrateur est au courant de ce qu'il vient de lire.

let hNotifTimer = null;
let hNotifDernierRendu = '';

const H_NOTIF_POLL_MS = 8000;

function hNotifIcone(type) {
  if (type === 'equipe_echouee') {
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
}

function hNotifCouleur(type) {
  return type === 'equipe_echouee' ? 'var(--err)' : 'var(--ok)';
}

function hNotifAge(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function hNotifCarte(n) {
  const couleur = hNotifCouleur(n.type);
  const cliquable = n.conversationId ? 'cursor:pointer;' : '';
  // ☠ Le fond ne distingue QUE lu/non lu. Superposer l'état de transmission
  // ici rendrait les deux illisibles ; il a sa propre ligne, en toutes lettres.
  const fond = n.read ? 'var(--bg-2)' : 'var(--bg-3)';
  const transmis = n.delivered
    ? '<span style="color: var(--ink-3);">· transmis à l’orchestrateur</span>'
    : n.deliveryError
      ? `<span style="color: var(--err);">· non transmis (${hEchappe(n.deliveryError)})</span>`
      : '<span style="color: var(--warn, var(--ink-3));">· en attente de réveil</span>';

  return `
    <div class="hnotif-card rounded-lg border px-3.5 py-3 flex gap-3" data-notif="${hEchappe(n.id)}"
         data-conv="${hEchappe(n.conversationId || '')}"
         style="border-color: var(--line); background: ${fond}; ${cliquable}">
      <div style="color: ${couleur}; flex-shrink:0; margin-top:1px;">${hNotifIcone(n.type)}</div>
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-medium" style="color: var(--ink);">${hEchappe(n.title)}</div>
        <div class="text-[11.5px] mt-0.5" style="color: var(--ink-2);">${hEchappe(n.body)}</div>
        <div class="text-[10.5px] mt-1.5 flex gap-1.5 flex-wrap" style="color: var(--ink-3);">
          <span>${hNotifAge(n.createdAt)}</span>${transmis}
        </div>
      </div>
      ${n.read ? '' : '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent-2);flex-shrink:0;margin-top:5px;"></span>'}
    </div>`;
}

function hEchappe(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function hNotifBadge(unread) {
  const el = document.getElementById('hNavCountNotifs');
  if (!el) return;
  el.textContent = unread > 99 ? '99+' : String(unread);
  el.style.display = unread > 0 ? '' : 'none';
  el.style.background = unread > 0 ? 'var(--accent-2)' : 'var(--bg-3)';
  el.style.color = unread > 0 ? '#fff' : 'var(--ink-3)';
}

async function hRenderNotifications() {
  const corps = document.getElementById('hNotifsBody');
  const r = await HarnessAPI.getNotifications();
  hNotifBadge(r.unread || 0);
  if (!corps) return;

  if (r.erreur) {
    corps.innerHTML = `<div class="text-[12px]" style="color: var(--err);">Control plane injoignable — ${hEchappe(r.erreur)}</div>`;
    hNotifDernierRendu = '';
    return;
  }
  if (r.notifications.length === 0) {
    corps.innerHTML =
      '<div class="text-[12.5px] py-8 text-center" style="color: var(--ink-3);">Rien à signaler. Les fins d’équipe apparaîtront ici.</div>';
    hNotifDernierRendu = '';
    return;
  }

  // ☠ Ne réécrit le DOM que si quelque chose a changé. Sans cette garde, un
  // rendu complet toutes les 8 s détruirait la sélection de texte et rejouerait
  // les animations — la panne déjà corrigée sur le fil de l'orchestrateur.
  const empreinte = r.notifications.map((n) => `${n.id}:${n.read}:${n.delivered}`).join('|');
  if (empreinte === hNotifDernierRendu) return;
  hNotifDernierRendu = empreinte;

  corps.innerHTML = r.notifications.map(hNotifCarte).join('');
  corps.querySelectorAll('[data-notif]').forEach((el) => {
    el.addEventListener('click', () => hNotifOuvrir(el.dataset.notif, el.dataset.conv));
  });
}

async function hNotifOuvrir(id, conversationId) {
  // ☠ Marquer lu AVANT de naviguer : la navigation re-rend la vue orchestrateur
  // et l'ordre inverse laissait la carte non lue si l'appel traînait.
  try {
    await HarnessAPI.markNotificationRead(id);
  } catch {
    // Un marquage raté ne doit pas empêcher d'ouvrir le fil : le badge se
    // corrigera au prochain passage.
  }
  hNotifDernierRendu = '';
  void hRenderNotifications();
  if (!conversationId) return;
  hGoto('harness-orchestrateur');
  if (typeof hOpenConversation === 'function') void hOpenConversation(conversationId);
}

async function hNotifToutLire() {
  await HarnessAPI.markAllNotificationsRead();
  hNotifDernierRendu = '';
  await hRenderNotifications();
}

// ☠ Le badge vit indépendamment de la vue : Chris doit voir qu'une équipe a
// fini alors qu'il regarde le parc ou une conversation. C'est toute la raison
// d'être d'un badge — le sonder seulement quand la page est ouverte ne
// notifierait que ce qu'on regarde déjà.
function hDemarrerNotifications() {
  if (hNotifTimer !== null) return;
  void hRenderNotifications();
  hNotifTimer = setInterval(() => void hRenderNotifications(), H_NOTIF_POLL_MS);
}

document.addEventListener('DOMContentLoaded', hDemarrerNotifications);

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
