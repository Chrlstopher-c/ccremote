// Responsabilité : une liaison directe entre deux nœuds, de la poignée à la fermeture — présentation prouvée (défis
// signés), puis messages du protocole de l'aiguilleur relayés tels quels, dans les deux sens. Le lien ne décide pas
// qui est admis : il demande au nœud (`admettre`) et ne transmet que ce qui est du protocole, dans la taille permise.
import type { Logger } from 'pino';
import {
  analyserVersAiguilleur,
  LIMITE_CHARGE_OCTETS,
  type MessageDeAiguilleur,
  type MessageVersAiguilleur,
  octetsCharge,
  TAILLE_MAX_TRAME_OCTETS,
} from '../../commun/aiguilleur.ts';
import {
  composerAccueil,
  composerBonjour,
  defiAleatoire,
  lireDefi,
  type Locale,
  messageDefi,
  type PresentationDirecte,
  verifierAccueil,
  verifierBonjour,
} from './direct-poignee.ts';

/** Ce que le lien sait faire de la connexion sous-jacente (WebSocket serveur ou client). */
export interface SortieLien {
  envoyerBrut(texte: string): boolean;
  fermer(): void;
}

export interface HandlersLien {
  /** Le pair dont l'identité vient d'être prouvée est-il admis sur ce lien ? Faux : le lien se ferme. */
  admettre(lien: LienDirect, presentation: PresentationDirecte): boolean;
  surMessage(lien: LienDirect, message: MessageDeAiguilleur): void;
  surOuvert(lien: LienDirect): void;
  surFerme(lien: LienDirect, etaitOuvert: boolean): void;
}

export type SensLien = 'entrant' | 'sortant';
type Phase = 'defi' | 'bonjour' | 'accueil' | 'ouvert' | 'ferme';

export const DELAI_POIGNEE_DIRECTE_MS = 10_000;

export class LienDirect {
  private phase: Phase;
  private presentationPair: PresentationDirecte | null = null;
  // Défi que ce nœud a émis : envoyé au pair (entrant), ou le sien dans son bonjour (sortant).
  private readonly defiPropre: string;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  private enTraitement = false;

  constructor(
    private readonly sortie: SortieLien,
    private readonly moi: Locale,
    readonly sens: SensLien,
    private readonly handlers: HandlersLien,
    private readonly journal: Logger,
    /** Identifiant attendu du pair (lien vers un nœud connu) ; null pour un appairage. */
    readonly attendu: string | null,
  ) {
    this.defiPropre = defiAleatoire();
    this.phase = sens === 'entrant' ? 'bonjour' : 'defi';
  }

  get pair(): PresentationDirecte | null {
    return this.presentationPair;
  }

  get ouvert(): boolean {
    return this.phase === 'ouvert';
  }

  /** Entrant : le répondeur parle le premier, par son défi. Sortant : il attend ce défi. */
  demarrer(): void {
    this.minuterie = setTimeout(() => this.fermer('poignée trop lente'), DELAI_POIGNEE_DIRECTE_MS);
    if (this.sens === 'entrant') this.envoyerBrut(JSON.stringify(messageDefi(this.defiPropre)));
  }

  /** Une trame brute reçue de la connexion sous-jacente. */
  recevoirBrut(texte: string): void {
    if (this.phase === 'ferme') return;
    if (octetsCharge(texte) > TAILLE_MAX_TRAME_OCTETS) return this.fermer('trame trop grande');
    let brut: unknown;
    try {
      brut = JSON.parse(texte);
    } catch {
      return this.fermer('trame illisible');
    }
    if (this.phase === 'ouvert') return this.recevoirOuvert(brut);
    if (this.enTraitement) return this.fermer('poignée concurrente');
    this.enTraitement = true;
    this.poignee(brut)
      .catch((erreur: unknown) => {
        this.journal.error({ err: erreur }, 'poignée directe : erreur');
        this.fermer('erreur de poignée');
      })
      .finally(() => {
        this.enTraitement = false;
      });
  }

  /** Message du protocole de l'aiguilleur vers le pair : refusé si le lien n'est pas ouvert. */
  envoyer(message: MessageVersAiguilleur): boolean {
    return this.phase === 'ouvert' && this.envoyerBrut(JSON.stringify(message));
  }

  fermer(motif = 'fermé'): void {
    if (this.phase === 'ferme') return;
    const etaitOuvert = this.phase === 'ouvert';
    this.phase = 'ferme';
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.journal.info({ sens: this.sens, motif, ouvert: etaitOuvert }, 'liaison directe fermée');
    this.sortie.fermer();
    this.handlers.surFerme(this, etaitOuvert);
  }

  private envoyerBrut(texte: string): boolean {
    return this.sortie.envoyerBrut(texte);
  }

  private async poignee(brut: unknown): Promise<void> {
    if (this.phase === 'bonjour') return this.recevoirBonjour(brut);
    if (this.phase === 'defi') return this.recevoirDefi(brut);
    if (this.phase === 'accueil') return this.recevoirAccueil(brut);
  }

  // Sortant : le défi du répondeur arrive, nous répondons par notre bonjour signé.
  private async recevoirDefi(brut: unknown): Promise<void> {
    const defi = lireDefi(brut);
    if (!defi) return this.fermer('défi attendu');
    const bonjour = await composerBonjour(this.moi, defi, this.defiPropre);
    this.phase = 'accueil';
    this.envoyerBrut(JSON.stringify(bonjour));
  }

  // Sortant : l'accueil doit signer notre défi et nommer le pair attendu.
  private async recevoirAccueil(brut: unknown): Promise<void> {
    const presentation = await verifierAccueil(brut, this.defiPropre);
    if (!presentation) return this.fermer('accueil invalide');
    if (this.attendu !== null && presentation.id !== this.attendu) return this.fermer('pair inattendu');
    this.ouvrir(presentation);
  }

  // Entrant : le bonjour doit signer notre défi ; si le nœud admet le pair, l'accueil part avant l'ouverture.
  private async recevoirBonjour(brut: unknown): Promise<void> {
    const verifie = await verifierBonjour(brut, this.defiPropre);
    if (!verifie) return this.fermer('bonjour invalide');
    if (!this.handlers.admettre(this, verifie.presentation)) return this.fermer('pair refusé');
    const accueil = await composerAccueil(this.moi, verifie.defi);
    this.envoyerBrut(JSON.stringify(accueil));
    this.ouvrir(verifie.presentation);
  }

  private ouvrir(presentation: PresentationDirecte): void {
    if (this.sens === 'sortant' && !this.handlers.admettre(this, presentation)) return this.fermer('pair refusé');
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.presentationPair = presentation;
    this.phase = 'ouvert';
    this.journal.info({ sens: this.sens, pair: presentation.id }, 'liaison directe ouverte');
    this.handlers.surOuvert(this);
  }

  // Un message de protocole du pair : l'ouverture de canal porte son identifiant prouvé ; le reste est relayé tel quel.
  private recevoirOuvert(brut: unknown): void {
    const message = analyserVersAiguilleur(brut);
    if (!message || this.presentationPair === null) {
      return this.journal.warn('liaison directe : message hors protocole');
    }
    if (message.t === 'donnees' && octetsCharge(message.charge) > LIMITE_CHARGE_OCTETS) {
      return this.journal.warn('liaison directe : charge trop grande');
    }
    if (message.t === 'ouvrir') {
      if (message.vers !== this.moi.id) return this.journal.warn('liaison directe : ouverture pour un autre nœud');
      const { proprietaire } = this.presentationPair;
      return this.handlers.surMessage(this, {
        t: 'ouvrir',
        canal: message.canal,
        de: this.presentationPair.id,
        ...(proprietaire ? { proprietaire } : {}),
      });
    }
    this.handlers.surMessage(this, message);
  }
}
