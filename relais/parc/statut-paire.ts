// Responsabilité : l'affichage d'une conversation vue par deux fiches (poste, Remote Control). Chaque fiche garde le
// statut que son poste ou claude.ai lui donne ; le statut affiché de la paire est « travail » dès que l'une des deux
// travaille. Le modèle de la session Remote Control suit celui de la fiche de poste quand celui-ci est plus récent.
// Recalculé à chaque changement de l'une des deux.
import type { ResumeSession, StatutSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import { estVivante } from './doublons-conversation.ts';
import { modeleDatee, statutDePaire } from './jumelle-distante.ts';
import { plusRecent } from '../../commun/modele-date.ts';

export class StatutsPaires {
  private readonly propres = new Map<string, StatutSession>();

  constructor(private readonly registre: Registre) {}

  /** Enregistre `fiche` avec ce qu'affiche sa paire ; rend la jumelle, si ce qu'elle affiche a changé. */
  enregistrer(fiche: ResumeSession): ResumeSession | null {
    this.propres.set(fiche.id, fiche.statut);
    this.registre.enregistrerSession(this.affichee(fiche));
    return this.recalculerJumelle(fiche);
  }

  // La fiche avec le statut affiché de sa paire et, pour la session Remote Control, le modèle le plus récent des deux.
  private affichee(fiche: ResumeSession): ResumeSession {
    const autre = this.jumelleDe(fiche);
    if (autre === null) return fiche;
    const statut = statutDePaire(
      this.propres.get(fiche.id) ?? fiche.statut,
      this.propres.get(autre.id) ?? autre.statut,
    );
    if (!fiche.id.startsWith('cse_')) return { ...fiche, statut };
    const modele = plusRecent(modeleDatee(fiche), modeleDatee(autre));
    return { ...fiche, statut, modele: modele.modele, modeleLe: modele.le };
  }

  private recalculerJumelle(fiche: ResumeSession): ResumeSession | null {
    const autre = this.jumelleDe(fiche);
    if (autre === null) return null;
    const recalculee = this.affichee(autre);
    const inchangee =
      recalculee.statut === autre.statut &&
      recalculee.modele === autre.modele &&
      (recalculee.modeleLe ?? null) === (autre.modeleLe ?? null);
    if (inchangee) return null;
    this.registre.enregistrerSession(recalculee);
    return recalculee;
  }

  // Fiche de l'autre côté de la paire : la session Remote Control dont la conversation est celle de la fiche de poste
  // (et réciproquement).
  private jumelleDe(fiche: ResumeSession): ResumeSession | null {
    const estRc = fiche.id.startsWith('cse_');
    const conversation = estRc ? (fiche.distant?.conversation ?? null) : (fiche.claudeSessionId ?? fiche.id);
    if (conversation === null) return null;
    // Toutes les fiches, masquées comprises : une jumelle cachée derrière la fiche de poste compte encore.
    const autres = this.registre.sessions(true).filter((c) => c.id !== fiche.id && c.id.startsWith('cse_') !== estRc);
    const trouvees = autres.filter(
      (c) => (estRc ? (c.claudeSessionId ?? c.id) : c.distant?.conversation) === conversation,
    );
    return trouvees.find(estVivante) ?? trouvees[0] ?? null;
  }
}
