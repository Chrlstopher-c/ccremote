// Responsabilité : ce qu'un nœud envoie pour une synchronisation accordée (le seul périmètre demandé) et ce
// qu'il applique à réception — une fusion : rien de local n'est effacé, les inconnus sont ignorés et comptés.
import { type Categorie, NOMBRE_MAX_CATEGORIES } from '../../commun/categories.ts';
import type { GroupeMasque } from '../../commun/groupes-masques.ts';
import { type PaquetSynchro, type PerimetreSynchro } from '../../commun/synchro.ts';
import type { Registre } from '../registre/registre.ts';

/** Même préfixe que l'interface pour les groupes « catégorie » (clé = préfixe + identifiant de catégorie). */
const PREFIXE_CATEGORIE = 'categorie:';

export interface BilanFusion {
  readonly appliques: number;
  readonly dejaPresents: number;
  readonly ignores: number;
}

export interface ResultatFusion {
  readonly bilan: BilanFusion;
  /** Sessions dont l'épinglage a changé : à diffuser aux clients. */
  readonly sessions: readonly string[];
}

interface Compte {
  appliques: number;
  dejaPresents: number;
  ignores: number;
}

export function construirePaquet(registre: Registre, id: string, quoi: readonly PerimetreSynchro[]): PaquetSynchro {
  const paquet: PaquetSynchro = { t: 'paquet', id };
  if (quoi.includes('favoris')) paquet.favoris = registre.sessions(false).filter((s) => s.epinglee).map((s) => s.id);
  if (quoi.includes('categories')) paquet.categories = registre.categories();
  if (quoi.includes('masquees')) paquet.masquees = registre.groupesMasques();
  return paquet;
}

export function appliquerPaquet(registre: Registre, paquet: PaquetSynchro): ResultatFusion {
  const compte: Compte = { appliques: 0, dejaPresents: 0, ignores: 0 };
  const epinglees = appliquerFavoris(registre, paquet.favoris ?? [], compte);
  appliquerCategories(registre, paquet.categories ?? [], compte);
  appliquerMasquees(registre, paquet.masquees ?? [], compte);
  return { bilan: { ...compte }, sessions: epinglees };
}

function appliquerFavoris(registre: Registre, ids: readonly string[], compte: Compte): string[] {
  const changees: string[] = [];
  for (const id of ids) {
    const session = registre.session(id);
    if (!session) {
      compte.ignores += 1;
    } else if (session.epinglee) {
      compte.dejaPresents += 1;
    } else {
      registre.definirEpinglee(id, true);
      compte.appliques += 1;
      changees.push(id);
    }
  }
  return changees;
}

function appliquerCategories(registre: Registre, distantes: readonly Categorie[], compte: Compte): void {
  const locales = registre.categories().map((c) => ({ ...c, sessions: [...c.sessions] }));
  const rangees = new Set(locales.flatMap((c) => c.sessions));
  for (const distante of distantes) {
    const cible = trouverOuCreer(locales, distante, compte);
    if (!cible) continue;
    for (const id of distante.sessions) rangerSession(registre, cible, id, rangees, compte);
  }
  registre.enregistrerCategories(locales);
}

/** Une catégorie absente est créée (nom et repli venus du distant) ; une présente garde les siens. */
function trouverOuCreer(locales: Categorie[], distante: Categorie, compte: Compte): Categorie | null {
  const existante = locales.find((c) => c.id === distante.id);
  if (existante) return existante;
  if (locales.length >= NOMBRE_MAX_CATEGORIES) {
    compte.ignores += distante.sessions.length;
    return null;
  }
  const creee: Categorie = { id: distante.id, nom: distante.nom, replie: distante.replie, sessions: [] };
  locales.push(creee);
  compte.appliques += 1;
  return creee;
}

function rangerSession(registre: Registre, cible: Categorie, id: string, rangees: Set<string>, compte: Compte): void {
  if (!registre.session(id)) {
    compte.ignores += 1;
  } else if (rangees.has(id)) {
    compte.dejaPresents += 1;
  } else {
    cible.sessions.push(id);
    rangees.add(id);
    compte.appliques += 1;
  }
}

function appliquerMasquees(registre: Registre, distants: readonly GroupeMasque[], compte: Compte): void {
  const locaux = registre.groupesMasques();
  const machines = new Set(registre.machines().map((m) => m.id));
  const categories = new Set(registre.categories().map((c) => c.id));
  for (const groupe of distants) {
    if (locaux.some((l) => l.cle === groupe.cle)) {
      compte.dejaPresents += 1;
    } else if (groupeConnu(groupe, machines, categories)) {
      locaux.push(groupe);
      compte.appliques += 1;
    } else {
      compte.ignores += 1;
    }
  }
  registre.enregistrerGroupesMasques(locaux);
}

function groupeConnu(groupe: GroupeMasque, machines: ReadonlySet<string>, categories: ReadonlySet<string>): boolean {
  if (groupe.genre === 'categorie') {
    return groupe.cle.startsWith(PREFIXE_CATEGORIE) && categories.has(groupe.cle.slice(PREFIXE_CATEGORIE.length));
  }
  return groupe.machine !== null && machines.has(groupe.machine);
}
