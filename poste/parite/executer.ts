// Responsabilité : exécuter sur le poste les commandes de la parité reçues du relais (contexte et tâches, résultats).
// Lecture seule. Un transcript introuvable donne la parité vide, un détail inconnu rend null (le relais répond 404).
import type { Logger } from 'pino';
import {
  type DetailTacheParite,
  GENRES_PARITE,
  PARITE_VIDE,
  type PariteSession,
  type ReponseResultatParite,
} from '../../commun/parite.ts';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { filTache } from './fil-tache.ts';
import { detailTache } from './taches-resume.ts';
import type { EtatTranscript } from './etat.ts';
import { lireEtat } from './lecture.ts';
import { lireResultat, resultatsCourants } from './resultat.ts';
import { resumeParite } from './resume.ts';

export type CommandeParite = Extract<CommandeRelais, { kind: (typeof GENRES_PARITE)[number] }>;

export interface ContextePariteposte {
  /** Le transcript de la session visée, ou null s'il est introuvable. */
  readonly transcript: (c: CommandeParite) => string | null;
  readonly fenetre: number;
  readonly journal: Logger;
}

export function estParite(c: CommandeRelais): c is CommandeParite {
  return (GENRES_PARITE as readonly string[]).includes(c.kind);
}

export async function executerParite(c: CommandeParite, x: ContextePariteposte): Promise<Reponse> {
  const transcript = x.transcript(c);
  const etat = transcript === null ? null : lireEtat(transcript, x.journal);
  switch (c.kind) {
    case 'parite':
      return { ok: true, donnees: await parite(c.cwd, transcript, etat, x) };
    case 'parite_tache':
      return { ok: true, donnees: { tache: tache(c.tache, transcript, etat, x) } };
    case 'parite_resultat':
      return { ok: true, donnees: resultat(c.chemin, etat, x) };
    case 'parite_fil_tache':
      return { ok: true, donnees: { fil: transcript === null ? null : filTache(transcript, c.tache, x.journal) } };
  }
}

async function parite(
  cwd: string,
  transcript: string | null,
  etat: EtatTranscript | null,
  x: ContextePariteposte,
): Promise<PariteSession> {
  if (transcript === null || etat === null) return PARITE_VIDE;
  return resumeParite({ cwd, transcript, fenetre: x.fenetre, journal: x.journal }, etat);
}

function tache(
  id: string,
  transcript: string | null,
  etat: EtatTranscript | null,
  x: ContextePariteposte,
): DetailTacheParite | null {
  if (transcript === null || etat === null) return null;
  return detailTache(etat, id, transcript, x.journal);
}

// Seul un chemin de la liste courante de la session est lu : le relais ne demande rien d'autre.
function resultat(chemin: string, etat: EtatTranscript | null, x: ContextePariteposte): ReponseResultatParite {
  if (etat === null) return { etat: 'refus', statut: 404, raison: 'transcript introuvable' };
  if (!resultatsCourants(etat).some((r) => r.chemin === chemin)) {
    return { etat: 'refus', statut: 404, raison: 'ce fichier n’est pas un résultat de cette session' };
  }
  return lireResultat(chemin, x.journal);
}
