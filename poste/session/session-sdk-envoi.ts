// Responsabilité : l'envoi des messages de Chris à une session SDK — premier message avec ses pièces, messages suivants
// poussés dans la requête vivante, reprise d'une conversation fermée, compaction demandée, réveil du mode nuit.
import { randomUUID } from 'node:crypto';
import { texteRemisAClaude } from '../../commun/duo.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import { basculerNuitClaude, lireNuit, TEXTE_ACTIVATION, TEXTE_RETOUR } from './nuit.ts';
import { demarrer } from './session-sdk-processus.ts';
import { emettre, maj, pousser, type NoyauSdk } from './session-sdk-noyau.ts';
import { lancerCompaction } from './session-sdk-bilan.ts';

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
export async function envoyer(
  n: NoyauSdk,
  texte: string,
  pieces: readonly PieceJointe[] = [],
  auteur?: string,
): Promise<string | null> {
  if (auteur && !n.fil) return 'session fermée : la reprendre avant d’écrire à deux';
  if (!n.fil && !n.etat.claudeSessionId && n.identifiantNeuf) return lancer(n, texte, null, pieces);
  if (!n.fil) {
    return pieces.length > 0 ? 'session fermée : la reprendre avant d’y joindre des fichiers' : reprendre(n, texte);
  }
  const jointes =
    pieces.length > 0
      ? (n.presentation?.pieces(pieces) ?? 'pièces jointes non prises en charge par cette session')
      : null;
  if (typeof jointes === 'string') return jointes;
  const uuid = randomUUID();
  emettre(n, { type: 'message', texte, uuid, ...(auteur ? { auteur } : {}) });
  jointes?.evenements.forEach((evt) => emettre(n, evt));
  n.bilan.messageDeChris();
  const remis = auteur ? texteRemisAClaude(auteur, texte) : texte;
  pousser(n, remis + (jointes?.complement ?? ''), jointes?.blocs, uuid);
  if (n.etat.statut !== 'compaction') maj(n, { statut: 'travail' });
  return null;
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

export function compacter(n: NoyauSdk): string | null {
  if (!n.fil) return 'session fermée';
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
