// ============ HARNESS — état d'affichage partagé + petits helpers ============
// Namespacé `HarnessState` pour ne jamais entrer en collision avec `state`
// (déjà utilisé par core.js pour le PC). Réutilise escapeHtml/showToast/
// openModal/closeModal/confirmAction déjà définis par core.js — pas de doublon.

const HarnessState = {
  linkUp: true,
  selectedMissionId: null,
  selectedAgentId: null,
  feedFilter: 'tout',
  orchModel: { model: 'claude-opus-4-8', effort: 'high', fastMode: false, ultracode: false },
};

const HARNESS_STATE_LABEL = { requires_action: 'requires_action', running: 'running', idle: 'idle', paused: 'en_pause', echec: 'echec_definitif', terminee: 'terminee' };
const HARNESS_STATE_BADGE = {
  requires_action: 'background:var(--accent);color:#fff;', running: 'background:var(--ok-soft);color:var(--ok);',
  idle: 'background:var(--bg-2);color:var(--ink-3);', paused: 'background:var(--warn-soft);color:#8A6A12;',
  echec: 'background:var(--err-soft);color:var(--err);', terminee: 'background:var(--bg-2);color:var(--ink-3);',
};
const HARNESS_EFFORT_LABEL = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
const HARNESS_INSPECTION_THRESHOLDS = [12, 30, 50, 70, 100, 120, 150, 170, 200];

// ☠ Tolère l'absence : `costWindow` vient de rate_limit_event, une donnée que
// la chaîne de quotas ne remonte pas encore. Un montant absent s'affiche « — »,
// jamais un faux 0,00 $ qui laisserait croire à une dépense mesurée.
function hMoney(v) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(2).replace('.', ',') + ' $' : '—'; }
function hNextThreshold(cost) { return HARNESS_INSPECTION_THRESHOLDS.find((t) => t > cost) ?? null; }
function hSupportsUltracode(models, modelId) {
  const m = models.find((x) => x.id === modelId);
  return !!(m && m.ultracode);
}

function hVerdictBadge(v) {
  if (!v) return `<span class="badge" style="background:var(--bg-2);color:var(--ink-3);">pas encore inspectée</span>`;
  const map = { progres: ['var(--ok-soft)', 'var(--ok)', 'progrès'], incertain: ['var(--warn-soft)', '#8A6A12', 'incertain'], boucle: ['var(--err-soft)', 'var(--err)', 'boucle'] };
  const [bg, fg, label] = map[v];
  return `<span class="badge" style="background:${bg};color:${fg};">${label}</span>`;
}

function hPcAbsentBanner(view) {
  if (HarnessAPI._isPcOnline()) return '';
  return `<div class="error-state" style="margin-bottom:14px;">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 6.64A9 9 0 1 1 5.64 19.36"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
    <span>PC absent — ${escapeHtml(view || 'cette vue')} affiche les dernières données connues. C'est normal (H-75) : le PC peut être absent des heures, sans que ça soit une erreur.</span>
  </div>`;
}

/**
 * Replie/déplie les entrées secondaires de la barre latérale.
 *
 * ☠ L'état est mémorisé : replier à chaque chargement une section que Chris
 * vient d'ouvrir revient à décider à sa place, chaque fois.
 */
function hBasculerPlus() {
  const bloc = document.getElementById('navPlus');
  const bouton = document.getElementById('btnPlus');
  if (!bloc || !bouton) return;
  const ouvert = bloc.style.display !== 'none';
  bloc.style.display = ouvert ? 'none' : '';
  bouton.classList.toggle('ouvert', !ouvert);
  // ☠ Les zones du bas s'effacent tant que le menu est déplié : sur une barre
  // pleine, les entrées cachées n'auraient nulle part où s'afficher. Elles
  // reviennent dès qu'on a choisi — voir la fermeture sur clic d'entrée.
  document.getElementById('sidebar')?.classList.toggle('plus-ouvert', !ouvert);
  try {
    localStorage.setItem('ccremote.nav.plus', ouvert ? '0' : '1');
  } catch {
    // Stockage refusé (navigation privée) : le repli reste valable pour la session.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let ouvrir = false;
  try {
    ouvrir = localStorage.getItem('ccremote.nav.plus') === '1';
  } catch {
    ouvrir = false;
  }
  // ☠ Rouvre aussi si la vue courante EST dans « Plus » — sinon l'élément actif
  // serait invisible et la barre semblerait avoir perdu la page qu'on regarde.
  const active = document.querySelector('#navPlus .nav-item.active');
  if (ouvrir || active) {
    const bloc = document.getElementById('navPlus');
    if (bloc) bloc.style.display = '';
    document.getElementById('btnPlus')?.classList.add('ouvert');
  }
});


/**
 * Referme « Plus » dès qu'une de ses entrées est choisie.
 *
 * ☠ Sans ça, les listes du bas restent masquées après la navigation : on
 * arriverait sur la vue demandée avec une barre latérale amputée, sans lien
 * évident entre les deux.
 */
document.addEventListener('click', (e) => {
  const item = e.target.closest('#navPlus .nav-item');
  if (!item) return;
  const bloc = document.getElementById('navPlus');
  if (bloc) bloc.style.display = 'none';
  document.getElementById('btnPlus')?.classList.remove('ouvert');
  document.getElementById('sidebar')?.classList.remove('plus-ouvert');
});
