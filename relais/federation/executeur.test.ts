// Exécution d'un geste relayé par la table interne : bonne route, paramètres, corps et requête transmis.
import { describe, expect, test } from 'bun:test';
import { executerGeste, type TableInterne } from './executeur.ts';

function table(vus: string[]): TableInterne {
  const noter = (nom: string) => async (req: Request & { params: Record<string, string> }) => {
    const corps = req.method === 'POST' ? await req.text() : '';
    vus.push(`${nom} ${JSON.stringify(req.params)} ${new URL(req.url).search} ${corps}`);
    return Response.json({ ok: true });
  };
  return {
    '/api/sessions': { POST: noter('ouvrir') },
    '/api/sessions/:id/modele': { POST: noter('modele') },
    '/api/sessions/:id/evenements': { GET: noter('evenements') },
    '/api/sessions/:id/:action': { POST: noter('action') },
  };
}

describe('executerGeste', () => {
  test('route propre, route d’action, ouverture et lecture', async () => {
    const vus: string[] = [];
    const t = table(vus);
    await executerGeste(t, { geste: 'modele', methode: 'POST', session: 's1', corps: '{"modele":"sonnet"}' });
    await executerGeste(t, { geste: 'interrompre', methode: 'POST', session: 's1' });
    await executerGeste(t, { geste: 'ouvrir', methode: 'POST', corps: '{"machine":"tour"}' });
    await executerGeste(t, { geste: 'evenements', methode: 'GET', session: 's1', requete: 'apres=3' });
    expect(vus).toEqual([
      'modele {"id":"s1"}  {"modele":"sonnet"}',
      'action {"id":"s1","action":"interrompre"}  {}',
      'ouvrir {}  {"machine":"tour"}',
      'evenements {"id":"s1"} ?apres=3 ',
    ]);
  });

  test('geste sans route : 404', async () => {
    const r = await executerGeste(table([]), { geste: 'contexte', methode: 'GET', session: 's1' });
    expect(r.status).toBe(404);
  });
});

describe('executerGeste : routes à segments (fichiers, git, artefacts, machine)', () => {
  test('un segment littéral vaut mieux qu’un `:action` ; un paramètre lie son segment', async () => {
    const vus: string[] = [];
    const noter = (nom: string) => async (req: Request & { params: Record<string, string> }) => {
      vus.push(`${nom} ${JSON.stringify(req.params)} ${new URL(req.url).pathname}`);
      return Response.json({ ok: true });
    };
    const t: TableInterne = {
      '/api/sessions/:id/:action': { POST: noter('action') },
      '/api/sessions/:id/git/diff': { GET: noter('diff') },
      '/api/sessions/:id/artefacts/:artefact/renommer': { POST: noter('renommer') },
      '/api/machines/:id/dossiers': { GET: noter('dossiers') },
    };
    await executerGeste(t, { geste: 'git/diff', methode: 'GET', session: 'ses 1' });
    await executerGeste(t, { geste: 'artefacts/a-1/renommer', methode: 'POST', session: 's1', corps: '{}' });
    await executerGeste(t, { geste: 'dossiers', methode: 'GET', machine: 'tour' });
    await executerGeste(t, { geste: 'git/annuler', methode: 'POST', session: 's1' });
    expect(vus).toEqual([
      'diff {"id":"ses 1"} /api/sessions/ses%201/git/diff',
      'renommer {"id":"s1","artefact":"a-1"} /api/sessions/s1/artefacts/a-1/renommer',
      'dossiers {"id":"tour"} /api/machines/tour/dossiers',
    ]);
  });
});
