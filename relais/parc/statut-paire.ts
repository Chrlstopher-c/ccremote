// Responsabilité : le statut affiché d'une conversation vue par sa fiche de poste et par sa jumelle Remote Control.
// Chaque fiche garde le statut que son poste ou claude.ai lui donne ; le statut affiché de la paire est « travail »
// dès que l'une des deux fiches travaille. Recalculé à chaque changement de l'une des deux.
import type { ResumeSession, StatutSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import { statutDePaire } from './jumelle-distante.ts';

export class StatutsPaires {
  private readonly propres = new Map<string, StatutSession>();

  constructor(private readonly registre: Registre) {}

  /** Enregistre `fiche` avec le statut affiché de sa paire ; rend la jumelle, si son statut affiché a changé. */
  enregistrer(fiche: ResumeSession): ResumeSession | null {
    this.propres.set(fiche.id, fiche.statut);
    this.registre.enregistrerSession({ ...fiche, statut: this.affiche(fiche) });
    return this.recalculerJumelle(fiche);
  }

  private affiche(fiche: ResumeSession): StatutSession {
    const autre = this.jumelleDe(fiche);
    if (autre === null) return fiche.statut;
    return statutDePaire(this.propres.get(fiche.id) ?? fiche.statut, this.propres.get(autre.id) ?? autre.statut);
  }

  private recalculerJumelle(fiche: ResumeSession): ResumeSession | null {
    const autre = this.jumelleDe(fiche);
    if (autre === null) return null;
    const statut = this.affiche(autre);
    if (statut === autre.statut) return null;
    const recalculee = { ...autre, statut };
    this.registre.enregistrerSession(recalculee);
    return recalculee;
  }

  // Fiche de l'autre côté de la paire : la session Remote Control dont la conversation est celle de la fiche de poste
  // (et réciproquement).
  private jumelleDe(fiche: ResumeSession): ResumeSession | null {
    const estRc = fiche.id.startsWith('cse_');
    const conversation = estRc ? (fiche.distant?.conversation ?? null) : (fiche.claudeSessionId ?? fiche.id);
    if (conversation === null) return null;
    const autres = this.registre.sessions(false).filter((c) => c.id !== fiche.id && c.id.startsWith('cse_') !== estRc);
    return autres.find((c) => (estRc ? (c.claudeSessionId ?? c.id) : c.distant?.conversation) === conversation) ?? null;
  }
}
