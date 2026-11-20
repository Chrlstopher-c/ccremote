// Responsabilité : tests de la normalisation des fichiers de suivi des agents (formats réels hétérogènes).
import { describe, expect, test } from 'bun:test';
import { normaliserChantier } from './chantiers-normaliser.ts';

const MAJ = '2026-11-20T10:00:00.000Z';

describe('normalisation d’un fichier de suivi', () => {
  test('format « statut / mission / etape / fait »', () => {
    const c = normaliserChantier(
      'a.json',
      { agent: 'opus', projet: 'lanterne', statut: 'en cours', mission: 'M', etape: 'E', fait: ['x'] },
      MAJ,
    );
    expect(c).toEqual({
      fichier: 'a.json',
      agent: 'opus',
      projet: 'lanterne',
      statut: 'en_cours',
      statutBrut: 'en cours',
      mission: 'M',
      etape: 'E',
      fait: ['x'],
      majLe: MAJ,
    });
  });

  test('format « tache / etape / statut / maj » : la tâche sert de mission, model sert d’agent', () => {
    const c = normaliserChantier(
      'b.json',
      { model: 'haiku', tache: 'T', etape: 'S2', statut: 'terminé', maj: 'x' },
      MAJ,
    );
    expect(c?.agent).toBe('haiku');
    expect(c?.mission).toBe('T');
    expect(c?.statut).toBe('termine');
  });

  test('format « slug / titre / etat / etape » : etat sert de statut', () => {
    const c = normaliserChantier('c.json', { slug: 's', titre: 'Titre', etat: 'échec', etape: 'boum' }, MAJ);
    expect(c?.mission).toBe('Titre');
    expect(c?.statut).toBe('echec');
    expect(c?.statutBrut).toBe('échec');
  });

  test('format « titre / etat / agent » : sans étape ni projet', () => {
    const c = normaliserChantier('d.json', { titre: 'Seul', etat: 'running', agent: 'sonnet' }, MAJ);
    expect(c).toMatchObject({
      agent: 'sonnet',
      projet: null,
      etape: null,
      mission: 'Seul',
      statut: 'en_cours',
      fait: [],
    });
  });

  test('format anglais avec tableau d’étapes : dernière étape, notes en faits', () => {
    const c = normaliserChantier(
      'e.json',
      { agent: 'x', task: 'Build', status: 'in_progress', etapes: ['a', 'b', 'c'], notes: ['n1', 'n2'] },
      MAJ,
    );
    expect(c).toMatchObject({ mission: 'Build', statut: 'en_cours', etape: 'c', fait: ['n1', 'n2'] });
  });

  test('statuts : libellés connus rangés, le reste est inconnu, statutBrut garde la valeur d’origine', () => {
    const rang = (s: string) => normaliserChantier('f.json', { statut: s }, MAJ)?.statut;
    expect(rang('actif')).toBe('en_cours');
    expect(rang('done')).toBe('termine');
    expect(rang('termine_partiel')).toBe('termine');
    expect(rang('bloqué')).toBe('echec');
    expect(rang('?? quelque chose')).toBe('inconnu');
    expect(normaliserChantier('f.json', { statut: 'Bizarre' }, MAJ)?.statutBrut).toBe('Bizarre');
  });

  test('fait : 20 éléments au plus, 300 caractères, chaînes seules ; une chaîne devient une liste', () => {
    const longs = Array.from({ length: 25 }, (_, i) => (i % 2 ? 'x'.repeat(400) : i));
    const c = normaliserChantier('g.json', { fait: longs }, MAJ);
    expect(c?.fait).toHaveLength(12);
    expect(c?.fait.every((f) => f.length <= 300)).toBe(true);
    expect(normaliserChantier('h.json', { notes: 'une note' }, MAJ)?.fait).toEqual(['une note']);
  });

  test('un fichier qui n’est pas un objet est rejeté', () => {
    expect(normaliserChantier('i.json', [1, 2], MAJ)).toBeNull();
    expect(normaliserChantier('i.json', 'texte', MAJ)).toBeNull();
    expect(normaliserChantier('i.json', null, MAJ)).toBeNull();
  });
});
