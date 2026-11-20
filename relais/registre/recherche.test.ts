// Responsabilité : tests de la recherche globale et des jetons sur le registre (base en mémoire, sans relais).
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-19T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string, machine: string): ResumeSession {
  return {
    id,
    machine,
    projet: { machine, chemin: '/p', nom: 'p' },
    cwd: `/projets/${id}`,
    titre: `titre ${id}`,
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
  };
}

function registreDeTest(): Registre {
  const r = new Registre(ouvrirBase(':memory:'), journal);
  r.enregistrerSession(session('a', 'tour'));
  r.enregistrerSession(session('b', 'portable'));
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'Lance la TOUR maintenant', uuid: 'm1' });
  r.ajouterEvenement('a', MAJ, { type: 'texte', texte: 'La tour répond' });
  r.ajouterEvenement('a', MAJ, { type: 'outil', id: 'o', nom: 'Bash', resume: 'tour', detail: 'tour' });
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'encore la tour' });
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'et la tour, une fois de plus' });
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'dernier tour de la tour' });
  r.ajouterEvenement('b', MAJ, { type: 'message', texte: 'une tour sur le portable' });
  r.ajouterEvenement('orpheline', MAJ, { type: 'message', texte: 'tour sans fiche' });
  r.ajouterEvenement('a', MAJ, { type: 'message', texte: 'il dit "salut" à Été' });
  return r;
}

describe('recherche des messages du registre', () => {
  test('trouve sans casse dans les messages et textes, avec la fiche de la session', () => {
    const r = registreDeTest();
    const trouvees = r.rechercherMessages('tour', 100, 100);
    const portable = trouvees.find((t) => t.sessionId === 'b');
    expect(portable).toMatchObject({ machine: 'portable', titre: 'titre b', dossier: '/projets/b', role: 'chris' });
    expect(trouvees.some((t) => t.sessionId === 'orpheline')).toBe(false);
    expect(trouvees.some((t) => t.extrait.includes('Bash'))).toBe(false);
  });

  test('au plus `parSession` par session, les plus récents d abord', () => {
    const trouvees = registreDeTest()
      .rechercherMessages('tour', 100, 3)
      .filter((t) => t.sessionId === 'a');
    expect(trouvees).toHaveLength(3);
    expect(trouvees[0]?.seq ?? 0).toBeGreaterThan(trouvees[1]?.seq ?? 0);
    expect(trouvees[0]?.extrait).toContain('dernier tour');
  });

  test('coupe au maximum demandé', () => {
    expect(registreDeTest().rechercherMessages('tour', 2, 10)).toHaveLength(2);
  });

  test('rend le rôle, l extrait et l occurrence exacte', () => {
    const [trouvee] = registreDeTest().rechercherMessages('"salut"', 5, 3);
    expect(trouvee?.role).toBe('chris');
    expect(trouvee?.extrait.slice(trouvee.debut, trouvee.debut + trouvee.longueur)).toBe('"salut"');
  });

  test('retrouve un mot accentué écrit avec une autre casse', () => {
    const trouvees = registreDeTest().rechercherMessages('été', 5, 3);
    expect(trouvees.map((t) => t.sessionId)).toEqual(['a']);
  });

  test('une requête sans occurrence rend une liste vide', () => {
    expect(registreDeTest().rechercherMessages('inexistant', 5, 3)).toEqual([]);
  });
});

describe('jetons d une session', () => {
  test('somme des tours terminés', () => {
    const r = new Registre(ouvrirBase(':memory:'), journal);
    r.enregistrerSession(session('a', 'tour'));
    r.ajouterEvenement('a', MAJ, { type: 'tour_fini', dureeMs: 1, contexte: 1, entree: 10, sortie: 5 });
    r.ajouterEvenement('a', MAJ, { type: 'tour_fini', dureeMs: 1, contexte: 1, entree: 3, sortie: 2 });
    r.ajouterEvenement('a', MAJ, { type: 'tour_fini', dureeMs: 1, contexte: 1 });
    expect(r.jetonsSession('a')).toEqual({ entree: 13, sortie: 7, tours: 3 });
  });

  test('zéros pour une session inconnue', () => {
    expect(registreDeTest().jetonsSession('inconnue')).toEqual({ entree: 0, sortie: 0, tours: 0 });
  });
});
