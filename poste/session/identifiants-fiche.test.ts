import { describe, expect, test } from 'bun:test';
import { fantomes, fichePourIdentifiant, type FicheIdentifiee } from './identifiants-fiche.ts';

type Fiche = FicheIdentifiee & { readonly nom: string };
const fiche = (nom: string, id: string, claude: string | null, identifiants?: string[]): Fiche => ({
  nom,
  resume: { id, claudeSessionId: claude },
  ...(identifiants ? { identifiants } : {}),
});

describe('fichePourIdentifiant', () => {
  test('un identifiant SDK passé par la fiche (rembobinage) renvoie la fiche, pas une nouvelle', () => {
    const fiches = [fiche('A', 'A', 'C', ['A', 'B', 'C'])];
    expect(fichePourIdentifiant(fiches, 'B')?.nom).toBe('A');
    expect(fichePourIdentifiant(fiches, 'C')?.nom).toBe('A');
    expect(fichePourIdentifiant(fiches, 'A')?.nom).toBe('A');
  });

  test('un identifiant inconnu ne renvoie rien', () => {
    expect(fichePourIdentifiant([fiche('A', 'A', 'A')], 'Z')).toBeUndefined();
  });
});

describe('fantomes', () => {
  test('défaut d\'avant le correctif : la fiche née du nouveau transcript est un fantôme, la fiche réelle non', () => {
    const fiches = [fiche('reelle', 'A', 'B'), fiche('fantome', 'B', 'B')];
    expect(fantomes(fiches).map((f) => f.nom)).toEqual(['fantome']);
  });

  test('après le correctif : la fiche réelle porte ses identifiants, aucun fantôme', () => {
    const fiches = [fiche('reelle', 'A', 'C', ['A', 'B', 'C'])];
    expect(fantomes(fiches)).toEqual([]);
  });

  test('l\'ancien transcript (identifiant d\'une fiche d\'origine, plus courant) est un fantôme', () => {
    const fiches = [fiche('reelle', 'A', 'C', ['A', 'B', 'C']), fiche('ancien', 'B', 'B')];
    expect(fantomes(fiches).map((f) => f.nom)).toEqual(['ancien']);
  });
});
