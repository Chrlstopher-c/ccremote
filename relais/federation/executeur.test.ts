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
