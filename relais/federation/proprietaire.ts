// Responsabilité : qui est à qui dans « mes machines ». La règle (un membre est des nôtres si c'est un nœud, que son
// propriétaire et le nôtre sont connus et égaux) est pure. Le Voisinage garde ce que la présence de l'aiguilleur et les
// messages `ouvrir` disent de chaque membre (nom, genre, propriétaire, en ligne). Aucune E/S ici.
import type { GenreMembre, MembrePresence } from '../../commun/aiguilleur.ts';

export interface InfoMembre {
  readonly id: string;
  readonly enLigne: boolean;
  readonly nom: string;
  readonly genre: GenreMembre | null;
  readonly proprietaire: string | null;
}

export interface MembreVu extends InfoMembre {
  readonly mien: boolean;
}

/** Ce qu'on ne sait pas encore (membre inconnu, genre ou propriétaire absents d'un aiguilleur ancien). */
export const RAISON_PROPRIETAIRE_INCONNU = 'propriétaire inconnu';
/** Ce qu'on sait, et qui n'est pas à nous : un autre propriétaire, ou un appareil. */
export const RAISON_PAS_A_TOI = 'ce nœud n’est pas à toi';

interface Attributs {
  readonly genre: GenreMembre | null;
  readonly proprietaire: string | null;
}

/** La règle : un nœud, du même propriétaire que nous ; les deux propriétaires doivent être connus. */
export function estDeMesMachines(membre: Attributs, moi: string | null): boolean {
  return membre.genre === 'noeud' && membre.proprietaire !== null && moi !== null && membre.proprietaire === moi;
}

/** Un appareil client de même propriétaire : il peut présenter une demande (Chris l'accepte sur le nœud). */
export function raisonRefusAppareil(membre: InfoMembre | undefined, moi: string | null): string | null {
  if (!membre || membre.genre !== 'appareil' || membre.proprietaire === null || moi === null) {
    return RAISON_PROPRIETAIRE_INCONNU;
  }
  return membre.proprietaire === moi ? null : RAISON_PAS_A_TOI;
}

/** Pourquoi on ne traite pas ce membre comme l'un des nôtres ; null s'il l'est. */
export function raisonRefus(membre: InfoMembre | undefined, moi: string | null): string | null {
  if (!membre || membre.genre === null || membre.proprietaire === null || moi === null) {
    return RAISON_PROPRIETAIRE_INCONNU;
  }
  return estDeMesMachines(membre, moi) ? null : RAISON_PAS_A_TOI;
}

function versInfo(m: MembrePresence): InfoMembre {
  return {
    id: m.id,
    enLigne: m.enLigne,
    nom: m.nom ?? '',
    genre: m.genre ?? null,
    proprietaire: m.proprietaire ?? null,
  };
}

/** Les membres vus dans la présence de l'aiguilleur. */
export class Voisinage {
  private readonly infos = new Map<string, InfoMembre>();
  // Pairs joints par une liaison directe : ni la présence de l'aiguilleur ni son remplacement ne les touchent.
  private readonly directs = new Map<string, InfoMembre>();

  /** Remplace tout : chaque présence donne la liste complète des membres joignables. */
  /** Rend vrai si la liste a changé (l'aiguilleur renvoie la même présence à chaque battement). */
  remplacer(membres: readonly MembrePresence[]): boolean {
    const avant = JSON.stringify([...this.infos.values()]);
    this.infos.clear();
    for (const m of membres) this.infos.set(m.id, versInfo(m));
    return JSON.stringify([...this.infos.values()]) !== avant;
  }

  /** Un message `ouvrir` nomme le propriétaire de l'ouvrant (il est en ligne) ; le reste attend la présence. */
  memoriserOuvrant(id: string, proprietaire: string): void {
    const actuel = this.infos.get(id);
    this.infos.set(id, {
      id,
      enLigne: true,
      nom: actuel?.nom ?? '',
      genre: actuel?.genre ?? null,
      proprietaire,
    });
  }

  /** Un membre joint par une liaison directe ouverte est en ligne, quoi qu'en dise la présence de l'aiguilleur. */
  enLigne(id: string): boolean {
    return this.infos.get(id)?.enLigne === true || this.directs.has(id);
  }

  refusPour(id: string, moi: string | null): string | null {
    return raisonRefus(this.info(id), moi);
  }

  refusAppareil(id: string, moi: string | null): string | null {
    return raisonRefusAppareil(this.info(id), moi);
  }

  /** Un de nos nœuds, en ligne : le seul pair qu'on appaire ou qu'on relie. */
  joignable(id: string, moi: string | null): boolean {
    const info = this.info(id);
    return info !== undefined && this.enLigne(id) && estDeMesMachines(info, moi);
  }

  /** Un pair joint par une liaison directe : son nom, son genre et son propriétaire sont ceux de la poignée. */
  memoriserDirect(info: InfoMembre): void {
    this.directs.set(info.id, info);
  }

  retirerDirect(id: string): void {
    this.directs.delete(id);
  }

  liste(moi: string | null): MembreVu[] {
    const membres = new Map<string, InfoMembre>([...this.directs, ...this.infos]);
    return [...membres.values()].map((i) => ({ ...i, enLigne: this.enLigne(i.id), mien: estDeMesMachines(i, moi) }));
  }

  /** Efface ce que dit l'aiguilleur ; les liaisons directes restent. */
  effacer(): void {
    this.infos.clear();
  }

  private info(id: string): InfoMembre | undefined {
    return this.infos.get(id) ?? this.directs.get(id);
  }
}
