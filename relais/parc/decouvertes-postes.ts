// Responsabilité : une découverte présente sur plusieurs postes (dossier ~/.claude synchronisé) n'en garde qu'une :
// celle de la machine où la conversation tourne réellement (processus, fiche Desktop, dossier existant), puis celle
// écrite en dernier. L'ordre de connexion des postes ne décide de rien.
import type { Decouverte } from '../../commun/decouverte.ts';

export interface DecouverteDePoste {
  readonly machine: string;
  readonly decouverte: Decouverte;
}

/** Rang d'une copie : tenue par un processus, puis désignée par Claude Desktop (sa fiche, locale ou ssh), puis dans un
 *  dossier qui existe sur ce poste (l'autre n'est qu'une copie synchronisée). */
function rang(c: DecouverteDePoste, hotesDesktop: ReadonlySet<string>): number {
  if (c.decouverte.vivante === true) return 3;
  if (hotesDesktop.has(c.machine)) return 2;
  return c.decouverte.cwdExiste === true ? 1 : 0;
}

function meilleure(a: DecouverteDePoste, b: DecouverteDePoste, hotesDesktop: ReadonlySet<string>): boolean {
  const ra = rang(a, hotesDesktop);
  const rb = rang(b, hotesDesktop);
  if (ra !== rb) return ra > rb;
  if (a.decouverte.modifieLe !== b.decouverte.modifieLe) return a.decouverte.modifieLe > b.decouverte.modifieLe;
  return a.machine < b.machine;
}

/** Une découverte par identifiant : la copie de la machine où la conversation tourne vraiment (processus, Desktop,
 *  dossier existant), sinon la plus récemment écrite, sinon le plus petit nom de poste. */
export function decouverteParIdentifiant(candidates: readonly DecouverteDePoste[]): Decouverte[] {
  const hotes = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (!c.decouverte.hoteDesktop) continue;
    const h = hotes.get(c.decouverte.id) ?? new Set<string>();
    h.add(c.decouverte.hoteDesktop);
    hotes.set(c.decouverte.id, h);
  }
  const parId = new Map<string, DecouverteDePoste>();
  for (const c of candidates) {
    const deja = parId.get(c.decouverte.id);
    if (!deja || meilleure(c, deja, hotes.get(c.decouverte.id) ?? new Set())) parId.set(c.decouverte.id, c);
  }
  return [...parId.values()].map((c) => ({ ...c.decouverte, machine: c.machine }));
}
