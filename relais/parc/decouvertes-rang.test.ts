// Responsabilité : tests du choix d'une découverte présente sur plusieurs postes — rang (tenue par un processus, fiche
// Desktop, dossier existant), puis dernière écriture, puis plus petit nom de poste ; une découverte par identifiant.
import { describe, expect, test } from 'bun:test';
import type { Decouverte } from '../../commun/decouverte.ts';
import { type DecouverteDePoste, decouverteParIdentifiant } from './decouvertes-postes.ts';

const ID = 'a0000000-0000-4000-8000-000000000001';

function decouverte(extra: Partial<Decouverte> = {}): Decouverte {
  return {
    id: ID,
    machine: 'inconnue',
    cwd: '/p',
    titre: 'Titre',
    modifieLe: '2026-11-19T10:00:00.000Z',
    branche: null,
    messages: 2,
    ...extra,
  };
}

function candidat(machine: string, extra: Partial<Decouverte> = {}): DecouverteDePoste {
  return { machine, decouverte: decouverte(extra) };
}

// La machine retenue pour l'unique identifiant des candidats.
function retenue(candidats: DecouverteDePoste[]): string | undefined {
  const r = decouverteParIdentifiant(candidats);
  expect(r).toHaveLength(1);
  return r[0]?.machine;
}

describe('découverte présente sur plusieurs postes', () => {
  test('une conversation tenue par un processus l’emporte sur la copie que Desktop désigne ailleurs', () => {
    const portable = candidat('portable', { hoteDesktop: 'portable' });
    const tour = candidat('tour', { vivante: true });
    expect(retenue([tour, portable])).toBe('tour');
    expect(retenue([portable, tour])).toBe('tour');
  });

  test('la machine que Desktop désigne (fiche locale ou ssh) l’emporte sur un dossier existant ailleurs', () => {
    const cands = [
      candidat('tour', { cwdExiste: true }),
      candidat('portable'),
      candidat('vps', { hoteDesktop: 'portable' }),
    ];
    expect(retenue(cands)).toBe('portable');
    expect(retenue([...cands].reverse())).toBe('portable');
  });

  test('à rang égal, le dossier qui existe sur ce poste l’emporte sur la copie la plus récemment écrite', () => {
    const cands = [
      candidat('tour', { cwdExiste: false, modifieLe: '2026-11-20T10:00:00.000Z' }),
      candidat('portable', { cwdExiste: true, modifieLe: '2026-11-19T10:00:00.000Z' }),
    ];
    expect(retenue(cands)).toBe('portable');
  });

  test('à rang égal, la copie la plus récemment écrite l’emporte', () => {
    const cands = [
      candidat('tour', { modifieLe: '2026-11-18T10:00:00.000Z' }),
      candidat('portable', { modifieLe: '2026-11-19T10:00:00.000Z' }),
    ];
    expect(retenue(cands)).toBe('portable');
  });

  test('à égalité complète, le plus petit nom de poste l’emporte, quel que soit l’ordre', () => {
    expect(retenue([candidat('tour'), candidat('portable')])).toBe('portable');
    expect(retenue([candidat('portable'), candidat('tour')])).toBe('portable');
  });

  test('des identifiants différents restent deux découvertes', () => {
    const autre = { machine: 'tour', decouverte: decouverte({ id: 'b0000000-0000-4000-8000-000000000002' }) };
    expect(decouverteParIdentifiant([candidat('tour'), autre])).toHaveLength(2);
  });
});
