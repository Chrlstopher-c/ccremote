// Responsabilité : tests du magasin de l'état du monde — abonnements par sélecteur, fil borné, dédoublonnage.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { EvenementDate, EtatRelais, MessageClient, Notification, ResumeSession, VueMachine } from './contrat';
import { MagasinMonde } from './monde-etat';
import { projetsDuMonde, sessionsActives } from './monde-selecteurs';

const MAINTENANT = '2026-11-15T10:00:00.000Z';

function session(id: string, partiel: Partial<ResumeSession> = {}): ResumeSession {
  return {
    id,
    machine: 'poste-a',
    projet: { machine: 'poste-a', chemin: '/demo/agent-hq', nom: 'agent-hq' },
    cwd: '/demo/agent-hq',
    titre: `Session ${id}`,
    objectif: null,
    modele: 'opus',
    compte: 'demo',
    autonomie: true,
    statut: 'travail',
    contexte: { tokens: 1, max: 10 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: true,
    creeLe: MAINTENANT,
    majLe: MAINTENANT,
    ...partiel,
  };
}

function machine(id: string): VueMachine {
  return {
    id,
    description: id,
    racines: [],
    projets: [],
    version: 'x',
    etat: null,
    derniereVue: MAINTENANT,
    enLigne: true,
  };
}

function evenement(seq: number, sessionId = 's1'): EvenementDate {
  return { seq, sessionId, ts: MAINTENANT, evt: { type: 'texte', texte: `t${seq}` } };
}

function notification(seq: number): Notification {
  return { seq, sessionId: 's1', niveau: 'info', titre: `n${seq}`, texte: '', ts: MAINTENANT, lue: false };
}

function etatInitial(sessions: ResumeSession[] = []): EtatRelais {
  return { version: 1, machines: [machine('poste-a')], sessions, notifications: [], reveilPossible: [] };
}

describe('MagasinMonde : état et abonnements', () => {
  test('initialiser remplit le magasin et prévient les abonnés du sélecteur', () => {
    const magasin = new MagasinMonde();
    const recus: number[] = [];
    magasin.abonner((e) => e.sessions.length, (n) => recus.push(n));
    magasin.initialiser(etatInitial([session('s1'), session('s2')]));
    expect(magasin.lire().sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(recus).toEqual([2]);
  });

  test('un abonné n est prévenu que si sa valeur change, pas à chaque message', () => {
    const magasin = new MagasinMonde();
    let appels = 0;
    magasin.abonner((e) => e.lien, () => (appels += 1));
    magasin.appliquer({ type: 'echo', echo: {} });
    magasin.definirLien('ouvert');
    magasin.definirLien('ouvert');
    expect(appels).toBe(1);
  });

  test('désabonner arrête les notifications', () => {
    const magasin = new MagasinMonde();
    let appels = 0;
    const retirer = magasin.abonner((e) => e.version, () => (appels += 1));
    magasin.initialiser(etatInitial());
    retirer();
    magasin.initialiser({ ...etatInitial(), version: 2 });
    expect(appels).toBe(1);
  });

  test('un abonné qui lève une erreur n empêche pas les autres', () => {
    const magasin = new MagasinMonde();
    let atteint = false;
    magasin.abonner((e) => e.lien, () => {
      throw new Error('boom');
    });
    magasin.abonner((e) => e.lien, () => (atteint = true));
    magasin.definirLien('ouvert');
    expect(atteint).toBe(true);
  });
});

describe('MagasinMonde : sessions et machines', () => {
  test('une session reçue remplace celle de même id, sinon elle s ajoute', () => {
    const magasin = new MagasinMonde();
    magasin.initialiser(etatInitial([session('s1')]));
    magasin.appliquer({ type: 'session', session: session('s1', { statut: 'attente' }) });
    magasin.appliquer({ type: 'session', session: session('s2') });
    const sessions = magasin.lire().sessions;
    expect(sessions.map((s) => `${s.id}:${s.statut}`)).toEqual(['s1:attente', 's2:travail']);
  });

  test('une machine reçue remplace celle de même id', () => {
    const magasin = new MagasinMonde();
    magasin.initialiser(etatInitial());
    magasin.appliquer({ type: 'machine', machine: { ...machine('poste-a'), enLigne: false } });
    expect(magasin.lire().machines[0]?.enLigne).toBe(false);
  });

  test('projetsDuMonde et sessionsActives dérivent sans modifier le magasin', () => {
    const magasin = new MagasinMonde();
    magasin.initialiser(etatInitial([session('s1'), session('s2', { archivee: true })]));
    expect(sessionsActives(magasin.lire()).map((s) => s.id)).toEqual(['s1']);
    expect(projetsDuMonde(magasin.lire())).toEqual([
      { projet: { machine: 'poste-a', chemin: '/demo/agent-hq', nom: 'agent-hq' }, sessions: 1 },
    ]);
  });
});

describe('MagasinMonde : fil d événements borné', () => {
  test('les événements s ajoutent dans l ordre, un seq déjà vu est ignoré', () => {
    const magasin = new MagasinMonde();
    magasin.appliquer({ type: 'evenement', evenement: evenement(1) });
    magasin.appliquer({ type: 'evenement', evenement: evenement(2) });
    magasin.appliquer({ type: 'evenement', evenement: evenement(2) });
    expect(magasin.lire().fil['s1']?.map((e) => e.seq)).toEqual([1, 2]);
  });

  test('le fil ne garde que les plus récents au-delà de sa taille', () => {
    const magasin = new MagasinMonde({ fil: 3, notifications: 10 });
    for (let seq = 1; seq <= 5; seq += 1) magasin.appliquer({ type: 'evenement', evenement: evenement(seq) });
    expect(magasin.lire().fil['s1']?.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  test('chargerFil fusionne avec le fil déjà reçu, trie et dédoublonne', () => {
    const magasin = new MagasinMonde({ fil: 4, notifications: 10 });
    magasin.appliquer({ type: 'evenement', evenement: evenement(3) });
    magasin.chargerFil('s1', [evenement(1), evenement(2), evenement(3), evenement(4), evenement(5)]);
    expect(magasin.lire().fil['s1']?.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
  });

  test('un fil ne fuit pas vers une autre session', () => {
    const magasin = new MagasinMonde();
    magasin.appliquer({ type: 'evenement', evenement: evenement(1, 's2') });
    expect(magasin.lire().fil['s1']).toBeUndefined();
    expect(magasin.lire().fil['s2']?.length).toBe(1);
  });
});

describe('MagasinMonde : notifications et lien', () => {
  test('les notifications sont bornées et dédoublonnées par seq', () => {
    const magasin = new MagasinMonde({ fil: 10, notifications: 2 });
    const messages: MessageClient[] = [1, 2, 2, 3].map((seq) => ({
      type: 'notification',
      notification: notification(seq),
    }));
    for (const m of messages) magasin.appliquer(m);
    expect(magasin.lire().notifications.map((n) => n.seq)).toEqual([2, 3]);
  });

  test('definirLien prévient les abonnés au lien', () => {
    const magasin = new MagasinMonde();
    const etats: string[] = [];
    magasin.abonner((e) => e.lien, (l) => etats.push(l));
    magasin.definirLien('connexion');
    magasin.definirLien('coupe');
    magasin.definirLien('ouvert');
    expect(etats).toEqual(['coupe', 'ouvert']);
  });
});
