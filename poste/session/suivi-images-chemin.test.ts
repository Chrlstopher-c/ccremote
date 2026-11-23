// Responsabilité : câblage des images par chemin dans le suivi d'une session — une session d'invité ne présente que les
// images de son espace et de ses dossiers de lecture ; une session ordinaire présente toute image lisible.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pino from 'pino';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { Evenement } from '../../commun/session.ts';
import { persistee } from './faux-sdk.ts';
import { Stockage } from '../presentation/stockage.ts';
import { type EnvironnementSdk, SessionSdk } from './session-sdk.ts';
import { cheminTranscript } from './transcript.ts';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const DEBUT = '2026-11-01T10:00:00.000Z';

const CADRE: Omit<CadreInvite, 'espace' | 'config' | 'lecture'> = {
  membre: 'abcdefabcdef',
  nom: 'Elie',
  prompt: 'Réponds en français.',
  remoteControl: false,
};

function ligneCapture(chemin: string): string {
  const resultat = JSON.stringify({ success: true, path: chemin, full_page: false });
  const ligne = {
    type: 'user',
    uuid: 'r-1',
    parentUuid: null,
    timestamp: DEBUT,
    sessionId: 'claude-abc',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-1', content: resultat }] },
  };
  return `${JSON.stringify(ligne)}\n`;
}

interface Montage {
  readonly session: SessionSdk;
  readonly chemin: string;
  readonly images: Evenement[];
  readonly espace: string;
  readonly dehors: string;
  readonly nettoyer: () => void;
}

function environnement(racine: string, images: Evenement[]): EnvironnementSdk {
  return {
    relectureRecenteMs: 0,
    journal: pino({ enabled: false }),
    sortie: {
      evenement: () => undefined,
      resume: () => undefined,
      historique: (_id, evts) => {
        for (const e of evts) if (e.evt.type === 'image') images.push(e.evt);
      },
    },
    executable: null,
    socket: '/run/poste.sock',
    presentation: { stockage: new Stockage(racine), racines: [] },
  };
}

// Racine : transcript (configDir), espace de l'invité, dossier voisin hors espace, et une capture dans chacun.
function montage(invite: boolean): Montage {
  const racine = mkdtempSync(join(tmpdir(), 'suivi-images-chemin-'));
  const espace = join(racine, 'espace');
  const dehors = join(racine, 'dehors');
  mkdirSync(espace);
  mkdirSync(dehors);
  writeFileSync(join(espace, 'dedans.png'), PNG_1x1);
  writeFileSync(join(dehors, 'dehors.png'), PNG_1x1);
  const chemin = cheminTranscript('/projets/app', 'claude-abc', racine);
  mkdirSync(dirname(chemin), { recursive: true });
  const images: Evenement[] = [];
  const base = persistee(racine, null, { statut: 'fermee' });
  const cadre = { ...CADRE, espace, config: racine, lecture: [] };
  const fiche = invite ? { ...base, invite: { cadre, configCompte: null } } : base;
  const session = new SessionSdk(fiche, environnement(racine, images));
  return {
    session,
    chemin,
    images,
    espace,
    dehors,
    nettoyer: () => {
      session.liberer();
      rmSync(racine, { recursive: true, force: true });
    },
  };
}

describe('images par chemin dans le suivi d’un transcript', () => {
  test('session d’invité : seule une image de son espace est présentée', () => {
    const m = montage(true);
    try {
      writeFileSync(m.chemin, ligneCapture(join(m.dehors, 'dehors.png')));
      m.session.definirTranscript(m.chemin);
      expect(m.images).toHaveLength(0);

      writeFileSync(m.chemin, ligneCapture(join(m.espace, 'dedans.png')));
      m.session.rejouerHistorique(m.chemin, true);
      expect(m.images).toHaveLength(1);
      expect(m.images[0]).toMatchObject({ origine: 'outil', mime: 'image/png' });
    } finally {
      m.nettoyer();
    }
  });

  test('session ordinaire : une image lisible hors de tout dossier est présentée', () => {
    const m = montage(false);
    try {
      writeFileSync(m.chemin, ligneCapture(join(m.dehors, 'dehors.png')));
      m.session.definirTranscript(m.chemin);
      expect(m.images).toHaveLength(1);
      expect(m.images[0]).toMatchObject({ origine: 'outil', mime: 'image/png' });
    } finally {
      m.nettoyer();
    }
  });
});
