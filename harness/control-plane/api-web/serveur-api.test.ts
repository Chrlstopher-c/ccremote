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
