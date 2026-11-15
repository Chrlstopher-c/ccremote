// Responsabilité : le service de fichiers de la démo — une copie en mémoire de arbre-demo, modifiable comme un vrai
// poste (créer, renommer, écrire, supprimer) le temps de la page. Aucun accès disque ; les refus sont journalisés.
import { ARBRE_DEMO, DATE_DEMO, RACINE_DEMO } from './arbre-demo';
import { deplacer, enfantsDe, estDans, joindre, nomDe, normaliser, parentDe } from './chemins';
import type { EntreeFichier, ListeDossier } from './contrat';
import type { ServiceFichiers } from './fichiers';
import { journaliser } from './journal';
import { MACHINES_DEMO } from './demo-scenario';
import { ErreurRelais } from './transport-http';

const ENCODEUR = new TextEncoder();
const DECODEUR = new TextDecoder();

export function creerFichiersDemo(): ServiceFichiers {
  return new ServiceFichiersDemo();
}

function refuser(statut: number, message: string, contexte: Record<string, unknown>): never {
  journaliser('warn', message, { ...contexte, source: 'demo' });
  throw new ErreurRelais(statut, message);
}

// Valeur absente = pas d'entrée ; null = dossier ; chaîne = contenu d'un fichier.
type Noeud = string | null;

class ServiceFichiersDemo implements ServiceFichiers {
  private readonly noeuds = new Map<string, Noeud>(ARBRE_DEMO.map((n): [string, Noeud] => [n.chemin, n.contenu]));

  async lister(machine: string, chemin: string = RACINE_DEMO): Promise<ListeDossier> {
    this.verifierMachine(machine);
    const dossier = normaliser(chemin);
    if (!this.estDossier(dossier)) refuser(404, 'dossier introuvable', { chemin });
    const entrees = enfantsDe(dossier, this.noeuds.keys())
      .map((c) => this.entree(c))
      .sort((a, b) => Number(b.type === 'dossier') - Number(a.type === 'dossier') || a.nom.localeCompare(b.nom));
    return { chemin: dossier, parent: parentDe(dossier), accueil: RACINE_DEMO, entrees };
  }

  async lire(machine: string, chemin: string): Promise<string> {
    this.verifierMachine(machine);
    const noeud = this.noeuds.get(normaliser(chemin));
    if (typeof noeud !== 'string') refuser(404, 'fichier introuvable', { chemin });
    return noeud;
  }

  async ecrire(machine: string, chemin: string, contenu: string | Uint8Array): Promise<void> {
    this.verifierMachine(machine);
    const cible = normaliser(chemin);
    this.verifierParent(cible);
    if (this.estDossier(cible)) refuser(409, 'c’est un dossier', { chemin });
    this.noeuds.set(cible, typeof contenu === 'string' ? contenu : DECODEUR.decode(contenu));
  }

  async renommer(machine: string, de: string, vers: string): Promise<void> {
    this.verifierMachine(machine);
    const origine = normaliser(de);
    const destination = normaliser(vers);
    if (!this.noeuds.has(origine)) refuser(404, 'élément introuvable', { chemin: de });
    if (this.noeuds.has(destination)) refuser(409, 'un élément porte déjà ce nom', { chemin: vers });
    this.verifierParent(destination);
    const touches = [...this.noeuds].filter(([c]) => estDans(c, origine));
    for (const [c] of touches) this.noeuds.delete(c);
    for (const [c, noeud] of touches) this.noeuds.set(deplacer(c, origine, destination), noeud);
  }

  async creerDossier(machine: string, chemin: string): Promise<void> {
    this.verifierMachine(machine);
    const cible = normaliser(chemin);
    if (this.noeuds.has(cible)) refuser(409, 'un élément porte déjà ce nom', { chemin });
    this.verifierParent(cible);
    this.noeuds.set(cible, null);
  }

  async supprimer(machine: string, chemin: string): Promise<void> {
    this.verifierMachine(machine);
    const cible = normaliser(chemin);
    if (cible === '/') refuser(403, 'la racine du poste ne se supprime pas', { chemin });
    if (!this.noeuds.has(cible)) refuser(404, 'élément introuvable', { chemin });
    for (const c of [...this.noeuds.keys()]) if (estDans(c, cible)) this.noeuds.delete(c);
  }

  private estDossier(chemin: string): boolean {
    return this.noeuds.has(chemin) && this.noeuds.get(chemin) === null;
  }

  private verifierMachine(machine: string): void {
    if (!MACHINES_DEMO.some((m) => m.id === machine)) refuser(404, 'machine inconnue', { machine });
  }

  private verifierParent(chemin: string): void {
    const parent = parentDe(chemin);
    if (parent === null || !this.estDossier(parent)) {
      refuser(404, 'dossier parent introuvable', { chemin: joindre(parent ?? '/', nomDe(chemin)) });
    }
  }

  private entree(chemin: string): EntreeFichier {
    const noeud = this.noeuds.get(chemin) ?? null;
    const nom = nomDe(chemin);
    return {
      nom,
      type: noeud === null ? 'dossier' : 'fichier',
      taille: typeof noeud === 'string' ? ENCODEUR.encode(noeud).byteLength : 0,
      modifie: DATE_DEMO,
      cache: nom.startsWith('.'),
    };
  }
}
