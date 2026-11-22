// Responsabilité : la forme des gestes relayés entre nœuds — lire la route visée (session, machine ou nœud) dans une
// requête de l'appli, et ramener la réponse d'une route locale à ce qui tient dans une trame.
// Aucune E/S ici (la liste des routes relayables est dans commun/gestes-federes.ts).
import {
  estMethodeRelayable,
  type MethodeGeste,
  type PorteeGeste,
} from '../../commun/gestes-federes.ts';
import { TAILLE_MAX_TRANSFERT_CARACTERES } from '../../commun/federation.ts';
import { tropGrandPourTransfert } from './transferts.ts';

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
  if (url.pathname.startsWith('/api/confirmations/')) {
    const requete = requeteSansAttente(url);
    const geste = url.pathname.slice('/api/'.length);
    return { portee: 'noeud', id: '', geste, methode, ...(requete ? { requete } : {}) };
  }
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

/**
 * Statut et corps d'une réponse locale, prêts à partir : un texte ou un binaire entier (il sera découpé en morceaux
 * s'il ne tient pas dans une trame). Au-delà du plus grand transfert, refus. Pour `evenements`, la liste est réduite.
 */
export async function reponseGeste(reponse: Response, geste: string): Promise<CorpsGeste> {
  if (estBinaire(reponse)) return corpsBinaire(reponse);
  const texte = await reponse.text();
  if (!tropGrandPourTransfert(texte)) return { statut: reponse.status, corps: texte };
  const reduit = geste === 'evenements' ? reduireListe(texte, TAILLE_MAX_TRANSFERT_CARACTERES) : null;
  if (reduit !== null) return { statut: reponse.status, corps: reduit };
  return refusTaille();
}

function estBinaire(reponse: Response): boolean {
  const type = reponse.headers.get('content-type') ?? 'application/json';
  return !(type.startsWith('application/json') || type.startsWith('text/'));
}

async function corpsBinaire(reponse: Response): Promise<CorpsGeste> {
  const brut = new Uint8Array(await reponse.arrayBuffer());
  const type = reponse.headers.get('content-type') ?? 'application/octet-stream';
  const base64 = Buffer.from(brut).toString('base64');
  if (tropGrandPourTransfert(base64)) return refusTaille();
  return { statut: reponse.status, corps: base64, type, codage: 'base64' };
}

function refusTaille(): CorpsGeste {
  return { statut: 413, corps: JSON.stringify({ erreur: 'contenu trop grand pour le lien entre machines' }) };
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
