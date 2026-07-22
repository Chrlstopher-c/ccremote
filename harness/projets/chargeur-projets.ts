/**
 * Responsabilité : découverte et chargement des projets déclarés par fichier (F.4).
 *
 * `☠ CASSE` évités ici :
 * - #panne F.4.1/F.4.2 — ajouter un projet = déposer un fichier, aucun redémarrage :
 *   `chargerProjets` relit le répertoire à chaque appel, rien n'est mis en cache
 *   entre deux appels côté ce module.
 * - F.4.3 — un fichier corrompu ne doit dégrader aucun autre projet : chaque
 *   fichier est lu et validé dans son propre `try/catch`, jamais un `Promise.all`
 *   qui ferait échouer le lot entier sur une seule exception.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { projetLogger, projetsLogger } from './logger.ts';
import { validerConfigProjet } from './validation-config.ts';
import type { InterrogateurGit } from './git-projet.ts';
import type { ConfigProjet, ProjetRejete, ResultatChargementProjets } from './types.ts';

export interface DependancesChargeur {
  readonly interrogateurGit: InterrogateurGit;
  /** Injectable en test — défaut : `readdir` réel filtré sur `.json`. */
  readonly listerFichiers?: (repertoireConfig: string) => Promise<readonly string[]>;
  /** Injectable en test — défaut : `readFile` réel en UTF-8. */
  readonly lireFichier?: (chemin: string) => Promise<string>;
}

async function listerFichiersParDefaut(repertoireConfig: string): Promise<readonly string[]> {
  try {
    const entrees = await readdir(repertoireConfig, { withFileTypes: true });
    return entrees.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => join(repertoireConfig, e.name));
  } catch (error) {
    projetsLogger.error({ err: error, repertoireConfig }, 'répertoire de configuration illisible — aucun projet chargé');
    return [];
  }
}

async function lireFichierParDefaut(chemin: string): Promise<string> {
  return readFile(chemin, 'utf-8');
}

interface FichierParse {
  readonly fichier: string;
  readonly brute: unknown;
}

/** Isole une panne de lecture/parsing à un seul fichier — jamais au lot entier. */
async function parserUnFichier(fichier: string, lireFichier: (chemin: string) => Promise<string>): Promise<FichierParse | ProjetRejete> {
  try {
    const texte = await lireFichier(fichier);
    // Annotation plutôt que cast : `JSON.parse` rend `any`, l'annotation force `unknown`
    // sans passer par un `as` — la forme exacte reste à prouver par `validerConfigProjet`.
    const brute: unknown = JSON.parse(texte);
    return { fichier, brute };
  } catch (error) {
    projetsLogger.warn({ err: error, fichier }, 'fichier de projet illisible ou JSON invalide — écarté');
    return { fichierSource: fichier, idPresume: null, echecs: [{ code: 'json_invalide', detail: String(error) }] };
  }
}

function estFichierParse(valeur: FichierParse | ProjetRejete): valeur is FichierParse {
  return 'brute' in valeur;
}

/** Lecture best-effort du seul champ utile avant validation complète — pour le rapport de rejet. */
function idPresumeDe(brute: unknown): string | null {
  if (typeof brute !== 'object' || brute === null) return null;
  // Cast local à la seule fin de lire un champ candidat ; la forme réelle reste
  // à prouver par `validerConfigProjet`, ce champ n'est utilisé qu'en diagnostic.
  const id = (brute as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : null;
}

/**
 * Valide un fichier déjà parsé contre les projets **déjà acceptés dans ce lot**,
 * pour détecter les identifiants dupliqués entre fichiers (F.4.2 — cohérence du
 * triplet). La comparaison est en lecture seule : aucune configuration déjà
 * acceptée n'est modifiée par l'arrivée d'un doublon (F.4.3).
 */
async function validerAvecDoublons(
  parse: FichierParse,
  dejaCharges: ReadonlyMap<string, string>,
  deps: DependancesChargeur,
): Promise<ConfigProjet | ProjetRejete> {
  const idPresume = idPresumeDe(parse.brute);
  if (idPresume !== null && dejaCharges.has(idPresume)) {
    return {
      fichierSource: parse.fichier,
      idPresume,
      echecs: [
        {
          code: 'id_deja_charge_dans_ce_lot',
          detail: `l'id "${idPresume}" est déjà chargé depuis ${dejaCharges.get(idPresume)}.`,
        },
      ],
    };
  }
  const resultat = await validerConfigProjet(parse.brute, parse.fichier, { interrogateurGit: deps.interrogateurGit });
  if (resultat.config !== null) return resultat.config;
  return { fichierSource: parse.fichier, idPresume, echecs: resultat.echecs };
}

function estProjetValide(valeur: ConfigProjet | ProjetRejete): valeur is ConfigProjet {
  return !('echecs' in valeur);
}

/**
 * Découvre et charge tous les projets d'un répertoire. Rechargeable à tout
 * moment (F.4.1) : aucun état n'est conservé entre deux appels par ce module.
 */
export async function chargerProjets(repertoireConfig: string, deps: DependancesChargeur): Promise<ResultatChargementProjets> {
  const lister = deps.listerFichiers ?? listerFichiersParDefaut;
  const lire = deps.lireFichier ?? lireFichierParDefaut;
  const fichiers = await lister(repertoireConfig);

  const projets: ConfigProjet[] = [];
  const rejetes: ProjetRejete[] = [];
  const dejaCharges = new Map<string, string>();

  for (const fichier of fichiers) {
    const parse = await parserUnFichier(fichier, lire);
    if (!estFichierParse(parse)) {
      rejetes.push(parse);
      continue;
    }
    const resultat = await validerAvecDoublons(parse, dejaCharges, deps);
    if (estProjetValide(resultat)) {
      dejaCharges.set(resultat.id, resultat.fichierSource);
      projets.push(resultat);
      projetLogger(resultat.id).info({ fichier }, 'projet chargé et validé');
    } else {
      rejetes.push(resultat);
    }
  }

  projetsLogger.info({ acceptes: projets.length, rejetes: rejetes.length }, 'chargement des projets terminé');
  return { projets, rejetes };
}
