// Responsabilité : tests du recalage des fiches fermées par le balayage — une fiche créée avant son transcript
// reçoit son modèle et son mode dès que le transcript apparaît, puis une seule fois par changement du fichier.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ConfigPoste } from '../config.ts';
import { BalayageSessions } from './balayage-sessions.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import { MarquesRecalage } from './recalage-demarrage.ts';
import { ModelesChoisis } from './modeles-choisis.ts';
import type { SessionPoste } from './session-poste.ts';
import { SessionsSupprimees } from './suppression.ts';
import { cheminTranscript } from './transcript.ts';

const CONFIG: ConfigPoste = {
  machine: 'poste-test',
  relais: 'relais-test',
  secret: 'secret-test',
  description: 'poste de test',
  racines: [],
  comptes: { principal: null },
  distants: [],
  donnees: 'donnees-test',
  fenetreContexte: 1_000_000,
};

const CONV = 'c0000000-0000-4000-8000-00000000000b';
const CWD = '/home/x/automate';

const LIGNE_USER = {
  type: 'user',
  timestamp: '2026-11-21T08:00:00.000Z',
  permissionMode: 'auto',
  message: { role: 'user', content: 'Go' },
};
const LIGNE_ASSISTANT = {
  type: 'assistant',
  timestamp: '2026-11-21T08:00:05.000Z',
  message: {
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Fait' }],
    usage: { input_tokens: 3, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 2 },
  },
};
const LIGNE_SUITE = {
  ...LIGNE_USER,
  timestamp: '2026-11-21T08:10:00.000Z',
  message: { role: 'user', content: 'Suite' },
};

function environnement(): { configDir: string; racine: string; chemin: string; nettoyer: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'balayage-fermees-'));
  const configDir = join(base, 'config');
  const racine = join(base, 'desktop');
  mkdirSync(racine, { recursive: true });
  const chemin = cheminTranscript(CWD, CONV, configDir);
  return { configDir, racine, chemin, nettoyer: () => rmSync(base, { recursive: true, force: true }) };
}

function ecrireTranscript(chemin: string, lignes: readonly object[]): void {
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function balayageAvec(session: SessionPoste, racine: string): BalayageSessions {
  return new BalayageSessions({
    config: CONFIG,
    journal,
    sessions: new Map([[session.resume.id, session]]),
    supprimees: new SessionsSupprimees('donnees-test-inexistantes'),
    fichePour: () => undefined,
    creer: () => {
      throw new Error('creer non attendu dans ce test');
    },
    modeles: new ModelesChoisis('donnees-test-inexistantes/modeles-choisis.json', journal),
    marques: new MarquesRecalage(null, journal),
    racineDesktop: racine,
  });
}

function fermeeSansTranscript(configDir: string): ReturnType<typeof nouvelleSession> {
  return nouvelleSession(async () => [], {
    configDir,
    resume: { id: CONV, claudeSessionId: CONV, cwd: CWD, modele: 'défaut', statut: 'fermee' },
  });
}

describe('BalayageSessions.recalerFermees', () => {
  test('une fiche fermée créée sans transcript reçoit modèle et mode quand le transcript apparaît', () => {
    const env = environnement();
    try {
      const { session } = fermeeSansTranscript(env.configDir);
      const balayage = balayageAvec(session, env.racine);
      balayage.recalerFermees();
      expect(session.resume.modele).toBe('défaut');

      ecrireTranscript(env.chemin, [LIGNE_USER, LIGNE_ASSISTANT]);
      balayage.recalerFermees();
      expect(session.resume.modele).toBe('claude-haiku-5-5');
      expect(session.resume.mode).toBe('auto');
      expect(session.resume.statut).toBe('fermee');
    } finally {
      env.nettoyer();
    }
  });

  test('une fiche déjà recalée n’est recalée de nouveau que si son transcript change', () => {
    const env = environnement();
    try {
      const { session } = fermeeSansTranscript(env.configDir);
      const original = session.recalerFiche.bind(session);
      let appels = 0;
      session.recalerFiche = (r) => {
        appels += 1;
        original(r);
      };
      const balayage = balayageAvec(session, env.racine);
      balayage.recalerFermees();
      expect(appels).toBe(0);

      ecrireTranscript(env.chemin, [LIGNE_USER, LIGNE_ASSISTANT]);
      balayage.recalerFermees();
      balayage.recalerFermees();
      expect(appels).toBe(1);

      appendFileSync(env.chemin, JSON.stringify(LIGNE_SUITE) + '\n');
      balayage.recalerFermees();
      balayage.recalerFermees();
      expect(appels).toBe(2);
    } finally {
      env.nettoyer();
    }
  });
});
