/**
 * Banc de l'API web du harness : vrai `Bun.serve`, vrai registre SQLite en
 * mémoire, vrai `fetch`. Aucune doublure de la couche testée.
 *
 * `☠` Ce que ce banc verrouille avant tout : **le PC absent n'est jamais une
 * erreur** (H-75). C'est le seul comportement dont la violation rendrait
 * l'interface inutilisable la moitié du temps — chaque nuit, précisément.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { demarrerServeurApiWeb, type ServeurApiWeb } from './index.ts';
import { MachineEtatsDemandes } from '../bus-permissions/index.ts';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';

let registre: Registre;
let escalades: MachineEtatsDemandes;
let serveur: ServeurApiWeb | null = null;
let pcOnline = true;

const MAINTENANT = 1_784_750_000_000;

function demarrer(): ServeurApiWeb {
  serveur = demarrerServeurApiWeb({
    port: 0,
    registre,
    escalades,
    pcEnLigne: () => pcOnline,
    maintenant: () => MAINTENANT,
  });
  return serveur;
}

async function lire(chemin: string): Promise<{ statut: number; corps: Record<string, unknown> }> {
  const s = serveur ?? demarrer();
  const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness${chemin}`);
  return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
}

function semerMission(): string {
  const lot = registre.lots.creer({ id: 'lot-1', intention: 'banc de l’API web' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a', email: 'a@exemple.fr' });
  const mission = registre.missions.creer({
    id: 'm1',
    lotId: lot.id,
    nom: 'Câbler l’API',
    projet: 'ccremote',
    compteId: 'compte-a',
    mandat: 'brancher les vues',
    critereArret: 'tests verts',
  });
  return mission.id;
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  escalades = new MachineEtatsDemandes();
  pcOnline = true;
});

afterEach(() => {
  serveur?.arreter();
  serveur = null;
  registre.fermer();
});

describe('API web — enveloppe H-75 (le PC absent n’est pas une erreur)', () => {
  test('☠ PC absent ⇒ 200 avec pcOnline:false et stale:true, JAMAIS un 4xx/5xx', async () => {
    semerMission();
    pcOnline = false;
    const { statut, corps } = await lire('/missions');
    expect(statut).toBe(200);
    expect(corps['pcOnline']).toBe(false);
    expect(corps['stale']).toBe(true);
    expect(typeof corps['message']).toBe('string');
  });

  test('☠ PC absent ⇒ les données connues du registre sont TOUJOURS servies, pas effacées', async () => {
    semerMission();
    pcOnline = false;
    const { corps } = await lire('/missions');
    expect((corps['data'] as unknown[]).length).toBe(1);
  });

  test('PC présent ⇒ stale:false', async () => {
    semerMission();
    const { corps } = await lire('/missions');
    expect(corps['pcOnline']).toBe(true);
    expect(corps['stale']).toBe(false);
  });
});

describe('API web — missions', () => {
  test('une mission du registre ressort au vocabulaire du contrat', async () => {
    semerMission();
    const { corps } = await lire('/missions/m1');
    const data = corps['data'] as Record<string, unknown>;
    expect(data['id']).toBe('m1');
    expect(data['title']).toBe('Câbler l’API');
    expect(data['project']).toBe('ccremote');
    // `planifiee` (domaine) ⇒ `idle` (affichage) : rien ne tourne encore.
    expect(data['state']).toBe('idle');
    expect(data['mandate']).toEqual({ but: 'brancher les vues', critere: 'tests verts' });
  });

  test('☠ contexte jamais relevé ⇒ 0, jamais une estimation inventée', async () => {
    semerMission();
    const { corps } = await lire('/missions/m1');
    expect((corps['data'] as Record<string, unknown>)['ctx']).toBe(0);
  });

  test('☠ champs sans source réelle (subagents, feed, landing) ⇒ vides, jamais fabriqués', async () => {
    semerMission();
    const data = (await lire('/missions/m1')).corps['data'] as Record<string, unknown>;
    expect(data['subagents']).toEqual([]);
    expect(data['feed']).toEqual([]);
    expect(data['landing']).toBeNull();
  });

  test('mission inconnue ⇒ 404, même avec le PC en ligne', async () => {
    semerMission();
    const { statut } = await lire('/missions/inexistante');
    expect(statut).toBe(404);
  });
});

describe('API web — escalades', () => {
  test('seules les demandes ESCALADÉES sortent, pas celles encore en pré-escalade', async () => {
    escalades.recevoir({ requestId: 'r1', idWorker: 'm1', outil: 'Bash', decisionReason: 'écriture hors worktree' });
    const avant = (await lire('/escalades')).corps['data'] as unknown[];
    expect(avant).toHaveLength(0);

    escalades.escalader('r1');
    const apres = (await lire('/escalades')).corps['data'] as Record<string, unknown>[];
    expect(apres).toHaveLength(1);
    expect(apres[0]?.['id']).toBe('r1');
    // Le motif du plancher de déni : sans lui, l'arbitre ne voit qu'« Bash ».
    expect(apres[0]?.['phrase']).toBe('écriture hors worktree');
  });
});

describe('API web — comptes', () => {
  test('un compte sans relevé de quota ⇒ jauges à 0 et reset « — », jamais une valeur inventée', async () => {
    semerMission();
    const comptes = (await lire('/accounts')).corps['data'] as Record<string, unknown>[];
    expect(comptes).toHaveLength(1);
    expect(comptes[0]?.['five_hour']).toEqual({ util: 0, resetLabel: '—' });
  });

  test('☠ resetA est en SECONDES Unix — un libellé en 1970 signifierait la conversion oubliée', async () => {
    semerMission();
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      resetA: Math.floor(MAINTENANT / 1000) + 3 * 3600,
      utilisation: 42,
    });
    const comptes = (await lire('/accounts')).corps['data'] as Record<string, unknown>[];
    const cinqH = comptes[0]?.['five_hour'] as Record<string, unknown>;
    expect(cinqH['util']).toBe(42);
    expect(cinqH['resetLabel']).toBe('3 h 00');
  });
});

describe('API web — refus de configuration dangereuse', () => {
  test('☠ écouter sur 0.0.0.0 est REFUSÉ : ce serveur n’a aucune authentification propre', () => {
    expect(() =>
      demarrerServeurApiWeb({ port: 0, hostname: '0.0.0.0', registre, escalades, pcEnLigne: () => true }),
    ).toThrow(/authentification/);
  });
});
