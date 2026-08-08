/**
 * Responsabilité : écrire sur disque une copie FRAÎCHE du projet piégé, et fournir
 * le chemin jetable — sous `os.tmpdir()` — où l'écrire.
 *
 * `☠` Sécurité de la suppression : `preparerProjet` n'efface jamais un chemin
 * arbitraire. `racine` n'est supprimée que si son chemin absolu est déjà sous le
 * dossier temporaire dédié de l'expérience (`racineJetable('')`'s parent) — jamais
 * un glob, jamais un chemin fourni tel quel sans vérification.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { GABARIT_PROJET_PIEGE } from './projet-piege.ts';

/** Dossier dédié : jamais partagé avec un autre usage de `os.tmpdir()`. */
const DOSSIER_JETABLE = 'ccremote-demo-apprentissage';

/** Seul dossier sous lequel `preparerProjet` a le droit de supprimer quoi que ce soit. */
const RACINE_JETABLE_AUTORISEE = join(tmpdir(), DOSSIER_JETABLE);

export function racineJetable(id: string): string {
  return join(RACINE_JETABLE_AUTORISEE, id);
}

/**
 * Lève si `racine` n'est pas déjà sous le dossier temporaire dédié de
 * l'expérience — la seule identité que cette fonction accepte de supprimer.
 */
function verifierChemin(racine: string): string {
  const absolue = resolve(racine);
  const autorise = resolve(RACINE_JETABLE_AUTORISEE);
  if (absolue !== autorise && !absolue.startsWith(autorise + sep)) {
    throw new Error(
      `preparerProjet : refus de toucher à « ${absolue} » — hors du dossier ` +
        `temporaire dédié « ${autorise} ». Utilise racineJetable() pour construire le chemin.`,
    );
  }
  return absolue;
}

async function nettoyerSiExistante(racine: string): Promise<void> {
  try {
    await rm(racine, { recursive: true, force: true });
  } catch (erreur) {
    console.error(`[preparation] échec du nettoyage de ${racine} :`, erreur);
    throw erreur;
  }
}

async function ecrireFichier(racine: string, cheminRelatif: string, contenu: string): Promise<void> {
  const cheminAbsolu = join(racine, cheminRelatif);
  try {
    await mkdir(dirname(cheminAbsolu), { recursive: true });
    await writeFile(cheminAbsolu, contenu, 'utf8');
  } catch (erreur) {
    console.error(`[preparation] échec d'écriture de ${cheminAbsolu} :`, erreur);
    throw erreur;
  }
}

/**
 * Écrit sur disque, à neuf, tous les fichiers de `GABARIT_PROJET_PIEGE`. Si
 * `racine` existe déjà, elle est supprimée d'abord — uniquement si elle est déjà
 * sous le dossier temporaire dédié (voir `verifierChemin`), sinon lève.
 */
export async function preparerProjet(racine: string): Promise<void> {
  const absolue = verifierChemin(racine);
  await nettoyerSiExistante(absolue);
  for (const [cheminRelatif, contenu] of Object.entries(GABARIT_PROJET_PIEGE)) {
    await ecrireFichier(absolue, cheminRelatif, contenu);
  }
}
