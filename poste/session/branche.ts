// Responsabilité : ne garder d'un transcript que la branche active. Après un rembobinage, la suite abandonnée reste
// écrite dans le fichier (et la duplication la recopie) ; la conversation réelle est la chaîne des `parentUuid`
// remontée depuis la dernière entrée. Pur, sans I/O.
import type { Ligne } from './traduction.ts';

const CHAINEES = new Set(['user', 'assistant', 'attachment', 'system']);

const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const chainee = (l: Ligne | undefined): boolean =>
  l !== undefined && CHAINEES.has(String(l.type)) && l.isSidechain !== true;
const frontiere = (l: Ligne): boolean => l.type === 'system' && l.subtype === 'compact_boundary';

function indiceDerniere(lignes: readonly Ligne[]): number | undefined {
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const l = lignes[i];
    if (chainee(l) && texte(l?.uuid) !== null) return i;
  }
  return undefined;
}

// Frontière de compaction dont le message précédent n'est pas écrit (écriture interrompue) : la suite se rattache
// au message chaîné écrit juste avant dans le fichier, sans quoi tout ce qui précède la compaction disparaît.
function precedentEcrit(lignes: readonly Ligne[], avant: number, actives: ReadonlySet<number>): number | undefined {
  for (let i = avant - 1; i >= 0; i -= 1) {
    if (chainee(lignes[i]) && texte(lignes[i]?.uuid) !== null && !actives.has(i)) return i;
  }
  return undefined;
}

function suivant(
  lignes: readonly Ligne[],
  i: number,
  parUuid: ReadonlyMap<string, number>,
  actives: ReadonlySet<number>,
): number | undefined {
  const l = lignes[i];
  if (!l) return undefined;
  const parent = texte(l.parentUuid) ?? texte(l.logicalParentUuid);
  const trouve = parent === null ? undefined : parUuid.get(parent);
  if (trouve !== undefined) return trouve;
  return frontiere(l) ? precedentEcrit(lignes, i, actives) : undefined;
}

// Les lignes hors de la conversation (titre, métadonnées) restent ; une entrée chaînée du fil principal n'est
// gardée que si elle est sur la chaîne de la dernière. Sans uuid exploitable, rien n'est retiré.
export function brancheActive(lignes: readonly Ligne[]): Ligne[] {
  const parUuid = new Map<string, number>();
  lignes.forEach((l, i) => {
    const uuid = texte(l.uuid);
    if (uuid && chainee(l)) parUuid.set(uuid, i);
  });
  const dernier = indiceDerniere(lignes);
  if (dernier === undefined) return [...lignes];
  const actives = new Set<number>();
  let courant: number | undefined = dernier;
  while (courant !== undefined && !actives.has(courant)) {
    actives.add(courant);
    courant = suivant(lignes, courant, parUuid, actives);
  }
  const appels = new Set(appelsDe(lignes, actives));
  return lignes.filter((l, i) => !chainee(l) || texte(l.uuid) === null || actives.has(i) || reponseA(l, appels));
}

// Un appel d'outil de la branche active garde sa réponse même si le CLI l'a écrite sur un embranchement voisin.
function appelsDe(lignes: readonly Ligne[], actives: ReadonlySet<number>): string[] {
  const ids: string[] = [];
  lignes.forEach((l, i) => {
    if (!actives.has(i) || l.type !== 'assistant') return;
    for (const b of blocs(l.message?.content))
      if (b.type === 'tool_use' && texte(b.id) !== null) ids.push(String(b.id));
  });
  return ids;
}

function reponseA(l: Ligne, appels: ReadonlySet<string>): boolean {
  return (
    l.type === 'user' &&
    blocs(l.message?.content).some((b) => b.type === 'tool_result' && appels.has(String(b.tool_use_id)))
  );
}

function blocs(contenu: unknown): Record<string, unknown>[] {
  return Array.isArray(contenu)
    ? contenu.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null && 'type' in b)
    : [];
}

/** Entrée précédente de la ligne dans la conversation (à travers une compaction : la liaison logique). */
const parentDe = (l: Ligne): string | null => texte(l.parentUuid) ?? texte(l.logicalParentUuid);

/** Fin connue d'un transcript : dernière ligne chaînée écrite. Suffit à prolonger la branche sans la relire. */
export interface EtatChaine {
  tip: string | null;
}

export function etatDeBranche(lignes: readonly Ligne[]): EtatChaine {
  const dernier = indiceDerniere(lignes);
  return { tip: dernier === undefined ? null : texte(lignes[dernier]?.uuid) };
}

/**
 * Ajoute en queue des lignes écrites après la branche connue, sans relire le reste. Une ligne chaînée se rattache à la
 * fin, ou est une réponse d'outil : les appels parallèles écrivent leurs réponses vers un bloc antérieur, sans effacer
 * la suite (le relais ne retire jamais un événement). Une ligne d'utilisateur ou d'assistant qui se rattache ailleurs
 * est un rembobinage : false, rien n'est modifié — il faut relire le transcript entier.
 */
export function prolongerBranche(etat: EtatChaine, lignes: readonly Ligne[]): boolean {
  let tip = etat.tip;
  for (const l of lignes) {
    const uuid = texte(l.uuid);
    if (!chainee(l) || uuid === null) continue;
    if (parentDe(l) !== tip && !reponseOutil(l)) return false;
    tip = uuid;
  }
  etat.tip = tip;
  return true;
}

/** Réponse d'un outil : une ligne utilisateur qui porte un `tool_result`. */
function reponseOutil(l: Ligne): boolean {
  return l.type === 'user' && blocs(l.message?.content).some((b) => b.type === 'tool_result');
}
