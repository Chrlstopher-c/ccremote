// Responsabilité : les vues dérivées de l'état du monde (sessions actives, projets avec leur nombre de sessions).
// Pures : elles lisent un EtatMonde et ne gardent rien.
import type { Projet, ResumeSession } from './contrat';
import type { EtatMonde } from './monde-etat';

export interface ProjetVue {
  readonly projet: Projet;
  readonly sessions: number;
}

export function sessionsActives(etat: EtatMonde): ResumeSession[] {
  return etat.sessions.filter((s) => !s.archivee);
}

export function sessionParId(etat: EtatMonde, id: string): ResumeSession | undefined {
  return etat.sessions.find((s) => s.id === id);
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
