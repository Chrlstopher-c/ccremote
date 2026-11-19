// Responsabilité : l'avancement des installations de poste par SSH (étapes, état, fin de sortie assainie).
// Un état en mémoire : une installation en cours ne survit pas au redémarrage du relais, et c'est voulu.
import type { VueInstallation } from '../../commun/api-clients.ts';

export const LONGUEUR_MESSAGE = 400;
const LIGNES_MESSAGE = 6;
const PREFIXE_ETAPE = '@etape ';

export interface DependancesInstallations {
  readonly surChangement: (id: string) => void;
}

/** Une ligne « @etape … » émise par le script distant : le nom de l'étape. Sinon, ce n'est pas une étape. */
export function etapeDeLigne(ligne: string): string | null {
  return ligne.startsWith(PREFIXE_ETAPE) ? ligne.slice(PREFIXE_ETAPE.length).trim() : null;
}

/**
 * Fin de sortie lisible d'une installation qui échoue : sans les marqueurs d'étape, sans l'hôte, l'utilisateur ni
 * l'adresse IP (ils restent dans le journal local), limitée en lignes et en longueur.
 */
export function assainirSortie(sortie: string, hote: string): string {
  const lignes = sortie
    .split('\n')
    .filter((l) => l.trim() !== '' && etapeDeLigne(l) === null)
    .slice(-LIGNES_MESSAGE)
    .map((l) => l.replace(/[\w.-]+@[\w.-]+/g, '<utilisateur>@<hote>').replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>'));
  let texte = lignes.join('\n');
  if (hote) texte = texte.split(hote).join('<hote>');
  return texte.length > LONGUEUR_MESSAGE ? texte.slice(-LONGUEUR_MESSAGE) : texte;
}

export class Installations {
  private readonly suivis = new Map<string, VueInstallation>();

  constructor(private readonly d: DependancesInstallations) {}

  de(id: string): VueInstallation | null {
    return this.suivis.get(id) ?? null;
  }

  commencer(id: string): void {
    this.suivis.set(id, { etape: 'archive', etat: 'en_cours', message: null });
    this.d.surChangement(id);
  }

  etape(id: string, etape: string): void {
    const actuelle = this.suivis.get(id);
    if (!actuelle || actuelle.etat !== 'en_cours') return;
    this.suivis.set(id, { ...actuelle, etape });
    this.d.surChangement(id);
  }

  fin(id: string, ok: boolean, message: string | null): void {
    const actuelle = this.suivis.get(id);
    const etape = actuelle?.etape ?? 'archive';
    this.suivis.set(id, { etape: ok ? 'poste connecté' : etape, etat: ok ? 'fini' : 'echec', message });
    this.d.surChangement(id);
  }
}
