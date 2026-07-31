/**
 * Responsabilité : laisser le control plane LIRE le contenu d'un fichier des
 * projets qui vivent sur le PC.
 *
 * `☠` Même angle mort que l'exploration, un cran plus loin. `explorer_projets`
 * rend l'ARBORESCENCE du PC à un orchestrateur qui tourne sur le Pi, mais AUCUNE
 * ligne de code : il voyait `src-tauri/` exister sans pouvoir l'ouvrir, et
 * produisait quand même des synthèses « d'après le code » — entièrement
 * aveugles, constaté en prod. Cet outil est ce qui manquait pour que la synthèse
 * porte sur du réel.
 *
 * `☠` LECTURE SEULE, bornée à la MÊME racine que l'exploration, et bornée EN
 * TAILLE. Le confinement n'est pas réécrit ici : il réutilise
 * `resoudreDansRacine` / `estDansRacine` (`exploration-projets.ts`) — une borne
 * de sécurité dupliquée diverge en silence.
 *
 * `☠` Un cran de plus que l'exploration malgré tout : le chemin est résolu
 * PHYSIQUEMENT (`realpathSync`) avant le contrôle final. Neutraliser `..` ne
 * suffit pas quand on rend du contenu — un lien symbolique posé dans
 * `/mnt/projects` et pointant vers `~/.claude/.credentials.json` passe le
 * contrôle lexical sans broncher, et lister son nom est inoffensif là où rendre
 * son contenu ne l'est pas.
 */

import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { estDansRacine, resoudreDansRacine } from './exploration-projets.ts';
import { superviseurLogger } from './logger.ts';

const log = superviseurLogger.child({ composant: 'lecture-fichier' });

/**
 * 200 Ko ≈ 50-60 k tokens : au-delà, un fichier entier n'entre plus utilement
 * dans le contexte d'un modèle, et le rendre coûterait plus qu'il n'apprend.
 * Un fichier plus gros est TRONQUÉ, jamais refusé — la tête d'un gros fichier
 * reste exploitable, et la troncature est toujours annoncée dans `note`.
 */
export const PLAFOND_LECTURE_OCTETS = 200 * 1024;

/** Échantillon inspecté pour trancher texte/binaire : un en-tête suffit. */
const ECHANTILLON_BINAIRE_OCTETS = 8192;

/** Au-delà de cette proportion de caractères de contrôle, le fichier n'est pas du texte. */
const SEUIL_CARACTERES_CONTROLE = 0.1;

export interface ResultatLectureFichier {
  /** `false` ⇒ rien n'a été lu, `note` dit pourquoi. Jamais une exception, jamais un refus muet. */
  readonly ok: boolean;
  readonly racine: string;
  /** Chemin ABSOLU et physique (liens résolus) du fichier lu ou refusé. */
  readonly chemin: string;
  readonly contenu: string;
  /** Taille RÉELLE sur disque, même quand la lecture a été tronquée. */
  readonly octets: number;
  readonly tronque: boolean;
  /** Renseigné dès que la demande est refusée OU tronquée. */
  readonly note?: string;
}

function refus(racine: string, chemin: string, note: string): ResultatLectureFichier {
  return { ok: false, racine, chemin, contenu: '', octets: 0, tronque: false, note };
}

/**
 * Résout la demande dans la racine, liens symboliques compris. Rend le chemin
 * PHYSIQUE, ou la note de refus à rendre telle quelle à l'orchestrateur.
 * Peut lever (accès disque) : l'appelant l'enveloppe.
 */
function resoudreFichier(base: string, demande: string): { readonly chemin: string } | { readonly note: string } {
  const lexical = resoudreDansRacine(base, demande);
  if (lexical === null) return { note: `chemin hors de ${base} — refusé` };
  if (!existsSync(lexical)) return { note: 'fichier inexistant sur le PC' };
  const physique = realpathSync(lexical);
  // `☠` La note ne répète PAS le chemin physique visé : le refus doit dire que
  // la cible sort de la racine, pas révéler où elle mène.
  if (!estDansRacine(realpathSync(base), physique)) {
    return { note: `chemin sortant de ${base} après résolution des liens — refusé` };
  }
  return { chemin: physique };
}

/** Vrai si l'échantillon ressemble à du binaire : un octet NUL, ou trop de caractères de contrôle. */
function ressembleABinaire(echantillon: Uint8Array): boolean {
  if (echantillon.length === 0) return false;
  let controle = 0;
  for (const octet of echantillon) {
    if (octet === 0) return true;
    if (octet < 0x09 || (octet > 0x0d && octet < 0x20)) controle += 1;
  }
  return controle / echantillon.length > SEUIL_CARACTERES_CONTROLE;
}

/**
 * Lit AU PLUS `taille` octets depuis le début. `readFileSync` puis `slice`
 * chargerait d'abord le fichier entier en mémoire — le plafond ne protégerait
 * alors que le lien, pas le PC.
 */
function lireOctets(chemin: string, taille: number): Uint8Array {
  const fd = openSync(chemin, 'r');
  try {
    const tampon = new Uint8Array(taille);
    const lus = readSync(fd, tampon, 0, taille, 0);
    return tampon.subarray(0, lus);
  } finally {
    closeSync(fd);
  }
}

/**
 * `stream: true` n'est pas cosmétique : le plafond peut tomber au milieu d'une
 * séquence UTF-8 multi-octets, et le décodeur retient alors la séquence
 * incomplète au lieu d'émettre un `�` que le modèle prendrait pour du contenu.
 */
function decoder(base: string, chemin: string, octets: number): ResultatLectureFichier {
  const tronque = octets > PLAFOND_LECTURE_OCTETS;
  const brut = lireOctets(chemin, Math.min(octets, PLAFOND_LECTURE_OCTETS));
  if (ressembleABinaire(brut.subarray(0, ECHANTILLON_BINAIRE_OCTETS))) {
    return { ...refus(base, chemin, 'fichier binaire — contenu non rendu'), octets };
  }
  const contenu = new TextDecoder('utf-8').decode(brut, { stream: true });
  const note = `fichier de ${octets} octets TRONQUÉ à ${PLAFOND_LECTURE_OCTETS} — la fin manque`;
  return { ok: true, racine: base, chemin, contenu, octets, tronque, ...(tronque ? { note } : {}) };
}

/** Lit un fichier de la racine. Ne lève JAMAIS : toute erreur devient un refus porteur de sa raison. */
export function lireFichier(racine: string, demande: string): ResultatLectureFichier {
  const base = resolve(racine);
  try {
    if (demande.trim().length === 0) return refus(base, base, 'aucun chemin de fichier demandé');
    const resolution = resoudreFichier(base, demande);
    if ('note' in resolution) return refus(base, base, resolution.note);
    const infos = statSync(resolution.chemin);
    if (infos.isDirectory()) return refus(base, resolution.chemin, 'répertoire — utiliser explorer_projets');
    if (!infos.isFile()) return refus(base, resolution.chemin, 'ni fichier ni répertoire — refusé');
    return decoder(base, resolution.chemin, infos.size);
  } catch (erreur) {
    log.error({ err: erreur, demande }, 'lecture de fichier impossible');
    return refus(base, base, 'fichier illisible sur le PC');
  }
}
