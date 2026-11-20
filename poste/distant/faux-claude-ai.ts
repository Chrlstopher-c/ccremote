// Faux serveur de l'API claude.ai pour les tests : sessions et fils paginés (plus récent d'abord), aucune requête réelle.
// Les données sont modifiables pendant le test ; `statutForce` fait répondre une erreur HTTP à tout appel.

export interface FauxApi {
  url: string;
  sessions: unknown[];
  readonly fils: Map<string, unknown[]>; // identifiant de session → événements, du plus récent au plus ancien
  readonly entetes: Headers[]; // en-têtes de chaque requête reçue
  readonly chemins: string[];
  statutForce: number | null;
  arreter(): void;
}

const JSON_VIDE = '{}';

export function demarrerFauxApi(): FauxApi {
  const api: FauxApi = {
    url: '',
    sessions: [],
    fils: new Map<string, unknown[]>(),
    entetes: [],
    chemins: [],
    statutForce: null,
    arreter: () => undefined,
  };
  const serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const u = new URL(req.url);
      api.entetes.push(req.headers);
      api.chemins.push(`${u.pathname}${u.search}`);
      if (api.statutForce !== null) return new Response(JSON_VIDE, { status: api.statutForce });
      if (!req.headers.get('authorization')?.startsWith('Bearer ')) return new Response(JSON_VIDE, { status: 401 });
      if (u.pathname === '/v1/code/sessions') return Response.json({ data: api.sessions, next_cursor: null });
      const fil = /^\/v1\/code\/sessions\/([^/]+)\/events$/.exec(u.pathname);
      if (fil) return pageDuFil(api.fils.get(decodeURIComponent(fil[1] ?? '')) ?? [], u.searchParams);
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
