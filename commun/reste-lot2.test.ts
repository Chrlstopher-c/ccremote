// Responsabilité : tests du contrat du lot 2 de la vague « reste » — validation des tâches planifiées (fréquence,
// heure, identifiant), commandes de fusion et de dictée, et `parent` conservé par la fiche d'une session.
import { describe, expect, test } from 'bun:test';
import { CorpsTache, CorpsFusion, Frequence, IDENTIFIANT_TACHE } from './reste-lot2.ts';
import { ResumeSession } from './session.ts';

const FICHE = {
  id: 's1',
  machine: 'tour',
  projet: { machine: 'tour', chemin: '/p', nom: 'p' },
  cwd: '/p',
  titre: 'Copie',
  objectif: null,
  modele: 'opus',
  compte: 'principal',
  autonomie: false,
  statut: 'attente',
  contexte: { tokens: 0, max: 1 },
  etapes: 0,
  compactions: 0,
  claudeSessionId: 's1',
  tmux: null,
  attachee: false,
  pilotee: true,
  creeLe: '2026-11-20T10:00:00.000Z',
  majLe: '2026-11-20T10:00:00.000Z',
};

describe('fréquence des tâches planifiées', () => {
  test('quotidienne : heure HH:MM seulement', () => {
    expect(Frequence.safeParse({ type: 'quotidienne', heure: '09:30' }).success).toBe(true);
    expect(Frequence.safeParse({ type: 'quotidienne', heure: '9:30' }).success).toBe(false);
    expect(Frequence.safeParse({ type: 'quotidienne', heure: '24:00' }).success).toBe(false);
  });

  test('intervalle : au moins une minute ; unique : date ISO lisible', () => {
    expect(Frequence.safeParse({ type: 'intervalle', minutes: 0 }).success).toBe(false);
    expect(Frequence.safeParse({ type: 'intervalle', minutes: 15 }).success).toBe(true);
    expect(Frequence.safeParse({ type: 'unique', le: 'pas une date' }).success).toBe(false);
  });

  test('corps : tâche neuve sans `active` (inactive par défaut côté poste)', () => {
    const corps = CorpsTache.parse({
      nom: 'Bilan',
      dossier: '/p',
      prompt: 'Fais-le',
      frequence: { type: 'intervalle', minutes: 60 },
    });
    expect(corps.active).toBeUndefined();
    expect(IDENTIFIANT_TACHE.test('t-1_a')).toBe(true);
    expect(IDENTIFIANT_TACHE.test('t 1')).toBe(false);
  });
});

describe('fusion et fiche', () => {
  test('titre de PR obligatoire et borné', () => {
    expect(CorpsFusion.safeParse({ titre: '   ', corps: '', brouillon: false }).success).toBe(false);
    expect(CorpsFusion.safeParse({ titre: 'Ajout', corps: '', brouillon: true }).success).toBe(true);
  });

  test('la fiche garde `parent` (session née d’une duplication)', () => {
    const lue = ResumeSession.parse({ ...FICHE, parent: 'origine' });
    expect(lue.parent).toBe('origine');
    expect(ResumeSession.parse(FICHE).parent).toBeUndefined();
  });
});
