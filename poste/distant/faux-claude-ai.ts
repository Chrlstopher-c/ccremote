// Faux serveur de l'API claude.ai pour les tests : sessions et fils paginés (plus récent d'abord), flux SSE scénarisés,
// aucune requête réelle.
// Les données sont modifiables pendant le test ; `statutForce` fait répondre une erreur HTTP à tout appel.
// Un flux SSE consomme un scénario par connexion : des trames, un statut d'erreur, ou un flux qui reste ouvert.

export interface FauxApi {
  url: string;
  sessions: unknown[];
  readonly fils: Map<string, unknown[]>; // identifiant de session → événements, du plus récent au plus ancien
  readonly entetes: Headers[]; // en-têtes de chaque requête reçue
  readonly chemins: string[];
  readonly posts: { chemin: string; corps: unknown }[]; // corps JSON de chaque POST d'événements
  statutForce: number | null;
  reponsePost: { statut: number; corps: string } | null; // réponse imposée aux POST (sinon 200 avec results)
  readonly scenariosFlux: Map<string, ScenarioFlux[]>; // identifiant de session → un scénario par connexion au flux
  arreter(): void;
}

export interface ScenarioFlux {
  readonly statut?: number; // répond cette erreur HTTP, sans flux
  readonly trames?: string[]; // trames SSE envoyées dans l'ordre (voir trameFlux)
  readonly tenir?: boolean; // le flux reste ouvert après ses trames (sinon il se ferme)
}

/** Une trame SSE au format de claude.ai (`event`, `id`, `data` JSON). */
export function trameFlux(evenement: string, id: number | null, data: unknown): string {
  const ligneId = id === null ? '' : `id: ${id}\n`;
  return `event: ${evenement}\n${ligneId}data: ${JSON.stringify(data)}\n\n`;
}

const JSON_VIDE = '{}';

export function demarrerFauxApi(): FauxApi {
  const api: FauxApi = {
    url: '',
    sessions: [],
    fils: new Map<string, unknown[]>(),
    entetes: [],
    chemins: [],
    posts: [],
    statutForce: null,
    reponsePost: null,
    scenariosFlux: new Map<string, ScenarioFlux[]>(),
    arreter: () => undefined,
  };
  const serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const u = new URL(req.url);
      api.entetes.push(req.headers);
      api.chemins.push(`${u.pathname}${u.search}`);
      if (api.statutForce !== null) return new Response(JSON_VIDE, { status: api.statutForce });
      if (!req.headers.get('authorization')?.startsWith('Bearer ')) return new Response(JSON_VIDE, { status: 401 });
      if (req.method === 'POST' && u.pathname.endsWith('/events')) {
        api.posts.push({ chemin: u.pathname, corps: await req.json() });
        if (api.reponsePost) return new Response(api.reponsePost.corps, { status: api.reponsePost.statut });
        return Response.json({ results: [{ sequence_num: '1' }] }, { status: 200 });
      }
      if (u.pathname === '/v1/code/sessions') return Response.json({ data: api.sessions, next_cursor: null });
      const fil = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(u.pathname);
      if (fil) return pageDuFil(api.fils.get(decodeURIComponent(fil[1] ?? '')) ?? [], u.searchParams);
      const flux = /^\/v1\/code\/sessions\/([^/]+)\/events\/stream$/.exec(u.pathname);
      if (flux) return reponseFlux(api, decodeURIComponent(flux[1] ?? ''));
      return new Response(JSON_VIDE, { status: 404 });
    },
  });
  api.url = `http://127.0.0.1:${serveur.port}`;
  api.arreter = () => void serveur.stop(true);
  return api;
}

// Curseur = décalage dans la liste (ordre décroissant), comme une page réelle de l'API.
function pageDuFil(evenements: unknown[], params: URLSearchParams): Response {
  const limite = Number(params.get('limit') ?? 100);
  const debut = Number(params.get('cursor')?.replace('c', '') ?? 0);
  const suite = debut + limite < evenements.length ? `c${debut + limite}` : null;
  return Response.json({ data: evenements.slice(debut, debut + limite), next_cursor: suite });
}

/** Une session de la liste claude.ai, avec les champs relevés sur l'API réelle. */
export function sessionApi(id: string, surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Session ${id}`,
    environment_kind: 'bridge',
    status: 'active',
    connection_status: 'connected',
    worker_status: 'idle',
    last_event_at: '2026-11-20T10:00:00.000Z',
    created_at: '2026-11-20T09:00:00.000Z',
    updated_at: '2026-11-20T10:00:00.000Z',
    unread: false,
    config: { model: 'claude-haiku-5-5' },
    external_metadata: {
      model: 'claude-haiku-5-5',
      effort_level: 'high',
      context_usage: { used_tokens: 1200, max_tokens: 1000000 },
    },
    ...surcharge,
  };
}

/** Un événement du fil : `payload` est un message du Claude Agent SDK. */
export function evenementApi(id: string, payload: unknown, creeLe: string): Record<string, unknown> {
  return { event_id: id, event_type: 'message', created_at: creeLe, sequence_num: id, payload, source: 'claude' };
}

/** Une réponse d'assistant (texte) suivie de la fin de son tour. */
export function tourApi(numero: number, texte: string): Record<string, unknown>[] {
  const creeLe = `2026-11-20T10:${String(numero).padStart(2, '0')}:00.000Z`;
  const session = 'cse_test';
  const assistant = {
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: `uuid-${numero}`,
    session_id: session,
    message: { role: 'assistant', content: [{ type: 'text', text: texte }] },
  };
  const fin = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '',
    duration_ms: 100,
    session_id: session,
  };
  return [evenementApi(`ev-${numero}-a`, assistant, creeLe), evenementApi(`ev-${numero}-r`, fin, creeLe)];
}

// Un flux SSE : le scénario suivant de la session (sans scénario, le flux est vide et se ferme aussitôt).
function reponseFlux(api: FauxApi, idSession: string): Response {
  const scenario = api.scenariosFlux.get(idSession)?.shift();
  if (scenario?.statut !== undefined) return new Response(JSON_VIDE, { status: scenario.statut });
  const encodeur = new TextEncoder();
  const trames = scenario?.trames ?? [];
  const corps = new ReadableStream<Uint8Array>({
    start(controleur) {
      // Un premier octet (commentaire, comme le keepalive réel) : sans lui, les en-têtes ne partent pas.
      controleur.enqueue(encodeur.encode(':ouvert\n\n'));
      for (const trame of trames) controleur.enqueue(encodeur.encode(trame));
      if (scenario?.tenir !== true) controleur.close();
    },
  });
  return new Response(corps, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
