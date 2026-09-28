import { describe, expect, test } from 'bun:test';
import type { EvenementDate } from '../../../../commun/api-clients.ts';
import type { Evenement } from '../../../../commun/session.ts';
import { structurer } from './structure.ts';

let seq = 0;
const e = (evt: Evenement): EvenementDate => ({ seq: ++seq, sessionId: 's', ts: '2026-09-28T00:00:00Z', evt });

describe('structure du fil', () => {
  test('le résultat rejoint son outil, le tour fini disparaît', () => {
    const fil = structurer([
      e({ type: 'outil', id: 't1', nom: 'Bash', resume: 'ls', detail: '{}' }),
      e({ type: 'resultat_outil', outilId: 't1', extrait: 'ok', erreur: false }),
      e({ type: 'tour_fini', dureeMs: 1, contexte: 1 }),
    ]);
    expect(fil).toHaveLength(1);
    expect(fil[0]).toMatchObject({ genre: 'outil', resultat: { extrait: 'ok' } });
  });

  test('un sous-agent regroupe ses textes et outils, et reçoit son propre résultat', () => {
    const fil = structurer([
      e({ type: 'sous_agent', id: 'a1', description: 'explorer', modele: 'sonnet', genre: 'Explore' }),
      e({ type: 'outil', id: 't2', nom: 'Grep', resume: 'x', detail: '{}', agent: 'a1' }),
      e({ type: 'resultat_outil', outilId: 't2', extrait: '3 fichiers', erreur: false, agent: 'a1' }),
      e({ type: 'texte', texte: 'trouvé', agent: 'a1' }),
      e({ type: 'resultat_outil', outilId: 'a1', extrait: 'rapport', erreur: false }),
      e({ type: 'texte', texte: 'suite du fil principal' }),
    ]);
    expect(fil).toHaveLength(2);
    expect(fil[0]).toMatchObject({ genre: 'sous_agent', resultat: { extrait: 'rapport' } });
    const agent = fil[0];
    if (agent?.genre !== 'sous_agent') throw new Error('attendu : sous-agent');
    expect(agent.interieur.map((i) => i.genre)).toEqual(['outil', 'texte']);
    expect(fil[1]).toMatchObject({ genre: 'simple', evt: { texte: 'suite du fil principal' } });
  });
});
