// Responsabilité : ce qu’une session SDK vivante fait de sa configuration — connecteurs, styles, rechargement.
// styles de sortie tels que la requête les voit, rechargement des styles créés pendant la session.
import type { Logger } from 'pino';
import type { StylesSession } from '../../commun/configuration.ts';
import type { RequeteSdk } from './session-sdk.ts';

export class ReglagesVivants {
  private readonly desactives = new Set<string>();

  constructor(
    private readonly requete: () => RequeteSdk | null,
    private readonly journal: Logger,
    private readonly session: string,
  ) {}

  /** Sans requête ouverte, rien ne peut changer : la réponse dit que la session est arrêtée. */
  async connecteur(nom: string, actif: boolean): Promise<string | null> {
    const requete = this.requete();
    if (!requete) return 'session arrêtée';
    try {
      await requete.toggleMcpServer(nom, actif);
    } catch (erreur) {
      this.journal.warn({ err: erreur, session: this.session, connecteur: nom }, 'connecteur refusé par le SDK');
      return `connecteur impossible : ${String(erreur)}`;
    }
    if (actif) this.desactives.delete(nom);
    else this.desactives.add(nom);
    return null;
  }

  /** Statut d'un connecteur : `disabled` pour ceux que Chris a coupés dans cette session. */
  statut(nom: string, statutSdk: string): string {
    return this.desactives.has(nom) ? 'disabled' : statutSdk;
  }

  async styles(): Promise<StylesSession | null> {
    const requete = this.requete();
    if (!requete) return null;
    try {
      const init = await requete.initializationResult();
      return { actuel: init.output_style, disponibles: [...init.available_output_styles] };
    } catch (erreur) {
      this.journal.warn({ err: erreur, session: this.session }, 'styles de sortie non lus dans la requête');
      return null;
    }
  }

  async recharger(): Promise<void> {
    const requete = this.requete();
    if (!requete) return;
    try {
      await requete.reloadOutputStyles();
    } catch (erreur) {
      this.journal.warn({ err: erreur, session: this.session }, 'rechargement des styles refusé');
    }
  }
}
