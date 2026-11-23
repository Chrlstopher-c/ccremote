// Responsabilité : l'exécution des commandes de Chris sur une session trouvée du poste — refus distant, bascule en
// cours, lectures du panneau, envoi (avec ses pièces), réglages, connecteurs, tâches, rembobinage. Le gestionnaire y
// délègue.
import type { Logger } from 'pino';
import type { PieceJointe } from '../../commun/presentation.ts';
import { executerFichiersSession, type CommandeFichiersSession } from '../fichiers/session.ts';
import { lireFichierSession } from '../presentation/lecture.ts';
import type { Stockage } from '../presentation/stockage.ts';
import { SessionDistante } from '../distant/session-distante.ts';
import { enBascule, type GestionBascule, rembobinerTui } from './bascule-controle.ts';
import { type CommandeSession, estLecture, lecturePanneau } from './lecture-panneau.ts';
import type { Reponse } from './gestionnaire.ts';
import { tenueAilleurs } from './processus.ts';
import type { SessionPoste } from './session-poste.ts';
import { SessionSdk } from './session-sdk.ts';
import { SessionTmux } from './session-tmux.ts';
import { cheminTranscript } from './transcript.ts';

export interface ContexteCommandes {
  readonly gestion: GestionBascule;
  readonly stockage: Stockage;
  readonly journal: Logger;
  readonly refusDistant: (c: CommandeSession) => string | null;
  readonly configDirs: () => (string | null)[];
}

export async function executerSurSession(
  ctx: ContexteCommandes,
  s: SessionPoste,
  c: CommandeSession,
): Promise<Reponse> {
  const refus = ctx.refusDistant(c);
  if (refus) return { ok: false, erreur: refus };
  if (enBascule(c.sessionId)) return { ok: false, erreur: 'bascule Remote Control en cours : réessayer' };
  if (estLecture(c)) return { ok: true, donnees: await lecturePanneau(s, c) };
  if (c.kind === 'rembobiner') return rembobiner(ctx, s, c.messageId);
  const erreur = await appliquerCommande(ctx, s, c);
  return erreur ? { ok: false, erreur } : { ok: true, donnees: s.resume };
}

async function appliquerCommande(ctx: ContexteCommandes, s: SessionPoste, c: CommandeSession): Promise<string | null> {
  if (c.kind === 'envoyer') return envoyerMessage(s, c.texte, c.pieces ?? [], c.auteur, c.maintenant === true);
  if (c.kind === 'interrompre') return s.interrompre();
  if (c.kind === 'compacter') return s.compacter();
  if (c.kind === 'fermer') return s.fermer();
  if (c.kind === 'reprendre') {
    const tenue = tenueAilleurs(s.resume.claudeSessionId, ctx.configDirs(), ctx.journal);
    return tenue ?? (await s.reprendre());
  }
  if (c.kind === 'autonomie') {
    s.basculerAutonomie(c.active);
    return null;
  }
  if (c.kind === 'nuit') return s.basculerNuit(c.active, c.objectif);
  if (c.kind === 'repondre') return s.repondre(c.reponse);
  if (c.kind === 'arreter_tache') {
    return s instanceof SessionSdk ? s.arreterTache(c.tache) : 'non pris en charge hors SDK';
  }
  if (c.kind === 'mode' || c.kind === 'modele' || c.kind === 'effort' || c.kind === 'renommer') {
    return s.reglerSession(c);
  }
  if (c.kind === 'style') return s.reglerSession({ kind: 'style', style: c.style });
  if (c.kind === 'prompt_systeme') {
    const texte = c.texte.trim() === '' ? null : c.texte;
    return s instanceof SessionSdk ? s.promptSysteme(texte) : 'non pris en charge hors SDK';
  }
  if (c.kind === 'rapide' || c.kind === 'ultracode') return s.reglerSession(c);
  if (c.kind === 'connecteur') {
    return s instanceof SessionSdk ? s.basculerConnecteur(c.nom, c.actif) : 'non pris en charge hors SDK';
  }
  return null;
}

// Les pièces jointes partent avec une session SDK ou Remote Control (message structuré) ; le moteur tmux n'en a pas.
// Un message du pair (mode duo, `auteur`) n'entre que dans une session SDK : sa bulle porte le nom de l'auteur.
// « Envoyer maintenant » (interrompt le tour en cours) : moteur SDK seulement, pour l'instant.
function envoyerMessage(
  s: SessionPoste,
  texte: string,
  pieces: readonly PieceJointe[],
  auteur?: string,
  maintenant = false,
): Promise<string | null> {
  if (pieces.length > 0 && !(s instanceof SessionSdk) && !(s instanceof SessionDistante))
    return Promise.resolve('pièces jointes : moteur SDK seulement');
  if (auteur && !(s instanceof SessionSdk)) return Promise.resolve('écriture à deux : moteur SDK seulement');
  if (maintenant && !(s instanceof SessionSdk)) return Promise.resolve('envoi maintenant : moteur SDK seulement');
  return s.envoyer(texte, pieces, auteur, maintenant);
}

// Rembobinage : une session SDK rembobine sur place ; une session du TUI repasse d'abord au SDK (voir
// bascule-controle). Une session tmux qui n'a pas été lancée par le poste (adoptée d'un terminal de Chris) n'est pas
// touchée.
async function rembobiner(ctx: ContexteCommandes, s: SessionPoste, messageId: string): Promise<Reponse> {
  if (s instanceof SessionSdk) {
    const erreur = await s.rembobiner(messageId);
    return erreur ? { ok: false, erreur } : { ok: true, donnees: s.resume };
  }
  if (s instanceof SessionTmux && s.resume.pilotee) return rembobinerTui(ctx.gestion, s, messageId);
  return { ok: false, erreur: 'rembobinage impossible : session ouverte hors de l’appli (tmux de l’utilisateur)' };
}

// Historique d'une session dont le fil est vide au relais (fiche migrée, ou adoptée avant la relecture) : son
// transcript repasse au relais. Une session en cours n'est pas relue : son fil vient du direct.
export function historiqueRejoue(ctx: ContexteCommandes, id: string): Reponse {
  const s = ctx.gestion.sessions.get(id);
  if (!s) return { ok: false, erreur: `session inconnue sur ${ctx.gestion.config.machine}` };
  if (!(s instanceof SessionSdk)) return { ok: false, erreur: 'historique relu seulement pour une session SDK' };
  if (s.vivante) return { ok: false, erreur: 'session en cours : historique non relu' };
  const conversation = s.resume.claudeSessionId;
  if (!conversation) return { ok: true, donnees: { evenements: 0 } };
  const chemin = cheminTranscript(s.resume.cwd, conversation, s.persistee.configDir);
  return { ok: true, donnees: { evenements: s.rejouerHistorique(chemin, true) } };
}

export function reponseAdoption(ctx: ContexteCommandes, id: string): Reponse {
  const s = ctx.gestion.sessions.get(id);
  if (!s) return { ok: false, erreur: `session inconnue sur ${ctx.gestion.config.machine}` };
  return { ok: true, donnees: s.resume };
}

// Fichier présenté, lu pour la route du relais : la session peut être fermée, le fichier reste sur le poste.
export function fichierPresente(ctx: ContexteCommandes, sessionId: string, fichier: string): Reponse {
  const lu = lireFichierSession(ctx.stockage, sessionId, fichier, ctx.journal);
  return lu ? { ok: true, donnees: lu } : { ok: false, erreur: 'fichier introuvable' };
}

// Panneau Fichiers d'une session : le dossier de la session borne tous les chemins.
export function fichiersDeSession(ctx: ContexteCommandes, c: CommandeFichiersSession): Promise<Reponse> {
  const s = ctx.gestion.sessions.get(c.sessionId);
  if (!s) return Promise.resolve({ ok: false, erreur: `session inconnue sur ${ctx.gestion.config.machine}` });
  return executerFichiersSession(c, s.resume.cwd, ctx.journal);
}
