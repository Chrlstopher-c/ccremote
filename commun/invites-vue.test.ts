// Responsabilité : tests de la vue des autres sur une session d'invité — titre générique, rien de lisible.
import { describe, expect, test } from 'bun:test';
import { estSessionInvite, masquerPourAutres } from './invites-vue.ts';
import { ResumeSession } from './session.ts';

const MEMBRE = 'eeeeeeeeeeee';
const TITRE_SECRET = 'Titre secret du chef';
const DOSSIER_SECRET = '/home/trinity/projets/confidentiel';

const SESSION = ResumeSession.parse({
  id: 'sess-1',
  machine: 'aaaaaaaaaaaa',
  projet: { machine: 'aaaaaaaaaaaa', chemin: DOSSIER_SECRET, nom: 'confidentiel' },
  cwd: DOSSIER_SECRET,
  titre: TITRE_SECRET,
  objectif: 'objectif secret',
  modele: 'claude-sonnet-4-5',
  compte: 'perso',
  autonomie: false,
  statut: 'attente',
  contexte: { tokens: 1200, max: 200000 },
  etapes: 3,
  compactions: 0,
  claudeSessionId: 'identifiant-claude-secret',
  moteur: 'sdk',
  mode: 'default',
  effort: 'high',
  tmux: 'session-tmux',
  attachee: false,
  pilotee: false,
  dialogue: null,
  style_sortie: 'style',
  prompt_systeme: 'consigne du chef',
  creeLe: '2026-11-22T10:00:00.000Z',
  majLe: '2026-11-22T10:05:00.000Z',
});

describe('masquerPourAutres', () => {
  test('le résultat passe le schéma de session et porte le titre générique et le membre invité', () => {
    const masquee = masquerPourAutres(SESSION, 'Elie', MEMBRE);
    expect(ResumeSession.safeParse(masquee).success).toBe(true);
    expect(masquee.titre).toBe('Conversation de Elie');
    expect(masquee.invite).toEqual({ membre: MEMBRE, nom: 'Elie' });
    expect(masquee.projet).toEqual({ machine: 'aaaaaaaaaaaa', chemin: '', nom: 'Invités' });
    expect(masquee.cwd).toBe('');
    expect(masquee.objectif).toBeNull();
  });

  test('ne contient plus le titre, le dossier, l identifiant Claude ni le prompt du chef', () => {
    const texte = JSON.stringify(masquerPourAutres(SESSION, 'Elie', MEMBRE));
    expect(texte).not.toContain(TITRE_SECRET);
    expect(texte).not.toContain(DOSSIER_SECRET);
    expect(texte).not.toContain('identifiant-claude-secret');
    expect(texte).not.toContain('consigne du chef');
    expect(texte).not.toContain('objectif secret');
  });

  test('garde l identité et l activité : id, machine, modèle, statut, contexte, dates', () => {
    const masquee = masquerPourAutres(SESSION, 'Elie', MEMBRE);
    expect(masquee).toMatchObject({
      id: 'sess-1',
      machine: 'aaaaaaaaaaaa',
      modele: 'claude-sonnet-4-5',
      statut: 'attente',
      contexte: { tokens: 1200, max: 200000 },
      etapes: 3,
      effort: 'high',
      creeLe: SESSION.creeLe,
      majLe: SESSION.majLe,
      tmux: null,
      claudeSessionId: null,
      connecteurs: [],
    });
  });

  test('estSessionInvite : vrai pour la vue masquée, faux pour une session ordinaire', () => {
    expect(estSessionInvite(masquerPourAutres(SESSION, 'Elie', MEMBRE))).toBe(true);
    expect(estSessionInvite(SESSION)).toBe(false);
  });
});
