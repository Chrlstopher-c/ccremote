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
import { avecPromptSysteme } from './consignes.ts';
import { confinementDe, crochetConfinement, permissionInvite } from './confinement-invite.ts';
import { jetonPourInvite, MESSAGE_JETON_INVITE, optionsInvite } from './cadre-invite.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { Suite } from './suite-du-tour.ts';
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
const TEXTE_SOMMEIL = 'Session endormie au repos';
const TACHES_TERMINEES: ReadonlySet<string> = new Set(['terminee', 'echouee', 'arretee']);
const TEXTE_PROMPT_CHANGE = 'Prompt système changé';

function identifiantDe(n: NoyauSdk, reprise: boolean): string {
  return reprise ? (n.etat.claudeSessionId ?? n.etat.id) : (n.identifiantNeuf ?? n.etat.id);
}

// Une session d'invité n'a que les options de son cadre (cadre-invite.ts) : jamais celles d'une session ordinaire.
export function optionsDe(n: NoyauSdk, reprise: boolean, jeton: string | null = null): Options {
  const invite = n.p.invite;
  if (!invite) return optionsDeSession(n, reprise);
  return optionsDeInvite(n, invite.cadre, reprise, jeton);
}

function optionsDeSession(n: NoyauSdk, reprise: boolean): Options {
  return optionsSdk({
    identifiant: identifiantDe(n, reprise),
    reprise,
    reprisePoint: n.pointReprise,
    cwd: n.etat.cwd,
    consignes: avecPromptSysteme(n.p.consignes ?? '', n.etat.prompt_systeme ?? null),
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

function optionsDeInvite(n: NoyauSdk, cadre: CadreInvite, reprise: boolean, jeton: string | null): Options {
  const confinement = confinementDe(cadre);
  return optionsInvite({
    identifiant: identifiantDe(n, reprise),
    reprise,
    reprisePoint: n.pointReprise,
    cadre,
    promptSysteme: n.etat.prompt_systeme ?? null,
    jeton,
    source: n.env.env ?? process.env,
    executable: n.env.executable,
    modele: n.etat.modele === 'défaut' ? undefined : n.etat.modele,
    effort: n.etat.effort ?? null,
    confinement: crochetConfinement(confinement, n.env.journal),
    canUseTool: permissionInvite(confinement, n.env.journal),
    ...(cadre.relais !== undefined ? { serveurs: serveursLocauxInvite(n) } : {}),
  });
}

// Session sur la machine de l'invité : ses outils de Noctis (artefacts, visuels, rythme) agissent chez lui seulement.
function serveursLocauxInvite(n: NoyauSdk): NonNullable<Options['mcpServers']> {
  const outils = n.presentation?.serveur();
  return { ccremote: serveurRythme(n.etat.id, n.env.socket), ...(outils ? { lanterne: outils } : {}) };
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
  const invite = n.p.invite;
  const jeton = invite ? jetonPourInvite(invite.cadre, invite.configCompte, n.env.journal) : null;
  if (invite && jeton === undefined) return echouerDemarrage(n, MESSAGE_JETON_INVITE);
  const fil = new FileAsynchrone<SDKUserMessage>();
  let liberer: () => void = () => undefined;
  const pret = new Promise<void>((r) => {
    liberer = () => r();
  });
  n.bilan = new BilanTour();
  try {
    const requete = n.fabrique({
      prompt: messagesAvecConnecteurs(fil, pret),
      options: optionsDe(n, reprise, jeton ?? null),
    });
    n.aReprendre = true;
    n.reveilLe = Date.now();
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
    const message = raisonDemarrage(erreur);
    emettre(n, { type: 'erreur', message });
    maj(n, { statut: 'erreur' });
    return message;
  }
}

const CLAUDE_ABSENT = /Native CLI binary .* not found|pathToClaudeCodeExecutable|ENOENT.*claude/i;

/** Raison lisible d'un démarrage refusé, affichée dans le fil (l'utilisateur ne lit pas le journal). */
export function raisonDemarrage(erreur: unknown): string {
  const brut = erreur instanceof Error ? erreur.message : String(erreur);
  if (CLAUDE_ABSENT.test(brut))
    return (
      'démarrage impossible : Claude Code est introuvable sur ce PC. ' +
      'Installe-le dans Paramètres › Réseau › Composants, puis renvoie le message.'
    );
  return `démarrage impossible : ${brut}`;
}

function echouerDemarrage(n: NoyauSdk, message: string): string {
  n.env.journal.warn({ session: n.etat.id }, 'démarrage de la session impossible : jeton du chef absent');
  emettre(n, { type: 'erreur', message });
  maj(n, { statut: 'erreur' });
  return message;
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
      n.messagesSdk += 1;
      if (n.reposSuppose && msg.type !== 'result') reprendreTravail(n);
      nommerModeleVu(n, msg);
      traiter(n, msg, etatTraduction);
      if (msg.type === 'result') titreRelu(n);
    }
    arreterSansErreur(n, requete);
  } catch (erreur) {
    echouer(n, requete, erreur);
  }
}

// Un tour qu'on croyait absent a bien lieu (API lente à répondre) : la session est remise au travail.
function reprendreTravail(n: NoyauSdk): void {
  n.reposSuppose = false;
  if (n.etat.statut === 'attente') maj(n, { statut: 'travail' });
}

function fermerRequete(n: NoyauSdk, requete: RequeteSdk): void {
  try {
    requete.close();
  } catch (erreur) {
    n.env.journal.warn({ err: erreur, session: n.etat.id }, 'arrêt du processus SDK imparfait');
  }
}

/** Prompt système changé : le SDK ne le change pas dans une requête vivante. Au repos, la requête se ferme ; la reprise
 *  au message suivant part avec le nouveau prompt. En tour, elle se ferme en fin de tour (relancerAvecPrompt). */
export function changerPromptSysteme(n: NoyauSdk, texte: string | null): string | null {
  maj(n, { prompt_systeme: texte });
  const requete = n.requete;
  if (!requete) return null;
  if (n.bilan.enVol > 0 || !endormissable(n)) {
    n.promptEnAttente = true;
    return null;
  }
  libererRequete(n, TEXTE_PROMPT_CHANGE);
  fermerRequete(n, requete);
  return null;
}

/** Fin de tour d'une requête dont le prompt a changé : elle se ferme ; une relance de l'autonomie repart tout de suite
 *  avec le nouveau prompt, les autres suites (compaction, arrêt) attendent le message suivant de Chris. */
export function relancerAvecPrompt(n: NoyauSdk, suite: Suite): void {
  const requete = n.requete;
  if (requete) {
    libererRequete(n, TEXTE_PROMPT_CHANGE);
    fermerRequete(n, requete);
  }
  if (suite.action !== 'relancer') {
    maj(n, { statut: 'attente' });
    return;
  }
  emettre(n, { type: 'relance', raison: suite.raison });
  const erreur = demarrer(n, true, suite.texte);
  if (erreur) emettre(n, { type: 'erreur', message: erreur });
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

export function reprendreApresRedemarrage(n: NoyauSdk, texte: string): string | null {
  emettre(n, { type: 'relance', raison: RAISON_REDEMARRAGE });
  const erreur = n.etat.claudeSessionId ? demarrer(n, true, texte) : 'conversation inconnue';
  if (!erreur) return null;
  n.aReprendre = false;
  emettre(n, { type: 'erreur', message: erreur });
  maj(n, { statut: 'fermee' });
  return erreur;
}

// Mise en sommeil : au repos depuis `seuilMs` (depuis le dernier tour ou le dernier démarrage, le plus tard), sans
// rien qui la tienne (pas de messages en vol, ni question, ni tâche de fond, ni mode nuit), le processus s'arrête. La
// fiche ne change pas (statut « attente », conversation gardée) : la reprise part au prochain message.
export function endormirSiRepos(n: NoyauSdk, maintenant: number, seuilMs: number): boolean {
  if (!n.requete || !n.fil || !endormissable(n)) return false;
  const repos = Math.max(Date.parse(n.etat.majLe), n.reveilLe);
  if (maintenant - repos < seuilMs) return false;
  const requete = n.requete;
  libererRequete(n, TEXTE_SOMMEIL);
  fermerRequete(n, requete);
  n.env.journal.info({ session: n.etat.id }, 'session endormie : processus arrêté, reprise au message suivant');
  return true;
}

function endormissable(n: NoyauSdk): boolean {
  const libre = n.etat.statut === 'attente' && !n.etat.dialogue && !n.etat.nuit;
  if (!libre || n.bilan.enVol > 0 || n.cessionEnAttente) return false;
  return !n.registreTaches.liste().some((t) => !TACHES_TERMINEES.has(t.statut));
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
