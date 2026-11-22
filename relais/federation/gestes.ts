// Responsabilité : la forme des gestes relayés entre nœuds — lire, dans une requête de l'appli, le geste visé sur une
// session d'un autre nœud, et ramener la réponse d'une route locale à ce qui tient dans une trame. Aucune E/S ici.
import { GESTES_FEDERES, type GesteFedere, TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';

const GESTES: ReadonlySet<string> = new Set(GESTES_FEDERES);
/** Marge laissée à l'enveloppe (`t`, `ref`, statut) autour du corps rendu. */
const MARGE_ENVELOPPE = 2_000;

export interface GesteDemande {
  readonly geste: GesteFedere;
  readonly methode: 'GET' | 'POST';
  readonly session: string;
  readonly requete?: string;
}

/** `/api/sessions/<id>/<geste>` → la session et le geste (null : autre route, ou geste hors liste). */
export function lireGeste(url: URL, methode: string): GesteDemande | { readonly session: string } | null {
  const morceaux = url.pathname.split('/');
  if (morceaux.length < 5 || morceaux[1] !== 'api' || morceaux[2] !== 'sessions') return null;
  const session = decodeURIComponent(morceaux[3] ?? '');
  if (!session) return null;
  const suffixe = morceaux.slice(4).join('/');
  if (!GESTES.has(suffixe) || suffixe === 'ouvrir' || (methode !== 'GET' && methode !== 'POST')) return { session };
  const requete = requeteSansAttente(url);
  // Le suffixe vient d’être trouvé dans GESTES_FEDERES : le transtypage ne fait que le dire au compilateur.
  return { geste: suffixe as GesteFedere, methode, session, ...(requete ? { requete } : {}) };
}

// Le long-poll ne traverse pas le lien : la réponse doit revenir dans le délai d'une requête entre nœuds.
function requeteSansAttente(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete('attendre');
  return params.toString();
}

export function estGeste(g: GesteDemande | { readonly session: string } | null): g is GesteDemande {
  return g !== null && 'geste' in g;
}

/** Statut et corps d'une réponse locale, réduits pour tenir dans une trame (fil : les plus anciens partent). */
export async function reponseGeste(reponse: Response, geste: GesteFedere): Promise<{ statut: number; corps: string }> {
  const texte = await reponse.text();
  const limite = TAILLE_MAX_CLAIR_OCTETS - MARGE_ENVELOPPE;
  if (octets(texte) <= limite) return { statut: reponse.status, corps: texte };
  const reduit = geste === 'evenements' ? reduireListe(texte, limite) : null;
  if (reduit !== null) return { statut: reponse.status, corps: reduit };
  return { statut: 502, corps: JSON.stringify({ erreur: 'réponse trop grande pour le lien entre machines' }) };
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
