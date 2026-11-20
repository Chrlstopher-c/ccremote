// Responsabilité : tests du suivi d'un transcript par une session SDK non pilotée ici — relu quand il grossit, jamais
// relu sans changement, et sans relecture à la première vue.
import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { type EnvironnementSdk, SessionSdk } from './session-sdk.ts';
import { cheminTranscript } from './transcript.ts';
import { persistee } from './faux-sdk.ts';
import { Stockage } from '../presentation/stockage.ts';
import { CHEVAUCHEMENT_DIRECT } from './suivi-transcript.ts';

const DEBUT = Date.parse('2026-11-01T10:00:00.000Z');

function ligne(uuid: string, parent: string | null, type: 'user' | 'assistant', texte: string, rang: number): string {
  const message =
    type === 'user'
      ? { role: 'user', content: texte }
      : { role: 'assistant', content: [{ type: 'text', text: texte }] };
  const timestamp = new Date(DEBUT + rang * 1000).toISOString();
  return `${JSON.stringify({ type, uuid, parentUuid: parent, timestamp, sessionId: 'claude-abc', message })}\n`;
}

function textes(evenements: readonly Evenement[]): string[] {
  return evenements.map((e) => (e.type === 'message' || e.type === 'texte' ? e.texte : e.type));
}

function montage(): {
  session: SessionSdk;
  chemin: string;
  appels: Evenement[][];
  nettoyer: () => void;
} {
  const racine = mkdtempSync(join(tmpdir(), 'quart-suivi-'));
  const chemin = cheminTranscript('/projets/app', 'claude-abc', racine);
  mkdirSync(dirname(chemin), { recursive: true });
  const appels: Evenement[][] = [];
  const env: EnvironnementSdk = {
    relectureRecenteMs: 0,
    journal: pino({ enabled: false }),
    sortie: {
      evenement: () => undefined,
      resume: () => undefined,
      historique: (_id, evts) => void appels.push(evts.map((e) => e.evt)),
    },
    executable: null,
    socket: '/run/poste.sock',
  };
  const session = new SessionSdk(persistee(racine, null, { statut: 'fermee' }), env);
  return {
    session,
    chemin,
    appels,
    nettoyer: () => {
      session.liberer();
      rmSync(racine, { recursive: true, force: true });
    },
  };
}

describe('suivi d’un transcript non piloté par le poste', () => {
  test('un transcript qui grossit est relu une fois par changement ; sans changement, rien n’est relu', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0) + ligne('a1', 'u1', 'assistant', 'deux', 1));
      session.definirTranscript(chemin);
      expect(appels).toHaveLength(1);
      expect(textes(appels[0] ?? [])).toEqual(['un', 'deux']);

      session.lire();
      expect(appels).toHaveLength(1);

      appendFileSync(chemin, ligne('u2', 'a1', 'user', 'trois', 2));
      session.lire();
      session.lire();
      expect(appels).toHaveLength(2);
      expect(textes(appels[1] ?? [])).toEqual(['un', 'deux', 'trois']);

      appendFileSync(chemin, ligne('a2', 'u2', 'assistant', 'quatre', 3));
      session.lire();
      expect(appels).toHaveLength(3);
      expect(textes(appels[2] ?? [])).toEqual(['un', 'deux', 'trois', 'quatre']);
    } finally {
      nettoyer();
    }
  });

  test('à la première vue d’une session fermée, le transcript existant n’est pas relu', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0));
      session.lire();
      expect(appels).toHaveLength(0);

      appendFileSync(chemin, ligne('a1', 'u1', 'assistant', 'deux', 1));
      session.lire();
      expect(appels).toHaveLength(1);
      expect(textes(appels[0] ?? [])).toEqual(['un', 'deux']);
    } finally {
      nettoyer();
    }
  });

  test('des écritures rapprochées sont toutes envoyées, sans attendre de période', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0));
      session.lire();
      appendFileSync(chemin, ligne('a1', 'u1', 'assistant', 'deux', 1));
      session.lire();
      appendFileSync(chemin, ligne('u2', 'a1', 'user', 'trois', 2));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(textes(appels[1] ?? [])).toEqual(['un', 'deux', 'trois']);
    } finally {
      nettoyer();
    }
  });

  test('sans transcript, rien à relire', () => {
    const { session, appels, nettoyer } = montage();
    try {
      session.lire();
      expect(appels).toHaveLength(0);
    } finally {
      nettoyer();
    }
  });
});

const PNG = 'iVBORw0KGgo=';

function ligneImage(uuid: string, parent: string | null, rang: number): string {
  const message = {
    role: 'user',
    content: [
      { type: 'text', text: 'regarde' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
    ],
  };
  const timestamp = new Date(DEBUT + rang * 1000).toISOString();
  return `${JSON.stringify({ type: 'user', uuid, parentUuid: parent, timestamp, sessionId: 'claude-abc', message })}\n`;
}

function environnement(appels: Evenement[][], presentation?: EnvironnementSdk['presentation']): EnvironnementSdk {
  return {
    relectureRecenteMs: 0,
    journal: pino({ enabled: false }),
    sortie: {
      evenement: () => undefined,
      resume: () => undefined,
      historique: (_id, evts) => void appels.push(evts.map((e) => e.evt)),
    },
    executable: null,
    socket: '/run/poste.sock',
    presentation,
  };
}

function transcriptDe(racine: string): string {
  const chemin = cheminTranscript('/projets/app', 'claude-abc', racine);
  mkdirSync(dirname(chemin), { recursive: true });
  return chemin;
}

describe('relectures : images stables, queue seulement', () => {
  test('deux relectures d’un transcript avec image donnent des événements identiques et une seule écriture', () => {
    const racine = mkdtempSync(join(tmpdir(), 'quart-suivi-'));
    try {
      const chemin = transcriptDe(racine);
      writeFileSync(chemin, ligneImage('u1', null, 0));
      const stockage = new Stockage(racine);
      let ecritures = 0;
      const ecrire = stockage.ecrire.bind(stockage);
      stockage.ecrire = (...args: Parameters<Stockage['ecrire']>) => {
        ecritures += 1;
        ecrire(...args);
      };
      const appels: Evenement[][] = [];
      const session = new SessionSdk(
        persistee(racine, null, { statut: 'fermee' }),
        environnement(appels, { stockage, racines: [] }),
      );
      session.rejouerHistorique(chemin);
      session.rejouerHistorique(chemin);

      const images = appels.map((evts) => evts.filter((e) => e.type === 'image').map((e) => JSON.stringify(e)));
      expect(images[0]).toHaveLength(1);
      expect(images[1]).toEqual(images[0]);
      expect(ecritures).toBe(1);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  test('une relecture après croissance n’émet que la queue, avec un chevauchement de 100 événements', () => {
    const racine = mkdtempSync(join(tmpdir(), 'quart-suivi-'));
    try {
      const chemin = transcriptDe(racine);
      const lignes = (de: number, a: number): string =>
        Array.from({ length: a - de }, (_, k) =>
          ligne(`u${de + k}`, de + k ? `u${de + k - 1}` : null, 'user', `l${de + k}`, de + k),
        ).join('');
      writeFileSync(chemin, lignes(0, 150));
      const appels: Evenement[][] = [];
      const session = new SessionSdk(persistee(racine, null, { statut: 'fermee' }), environnement(appels));
      session.rejouerHistorique(chemin);
      appendFileSync(chemin, lignes(150, 160));
      session.rejouerHistorique(chemin);

      expect(appels[0]).toHaveLength(150);
      expect(appels[1]).toHaveLength(110);
      expect(textes(appels[1] ?? [])[0]).toBe('l50');
      expect(textes(appels[1] ?? []).at(-1)).toBe('l159');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });

  test('un transcript réécrit plus court, ou une relecture complète demandée, renvoie tout', () => {
    const racine = mkdtempSync(join(tmpdir(), 'quart-suivi-'));
    try {
      const chemin = transcriptDe(racine);
      const lignes = (n: number): string =>
        Array.from({ length: n }, (_, k) => ligne(`u${k}`, k ? `u${k - 1}` : null, 'user', `l${k}`, k)).join('');
      writeFileSync(chemin, lignes(150));
      const appels: Evenement[][] = [];
      const session = new SessionSdk(persistee(racine, null, { statut: 'fermee' }), environnement(appels));
      session.rejouerHistorique(chemin);
      session.rejouerHistorique(chemin, true);
      writeFileSync(chemin, lignes(5));
      session.rejouerHistorique(chemin);

      expect(appels.map((a) => a.length)).toEqual([150, 150, 5]);
      expect(textes(appels[2] ?? [])[0]).toBe('l0');
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});

const ATTENTE_MS = 500;

async function attendre(condition: () => boolean, delaiMs = ATTENTE_MS): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await new Promise((r) => setTimeout(r, 5));
}

function lignesBrutes(...objets: unknown[]): string {
  return objets.map((o) => `${JSON.stringify(o)}\n`).join('');
}

function suite(de: number, a: number): string {
  return Array.from({ length: a - de }, (_, k) => {
    const rang = de + k;
    return ligne(`u${rang}`, rang ? `u${rang - 1}` : null, 'user', `l${rang}`, rang);
  }).join('');
}

describe('au fil de l’eau : surveillance du transcript', () => {
  test('une écriture arrive en moins de 500 ms, sans attendre le balayage', async () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0) + ligne('a1', 'u1', 'assistant', 'deux', 1));
      session.lire();
      const debut = performance.now();
      appendFileSync(chemin, ligne('u2', 'a1', 'user', 'trois', 2));
      await attendre(() => appels.length > 0);
      expect(appels).toHaveLength(1);
      expect(performance.now() - debut).toBeLessThan(ATTENTE_MS);
      expect(textes(appels[0] ?? [])).toEqual(['un', 'deux', 'trois']);
    } finally {
      nettoyer();
    }
  });

  test('seule la suite part, avec les derniers événements déjà envoyés en chevauchement', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, suite(0, 150));
      session.definirTranscript(chemin);
      appendFileSync(chemin, suite(150, 152));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(appels[1]).toHaveLength(CHEVAUCHEMENT_DIRECT + 2);
      expect(textes(appels[1] ?? [])[0]).toBe('l145');
      expect(textes(appels[1] ?? []).at(-1)).toBe('l151');
    } finally {
      nettoyer();
    }
  });

  test('une ligne en cours d’écriture attend sa fin de ligne', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0));
      session.definirTranscript(chemin);
      const complete = ligne('a1', 'u1', 'assistant', 'deux', 1);
      appendFileSync(chemin, complete.slice(0, 40));
      session.lire();
      expect(appels).toHaveLength(1);
      appendFileSync(chemin, complete.slice(40));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(textes(appels[1] ?? [])).toEqual(['un', 'deux']);
    } finally {
      nettoyer();
    }
  });

  test('un fichier tronqué repart d’une relecture complète', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, suite(0, 3));
      session.definirTranscript(chemin);
      writeFileSync(chemin, suite(0, 1));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(textes(appels[1] ?? [])).toEqual(['l0']);
    } finally {
      nettoyer();
    }
  });

  test('un rembobinage qui casse la branche repart d’une relecture complète', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(
        chemin,
        ligne('u1', null, 'user', 'un', 0) +
          ligne('a1', 'u1', 'assistant', 'deux', 1) +
          ligne('u2', 'a1', 'user', 'trois', 2),
      );
      session.definirTranscript(chemin);
      appendFileSync(chemin, ligne('u3', 'a1', 'user', 'nouveau', 3));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(textes(appels[1] ?? [])).toEqual(['un', 'deux', 'nouveau']);
    } finally {
      nettoyer();
    }
  });

  test('un résultat d’outil parallèle s’ajoute sans relecture complète', () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      const outil = (uuid: string, parent: string, id: string): string =>
        lignesBrutes({
          type: 'assistant',
          uuid,
          parentUuid: parent,
          timestamp: new Date(DEBUT).toISOString(),
          message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] },
        });
      const reponse = (uuid: string, parent: string, id: string): string =>
        lignesBrutes({
          type: 'user',
          uuid,
          parentUuid: parent,
          timestamp: new Date(DEBUT).toISOString(),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
        });
      writeFileSync(
        chemin,
        suite(0, 20) + outil('p20', 'u19', 'T1') + outil('p21', 'p20', 'T2') + reponse('p22', 'p21', 'T1'),
      );
      session.definirTranscript(chemin);
      const total = appels[0]?.length ?? 0;
      appendFileSync(chemin, reponse('p23', 'p21', 'T2'));
      session.lire();
      expect(appels).toHaveLength(2);
      expect(appels[1]?.length ?? 0).toBeLessThanOrEqual(CHEVAUCHEMENT_DIRECT + 1);
      expect(total).toBeGreaterThan(CHEVAUCHEMENT_DIRECT + 1);
    } finally {
      nettoyer();
    }
  });

  test('un transcript créé après l’ouverture est vu dès sa première écriture', async () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      session.lire();
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0) + ligne('a1', 'u1', 'assistant', 'deux', 1));
      await attendre(() => appels.length > 0);
      expect(textes(appels[0] ?? [])).toEqual(['un', 'deux']);
    } finally {
      nettoyer();
    }
  });

  test('après l’arrêt de la surveillance, plus rien n’est envoyé', async () => {
    const { session, chemin, appels, nettoyer } = montage();
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0));
      session.definirTranscript(chemin);
      session.lire();
      session.liberer();
      appendFileSync(chemin, ligne('a1', 'u1', 'assistant', 'deux', 1));
      await new Promise((r) => setTimeout(r, 300));
      expect(appels).toHaveLength(1);
    } finally {
      nettoyer();
    }
  });
});
