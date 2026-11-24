// Responsabilité : la fiche de départ d'une session que Chris ouvre depuis l'app (dossier de travail, moteur, état
// initial) avant qu'elle tourne. Fonctions pures sur la config et la demande : le gestionnaire les compose.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DemandeSession, Moteur, ResumeSession } from '../../commun/session.ts';
import { type ConfigPoste, developper } from '../config.ts';
import { modesDeOuverture } from './reglages-sdk.ts';

// Le moteur d'une session ouverte depuis l'app : le SDK, sauf demande explicite de tmux (sessions anciennes).
export function moteurDe(d: DemandeSession): Moteur {
  return d.moteur ?? 'sdk';
}

// Projet d'une autre machine : la session travaille via ssh depuis un espace local dédié.
export function repertoireDe(config: ConfigPoste, d: DemandeSession): string {
  if (d.projet.machine === config.machine) return developper(d.projet.chemin.trim() || '~');
  const espace = join(config.donnees, 'espaces', d.sessionId);
  mkdirSync(espace, { recursive: true });
  return espace;
}

export function resumeInitial(config: ConfigPoste, d: DemandeSession, cwd: string, compte: string): ResumeSession {
  const maintenant = new Date().toISOString();
  return {
    id: d.sessionId,
    machine: config.machine,
    projet: d.projet,
    cwd,
    titre: d.titre,
    objectif: d.objectif,
    modele: d.modele ?? 'défaut',
    compte,
    autonomie: d.autonomie,
    statut: 'demarrage',
    contexte: { tokens: 0, max: config.fenetreContexte },
    etapes: 0,
    compactions: 0,
    claudeSessionId: d.sessionId,
    moteur: moteurDe(d),
    style_sortie: d.style_sortie ?? null,
    ...modesDeOuverture(d),
    ...(d.prompt_systeme ? { prompt_systeme: d.prompt_systeme } : {}),
    ...(d.invite ? { invite: { membre: d.invite.membre, nom: d.invite.nom } } : {}),
    // Invité chez lui : son mode est posé dès la fiche (le lancement le lit) ; « absent » vaudrait Manuel pour lui.
    ...(d.invite?.relais !== undefined && d.mode ? { mode: d.mode } : {}),
    bac_a_sable: d.bac_a_sable ?? 'non',
    ...(d.connecteurs_coupes?.length ? { connecteursCoupes: [...new Set(d.connecteurs_coupes)] } : {}),
    tmux: null,
    attachee: false,
    pilotee: true,
    creeLe: maintenant,
    majLe: maintenant,
  };
}
