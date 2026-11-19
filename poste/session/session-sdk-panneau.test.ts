import { describe, expect, test } from 'bun:test';
import { attendre, CONTEXTE_FAUX, nouvelleSession } from './faux-sdk.ts';

describe('SessionSdk : lectures du panneau', () => {
  test('hors requête : ni contexte, ni connecteur, ni tâche', async () => {
    const { session } = nouvelleSession(async () => []);
    expect(await session.contexte()).toBeNull();
    expect(await session.connecteurs()).toEqual([]);
    expect(session.taches()).toEqual([]);
    expect(session.tache('absente')).toBeNull();
  });

  test('requête ouverte : contexte, connecteurs nommés et tâche de fond ; fermée, plus rien', async () => {
    const tache = {
      type: 'system',
      subtype: 'task_started',
      task_id: 't1',
      description: 'Veille',
      task_type: 'local_agent',
      is_backgrounded: true,
    };
    const { session, requetes } = nouvelleSession(async () => [tache, { type: 'result' }], {
      mcp: [['connected', 'failed'], ['connected', 'failed']],
    });
    await session.lancer('go');
    await attendre(() => session.resume.statut === 'attente');
    expect((await session.contexte())?.utilises).toBe(CONTEXTE_FAUX.totalTokens);
    expect(requetes[0]?.contexteAppels).toBe(1);
    expect(await session.connecteurs()).toEqual([
      { nom: 'connecteur-1', statut: 'connected' },
      { nom: 'connecteur-2', statut: 'failed' },
    ]);
    expect(session.taches().map((t) => [t.id, t.statut, t.arrierePlan])).toEqual([['t1', 'en_cours', true]]);
    expect(session.tache('t1')?.description).toBe('Veille');
    await session.fermer();
    expect(await session.contexte()).toBeNull();
  });

  test('fiche : le relevé de l’initialisation reste au repos, après fermeture, et dans la persistance', async () => {
    const { session } = nouvelleSession(async () => [{ type: 'result' }], { mcp: [['connected', 'failed']] });
    await session.lancer('go');
    await attendre(() => session.resume.connecteurs !== undefined);
    await attendre(() => session.resume.statut === 'attente');
    await session.fermer();
    const releve = [
      { nom: 'connecteur-1', statut: 'connected' },
      { nom: 'connecteur-2', statut: 'failed' },
    ];
    expect(await session.connecteurs()).toEqual(releve);
    expect(session.persistee.resume.connecteurs).toEqual(releve);
  });

  test('après redémarrage du poste : la fiche relue donne les connecteurs sans requête SDK', async () => {
    const releve = [{ nom: 'claude.ai Agenda', statut: 'connected' }];
    const { session, requetes } = nouvelleSession(async () => [], { resume: { connecteurs: releve } });
    expect(await session.connecteurs()).toEqual(releve);
    expect(requetes).toHaveLength(0);
  });
});
