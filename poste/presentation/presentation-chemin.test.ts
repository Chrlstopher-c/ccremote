import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { lecteurImagesChemin } from './images-chemin.ts';
import { PresentationSession } from './session-presentation.ts';
import { Stockage } from './stockage.ts';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function messageOutil(chemin: string, parent: string | null = null): SDKMessage {
  const resultat = JSON.stringify({ success: true, path: chemin, full_page: false });
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: resultat }],
    },
    parent_tool_use_id: parent,
  } as unknown as SDKMessage;
}

interface Banc {
  readonly racine: string;
  readonly espace: string;
  readonly dehors: string;
  readonly evenements: Evenement[];
  readonly stockage: Stockage;
}

function banc(): Banc {
  const racine = mkdtempSync(join(tmpdir(), 'presentation-chemin-'));
  const espace = join(racine, 'espace');
  const dehors = join(racine, 'dehors');
  mkdirSync(espace);
  mkdirSync(dehors);
  writeFileSync(join(espace, 'dedans.png'), PNG_1x1);
  writeFileSync(join(dehors, 'dehors.png'), PNG_1x1);
  const stockage = new Stockage(join(racine, 'donnees'));
  return { racine, espace, dehors, evenements: [], stockage };
}

function session(b: Banc, racines: string[] | null): PresentationSession {
  return new PresentationSession({
    sessionId: 'sess-1',
    cwd: b.espace,
    racines: [b.espace],
    stockage: b.stockage,
    emettre: (evt) => b.evenements.push(evt),
    journal: pino({ level: 'silent' }),
    lireChemin: lecteurImagesChemin(racines, pino({ level: 'silent' })),
  });
}

describe('images citées par chemin dans un message du SDK', () => {
  test('résultat d’outil avec le chemin d’une capture : image d’origine outil', () => {
    const b = banc();
    try {
      session(b, null).depuisMessage(messageOutil(join(b.dehors, 'dehors.png')));
      expect(b.evenements).toHaveLength(1);
      expect(b.evenements[0]).toMatchObject({ type: 'image', origine: 'outil', mime: 'image/png' });
    } finally {
      rmSync(b.racine, { recursive: true, force: true });
    }
  });

  test('agent auteur (sous-agent) : porté par l’événement', () => {
    const b = banc();
    try {
      session(b, null).depuisMessage(messageOutil(join(b.dehors, 'dehors.png'), 'agent-7'));
      expect(b.evenements[0]).toMatchObject({ type: 'image', agent: 'agent-7' });
    } finally {
      rmSync(b.racine, { recursive: true, force: true });
    }
  });

  test('même image reçue deux fois : un seul fichier stocké, identifiant stable', () => {
    const b = banc();
    try {
      const s = session(b, null);
      const message = messageOutil(join(b.dehors, 'dehors.png'));
      s.depuisMessage(message);
      s.depuisMessage(message);
      const ids = b.evenements.map((e) => (e.type === 'image' ? e.fichier : ''));
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(1);
      const dossier = join(b.racine, 'donnees', 'fichiers', 'sess-1');
      expect(readdirSync(dossier).filter((nom) => !nom.endsWith('.json'))).toHaveLength(1);
    } finally {
      rmSync(b.racine, { recursive: true, force: true });
    }
  });

  test('session d’invité : une image hors de son espace n’est pas présentée, une image de l’espace l’est', () => {
    const b = banc();
    try {
      const s = session(b, [b.espace]);
      s.depuisMessage(messageOutil(join(b.dehors, 'dehors.png')));
      expect(b.evenements).toHaveLength(0);
      s.depuisMessage(messageOutil(join(b.espace, 'dedans.png')));
      expect(b.evenements).toHaveLength(1);
    } finally {
      rmSync(b.racine, { recursive: true, force: true });
    }
  });

  test('sans lecteur injecté : aucun événement par chemin', () => {
    const b = banc();
    try {
      const s = new PresentationSession({
        sessionId: 'sess-1',
        cwd: b.espace,
        racines: [b.espace],
        stockage: b.stockage,
        emettre: (evt) => b.evenements.push(evt),
        journal: pino({ level: 'silent' }),
      });
      s.depuisMessage(messageOutil(join(b.dehors, 'dehors.png')));
      expect(b.evenements).toHaveLength(0);
    } finally {
      rmSync(b.racine, { recursive: true, force: true });
    }
  });
});
