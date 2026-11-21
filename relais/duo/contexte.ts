// Responsabilité : ce que les échanges du mode duo partagent — les dépôts du propriétaire, le lien, les attentes —
// et les deux bouts d'un échange : la réponse du propriétaire (conclure) et la requête du demandeur (requeteAuPair).
import type { Logger } from 'pino';
import { DELAI_MARGE_REPONSE_MS, type MessageLien } from '../../commun/duo.ts';
import type { Registre } from '../registre/registre.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Attentes } from './attentes.ts';
import type { Demandes } from './demandes.ts';
import type { DroitsDuo } from './droits.ts';
import type { JournalDuo } from './journal.ts';
import type { PartagesDuo } from './partages.ts';
import type { PontSessions } from './pont-sessions.ts';
import { nonce } from './preuve.ts';
import { echec, ok, type Resultat, STATUT_REFUS_DUO } from './resultat.ts';

export interface Contexte {
  readonly registre: Registre;
  readonly partages: PartagesDuo;
  readonly droits: DroitsDuo;
  readonly demandes: Demandes;
  readonly historique: JournalDuo;
  readonly sessions: PontSessions;
  readonly attentes: Attentes;
  readonly log: Logger;
  readonly delaiDemandeMs: number;
  nomLocal(): string;
  maintenant(): string;
  envoyer(m: MessageLien): boolean;
  connecte(): boolean;
  nomPair(): string;
  partagerOuverte(session: string): void;
  /** Ajoute un événement au fil d'une session locale, diffusé aux clients (passer la main). */
  fil(session: string, evt: Evenement): void;
}

export interface Requete {
  readonly nom: string;
  readonly ref: string;
  readonly action: string;
  readonly cible: string;
}

export type Verdict =
  | { readonly ok: true; readonly detail: string; readonly session?: string }
  | { readonly ok: false; readonly raison: string; readonly detail?: string };

/** Le propriétaire répond à une requête du pair, et la consigne au journal (une ligne par action du pair). */
export function conclure(c: Contexte, r: Requete, verdict: Verdict): void {
  const detail = verdict.ok ? verdict.detail : (verdict.detail ?? `refusé : ${verdict.raison}`);
  c.historique.ecrire({ le: c.maintenant(), qui: r.nom, action: r.action, cible: r.cible, detail });
  c.envoyer({
    type: 'reponse',
    ref: r.ref,
    ok: verdict.ok,
    ...(verdict.ok ? { session: verdict.session } : { raison: verdict.raison }),
  });
}

/** Le demandeur envoie une requête sur le lien et attend la réponse de son pair. */
export async function requeteAuPair(
  c: Contexte,
  construire: (ref: string) => MessageLien,
  delaiMs: number,
): Promise<Resultat<MessageLien>> {
  if (!c.connecte()) return echec(STATUT_REFUS_DUO, `${c.nomPair()} n’est pas connecté`);
  const ref = nonce();
  const reponse = await c.attentes.requete(ref, construire(ref), (m) => c.envoyer(m), delaiMs);
  return reponse ? ok(reponse) : echec(STATUT_REFUS_DUO, `pas de réponse de ${c.nomPair()}`);
}

/** La réponse « reponse » du pair, réduite à son résultat : session accordée ou raison du refus. */
export function verdictDuPair(r: Resultat<MessageLien>): Resultat<string | null> {
  if (!r.ok) return r;
  const m = r.valeur;
  if (m.type !== 'reponse') return echec(STATUT_REFUS_DUO, 'réponse inattendue du pair');
  return m.ok ? ok(m.session ?? null) : echec(STATUT_REFUS_DUO, m.raison ?? 'refusé');
}

export const DELAI_REPONSE_PAIR_MS = DELAI_MARGE_REPONSE_MS;
