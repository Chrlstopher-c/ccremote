import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import pino from 'pino';
import { Postes, type DonneesPoste } from './postes.ts';

const journal = pino({ enabled: false });
const SESSION = {
  id: 'a0000000-0000-4000-8000-000000000001',
  machine: 'tour',
  cwd: '/p',
  titre: 'Titre',
  modifieLe: '2026-11-19T10:00:00.000Z',
  branche: null,
  messages: 2,
};

function ws(machine: string): ServerWebSocket<DonneesPoste> {
  return { data: { machine }, send: () => 0, close: () => undefined } as unknown as ServerWebSocket<DonneesPoste>;
}

function poste(): Postes {
  const registre = { machines: () => [] } as unknown as Registre;
  const diffusion = { diffuser: () => undefined } as unknown as Diffusion;
  return new Postes(registre, diffusion, new Map(), journal);
}

describe('sessions découvertes reçues des postes', () => {
  test('la liste d un poste connecté est exposée, sans les identifiants déjà connus', () => {
    const p = poste();
    const w = ws('tour');
    p.ouvert(w);
    p.recu(w, JSON.stringify({ kind: 'decouvertes', decouvertes: [SESSION] }));
    expect(p.decouvertes(new Set())).toEqual([SESSION]);
    expect(p.decouvertes(new Set([SESSION.id]))).toEqual([]);
  });

  test('un poste déconnecté ne laisse aucune session découverte', () => {
    const p = poste();
    const w = ws('tour');
    p.ouvert(w);
    p.recu(w, JSON.stringify({ kind: 'decouvertes', decouvertes: [SESSION] }));
    p.ferme(w);
    expect(p.decouvertes(new Set())).toEqual([]);
  });

  test('un message de découverte illisible est ignoré', () => {
    const p = poste();
    const w = ws('tour');
    p.ouvert(w);
    p.recu(w, JSON.stringify({ kind: 'decouvertes', decouvertes: [{ id: 'pas bon !' }] }));
    expect(p.decouvertes(new Set())).toEqual([]);
  });
});
