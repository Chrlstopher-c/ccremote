// Responsabilité : côté nœud de l'invité — la route locale que Claude Code appelle à la place de l'API : contrôle du
// secret du relais, choix du nœud du chef en ligne, envoi de la requête, réponse rendue en flux au fil des morceaux.
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';
import type { MessageChiffre } from '../../commun/federation.ts';
import type { ReglagesInvite } from '../../commun/invites.ts';
import {
  type ClaudeEntete,
  type ClaudeFin,
  type ClaudeRequete,
  erreurAnthropic,
  entetesRequete,
  OCTETS_MORCEAU_CLAUDE,
  TAILLE_CORPS_EN_LIGNE,
  type TypeErreurClaude,
} from '../../commun/relais-claude.ts';
import { nonceRef } from '../federation/identifiants.ts';
import type { EmetteurClaude } from './relais-claude-serveur.ts';

export const PREFIXE_ROUTE_CLAUDE = '/api/relais-claude';
const METHODES: readonly string[] = ['GET', 'POST', 'HEAD'];
type MethodeClaude = 'GET' | 'POST' | 'HEAD';
type Morceau = Extract<MessageChiffre, { t: 'morceau' }>;

export interface PortClientClaude {
  readonly moi: () => string | null;
  readonly reglagesDe: (membre: string) => ReglagesInvite | null;
  readonly canalVers: (membre: string) => EmetteurClaude | null;
  readonly jetonRelais: () => string;
  readonly delaiPremierOctetMs: number;
  readonly journal: Logger;
}

type Entete =
  | { readonly ok: true; readonly statut: number; readonly entetes: Record<string, string> }
  | { readonly ok: false; readonly raison: string };

/** Une requête en route : son en-tête attendu, et le flux qui rend les morceaux à Claude Code. */
interface FluxEnRoute {
  readonly membre: string;
  readonly entete: Promise<Entete>;
  readonly resoudre: (e: Entete) => void;
  controleur: ReadableStreamDefaultController<Uint8Array> | null;
  recus: number;
}

function nouveauFlux(membre: string): FluxEnRoute {
  let resoudre: (e: Entete) => void = () => undefined;
  const entete = new Promise<Entete>((r) => {
    resoudre = r;
  });
  return { membre, entete, resoudre: (e) => resoudre(e), controleur: null, recus: 0 };
}

function erreur(statut: number, type: TypeErreurClaude, message: string): Response {
  return new Response(erreurAnthropic(type, message), {
    status: statut,
    headers: { 'content-type': 'application/json' },
  });
}

/** Le secret présenté : `authorization: Bearer …` ou `x-api-key`. */
function secretDe(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  return req.headers.get('x-api-key');
}

function secretValide(req: Request, attendu: string): boolean {
  const recu = secretDe(req);
  if (recu === null) return false;
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

function premierCanal(
  machines: readonly string[],
  canalVers: (m: string) => EmetteurClaude | null,
): EmetteurClaude | null {
  for (const machine of machines) {
    const canal = canalVers(machine);
    if (canal !== null) return canal;
  }
  return null;
}

function attendreEntete(entete: Promise<Entete>, delaiMs: number): Promise<Entete | null> {
  return new Promise((resoudre) => {
    const minuterie = setTimeout(() => resoudre(null), delaiMs);
    void entete.then((e) => {
      clearTimeout(minuterie);
      resoudre(e);
    });
  });
}

async function lireCorps(req: Request, journal: Logger): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await req.arrayBuffer());
  } catch (erreur) {
    journal.warn({ err: erreur }, 'relais Claude : corps de la requête illisible');
    return null;
  }
}

/** Découpe un corps binaire en morceaux (base64), dans l'ordre : la concaténation redonne le corps. */
function morceauxDe(corps: Uint8Array): string[] {
  const morceaux: string[] = [];
  for (let debut = 0; debut < corps.byteLength; debut += OCTETS_MORCEAU_CLAUDE) {
    morceaux.push(Buffer.from(corps.subarray(debut, debut + OCTETS_MORCEAU_CLAUDE)).toString('base64'));
  }
  return morceaux;
}

export class ClientClaude {
  private readonly flux = new Map<string, FluxEnRoute>();

  constructor(private readonly p: PortClientClaude) {}

  /** Une référence de ce nœud attend une réponse ou un morceau de réponse. */
  possede(ref: string): boolean {
    return this.flux.has(ref);
  }

  /** La route `/api/relais-claude/…` : ce que Claude Code appelle à la place de l'API. */
  async routeLocale(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const chemin = url.pathname.slice(PREFIXE_ROUTE_CLAUDE.length) + url.search;
    if (req.headers.has('cf-connecting-ip') || req.headers.has('x-forwarded-for'))
      return erreur(404, 'not_found_error', 'route inconnue');
    if (req.method === 'HEAD' && chemin === '/api/hello') return new Response(null, { status: 200 });
    if (!secretValide(req, this.p.jetonRelais()))
      return erreur(401, 'authentication_error', 'secret du relais absent ou faux');
    const moi = this.p.moi();
    const reglages = moi === null ? null : this.p.reglagesDe(moi);
    if (reglages === null) return erreur(403, 'permission_error', 'ce nœud n’est pas invité chez le chef');
    const canal = premierCanal(reglages.machines, this.p.canalVers);
    if (canal === null) return erreur(503, 'api_error', 'aucune machine du chef en ligne');
    if (!chemin.startsWith('/v1/') || !isMethode(req.method)) return erreur(404, 'not_found_error', 'route inconnue');
    const corps = req.method === 'POST' ? await lireCorps(req, this.p.journal) : new Uint8Array(0);
    if (corps === null) return erreur(400, 'invalid_request_error', 'corps de la requête illisible');
    return this.relayer(canal, { methode: req.method, chemin, entetes: req.headers, corps });
  }

  /** Les réponses d'un nœud : en-têtes, ou fin du flux. */
  recevoir(membre: string, m: ClaudeEntete | ClaudeFin): void {
    const f = this.flux.get(m.ref);
    if (f === undefined || f.membre !== membre) return;
    if (m.t === 'claude_entete') return f.resoudre({ ok: true, statut: m.statut, entetes: m.entetes });
    f.resoudre({ ok: false, raison: 'réponse terminée avant son en-tête' });
    this.flux.delete(m.ref);
    if (!m.ok) return f.controleur?.error(new Error(m.raison ?? 'réponse coupée'));
    if (m.morceaux !== f.recus) return f.controleur?.error(new Error('réponse incomplète'));
    f.controleur?.close();
  }

  /** Un morceau de réponse : rendu à Claude Code au fil de l'arrivée. */
  morceau(membre: string, m: Morceau): void {
    const f = this.flux.get(m.ref);
    if (f === undefined || f.membre !== membre) return;
    f.recus += 1;
    f.controleur?.enqueue(new Uint8Array(Buffer.from(m.corps, 'base64')));
  }

  /** Le lien avec ce nœud tombe : les réponses en route échouent tout de suite. */
  oublier(membre: string): void {
    for (const [ref, f] of [...this.flux]) {
      if (f.membre !== membre) continue;
      this.flux.delete(ref);
      f.resoudre({ ok: false, raison: 'lien avec le nœud du chef coupé' });
      f.controleur?.error(new Error('lien avec le nœud du chef coupé'));
    }
  }

  private async relayer(
    canal: EmetteurClaude,
    requete: { methode: MethodeClaude; chemin: string; entetes: Headers; corps: Uint8Array },
  ): Promise<Response> {
    const ref = nonceRef();
    const flux = nouveauFlux(canal.membre);
    this.flux.set(ref, flux);
    const corps = new ReadableStream<Uint8Array>({
      start: (c) => {
        flux.controleur = c;
      },
      cancel: () => this.annuler(canal, ref),
    });
    if (!this.envoyerRequete(canal, ref, requete)) {
      this.flux.delete(ref);
      return erreur(503, 'api_error', 'lien avec le nœud du chef indisponible');
    }
    const entete = await attendreEntete(flux.entete, this.p.delaiPremierOctetMs);
    if (entete === null) {
      this.annuler(canal, ref);
      return erreur(504, 'api_error', 'le nœud du chef n’a pas répondu à temps');
    }
    if (!entete.ok) {
      this.flux.delete(ref);
      this.p.journal.warn({ raison: entete.raison }, 'relais Claude : réponse refusée ou coupée');
      return erreur(502, 'api_error', entete.raison);
    }
    return new Response(corps, { status: entete.statut, headers: entete.entetes });
  }

  // La requête part en ligne si son corps tient dans une trame, sinon en morceaux après l'annonce de leur nombre.
  private envoyerRequete(
    canal: EmetteurClaude,
    ref: string,
    r: { methode: MethodeClaude; chemin: string; entetes: Headers; corps: Uint8Array },
  ): boolean {
    const base: Omit<ClaudeRequete, 'corps' | 'morceaux'> = {
      t: 'claude_requete',
      ref,
      methode: r.methode,
      chemin: r.chemin,
      entetes: entetesRequete(r.entetes),
    };
    if (r.corps.byteLength === 0) return canal.envoyer(base);
    const enLigne = Buffer.from(r.corps).toString('base64');
    if (enLigne.length <= TAILLE_CORPS_EN_LIGNE) return canal.envoyer({ ...base, corps: enLigne });
    const morceaux = morceauxDe(r.corps);
    if (!canal.envoyer({ ...base, morceaux: morceaux.length })) return false;
    return morceaux.every((corps, rang) => canal.envoyer({ t: 'morceau', ref, rang, corps }));
  }

  private annuler(canal: EmetteurClaude, ref: string): void {
    this.flux.delete(ref);
    canal.envoyer({ t: 'claude_annuler', ref });
  }
}

function isMethode(valeur: string): valeur is MethodeClaude {
  return METHODES.includes(valeur);
}
