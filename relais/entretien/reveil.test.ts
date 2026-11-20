// Responsabilité : tests du réveil — choix du délégué, envoi local, banc factice, MAC inconnue.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { ReponsePoste } from '../parc/postes.ts';
import { choisirDelegue, type DependancesReveil, Reveil } from './reveil.ts';
import { ReseauxConnus } from './reseaux.ts';

const JOURNAL = { warn: () => undefined } as unknown as Logger;

const DIFFUSIONS: Record<string, string> = { tour: '192.0.2.255', portable: '192.0.2.255', pi: '198.51.100.255' };

describe('choix du délégué', () => {
  const diffusionDe = (id: string) => DIFFUSIONS[id] ?? null;

  test('un autre poste en ligne sur la même diffusion ; jamais la cible elle-même', () => {
    expect(choisirDelegue('tour', '192.0.2.255', ['tour', 'portable'], diffusionDe)).toBe('portable');
    expect(choisirDelegue('tour', '192.0.2.255', ['tour'], diffusionDe)).toBeNull();
  });

  test('aucun poste sur le même réseau : null (envoi depuis le relais)', () => {
    expect(choisirDelegue('tour', '192.0.2.255', ['pi'], diffusionDe)).toBeNull();
  });
});

describe('réveil', () => {
  function monter(factice: string | undefined, envoyes: { poste: string }[] = []) {
    const dossier = mkdtempSync(join(tmpdir(), 'reveil-svc-'));
    const reseaux = new ReseauxConnus(join(dossier, 'reveil.json'), JOURNAL);
    reseaux.retenir('tour', { mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255' });
    reseaux.retenir('portable', { mac: '11:22:33:44:55:66', diffusion: '192.0.2.255' });
    const d: DependancesReveil = {
      wol: new Map([['pi', 'aa-bb-cc-00-00-01']]),
      diffusionWol: '255.255.255.255',
      reseaux,
      envoyerPar: async (poste): Promise<ReponsePoste> => (envoyes.push({ poste }), { ok: true }),
      factice,
      journal: JOURNAL,
    };
    return { reveil: new Reveil(d), dossier };
  }

  test('MAC configurée ou relevée ; sans les deux : impossible', () => {
    const { reveil, dossier } = monter(undefined);
    try {
      expect(reveil.pour('pi', ['tour'])).toEqual({ possible: true, relaisPar: null });
      expect(reveil.pour('tour', ['portable', 'tour'])).toEqual({ possible: true, relaisPar: 'portable' });
      expect(reveil.pour('inconnue', ['tour'])).toEqual({ possible: false, relaisPar: null });
      expect(reveil.possibles().sort()).toEqual(['pi', 'portable', 'tour']);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('délégué en ligne : le poste envoie le paquet ; sinon le relais écrit dans le banc', async () => {
    const envoyes: { poste: string }[] = [];
    const { reveil, dossier } = monter(join(tmpdir(), `factice-${Date.now()}.jsonl`), envoyes);
    const fichier = join(dossier, 'factice.jsonl');
    try {
      expect(await reveil.reveiller('tour', ['portable'])).toEqual({ ok: true, par: 'portable' });
      expect(envoyes).toEqual([{ poste: 'portable' }]);
      const local = monter(fichier);
      expect(await local.reveil.reveiller('tour', ['tour'])).toEqual({ ok: true, par: 'relais' });
      const ligne = JSON.parse(readFileSync(fichier, 'utf8').trim()) as Record<string, string>;
      expect(ligne).toMatchObject({ mac: 'aa:bb:cc:dd:ee:ff', diffusion: '192.0.2.255', par: 'relais' });
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('machine sans MAC : refusé, rien n’est envoyé', async () => {
    const envoyes: { poste: string }[] = [];
    const { reveil, dossier } = monter(undefined, envoyes);
    try {
      expect((await reveil.reveiller('inconnue', ['tour'])).ok).toBe(false);
      expect(envoyes).toEqual([]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
