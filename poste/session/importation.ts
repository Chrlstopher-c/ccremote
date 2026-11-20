// Responsabilité : la fiche d'une session découverte (transcript du poste) quand Chris l'ouvre : fermée, reprenable
// par le SDK, historique lu dans son transcript. Le repérage des transcripts est dans `decouverte.ts`.
import { basename } from 'node:path';
import type { ResumeSession } from '../../commun/session.ts';
import type { Origine } from './adoption.ts';
import type { TranscriptDecouvert } from './decouverte.ts';

export function ficheImportee(o: Origine, t: TranscriptDecouvert): ResumeSession {
  return {
    id: t.id,
    machine: o.machine,
    projet: { machine: o.machine, chemin: t.cwd, nom: basename(t.cwd) },
    cwd: t.cwd,
    titre: t.titre,
    objectif: null,
    modele: 'défaut',
    compte: o.compte,
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: o.fenetre },
    etapes: 0,
    compactions: 0,
    claudeSessionId: t.id,
    moteur: 'sdk',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: t.modifieLe,
    majLe: t.modifieLe,
  };
}
