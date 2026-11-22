import { describe, expect, test } from 'bun:test';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { StatutsPaires } from './statut-paire.ts';

// Une conversation tenue par Claude Desktop (fiche de poste) et sa jumelle Remote Control (cse_) : le modèle affiché
// de la jumelle est celui de la fiche de poste quand il est plus récent que le sien.
const MAJ = '2026-11-21T10:00:00.000Z';

function fiche(id: string, extra: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: `Titre ${id}`,
    objectif: null,
    modele: 'claude-haiku-5-5',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: 'conv-1',
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
    ...extra,
  };
}

const POSTE = fiche('s1', { terminal: true, modele: 'claude-opus-5-5', modeleLe: '2026-11-21T09:30:00.000Z' });
const RC = (modele: string, modeleLe?: string): ResumeSession =>
  fiche('cse_a', {
    machine: 'portable',
    claudeSessionId: null,
    modele,
    ...(modeleLe ? { modeleLe } : {}),
    distant: { compte: 'defaut', idDistant: 'cse_a', connexion: 'connectee', probleme: null, conversation: 'conv-1' },
  });

function paires(): { registre: Registre; statuts: StatutsPaires } {
  const registre = new Registre(ouvrirBase(':memory:'));
  return { registre, statuts: new StatutsPaires(registre) };
}

describe('jumelle masquée derrière la fiche de poste', () => {
  const RC_TRAVAIL = (id: string, connectee: boolean, statut: ResumeSession['statut']): ResumeSession =>
    fiche(id, {
      machine: 'portable',
      claudeSessionId: null,
      statut,
      distant: {
        compte: 'defaut',
        idDistant: id,
        connexion: connectee ? 'connectee' : 'deconnectee',
        probleme: null,
        conversation: 'conv-1',
      },
    });

  test('le statut « travail » de la jumelle masquée reste celui de la paire', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(RC_TRAVAIL('cse_a', true, 'travail'));
    registre.definirSessionsMasquees(new Set(['cse_a']));
    statuts.enregistrer(POSTE);
    expect(registre.session('s1')?.statut).toBe('travail');
  });

  test('la jumelle vivante l’emporte sur une jumelle déconnectée et plus ancienne', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(RC_TRAVAIL('cse_vieille', false, 'travail'));
    statuts.enregistrer(RC_TRAVAIL('cse_a', true, 'attente'));
    registre.definirSessionsMasquees(new Set(['cse_vieille', 'cse_a']));
    statuts.enregistrer(POSTE);
    expect(registre.session('s1')?.statut).toBe('attente');
  });
});

describe('modèle de la jumelle Remote Control', () => {
  test('(a) la jumelle affiche le modèle de la fiche de poste plus récent que le sien', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(RC('claude-fable-5-2'));
    statuts.enregistrer(POSTE);
    expect(registre.session('cse_a')?.modele).toBe('claude-opus-5-5');
  });

  test('(a) la jumelle d’une fiche arrivée après le poste prend aussi le modèle du poste', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(POSTE);
    statuts.enregistrer(RC('claude-fable-5-2'));
    expect(registre.session('cse_a')?.modele).toBe('claude-opus-5-5');
  });

  test('(a) une jumelle plus récente que la fiche de poste garde son modèle', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(POSTE);
    statuts.enregistrer(RC('claude-sonnet-5-5', '2026-11-21T09:45:00.000Z'));
    expect(registre.session('cse_a')?.modele).toBe('claude-sonnet-5-5');
  });

  test('(b) un changement de modèle de la fiche de poste atteint la jumelle, qui est rendue à diffuser', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(RC('claude-fable-5-2', '2026-11-21T09:00:00.000Z'));
    statuts.enregistrer({ ...POSTE, modele: 'claude-fable-5-2', modeleLe: '2026-11-21T09:00:00.000Z' });
    expect(registre.session('cse_a')?.modele).toBe('claude-fable-5-2');
    const maj = statuts.enregistrer({ ...POSTE, modele: 'claude-opus-5-5', modeleLe: '2026-11-21T11:00:00.000Z' });
    expect(maj?.modele).toBe('claude-opus-5-5');
    expect(registre.session('cse_a')?.modele).toBe('claude-opus-5-5');
  });

  test('sans fiche de poste : le modèle de la jumelle reste le sien', () => {
    const { registre, statuts } = paires();
    statuts.enregistrer(RC('claude-fable-5-2'));
    expect(registre.session('cse_a')?.modele).toBe('claude-fable-5-2');
  });
});
