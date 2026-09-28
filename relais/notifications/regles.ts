// Responsabilité : quels événements méritent une notification, et laquelle. Pur.
import type { Evenement } from '../../commun/session.ts';
import type { Notification } from '../registre/registre.ts';

type Brouillon = Pick<Notification, 'niveau' | 'titre' | 'texte'>;

const court = (t: string, n = 280): string => (t.length > n ? `${t.slice(0, n)}…` : t);

export function notificationPour(titreSession: string, evt: Evenement): Brouillon | null {
  switch (evt.type) {
    case 'objectif_atteint':
      return { niveau: 'important', titre: `${titreSession} — objectif atteint`, texte: court(evt.bilan) };
    case 'question':
      return { niveau: 'important', titre: `${titreSession} — question`, texte: court(evt.question) };
    case 'etape':
      return { niveau: 'info', titre: `${titreSession} — étape livrée`, texte: court(evt.resume) };
    case 'erreur':
      return { niveau: 'alerte', titre: `${titreSession} — erreur`, texte: court(evt.message) };
    case 'relance':
      return evt.raison.startsWith('autonomie en pause')
        ? { niveau: 'alerte', titre: `${titreSession} — autonomie en pause`, texte: evt.raison }
        : null;
    default:
      return null;
  }
}
