// Responsabilité : les routes d'appairage d'un appareil — un appareil connecté crée un code, et qui présente un code
// valable reçoit une clé d'appareil. L'échange est ouvert (comme la connexion), avec la même limite de tentatives.
// Avec `machine` (relais central), l'échange remet aussi l'adresse du lien des postes et le jeton de cette machine :
// son secret est renouvelé et sa connexion en cours coupée ; le poste doit se reconnecter avec le nouveau.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Acces } from './acces.ts';
import { ipDe } from '../clients/api.ts';
import { erreur, json, lireCorps } from '../clients/http.ts';
import { emettreJetonPoste, MACHINE_VALIDE } from '../machines/jeton-poste.ts';

const CorpsAppairage = z.object({
  code: z.string().trim().min(1).max(40),
  nom: z.string().trim().min(1).max(80),
  machine: z.string().trim().regex(MACHINE_VALIDE).max(60).optional(),
});

/** Ce qu'il faut pour remettre le jeton d'un poste : relais central seulement (null sur l'appli locale). */
export interface PosteRelais {
  readonly dossier: string;
  readonly secrets: Map<string, string>;
  readonly urlPoste: string | null;
  readonly couper: (machine: string) => void;
}

export interface Serveur {
  requestIP(req: Request): { readonly address: string } | null;
}
export type Gestionnaire = (
  req: Request & { params: Record<string, string> },
  serveur: Serveur,
) => Response | Promise<Response>;

/** Réserve une route aux appareils (genre « appareil ») : sans accès 401, avec un accès Claude 403. */
export function reserveAppareil(acces: Acces): (g: Gestionnaire) => Gestionnaire {
  return (g) => (req, serveur) => {
    const genre = acces.genre(req);
    if (genre === null) return erreur('non connecté', 401);
    return genre === 'appareil' ? g(req, serveur) : erreur('réservé aux appareils connectés par mot de passe', 403);
  };
}

/** Refus avant tout échange, pour que le code reste valable : une machine demandée sans lien des postes joignable. */
function refusPoste(poste: PosteRelais | null, machine: string | undefined): Response | null {
  if (machine === undefined) return null;
  if (!poste) return erreur('lien des postes absent : relais central seulement', 409);
  if (!poste.urlPoste) return erreur('aucune adresse du lien des postes joignable par les clients', 409);
  return null;
}

/** Renouvelle le jeton du poste (la connexion en cours est coupée) et rend la clé avec le lien et le jeton. */
function remettreJeton(poste: PosteRelais, urlPoste: string, machine: string, cle: string, journal: Logger): Response {
  try {
    const { secret } = emettreJetonPoste({
      dossier: poste.dossier,
      machine,
      relais: urlPoste,
      secrets: poste.secrets,
      remplacer: true,
    });
    poste.couper(machine);
    journal.info({ machine }, 'jeton de poste renouvelé par appairage : le poste doit se reconnecter');
    return json({ cle, urlPoste, jetonPoste: secret });
  } catch (erreurEmission) {
    journal.error({ err: erreurEmission, machine }, 'jeton de poste impossible à émettre après appairage');
    return erreur('clé créée, jeton de poste impossible à émettre : refaire l’appairage', 500);
  }
}

export function routesAppairage(
  acces: Acces,
  journal: Logger,
  poste: PosteRelais | null,
): Record<string, Record<string, Gestionnaire>> {
  const reserve = reserveAppareil(acces);
  return {
    '/api/appareils/codes': {
      POST: reserve((req) => {
        const par = acces.lister(req).find((v) => v.courant)?.nom ?? 'appareil';
        const nouveau = acces.creerCodeAppairage(par);
        journal.info({ par }, 'code d’appairage créé');
        return json(nouveau, 201);
      }),
    },
    '/api/appareils/appairer': {
      POST: async (req, serveur) => {
        const c = await lireCorps(req, CorpsAppairage);
        if (c instanceof Response) return c;
        const refus = refusPoste(poste, c.machine);
        if (refus) return refus;
        const r = acces.appairer(c.code, c.nom, ipDe(req, serveur.requestIP(req)?.address));
        if (!r.ok) {
          return r.raison === 'trop_de_tentatives'
            ? erreur('trop de tentatives, réessaie plus tard', 429)
            : erreur('code refusé ou expiré', 401);
        }
        journal.info({ nom: c.nom }, 'appareil appairé');
        if (c.machine === undefined || !poste?.urlPoste) return json({ cle: r.jeton });
        return remettreJeton(poste, poste.urlPoste, c.machine, r.jeton, journal);
      },
    },
  };
}
