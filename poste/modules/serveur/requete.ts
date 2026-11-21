// Responsabilité : relayer au serveur d'un module (127.0.0.1) une requête venue du relais, et rendre sa réponse.
// Le corps rend en texte si le type le permet et que c'est de l'UTF-8 valide, en base64 sinon. 4 Mo au plus, dans
// les deux sens.
import type { Logger } from 'pino';
import {
  DELAI_REQUETE_SERVEUR_MS,
  depasseCorpsServeur,
  type ReponseServeur,
  type RequeteServeur,
  TAILLE_MAX_CORPS_SERVEUR,
} from '../../../commun/modules.ts';

export type ResultatServeur =
  { readonly ok: true; readonly donnees: ReponseServeur } | { readonly ok: false; readonly erreur: string };

const CORPS_TROP_GRAND = 'corps trop volumineux (4 Mo au plus)';
const REPONSE_TROP_GRANDE = 'réponse trop volumineuse (4 Mo au plus)';
const TEXTUEL = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg\+xml|\S+\+(json|xml))/;

export async function requeteServeur(port: number, requete: RequeteServeur, journal: Logger): Promise<ResultatServeur> {
  if (depasseCorpsServeur(requete.body, requete.encodage)) return { ok: false, erreur: CORPS_TROP_GRAND };
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}${requete.chemin}`, {
      method: requete.method ?? 'GET',
      headers: requete.headers,
      body: corpsDe(requete),
      redirect: 'manual',
      signal: AbortSignal.timeout(DELAI_REQUETE_SERVEUR_MS),
    });
    const octets = await lireBorne(reponse);
    if (octets === null) return { ok: false, erreur: REPONSE_TROP_GRANDE };
    return { ok: true, donnees: versReponse(reponse, octets) };
  } catch (erreur) {
    const raison = erreur instanceof Error ? erreur.message : String(erreur);
    journal.warn({ err: erreur, chemin: requete.chemin }, 'requête au serveur du module échouée');
    return { ok: false, erreur: `serveur injoignable : ${raison}` };
  }
}

function corpsDe(requete: RequeteServeur): string | Buffer | undefined {
  if (requete.body === undefined) return undefined;
  return requete.encodage === 'base64' ? Buffer.from(requete.body, 'base64') : requete.body;
}

// Lit la réponse sans jamais dépasser 4 Mo : `null` si elle est trop grosse (le flux est alors coupé).
async function lireBorne(reponse: Response): Promise<Uint8Array | null> {
  const lecteur = reponse.body?.getReader();
  if (lecteur === undefined) return new Uint8Array();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > TAILLE_MAX_CORPS_SERVEUR) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  return Buffer.concat(morceaux);
}

function versReponse(reponse: Response, octets: Uint8Array): ReponseServeur {
  const type = reponse.headers.get('content-type') ?? '';
  const entetes = Object.fromEntries(reponse.headers);
  const texte = TEXTUEL.test(type) ? decoderUtf8(octets) : null;
  if (texte !== null) return { status: reponse.status, headers: entetes, body: texte, encodage: 'texte' };
  return { status: reponse.status, headers: entetes, body: Buffer.from(octets).toString('base64'), encodage: 'base64' };
}

function decoderUtf8(octets: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return null;
  }
}
