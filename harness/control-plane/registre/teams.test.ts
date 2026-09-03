/**
 * Tests du cycle de vie des teams persistantes (migration 35, axe B).
 * Registre SQLite réel en fichier temporaire — aucune doublure.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErreurTransitionTeam, ouvrirRegistre, type Registre } from './index.ts';

let repertoire: string;
let registre: Registre;

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'registre-teams-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-1' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('création et lecture', () => {
  test('une team se crée dormante et se relit par (projet, domaine)', () => {
    const team = registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    expect(team.etat).toBe('dormante');
    expect(team.worktree).toBeNull();
    expect(team.activeDerniereFoisA).toBe(1000);

    const vivante = registre.teams.lireVivantePourDomaine('vela', 'frontend');
    expect(vivante?.id).toBe('t1');
  });

  test('lireVivantePourDomaine ignore une team démantelée', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    registre.teams.activer('t1', {}, 1000);
    registre.teams.demanteler('t1', 2000);
    expect(registre.teams.lireVivantePourDomaine('vela', 'frontend')).toBeNull();
  });
});

describe('transitions gardées', () => {
  test('activer : dormante → active, renseigne worktree/branche/compte', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    const active = registre.teams.activer(
      't1',
      { worktree: '/wt/t1', branche: 'equipe/t1', compteId: 'compte1', missionId: 'm1' },
      1500,
    );
    expect(active.etat).toBe('active');
    expect(active.worktree).toBe('/wt/t1');
    expect(active.branche).toBe('equipe/t1');
    expect(active.compteId).toBe('compte1');
    expect(active.derniereMissionId).toBe('m1');
    expect(active.activeDerniereFoisA).toBe(1500);
  });

  test('☠ activer une team DÉJÀ active lève (cas file = B2, pas d’acquittement silencieux)', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    registre.teams.activer('t1', {}, 1000);
    expect(() => registre.teams.activer('t1', {}, 2000)).toThrow(ErreurTransitionTeam);
  });

  test('☠ le réveil PRÉSERVE le worktree (COALESCE n’écrase jamais avec null)', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    registre.teams.activer('t1', { worktree: '/wt/t1', branche: 'equipe/t1' }, 1000);
    registre.teams.endormir('t1', 2000);
    // Réveil sans re-transmettre le worktree : il doit survivre.
    const reveillee = registre.teams.activer('t1', {}, 3000);
    expect(reveillee.worktree).toBe('/wt/t1');
    expect(reveillee.branche).toBe('equipe/t1');
    expect(reveillee.activeDerniereFoisA).toBe(3000);
  });

  test('endormir : active → dormante, met à jour l’activité', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    registre.teams.activer('t1', {}, 1000);
    const dormante = registre.teams.endormir('t1', 5000);
    expect(dormante.etat).toBe('dormante');
    expect(dormante.activeDerniereFoisA).toBe(5000);
  });

  test('demanteler : idempotent depuis dormante ET active, terminal ensuite', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'a' }, 1000);
    registre.teams.creer({ id: 't2', projet: 'vela', domaine: 'b' }, 1000);
    registre.teams.activer('t2', {}, 1000);
    expect(registre.teams.demanteler('t1', 2000).etat).toBe('demantelee');
    expect(registre.teams.demanteler('t2', 2000).etat).toBe('demantelee');
    // Un second démantèlement d'une team déjà démantelée lève (garde WHERE).
    expect(() => registre.teams.demanteler('t1', 3000)).toThrow(ErreurTransitionTeam);
  });
});

describe('TTL — teams dormantes inactives', () => {
  test('☠ ne rend que les dormantes inactives AVANT le seuil, jamais une active', () => {
    registre.teams.creer({ id: 'vieille', projet: 'vela', domaine: 'a' }, 1000);
    registre.teams.creer({ id: 'recente', projet: 'vela', domaine: 'b' }, 1000);
    registre.teams.creer({ id: 'active', projet: 'vela', domaine: 'c' }, 1000);
    // vieille : dernière activité ancienne. recente : récente. active : en cours.
    registre.teams.activer('vieille', {}, 1000);
    registre.teams.endormir('vieille', 1000);
    registre.teams.activer('recente', {}, 9000);
    registre.teams.endormir('recente', 9000);
    registre.teams.activer('active', {}, 500); // reste active

    const expirees = registre.teams.listerDormantesInactivesAvant(5000);
    expect(expirees.map((t) => t.id)).toEqual(['vieille']);
  });
});

describe('appartenance mission → team', () => {
  test('mission.teamId fait l’aller-retour', () => {
    registre.teams.creer({ id: 't1', projet: 'vela', domaine: 'frontend' }, 1000);
    registre.lots.creer({ id: 'l1', intention: 'x' });
    registre.missions.creer({ id: 'm1', lotId: 'l1', nom: 'm', projet: 'vela', compteId: 'compte1', teamId: 't1' });
    expect(registre.missions.lire('m1')?.teamId).toBe('t1');
  });

  test('une mission hors team porte teamId null (régime neutre)', () => {
    registre.lots.creer({ id: 'l1', intention: 'x' });
    registre.missions.creer({ id: 'm1', lotId: 'l1', nom: 'm', projet: 'vela', compteId: 'compte1' });
    expect(registre.missions.lire('m1')?.teamId).toBeNull();
  });
});
