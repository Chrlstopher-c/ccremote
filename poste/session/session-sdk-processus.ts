// Responsabilité : le cycle de vie du processus Claude Agent SDK d'une session — démarrage ou reprise d'une requête,
// écoute de son flux jusqu'à sa fin ou sa panne, interruption, fermeture, arrêt du poste, reprise après redémarrage,
// rembobinage.
import {
  getSessionMessages,
  type Options,
  type SDKUserMessage,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { crochetEdition } from '../modifications/crochet-edition.ts';
import type { PiecesPreparees } from '../presentation/pieces.ts';
import { OUTILS_INTERDITS_ANNEXE } from './annexe.ts';
import { BilanTour } from './bilan-tour.ts';
import { attendreConnecteurs, FileAsynchrone, messagesAvecConnecteurs } from './file-messages-sdk.ts';
import { serveurRythme } from './lanceur.ts';
import { optionsSdk } from './options-sdk.ts';
import { pointDeRembobinage } from './rembobinage.ts';
import { RAISON_REDEMARRAGE } from './reprise.ts';
import type { RequeteSdk } from './session-sdk.ts';
import { emettre, libererRequete, maj, memoriser, pousser, type NoyauSdk } from './session-sdk-noyau.ts';
import { memoriserEtats } from './session-sdk-panneau.ts';
import { nommerModele, relever } from './session-sdk-reglages.ts';
import { nommerModeleVu, titreRelu, traiter } from './session-sdk-traduction.ts';
import type { EtatTraduction } from './traduction-sdk.ts';

const TEXTE_INTERRUPTION = 'Interrompu par Chris';
const TEXTE_FERMETURE = 'Session fermée par Chris';

export function optionsDe(n: NoyauSdk, reprise: boolean): Options {
  return optionsSdk({
    identifiant: reprise ? (n.etat.claudeSessionId ?? n.etat.id) : (n.identifiantNeuf ?? n.etat.id),
    reprise,
    reprisePoint: n.pointReprise,
    cwd: n.etat.cwd,
    consignes: n.p.consignes ?? '',
    modele: n.etat.modele === 'défaut' ? undefined : n.etat.modele,
    rapide: n.etat.rapide?.demande === true,
    ultracode: n.etat.ultracode?.demande === true,
    executable: n.env.executable,
    configDir: n.p.configDir,
    source: n.env.env ?? process.env,
    rythme: serveurRythme(n.etat.id, n.env.socket),
    outils: n.presentation?.serveur(),
    mode: n.etat.mode ?? 'bypassPermissions',
    effort: n.etat.effort ?? null,
    style: n.etat.style_sortie ?? null,
    bacASable: n.etat.bac_a_sable,
    interdits: n.etat.annexe_de ? OUTILS_INTERDITS_ANNEXE : undefined,
    hooks: crochets(n),
    canUseTool: (nom, entree, opts) =>
      n.avis.autoriser(
        nom,
        entree,
        opts.suggestions ?? [],
        opts.signal,
        (n.etat.mode ?? 'bypassPermissions') === 'bypassPermissions',
      ),
  });
}

// Relève le contenu d'un fichier avant que l'outil d'édition le modifie (sans jamais décider de l'outil).
function crochets(n: NoyauSdk): Options['hooks'] {
  const tours = n.env.tours;
  if (!tours) return undefined;
  return { PreToolUse: [crochetEdition(n.etat.cwd, (absolu) => tours.noterAvant(absolu), n.env.journal)] };
}

export function demarrer(
  n: NoyauSdk,
  reprise: boolean,
  message?: string,
  uuid?: SDKUserMessage['uuid'],
  blocs?: PiecesPreparees['blocs'],
): string | null {
  const fil = new FileAsynchrone<SDKUserMessage>();
  let liberer: () => void = () => undefined;
  const pret = new Promise<void>((r) => {
    liberer = () => r();
  });
  n.bilan = new BilanTour();
  try {
    const requete = n.fabrique({ prompt: messagesAvecConnecteurs(fil, pret), options: optionsDe(n, reprise) });
    n.aReprendre = true;
    n.requete = requete;
    n.pointReprise = null;
    n.fil = fil;
    void attendreConnecteursDemarrage(n, requete).then(() => liberer());
    void ecouter(n, requete, n.traduction.nouvelEtat());
    void nommerModele(n, requete);
    void relever(n, requete);
    maj(n, { statut: message ? 'travail' : 'attente' });
    if (message) pousser(n, message, blocs, uuid);
    return null;
  } catch (erreur) {
    n.requete = null;
    n.fil = null;
    n.env.journal.error({ err: erreur, session: n.etat.id }, 'démarrage de la session SDK impossible');
    maj(n, { statut: 'erreur' });
    return `démarrage impossible : ${String(erreur)}`;
  }
}

function attendreConnecteursDemarrage(n: NoyauSdk, requete: RequeteSdk): Promise<void> {
  return attendreConnecteurs(
    requete,
    { delaiMs: n.delaiMcp, periodeMs: n.periodeMcp, session: n.etat.id },
    n.env.journal,
    (etats) => memoriserEtats(n, requete, etats),
  );
}

async function ecouter(n: NoyauSdk, requete: RequeteSdk, etatTraduction: EtatTraduction): Promise<void> {
  try {
    for await (const msg of requete) {
      if (n.requete !== requete) break;
      nommerModeleVu(n, msg);
      traiter(n, msg, etatTraduction);
      if (msg.type === 'result') titreRelu(n);
    }
    arreterSansErreur(n, requete);
  } catch (erreur) {
    echouer(n, requete, erreur);
  }
}

function arreterSansErreur(n: NoyauSdk, requete: RequeteSdk): void {
  if (n.requete !== requete) return;
  n.aReprendre = false;
  libererRequete(n, 'Session terminée');
  maj(n, { statut: 'fermee' });
}

function echouer(n: NoyauSdk, requete: RequeteSdk, erreur: unknown): void {
  if (n.requete !== requete) return; // fermée volontairement : l'erreur qui suit n'est pas une panne
  if (n.interrompuParChris) {
    n.env.journal.info({ session: n.etat.id }, 'flux SDK coupé après interruption demandée par Chris');
    libererRequete(n, 'Interrompue par Chris');
    maj(n, { statut: 'attente' });
    return;
  }
  n.env.journal.error({ err: erreur, session: n.etat.id }, 'requête SDK en échec');
  emettre(n, { type: 'erreur', message: String(erreur) });
  libererRequete(n, 'Session en erreur');
  maj(n, { statut: 'erreur' });
}

export async function fermer(n: NoyauSdk): Promise<string | null> {
  const requete = n.requete;
  n.aReprendre = false;
  libererRequete(n, TEXTE_FERMETURE);
  maj(n, { statut: 'fermee', dialogue: null });
  if (!requete) return null;
  try {
    requete.close();
    return null;
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'fermeture imparfaite du SDK');
    return `fermeture imparfaite : ${String(erreur)}`;
  }
}

export async function interrompre(n: NoyauSdk): Promise<string | null> {
  const requete = n.requete;
  if (!requete) return 'session fermée';
  n.bilan.interrompre();
  n.interrompuParChris = true;
  n.avis.refuserTous(TEXTE_INTERRUPTION, true);
  try {
    await requete.interrupt();
    return null;
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'interruption refusée par le SDK');
    return `interruption impossible : ${String(erreur)}`;
  }
}

// Arrêt du poste : le processus Claude de la session s'arrête, la fiche ne change pas (reprise au redémarrage).
export function arreterProcessus(n: NoyauSdk): void {
  try {
    n.requete?.close();
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'arrêt du processus SDK imparfait');
  }
}

// Arrête une tâche de fond (commande ou sous-agent) par son identifiant SDK ; son état revient par les messages du SDK.
export async function arreterTache(n: NoyauSdk, tache: string): Promise<string | null> {
  const requete = n.requete;
  if (!requete) return 'session fermée';
  try {
    await requete.stopTask(tache);
    return null;
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id, tache }, 'arrêt de tâche refusé par le SDK');
    return `arrêt impossible : ${String(erreur)}`;
  }
}

export function reprendreApresRedemarrage(n: NoyauSdk, texte: string | null): string | null {
  if (texte) emettre(n, { type: 'relance', raison: RAISON_REDEMARRAGE });
  const erreur = n.etat.claudeSessionId ? demarrer(n, true, texte ?? undefined) : 'conversation inconnue';
  if (!erreur) return null;
  n.aReprendre = false;
  emettre(n, { type: 'erreur', message: erreur });
  maj(n, { statut: 'fermee' });
  return erreur;
}

// Rembobiner : la conversation repartira de l'entrée qui précède ce message ; le message et la suite sont retirés de la
// reprise. La session se ferme ici, la reprise part au prochain message de Chris.
export async function rembobiner(n: NoyauSdk, messageId: string): Promise<string | null> {
  const id = n.etat.claudeSessionId;
  if (!id) return 'conversation inconnue : rien à rembobiner';
  let messages: SessionMessage[];
  try {
    messages = await getSessionMessages(id, { dir: n.etat.cwd });
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'lecture du transcript impossible');
    return `lecture du transcript impossible : ${String(erreur)}`;
  }
  const point = pointDeRembobinage(messages, messageId);
  if (point.tag === 'absent') return point.raison;
  const refus = await fermer(n);
  if (refus) return refus;
  if (point.tag === 'premier') recommencer(n);
  else n.pointReprise = point.uuid;
  return null;
}

// Premier message rembobiné : rien ne précède, la conversation repart de zéro (nouvel identifiant SDK, sans reprise).
export function recommencer(n: NoyauSdk): void {
  n.identifiantNeuf = randomUUID();
  memoriser(n, n.etat.claudeSessionId);
  memoriser(n, n.identifiantNeuf);
  n.pointReprise = null;
  maj(n, { claudeSessionId: null });
}
