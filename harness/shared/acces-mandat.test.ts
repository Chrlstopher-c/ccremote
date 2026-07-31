import { describe, expect, test } from 'bun:test';
import {
  ACCES_DEFAUT,
  estAccesMandat,
  messageAccesInconnu,
  normaliserAcces,
  outilsRefusesPour,
} from './acces-mandat.ts';

describe('accès d’un mandat — un droit, pas une phrase', () => {
  test('`lecture` refuse les outils d’écriture de fichiers', () => {
    const refuses = outilsRefusesPour('lecture');
    for (const outil of ['Write', 'Edit', 'NotebookEdit']) expect(refuses).toContain(outil);
  });

  test('☠ `lecture` LAISSE Bash — décision de Chris, pas un oubli', () => {
    // « Lecture seule » borne l'écriture de FICHIERS, pas l'exécution de
    // commandes : un agent d'exploration travaille au shell (`rg`, `git log`,
    // `find`) et l'en priver le rend infirme, pas sûr. Une écriture reste
    // possible via `sed -i` ou `> fichier`, mais elle ne peut alors pas être
    // accidentelle — et le plancher de déni (H-41) couvre le catastrophique.
    // Ce test existe pour qu'un « durcissement » futur échoue bruyamment et
    // aille relire le motif plutôt que de le redécouvrir.
    expect(outilsRefusesPour('lecture')).not.toContain('Bash');
  });

  test('`ecriture` n’ajoute AUCUN refus — le plancher reste seul maître', () => {
    expect(outilsRefusesPour('ecriture')).toEqual([]);
  });

  test('☠ le défaut est le plus restrictif — un oubli de câblage retire des droits', () => {
    expect(ACCES_DEFAUT).toBe('lecture');
    expect(outilsRefusesPour(ACCES_DEFAUT).length).toBeGreaterThan(0);
  });
});

describe('normalisation — la sortie d’un modèle est une entrée utilisateur', () => {
  test('accepte les formes qu’un modèle écrit spontanément', () => {
    for (const forme of ['lecture', 'Lecture Seule', 'read-only', 'READONLY', 'ro', 'read'])
      expect(normaliserAcces(forme)).toBe('lecture');
    for (const forme of ['ecriture', 'Écriture', 'read-write', 'rw', 'write'])
      expect(normaliserAcces(forme)).toBe('ecriture');
  });

  test('☠ refuse tout le reste plutôt que de deviner — un doute ne donne pas de droits', () => {
    for (const forme of ['', '   ', 'lecture+', 'admin', 'tout', 'sudo'])
      expect(normaliserAcces(forme)).toBeNull();
  });

  test('le message de refus ÉNUMÈRE les valeurs — un modèle se corrige sur une liste', () => {
    const m = messageAccesInconnu('lecture+');
    expect(m).toContain('lecture');
    expect(m).toContain('ecriture');
  });

  test('estAccesMandat ne se laisse pas passer une valeur approchante', () => {
    expect(estAccesMandat('lecture')).toBe(true);
    expect(estAccesMandat('Lecture')).toBe(false);
    expect(estAccesMandat(null)).toBe(false);
    expect(estAccesMandat(undefined)).toBe(false);
  });
});
