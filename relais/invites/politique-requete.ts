// Responsabilité : le verdict sur une requête d'un pair (fil, écriture, interruption, ouverture, terminal). Un invité
// n'en envoie aucune : son seul accès est le relais Claude (relais-claude-serveur.ts), avec ses propres verdicts.
import type { MessageChiffre } from '../../commun/federation.ts';
import type { ReglagesInvite } from '../../commun/invites.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { reponseRefus } from './reponses.ts';

export interface CtxRequete {
  readonly sessionDe: (id: string) => ResumeSession | null;
  readonly reglagesDe: (membre: string) => ReglagesInvite | null;
}

export type VerdictRequete = { ok: true } | { ok: false; reponse: MessageChiffre | null };

const PASSE: VerdictRequete = { ok: true };

/** Le verdict d'une requête reçue d'un pair authentifié (identité du canal chiffré). */
export function verdictRequete(ctx: CtxRequete, membre: string, message: MessageChiffre): VerdictRequete {
  // Un geste a son verdict propre (politique-geste.ts) : sa réponse doit rester un `geste_reponse`.
  if (message.t === 'geste') return PASSE;
  if (ctx.reglagesDe(membre) !== null) return refusInvite(message);
  return verdictPourAutres(ctx, message);
}

function refusInvite(message: MessageChiffre): VerdictRequete {
  return { ok: false, reponse: 'ref' in message ? reponseRefus(message.ref, 'réservé au relais Claude') : null };
}

/** Un pair qui n'est pas invité : il ne lit ni n'écrit une session d'invité ; il peut l'interrompre (charte). */
function verdictPourAutres(ctx: CtxRequete, message: MessageChiffre): VerdictRequete {
  if (message.t !== 'fil' && message.t !== 'ecrire') return PASSE;
  const cible = ctx.sessionDe(message.session);
  if (cible?.invite === undefined) return PASSE;
  return { ok: false, reponse: reponseRefus(message.ref, 'contenu privé') };
}
