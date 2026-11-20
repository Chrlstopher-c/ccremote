// Responsabilité : l'échéance d'une tâche planifiée (P7) — fonctions pures sur une heure donnée : prochaine exécution,
// due ou non. Une tâche quotidienne suit l'heure locale du poste. Une tâche inactive n'a pas d'échéance.
import type { Frequence } from '../../commun/reste-lot2.ts';

export interface EcheanceTache {
  readonly active: boolean;
  readonly frequence: Frequence;
  /** Dernière activation (ISO) : base des intervalles et des quotidiennes qui n'ont jamais tourné. */
  readonly activeLe: string | null;
  /** Dernière exécution, tentative réussie ou non. */
  readonly derniere: { readonly le: string } | null;
}

const MINUTE_MS = 60_000;

/** La prochaine exécution, ou null si la tâche est inactive, achevée (unique) ou sans repère (intervalle). */
export function prochaineEcheance(t: EcheanceTache, maintenant: Date): Date | null {
  if (!t.active) return null;
  const f = t.frequence;
  if (f.type === 'unique') return t.derniere === null ? new Date(f.le) : null;
  if (f.type === 'quotidienne') return echeanceQuotidienne(f.heure, t, maintenant);
  const repere = t.derniere?.le ?? t.activeLe;
  return repere === null ? null : new Date(new Date(repere).getTime() + f.minutes * MINUTE_MS);
}

/** Vrai quand l'échéance est atteinte à `maintenant` (et pas avant). */
export function estDue(t: EcheanceTache, maintenant: Date): boolean {
  const echeance = prochaineEcheance(t, maintenant);
  return echeance !== null && echeance.getTime() <= maintenant.getTime();
}

// L'heure du jour, sauf si elle a déjà servi aujourd'hui ou si la tâche a été activée après : alors demain.
function echeanceQuotidienne(heure: string, t: EcheanceTache, maintenant: Date): Date {
  const [h, m] = heure.split(':').map(Number) as [number, number];
  const annee = maintenant.getFullYear();
  const mois = maintenant.getMonth();
  const jour = maintenant.getDate();
  const aujourdhui = new Date(annee, mois, jour, h, m);
  const demain = new Date(annee, mois, jour + 1, h, m);
  const dejaLancee = t.derniere !== null && memeJour(new Date(t.derniere.le), maintenant);
  const activeeApres = t.activeLe !== null && new Date(t.activeLe).getTime() >= aujourdhui.getTime();
  return dejaLancee || activeeApres ? demain : aujourdhui;
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
