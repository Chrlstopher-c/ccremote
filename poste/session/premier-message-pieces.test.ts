// Responsabilité : les pièces jointes du premier message d'une session (ouverture) — même traitement que `envoyer`.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DemandeSession } from '../../commun/session.ts';
import { Stockage } from '../presentation/stockage.ts';
import { journal, nouvelleSession, persistee, RequeteFausse, traduction } from './faux-sdk.ts';
import { reglagesDeOuverture } from './reglages-sdk.ts';
import { type EnvironnementSdk, SessionSdk } from './session-sdk.ts';
import type { SessionPoste } from './session-poste.ts';

const PIECE = { nom: 'note.txt', mime: 'text/plain', base64: 'aGk=' };
const FIN = [{ type: 'result' }];

function avecPresentation() {
  const evenements: { type: string }[] = [];
  const requetes: RequeteFausse[] = [];
  const env: EnvironnementSdk = {
    journal,
    sortie: { evenement: (_id, evt) => void evenements.push(evt), resume: () => undefined },
    executable: null,
    requete: (p) => {
      const r = new RequeteFausse(p.prompt, p.options, async () => FIN, []);
      requetes.push(r);
      return r;
    },
    traduction,
    socket: '/run/poste.sock',
    delaiMcpMs: 200,
    periodeMcpMs: 1,
    presentation: { stockage: new Stockage(mkdtempSync(join(tmpdir(), 'pieces-premier-'))), racines: ['/projets'] },
  };
  return { session: new SessionSdk(persistee(null), env), evenements, requetes };
}

describe('pièces jointes au premier message', () => {
  test('présentation active : le message part avec ses pièces, leurs événements suivent le message', async () => {
    const { session, evenements, requetes } = avecPresentation();
    expect(await session.lancer('voilà', null, [PIECE])).toBeNull();
    expect(requetes.length).toBe(1);
    expect(evenements[0]?.type).toBe('message');
    expect(evenements.length).toBeGreaterThan(1);
  });

  test('sans présentation : refus avant tout démarrage, rien n’est lancé', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    expect(await session.lancer('voilà', null, [PIECE])).toBe('pièces jointes non prises en charge par cette session');
    expect(requetes.length).toBe(0);
    expect(session.resume.statut).toBe('fermee');
  });

  test('sans pièces, le premier message part comme avant', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    expect(await session.lancer('bonjour')).toBeNull();
    expect(requetes.length).toBe(1);
  });
});

describe('ouverture avec pièces en moteur tmux', () => {
  test('refusée par le gestionnaire, sans appel au moteur', async () => {
    const appels: string[] = [];
    const session = {
      reglerSession: async (r: { kind: string }) => {
        appels.push(r.kind);
        return null;
      },
    } as unknown as SessionPoste;
    const demande = {
      moteur: 'tmux',
      pieces: [PIECE],
      parc: [],
      sessionId: 'x',
      projet: { machine: 'tour', chemin: '/p', nom: 'p' },
      titre: 't',
      message: 'm',
      objectif: null,
      autonomie: false,
    } as DemandeSession;
    expect(await reglagesDeOuverture(session, demande)).toBe('pièces jointes : moteur SDK seulement');
    expect(appels).toEqual([]);
  });
});
