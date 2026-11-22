// Responsabilité : exécuter, chez le nœud qui tient la session (ou la machine), un geste relayé par un pair, par la
// route locale d'une table interne (sans contrôle de jeton : seul un pair apparié, sur le lien chiffré, y arrive),
// comme si l'appli locale l'avait demandé. Une route se trouve par ses segments : `:nom` lie n'importe lequel, un
// segment littéral vaut mieux qu'un lien (`/modele` avant `/:action`).
import type { GesteLocal } from './echanges.ts';

type Gestionnaire = (req: Request & { params: Record<string, string> }, serveur: unknown) => unknown;
export type TableInterne = Record<string, Partial<Record<string, Gestionnaire>>>;

const ORIGINE_INTERNE = 'http://noeud.interne';
const SERVEUR_INTERNE = { requestIP: () => null };

interface Cible {
  readonly gestionnaire: Gestionnaire;
  readonly chemin: string;
  readonly params: Record<string, string>;
}

export async function executerGeste(table: TableInterne, g: GesteLocal): Promise<Response> {
  const cible = cibleDe(table, g);
  if (!cible) return new Response(JSON.stringify({ erreur: 'geste inconnu de ce nœud' }), { status: 404 });
  const url = `${ORIGINE_INTERNE}${cible.chemin}${g.requete ? `?${g.requete}` : ''}`;
  const init: RequestInit = { method: g.methode, headers: { 'content-type': 'application/json' } };
  if (g.methode !== 'GET') init.body = g.corps ?? '{}';
  const req = Object.assign(new Request(url, init), { params: cible.params });
  const reponse = await cible.gestionnaire(req, SERVEUR_INTERNE);
  return reponse instanceof Response
    ? reponse
    : new Response(JSON.stringify({ erreur: 'réponse illisible' }), {
        status: 500,
      });
}

function cibleDe(table: TableInterne, g: GesteLocal): Cible | null {
  if (g.geste === 'ouvrir') {
    const gestionnaire = table['/api/sessions']?.['POST'];
    return gestionnaire ? { gestionnaire, chemin: '/api/sessions', params: {} } : null;
  }
  const base = basePortee(g);
  const chemin = `${base}/${g.geste}`;
  const trouvee = meilleureRoute(table, chemin, g.methode);
  return trouvee ? { ...trouvee, chemin } : null;
}

function basePortee(g: GesteLocal): string {
  if (g.machine !== undefined) return `/api/machines/${encodeURIComponent(g.machine)}`;
  if (g.session) return `/api/sessions/${encodeURIComponent(g.session)}`;
  return '/api';
}

/** La route de la table qui couvre `chemin` avec le plus de segments littéraux (et qui a la méthode). */
function meilleureRoute(
  table: TableInterne,
  chemin: string,
  methode: string,
): { gestionnaire: Gestionnaire; params: Record<string, string> } | null {
  const morceaux = chemin.split('/');
  let meilleure: { gestionnaire: Gestionnaire; params: Record<string, string> } | null = null;
  let litteraux = -1;
  for (const [cle, methodes] of Object.entries(table)) {
    const gestionnaire = methodes[methode];
    if (!gestionnaire) continue;
    const motif = cle.split('/');
    const params = liaison(motif, morceaux);
    if (!params) continue;
    const nombre = motif.filter((segment) => !segment.startsWith(':')).length;
    if (nombre > litteraux) {
      litteraux = nombre;
      meilleure = { gestionnaire, params };
    }
  }
  return meilleure;
}

/** Les paramètres liés par `motif` pour ce chemin, ou null si le chemin n'est pas couvert. */
function liaison(motif: string[], morceaux: string[]): Record<string, string> | null {
  if (motif.length !== morceaux.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < motif.length; i += 1) {
    const attendu = motif[i] ?? '';
    const recu = morceaux[i] ?? '';
    if (attendu.startsWith(':')) {
      if (recu === '') return null;
      params[attendu.slice(1)] = decodeURIComponent(recu);
    } else if (attendu !== recu) {
      return null;
    }
  }
  return params;
}
