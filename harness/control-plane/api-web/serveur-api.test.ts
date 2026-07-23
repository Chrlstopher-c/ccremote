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
    expect(comptes[0]?.['five_hour']).toEqual({ util: 0, resetLabel: '—', resetAt: null });
  });

  test('☠ reset_a est en MILLISECONDES epoch — une seule unité, fixée à l’écriture', async () => {
    semerMission();
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      resetA: MAINTENANT + 3 * 3600 * 1000,
      utilisation: 42,
    });
    const comptes = (await lire('/accounts')).corps['data'] as Record<string, unknown>[];
    const cinqH = comptes[0]?.['five_hour'] as Record<string, unknown>;
    expect(cinqH['util']).toBe(42);
    expect(cinqH['resetLabel']).toBe('3 h 00');
  });

  test('☠ des SECONDES écrites par erreur donnent « expirée », jamais un délai plausible', async () => {
    semerMission();
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      resetA: Math.floor(MAINTENANT / 1000) + 3 * 3600,
      utilisation: 42,
    });
    const comptes = (await lire('/accounts')).corps['data'] as Record<string, unknown>[];
    // Une erreur d'unité doit rester VISIBLE. L'inverse — des millisecondes lues
    // comme des secondes — affichait « reset dans 495278229 h » (23/07).
    expect((comptes[0]?.['five_hour'] as Record<string, unknown>)['resetLabel']).toBe('expirée');
  });
});

describe('API web — refus de configuration dangereuse', () => {
  test('☠ écouter sur 0.0.0.0 est REFUSÉ : ce serveur n’a aucune authentification propre', () => {
    expect(() =>
      demarrerServeurApiWeb({ port: 0, hostname: '0.0.0.0', registre, escalades, pcEnLigne: () => true }),
    ).toThrow(/authentification/);
  });
});

describe('API web — écritures (les ordres de l’opérateur)', () => {
  async function poster(chemin: string, corps: unknown): Promise<{ statut: number; corps: Record<string, unknown> }> {
    const s = serveur ?? demarrer();
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });
    return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
  }

  test('☠ sans lien vers le PC ⇒ 501, JAMAIS 200 : un ordre qui ne part pas ne doit pas être cru transmis', async () => {
    escalades.recevoir({ requestId: 'r1', idWorker: 'm1', outil: 'Bash' });
    escalades.escalader('r1');
    // `demarrer()` ne fournit pas `pc` — c'est exactement le déploiement sans PC.
    const { statut } = await poster('/escalades/r1/resolve', { verdict: 'autorise' });
    expect(statut).toBe(501);
  });

  test('un verdict « autorise » atteint réellement la machine à états', async () => {
    escalades.recevoir({ requestId: 'r2', idWorker: 'm1', outil: 'Bash' });
    escalades.escalader('r2');
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    const { statut } = await poster('/escalades/r2/resolve', { verdict: 'autorise' });
    expect(statut).toBe(200);
    expect(escalades.demande('r2')?.etat).toBe('repondue');
  });

  test('☠ un refus SANS motif est rejeté — le motif est réinjecté à l’agent, pas journalisé', async () => {
    escalades.recevoir({ requestId: 'r3', idWorker: 'm1', outil: 'Bash' });
    escalades.escalader('r3');
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    const sansMotif = await poster('/escalades/r3/resolve', { verdict: 'refuse' });
    expect(sansMotif.statut).toBe(400);
    // La demande doit être restée INTACTE : un rejet de forme ne consomme rien.
    expect(escalades.demande('r3')?.etat).toBe('en_attente');
  });

  test('☠ résoudre deux fois ⇒ 409, jamais un second « c’est fait » silencieux', async () => {
    escalades.recevoir({ requestId: 'r4', idWorker: 'm1', outil: 'Bash' });
    escalades.escalader('r4');
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    expect((await poster('/escalades/r4/resolve', { verdict: 'autorise' })).statut).toBe(200);
    expect((await poster('/escalades/r4/resolve', { verdict: 'autorise' })).statut).toBe(409);
  });

  test('terminer une mission transmet réellement l’ordre au PC', async () => {
    const arretes: string[] = [];
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async (id) => { arretes.push(id); } },
    });
    const { statut } = await poster('/missions/m1/terminate', {});
    expect(statut).toBe(200);
    expect(arretes).toEqual(['m1']);
  });

  test('☠ arrêt d’urgence non câblé ⇒ 501 explicite, jamais un succès rassurant', async () => {
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    const { statut } = await poster('/safety/emergency-stop', {});
    expect(statut).toBe(501);
  });
});

describe('API web — pilotage d’une mission vivante (A.2.2)', () => {
  function serveurAvecPilotage(journal: string[]): ServeurApiWeb {
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: {
        arreter: async () => {},
        envoyerInstruction: async (id, texte) => {
          journal.push(`instruction:${id}:${texte}`);
          return { detail: 'instruction retenue — mission en pause, transmise à la reprise' };
        },
        mettreEnPause: async (id) => { journal.push(`pause:${id}`); },
        reprendre: async (id) => { journal.push(`resume:${id}`); },
      },
    });
    return serveur;
  }

  async function poster(chemin: string, corps: unknown): Promise<{ statut: number; corps: Record<string, unknown> }> {
    const s = serveur!;
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness${chemin}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
    });
    return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
  }

  test('une instruction atteint réellement le PC, avec son texte', async () => {
    const journal: string[] = [];
    serveurAvecPilotage(journal);
    const { statut } = await poster('/missions/m1/instruction', { text: 'change de branche' });
    expect(statut).toBe(200);
    expect(journal).toEqual(['instruction:m1:change de branche']);
  });

  test('☠ le fait que l’instruction ait été RETENUE remonte jusqu’à l’interface', async () => {
    serveurAvecPilotage([]);
    const { corps } = await poster('/missions/m1/instruction', { text: 'coucou' });
    // Sans ça, l'opérateur attend une réaction d'un agent en pause qui ne lira
    // le message qu'à la reprise.
    expect(String(corps['effet'])).toContain('retenue');
  });

  test('une instruction vide est refusée avant d’atteindre le PC', async () => {
    const journal: string[] = [];
    serveurAvecPilotage(journal);
    expect((await poster('/missions/m1/instruction', { text: '   ' })).statut).toBe(400);
    expect(journal).toEqual([]);
  });

  test('pause et reprise atteignent le PC, chacune sur sa route', async () => {
    const journal: string[] = [];
    serveurAvecPilotage(journal);
    expect((await poster('/missions/m1/pause', {})).statut).toBe(200);
    expect((await poster('/missions/m1/resume', {})).statut).toBe(200);
    expect(journal).toEqual(['pause:m1', 'resume:m1']);
  });

  test('☠ pilotage absent du port ⇒ 501, jamais un succès poli', async () => {
    serveur = demarrerServeurApiWeb({
      port: 0, registre, escalades, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    expect((await poster('/missions/m1/pause', {})).statut).toBe(501);
  });
});

describe('API web — heure exacte du reset (23/07)', () => {
  test('fenêtre 5 h : heure en AM/PM, sans le jour', async () => {
    semerMission();
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'five_hour',
      statut: 'allowed',
      resetA: MAINTENANT + 3 * 3600 * 1000,
      utilisation: 42,
    });
    const cinqH = ((await lire('/accounts')).corps['data'] as Record<string, unknown>[])[0]?.['five_hour'] as Record<string, unknown>;
    expect(cinqH['resetAt']).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
  });

  test('☠ fenêtre 7 j : le JOUR est indispensable — « 08:00 AM » seul ne dit rien', async () => {
    semerMission();
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'seven_day',
      statut: 'allowed',
      resetA: MAINTENANT + 4 * 24 * 3600 * 1000,
      utilisation: 60,
    });
    const septJ = ((await lire('/accounts')).corps['data'] as Record<string, unknown>[])[0]?.['seven_day'] as Record<string, unknown>;
    expect(septJ['resetAt']).toMatch(/^.+ · \d{2}:\d{2} (AM|PM)$/);
  });

  test('reset inconnu ou déjà passé ⇒ null, jamais une heure inventée', async () => {
    semerMission();
    registre.comptes.releverQuota({ compteId: 'compte-a', typeFenetre: 'five_hour', statut: 'allowed', resetA: null });
    const cinqH = ((await lire('/accounts')).corps['data'] as Record<string, unknown>[])[0]?.['five_hour'] as Record<string, unknown>;
    expect(cinqH['resetAt']).toBeNull();
  });
});

describe('API web — détail d’un sous-agent (H-72.1)', () => {
  test('☠ le sous-agent réel est SERVI — avant, le client lisait le jeu de démo et rendait « introuvable »', async () => {
    const id = semerMission();
    registre.missions.poserSousAgents(id, [
      {
        agentId: 'a-mer',
        type: 'general-purpose',
        description: 'Paragraphe sur la mer',
        toolUseId: 'toolu_1',
        profondeur: 1,
        statut: 'actif',
        derniereAction: 'je lis le code',
        majA: MAINTENANT,
      },
    ]);
    registre.missions.poserActivitesSousAgent(id, 'a-mer', [
      { texte: 'je réfléchis', survenuA: MAINTENANT, type: 'reflexion', outil: null },
      { texte: 'Read', survenuA: MAINTENANT, type: 'outil', outil: 'Read' },
    ]);

    const { statut, corps } = await lire(`/missions/${id}/agents/a-mer`);
    expect(statut).toBe(200);
    const agent = corps.data as { name: string; feed: unknown[]; feedUnavailable: boolean };
    expect(agent.name).toBe('Paragraphe sur la mer');
    expect(agent.feed).toHaveLength(2);
    expect(agent.feedUnavailable).toBe(false);
  });

  test('☠ un agent connu SANS fil relevé sort quand même, avec feedUnavailable — jamais omis (H-72.4)', async () => {
    const id = semerMission();
    registre.missions.poserSousAgents(id, [
      {
        agentId: 'a-muet',
        type: null,
        description: null,
        toolUseId: null,
        profondeur: 1,
        statut: 'termine',
        derniereAction: null,
        majA: MAINTENANT,
      },
    ]);
    const { statut, corps } = await lire(`/missions/${id}/agents/a-muet`);
    expect(statut).toBe(200);
    expect((corps.data as { feedUnavailable: boolean }).feedUnavailable).toBe(true);
  });

  test('un agent inconnu est un vrai 404, jamais une coquille vide', async () => {
    const id = semerMission();
    expect((await lire(`/missions/${id}/agents/fantome`)).statut).toBe(404);
  });
});
