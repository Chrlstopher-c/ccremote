// Responsabilité : l'état des canaux entre membres (en mémoire, jamais persisté). Un canal a deux bouts, chacun repéré
// par (membre, identifiant de canal) ; il est en attente tant que le membre visé n'a pas accepté, puis ouvert.
// L'aiguilleur ne décide jamais à la place d'un membre : cette classe ne fait que tenir les états.
import { CANAUX_MAX_PAR_MEMBRE, type MotifErreur } from '../../commun/aiguilleur.ts';

interface Canal {
  readonly ouvrant: string;
  readonly cible: string;
  readonly canal: string;
  etat: 'attente' | 'ouvert';
}

export type Resultat<T> =
  { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly motif: MotifErreur };

export class Canaux {
  private readonly bouts = new Map<string, Canal>();

  constructor(private readonly maxParMembre = CANAUX_MAX_PAR_MEMBRE) {}

  /** Ouvre un canal de `ouvrant` vers `cible`. Refusé si l'un des deux bouts porte déjà cet identifiant. */
  ouvrir(ouvrant: string, cible: string, canal: string): MotifErreur | null {
    if (this.bouts.has(cle(ouvrant, canal)) || this.bouts.has(cle(cible, canal))) return 'canal-indisponible';
    if (this.nombre(ouvrant) >= this.maxParMembre || this.nombre(cible) >= this.maxParMembre) return 'trop-de-canaux';
    const c: Canal = { ouvrant, cible, canal, etat: 'attente' };
    this.bouts.set(cle(ouvrant, canal), c);
    this.bouts.set(cle(cible, canal), c);
    return null;
  }

  /** La cible accepte (ouvert) ou refuse (canal supprimé). Rend l'ouvrant à prévenir. */
  decider(membre: string, canal: string, decision: 'accepter' | 'refuser'): Resultat<string> {
    const c = this.bouts.get(cle(membre, canal));
    if (!c) return { ok: false, motif: 'canal-inconnu' };
    if (c.cible !== membre || c.etat !== 'attente') return { ok: false, motif: 'non-autorise' };
    if (decision === 'refuser') this.supprimer(c);
    else c.etat = 'ouvert';
    return { ok: true, valeur: c.ouvrant };
  }

  /** Le correspondant qui doit recevoir une charge venant de `membre` sur ce canal (canal ouvert seulement). */
  acheminer(membre: string, canal: string): Resultat<string> {
    const c = this.bouts.get(cle(membre, canal));
    if (!c) return { ok: false, motif: 'canal-inconnu' };
    if (c.etat !== 'ouvert') return { ok: false, motif: 'canal-non-ouvert' };
    return { ok: true, valeur: c.ouvrant === membre ? c.cible : c.ouvrant };
  }

  /** Membres avec lesquels `membre` a un canal accepté des deux côtés (visibles d’un autre propriétaire). */
  correspondantsOuverts(membre: string): Set<string> {
    const pairs = [...new Set(this.bouts.values())]
      .filter((c) => c.etat === 'ouvert' && (c.ouvrant === membre || c.cible === membre))
      .map((c) => (c.ouvrant === membre ? c.cible : c.ouvrant));
    return new Set(pairs);
  }

  /** Ferme un canal à la demande d'un de ses bouts. Rend le correspondant à prévenir, ou null si canal absent. */
  fermer(membre: string, canal: string): string | null {
    const c = this.bouts.get(cle(membre, canal));
    if (!c) return null;
    this.supprimer(c);
    return c.ouvrant === membre ? c.cible : c.ouvrant;
  }

  /** Retire les canaux d'un membre déconnecté ou révoqué : rend, pour chacun, le correspondant et l'identifiant. */
  retirer(membre: string): { readonly pair: string; readonly canal: string }[] {
    const touches = [...new Set(this.bouts.values())].filter((c) => c.ouvrant === membre || c.cible === membre);
    return touches.map((c) => {
      this.supprimer(c);
      return { pair: c.ouvrant === membre ? c.cible : c.ouvrant, canal: c.canal };
    });
  }

  private nombre(membre: string): number {
    return [...new Set(this.bouts.values())].filter((c) => c.ouvrant === membre || c.cible === membre).length;
  }

  private supprimer(c: Canal): void {
    this.bouts.delete(cle(c.ouvrant, c.canal));
    this.bouts.delete(cle(c.cible, c.canal));
  }
}

// Séparateur absent des identifiants (membres en hexadécimal, canaux sans « | ») : la clé est sans ambiguïté.
function cle(membre: string, canal: string): string {
  return `${membre}|${canal}`;
}
