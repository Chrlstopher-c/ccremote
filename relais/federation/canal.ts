// Responsabilité : un canal de l'aiguilleur entre deux nœuds, de son ouverture à sa fermeture. Deux usages :
// l'appairage (première ouverture vers un nœud inconnu : présentations en clair, décision de Chris chez le visé)
// puis le lien chiffré (poignée d'identités connues, puis trames). Le canal ne décide jamais seul : il rend chaque
// décision à l'hôte.
import type { Logger } from 'pino';
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import { ErreurChiffrement } from '../../commun/chiffrement/erreur.ts';
import {
  exporterIdentitePublique,
  importerIdentitePublique,
  type Identite,
  type IdentitePublique,
} from '../../commun/chiffrement/identite.ts';
import {
  type AttentePoignee,
  initierPoignee,
  repondrePoignee,
  terminerPoignee,
} from '../../commun/chiffrement/poignee.ts';
import { lireMessageEnClair, type MessageChiffre, type MessageEnClair } from '../../commun/federation.ts';
import type { PairFederee } from './secrets.ts';
import { Tunnel } from './tunnel.ts';

export type Intention = 'appairage' | 'lien';
export type Role = 'ouvrant' | 'accepteur';
export type Phase =
  'ouverture' | 'attente-accord' | 'presentation' | 'decision' | 'poignee-attendue' | 'poignee' | 'ouvert' | 'ferme';

export interface PresentationDistante {
  readonly identite: string;
  readonly nom: string;
}

/** Ce que le canal attend de son hôte (le Federation du nœud) : identités, décisions, transport. */
export interface HoteCanal {
  readonly journal: Logger;
  readonly delaiAppairageMs: number;
  identiteLocale(): Promise<Identite>;
  nomLocal(): string;
  pairDe(membre: string): PairFederee | null;
  envoyerAiguilleur(message: MessageVersAiguilleur): boolean;
  presentationRecue(canal: CanalNoeud, presentation: PresentationDistante): void;
  appairageAccepte(canal: CanalNoeud, presentation: PresentationDistante): void;
  appairageRefuse(canal: CanalNoeud, raison: string): void;
  liaisonOuverte(canal: CanalNoeud): void;
  liaisonRefusee(canal: CanalNoeud, raison: string): void;
  messageRecu(canal: CanalNoeud, message: MessageChiffre): void;
  canalFerme(canal: CanalNoeud): void;
}

const DELAI_POIGNEE_MS = 20_000;

export class CanalNoeud {
  phase: Phase;
  private attente: AttentePoignee | null = null;
  private tunnel: Tunnel | null = null;
  private presentation: PresentationDistante | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  // Les événements d'un canal se traitent un à un : une poignée finie avant le message chiffré qui la suit.
  private file: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly membre: string,
    readonly intention: Intention,
    readonly role: Role,
    private readonly hote: HoteCanal,
  ) {
    this.phase = role === 'ouvrant' ? 'ouverture' : intention === 'appairage' ? 'presentation' : 'poignee-attendue';
    this.armer();
  }

  get ouvert(): boolean {
    return this.phase === 'ouvert';
  }

  get actif(): boolean {
    return this.phase !== 'ferme';
  }

  /** Le pair a accepté l'ouverture : on joue la suite de l'intention (présentation ou poignée). */
  surAccepter(): Promise<void> {
    return this.enfiler(() => this.suiteAcceptee());
  }

  private async suiteAcceptee(): Promise<void> {
    if (this.phase !== 'ouverture' || this.role !== 'ouvrant') return this.protocole('accord inattendu');
    if (this.intention === 'appairage') return this.presenter();
    await this.lancerPoignee();
  }

  /** Le pair a refusé l'ouverture (ou le canal n'existe plus côté aiguilleur). */
  surRefus(): void {
    if (this.phase === 'ouverture' && this.role === 'ouvrant') this.hote.appairageRefuse(this, 'refus du pair');
    this.terminer();
  }

  /** Fermeture venue de l'aiguilleur (pair déconnecté, canal retiré) : rien à renvoyer. */
  surFermetureDistante(): void {
    this.terminer();
  }

  /** Un message de l'aiguilleur sur ce canal (charge opaque au transport, lue ici), traité dans l'ordre d'arrivée. */
  surDonnees(charge: string): Promise<void> {
    return this.enfiler(() => this.traiterCharge(charge));
  }

  private async traiterCharge(charge: string): Promise<void> {
    if (this.phase === 'ferme') return;
    const message = lireMessageEnClair(lireJson(charge));
    if (!message) return this.protocole('message hors protocole');
    if (message.t === 'refus') return this.refusDistant(message.raison);
    try {
      await this.traiter(message);
    } catch (erreur) {
      this.hote.journal.warn({ err: erreur, canal: this.id, phase: this.phase }, 'canal : message refusé');
      this.protocole(erreur instanceof ErreurChiffrement ? erreur.message : 'message refusé');
    }
  }

  /** Décision de Chris, côté visé d'un appairage : accord (le lien suit) ou refus (le canal se ferme). */
  decider(accord: boolean): void {
    if (this.phase !== 'decision') return;
    if (!accord) {
      this.envoyerClair({ t: 'refus', raison: 'refusé par le nœud visé' });
      return this.fermer();
    }
    this.envoyerClair({ t: 'accord' });
    this.phase = 'poignee-attendue';
    this.armer();
  }

  /** Envoie un message chiffré sur le lien ouvert ; faux si le lien est fermé ou le message trop grand. */
  envoyer(message: MessageChiffre): boolean {
    if (!this.tunnel || this.phase !== 'ouvert') return false;
    return this.tunnel.envoyer(message, (charge) => this.transmettre(charge));
  }

  /** Ferme le canal une fois les messages déjà chiffrés partis (ex. une révocation juste envoyée). */
  fermerApresEnvois(): void {
    if (!this.tunnel) return this.fermer();
    void this.tunnel.vider().then(() => this.fermer());
  }

  /** Ferme le canal de notre côté : l'aiguilleur en est prévenu. */
  fermer(): void {
    if (this.phase === 'ferme') return;
    this.transmettre(undefined);
    this.terminer();
  }

  private async traiter(message: MessageEnClair): Promise<void> {
    if (message.t === 'chiffre') return this.recevoirChiffre(message.trame);
    if (this.phase === 'presentation' && message.t === 'poignee') return this.refuserNonAppaire();
    if (this.phase === 'presentation' && message.t === 'presentation') return this.presentationVisee(message);
    if (this.phase === 'attente-accord' && message.t === 'presentation') return this.presentationOuvrante(message);
    if (this.phase === 'attente-accord' && message.t === 'accord') return this.accordRecu();
    if (this.phase === 'poignee-attendue' && message.t === 'poignee') return this.repondre(message.m);
    if (this.phase === 'poignee' && message.t === 'poignee-reponse') return this.finirPoignee(message.m);
    return this.protocole('étape inattendue');
  }

  // ---- Appairage ---------------------------------------------------------------------------------------------

  private async presenter(): Promise<void> {
    const moi = await this.hote.identiteLocale();
    this.envoyerClair({
      t: 'presentation',
      identite: exporterIdentitePublique(moi.publique),
      nom: this.hote.nomLocal(),
    });
    this.phase = 'attente-accord';
    this.armer();
  }

  // Côté visé : la présentation d'un inconnu. Il répond avec la sienne, pour que chacun lise l'autre empreinte.
  private async presentationVisee(message: Extract<MessageEnClair, { t: 'presentation' }>): Promise<void> {
    const moi = await this.hote.identiteLocale();
    this.presentation = { identite: message.identite, nom: message.nom };
    this.envoyerClair({
      t: 'presentation',
      identite: exporterIdentitePublique(moi.publique),
      nom: this.hote.nomLocal(),
    });
    this.phase = 'decision';
    this.armer();
    this.hote.presentationRecue(this, this.presentation);
  }

  private presentationOuvrante(message: Extract<MessageEnClair, { t: 'presentation' }>): void {
    this.presentation = { identite: message.identite, nom: message.nom };
  }

  private accordRecu(): Promise<void> {
    if (!this.presentation) return Promise.reject(new ErreurChiffrement('accord avant présentation'));
    this.hote.appairageAccepte(this, this.presentation);
    return this.lancerPoignee();
  }

  private refusDistant(raison: string): void {
    if (this.phase === 'attente-accord') this.hote.appairageRefuse(this, raison);
    else if (this.phase === 'poignee' || this.phase === 'poignee-attendue') this.hote.liaisonRefusee(this, raison);
    this.terminer();
  }

  // Un nœud inconnu qui tente un lien (pairing révoqué de notre côté) : on le lui dit, il cesse de réessayer.
  private refuserNonAppaire(): void {
    this.envoyerClair({ t: 'refus', raison: 'non appairé' });
    this.fermer();
  }

  // ---- Poignée et lien chiffré -------------------------------------------------------------------------------

  private async lancerPoignee(): Promise<void> {
    const pair = this.hote.pairDe(this.membre);
    if (!pair) throw new ErreurChiffrement('pair inconnu : poignée impossible');
    const moi = await this.hote.identiteLocale();
    const destinataire = await importerIdentitePublique(pair.identite);
    const { message, attente } = await initierPoignee(moi, destinataire, this.id);
    this.attente = attente;
    this.envoyerClair({ t: 'poignee', m: message });
    this.phase = 'poignee';
    this.armer();
  }

  private async repondre(brut: unknown): Promise<void> {
    const moi = await this.hote.identiteLocale();
    try {
      const { reponse, canal } = await repondrePoignee(moi, brut, (id) => this.identiteAcceptee(id));
      this.envoyerClair({ t: 'poignee-reponse', m: reponse });
      this.tunnel = new Tunnel(canal, this.hote.journal);
    } catch (erreur) {
      this.hote.journal.warn({ err: erreur, canal: this.id }, 'poignée refusée : identité non appairée');
      this.envoyerClair({ t: 'refus', raison: 'identité non appairée' });
      return this.terminer();
    }
    this.devenirOuvert();
  }

  private identiteAcceptee(id: IdentitePublique): boolean {
    const pair = this.hote.pairDe(this.membre);
    return pair !== null && pair.identite === exporterIdentitePublique(id);
  }

  private async finirPoignee(brut: unknown): Promise<void> {
    if (!this.attente) throw new ErreurChiffrement('poignée sans attente');
    this.tunnel = new Tunnel(await terminerPoignee(this.attente, brut), this.hote.journal);
    this.attente = null;
    this.devenirOuvert();
  }

  private devenirOuvert(): void {
    this.phase = 'ouvert';
    this.armer();
    this.hote.liaisonOuverte(this);
  }

  private recevoirChiffre(trame: string): void {
    if (!this.tunnel || this.phase !== 'ouvert') throw new ErreurChiffrement('trame chiffrée hors lien');
    this.tunnel.recevoir(
      trame,
      (message) => this.hote.messageRecu(this, message),
      (raison) => this.protocole(raison),
    );
  }

  // ---- Transport et fin ---------------------------------------------------------------------------------------

  private envoyerClair(message: MessageEnClair): void {
    this.transmettre(JSON.stringify(message));
  }

  // `charge` absente : fermeture (et non une donnée).
  private transmettre(charge: string | undefined): void {
    const message: MessageVersAiguilleur =
      charge === undefined ? { t: 'fermer', canal: this.id } : { t: 'donnees', canal: this.id, charge };
    this.hote.envoyerAiguilleur(message);
  }

  private protocole(raison: string): void {
    this.hote.journal.warn({ canal: this.id, phase: this.phase, raison }, 'canal fermé : protocole');
    this.fermer();
  }

  private enfiler(tache: () => Promise<void>): Promise<void> {
    this.file = this.file
      .then(tache)
      .catch((erreur: unknown) =>
        this.hote.journal.error({ err: erreur, canal: this.id }, 'canal : traitement en échec'),
      );
    return this.file;
  }

  private terminer(): void {
    if (this.phase === 'ferme') return;
    this.phase = 'ferme';
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.tunnel = null;
    this.attente = null;
    this.hote.canalFerme(this);
  }

  // Un canal qui ne progresse pas se ferme seul ; la décision de Chris garde le délai de sa demande (sans minuterie).
  private armer(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    const delai = this.delaiDe();
    if (delai !== null) this.minuterie = setTimeout(() => this.protocole('délai dépassé'), delai);
  }

  private delaiDe(): number | null {
    if (this.phase === 'ouvert' || this.phase === 'ferme' || this.phase === 'decision') return null;
    return this.phase === 'attente-accord' ? this.hote.delaiAppairageMs : DELAI_POIGNEE_MS;
  }
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}
