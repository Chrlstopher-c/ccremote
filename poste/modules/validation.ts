// Responsabilité : valider un dossier de module sur le poste (id, module.json, fichiers, limites) et son empreinte.
// Un module invalide n'est jamais lu au-delà de ce qui sert à le refuser ; aucun lien symbolique n'est suivi.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cheminModuleValide,
  FICHIERS_MAX_MODULE,
  ManifesteModule,
  REGEX_ID_MODULE,
  TAILLE_MAX_MODULE,
} from '../../commun/modules.ts';

export interface FichierLu {
  readonly chemin: string;
  readonly octets: Buffer;
}
export interface ModuleValide {
  readonly manifeste: ManifesteModule;
  readonly fichiers: readonly FichierLu[];
  readonly empreinte: string;
}
export type ResultatValidation =
  | { readonly ok: true; readonly module: ModuleValide }
  | { readonly ok: false; readonly erreur: string };

class ErreurModule extends Error {}

/** Valide le dossier `dossier` nommé `id` : rend le module prêt à envoyer, ou la raison du refus. */
export function validerModule(dossier: string, id: string): ResultatValidation {
  try {
    if (!REGEX_ID_MODULE.test(id)) throw new ErreurModule(`identifiant non conforme : ${id}`);
    const fichiers = lireFichiers(dossier);
    const brut = fichiers.find((f) => f.chemin === 'module.json');
    if (!brut) throw new ErreurModule('module.json absent');
    const manifeste = lireManifeste(brut.octets.toString('utf8'), id);
    if (!fichiers.some((f) => f.chemin === manifeste.point)) {
      throw new ErreurModule(`point introuvable : ${manifeste.point}`);
    }
    return { ok: true, module: { manifeste, fichiers, empreinte: empreinteDe(fichiers) } };
  } catch (erreur) {
    return { ok: false, erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

function lireFichiers(dossier: string): FichierLu[] {
  const chemins: string[] = [];
  parcourir(dossier, '', chemins);
  const tailleTotale = chemins.reduce((somme, c) => somme + lstatSync(join(dossier, c)).size, 0);
  if (tailleTotale > TAILLE_MAX_MODULE) throw new ErreurModule('module trop lourd (2 Mo au plus)');
  return chemins.map((chemin) => ({ chemin, octets: readFileSync(join(dossier, chemin)) }));
}

function parcourir(dossier: string, relatif: string, sortie: string[]): void {
  for (const entree of readdirSync(join(dossier, relatif), { withFileTypes: true })) {
    const chemin = relatif === '' ? entree.name : `${relatif}/${entree.name}`;
    if (entree.isSymbolicLink()) throw new ErreurModule(`lien symbolique refusé : ${chemin}`);
    if (!cheminModuleValide(chemin)) throw new ErreurModule(`chemin refusé : ${chemin}`);
    if (entree.isDirectory()) parcourir(dossier, chemin, sortie);
    else if (entree.isFile()) sortie.push(chemin);
    else throw new ErreurModule(`fichier spécial refusé : ${chemin}`);
    if (sortie.length > FICHIERS_MAX_MODULE) throw new ErreurModule(`plus de ${FICHIERS_MAX_MODULE} fichiers`);
  }
}

function lireManifeste(texte: string, id: string): ManifesteModule {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new ErreurModule('module.json : JSON invalide');
  }
  const lu = ManifesteModule.safeParse(brut);
  if (!lu.success) {
    const details = lu.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ');
    throw new ErreurModule(`module.json : ${details}`);
  }
  if (lu.data.id !== id) throw new ErreurModule(`module.json : id « ${lu.data.id} » ≠ nom du dossier « ${id} »`);
  return lu.data;
}

// Empreinte stable : chemins triés, contenus ensuite. Un changement de n'importe quel fichier la change.
function empreinteDe(fichiers: readonly FichierLu[]): string {
  const hache = createHash('sha256');
  const ordonnes = [...fichiers].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
  for (const f of ordonnes) hache.update(`${f.chemin}\0`).update(f.octets).update('\0');
  return hache.digest('hex');
}
