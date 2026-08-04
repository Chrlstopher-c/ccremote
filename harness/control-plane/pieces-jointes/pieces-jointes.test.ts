/**
 * Tests du domaine « pièces jointes » : ce qui est refusé l'est AVANT toute
 * écriture, ce qui est écrit porte un nom qui ne peut pas mentir, et le bloc
 * remis au modèle lui dit quoi faire du chemin.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assainirNom,
  cheminPieceRelue,
  decrirePiecesPourModele,
  ecrirePieces,
  ErreurPieceJointe,
  MAX_PIECES_PAR_MESSAGE,
  typesAcceptes,
  validerPieces,
} from './index.ts';

const PNG_MINIMAL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]).toString('base64');

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'pieces-test-'));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('validerPieces', () => {
  test('accepte une capture PNG conforme', () => {
    const validees = validerPieces([{ nom: 'capture.png', type: 'image/png', donneesBase64: PNG_MINIMAL }]);
    expect(validees).toHaveLength(1);
    expect(validees[0]?.octets.length).toBe(10);
  });

  test('refuse un type inconnu en nommant les types acceptés', () => {
    expect(() => validerPieces([{ nom: 'x.exe', type: 'application/x-msdownload', donneesBase64: PNG_MINIMAL }]))
      .toThrow(ErreurPieceJointe);
    try {
      validerPieces([{ nom: 'x.exe', type: 'application/x-msdownload', donneesBase64: PNG_MINIMAL }]);
    } catch (erreur) {
      // Le refus doit être actionnable : la liste des valeurs acceptées y figure.
      expect((erreur as Error).message).toContain('image/png');
      expect((erreur as Error).message).toContain('application/pdf');
    }
  });

  test('refuse un fichier dont la signature dément le type annoncé', () => {
    const pasUnPng = Buffer.from('ceci est du texte').toString('base64');
    expect(() => validerPieces([{ nom: 'faux.png', type: 'image/png', donneesBase64: pasUnPng }]))
      .toThrow(/signature/);
  });

  test('refuse au-delà du plafond de pièces par message', () => {
    const lot = Array.from({ length: MAX_PIECES_PAR_MESSAGE + 1 }, () => ({
      nom: 'c.png',
      type: 'image/png',
      donneesBase64: PNG_MINIMAL,
    }));
    expect(() => validerPieces(lot)).toThrow(/plafond/);
  });

  test('refuse un contenu vide ou illisible', () => {
    expect(() => validerPieces([{ nom: 'c.png', type: 'image/png', donneesBase64: '' }])).toThrow(ErreurPieceJointe);
  });

  test('accepte une donnée en data URI (ce que colle un navigateur)', () => {
    const validees = validerPieces([
      { nom: 'colle.png', type: 'image/png', donneesBase64: `data:image/png;base64,${PNG_MINIMAL}` },
    ]);
    expect(validees[0]?.octets.length).toBe(10);
  });

  test('n’écrit RIEN quand une seule pièce du lot est refusée', async () => {
    const lot = [
      { nom: 'bonne.png', type: 'image/png', donneesBase64: PNG_MINIMAL },
      { nom: 'mauvaise.exe', type: 'application/x-msdownload', donneesBase64: PNG_MINIMAL },
    ];
    expect(() => validerPieces(lot)).toThrow(ErreurPieceJointe);
    // La validation est pure : rien ne peut avoir été posé sur le disque.
    expect(readdirSync(racine)).toHaveLength(0);
  });
});

describe('assainirNom', () => {
  test('neutralise la traversée de chemin', () => {
    expect(assainirNom('../../etc/passwd')).toBe('passwd');
    expect(assainirNom('/tmp/x/y.png')).toBe('y.png');
  });

  test('ne rend jamais une chaîne vide', () => {
    expect(assainirNom('...')).toBe('piece');
    expect(assainirNom('')).toBe('piece');
  });
});

describe('ecrirePieces', () => {
  test('écrit sous la conversation et dérive l’extension du type validé', async () => {
    const validees = validerPieces([{ nom: 'capture.php', type: 'image/png', donneesBase64: PNG_MINIMAL }]);
    const ecrites = await ecrirePieces(racine, 'conv-1', validees, 1_700_000_000_000);
    expect(ecrites).toHaveLength(1);
    // L'extension d'origine ne survit pas : elle vient du type, pas du nom.
    expect(ecrites[0]?.fichier).toBe('1700000000000-0-capture.png');
    expect(ecrites[0]?.nom).toBe('capture.php');
    expect(existsSync(ecrites[0]?.chemin ?? '')).toBe(true);
  });

  test('deux envois du même fichier ne s’écrasent pas', async () => {
    const validees = validerPieces([{ nom: 'c.png', type: 'image/png', donneesBase64: PNG_MINIMAL }]);
    await ecrirePieces(racine, 'conv-1', validees, 1_000);
    await ecrirePieces(racine, 'conv-1', validees, 2_000);
    expect(readdirSync(join(racine, 'conv-1'))).toHaveLength(2);
  });

  test('un lot vide ne crée même pas le dossier', async () => {
    expect(await ecrirePieces(racine, 'conv-vide', [])).toHaveLength(0);
    expect(existsSync(join(racine, 'conv-vide'))).toBe(false);
  });
});

describe('cheminPieceRelue', () => {
  test('refuse toute traversée, au lieu de la nettoyer', () => {
    expect(() => cheminPieceRelue(racine, 'conv-1', '../../etc/passwd')).toThrow(ErreurPieceJointe);
    expect(() => cheminPieceRelue(racine, '../autre', 'x.png')).toThrow(ErreurPieceJointe);
    expect(() => cheminPieceRelue(racine, 'conv-1', '')).toThrow(ErreurPieceJointe);
  });

  test('rend le chemin attendu pour un nom simple', () => {
    expect(cheminPieceRelue(racine, 'conv-1', 'a.png')).toBe(join(racine, 'conv-1', 'a.png'));
  });
});

describe('decrirePiecesPourModele', () => {
  test('rend une chaîne vide sans pièce — aucun bruit dans le message', () => {
    expect(decrirePiecesPourModele([])).toBe('');
  });

  test('donne le chemin ET la consigne de lecture', () => {
    const bloc = decrirePiecesPourModele([
      { fichier: 'f.png', nom: 'capture.png', type: 'image/png', taille: 2048, chemin: '/data/conv/f.png' },
    ]);
    expect(bloc).toContain('/data/conv/f.png');
    expect(bloc).toContain('Read');
    expect(bloc).toContain('capture.png');
  });
});

describe('typesAcceptes', () => {
  test('couvre les formats qu’un opérateur colle réellement', () => {
    for (const type of ['image/png', 'image/jpeg', 'application/pdf', 'text/plain']) {
      expect(typesAcceptes()).toContain(type);
    }
  });
});
