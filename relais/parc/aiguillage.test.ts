import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { aiguillage, jumelleRemoteControl, TEXTE_REFUS_SANS_JUMELLE } from './aiguillage.ts';

const MAJ = '2026-11-21T10:00:00.000Z';

function fiche(id: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

function rc(id: string, conversation: string | undefined): ResumeSession {
  return fiche(id, {
    machine: 'claude-ai',
    distant: { compte: 'defaut', idDistant: id, connexion: 'connectee', probleme: null, conversation },
  });
}

const TENUE = fiche('s1', { terminal: true, claudeSessionId: 'conv-1' });

describe('jumelle Remote Control', () => {
  test('trouve la cse_ dont la conversation est celle de la fiche tenue (claudeSessionId)', () => {
    const jumelle = rc('cse_a', 'conv-1');
    expect(jumelleRemoteControl(TENUE, [TENUE, rc('cse_b', 'autre'), jumelle])).toBe(jumelle);
  });

  test('sans claudeSessionId, la conversation est l’id de la fiche', () => {
    const tenue = fiche('conv-2', { terminal: true });
    const jumelle = rc('cse_c', 'conv-2');
    expect(jumelleRemoteControl(tenue, [tenue, jumelle])).toBe(jumelle);
  });

  test('une fiche de poste ne se rattache jamais à elle-même ni à une autre fiche de poste', () => {
    const autre = fiche('s9', { terminal: true, claudeSessionId: 'conv-1' });
    expect(jumelleRemoteControl(TENUE, [TENUE, autre])).toBeNull();
  });

  test('aucune cse_ pour la conversation : null', () => {
    expect(jumelleRemoteControl(TENUE, [TENUE, rc('cse_d', 'ailleurs')])).toBeNull();
  });
});

describe('aiguillage des commandes', () => {
  test('fiche non terminale : directe, même avec une jumelle', () => {
    const normale = fiche('s2', { claudeSessionId: 'conv-1' });
    expect(aiguillage(normale, 'envoyer', [normale, rc('cse_a', 'conv-1')])).toEqual({ kind: 'directe' });
  });

  test('envoyer et interrompre vers une fiche tenue avec jumelle : vers la jumelle', () => {
    const jumelle = rc('cse_a', 'conv-1');
    for (const kind of ['envoyer', 'interrompre']) {
      expect(aiguillage(TENUE, kind, [TENUE, jumelle])).toEqual({ kind: 'jumelle', session: jumelle });
    }
  });

  test('envoyer ou interrompre sans jumelle : refus', () => {
    for (const kind of ['envoyer', 'interrompre']) {
      expect(aiguillage(TENUE, kind, [TENUE])).toEqual({ kind: 'refus' });
    }
  });

  test('les autres actions ne sont pas aiguillées, même sans jumelle', () => {
    const jumelle = rc('cse_a', 'conv-1');
    for (const kind of ['fermer', 'compacter', 'reprendre', 'autonomie', 'renommer']) {
      expect(aiguillage(TENUE, kind, [TENUE, jumelle])).toEqual({ kind: 'directe' });
      expect(aiguillage(TENUE, kind, [TENUE])).toEqual({ kind: 'directe' });
    }
  });

  test('texte de refus exact', () => {
    expect(TEXTE_REFUS_SANS_JUMELLE).toBe(
      "Ouverte dans Claude Desktop sans Remote Control : activez-le là-bas, ou fermez-la pour l'ouvrir ici",
    );
  });
});

describe('réglage de modèle d’une session tenue ailleurs', () => {
  test('modèle vers une fiche tenue avec jumelle : vers la cse_', () => {
    const jumelle = rc('cse_a', 'conv-1');
    expect(aiguillage(TENUE, 'modele', [TENUE, jumelle])).toEqual({ kind: 'jumelle', session: jumelle });
  });

  test('modèle sans jumelle : refus clair', () => {
    expect(aiguillage(TENUE, 'modele', [TENUE])).toEqual({ kind: 'refus' });
  });
});
