// Responsabilité : autoriser l'app de bureau (origine Tauri) et le serveur de dev à appeler l'API du relais.
type RequeteRoute = Request & { params: Record<string, string> };
type Methodes = Record<string, (req: RequeteRoute) => Response | Promise<Response>>;

export function origineAutorisee(req: Request, origines: ReadonlySet<string>): string | null {
  const origine = req.headers.get('origin');
  return origine && origines.has(origine) ? origine : null;
}

export function entetesCors(origine: string): Record<string, string> {
  return {
    'access-control-allow-origin': origine,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

// Enveloppe chaque méthode de chaque route : la réponse repart avec les en-têtes CORS si l'origine est connue.
export function avecCors<R extends Record<string, Methodes>>(routes: R, origines: ReadonlySet<string>): R {
  const sortie: Record<string, Methodes> = {};
  for (const [chemin, methodes] of Object.entries(routes)) {
    const enveloppees: Methodes = {};
    for (const [verbe, g] of Object.entries(methodes)) {
      enveloppees[verbe] = async (req: RequeteRoute) => {
        const r = await g(req);
        const origine = origineAutorisee(req, origines);
        if (origine) for (const [k, v] of Object.entries(entetesCors(origine))) r.headers.set(k, v);
        return r;
      };
    }
    enveloppees['OPTIONS'] = (req: RequeteRoute) => {
      const origine = origineAutorisee(req, origines);
      return new Response(null, { status: 204, headers: origine ? entetesCors(origine) : {} });
    };
    sortie[chemin] = enveloppees;
  }
  return sortie as R; // mêmes clés, mêmes méthodes, plus OPTIONS : la forme est conservée
}
