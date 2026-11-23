// Responsabilité : les routes des invités (Paramètres › Réseau : inviter, réglages, activité ; prompt de conversation)
// et l'ouverture d'une session locale quand ce nœud est lui-même invité. Relaie vers NoeudInvites, sans règle ici.
import { z } from 'zod';
import {
  changerInvite,
  type Charte,
  type Edition,
  inviterMembre,
  membreDe,
  reglagesInviteDe,
} from '../../commun/charte.ts';
import { fusionnerReglages, ReglagesPartiels, reglagesParDefaut } from '../../commun/invites.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { ReponsePoste } from '../parc/postes.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import type { CorpsOuverture } from '../clients/api-sessions.ts';
import type { CodesReseau } from '../codes-reseau/codes-reseau.ts';
import type { Resultat } from '../federation/resultat.ts';
import type { NoeudInvites } from './noeud-invites.ts';
import { ID_MEMBRE } from './ids.ts';
import { creerInvitation } from './invitation.ts';

type Requete = Request & { params: Record<string, string> };
type Protection = (g: (req: Requete) => Response | Promise<Response>) => (req: Requete) => Response | Promise<Response>;

const DUREE_INTENTION_MS = 30 * 60_000;
const CorpsMembre = z.object({ membre: ID_MEMBRE });
const CorpsReglages = z.object({ reglages: ReglagesPartiels });
const CorpsInvitation = z.strictObject({});
const CorpsTexte = z.object({ texte: z.string().max(8000) });

/** Ce que les routes des invités utilisent : la politique, la charte, l'appairage, les postes et les ouvertures. */
export interface PortApiInvites {
  readonly invites: NoeudInvites;
  readonly charte: () => Charte | null;
  readonly moi: () => string | null;
  readonly chefLocal: () => boolean;
  readonly editer: (
    fn: (c: Charte, moi: string, le: string) => { ok: true; charte: Charte } | { ok: false; raison: string },
  ) => Promise<Resultat<Charte>>;
  readonly appairer: (membre: string) => Resultat<{ canal: string }>;
  readonly ouvrirAvec: (c: CorpsOuverture, cadre: CadreInvite) => Promise<Response>;
  /** Le relais Claude de ce nœud (route locale et secret) : Claude Code de l'invité y pointe ; null si indisponible. */
  readonly relaisLocal: () => { readonly url: string; readonly jeton: string } | null;
  readonly commander: (
    machine: string,
    commande: { kind: 'prompt_systeme'; sessionId: string; texte: string },
  ) => Promise<ReponsePoste>;
  readonly session: (id: string) => { machine: string } | null;
  readonly repli: (req: Request) => Promise<Response>;
  /** Codes et accès VPN auprès de l'aiguilleur de ce nœud (invitation tout-en-un). */
  readonly codes: Pick<CodesReseau, 'configuration' | 'creer' | 'demanderVpn'>;
}

/** Vue de la charte pour l'appli (même forme que /api/reseau/charte, plus les réglages d'invité de ce nœud). */
function vue(port: PortApiInvites) {
  const charte = port.charte();
  const moi = port.moi();
  const invite = reglagesInviteDe(charte, moi ?? '');
  return { charte, moi, chef: port.chefLocal(), peutCreer: charte === null && moi !== null, invite };
}

function rendre(port: PortApiInvites, r: Resultat<Charte>): Response {
  return r.ok ? json(vue(port)) : erreur(r.raison, r.statut);
}

export class ApiInvites {
  constructor(private readonly port: PortApiInvites) {}

  /** Refus 403 d'une route locale qui viserait le contenu d'une session d'invité, sinon null. */
  gardeLocale(url: string): Response | null {
    return this.port.invites.gardeLocale(url);
  }

  /** Les sessions de ce nœud telles que l'appli locale les voit (sessions d'invité masquées). */
  sessionsLocales(sessions: readonly ResumeSession[]): ResumeSession[] {
    return this.port.invites.sessionsPour(null, sessions);
  }

  routes(protege: Protection) {
    return routesInvites(this.port, protege);
  }

  /**
   * `POST /api/sessions` : ce nœud est invité → la session s'ouvre ici, sur son dossier, et son modèle passe par le
   * relais Claude du chef (le jeton du chef ne vient jamais ici). Sinon, le chemin ordinaire.
   */
  async ouvrirSession(req: Request): Promise<Response> {
    const moi = this.port.moi();
    if (moi === null || !this.port.invites.estInvite(moi)) return this.port.repli(req);
    const texte = await req.text();
    const pr = this.port.invites.preparer(moi, texte);
    if (!pr.ok) return erreur(pr.raison, pr.statut);
    const relais = this.port.relaisLocal();
    if (relais === null) return erreur('relais Claude indisponible sur ce nœud', 503);
    return this.port.invites.executerOuverture(
      { geste: 'ouvrir', methode: 'POST', corps: JSON.stringify(pr.corps), invite: { ...pr.cadre, relais } },
      (c, cadre) => this.port.ouvrirAvec(c, cadre),
    );
  }
}

/** Les routes des invités (protégées comme les autres routes de /api/reseau et de session). */
export function routesInvites(port: PortApiInvites, protege: Protection) {
  return {
    '/api/reseau/invites': { POST: protege(async (req) => inviter(port, req)) },
    '/api/reseau/charte/membres/:membre/invite': {
      POST: protege(async (req) => {
        const membre = req.params['membre'] ?? '';
        const c = await lireCorps(req, CorpsReglages);
        if (c instanceof Response) return c;
        if (!ID_MEMBRE.safeParse(membre).success) return erreur('membre invalide', 400);
        if (reglagesInviteDe(port.charte(), membre) === null) return erreur('membre non invité', 404);
        return rendre(port, await port.editer((ch, moi, le) => changerInviteFusionne(ch, moi, membre, c.reglages, le)));
      }),
    },
    '/api/reseau/invites/invitation': {
      POST: protege(async (req) => inviterParInvitation(port, req)),
    },
    '/api/reseau/invites/:membre/activite': {
      GET: protege((req) => {
        const membre = req.params['membre'] ?? '';
        if (!ID_MEMBRE.safeParse(membre).success) return erreur('membre invalide', 400);
        return json(port.invites.activitePour(membre));
      }),
    },
    '/api/sessions/:id/prompt-systeme': {
      POST: protege(async (req) => promptSysteme(port, req)),
    },
  };
}

/** Inviter (« Ajouter… › Invité » ou « Inviter » sur une machine) : pair déjà membre, ou machine à appairer. */
async function inviter(port: PortApiInvites, req: Requete): Promise<Response> {
  const c = await lireCorps(req, CorpsMembre);
  if (c instanceof Response) return c;
  if (!port.chefLocal()) return erreur('chef requis', 403);
  const charte = port.charte();
  const moi = port.moi() ?? '';
  const sorte = membreDe(charte, moi)?.sorte;
  const reglages = reglagesParDefaut(sorte === 'telephone' ? null : moi);
  const existant = membreDe(charte, c.membre);
  if (existant !== null)
    return rendre(port, await port.editer((ch, m, le) => inviterMembre(ch, m, existant, reglages, le)));
  port.invites.intentions.pose(c.membre, reglages, DUREE_INTENTION_MS);
  const r = port.appairer(c.membre);
  return r.ok ? json(vue(port)) : erreur(r.raison, r.statut);
}

/** Réglages partiels d'un invité : fusion avec les réglages courants (lus dans la charte de l'édition, pas d'avant). */
function changerInviteFusionne(
  c: Charte,
  moi: string,
  membre: string,
  partiels: ReglagesPartiels,
  le: string,
): Edition {
  const actuels = reglagesInviteDe(c, membre);
  if (actuels === null) return { ok: false, raison: 'membre non invité' };
  return changerInvite(c, moi, membre, fusionnerReglages(actuels, partiels), le);
}

/** Invitation tout-en-un (code, accès VPN, texte à remettre) : chef seulement. */
async function inviterParInvitation(port: PortApiInvites, req: Requete): Promise<Response> {
  const c = await lireCorps(req, CorpsInvitation);
  if (c instanceof Response) return c;
  if (!port.chefLocal()) return erreur('chef requis', 403);
  const r = await creerInvitation(port.codes);
  return r.ok ? json(r.valeur) : erreur(r.raison, r.statut);
}

/** Prompt de conversation : relayé au poste de la session (les tours suivants, gardé pour la reprise). */
async function promptSysteme(port: PortApiInvites, req: Requete): Promise<Response> {
  const c = await lireCorps(req, CorpsTexte);
  if (c instanceof Response) return c;
  const session = port.session(req.params['id'] ?? '');
  if (session === null) return erreur('session inconnue', 404);
  const r = await port.commander(session.machine, {
    kind: 'prompt_systeme',
    sessionId: req.params['id'] ?? '',
    texte: c.texte,
  });
  return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'commande refusée', 409);
}
