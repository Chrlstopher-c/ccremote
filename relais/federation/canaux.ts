// Responsabilité : la table des canaux du nœud et leur routage — chaque message de l'aiguilleur va au canal qu'il
// concerne, un canal inconnu est refusé ou ignoré. Ouvre les canaux sortants, accueille les entrants (sans jamais
// décider de l'appairage : c'est la décision de Chris, prise plus loin).
import type { MessageDeAiguilleur, MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import { CANAUX_MAX_PAR_MEMBRE } from '../../commun/aiguilleur.ts';
import { type HoteCanal, type Intention, CanalNoeud } from './canal.ts';
import { nonceCanal } from './identifiants.ts';

export class Canaux {
  private readonly parId = new Map<string, CanalNoeud>();

  constructor(
    private readonly hote: HoteCanal,
    private readonly envoyer: (message: MessageVersAiguilleur) => boolean,
  ) {}

  /** Ouvre un canal sortant vers `membre` (l'aiguilleur le transmet, le pair doit l'accepter). Null si hors ligne. */
  ouvrir(membre: string, intention: Intention): CanalNoeud | null {
    const id = nonceCanal();
    const canal = new CanalNoeud(id, membre, intention, 'ouvrant', this.hote);
    if (!this.envoyer({ t: 'ouvrir', canal: id, vers: membre })) {
      canal.fermer();
      return null;
    }
    this.parId.set(id, canal);
    return canal;
  }

  /** Le canal encore actif avec ce membre, s'il existe (appairage ou lien en cours). */
  avec(membre: string): CanalNoeud | null {
    for (const canal of this.parId.values()) if (canal.membre === membre && canal.actif) return canal;
    return null;
  }

  /** Les canaux encore actifs (appairage ou lien, tous états confondus). */
  actifs(): CanalNoeud[] {
    return [...this.parId.values()].filter((c) => c.actif);
  }

  /** Les liens chiffrés ouverts. */
  ouverts(): CanalNoeud[] {
    return [...this.parId.values()].filter((c) => c.ouvert);
  }

  /** Vrai si le canal porte un lien ouvert avec ce membre. */
  liaisonOuverteAvec(membre: string): CanalNoeud | null {
    return this.ouverts().find((c) => c.membre === membre) ?? null;
  }

  /** Oublie un canal fermé (appelé par le canal lui-même, via l'hôte). */
  retirer(canal: CanalNoeud): void {
    if (this.parId.get(canal.id) === canal) this.parId.delete(canal.id);
  }

  surMessage(message: MessageDeAiguilleur): void {
    if (message.t === 'ouvrir') return this.accueillir(message.canal, message.de);
    if (message.t === 'presence') return;
    if (message.t === 'erreur') return this.erreur(message.motif, message.canal);
    const canal = this.parId.get(message.canal);
    if (!canal) return this.inconnu(message);
    if (message.t === 'accepter') void canal.surAccepter();
    else if (message.t === 'refuser') canal.surRefus();
    else if (message.t === 'donnees') void canal.surDonnees(message.charge);
    else canal.surFermetureDistante();
  }

  /** Ferme tous les canaux (arrêt du nœud) : chacun prévient l'aiguilleur. */
  fermerTout(): void {
    for (const canal of [...this.parId.values()]) canal.fermer();
  }

  private accueillir(id: string, de: string): void {
    if (this.parId.has(id) || this.nombreAvec(de) >= CANAUX_MAX_PAR_MEMBRE) {
      this.envoyer({ t: 'refuser', canal: id });
      return;
    }
    const intention: Intention = this.hote.pairDe(de) ? 'lien' : 'appairage';
    const canal = new CanalNoeud(id, de, intention, 'accepteur', this.hote);
    this.parId.set(id, canal);
    this.envoyer({ t: 'accepter', canal: id });
  }

  private nombreAvec(membre: string): number {
    return [...this.parId.values()].filter((c) => c.membre === membre && c.actif).length;
  }

  // Une erreur de l'aiguilleur : journalisée (motif seulement), et le canal visé, s'il existe, est fermé de notre côté.
  private erreur(motif: string, canal?: string): void {
    this.hote.journal.warn({ motif, canal }, 'aiguilleur : erreur');
    if (canal !== undefined) this.parId.get(canal)?.surFermetureDistante();
  }

  // Un message sur un canal inconnu (déjà fermé de notre côté) : rien à faire, on le signale seulement.
  private inconnu(message: MessageDeAiguilleur): void {
    this.hote.journal.warn(
      { canal: message.t === 'presence' ? undefined : message.canal, t: message.t },
      'aiguilleur : canal inconnu',
    );
  }
}
