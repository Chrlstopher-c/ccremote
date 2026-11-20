// Responsabilité : une découverte présente sur plusieurs postes (dossier ~/.claude synchronisé) n'en garde qu'une :
// celle de la machine où la conversation tourne réellement, puis celle écrite en dernier. L'ordre de connexion des
// postes ne décide de rien.
import type { Decouverte } from '../../commun/decouverte.ts';

export interface DecouverteDePoste {
  readonly machine: string;
  readonly decouverte: Decouverte;
}

function meilleure(a: DecouverteDePoste, b: DecouverteDePoste): boolean {
  const va = a.decouverte.vivante === true;
  if (va !== (b.decouverte.vivante === true)) return va;
  if (a.decouverte.modifieLe !== b.decouverte.modifieLe) return a.decouverte.modifieLe > b.decouverte.modifieLe;
  return a.machine < b.machine;
}

/** Une découverte par identifiant : la copie vivante, sinon la plus récemment écrite, sinon le plus petit nom de poste. */
export function decouverteParIdentifiant(candidates: readonly DecouverteDePoste[]): Decouverte[] {
  const parId = new Map<string, DecouverteDePoste>();
  for (const c of candidates) {
    const deja = parId.get(c.decouverte.id);
    if (!deja || meilleure(c, deja)) parId.set(c.decouverte.id, c);
  }
  return [...parId.values()].map((c) => ({ ...c.decouverte, machine: c.machine }));
}
