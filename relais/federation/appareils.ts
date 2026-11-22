// Responsabilité : servir l'API clients à un appareil appairé, dans son canal chiffré. Une requête de l'appareil
// est rejouée sur la table interne du nœud (celle des gestes relayés par un pair) : aucune socket, aucun jeton.
// L'autorisation est l'identité de l'appareil, acceptée explicitement au nœud avant le canal. Les routes d'accès,
// de fédération, de duo et de synchro ne sont jamais servies à un appareil.
import type { Logger } from 'pino';
import { TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';
import type { TableInterne } from './executeur.ts';

type GestionnaireInterne = NonNullable<NonNullable<TableInterne[string]>[string]>;
export type MethodeApi = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DemandeAppareil {
  readonly methode: MethodeApi;
  readonly chemin: string;
  readonly corps?: string;
}

export interface ReponseAppareil {
  readonly statut: number;
  readonly corps: string;
}

export type ServirAppareil = (demande: DemandeAppareil) => Promise<ReponseAppareil>;

const ORIGINE_INTERNE = 'http://noeud.interne';
const SERVEUR_INTERNE = { requestIP: () => null };
const CHEMINS_REFUSES = [
  '/api/connexion',
  '/api/deconnexion',
  '/api/acces',
  '/api/federation',
  '/api/duo',
  '/api/synchro',
];

export function cheminRefuse(chemin: string): boolean {
  return CHEMINS_REFUSES.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`));
}

function reponseJson(statut: number, erreur: string): ReponseAppareil {
  return { statut, corps: JSON.stringify({ erreur }) };
}

function decoder(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Paramètres de la route modèle (`/api/sessions/:id`) si le chemin lui correspond, sinon null. */
export function correspondance(modele: string, chemin: string): Record<string, string> | null {
  const attendus = modele.split('/');
  const recus = chemin.split('/');
  if (attendus.length !== recus.length) return null;
  const params: Record<string, string> = {};
  for (let k = 0; k < attendus.length; k++) {
    const attendu = attendus[k] ?? '';
    const recu = recus[k] ?? '';
    if (!attendu.startsWith(':')) {
      if (attendu !== recu) return null;
      continue;
    }
    const valeur = decoder(recu);
    if (valeur === null || valeur === '') return null;
    params[attendu.slice(1)] = valeur;
  }
  return params;
}

function trouverRoute(
  table: TableInterne,
  chemin: string,
  methode: MethodeApi,
): { gestionnaire: GestionnaireInterne; params: Record<string, string> } | null {
  for (const [modele, entree] of Object.entries(table)) {
    const params = correspondance(modele, chemin);
    const gestionnaire = entree?.[methode];
    if (params && gestionnaire) return { gestionnaire, params };
  }
  return null;
}

function construireRequete(url: URL, demande: DemandeAppareil, params: Record<string, string>) {
  const avecCorps = demande.corps !== undefined && demande.methode !== 'GET';
  const requete = new Request(url.href, {
    method: demande.methode,
    headers: avecCorps ? { 'content-type': 'application/json' } : {},
    body: avecCorps ? demande.corps : undefined,
  });
  return Object.assign(requete, { params });
}

/** Rejoue une requête d'appareil sur la table interne ; toute erreur devient une réponse 500, journalisée. */
export function servirAppareil(table: TableInterne, journal: Logger): ServirAppareil {
  return async (demande) => {
    const url = new URL(demande.chemin, ORIGINE_INTERNE);
    if (cheminRefuse(url.pathname)) return reponseJson(403, 'route non servie aux appareils');
    const trouve = trouverRoute(table, url.pathname, demande.methode);
    if (!trouve) return reponseJson(404, 'route inconnue');
    try {
      const sortie = await trouve.gestionnaire(construireRequete(url, demande, trouve.params), SERVEUR_INTERNE);
      if (!(sortie instanceof Response)) return reponseJson(500, 'réponse illisible');
      const corps = await sortie.text();
      if (new TextEncoder().encode(corps).byteLength > TAILLE_MAX_CLAIR_OCTETS) {
        return reponseJson(413, 'réponse trop grande pour le canal');
      }
      return { statut: sortie.status, corps };
    } catch (erreur) {
      journal.error({ err: erreur, chemin: url.pathname }, 'appareil : route en échec');
      return reponseJson(500, 'erreur interne');
    }
  };
}
