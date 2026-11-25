// Responsabilité : l'outil `notifier` — une alerte courte envoyée à Chris par l'agent (idée de Chris, 25/11/2026), posée
// sur la fiche de la session ; Noctis l'affiche au bord de la liste et en notification système hors de la fenêtre.
import { type ContexteOutils, echec, ok, protege, type Resultat } from './outils.ts';

/** Écart minimal entre deux notifications d'une même session : un agent ne doit pas pouvoir harceler Chris. */
export const ECART_MIN_MS = 10_000;
const derniers = new Map<string, number>();

export function notifier(
  c: ContexteOutils,
  args: { readonly message: string; readonly titre?: string },
  maintenant: number = Date.now(),
): Resultat {
  return protege(c, 'notification', () => {
    if (!c.notifier) return echec(c, 'notifications indisponibles pour cette session');
    const message = args.message.trim();
    if (!message) return echec(c, 'message vide');
    const avant = derniers.get(c.sessionId);
    if (avant !== undefined && maintenant - avant < ECART_MIN_MS) {
      return echec(c, 'notification trop rapprochée de la précédente : attendre quelques secondes');
    }
    derniers.set(c.sessionId, maintenant);
    const titre = args.titre?.trim() || null;
    c.notifier(message, titre);
    // Aussi au fil : le relais en fait une notification « important », relayée à l'iPhone par le pont ntfy (Sémaphore).
    c.emettre({ type: 'notification_agent', message, titre });
    return ok('Notification envoyée.');
  });
}
