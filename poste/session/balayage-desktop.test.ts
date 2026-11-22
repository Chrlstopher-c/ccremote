// Responsabilité : tests du rattachement des conversations tenues par Claude Desktop ou un terminal quand l'adoption
// hors tmux est désactivée (moteur intégré, CCREMOTE_ADOPTER_TERMINAUX=non) : une session déjà connue reste suivie
// (en travail / en attente tant que le processus la tient), une conversation inconnue n'est jamais adoptée.
// Processus construits à la main, aucune lecture de /proc.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigPoste } from '../config.ts';
import { BalayageSessions } from './balayage-sessions.ts';
import { journal, nouvelleSession } from './faux-sdk.ts';
import type { ProcessusClaude } from './processus.ts';
import { MarquesRecalage } from './recalage-demarrage.ts';
import { ModelesChoisis } from './modeles-choisis.ts';
import { SessionsSupprimees } from './suppression.ts';
import type { SessionPoste } from './session-poste.ts';

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

const CONVERSATION = 'conv-desktop-test';
const CWD = '/projets/app';
let configDir = '';

beforeAll(() => {
  // Dossier de configuration jetable : le transcript de la conversation y est écrit, jamais dans ~/.claude.
  configDir = mkdtempSync(join(tmpdir(), 'balayage-desktop-'));
  mkdirSync(join(configDir, 'projects', '-projets-app'), { recursive: true });
  const transcript = join(configDir, 'projects', '-projets-app', `${CONVERSATION}.jsonl`);
  writeFileSync(transcript, '');
  const ancien = new Date(Date.now() - 60 * 60_000);
  utimesSync(transcript, ancien, ancien);
});

afterAll(() => rmSync(configDir, { recursive: true, force: true }));

// Processus Claude Desktop : interactif, hors tmux, pas un processus SDK, transcript présent.
const desktop = (sessionId: string): ProcessusClaude => ({
  pid: 4242,
  sessionId,
  cwd: CWD,
  enTmux: false,
  configDir,
  nom: null,
  sdk: false,
});

function balayageAvec(sessions: readonly SessionPoste[]): BalayageSessions {
  const carte = new Map(sessions.map((s) => [s.resume.id, s] as const));
  return new BalayageSessions({
    config: CONFIG,
    journal,
    sessions: carte,
    supprimees: new SessionsSupprimees('donnees-test-inexistantes'),
    fichePour: (id) => carte.get(id),
    creer: () => {
      throw new Error('adoption non attendue');
    },
    modeles: new ModelesChoisis('donnees-test-inexistantes/modeles-choisis.json', journal),
    marques: new MarquesRecalage(null, journal),
    racineDesktop: 'donnees-test-inexistantes',
  });
}

function fermeeConnue(): SessionPoste {
  const { session } = nouvelleSession(async () => [], {
    resume: { id: CONVERSATION, claudeSessionId: CONVERSATION, statut: 'fermee', terminal: false },
  });
  return session;
}

describe('rattachement des conversations tenues ailleurs (adoption hors tmux désactivée)', () => {
  test('une session connue tenue par Claude Desktop passe en attente, sans adoption', () => {
    const session = fermeeConnue();
    balayageAvec([session]).suivreTerminaux([desktop(CONVERSATION)], [], false);
    expect(session.resume.statut).toBe('attente');
    expect(session.resume.terminal).toBe(true);
  });

  test('une session connue dont le transcript bouge encore passe en travail', () => {
    const session = fermeeConnue();
    writeFileSync(join(configDir, 'projects', '-projets-app', `${CONVERSATION}.jsonl`), '{}\n');
    balayageAvec([session]).suivreTerminaux([desktop(CONVERSATION)], [], false);
    expect(session.resume.statut).toBe('travail');
  });

  test('une session connue tenue ailleurs reste fermée quand plus rien ne la tient', () => {
    const session = fermeeConnue();
    balayageAvec([session]).suivreTerminaux([], [], false);
    expect(session.resume.statut).toBe('fermee');
  });

  test('une conversation inconnue tenue par Claude Desktop n’est pas adoptée si l’adoption est coupée', () => {
    expect(() => balayageAvec([]).suivreTerminaux([desktop('conv-inconnue')], [], false)).not.toThrow();
  });
});
