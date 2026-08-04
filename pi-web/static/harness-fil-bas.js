// ============ Retour au présent dans un fil qui défile ============
//
// ☠ CE QUE ÇA CORRIGE, mesuré par Chris le 04/08 : rouvrir une conversation de
// plusieurs heures atterrissait EN HAUT du fil. Retrouver le dernier message
// demandait de faire défiler des minutes — dans une vue dont le seul point
// d'intérêt est, presque toujours, la fin.
//
// Deux comportements, un seul module, branché sur les trois fils (orchestrateur,
// équipe, sous-agent) :
//   1. à l'ouverture, on est EN BAS ;
//   2. dès qu'on remonte de plus de quelques messages, une flèche ramène en bas.
//
// ☠ Le seuil est en HAUTEURS D'ÉCRAN, pas en pixels : « quatre messages » ne
// veut rien dire quand un message fait trois lignes et le suivant deux cents.
// Un peu plus d'un écran de remontée, c'est le moment où le présent sort du
// champ — exactement quand la flèche devient utile.

const HFB_SEUIL_ECRANS = 1.15;
/** En dessous, on considère qu'on est « au fond » — un défilement fluide n'atteint jamais 0 pile. */
const HFB_TOLERANCE_PX = 80;

function hfbDistanceDuBas(zone) {
  return zone.scrollHeight - zone.scrollTop - zone.clientHeight;
}

function hfbCreerBouton(zone, surClic) {
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'fil-bas';
  bouton.title = 'Revenir au dernier message';
  bouton.setAttribute('aria-label', 'Revenir au dernier message');
  bouton.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
    <span class="pastille"></span>`;
  bouton.addEventListener('click', surClic);
  // ☠ Le bouton est posé dans le PARENT positionné de la zone, pas dans la zone
  // elle-même : un enfant en `position:absolute` d'un conteneur qui défile
  // remonterait avec le contenu au lieu de rester en bas à droite.
  const hote = zone.parentElement || zone;
  if (getComputedStyle(hote).position === 'static') hote.style.position = 'relative';
  hote.appendChild(bouton);
  return bouton;
}

/**
 * Branche le bouton sur une zone défilante. Idempotent : rappeler `attacher`
 * sur la même zone ne crée pas un second bouton (les vues se re-rendent).
 */
function hfbAttacher(cible, options = {}) {
  // Les trois fils ne défilent pas au même niveau : le chat de l'orchestrateur a
  // sa zone (`#hChatScroll`), la page mission défile en entier, le sous-agent a
  // un cadre interne. On accepte donc un id OU un élément.
  const zone = typeof cible === 'string' ? document.getElementById(cible) : cible;
  const cle = typeof cible === 'string' ? cible : (zone?.dataset.filBasCle || zone?.id || 'zone');
  if (!zone || zone.dataset.filBas === '1') return window.HFilBas.instances[cle] || null;
  zone.dataset.filBas = '1';

  const descendre = () => {
    zone.scrollTo({ top: zone.scrollHeight, behavior: 'smooth' });
    etat.nouveaux = 0;
    majuster();
  };
  const bouton = hfbCreerBouton(zone, descendre);
  const etat = { nouveaux: 0 };

  function majuster() {
    const loin = hfbDistanceDuBas(zone) > zone.clientHeight * HFB_SEUIL_ECRANS;
    bouton.classList.toggle('visible', loin);
    // Au fond, le compteur n'a plus d'objet : on ne compte que ce qui est arrivé
    // pendant qu'on lisait ailleurs.
    if (!loin) etat.nouveaux = 0;
    bouton.classList.toggle('avec-nouveaux', loin && etat.nouveaux > 0);
    bouton.querySelector('.pastille').textContent = etat.nouveaux > 9 ? '9+' : String(etat.nouveaux);
  }

  zone.addEventListener('scroll', majuster, { passive: true });
  const api = {
    zone,
    /** Appelé quand un message arrive : compte s'il est hors champ, suit sinon. */
    signalerMessage() {
      if (hfbDistanceDuBas(zone) > HFB_TOLERANCE_PX) etat.nouveaux += 1;
      majuster();
    },
    /** Fin de rendu d'un fil : on colle au bas, sans animation (c'est un point de départ). */
    caler() {
      zone.scrollTop = zone.scrollHeight;
      etat.nouveaux = 0;
      majuster();
    },
    estAuFond: () => hfbDistanceDuBas(zone) <= HFB_TOLERANCE_PX,
    majuster,
  };
  if (options.calerMaintenant !== false) api.caler();
  window.HFilBas.instances[cle] = api;
  return api;
}

window.HFilBas = {
  instances: {},
  attacher: hfbAttacher,
  /** Rend l'instance d'une zone, ou `null` si elle n'a pas encore été branchée. */
  de(zoneId) { return window.HFilBas.instances[zoneId] || null; },
};
