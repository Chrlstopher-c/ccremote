// Noctis s'installe chez d'autres que son auteur : aucun texte envoyé au modèle (descriptions d'outils, consignes,
// réponses d'outils, motifs de refus) ne nomme l'auteur. Les commentaires ne partent pas au modèle.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIERS = ['presentation', 'session'].map((d) => join(import.meta.dir, d));
const CHAINE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const COMMENTAIRE = /^\s*(\/\/|\*|\/\*)/;

describe('textes envoyés au modèle', () => {
  test('aucune chaîne ne nomme Chris', () => {
    const trouves = DOSSIERS.flatMap((dossier) =>
      readdirSync(dossier)
        .filter((nom) => nom.endsWith('.ts') && !nom.endsWith('.test.ts'))
        .flatMap((nom) =>
          readFileSync(join(dossier, nom), 'utf8')
            .split('\n')
            .filter((ligne) => !COMMENTAIRE.test(ligne))
            .flatMap((ligne) => [...ligne.split(' // ')[0].matchAll(CHAINE)].map((m) => m[0]))
            .filter((chaine) => /\bChris\b/.test(chaine))
            .map((chaine) => `${nom} : ${chaine}`),
        ),
    );
    expect(trouves).toEqual([]);
  });
});
