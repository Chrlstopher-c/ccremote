// Responsabilité : ce que les échanges du mode duo partagent — les dépôts du propriétaire, le lien, les attentes —
// et les deux bouts d'un échange : la réponse du propriétaire (conclure, annoncerAttente) et la requête du demandeur
// (requeteAuPair, requeteAvecAccord). Une requête qui attend l'accord de Chris rend la main tout de suite ; son issue
// arrive ensuite en diffusion (`duo_issue`).
import type { Logger } from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { DELAI_MARGE_REPONSE_MS, type DemandeDuo, type MessageLien } from '../../commun/duo.ts';
import type { Evenement } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import type { Attentes, Suivi } from './attentes.ts';
import type { Demandes, Reponse } from './demandes.ts';
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
  /** Diffuse un événement aux clients de cette installation (l'issue d'une demande au pair). */
  diffuser(m: MessageClient): void;
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

/** Ce qu'une requête au pair rend tout de suite : la session créée, ou une demande en attente de l'accord de Chris. */
export type Engagement =
  | { readonly etat: 'en_attente'; readonly demande: string }
  | { readonly etat: 'fait'; readonly session: string | null };

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

/** Le propriétaire annonce au pair que la requête attend l'accord de Chris ; le pair n'attend plus la finale. */
export function annoncerAttente(c: Contexte, ref: string, demande: DemandeDuo): void {
  c.envoyer({ type: 'attente', ref, demande: demande.id });
}

/** Refus d'un propriétaire : « sans réponse » si la demande a expiré, sinon le refus de Chris. */
export function raisonDeRefus(c: Contexte, r: Reponse): string {
  return r.expiree ? 'sans réponse' : `refusé par ${c.nomLocal()}`;
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

/**
 * Le demandeur envoie une requête qui peut attendre l'accord de Chris chez le pair. Si le pair l'annonce (`attente`),
 * la réponse rend `en_attente` tout de suite et l'issue part ensuite en `duo_issue` ; sans annonce, la réponse est
 * directe, comme avant. `surAccord` s'exécute quand le pair accepte (fil du donneur).
 */
export function requeteAvecAccord(
  c: Contexte,
  construire: (ref: string) => MessageLien,
  delaiMs: number,
  surAccord: () => void = () => undefined,
): Promise<Resultat<Engagement>> {
  if (!c.connecte()) return Promise.resolve(echec(STATUT_REFUS_DUO, `${c.nomPair()} n’est pas connecté`));
  const ref = nonce();
  return new Promise((rendre) => {
    let demande: string | null = null;
    const suivi: Suivi = {
      attente: (id) => {
        demande = id;
        rendre(ok({ etat: 'en_attente', demande: id }));
      },
      fin: (m) => {
        if (demande === null) return rendre(directe(c, m, surAccord));
        issueAuDemandeur(c, demande, m, surAccord);
      },
    };
    c.attentes.suivre(ref, construire(ref), (m) => c.envoyer(m), delaiMs, suivi);
  });
}

// Réponse directe du pair (pas d'accord à demander) : la session, ou la raison du refus.
function directe(c: Contexte, m: MessageLien | null, surAccord: () => void): Resultat<Engagement> {
  const r = verdictDuPair(m ? ok(m) : echec(STATUT_REFUS_DUO, `pas de réponse de ${c.nomPair()}`));
  if (!r.ok) return r;
  surAccord();
  return ok({ etat: 'fait', session: r.valeur });
}

// Issue d'une demande qui attendait l'accord : diffusée à l'interface ; l'accord déclenche `surAccord`.
function issueAuDemandeur(c: Contexte, demande: string, m: MessageLien | null, surAccord: () => void): void {
  if (m?.type === 'reponse' && m.ok) {
    surAccord();
    c.diffuser({ type: 'duo_issue', demande, accord: true, ...(m.session ? { session: m.session } : {}) });
    return;
  }
  c.diffuser({ type: 'duo_issue', demande, accord: false, raison: raisonDuRefusPair(m) });
}

function raisonDuRefusPair(m: MessageLien | null): string {
  if (m === null) return 'sans réponse';
  if (m.type !== 'reponse') return 'réponse inattendue du pair';
  return m.raison ?? 'refusé';
}

/** La réponse « reponse » du pair, réduite à son résultat : session accordée ou raison du refus. */
export function verdictDuPair(r: Resultat<MessageLien>): Resultat<string | null> {
  if (!r.ok) return r;
  const m = r.valeur;
  if (m.type !== 'reponse') return echec(STATUT_REFUS_DUO, 'réponse inattendue du pair');
  return m.ok ? ok(m.session ?? null) : echec(STATUT_REFUS_DUO, m.raison ?? 'refusé');
}

export const DELAI_REPONSE_PAIR_MS = DELAI_MARGE_REPONSE_MS;
