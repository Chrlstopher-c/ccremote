// Responsabilité : « écrire à deux ». Chez le propriétaire, un message ou une interruption du pair dans une session
// partagée en écriture (droits, accord en « ignorer les permissions », envoi par le chemin d'un message local).
// Chez le demandeur, l'envoi ou l'interruption d'une session du pair.
import type { MessageLien } from '../../commun/duo.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import {
  conclure,
  type Contexte,
  DELAI_REPONSE_PAIR_MS,
  requeteAuPair,
  type Requete,
  verdictDuPair,
} from './contexte.ts';
import { niveauPour } from './partages.ts';
import { bilan } from './pont-sessions.ts';
import type { Resultat } from './resultat.ts';

type LigneEcrire = Extract<MessageLien, { type: 'ecrire' }>;
type LigneInterrompre = Extract<MessageLien, { type: 'interrompre' }>;

const SESSION_NON_PARTAGEE = 'session non partagée avec vous';
const LONGUEUR_EXTRAIT = 300;

// Ce qui bloque l'écriture du pair : session absente ou non partagée avec lui, ou partagée en lecture seule.
function refusEcriture(c: Contexte, session: string): string | null {
  const fiche = c.registre.session(session);
  if (!fiche || fiche.duo) return SESSION_NON_PARTAGEE;
  const niveau = niveauPour(fiche, c.partages.lister());
  if (niveau === null) return SESSION_NON_PARTAGEE;
  return niveau === 'lecture' ? 'partagée en lecture seule' : null;
}

// « Ignorer les permissions » : l'outil n'y demande rien, le message du pair ne passe donc qu'avec l'accord de Chris.
function sansPermissions(c: Contexte, session: string): boolean {
  const mode = c.registre.session(session)?.mode;
  return mode === undefined || mode === 'bypassPermissions';
}

function extrait(texte: string): string {
  return texte.length > LONGUEUR_EXTRAIT ? `${texte.slice(0, LONGUEUR_EXTRAIT)}…` : texte;
}

export async function recevoirEcriture(c: Contexte, nom: string, m: LigneEcrire): Promise<void> {
  const requete: Requete = { nom, ref: m.ref, action: 'ecrire', cible: m.session };
  const refus = refusEcriture(c, m.session);
  if (refus) return conclure(c, requete, { ok: false, raison: refus });
  if (sansPermissions(c, m.session) && c.droits.lire().ecrireSansPermissions === 'demander') {
    const reponse = await c.demandes.demander('message', nom, extrait(m.texte));
    if (!reponse.accord) {
      return conclure(c, requete, {
        ok: false,
        raison: `refusé par ${c.nomLocal()}`,
        detail: 'refusé : pas d’accord de Chris (refus ou délai)',
      });
    }
  }
  const r = await bilan(await c.sessions.envoyer(m.session, m.texte, m.pieces ?? [], nom));
  if (!r.ok) return conclure(c, requete, { ok: false, raison: r.raison });
  if (m.relayeDe) await tracerRelayage(c, nom, m);
  conclure(c, requete, { ok: true, detail: 'envoyé' });
}

// Message venu d'une session de l'expéditeur : la session reçue garde la trace « relayé depuis <titre> de <nom> ».
async function tracerRelayage(c: Contexte, nom: string, m: LigneEcrire): Promise<void> {
  if (!m.relayeDe) return;
  const autre = { session: m.relayeDe.session, titre: m.relayeDe.titre, compte: nom };
  const r = await bilan(await c.sessions.tracer(m.session, { sens: 'entrant', autre, texte: m.texte }));
  if (!r.ok) c.log.warn({ raison: r.raison, session: m.session }, 'trace du message relayé non écrite');
}

export async function recevoirInterruption(c: Contexte, nom: string, m: LigneInterrompre): Promise<void> {
  const requete: Requete = { nom, ref: m.ref, action: 'interrompre', cible: m.session };
  const refus = refusEcriture(c, m.session);
  if (refus) return conclure(c, requete, { ok: false, raison: refus });
  const r = await bilan(await c.sessions.interrompre(m.session));
  conclure(c, requete, r.ok ? { ok: true, detail: 'interrompue' } : { ok: false, raison: r.raison });
}

export async function ecrireAPair(
  c: Contexte,
  session: string,
  texte: string,
  pieces: readonly PieceJointe[],
  relayeDe?: { readonly session: string; readonly titre: string },
): Promise<Resultat<string | null>> {
  const delai = c.delaiDemandeMs + DELAI_REPONSE_PAIR_MS;
  const construire = (ref: string): MessageLien => ({
    type: 'ecrire',
    ref,
    session,
    texte,
    pieces: [...pieces],
    ...(relayeDe ? { relayeDe } : {}),
  });
  const r = await requeteAuPair(c, construire, delai);
  return verdictDuPair(r);
}

export async function interrompreAPair(c: Contexte, session: string): Promise<Resultat<string | null>> {
  const r = await requeteAuPair(c, (ref) => ({ type: 'interrompre', ref, session }), DELAI_REPONSE_PAIR_MS);
  return verdictDuPair(r);
}
