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
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { ErreurMandatDejaTranche } from '../orchestrateur/dispatch-mandat.ts';
import { ErreurPieceJointe } from '../pieces-jointes/index.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let registre: Registre;
let serveur: ServeurApiWeb | null = null;
let pcOnline = true;

const MAINTENANT = 1_784_750_000_000;

function demarrer(): ServeurApiWeb {
  serveur = demarrerServeurApiWeb({
    port: 0,
    registre,
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
      demarrerServeurApiWeb({ port: 0, hostname: '0.0.0.0', registre, pcEnLigne: () => true }),
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
    // `demarrer()` ne fournit pas `pc` — c'est exactement le déploiement sans PC.
    const { statut } = await poster('/missions/m1/terminate', {});
    expect(statut).toBe(501);
  });

  test('terminer une mission transmet réellement l’ordre au PC', async () => {
    const arretes: string[] = [];
    serveur = demarrerServeurApiWeb({
      port: 0, registre, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async (id) => { arretes.push(id); } },
    });
    const { statut } = await poster('/missions/m1/terminate', {});
    expect(statut).toBe(200);
    expect(arretes).toEqual(['m1']);
  });

  test('☠ arrêt d’urgence non câblé ⇒ 501 explicite, jamais un succès rassurant', async () => {
    serveur = demarrerServeurApiWeb({
      port: 0, registre, pcEnLigne: () => true, maintenant: () => MAINTENANT,
      pc: { arreter: async () => {} },
    });
    const { statut } = await poster('/safety/emergency-stop', {});
    expect(statut).toBe(501);
  });
});

describe('API web — pilotage d’une mission vivante (A.2.2)', () => {
  function serveurAvecPilotage(journal: string[]): ServeurApiWeb {
    serveur = demarrerServeurApiWeb({
      port: 0, registre, pcEnLigne: () => true, maintenant: () => MAINTENANT,
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
      port: 0, registre, pcEnLigne: () => true, maintenant: () => MAINTENANT,
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

describe('API web — modèle et raisonnement d’une conversation (23/07)', () => {
  test('☠ le choix est TRANSMIS au gestionnaire — il était reçu puis jeté, le sélecteur ne pilotait rien', async () => {
    const recus: { texte: string; choix: unknown }[] = [];
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
        pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      conversations: {
        lister: () => [],
        detail: () => null,
        evenements: () => null,
        creer: () => ({ id: 'c1', titre: 't', creeA: MAINTENANT, majA: MAINTENANT }),
        envoyer: async (_id: string, texte: string, choix?: unknown) => {
          recus.push({ texte, choix });
        },
        renommer: async () => {},
        archiver: async () => {},
        compacter: async () => ({ compacte: false, detail: 'rien' }),
      } as never,
    });
    const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'salut', model: 'claude-sonnet-5', effort: 'medium' }),
    });
    expect(rep.status).toBe(200);
    expect(recus[0]?.choix).toEqual({ modele: 'claude-sonnet-5', effort: 'medium' });
  });
});

/**
 * `☠` Banc de CÂBLAGE, pas de fonction : le domaine `pieces-jointes` a ses
 * propres tests. Ce qui se prouve ici, c'est que le corps HTTP arrive jusqu'au
 * gestionnaire et que la pièce ressort en OCTETS — la seule route non-JSON du
 * control plane, donc la plus facile à casser sans que rien ne le dise.
 */
describe('API web — pièces jointes d’un message (migration 24)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x7f]).toString('base64');
  let racine: string;

  function conversationsFactices(recus: { pieces: unknown }[]): never {
    return {
      lister: () => [],
      detail: () => null,
      evenements: () => null,
      creer: () => ({ id: 'c1', titre: 't', creeA: MAINTENANT, majA: MAINTENANT }),
      envoyer: async (_id: string, _texte: string, _choix?: unknown, pieces?: unknown) => {
        recus.push({ pieces });
      },
      renommer: async () => {},
      archiver: async () => {},
      compacter: async () => ({ compacte: false, detail: 'rien' }),
    } as never;
  }

  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'api-pieces-'));
  });

  afterEach(() => {
    rmSync(racine, { recursive: true, force: true });
  });

  test('☠ les pièces du corps arrivent jusqu’au gestionnaire', async () => {
    const recus: { pieces: unknown }[] = [];
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      racinePiecesJointes: racine,
      conversations: conversationsFactices(recus),
    });
    const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'regarde', pieces: [{ nom: 'c.png', type: 'image/png', donneesBase64: PNG }] }),
    });
    expect(rep.status).toBe(200);
    expect(recus[0]?.pieces).toEqual([{ nom: 'c.png', type: 'image/png', donneesBase64: PNG }]);
  });

  test('un message SANS texte mais AVEC pièce est accepté', async () => {
    const recus: { pieces: unknown }[] = [];
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      racinePiecesJointes: racine,
      conversations: conversationsFactices(recus),
    });
    const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '', pieces: [{ nom: 'c.png', type: 'image/png', donneesBase64: PNG }] }),
    });
    expect(rep.status).toBe(200);
  });

  test('un refus du domaine sort en 400 avec le message QUI NOMME les types acceptés', async () => {
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      racinePiecesJointes: racine,
      conversations: {
        lister: () => [],
        detail: () => null,
        evenements: () => null,
        creer: () => ({ id: 'c1', titre: 't', creeA: MAINTENANT, majA: MAINTENANT }),
        envoyer: async (): Promise<void> => {
          throw new ErreurPieceJointe('pièce « x.exe » refusée — types acceptés : image/png, application/pdf');
        },
        renommer: async () => {},
        archiver: async () => {},
        compacter: async () => ({ compacte: false, detail: 'rien' }),
      } as never,
    });
    const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x', pieces: [{ nom: 'x.exe', type: 'application/x-msdownload', donneesBase64: PNG }] }),
    });
    expect(rep.status).toBe(400);
    // L'opérateur doit lire CE qui a été refusé, pas « requête invalide ».
    expect(String((await rep.json() as { error: string }).error)).toContain('types acceptés');
  });

  test('la pièce est servie en OCTETS avec son type, pas en JSON', async () => {
    mkdirSync(join(racine, 'c1'), { recursive: true });
    writeFileSync(join(racine, 'c1', 'a.png'), Buffer.from(PNG, 'base64'));
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      racinePiecesJointes: racine,
    });
    const rep = await fetch(`http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/pieces/a.png`);
    expect(rep.status).toBe(200);
    expect(rep.headers.get('content-type')).toContain('image/png');
    expect(new Uint8Array(await rep.arrayBuffer())[0]).toBe(0x89);
  });

  test('une traversée de chemin est refusée, et une pièce inconnue est un vrai 404', async () => {
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      racinePiecesJointes: racine,
    });
    const base = `http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations`;
    expect((await fetch(`${base}/c1/pieces/${encodeURIComponent('../../etc/passwd')}`)).status).toBe(400);
    expect((await fetch(`${base}/c1/pieces/fantome.png`)).status).toBe(404);
  });

  test('sans racine configurée, la route le DIT (501) au lieu de rendre un vide', async () => {
    serveur = demarrerServeurApiWeb({ port: 0, registre, pcEnLigne: () => pcOnline, maintenant: () => MAINTENANT });
    const rep = await fetch(
      `http://127.0.0.1:${serveur.port}/api/harness/orchestrator/conversations/c1/pieces/a.png`,
    );
    expect(rep.status).toBe(501);
  });
});

/**
 * `☠` Ces routes existent parce qu'une fonctionnalité écrite mais branchée sur
 * rien est le défaut le plus cher de ce dépôt (neuf occurrences). Le banc part
 * donc du VRAI serveur et d'un vrai `fetch` : il prouve le câblage, pas la
 * fonction.
 */
describe('notifications — le canal asynchrone est réellement servi', () => {
  function semerNotification(lue = false): string {
    const missionId = semerMission();
    const n = registre.notifications.creer({
      id: 'notif-1',
      type: 'equipe_terminee',
      missionId,
      conversationId: 'conv-a',
      titre: 'Équipe terminée — Câbler l’API',
      corps: 'ccremote · 0,42 $ · 12 min',
    });
    if (lue) registre.notifications.marquerLue(n.id);
    return n.id;
  }

  test('GET /notifications rend la liste et le compteur de non-lues', async () => {
    semerNotification();
    const { statut, corps } = await lire('/notifications');
    expect(statut).toBe(200);
    const data = corps['data'] as { notifications: unknown[]; unread: number };
    expect(data.notifications).toHaveLength(1);
    expect(data.unread).toBe(1);
  });

  test('la carte porte le fil d’origine — sans lui le clic ne mène nulle part', async () => {
    semerNotification();
    const { corps } = await lire('/notifications');
    const data = corps['data'] as { notifications: { conversationId: string; delivered: boolean }[] };
    expect(data.notifications[0]?.conversationId).toBe('conv-a');
    // `☠` « lu » et « transmis » restent deux faits séparés jusqu'au bout de la
    // chaîne : les fondre effacerait ce que Chris regarde pour savoir si son
    // orchestrateur est au courant.
    expect(data.notifications[0]?.delivered).toBe(false);
  });

  test('POST /notifications/:id/read marque lue, et le compteur suit', async () => {
    const id = semerNotification();
    const s = serveur ?? demarrer();
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness/notifications/${id}/read`, { method: 'POST' });
    expect(rep.status).toBe(200);
    expect(registre.notifications.nombreNonLues()).toBe(0);
  });

  test('marquer lue deux fois n’est pas une erreur (deux onglets ouverts)', async () => {
    const id = semerNotification(true);
    const s = serveur ?? demarrer();
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness/notifications/${id}/read`, { method: 'POST' });
    expect(rep.status).toBe(200);
    expect(((await rep.json()) as { marquee: boolean }).marquee).toBe(false);
  });

  test('POST /notifications/read-all vide le compteur', async () => {
    semerNotification();
    const s = serveur ?? demarrer();
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness/notifications/read-all`, { method: 'POST' });
    expect(rep.status).toBe(200);
    expect(registre.notifications.nombreNonLues()).toBe(0);
  });

  test('PC éteint : les notifications restent servies (H-75)', async () => {
    semerNotification();
    pcOnline = false;
    const { statut, corps } = await lire('/notifications');
    expect(statut).toBe(200);
    // Elles vivent sur le Pi : un PC absent ne doit rien masquer — c'est
    // précisément la nuit qu'on vient les lire.
    expect((corps['data'] as { notifications: unknown[] }).notifications).toHaveLength(1);
  });
});

/**
 * `☠` Le canal des rappels traverse trois frontières (registre → route → écran)
 * et chacune peut mentir en silence : une action qui « réussit » sans rien faire
 * laisserait Chris croire qu'il a coupé un rappel qui continue de tirer. Ces
 * tests partent du VRAI serveur, pas du dépôt.
 */
describe('rappels — vus et pilotés depuis l’interface', () => {
  function semerRappel(conversationId = 'conv-a'): string {
    const id = `rap-${conversationId}`;
    registre.rappels.creer({
      id,
      conversationId,
      libelle: 'veille IA',
      consigne: 'résume les sorties françaises depuis le dernier tir',
      prochaineA: MAINTENANT + 600_000,
      periodeMs: 600_000,
    });
    return id;
  }

  async function agir(conv: string, rappel: string, action: string): Promise<number> {
    const s = serveur ?? demarrer();
    const rep = await fetch(
      `http://127.0.0.1:${s.port}/api/harness/orchestrator/conversations/${conv}/rappels/${rappel}/${action}`,
      { method: 'POST' },
    );
    return rep.status;
  }

  test('GET rend les rappels du fil, consigne entière comprise', async () => {
    semerRappel();
    const { statut, corps } = await lire('/orchestrator/conversations/conv-a/rappels');
    expect(statut).toBe(200);
    const data = corps['data'] as { label: string; instruction: string; everyMinutes: number }[];
    expect(data).toHaveLength(1);
    // `☠` La consigne ENTIÈRE : c'est ce que l'orchestrateur recevra mot pour
    // mot. Un libellé seul ne dit rien de ce qui sera réellement injecté.
    expect(data[0]?.instruction).toContain('sorties françaises');
    expect(data[0]?.everyMinutes).toBe(10);
  });

  test('un fil ne voit jamais les rappels d’un autre', async () => {
    semerRappel('conv-a');
    semerRappel('conv-b');
    const { corps } = await lire('/orchestrator/conversations/conv-a/rappels');
    expect(corps['data']).toHaveLength(1);
  });

  test('pause puis reprise, par la route réelle', async () => {
    const id = semerRappel();
    expect(await agir('conv-a', id, 'pause')).toBe(200);
    expect(registre.rappels.lire(id)?.etat).toBe('en_pause');
    expect(await agir('conv-a', id, 'resume')).toBe(200);
    expect(registre.rappels.lire(id)?.etat).toBe('actif');
  });

  test('une action sur le rappel d’un AUTRE fil est refusée en 409', async () => {
    const id = semerRappel('conv-a');
    // `☠` L'isolation tient jusqu'à la route : un identifiant deviné ne doit
    // pas permettre d'éteindre le rappel d'une autre conversation.
    expect(await agir('conv-b', id, 'pause')).toBe(409);
    expect(registre.rappels.lire(id)?.etat).toBe('actif');
  });

  test('une action sans effet répond 409, jamais un succès muet', async () => {
    const id = semerRappel();
    // Reprendre un rappel qui n'est pas en pause ne fait rien : le dire.
    expect(await agir('conv-a', id, 'resume')).toBe(409);
  });

  test('suppression réelle', async () => {
    const id = semerRappel();
    expect(await agir('conv-a', id, 'delete')).toBe(200);
    expect(registre.rappels.lire(id)).toBeNull();
  });

  test('PC éteint : les rappels restent pilotables (H-75)', async () => {
    const id = semerRappel();
    pcOnline = false;
    expect(await agir('conv-a', id, 'pause')).toBe(200);
  });
});

/**
 * `☠` Prod, 01/08 : un mandat auto-approuvé à 21:10:58, puis approuvé d'un clic
 * à 21:11:14 sur une carte d'écran restée périmée. Le control plane rendait un
 * 500 « échec interne du harness » — alors que l'équipe TOURNAIT. Un conflit
 * d'état n'est pas une panne : il se distingue au code de retour, et le message
 * doit dire où regarder.
 */
describe('approbation d’un mandat déjà tranché', () => {
  function demarrerAvecMandats(erreur: Error): ServeurApiWeb {
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => true,
      maintenant: () => MAINTENANT,
      mandats: {
        enAttente: () => [],
        refuser: () => false,
        approuver: async () => { throw erreur; },
      },
    });
    return serveur;
  }

  async function approuver(): Promise<{ statut: number; corps: Record<string, unknown> }> {
    const rep = await fetch(`http://127.0.0.1:${serveur?.port}/api/harness/orchestrator/propositions/p-1/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
  }

  test('☠ répond 409, jamais 500 — et dit que l’équipe est lancée', async () => {
    demarrerAvecMandats(new ErreurMandatDejaTranche('approuvee', 'm-1'));
    const { statut, corps } = await approuver();
    expect(statut).toBe(409);
    expect(String(corps['error'])).toContain('Parc');
  });

  test('un mandat refusé donne aussi 409, avec son propre motif', async () => {
    demarrerAvecMandats(new ErreurMandatDejaTranche('refusee', null));
    const { statut, corps } = await approuver();
    expect(statut).toBe(409);
    expect(String(corps['error'])).toContain('refusee');
  });

  test('☠ une VRAIE panne reste un 500 — le 409 ne doit rien avaler d’autre', async () => {
    // Sans ce test, élargir le rattrapage masquerait les pannes réelles : c'est
    // précisément ce qu'on reproche au comportement qu'on corrige.
    demarrerAvecMandats(new Error('le PC a explosé'));
    expect((await approuver()).statut).toBe(500);
  });
});

/**
 * `☠` Rattachement d'un fil à une machine APRÈS sa création — le seul geste qui
 * sort un fil de l'impasse « aucune machine précisée et plusieurs sont en
 * ligne » (prod, 02/08). Banc sur le VRAI serveur : ce qui est vérifié est le
 * câblage de la route, pas la fonction du dépôt.
 */
describe('API web — rattacher un fil à une machine', () => {
  function demarrerAvecMachines(): ServeurApiWeb {
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      machines: () => [
        { id: 'trinityarch', enLigne: true, evictions: 0, supersedes: 0 },
        { id: 'vps', enLigne: true, evictions: 0, supersedes: 0 },
      ],
      conversations: {
        lister: () => [],
        detail: () => null,
        evenements: () => null,
        creer: () => ({ id: 'c1', titre: 't', creeA: MAINTENANT, majA: MAINTENANT }),
        envoyer: async () => {},
        renommer: async () => {},
        archiver: async () => {},
        compacter: async () => ({ compacte: false, detail: 'rien' }),
      } as never,
    });
    return serveur;
  }

  async function poser(id: string, machine: string): Promise<{ statut: number; corps: Record<string, unknown> }> {
    const s = serveur ?? demarrerAvecMachines();
    const rep = await fetch(`http://127.0.0.1:${s.port}/api/harness/orchestrator/conversations/${id}/machine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine }),
    });
    return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
  }

  test('un fil sans machine est rattaché, et le registre le porte', async () => {
    demarrerAvecMachines();
    registre.conversations.creer({ id: 'fil-nu', titre: 'ouvert PC éteint' });
    const { statut } = await poser('fil-nu', 'vps');
    expect(statut).toBe(200);
    expect(registre.conversations.lire('fil-nu')?.machine).toBe('vps');
  });

  test('☠ une machine inconnue est refusée — jamais un fil irroutable écrit en base', async () => {
    demarrerAvecMachines();
    registre.conversations.creer({ id: 'fil-nu', titre: 't' });
    const { statut, corps } = await poser('fil-nu', 'machine-fantome');
    expect(statut).toBe(400);
    expect(String(corps['error'])).toContain('trinityarch');
    expect(registre.conversations.lire('fil-nu')?.machine).toBeNull();
  });

  test('☠ déplacer un fil qui porte une équipe VIVANTE est refusé (arbitrage du 01/08)', async () => {
    demarrerAvecMachines();
    registre.conversations.creer({ id: 'fil', titre: 't', machine: 'vps' });
    registre.lots.creer({ id: 'lot-1', intention: 'banc' });
    registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
    registre.missions.creer({
      id: 'm-viv',
      lotId: 'lot-1',
      nom: 'x',
      projet: 'stockiop',
      compteId: 'compte-a',
      conversationId: 'fil',
    });
    registre.etats.appliquerEtatHarness('m-viv', 'en_cours', { motif: 'banc' });
    const { statut, corps } = await poser('fil', 'trinityarch');
    expect(statut).toBe(400);
    expect(String(corps['error'])).toContain('vivante');
    expect(registre.conversations.lire('fil')?.machine).toBe('vps');
  });

  test('re-poser la MÊME machine reste accepté, même avec une équipe vivante (idempotent)', async () => {
    demarrerAvecMachines();
    registre.conversations.creer({ id: 'fil', titre: 't', machine: 'vps' });
    const { statut } = await poser('fil', 'vps');
    expect(statut).toBe(200);
  });
});

/**
 * `☠` Banc d'ASSEMBLAGE, pas de fonction : `vue-conversations.test.ts` prouve
 * que la traduction est juste, celui-ci prouve qu'elle est BRANCHÉE. C'est la
 * séparation qui a coûté cher le 01/08 — une traduction correcte que la route
 * n'appelait pas. Ici, le port de conversations lit le VRAI registre, donc un
 * champ non joint par la route ressort vide et le test le voit.
 */
describe('API web — fenêtre d’autonomie et plafond d’un fil (migrations 15 et 26)', () => {
  function demarrerAvecFils(): ServeurApiWeb {
    serveur = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => pcOnline,
      maintenant: () => MAINTENANT,
      // `as never` : le port compte une douzaine de méthodes dont ce banc
      // n'exerce que la lecture — même doublure que les bancs voisins.
      conversations: {
        listerConversations: () =>
          registre.conversations.lister().map((c) => ({
            id: c.id,
            titre: c.titre,
            creeA: c.creeA,
            majA: c.majA,
            active: false,
            contextePct: null,
            compactions: c.compactions,
            machine: c.machine,
          })),
        detail: (id: string) => {
          const c = registre.conversations.lire(id);
          return c === null
            ? null
            : {
                id: c.id,
                titre: c.titre,
                evenements: [],
                curseur: 0,
                genere: false,
                active: false,
                contextePct: null,
                compactions: c.compactions,
                modele: c.modele,
                effort: c.effort,
                modeRapide: c.modeRapide,
                partiel: null,
              };
        },
        evenementsDepuis: () => null,
        creer: () => ({ id: 'c1', titre: 't', creeA: MAINTENANT, majA: MAINTENANT }),
        envoyer: async () => {},
        renommer: () => true,
        archiver: () => true,
        compacter: async () => ({ compacte: false, detail: 'rien' }),
        interrompre: async () => ({ interrompu: false, detail: 'rien' }),
      } as never,
    });
    return serveur;
  }

  function semerFil(id = 'fil-nuit'): string {
    registre.conversations.creer({ id, titre: 'nuit du 07' });
    return id;
  }

  test('☠ une plage posée est RESSERVIE par le détail — c’est ce qui manquait', async () => {
    demarrerAvecFils();
    const id = semerFil();
    registre.conversations.poserFenetreAutonomie(id, MAINTENANT, MAINTENANT + 28_800_000, 'finir la migration');
    const data = (await lire(`/orchestrator/conversations/${id}`)).corps['data'] as Record<string, unknown>;
    expect(data['autonomieDebut']).toBe(MAINTENANT);
    expect(data['autonomieFin']).toBe(MAINTENANT + 28_800_000);
    expect(data['autonomieObjectif']).toBe('finir la migration');
  });

  test('☠ sans plage, les trois champs sont null — jamais absents du corps', async () => {
    demarrerAvecFils();
    const id = semerFil();
    const data = (await lire(`/orchestrator/conversations/${id}`)).corps['data'] as Record<string, unknown>;
    // Un champ ABSENT se lit « pas encore chargé » ; `null` se lit « aucune
    // plage ». C'est exactement la distinction que l'écran n'avait pas.
    expect('autonomieDebut' in data).toBe(true);
    expect(data['autonomieDebut']).toBeNull();
    expect(data['autonomieFin']).toBeNull();
  });

  test('le plafond propre au fil ressort sous sa forme lisible', async () => {
    demarrerAvecFils();
    const id = semerFil();
    registre.conversations.reglerPlafondAutonomie(id, { type: 'valeur', max: 12 });
    const data = (await lire(`/orchestrator/conversations/${id}`)).corps['data'] as Record<string, unknown>;
    expect(data['plafondAutonomie']).toBe('12');
  });

  test('☠ un fil qui n’a rien réglé rend « herite », jamais « illimite »', async () => {
    demarrerAvecFils();
    const id = semerFil();
    const data = (await lire(`/orchestrator/conversations/${id}`)).corps['data'] as Record<string, unknown>;
    expect(data['plafondAutonomie']).toBe('herite');
  });

  test('la LISTE porte les mêmes champs — l’écran n’a pas à rouvrir chaque fil', async () => {
    demarrerAvecFils();
    const id = semerFil();
    registre.conversations.poserFenetreAutonomie(id, MAINTENANT, MAINTENANT + 3_600_000, 'veille');
    registre.conversations.reglerPlafondAutonomie(id, { type: 'illimite' });
    const liste = (await lire('/orchestrator/conversations')).corps['data'] as Record<string, unknown>[];
    expect(liste).toHaveLength(1);
    expect(liste[0]?.['autonomieFin']).toBe(MAINTENANT + 3_600_000);
    expect(liste[0]?.['plafondAutonomie']).toBe('illimite');
  });
});
