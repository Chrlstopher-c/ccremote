// Responsabilité : les demandes d'appareil des autres nœuds de Chris — la photo que chaque nœud envoie à ses
// pairs, rangée par nœud, en mémoire seulement (jamais persistée, vidée à la fermeture du lien ou à la
// révocation). Ce module ne décide de rien : la décision de Chris est relayée au nœud qui tient la demande, par
// Federation.
import type { DemandeAppareilPartagee } from '../../commun/federation.ts';
import type { DemandeAppairage } from './demandes.ts';

/** La photo des demandes d'appareil en attente d'ici, telle qu'elle part vers les nœuds pairs (sans l'identifiant). */
export function photoDemandesAppareil(demandes: readonly DemandeAppairage[]): DemandeAppareilPartagee[] {
  return demandes
    .filter((d) => d.genre === 'appareil')
    .map(({ id, nom, empreinte, empreinteLocale, le }) => ({ id, nom, empreinte, empreinteLocale, le }));
}

export class DemandesFederees {
  private readonly parNoeud = new Map<string, readonly DemandeAppareilPartagee[]>();

  /** Remplace la photo précédente d'un nœud pair. */
  recevoir(noeud: string, liste: readonly DemandeAppareilPartagee[]): void {
    this.parNoeud.set(noeud, liste);
  }

  oublier(noeud: string): void {
    this.parNoeud.delete(noeud);
  }

  /** Les demandes des autres nœuds, chacune marquée du nœud qui la tient. */
  lister(): DemandeAppairage[] {
    return [...this.parNoeud].flatMap(([noeud, liste]) =>
      liste.map((d) => ({ ...d, genre: 'appareil' as const, noeud })),
    );
  }

  /** Le nœud qui tient cette demande, ou null si aucun nœud pair ne la montre. */
  noeudDe(id: string): string | null {
    for (const [noeud, liste] of this.parNoeud) if (liste.some((d) => d.id === id)) return noeud;
    return null;
  }
}
