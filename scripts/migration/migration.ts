// Responsabilité : orchestrer une migration de fiches — source ouverte en lecture seule, cible mise au dernier schéma,
// toutes les écritures dans une seule transaction (rien ne reste si une étape échoue), simulation sur une copie.
import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';
import type { Logger } from 'pino';
import { MIGRATIONS, ouvrirBase } from '../../relais/registre/base.ts';
import { copierEnvironnements, copierMachinesSsh } from './machines.ts';
import type { OptionsMigration } from './options.ts';
import type { Rapport } from './rapport.ts';
import { copierSessions } from './sessions.ts';

export function migrerFiches(opts: OptionsMigration, journal: Logger): Rapport {
  const travail = opts.simulation ? copieDeSimulation(opts.cible) : opts.cible;
  const source = ouvrirSource(opts.source);
  try {
    const cible = ouvrirBase(travail);
    try {
      const bilan = cible.transaction(() => executer(source, cible, opts, journal))();
      return { simulation: opts.simulation, cible: opts.cible, machineLocale: opts.machineLocale, ...bilan };
    } finally {
      cible.close();
    }
  } finally {
    source.close();
    if (opts.simulation) supprimerCopie(travail);
  }
}

function executer(
  source: Database,
  cible: Database,
  opts: OptionsMigration,
  journal: Logger,
): Omit<Rapport, 'simulation' | 'cible' | 'machineLocale'> {
  const fiches = copierSessions(source, cible, journal);
  const environnements = copierEnvironnements(source, cible);
  const machines = copierMachinesSsh(source, cible, opts.machineLocale, opts.tour);
  return {
    sessions: fiches.sessions,
    evenements: fiches.evenements,
    artefacts: fiches.artefacts,
    environnements,
    machinesSsh: { ...machines.compte, retirees: machines.retirees },
  };
}

// La source est une copie du relais de la tour : lue seule, et seulement au schéma que ce code connaît.
function ouvrirSource(chemin: string): Database {
  if (!existsSync(chemin)) throw new Error(`source introuvable : ${chemin}`);
  const source = new Database(chemin, { readonly: true, strict: true });
  const { user_version: version } = source.query('PRAGMA user_version').get() as { user_version: number };
  if (version !== MIGRATIONS.length) {
    source.close();
    throw new Error(`source au schéma ${version}, attendu ${MIGRATIONS.length} : la mettre à jour avant migration`);
  }
  return source;
}

// Simulation : la cible est copiée à côté (VACUUM INTO, cohérent même avec un journal WAL) ; seule la copie est écrite.
function copieDeSimulation(cible: string): string {
  const copie = `${cible}.simulation-${process.pid}.db`;
  supprimerCopie(copie);
  if (existsSync(cible)) {
    const origine = new Database(cible, { readonly: true });
    try {
      origine.run('VACUUM INTO ?', [copie]);
    } finally {
      origine.close();
    }
  }
  return copie;
}

function supprimerCopie(chemin: string): void {
  for (const suffixe of ['', '-wal', '-shm']) rmSync(`${chemin}${suffixe}`, { force: true });
}
