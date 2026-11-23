// Responsabilité : les sessions Claude Code vues récemment pour chaque invité (fenêtre de simultanéité et activité
// « en cours ») — en mémoire, jamais persisté, jamais de contenu : seulement des identifiants de session.
import { FENETRE_SESSIONS_MS } from '../../commun/relais-claude.ts';

export class SuiviSessionsClaude {
  private readonly vues = new Map<string, Map<string, number>>();

  constructor(private readonly maintenant: () => number = Date.now) {}

  /** Les sessions vues dans la fenêtre ; les plus anciennes sont oubliées au passage. */
  recentes(membre: string): string[] {
    const par = this.vues.get(membre);
    if (par === undefined) return [];
    const limite = this.maintenant() - FENETRE_SESSIONS_MS;
    for (const [session, vue] of par) if (vue < limite) par.delete(session);
    return [...par.keys()];
  }

  noter(membre: string, session: string): void {
    const par = this.vues.get(membre) ?? new Map<string, number>();
    par.set(session, this.maintenant());
    this.vues.set(membre, par);
  }
}
