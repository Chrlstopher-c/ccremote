import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extraireRubriquesRapport,
  formaterRapportStructure,
  MARQUEUR_CHANGEMENTS,
  MARQUEUR_ETAT,
  MARQUEUR_OUVERT,
  MARQUEUR_VERIFICATIONS,
} from './format-rapport.ts';

describe('extraireRubriquesRapport', () => {
  test('les quatre marqueurs présents ⇒ découpe les quatre rubriques, sans perte de contenu', () => {
    const texte = [
      `${MARQUEUR_ETAT}: atteint.`,
      `${MARQUEUR_CHANGEMENTS}:`,
      'fichier a.ts, fichier b.ts',
      `${MARQUEUR_VERIFICATIONS}:`,
      'bun test → 3 pass',
      `${MARQUEUR_OUVERT}:`,
      'rien.',
    ].join('\n');
    const rubriques = extraireRubriquesRapport(texte);
    expect(rubriques).not.toBeNull();
    expect(rubriques?.etat).toBe('atteint.');
    expect(rubriques?.changements).toBe('fichier a.ts, fichier b.ts');
    expect(rubriques?.verifications).toBe('bun test → 3 pass');
    expect(rubriques?.ouvert).toBe('rien.');
  });

  test('marqueur manquant ⇒ null (dégradation côté appelant)', () => {
    const texte = [`${MARQUEUR_ETAT}: atteint.`, `${MARQUEUR_CHANGEMENTS}:`, 'a.ts'].join('\n');
    expect(extraireRubriquesRapport(texte)).toBeNull();
  });

  test('rubrique présente mais vide ⇒ null, pas de structure à trous', () => {
    const texte = [
      `${MARQUEUR_ETAT}:`,
      `${MARQUEUR_CHANGEMENTS}:`,
      'a.ts',
      `${MARQUEUR_VERIFICATIONS}:`,
      'ok',
      `${MARQUEUR_OUVERT}:`,
      'rien',
    ].join('\n');
    expect(extraireRubriquesRapport(texte)).toBeNull();
  });

  test('texte libre sans aucun marqueur ⇒ null', () => {
    expect(extraireRubriquesRapport('Voilà, c’est fait ✅')).toBeNull();
  });

  test('rubrique répétée ⇒ garde la dernière occurrence (le lead se corrige)', () => {
    const texte = [
      `${MARQUEUR_ETAT}: brouillon.`,
      `${MARQUEUR_ETAT}: version finale.`,
      `${MARQUEUR_CHANGEMENTS}:`,
      'a.ts',
      `${MARQUEUR_VERIFICATIONS}:`,
      'ok',
      `${MARQUEUR_OUVERT}:`,
      'rien',
    ].join('\n');
    expect(extraireRubriquesRapport(texte)?.etat).toBe('version finale.');
  });
});

describe('formaterRapportStructure', () => {
  test('rend les quatre rubriques sous leur libellé humain', () => {
    const rendu = formaterRapportStructure({
      etat: 'atteint',
      changements: 'a.ts',
      verifications: 'bun test ok',
      ouvert: 'rien',
    });
    expect(rendu).toContain('Critère d’arrêt');
    expect(rendu).toContain('atteint');
    expect(rendu).toContain('Changements');
    expect(rendu).toContain('a.ts');
    expect(rendu).toContain('Vérifications');
    expect(rendu).toContain('bun test ok');
    expect(rendu).toContain('Reste ouvert');
    expect(rendu).toContain('rien');
  });
});

describe('D1 ☠ aucun appel LLM introduit par la structuration du rapport', () => {
  test('le module ne construit ni `query` ni SDK modèle — extraction par marqueur littéral seulement', () => {
    const source = readFileSync(join(import.meta.dir, 'format-rapport.ts'), 'utf-8');
    expect(source).not.toMatch(/@anthropic-ai/);
    expect(source).not.toMatch(/\bquery\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bmodel\s*:/);
  });
});
