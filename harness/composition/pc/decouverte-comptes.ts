/**
 * Responsabilité : quels comptes Claude cette machine de travail peut-elle
 * réellement utiliser ? Répondu par OBSERVATION du disque, jamais par une liste
 * figée à l'installation.
 *
 * `☠ MESURÉ LE 01/08.` Les comptes venaient d'une variable d'environnement
 * écrite par le script de déploiement, à partir de ce qui existait CE JOUR-LÀ.
 * Chris a authentifié `compte-b` sur le VPS quelques heures après le dernier
 * déploiement : le compte était sur le disque, connecté et fonctionnel, mais
 * `CCREMOTE_PC_COMPTES` ne le mentionnait pas. Conséquences, toutes silencieuses :
 *  - la sonde de quotas ne le mesurait pas ;
 *  - surtout, depuis le correctif H-44 du même jour, la machine résout le
 *    répertoire d'un compte à partir de CETTE liste — un compte absent gardait
 *    donc le chemin envoyé par le Pi (`/home/trinity/…`, un chemin du PC), et le
 *    pré-vol refusait de démarrer l'équipe.
 * Autrement dit : un compte connecté restait INUTILISABLE jusqu'au prochain
 * déploiement, sans que rien ne le dise. Même motif que « écrit, branché sur
 * rien », dans sa variante « installé, puis désynchronisé ».
 *
 * `☠` Le critère est la PRÉSENCE DE CREDENTIALS, pas la présence du dossier. Un
 * répertoire sans `.credentials.json` est un compte non authentifié : l'annoncer
 * disponible ferait échouer une équipe au démarrage, ce qui est pire que de ne
 * pas l'annoncer du tout.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'decouverte-comptes' });

export interface CompteLocal {
  readonly id: string;
  readonly configDir: string;
}

/** Racine par défaut des comptes isolés — la même sur toutes les machines. */
export function racineComptesParDefaut(home: string): string {
  return join(home, '.claude-comptes');
}

/**
 * Comptes RÉELLEMENT authentifiés sous `racine`, triés par identifiant pour que
 * l'ordre ne dépende pas du système de fichiers.
 *
 * `☠` Ne lève jamais : une racine absente rend une liste vide. Sur une machine
 * sans compte, le superviseur doit démarrer et le DIRE, pas refuser de vivre —
 * il sert aussi à explorer des projets et à répondre à l'inventaire.
 */
export async function decouvrirComptes(racine: string): Promise<readonly CompteLocal[]> {
  let entrees: string[];
  try {
    entrees = await readdir(racine);
  } catch {
    log.warn({ racine }, 'racine des comptes illisible — aucune identité Claude disponible sur cette machine');
    return [];
  }

  const trouves: CompteLocal[] = [];
  for (const nom of entrees.sort()) {
    const configDir = join(racine, nom);
    try {
      if (!(await stat(configDir)).isDirectory()) continue;
      await stat(join(configDir, '.credentials.json'));
      trouves.push({ id: nom, configDir });
    } catch {
      // Dossier sans credentials : compte non authentifié. Signalé une fois,
      // jamais en boucle — c'est un état d'installation, pas une panne.
      log.info({ compte: nom }, 'répertoire de compte sans credentials — ignoré (jamais annoncé disponible)');
    }
  }
  return trouves;
}

/**
 * Format hérité `id=chemin,id=chemin` de `CCREMOTE_PC_COMPTES`.
 *
 * `☠` Conservé comme SURCHARGE explicite, plus comme source de vérité : il
 * permet encore de pointer des répertoires hors de la racine standard (bancs,
 * installation atypique). Renseigné, il l'emporte — et c'est dit au démarrage,
 * sinon on chercherait longtemps pourquoi un compte fraîchement connecté est
 * ignoré.
 */
export function analyserComptesEnv(brut: string | undefined): readonly CompteLocal[] {
  return (brut ?? '')
    .split(',')
    .map((paire) => paire.trim())
    .filter((paire) => paire.includes('='))
    .map((paire) => ({ id: paire.slice(0, paire.indexOf('=')), configDir: paire.slice(paire.indexOf('=') + 1) }));
}

/** La liste effective : la surcharge si elle existe, l'observation du disque sinon. */
export async function comptesDeLaMachine(
  racine: string,
  surcharge: string | undefined,
): Promise<readonly CompteLocal[]> {
  const explicite = analyserComptesEnv(surcharge);
  if (explicite.length > 0) {
    log.warn(
      { comptes: explicite.map((c) => c.id), racine },
      'CCREMOTE_PC_COMPTES renseigné — liste FIGÉE, le disque n’est PAS relu. Un compte authentifié plus tard sera ignoré : le retirer pour revenir à la découverte automatique',
    );
    return explicite;
  }
  const decouverts = await decouvrirComptes(racine);
  log.info({ comptes: decouverts.map((c) => c.id), racine }, 'comptes découverts sur cette machine');
  return decouverts;
}
