// Responsabilité : l'envoi des messages de Chris à une session SDK — premier message avec ses pièces, messages suivants
// poussés dans la requête vivante, reprise d'une conversation fermée, compaction demandée, réveil du mode nuit.
import { randomUUID } from 'node:crypto';
import { texteRemisAClaude } from '../../commun/duo.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import { basculerNuitClaude, lireNuit, TEXTE_ACTIVATION, TEXTE_RETOUR } from './nuit.ts';
import { demarrer, interrompre } from './session-sdk-processus.ts';
import { emettre, maj, pousser, type NoyauSdk } from './session-sdk-noyau.ts';
import { lancerCompaction } from './session-sdk-bilan.ts';
import { pause } from './file-messages-sdk.ts';

// Un message envoyé pendant un tour part à la prochaine frontière d'outil (« next »).
// « now » interromprait le tour en cours ; sans priorité, le CLI traite déjà le message comme « next ».
const PRIORITE_ENVOI = 'next';

export const LIGNE_INTERRUPTION = "[Action en cours interrompue par un nouveau message de l'utilisateur]";
const DELAI_FIN_TOUR_MS = 15_000;
const PAUSE_FIN_TOUR_MS = 20;

const TENUE_AILLEURS =
  'conversation ouverte dans Claude Desktop ou un terminal : écrivez-y par Remote Control, ou fermez-la là-bas d’abord';

// Les messages de Chris entrent dans le fil tout de suite : le SDK ne les renvoie pas (contrairement au transcript relu
// par les sessions tmux). Pièces du premier message : préparées avant tout démarrage (une pièce refusée ne lance rien).
export async function lancer(
  n: NoyauSdk,
  message: string,
  _modele?: string | null,
  pieces: readonly PieceJointe[] = [],
): Promise<string | null> {
  const jointes =
    pieces.length > 0
      ? (n.presentation?.pieces(pieces) ?? 'pièces jointes non prises en charge par cette session')
      : null;
  if (typeof jointes === 'string') return jointes;
  const uuid = randomUUID();
  emettre(n, { type: 'message', texte: message, uuid });
  jointes?.evenements.forEach((evt) => emettre(n, evt));
  return demarrer(n, false, message + (jointes?.complement ?? ''), uuid, jointes?.blocs);
}

// Pièces jointes : vérifiées avant le message (une pièce refusée n'envoie rien) ; leurs événements suivent le message.
// `auteur` : message d'un pair (mode duo). La bulle garde le texte d'origine ; Claude reçoit son nom en tête.
// Session endormie au repos (processus arrêté, reprise prévue) : elle repart d'abord, puis le message suit. Une
// session fermée par Chris ne reçoit ni pièce ni message de pair sans reprise explicite.
export async function envoyer(
  n: NoyauSdk,
  texte: string,
  pieces: readonly PieceJointe[] = [],
  auteur?: string,
): Promise<string | null> {
  if (!n.fil && !n.etat.claudeSessionId && n.identifiantNeuf) return lancer(n, texte, null, pieces);
  if (!n.fil && !n.aReprendre && auteur) return 'session fermée : la reprendre avant d’écrire à deux';
  if (!n.fil && !n.aReprendre && pieces.length > 0) {
    return 'session fermée : la reprendre avant d’y joindre des fichiers';
  }
  const jointes =
    pieces.length > 0
      ? (n.presentation?.pieces(pieces) ?? 'pièces jointes non prises en charge par cette session')
      : null;
  if (typeof jointes === 'string') return jointes;
  if (!n.fil) {
    const erreur = await reprendre(n);
    if (erreur) return erreur;
  }
  const uuid = randomUUID();
  emettre(n, { type: 'message', texte, uuid, ...(auteur ? { auteur } : {}) });
  jointes?.evenements.forEach((evt) => emettre(n, evt));
  n.bilan.messageDeChris();
  const remis = auteur ? texteRemisAClaude(auteur, texte) : texte;
  pousser(n, remis + (jointes?.complement ?? ''), jointes?.blocs, uuid, PRIORITE_ENVOI);
  if (n.etat.statut !== 'compaction') maj(n, { statut: 'travail' });
  return null;
}

// Envoi maintenant (Lanterne, « Envoyer maintenant ») : la bulle part tout de suite, le tour en cours est interrompu
// comme par Échap, puis le message part après la fin de ce tour, précédé pour Claude seulement de LIGNE_INTERRUPTION.
// Sans tour en cours, c'est un envoi ordinaire. Si l'interruption est refusée, le message part quand même.
export async function envoyerMaintenant(
  n: NoyauSdk,
  texte: string,
  pieces: readonly PieceJointe[] = [],
): Promise<string | null> {
  if (pieces.length > 0) return 'envoi maintenant : sans pièces jointes';
  if (!n.fil || n.etat.statut !== 'travail') return envoyer(n, texte, pieces);
  const uuid = randomUUID();
  emettre(n, { type: 'message', texte, uuid });
  n.bilan.messageDeChris();
  const erreur = await interrompre(n);
  if (erreur) n.env.journal.warn({ session: n.etat.id, erreur }, 'envoi maintenant : interruption refusée');
  await attendreFinDuTour(n);
  const remis = `${LIGNE_INTERRUPTION}\n${texte}`;
  if (!n.fil) return demarrer(n, true, remis, uuid);
  pousser(n, remis, undefined, uuid, PRIORITE_ENVOI);
  maj(n, { statut: 'travail' });
  return null;
}

// Le statut quitte « travail » quand le tour interrompu se termine (résultat reçu ou flux fermé). Borné : au-delà,
// le message part quand même, en fil normal.
async function attendreFinDuTour(n: NoyauSdk): Promise<void> {
  const fin = Date.now() + DELAI_FIN_TOUR_MS;
  while (n.etat.statut === 'travail' && n.fil && Date.now() < fin) await pause(PAUSE_FIN_TOUR_MS);
  if (n.etat.statut === 'travail' && n.fil) {
    n.env.journal.warn({ session: n.etat.id }, 'fin du tour interrompu non vue');
  }
}

export async function reprendre(n: NoyauSdk, message?: string): Promise<string | null> {
  // Conversation tenue par un processus vivant ailleurs : la relancer ici ferait deux processus sur le même transcript.
  if (n.etat.terminal === true && n.requete === null) return TENUE_AILLEURS;
  if (n.fil) return message ? envoyer(n, message) : null;
  if (!n.etat.claudeSessionId) return 'conversation inconnue : impossible de la reprendre';
  const uuid = message ? randomUUID() : undefined;
  if (message) emettre(n, { type: 'message', texte: message, uuid });
  return demarrer(n, true, message, uuid);
}

// Compaction demandée : une session endormie repart d'abord (reprise prévue), une session fermée reste fermée.
export async function compacter(n: NoyauSdk): Promise<string | null> {
  if (!n.fil) {
    if (!n.aReprendre) return 'session fermée';
    const erreur = await reprendre(n);
    if (erreur) return erreur;
  }
  if (n.etat.statut === 'travail') {
    n.bilan.demanderCompaction();
    return null;
  }
  lancerCompaction(n, 'demandée par Chris');
  return null;
}

// Le mode nuit réveille la session à l'arrêt : un message, comme celui de Chris.
export async function coller(n: NoyauSdk, texte: string): Promise<string | null> {
  if (!n.fil) return 'session fermée';
  pousser(n, texte);
  maj(n, { statut: 'travail' });
  return null;
}

export async function basculerNuit(n: NoyauSdk, active: boolean, objectif?: string): Promise<string | null> {
  const id = n.etat.claudeSessionId;
  if (!id) return 'conversation inconnue : mode nuit impossible';
  const erreur = await basculerNuitClaude(id, active, objectif ?? n.etat.objectif ?? n.etat.titre);
  if (erreur) return erreur;
  n.suiviNuit.reinitialiser();
  maj(n, { nuit: lireNuit(id, Date.now(), 0) });
  return envoyer(n, active ? TEXTE_ACTIVATION : TEXTE_RETOUR);
}
