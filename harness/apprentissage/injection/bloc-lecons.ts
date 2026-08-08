/**
 * Responsabilité : composer le bloc de leçons à injecter dans le mandat d'une équipe (C-6,
 * SPEC §5.6) — LE mécanisme de PUSH qui fait qu'une équipe démarre en sachant, sans avoir
 * rien demandé. Auto-suffisant : ouvre elle-même sa base en lecture seule, ne lève jamais.
 *
 * `☠` Zéro leçon ⇒ chaîne vide, jamais un en-tête sans contenu (SPEC §5, C-6 `☠`).
 * `☠` Base absente/inaccessible ⇒ chaîne vide, jamais une exception — ce mécanisme est
 * appelé à CHAQUE dispatch d'équipe ; il ne doit jamais empêcher un worker de démarrer
 * (même invariant que E6, étendu au chemin de composition).
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { listerLeconsServables } from '../base/lecons.ts';
import { fermerBaseApprentissage, ouvrirBaseApprentissage } from '../base/connexion.ts';
import { journal } from '../logger.ts';
import type { Lecon } from '../types.ts';

const MAX_LECONS_SERVIES = 5;
/** Budget de caractères du bloc entier (SPEC §5.6 : 1 200 au total, compétences incluses — E8 pas encore livré). */
const MAX_CARACTERES_BLOC = 1_200;

const TITRE = 'CE QUE LES ÉQUIPES PRÉCÉDENTES ONT APPRIS SUR CE PROJET';
// ☠ Phrase non décorative (SPEC §5, C-6 `☠`) : elle alimente les contradictions de C-5 —
// ne jamais la retirer ni la reformuler.
const SOUS_TITRE = "(observations automatiques, confirmées au moins deux fois — contredis-les si tu constates l'inverse)";

function formaterDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function formaterLigne(lecon: Lecon): string {
  return `· ${lecon.enonce} [confirmée ${lecon.confirmations}×, dernière le ${formaterDate(lecon.derniereConfirmationA)}]`;
}

/** Assemble le bloc sous la borne de caractères — retire des lignes de la fin si nécessaire. */
function assemblerSousBudget(lignes: readonly string[]): string {
  for (let n = lignes.length; n >= 1; n -= 1) {
    const bloc = [TITRE, SOUS_TITRE, ...lignes.slice(0, n)].join('\n');
    if (bloc.length <= MAX_CARACTERES_BLOC) return bloc;
  }
  return '';
}

/**
 * Compose le bloc de leçons `active` servables à `projet` (et `machine`, si fourni) — trié
 * par confirmations décroissantes puis récence (déjà l'ordre de `listerLeconsServables`).
 * Ne lève JAMAIS : toute panne (base absente, verrouillée, corrompue) rend une chaîne vide.
 */
export function composerBlocLecons(projet: string, machine: string | null = null): string {
  let db: Database;
  try {
    db = ouvrirBaseApprentissage({ lectureSeule: true });
  } catch (erreur) {
    journal.debug({ err: erreur, projet }, 'bloc de leçons : base inaccessible — bloc vide, jamais bloquant');
    return '';
  }
  try {
    const lecons = listerLeconsServables(db, projet, machine).slice(0, MAX_LECONS_SERVIES);
    if (lecons.length === 0) return '';
    return assemblerSousBudget(lecons.map(formaterLigne));
  } catch (erreur) {
    journal.debug({ err: erreur, projet }, 'bloc de leçons : lecture en échec — bloc vide, jamais bloquant');
    return '';
  } finally {
    try {
      fermerBaseApprentissage(db);
    } catch {
      // Fermeture best-effort : le process ne dépend d'aucun effet de cette fermeture.
    }
  }
}
