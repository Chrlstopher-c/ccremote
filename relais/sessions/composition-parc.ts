// Responsabilité : ce qu'une session a le droit de joindre depuis sa machine. Pur.
// Règle de Chris (28/09) : une machine isolée (le VPS) ne joint rien de la maison ; la maison joint le VPS.
import type { DemandeSession, Projet } from '../../commun/session.ts';
import type { FicheMachine } from '../registre/registre.ts';

type Parc = DemandeSession['parc'];

export function parcPour(machineCible: string, machines: readonly FicheMachine[], isolees: ReadonlySet<string>): Parc {
  const visibles = isolees.has(machineCible) ? machines.filter((m) => m.id === machineCible) : machines;
  return visibles.map((m) => ({ id: m.id, description: m.description, racines: m.racines }));
}

export function verifierOuverture(machineCible: string, projet: Projet, isolees: ReadonlySet<string>): string | null {
  if (isolees.has(machineCible) && projet.machine !== machineCible) {
    return `${machineCible} est isolée : elle ne peut pas travailler sur un projet de ${projet.machine}`;
  }
  return null;
}
