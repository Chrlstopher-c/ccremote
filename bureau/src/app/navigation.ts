// Responsabilité : où l'on est dans l'app — la source choisie dans la barre latérale et l'élément choisi dans la liste.
import type { Notification, VueMachine } from '../../../commun/api-clients.ts';
import type { ResumeSession } from '../../../commun/session.ts';
import { estOuverte } from '../sessions/statut.ts';

export type Source =
  | { readonly genre: 'sessions'; readonly filtre: 'ouvertes' | 'toutes' }
  | { readonly genre: 'machine'; readonly id: string }
  | { readonly genre: 'appareil'; readonly id: string }
  | { readonly genre: 'alertes' }
  | { readonly genre: 'comptes' };

export const SOURCE_DEFAUT: Source = { genre: 'sessions', filtre: 'ouvertes' };

export function memeSource(a: Source, b: Source): boolean {
  if (a.genre !== b.genre) return false;
  if (a.genre === 'sessions' && b.genre === 'sessions') return a.filtre === b.filtre;
  if (a.genre === 'machine' && b.genre === 'machine') return a.id === b.id;
  if (a.genre === 'appareil' && b.genre === 'appareil') return a.id === b.id;
  return true;
}

/** Les sessions de la colonne du milieu pour une source donnée, les plus récentes d'abord. */
export function sessionsDe(source: Source, sessions: readonly ResumeSession[], recherche: string): ResumeSession[] {
  const q = recherche.trim().toLowerCase();
  return sessions
    .filter((s) => {
      if (source.genre === 'machine') return s.machine === source.id;
      if (source.genre === 'sessions' && source.filtre === 'ouvertes') return estOuverte(s);
      return true;
    })
    .filter((s) => !q || `${s.titre} ${s.projet.nom} ${s.machine}`.toLowerCase().includes(q))
    .toSorted((a, b) => b.majLe.localeCompare(a.majLe));
}

export function titreSource(source: Source, machines: readonly VueMachine[]): string {
  if (source.genre === 'alertes') return 'Alertes';
  if (source.genre === 'comptes') return 'Comptes';
  if (source.genre === 'machine' || source.genre === 'appareil') {
    return machines.find((m) => m.id === source.id)?.id ?? source.id;
  }
  return source.filtre === 'ouvertes' ? 'Sessions ouvertes' : 'Toutes les sessions';
}

export function nonLues(notifications: readonly Notification[]): number {
  return notifications.filter((n) => !n.lue && n.niveau !== 'info').length;
}
