#!/usr/bin/env bun
// Responsabilité : point d'entrée de la migration des fiches du relais de la tour vers la base du relais intégré.
import { creerJournal } from '../../commun/journal.ts';
import { AIDE, estAide, lireOptions } from './options.ts';
import { migrerFiches } from './migration.ts';
import { formaterRapport } from './rapport.ts';

// La sortie d'une commande est son rapport ; les journaux vont par le logger (pino).
function sortie(texte: string): void {
  process.stdout.write(`${texte}\n`);
}

function erreurCli(texte: string): void {
  process.stderr.write(`${texte}\n`);
}

function principal(argv: readonly string[]): number {
  if (estAide(argv)) {
    sortie(AIDE);
    return 0;
  }
  try {
    const rapport = migrerFiches(lireOptions(argv), creerJournal('migrer-fiches'));
    for (const ligne of formaterRapport(rapport)) sortie(ligne);
    return 0;
  } catch (erreur) {
    erreurCli(`migrer-fiches : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    erreurCli(AIDE);
    return 1;
  }
}

process.exitCode = principal(process.argv.slice(2));
