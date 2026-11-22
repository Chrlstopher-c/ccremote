// Responsabilité : le flux en direct d'un appareil par l'aiguilleur — les événements du nœud (le même flux que le
// WebSocket `/api/flux` des clients directs) partent dans le canal chiffré, et les deltas de texte se regroupent
// comme la fédération le fait (DELAI_FLUX_MS). Rien n'est gardé : un événement non parti se rattrape à la relecture.
import type { MessageClient } from '../../commun/api-clients.ts';
import { TAILLE_FLUX_MAX_CARACTERES, TAILLE_MORCEAU_APPAREIL_CARACTERES } from '../../commun/federation.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { CanalNoeud } from './canal.ts';
import { DELAI_FLUX_MS } from './echanges.ts';
import { nonceRef } from './identifiants.ts';
import { messagesAvecCorps } from './transferts.ts';

type MessageFlux = Extract<MessageClient, { type: 'flux' }>;

/** Diffusions qui ne vont qu'aux interfaces de bureau (Echo, salle de réunion) : rien à gagner à les porter. */
const HORS_APPAREIL = new Set<string>(['echo', 'reunion']);

interface Abonnement {
  readonly canal: CanalNoeud;
  retirer: () => void;
  readonly tampon: Map<string, MessageFlux>;
  minuterie: ReturnType<typeof setTimeout> | null;
}

export class DiffusionAppareil {
  private readonly abonnements = new Map<string, Abonnement>();

  constructor(private readonly diffusion: Diffusion) {}

  /** Le canal de l'appareil reçoit désormais les événements ; l'acquittement `diffusion_ouverte` part tout de suite. */
  ouvrir(canal: CanalNoeud): void {
    if (this.abonnements.has(canal.id)) return;
    const abonnement: Abonnement = {
      canal,
      retirer: () => undefined,
      tampon: new Map(),
      minuterie: null,
    };
    abonnement.retirer = this.diffusion.ecouter((m) => this.recevoir(abonnement, m));
    this.abonnements.set(canal.id, abonnement);
    canal.envoyer({ t: 'diffusion_ouverte' });
  }

  fermer(canal: CanalNoeud): void {
    const abonnement = this.abonnements.get(canal.id);
    if (!abonnement) return;
    abonnement.retirer();
    if (abonnement.minuterie) clearTimeout(abonnement.minuterie);
    this.abonnements.delete(canal.id);
  }

  fermerTout(): void {
    for (const canal of [...this.abonnements.values()].map((a) => a.canal)) this.fermer(canal);
  }

  private recevoir(abonnement: Abonnement, m: MessageClient): void {
    if (HORS_APPAREIL.has(m.type)) return;
    if (this.diffusion.filtre && !this.diffusion.filtre(m)) return;
    if (m.type === 'flux') return this.empiler(abonnement, m);
    this.vider(abonnement);
    this.envoyer(abonnement.canal, JSON.stringify(m));
  }

  // Un delta part avec les suivants du même bloc, au plus tard après DELAI_FLUX_MS ; un tampon plein part aussitôt.
  private empiler(abonnement: Abonnement, m: MessageFlux): void {
    const cle = `${m.sessionId}\u0000${m.bloc}\u0000${m.genre ?? ''}\u0000${m.agent ?? ''}`;
    const existant = abonnement.tampon.get(cle);
    const cumule: MessageFlux = existant ? { ...m, delta: existant.delta + m.delta } : m;
    abonnement.tampon.set(cle, cumule);
    if (cumule.delta.length >= TAILLE_FLUX_MAX_CARACTERES) {
      abonnement.tampon.delete(cle);
      this.envoyer(abonnement.canal, JSON.stringify(cumule));
    }
    if (!abonnement.minuterie) {
      abonnement.minuterie = setTimeout(() => this.vider(abonnement), DELAI_FLUX_MS);
    }
  }

  // Les deltas en attente partent avant tout autre événement : l'ordre du direct est gardé.
  private vider(abonnement: Abonnement): void {
    if (abonnement.minuterie) clearTimeout(abonnement.minuterie);
    abonnement.minuterie = null;
    for (const m of abonnement.tampon.values()) this.envoyer(abonnement.canal, JSON.stringify(m));
    abonnement.tampon.clear();
  }

  private envoyer(canal: CanalNoeud, texte: string): void {
    const ref = nonceRef();
    for (const m of messagesAvecCorps(ref, texte, (corps, morceaux) => ({
      t: 'diffusion',
      ref,
      corps,
      ...(morceaux !== undefined ? { morceaux } : {}),
    }), TAILLE_MORCEAU_APPAREIL_CARACTERES)) {
      if (!canal.envoyer(m)) return;
    }
  }
}
