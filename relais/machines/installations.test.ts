import { describe, expect, test } from 'bun:test';
import { assainirSortie, etapeDeLigne, Installations, LONGUEUR_MESSAGE } from './installations.ts';

describe('avancement d’une installation', () => {
  test('étapes puis fini ; une étape hors installation en cours est ignorée', () => {
    const changements: string[] = [];
    const suivis = new Installations({ surChangement: (id) => changements.push(id) });
    suivis.commencer('pi');
    expect(suivis.de('pi')).toEqual({ etape: 'archive', etat: 'en_cours', message: null });
    suivis.etape('pi', 'bun install');
    expect(suivis.de('pi')?.etape).toBe('bun install');
    suivis.fin('pi', true, null);
    expect(suivis.de('pi')).toEqual({ etape: 'poste connecté', etat: 'fini', message: null });
    suivis.etape('pi', 'unité');
    expect(suivis.de('pi')?.etat).toBe('fini');
    expect(changements).toEqual(['pi', 'pi', 'pi']);
  });

  test('échec : état echec, étape gardée, message assaini', () => {
    const suivis = new Installations({ surChangement: () => undefined });
    suivis.commencer('pi');
    suivis.etape('pi', 'bun install');
    suivis.fin('pi', false, 'bun : introuvable');
    expect(suivis.de('pi')).toEqual({ etape: 'bun install', etat: 'echec', message: 'bun : introuvable' });
  });

  test('une ligne « @etape » donne l’étape, une autre rien', () => {
    expect(etapeDeLigne('@etape bun install')).toBe('bun install');
    expect(etapeDeLigne('bun install v1.2')).toBeNull();
  });
});

describe('fin de sortie assainie', () => {
  test('pas d’hôte, d’adresse IP, d’utilisateur, ni de marqueur d’étape', () => {
    const sortie = [
      '@etape bun install',
      'utilisateur@machine.exemple.test: Permission denied',
      'connexion à machine.exemple.test (192.0.2.10) échouée',
    ].join('\n');
    const texte = assainirSortie(sortie, 'machine.exemple.test');
    expect(texte).not.toContain('machine.exemple.test');
    expect(texte).not.toContain('192.0.2.10');
    expect(texte).not.toContain('utilisateur@');
    expect(texte).not.toContain('@etape');
    expect(texte).toContain('<utilisateur>@<hote>');
    expect(texte).toContain('<ip>');
  });

  test('six dernières lignes au plus, longueur bornée', () => {
    const longue = Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join('\n');
    expect(assainirSortie(longue, 'h').split('\n')).toHaveLength(6);
    expect(assainirSortie('x'.repeat(5000), 'h').length).toBeLessThanOrEqual(LONGUEUR_MESSAGE);
  });
});
