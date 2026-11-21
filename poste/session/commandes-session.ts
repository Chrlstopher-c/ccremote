// Responsabilité : l'exécution des commandes de Chris sur une session trouvée du poste — refus distant, bascule en
// cours, lectures du panneau, envoi (avec ses pièces), réglages, connecteurs, tâches, rembobinage. Le gestionnaire y
// délègue.
import type { Logger } from 'pino';
import type { PieceJointe } from '../../commun/presentation.ts';
import { SessionDistante } from '../distant/session-distante.ts';
import { enBascule, type GestionBascule, rembobinerTui } from './bascule-controle.ts';
import { type CommandeSession, estLecture, lecturePanneau } from './lecture-panneau.ts';
import type { Reponse } from './gestionnaire.ts';
import { tenueAilleurs } from './processus.ts';
import type { SessionPoste } from './session-poste.ts';
import { SessionSdk } from './session-sdk.ts';
import { SessionTmux } from './session-tmux.ts';

export interface ContexteCommandes {
  readonly gestion: GestionBascule;
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
  if (c.kind === 'envoyer') return envoyerMessage(s, c.texte, c.pieces ?? []);
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
  if (c.kind === 'rapide' || c.kind === 'ultracode') return s.reglerSession(c);
  if (c.kind === 'connecteur') {
    return s instanceof SessionSdk ? s.basculerConnecteur(c.nom, c.actif) : 'non pris en charge hors SDK';
  }
  return null;
}

// Les pièces jointes partent avec une session SDK ou Remote Control (message structuré) ; le moteur tmux n'en a pas.
function envoyerMessage(s: SessionPoste, texte: string, pieces: readonly PieceJointe[]): Promise<string | null> {
  if (pieces.length > 0 && !(s instanceof SessionSdk) && !(s instanceof SessionDistante))
    return Promise.resolve('pièces jointes : moteur SDK seulement');
  return s.envoyer(texte, pieces);
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
  return { ok: false, erreur: 'rembobinage impossible : session ouverte hors de l’appli (tmux de Chris)' };
}
