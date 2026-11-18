// Responsabilité : ne garder d'un transcript que la branche active. Après un rembobinage, la suite abandonnée reste
// écrite dans le fichier (et la duplication la recopie) ; la conversation réelle est la chaîne des `parentUuid`
// remontée depuis la dernière entrée. Pur, sans I/O.
import type { Ligne } from './traduction.ts';

const CHAINEES = new Set(['user', 'assistant', 'attachment', 'system']);

const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const chainee = (l: Ligne): boolean => CHAINEES.has(String(l.type)) && l.isSidechain !== true;

function derniereChainee(lignes: readonly Ligne[]): Ligne | undefined {
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const l = lignes[i];
    if (l && chainee(l) && texte(l.uuid) !== null) return l;
  }
  return undefined;
}

// Les lignes hors de la conversation (titre, métadonnées) restent ; une entrée chaînée du fil principal n'est gardée
// que si elle est sur la chaîne de la dernière. Sans uuid exploitable, rien n'est retiré.
export function brancheActive(lignes: readonly Ligne[]): Ligne[] {
  const parUuid = new Map<string, Ligne>();
  for (const l of lignes) {
    const uuid = texte(l.uuid);
    if (uuid && chainee(l)) parUuid.set(uuid, l);
  }
  const actives = new Set<string>();
  let courant: Ligne | undefined = derniereChainee(lignes);
  if (!courant) return [...lignes];
  while (courant) {
    const uuid = texte(courant.uuid);
    if (!uuid || actives.has(uuid)) break;
    actives.add(uuid);
    const parent: string | null = texte(courant.parentUuid) ?? texte(courant.logicalParentUuid);
    courant = parent ? parUuid.get(parent) : undefined;
  }
  return lignes.filter((l) => {
    const uuid = texte(l.uuid);
    return !chainee(l) || uuid === null || actives.has(uuid);
  });
}
