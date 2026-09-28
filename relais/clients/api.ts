// Responsabilité : la table des routes de l'API des clients (web, iPhone), toutes protégées sauf la connexion.
import { z } from 'zod';
import type { Acces } from '../acces/acces.ts';
import { cookieDeSession } from '../acces/acces.ts';
import type { Postes } from '../parc/postes.ts';
import { reveiller } from '../parc/reveil.ts';
import type { Registre } from '../registre/registre.ts';
import type { ApiSessions } from './api-sessions.ts';
import type { Diffusion } from './diffusion.ts';
import { entier, erreur, json, lireCorps } from './http.ts';

export interface DependancesApi {
  readonly acces: Acces;
  readonly registre: Registre;
  readonly postes: Postes;
  readonly diffusion: Diffusion;
  readonly sessions: ApiSessions;
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
}

type Gestionnaire = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>;
const CorpsConnexion = z.object({ motDePasse: z.string().min(1).max(512), appareil: z.string().max(120).optional() });

export function ipDe(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export function construireRoutes(d: DependancesApi) {
  const protege =
    (g: Gestionnaire): Gestionnaire =>
    (req) =>
      d.acces.autorise(req) ? g(req) : erreur('non connecté', 401);
  return {
    '/api/connexion': { POST: (req: Request) => connexion(d, req) },
    '/api/deconnexion': {
      POST: protege((req) => {
        d.acces.deconnecter(req);
        return json({ ok: true }, 200, { 'set-cookie': 'ccremote=; Path=/; Max-Age=0' });
      }),
    },
    '/api/etat': { GET: protege(() => json(etat(d))) },
    '/api/attente': { GET: protege((req) => attente(d, req)) },
    '/api/sessions': { POST: protege((req) => d.sessions.ouvrir(req)) },
    '/api/sessions/:id/evenements': { GET: protege((req) => d.sessions.evenements(req as never)) },
    '/api/sessions/:id/messages': { POST: protege((req) => d.sessions.envoyer(req as never)) },
    '/api/sessions/:id/autonomie': { POST: protege((req) => d.sessions.autonomie(req as never)) },
    '/api/sessions/:id/repondre': { POST: protege((req) => d.sessions.repondre(req as never)) },
    '/api/sessions/:id/:action': { POST: protege((req) => d.sessions.action(req as never)) },
    '/api/notifications': {
      GET: protege((req) => json(d.registre.notifications(entier(new URL(req.url).searchParams.get('apres'), 0)))),
    },
    '/api/notifications/lues': { POST: protege((req) => marquerLues(d, req)) },
    '/api/machines/:id/reveiller': { POST: protege((req) => reveil(d, req.params['id'] ?? '')) },
    '/api/machines/:id/eteindre': { POST: protege((req) => machine(d, req.params['id'] ?? '', 'eteindre')) },
    '/api/machines/:id/projets': { GET: protege((req) => machine(d, req.params['id'] ?? '', 'projets')) },
  };
}

async function connexion(d: DependancesApi, req: Request): Promise<Response> {
  const c = await lireCorps(req, CorpsConnexion);
  if (c instanceof Response) return c;
  const r = await d.acces.connecter(c.motDePasse, ipDe(req), c.appareil ?? req.headers.get('user-agent') ?? 'inconnu');
  if (!r.ok)
    return erreur(
      r.raison === 'trop_de_tentatives' ? 'trop de tentatives, réessaie dans 15 minutes' : 'mot de passe refusé',
      r.raison === 'trop_de_tentatives' ? 429 : 401,
    );
  return json({ jeton: r.jeton }, 200, { 'set-cookie': cookieDeSession(r.jeton) });
}

function etat(d: DependancesApi) {
  const notifications = d.registre.notifications(0, 50);
  return {
    version: d.diffusion.version,
    machines: d.postes.vues(),
    sessions: d.registre.sessions(),
    notifications,
    reveilPossible: [...d.wol.keys()],
  };
}

// Pour l'iPhone : une seule requête longue qui rend la main dès qu'il y a du nouveau (au-delà de `version`).
async function attente(d: DependancesApi, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const version = entier(url.searchParams.get('version'), -1);
  const echeance = Date.now() + Math.min(entier(url.searchParams.get('attendre'), 25), 30) * 1000;
  while (d.diffusion.version <= version && Date.now() < echeance) await d.diffusion.attendre(echeance - Date.now());
  const apres = entier(url.searchParams.get('notifications'), 0);
  return json({
    version: d.diffusion.version,
    notifications: d.registre.notifications(apres),
    sessions: d.registre.sessions(),
    machines: d.postes.vues(),
  });
}

async function marquerLues(d: DependancesApi, req: Request): Promise<Response> {
  const c = await lireCorps(req, z.object({ jusqua: z.number().int() }));
  if (c instanceof Response) return c;
  d.registre.marquerLues(c.jusqua);
  return json({ ok: true });
}

async function reveil(d: DependancesApi, id: string): Promise<Response> {
  const mac = d.wol.get(id);
  if (!mac) return erreur(`${id} ne se réveille pas à distance`, 404);
  try {
    await reveiller(mac, d.diffusionWol);
    return json({ ok: true });
  } catch (e) {
    return erreur(`réveil impossible : ${String(e)}`, 500);
  }
}

async function machine(d: DependancesApi, id: string, kind: 'eteindre' | 'projets'): Promise<Response> {
  const r = await d.postes.commander(id, { kind });
  return r.ok ? json(r.donnees ?? { ok: true }) : erreur(r.erreur ?? 'refusé', 502);
}
