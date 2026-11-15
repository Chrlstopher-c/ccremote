// Responsabilité : les fichiers d'un poste côté monde — lister, lire un texte (morceaux réassemblés), écrire, renommer,
// créer un dossier, supprimer. Le relais ne garde rien : chaque appel est transmis au poste de la machine.
import type { ListeDossier } from './contrat';
import { journaliser } from './journal';
import { erreurDeReponse, ErreurRelais, type Recuperer } from './transport-http';

/** Au-delà, un fichier se télécharge mais ne s'ouvre pas dans l'éditeur. */
export const TAILLE_MAX_EDITION = 2 * 1024 * 1024;

export interface ServiceFichiers {
  lister(machine: string, chemin?: string): Promise<ListeDossier>;
  lire(machine: string, chemin: string): Promise<string>;
  ecrire(machine: string, chemin: string, contenu: string | Uint8Array): Promise<void>;
  renommer(machine: string, de: string, vers: string): Promise<void>;
  creerDossier(machine: string, chemin: string): Promise<void>;
  supprimer(machine: string, chemin: string): Promise<void>;
}

export interface OptionsFichiersRelais {
  readonly base: string;
  readonly jeton: string;
  readonly recuperer: Recuperer;
}

type Methode = 'GET' | 'PUT' | 'POST';

const DECODEUR = new TextDecoder();
const ENCODEUR = new TextEncoder();

export function creerFichiersRelais(options: OptionsFichiersRelais): ServiceFichiers {
  return new ClientFichiers(options.base.replace(/\/+$/, ''), options.jeton, options.recuperer);
}

function dossierUrl(machine: string): string {
  return `/api/machines/${encodeURIComponent(machine)}/fichiers`;
}

function fichierUrl(machine: string): string {
  return `/api/machines/${encodeURIComponent(machine)}/fichier`;
}

function requete(chemin: string): string {
  return `?chemin=${encodeURIComponent(chemin)}`;
}

function tropGros(chemin: string): ErreurRelais {
  journaliser('info', 'fichier trop volumineux pour l’éditeur', { chemin });
  return new ErreurRelais(413, 'fichier trop volumineux pour l’éditeur');
}

class ClientFichiers implements ServiceFichiers {
  constructor(
    private readonly racine: string,
    private readonly jeton: string,
    private readonly recuperer: Recuperer,
  ) {}

  async lister(machine: string, chemin?: string): Promise<ListeDossier> {
    const reponse = await this.envoyer('GET', `${dossierUrl(machine)}${chemin ? requete(chemin) : ''}`);
    return lireJson<ListeDossier>(reponse);
  }

  async lire(machine: string, chemin: string): Promise<string> {
    const reponse = await this.envoyer('GET', `${fichierUrl(machine)}${requete(chemin)}`);
    if (Number(reponse.headers.get('content-length')) > TAILLE_MAX_EDITION) {
      await reponse.body?.cancel();
      throw tropGros(chemin);
    }
    return lireCorps(reponse, chemin);
  }

  async ecrire(machine: string, chemin: string, contenu: string | Uint8Array): Promise<void> {
    const corps = new Uint8Array(typeof contenu === 'string' ? ENCODEUR.encode(contenu) : contenu);
    await this.envoyer('PUT', `${fichierUrl(machine)}${requete(chemin)}`, corps, {
      'content-type': 'application/octet-stream',
    });
  }

  async renommer(machine: string, de: string, vers: string): Promise<void> {
    await this.envoyerJson(`${dossierUrl(machine)}/renommer`, { de, vers });
  }

  async creerDossier(machine: string, chemin: string): Promise<void> {
    await this.envoyerJson(`${dossierUrl(machine)}/dossier`, { chemin });
  }

  async supprimer(machine: string, chemin: string): Promise<void> {
    await this.envoyerJson(`${dossierUrl(machine)}/supprimer`, { chemin });
  }

  private envoyerJson(chemin: string, donnees: unknown): Promise<Response> {
    return this.envoyer('POST', chemin, JSON.stringify(donnees), { 'content-type': 'application/json' });
  }

  private async envoyer(
    methode: Methode,
    chemin: string,
    corps?: BodyInit,
    entetes: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    let reponse: Response;
    try {
      reponse = await this.recuperer(`${this.racine}${chemin}`, {
        method: methode,
        headers: { authorization: `Bearer ${this.jeton}`, ...entetes },
        ...(corps === undefined ? {} : { body: corps }),
      });
    } catch (erreur) {
      journaliser('warn', 'relais injoignable', { chemin, erreur: String(erreur) });
      throw new ErreurRelais(0, 'relais injoignable');
    }
    if (!reponse.ok) throw await erreurDeReponse(reponse);
    return reponse;
  }
}

async function lireJson<T>(reponse: Response): Promise<T> {
  const texte = await reponse.text();
  try {
    return JSON.parse(texte) as T; // forme garantie par le relais (commun/appareil.ts), miroir dans contrat.ts
  } catch (erreur) {
    journaliser('error', 'réponse du relais illisible', { erreur: String(erreur) });
    throw new ErreurRelais(reponse.status, 'réponse du relais illisible');
  }
}

// Lecture en morceaux : le relais envoie le fichier par tranches, on les réassemble et on borne la taille lue.
async function lireCorps(reponse: Response, chemin: string): Promise<string> {
  const lecteur = reponse.body?.getReader();
  if (!lecteur) return '';
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (let lu = await lecteur.read(); !lu.done; lu = await lecteur.read()) {
      total += lu.value.byteLength;
      if (total > TAILLE_MAX_EDITION) {
        await lecteur.cancel();
        throw tropGros(chemin);
      }
      morceaux.push(lu.value);
    }
  } catch (erreur) {
    journaliser('warn', 'lecture de fichier interrompue', { chemin, erreur: String(erreur) });
    throw erreur;
  }
  return DECODEUR.decode(assembler(morceaux, total));
}

function assembler(morceaux: readonly Uint8Array[], total: number): Uint8Array {
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    sortie.set(morceau, position);
    position += morceau.byteLength;
  }
  return sortie;
}
