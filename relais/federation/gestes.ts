// Responsabilité : la forme des gestes relayés entre nœuds — lire la route visée (session, machine ou nœud) dans une
// requête de l'appli, et ramener la réponse d'une route locale à ce qui tient dans une trame.
// Aucune E/S ici (la liste des routes relayables est dans commun/gestes-federes.ts).
import {
  estMethodeRelayable,
  type MethodeGeste,
  type PorteeGeste,
} from '../../commun/gestes-federes.ts';
import { TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';

/** Marge laissée à l'enveloppe (`t`, `ref`, statut, type) autour du corps rendu. */
const MARGE_ENVELOPPE = 2_000;

export interface RouteDemandee {
  readonly portee: PorteeGeste;
  /** Identifiant de la session ou de la machine visée (dans l'URL). */
  readonly id: string;
  /** Suffixe de route après l'identifiant, ex. `git/diff` ou `artefacts/a1/renommer`. */
  readonly geste: string;
  readonly methode: MethodeGeste;
  readonly requete?: string;
}

/** `/api/sessions/<id>/<suffixe>`, `/api/machines/<id>/<suffixe>`, `/api/artefacts` → la route (null : autre). */
export function lireRoute(url: URL, methode: string): RouteDemandee | null {
  if (!estMethodeRelayable(methode)) return null;
  const morceaux = url.pathname.split('/');
  if (url.pathname === '/api/artefacts') return { portee: 'noeud', id: '', geste: 'artefacts', methode };
  if (morceaux.length < 5 || morceaux[1] !== 'api') return null;
  const portee = porteeDe(morceaux[2]);
  if (!portee) return null;
  const id = decodeURIComponent(morceaux[3] ?? '');
  if (!id) return null;
  const geste = morceaux.slice(4).join('/');
  const requete = requeteSansAttente(url);
  return { portee, id, geste, methode, ...(requete ? { requete } : {}) };
}

function porteeDe(segment: string | undefined): PorteeGeste | null {
  if (segment === 'sessions') return 'session';
  if (segment === 'machines') return 'machine';
  return null;
}

// Le long-poll ne traverse pas le lien : la réponse doit revenir dans le délai d'une requête entre nœuds.
function requeteSansAttente(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('attendre');
  return params.toString();
}

/** Corps binaire (fichier) : son type MIME et son contenu en base64 ; le reste est du texte (JSON, texte). */
export interface CorpsGeste {
  readonly statut: number;
  readonly corps: string;
  readonly type?: string;
  readonly codage?: 'base64';
}

/** Statut et corps d'une réponse locale, réduits pour tenir dans une trame (fil : les plus anciens partent). */
export async function reponseGeste(reponse: Response, geste: string): Promise<CorpsGeste> {
  const limite = TAILLE_MAX_CLAIR_OCTETS - MARGE_ENVELOPPE;
  if (estBinaire(reponse)) return corpsBinaire(reponse, limite);
  const texte = await reponse.text();
  if (octets(texte) <= limite) return { statut: reponse.status, corps: texte };
  const reduit = geste === 'evenements' ? reduireListe(texte, limite) : null;
  if (reduit !== null) return { statut: reponse.status, corps: reduit };
  return { statut: 502, corps: JSON.stringify({ erreur: 'réponse trop grande pour le lien entre machines' }) };
}

function estBinaire(reponse: Response): boolean {
  const type = reponse.headers.get('content-type') ?? 'application/json';
  return !(type.startsWith('application/json') || type.startsWith('text/'));
}

async function corpsBinaire(reponse: Response, limite: number): Promise<CorpsGeste> {
  const brut = new Uint8Array(await reponse.arrayBuffer());
  const type = reponse.headers.get('content-type') ?? 'application/octet-stream';
  const base64 = Buffer.from(brut).toString('base64');
  if (base64.length <= limite) return { statut: reponse.status, corps: base64, type, codage: 'base64' };
  return { statut: 502, corps: JSON.stringify({ erreur: 'fichier trop grand pour le lien entre machines' }) };
}

function reduireListe(texte: string, limite: number): string | null {
  let liste: unknown;
  try {
    liste = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!Array.isArray(liste)) return null;
  let courante: unknown[] = liste;
  let sortie = JSON.stringify(courante);
  while (octets(sortie) > limite && courante.length > 0) {
    courante = courante.slice(Math.max(1, Math.ceil(courante.length / 10)));
    sortie = JSON.stringify(courante);
  }
  return sortie;
}

function octets(texte: string): number {
  return new TextEncoder().encode(texte).byteLength;
}
