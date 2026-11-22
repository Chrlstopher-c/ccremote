// Responsabilité : exécuter, chez le nœud qui tient la session, un geste relayé par un pair — par la route locale
// correspondante d'une table interne (sans contrôle de jeton : seul un pair apparié, sur le lien chiffré, y arrive),
// comme si l'appli locale l'avait demandé. Liste des gestes fermée par le protocole (commun/federation.ts).
import type { GesteLocal } from './echanges.ts';

type Gestionnaire = (req: Request & { params: Record<string, string> }, serveur: unknown) => unknown;
export type TableInterne = Record<string, Partial<Record<string, Gestionnaire>>>;

const ORIGINE_INTERNE = 'http://noeud.interne';
const SERVEUR_INTERNE = { requestIP: () => null };

export async function executerGeste(table: TableInterne, g: GesteLocal): Promise<Response> {
  const cible = cibleDe(table, g);
  if (!cible) return new Response(JSON.stringify({ erreur: 'geste inconnu de ce nœud' }), { status: 404 });
  const url = `${ORIGINE_INTERNE}${cible.chemin}${g.requete ? `?${g.requete}` : ''}`;
  const init: RequestInit = { method: g.methode, headers: { 'content-type': 'application/json' } };
  if (g.methode === 'POST') init.body = g.corps ?? '{}';
  const req = Object.assign(new Request(url, init), { params: cible.params });
  const reponse = await cible.gestionnaire(req, SERVEUR_INTERNE);
  return reponse instanceof Response
    ? reponse
    : new Response(JSON.stringify({ erreur: 'réponse illisible' }), {
        status: 500,
      });
}

interface Cible {
  readonly gestionnaire: Gestionnaire;
  readonly chemin: string;
  readonly params: Record<string, string>;
}

function cibleDe(table: TableInterne, g: GesteLocal): Cible | null {
  if (g.geste === 'ouvrir') {
    const gestionnaire = table['/api/sessions']?.['POST'];
    return gestionnaire ? { gestionnaire, chemin: '/api/sessions', params: {} } : null;
  }
  if (!g.session) return null;
  const chemin = `/api/sessions/${encodeURIComponent(g.session)}/${g.geste}`;
  const propre = table[`/api/sessions/:id/${g.geste}`]?.[g.methode];
  if (propre) return { gestionnaire: propre, chemin, params: { id: g.session } };
  const action = g.methode === 'POST' ? table['/api/sessions/:id/:action']?.['POST'] : undefined;
  return action ? { gestionnaire: action, chemin, params: { id: g.session, action: g.geste } } : null;
}
