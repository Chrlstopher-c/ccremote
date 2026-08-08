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
import { cheminCompetencesParDefaut, listerCompetencesServables } from '../competences/depot-competences.ts';
import { journal } from '../logger.ts';
import type { Competence, Lecon } from '../types.ts';

const MAX_LECONS_SERVIES = 5;
/** SPEC §5.8 : 10 compétences au maximum dans l'index. */
const MAX_COMPETENCES_SERVIES = 10;
/** Budget de caractères du bloc entier, leçons ET compétences incluses (SPEC §5.6). */
const MAX_CARACTERES_BLOC = 1_200;

const TITRE = 'CE QUE LES ÉQUIPES PRÉCÉDENTES ONT APPRIS SUR CE PROJET';
// ☠ Phrase non décorative (SPEC §5, C-6 `☠`) : elle alimente les contradictions de C-5 —
// ne jamais la retirer ni la reformuler.
const SOUS_TITRE = "(observations automatiques, confirmées au moins deux fois — contredis-les si tu constates l'inverse)";
const TITRE_COMPETENCES = 'PROCÉDURES DÉJÀ ÉCRITES POUR CE PROJET — ouvre le fichier si ta tâche en relève';

function formaterDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function formaterLigneLecon(lecon: Lecon): string {
  return `· ${lecon.enonce} [confirmée ${lecon.confirmations}×, dernière le ${formaterDate(lecon.derniereConfirmationA)}]`;
}

/** Une ligne par compétence — nom, description et chemin absolu (E8, extension de C-6). */
function formaterLigneCompetence(racine: string, competence: Competence): string {
  const chemin = `${racine}/${competence.slug}/COMPETENCE.md`;
  return `· ${competence.nom} — ${competence.description} — ${chemin}`;
}

/**
 * Assemble le bloc (titre leçons + lignes de leçons, puis titre compétences + lignes de
 * compétences) sous la borne de caractères — retire d'abord des lignes de compétences (la
 * partie la plus périphérique), puis des lignes de leçons, jamais les titres eux-mêmes tant
 * qu'ils portent au moins une ligne.
 */
function assemblerSousBudget(lignesLecons: readonly string[], lignesCompetences: readonly string[]): string {
  for (let nCompetences = lignesCompetences.length; nCompetences >= 0; nCompetences -= 1) {
    for (let nLecons = lignesLecons.length; nLecons >= 1; nLecons -= 1) {
      const bloc = construireBloc(lignesLecons.slice(0, nLecons), lignesCompetences.slice(0, nCompetences));
      if (bloc.length <= MAX_CARACTERES_BLOC) return bloc;
    }
  }
  return '';
}

function construireBloc(lignesLecons: readonly string[], lignesCompetences: readonly string[]): string {
  const blocLecons = [TITRE, SOUS_TITRE, ...lignesLecons];
  if (lignesCompetences.length === 0) return blocLecons.join('\n');
  return [...blocLecons, '', TITRE_COMPETENCES, ...lignesCompetences].join('\n');
}

/**
 * Compose le bloc de leçons `active` et de compétences `active` servables à `projet` (et
 * `machine`, si fourni) — leçons triées par confirmations décroissantes puis récence (déjà
 * l'ordre de `listerLeconsServables`), compétences par confirmations décroissantes.
 * Ne lève JAMAIS : toute panne (base absente, verrouillée, corrompue, dossier de compétences
 * inaccessible) rend une chaîne vide, jamais un bloc partiel bloquant.
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
    const racineCompetences = cheminCompetencesParDefaut();
    const competences = listerCompetencesSansLever(racineCompetences, projet).slice(0, MAX_COMPETENCES_SERVIES);
    return assemblerSousBudget(
      lecons.map(formaterLigneLecon),
      competences.map((c) => formaterLigneCompetence(racineCompetences, c)),
    );
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

/** `☠` Zéro leçon ⇒ on n'a déjà rien renvoyé plus haut ; un dossier de compétences absent ne doit jamais faire échouer le bloc. */
function listerCompetencesSansLever(racine: string, projet: string): readonly Competence[] {
  try {
    return listerCompetencesServables(racine, projet);
  } catch (erreur) {
    journal.debug({ err: erreur, projet }, 'index de compétences : lecture en échec — omis, jamais bloquant');
    return [];
  }
}
