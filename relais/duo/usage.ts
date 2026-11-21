// Responsabilité : l'usage partagé. Le propriétaire expose le compte qu'il partage, avec les jauges que le relais a
// déjà relevées, si Chris l'a permis ; le pair les lit sous son nom, jamais mélangées aux siennes.
import type { EtatCompte } from '../../commun/comptes.ts';
import { type MessageLien, type UsagePartage } from '../../commun/duo.ts';
import type { Contexte } from './contexte.ts';
import { requeteAuPair, DELAI_REPONSE_PAIR_MS } from './contexte.ts';
import { echec, ok, type Resultat, STATUT_REFUS_DUO } from './resultat.ts';

type Limites = UsagePartage['limites'];

export function usageDuCompte(c: Contexte): UsagePartage | null {
  const comptes = c.registre
    .machines()
    .flatMap((m) => m.etatComptes)
    .filter((x) => x.connecte);
  const compte = comptes.find((x) => x.defaut) ?? comptes[0];
  if (!compte) return null;
  return {
    compte: compte.email ?? compte.id,
    utilisateur: c.nomLocal(),
    limites: limitesDe(compte),
    releveLe: compte.releveLe,
  };
}

function limitesDe(compte: EtatCompte): Limites {
  const limites: Limites = [];
  if (compte.session) limites.push({ genre: 'session', fenetre: compte.session });
  if (compte.semaine) limites.push({ genre: 'semaine', fenetre: compte.semaine });
  for (const fenetre of compte.autres) limites.push({ genre: 'autre', fenetre });
  return limites;
}

export function recevoirUsage(c: Contexte, ref: string): void {
  const usage = c.droits.lire().usagePartage ? usageDuCompte(c) : null;
  c.envoyer({ type: 'usage_reponse', ref, usage });
}

export async function usageDuPair(c: Contexte): Promise<Resultat<UsagePartage | null>> {
  const r = await requeteAuPair(c, (ref) => ({ type: 'usage', ref }), DELAI_REPONSE_PAIR_MS);
  if (!r.ok) return r;
  return r.valeur.type === 'usage_reponse' ? ok(r.valeur.usage) : echec(STATUT_REFUS_DUO, 'réponse inattendue');
}
