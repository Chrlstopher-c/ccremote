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
import { PERIODE_RELECTURE_MS } from './suivi-transcript.ts';

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
    journal: pino({ enabled: false }),
    sortie: {
      evenement: () => undefined,
      resume: () => undefined,
      historique: (_id, evts) => void appels.push(evts.map((e) => e.evt)),
    },
    executable: null,
    socket: '/run/poste.sock',
    periodeRelectureMs: 0,
  };
  const session = new SessionSdk(persistee(racine, null, { statut: 'fermee' }), env);
  return { session, chemin, appels, nettoyer: () => rmSync(racine, { recursive: true, force: true }) };
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

  test('des écritures rapprochées ne relancent pas une relecture avant la fin de la période', () => {
    const racine = mkdtempSync(join(tmpdir(), 'quart-suivi-'));
    const chemin = cheminTranscript('/projets/app', 'claude-abc', racine);
    mkdirSync(dirname(chemin), { recursive: true });
    const appels: Evenement[][] = [];
    const env: EnvironnementSdk = {
      journal: pino({ enabled: false }),
      sortie: {
        evenement: () => undefined,
        resume: () => undefined,
        historique: (_id, e) => void appels.push(e.map((x) => x.evt)),
      },
      executable: null,
      socket: '/run/poste.sock',
      periodeRelectureMs: 60_000,
    };
    const session = new SessionSdk(persistee(racine, null, { statut: 'fermee' }), env);
    try {
      writeFileSync(chemin, ligne('u1', null, 'user', 'un', 0));
      session.lire();
      appendFileSync(chemin, ligne('a1', 'u1', 'assistant', 'deux', 1));
      session.lire();
      appendFileSync(chemin, ligne('u2', 'a1', 'user', 'trois', 2));
      session.lire();
      expect(appels).toHaveLength(1);
      expect(textes(appels[0] ?? [])).toEqual(['un', 'deux']);
    } finally {
      rmSync(racine, { recursive: true, force: true });
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
    journal: pino({ enabled: false }),
    sortie: {
      evenement: () => undefined,
      resume: () => undefined,
      historique: (_id, evts) => void appels.push(evts.map((e) => e.evt)),
    },
    executable: null,
    socket: '/run/poste.sock',
    periodeRelectureMs: 0,
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

describe('période de relecture', () => {
  test('la période minimale par défaut est de 10 s', () => {
    expect(PERIODE_RELECTURE_MS).toBe(10_000);
  });
});
