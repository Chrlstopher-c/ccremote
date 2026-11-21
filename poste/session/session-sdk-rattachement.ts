// Responsabilité : le rattachement d'une session aux conversations tenues ailleurs — conversation ouverte dans Claude
// Desktop ou un terminal (statut « en cours » ou « en attente », cession quand ce processus reprend la main),
// transcript suivi quand la session n'est pas pilotée ici, historique relu vers le relais.
import type { ModeleDate } from '../../commun/modele-date.ts';
import { decisionCession } from './cession-sdk.ts';
import { statutExterne } from './recalage-demarrage.ts';
import { cheminTranscript } from './transcript.ts';
import { libererRequete, type NoyauSdk } from './session-sdk-noyau.ts';

const TEXTE_CESSION = 'Conversation reprise par un autre processus Claude';

// Conversation tenue par un processus Claude hors Lanterne : sans reprise possible ; une requête Lanterne vivante
// l'emporte.
export function rattacherTerminal(
  n: NoyauSdk,
  vivant: boolean,
  enTour = false,
  modeleLu: ModeleDate | null = null,
): void {
  if (n.requete !== null) return;
  const statut = statutExterne(n.etat.statut, vivant, enTour);
  const modele = modeleLu ?? { modele: n.etat.modele, le: n.etat.modeleLe ?? null };
  const inchangee = statut === n.etat.statut && (n.etat.terminal === true) === vivant;
  if (inchangee && modele.modele === n.etat.modele && modele.le === (n.etat.modeleLe ?? null)) return;
  n.etat = { ...n.etat, statut, terminal: vivant, modele: modele.modele, modeleLe: modele.le };
  n.env.sortie.resume(n.etat);
}

/** Le balayage voit la conversation tenue (ou non) par un processus Claude interactif hors Lanterne. */
export function cederSiTenue(n: NoyauSdk, tenue: boolean): void {
  const decision = decisionCession(n.requete !== null, n.bilan.enVol > 0, tenue);
  n.cessionEnAttente = decision === 'attendre';
  if (decision === 'fermer') ceder(n);
}

// Conversation reprise ailleurs : la requête se ferme sans passer par fermer() (ni statut « fermee » ni message).
export function ceder(n: NoyauSdk): void {
  const requete = n.requete;
  n.cessionEnAttente = false;
  n.aReprendre = false;
  libererRequete(n, TEXTE_CESSION);
  n.env.journal.info({ session: n.etat.id }, 'conversation reprise par un autre processus : le poste rend la main');
  try {
    requete?.close();
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'fermeture imparfaite du SDK à la cession');
  }
  rattacherTerminal(n, true, false, null);
}

// Session découverte ou adoptée : son historique entier part au relais, en un lot, une seule fois par fiche.
export function definirTranscript(n: NoyauSdk, chemin: string): void {
  if (n.historiqueEmis) return;
  rejouerHistorique(n, chemin);
}

// Relit le transcript vers le relais, en lots (voir suivi-transcript.ts) : `complet` quand le fil du relais est vide.
export function rejouerHistorique(n: NoyauSdk, chemin: string, complet = false): number {
  n.historiqueEmis = true;
  return n.suivi.relecture(chemin, complet);
}

// Session non pilotée ici : son transcript est surveillé, et ce qui s'y ajoute part au fil dans la seconde.
export function lire(n: NoyauSdk): void {
  const conversation = n.etat.claudeSessionId;
  if (n.requete !== null || !conversation) {
    n.suivi.reinitialiser();
    return;
  }
  n.suivi.verifier(cheminTranscript(n.etat.cwd, conversation, n.p.configDir));
}
