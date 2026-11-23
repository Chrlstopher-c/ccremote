// Responsabilité : le verdict sur un geste relayé d'un pair. Un invité n'en fait aucun (il passe par le relais
// Claude) ; pour les autres, le contenu privé des sessions d'invité reste refusé.
import type { MessageChiffre } from '../../commun/federation.ts';
import type { GesteLocal } from '../federation/echanges.ts';
import { contenuPrive } from './sessions-invite.ts';
import type { CtxRequete } from './politique-requete.ts';

export type GesteRecu = Extract<MessageChiffre, { t: 'geste' }>;
export type VerdictGeste =
  | { readonly ok: true; readonly geste: GesteLocal }
  | { readonly ok: false; readonly statut: number; readonly raison: string };
export type CtxGeste = CtxRequete;

const refus = (statut: number, raison: string): VerdictGeste => ({ ok: false, statut, raison });

/** Le verdict d'un geste : un invité n'en relaie aucun ; un autre pair ne lit pas le contenu d'une session d'invité. */
export function verdictGeste(ctx: CtxGeste, membre: string, m: GesteRecu): VerdictGeste {
  if (ctx.reglagesDe(membre) !== null) return refus(403, 'réservé au relais Claude');
  const cible = m.session !== undefined ? ctx.sessionDe(m.session) : null;
  if (cible?.invite && contenuPrive(m.geste)) return refus(403, 'contenu privé');
  return { ok: true, geste: gesteLocal(m) };
}

function gesteLocal(m: GesteRecu): GesteLocal {
  return {
    geste: m.geste,
    methode: m.methode,
    ...(m.session !== undefined ? { session: m.session } : {}),
    ...(m.machine !== undefined ? { machine: m.machine } : {}),
    ...(m.requete !== undefined ? { requete: m.requete } : {}),
    ...(m.corps !== undefined ? { corps: m.corps } : {}),
  };
}
