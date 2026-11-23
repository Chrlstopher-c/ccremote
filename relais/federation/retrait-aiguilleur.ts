// Responsabilité : demander à l'aiguilleur de ce nœud de retirer un membre de son annuaire (sorti de la charte par ce
// chef), avec le jeton de membre du nœud. Échec journalisé, jamais bloquant : la charte fait foi, l'annuaire suit.
import type { Logger } from 'pino';
import { CHEMIN_RETRAIT_MEMBRE } from '../../commun/aiguilleur.ts';
import type { SecretsNoeud } from './secrets.ts';

const DELAI_MS = 10_000;

export async function retirerDeLAiguilleur(secrets: SecretsNoeud, journal: Logger, membre: string): Promise<void> {
  const config = secrets.lireAiguilleur();
  if (!config) return;
  try {
    const rep = await fetch(new URL(CHEMIN_RETRAIT_MEMBRE, config.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.jeton}` },
      body: JSON.stringify({ membre }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (rep.ok) journal.info({ membre }, 'membre retiré de l’annuaire de l’aiguilleur');
    else journal.warn({ membre, statut: rep.status }, 'retrait refusé par l’aiguilleur');
  } catch (erreur) {
    journal.warn({ err: erreur, membre }, 'retrait : aiguilleur injoignable');
  }
}
