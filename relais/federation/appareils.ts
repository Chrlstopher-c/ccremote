// Responsabilité : servir l'API clients à un appareil appairé, dans son canal chiffré. Une requête de l'appareil
// est rejouée sur la table interne du nœud (celle des gestes relayés par un pair) : aucune socket, aucun jeton.
// L'autorisation est l'identité de l'appareil, acceptée explicitement au nœud avant le canal. Les routes d'accès,
// de fédération, de duo et de synchro ne sont jamais servies à un appareil. Un corps non textuel (image, fichier)
// voyage en base64, avec son type MIME ; le découpage en morceaux est fait par le fil de la fédération.
import type { Logger } from 'pino';
import { TAILLE_MAX_TRANSFERT_CARACTERES } from '../../commun/federation.ts';
import type { TableInterne } from './executeur.ts';

type GestionnaireInterne = NonNullable<NonNullable<TableInterne[string]>[string]>;
export type MethodeApi = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Un corps `base64` est binaire (`type` : son type MIME) ; sans `codage`, c'est du texte UTF-8. */
export interface DemandeAppareil {
  readonly methode: MethodeApi;
  readonly chemin: string;
  readonly corps?: string;
  readonly codage?: 'base64';
  readonly type?: string;
}

export interface ReponseAppareil {
  readonly statut: number;
  readonly corps: string;
  readonly codage?: 'base64';
  readonly type?: string;
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
  '/api/reseau', // ajouter une machine, accepter un appairage : jamais depuis un appareil
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

function corpsDeDemande(demande: DemandeAppareil): { type: string; corps: Uint8Array | string | undefined } {
  if (demande.corps === undefined || demande.methode === 'GET') return { type: '', corps: undefined };
  if (demande.codage === 'base64') {
    return { type: demande.type ?? 'application/octet-stream', corps: Buffer.from(demande.corps, 'base64') };
  }
  return { type: 'application/json', corps: demande.corps };
}

function construireRequete(url: URL, demande: DemandeAppareil, params: Record<string, string>) {
  const { type, corps } = corpsDeDemande(demande);
  const requete = new Request(url.href, {
    method: demande.methode,
    headers: type ? { 'content-type': type } : {},
    body: corps,
  });
  return Object.assign(requete, { params });
}

const TYPE_TEXTE = /^(text\/|application\/(json|xml|javascript|x-ndjson))/i;
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

/** Texte si le type MIME l'annonce, ou si rien ne l'annonce et que les octets sont du UTF-8 valide. */
function estTexte(type: string | null, octets: Uint8Array): boolean {
  if (type) return TYPE_TEXTE.test(type);
  try {
    UTF8_STRICT.decode(octets);
    return true;
  } catch {
    return false;
  }
}

async function corpsDeReponse(sortie: Response): Promise<ReponseAppareil | null> {
  const octets = new Uint8Array(await sortie.arrayBuffer());
  if (octets.byteLength > TAILLE_MAX_TRANSFERT_CARACTERES) return null;
  const type = sortie.headers.get('content-type');
  if (estTexte(type, octets)) return { statut: sortie.status, corps: new TextDecoder().decode(octets) };
  return { statut: sortie.status, corps: Buffer.from(octets).toString('base64'), codage: 'base64', type: type ?? undefined };
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
      const reponse = await corpsDeReponse(sortie);
      return reponse ?? reponseJson(413, 'réponse trop grande pour le canal');
    } catch (erreur) {
      journal.error({ err: erreur, chemin: url.pathname }, 'appareil : route en échec');
      return reponseJson(500, 'erreur interne');
    }
  };
}
