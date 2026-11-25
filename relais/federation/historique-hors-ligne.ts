// Responsabilité : l'historique d'une session d'un pair servi quand ce pair ne répond pas (`evenements`, première page
// sans curseur), et sa mise en mémoire à chaque réponse réussie. Le corps reste celui du pair : seul l'en-tête signale
// que la réponse vient de la mémoire locale.
import type { MessageChiffre } from '../../commun/federation.ts';
import type { GesteLocal } from './echanges.ts';
import type { HistoriqueDistant } from './historique-distant.ts';

export const EN_TETE_HORS_LIGNE = 'X-Lanterne-Hors-Ligne';

type ReponseGeste = Extract<MessageChiffre, { t: 'geste_reponse' }>;

/** Seul le fil complet (sans curseur ni attente) est gardé : une page suivie ne peut pas être rejouée. */
function estFilComplet(g: GesteLocal): g is GesteLocal & { readonly session: string } {
  return g.geste === 'evenements' && g.session !== undefined && !g.requete;
}

/** Garde le fil d'une réponse réussie, en texte (un corps binaire n'est pas un fil). */
export function garderSiFilComplet(historique: HistoriqueDistant | undefined, g: GesteLocal, r: ReponseGeste): void {
  if (!historique || !estFilComplet(g) || r.statut >= 300 || r.codage !== undefined) return;
  historique.garder(g.session, r.corps);
}

/** 200 avec le fil gardé et l'en-tête hors ligne ; null s'il n'y en a pas (la réponse d'erreur reste à rendre). */
export function reponseHorsLigne(historique: HistoriqueDistant | undefined, g: GesteLocal): Response | null {
  if (!historique || !estFilComplet(g)) return null;
  const corps = historique.lire(g.session);
  if (corps === null) return null;
  return new Response(corps, {
    status: 200,
    headers: { 'content-type': 'application/json', [EN_TETE_HORS_LIGNE]: '1' },
  });
}
