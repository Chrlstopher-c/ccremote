// Responsabilité : les vues dérivées de l'état du monde (sessions actives, projets avec leur nombre de sessions).
// Pures : elles lisent un EtatMonde et ne gardent rien.
import type { Projet, Reunion, ResumeSession } from './contrat';
import type { EtatMonde } from './monde-etat';

export interface ProjetVue {
  readonly projet: Projet;
  readonly sessions: number;
}

/** Une session fermée reste visible un jour (« a fini »), puis seul l'historique la garde. */
export const FERMEE_VISIBLE_MS = 24 * 3600 * 1000;
/** Plafond du monde : la prod garde des milliers de sessions fermées, le monde n'en montre que les plus récentes. */
export const SESSIONS_MAX = 40;

/** Une session lue dans le monde, avec l'état joignable de sa machine ; `machineEnLigne` absent = machine inconnue. */
export type SessionMonde = ResumeSession & { readonly machineEnLigne?: boolean };

// Vue relue à chaque lecture (comme l'inactivité côté relais) : la session porte l'état de sa machine dans l'état.
function enrichir(etat: EtatMonde, s: ResumeSession): SessionMonde {
  const machine = etat.machines.find((m) => m.id === s.machine);
  return machine ? { ...s, machineEnLigne: machine.enLigne } : s;
}

// Sessions du monde : non archivées, vivantes ou fermées depuis moins d'un jour, les plus récentes d'abord retenues.
export function sessionsActives(etat: EtatMonde, maintenant = Date.now()): SessionMonde[] {
  const visibles = etat.sessions.filter((s) => !s.archivee
    && (s.statut !== 'fermee' || maintenant - (Date.parse(s.majLe) || 0) < FERMEE_VISIBLE_MS));
  if (visibles.length <= SESSIONS_MAX) return visibles.map((s) => enrichir(etat, s));
  const recentes = new Set([...visibles].sort((a, b) => b.majLe.localeCompare(a.majLe)).slice(0, SESSIONS_MAX));
  return visibles.filter((s) => recentes.has(s)).map((s) => enrichir(etat, s));
}

// Réunions de la plus récente à la plus ancienne : la date de dernier message, à défaut la date de création.
export function reunionsTriees(etat: EtatMonde): Reunion[] {
  const activite = (r: Reunion): number => Date.parse(r.messages.at(-1)?.ts ?? r.creeLe) || 0;
  return Object.values(etat.reunions).sort((a, b) => activite(b) - activite(a));
}

export function sessionParId(etat: EtatMonde, id: string): SessionMonde | undefined {
  const s = etat.sessions.find((x) => x.id === id);
  return s ? enrichir(etat, s) : undefined;
}

// Projets connus des machines et des sessions ; le compte ne retient que les sessions actives.
export function projetsDuMonde(etat: EtatMonde): ProjetVue[] {
  const actives = sessionsActives(etat);
  const projets = new Map<string, Projet>();
  for (const m of etat.machines) for (const p of m.projets) projets.set(cle(p), p);
  for (const s of etat.sessions) projets.set(cle(s.projet), s.projet);
  return [...projets.values()].map((projet) => ({
    projet,
    sessions: actives.filter((s) => cle(s.projet) === cle(projet)).length,
  }));
}

function cle(projet: Projet): string {
  return `${projet.machine}|${projet.chemin}`;
}
