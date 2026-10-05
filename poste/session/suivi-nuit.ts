// Responsabilité : le suivi du mode nuit d'UNE session — publier son état, la réveiller quand elle s'est arrêtée alors
// que Chris ne répond plus, prévenir quand la nuit s'est terminée avec succès. La politique pure est dans nuit.ts.
import type { Logger } from 'pino';
import type { Evenement, Nuit, ResumeSession } from '../../commun/session.ts';
import { deciderVeille, finReussie, lireNuit } from './nuit.ts';

const PERIODE_NUIT_MS = 10_000;

/** Ce que le suivi demande à sa session. */
export interface HoteNuit {
  resume(): ResumeSession;
  messagesChrisEnVol(): number;
  publierNuit(nuit: Nuit | null): void;
  emettre(evt: Evenement): void;
  coller(texte: string): Promise<string | null>;
  journal(): Logger;
}

export class SuiviNuit {
  private attenteDepuis: number | null = null;
  private dernierReveil: number | null = null;
  private sansEffet = 0;
  private reveils = 0;
  private abandon = false;
  private lecture = 0;

  constructor(private readonly hote: HoteNuit) {}

  /** Repart de zéro (mode nuit basculé depuis Quart). */
  reinitialiser(): void {
    this.sansEffet = 0;
    this.reveils = 0;
    this.abandon = false;
  }

  /** Appelé toutes les 2 s : suit l'arrêt de la session, publie l'état (toutes les 10 s) et réveille si besoin. */
  async tick(maintenant: number = Date.now()): Promise<void> {
    const etat = this.hote.resume();
    this.suivreArret(etat, maintenant);
    if (maintenant - this.lecture < PERIODE_NUIT_MS) return;
    this.lecture = maintenant;
    const nuit = lireNuit(etat.claudeSessionId, maintenant, this.reveils);
    this.publier(etat, nuit, maintenant);
    if (this.abandon) return;
    const suite = deciderVeille({
      nuit,
      statut: etat.statut,
      peutEcrire: etat.tmux !== null && etat.terminal !== true,
      attenteDepuisMs: this.attenteDepuis,
      dernierReveilMs: this.dernierReveil,
      reveilsSansEffet: this.sansEffet,
      messagesChrisEnVol: this.hote.messagesChrisEnVol(),
      maintenantMs: maintenant,
    });
    if (suite.action === 'abandonner') {
      this.abandon = true;
      this.hote.emettre({ type: 'relance', raison: suite.raison });
    } else if (suite.action === 'reveiller') {
      this.dernierReveil = maintenant;
      this.sansEffet += 1;
      this.reveils += 1;
      this.hote.emettre({ type: 'relance', raison: suite.raison });
      const erreur = await this.hote.coller(suite.texte);
      if (erreur) this.hote.journal().warn({ session: etat.id, erreur }, 'réveil de nuit refusé');
    }
  }

  private suivreArret(etat: ResumeSession, maintenant: number): void {
    if (etat.statut === 'attente') {
      this.attenteDepuis ??= maintenant;
      return;
    }
    this.attenteDepuis = null;
    if (etat.statut === 'travail') {
      this.sansEffet = 0;
      this.abandon = false;
    }
  }

  private publier(etat: ResumeSession, nuit: Nuit | null, maintenant: number): void {
    if (JSON.stringify(nuit) === JSON.stringify(etat.nuit ?? null)) return;
    const fin = nuit === null && finReussie(etat.claudeSessionId, maintenant);
    this.hote.publierNuit(nuit);
    if (fin) {
      this.hote.emettre({
        type: 'objectif_atteint',
        bilan: 'Mode nuit terminé : tout est fini et vérifié (VERIFY vert). À tester.',
      });
    }
  }
}
