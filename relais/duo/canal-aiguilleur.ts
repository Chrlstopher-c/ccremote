// Responsabilité : un canal du duo par l'aiguilleur, de son ouverture à sa fermeture. Deux usages : l'appairage (preuve
// par le code, présentations, accord de Chris des deux côtés) puis le lien chiffré (poignée sur des identités
// connues, trames). Le canal ne décide jamais seul : chaque décision est rendue à son hôte (la liaison).
import type { Logger } from 'pino';
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import type { MessageLien } from '../../commun/duo.ts';
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
import {
  type Appairage,
  lireMessageDuoClair,
  type MessageDuoClair,
  type Presentation,
  preuveAppairage,
} from '../../commun/duo-aiguilleur.ts';
import type { Canal } from './lien-commun.ts';
import { TunnelAiguilleur } from './tunnel-aiguilleur.ts';

export type Intention = 'appairage' | 'lien';
export type Role = 'ouvrant' | 'accepteur';
export type Phase =
  | 'ouverture'
  | 'appairage-attendu'
  | 'presentation-attendue'
  | 'decision'
  | 'poignee-attendue'
  | 'poignee'
  | 'ouvert'
  | 'ferme';

/** Ce que le pair a présenté : identité publique (texte), nom affiché, nom d'utilisateur de sa machine. */
export interface Distant {
  readonly identite: string;
  readonly nom: string;
  readonly utilisateur: string;
}

export interface DelaisCanal {
  readonly ouverture: number;
  readonly message: number;
  readonly decision: number;
  readonly poignee: number;
}

/** Ce que le canal attend de son hôte (la liaison) : identités, code, décisions, transport. */
export interface HoteCanal {
  readonly journal: Logger;
  readonly delais: DelaisCanal;
  membreLocal(): string;
  utilisateurLocal(): string;
  nomLocal(): string;
  identiteLocale(): Promise<Identite>;
  envoyerAiguilleur(message: MessageVersAiguilleur): boolean;
  codeValide(canal: CanalDuo, appairage: Appairage): boolean;
  appairageRecu(canal: CanalDuo, distant: Distant): void;
  appairageConfirme(canal: CanalDuo): boolean;
  identitePaire(membre: string): string | null;
  liaisonOuverte(canal: CanalDuo): void;
  messageRecu(canal: CanalDuo, message: MessageLien): void;
  canalFerme(canal: CanalDuo, raison: string, refuse: boolean): void;
}

export class CanalDuo implements Canal {
  phase: Phase;
  decisionLocale = false;
  distant: Distant | null = null;
  private accordDistant = false;
  private tunnel: TunnelAiguilleur | null = null;
  private attente: AttentePoignee | null = null;
  private minuterie: ReturnType<typeof setTimeout> | null = null;
  // Les événements d'un canal se traitent un à un : une poignée finie avant la trame qui la suit.
  private file: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly membre: string,
    readonly intention: Intention,
    readonly role: Role,
    private readonly hote: HoteCanal,
    private readonly code: string | null = null,
  ) {
    if (role === 'ouvrant') this.phase = 'ouverture';
    else this.phase = intention === 'appairage' ? 'appairage-attendu' : 'poignee-attendue';
    this.armer();
  }

  get ouvert(): boolean {
    return this.phase === 'ouvert';
  }

  get actif(): boolean {
    return this.phase !== 'ferme';
  }

  /** Le pair a accepté l'ouverture : on joue la suite de l'intention (appairage ou poignée). */
  surAccepter(): Promise<void> {
    return this.enfiler(() => this.suiteAcceptee());
  }

  /** Un message de l'aiguilleur sur ce canal, traité dans l'ordre d'arrivée. */
  surDonnees(charge: string): Promise<void> {
    return this.enfiler(() => this.traiterCharge(charge));
  }

  /** Refus du pair (ou du canal) : fermeture sans rien renvoyer. */
  surRefus(): void {
    this.terminer('refus du pair', true);
  }

  /** Fermeture ou erreur venue de l'aiguilleur : rien à renvoyer. */
  surFermetureDistante(raison = 'canal fermé'): void {
    this.terminer(raison, false);
  }

  /** Décision de Chris sur l'appairage : accord (le lien suit quand les deux ont accepté) ou refus. */
  decider(accord: boolean): void {
    if (this.phase !== 'decision') return;
    this.decisionLocale = accord;
    if (!accord) return this.refuserEtFermer('refusé par le nœud visé');
    this.envoyerClair({ t: 'accord' });
    if (this.accordDistant) this.confirmer();
  }

  /** Message du duo (clair pour l'hôte), chiffré de bout en bout sur le lien ouvert. */
  envoyer(message: MessageLien): void {
    if (!this.tunnel || this.phase !== 'ouvert') return;
    if (!this.tunnel.envoyer(message, (charge) => this.transmettre(charge))) {
      this.hote.journal.warn({ canal: this.id }, 'message du duo trop grand : non envoyé');
    }
  }

  /** Ferme le canal une fois les envois déjà chiffrés partis (une révocation juste envoyée arrive avant la fin). */
  fermer(raison = 'canal fermé'): void {
    if (this.phase === 'ferme') return;
    const fin = this.tunnel ? this.tunnel.vider() : Promise.resolve();
    void fin.then(() => this.clore(raison));
  }

  private clore(raison: string): void {
    if (this.phase === 'ferme') return;
    this.transmettre(undefined);
    this.terminer(raison, false);
  }

  private async suiteAcceptee(): Promise<void> {
    if (this.phase !== 'ouverture' || this.role !== 'ouvrant') return this.protocole('accord inattendu');
    if (this.intention === 'lien') return this.lancerPoignee();
    if (this.code === null) return this.protocole('appairage sans code');
    const moi = await this.hote.identiteLocale();
    const identite = exporterIdentitePublique(moi.publique);
    const preuve = preuveAppairage(this.code, this.membre, this.hote.membreLocal(), identite);
    this.envoyerClair({
      t: 'appairage',
      preuve,
      identite,
      nom: this.hote.nomLocal(),
      utilisateur: this.hote.utilisateurLocal(),
    });
    this.phase = 'presentation-attendue';
    this.armer();
  }

  private async traiterCharge(charge: string): Promise<void> {
    if (this.phase === 'ferme') return;
    const message = lireMessageDuoClair(lireJson(charge));
    if (!message) return this.protocole('message hors protocole');
    if (message.t === 'refus') return this.terminer(message.raison, true);
    try {
      await this.traiter(message);
    } catch (erreur) {
      this.hote.journal.warn({ err: erreur, canal: this.id, phase: this.phase }, 'canal du duo : message refusé');
      this.protocole(erreur instanceof ErreurChiffrement ? erreur.message : 'message refusé');
    }
  }

  private async traiter(message: MessageDuoClair): Promise<void> {
    if (message.t === 'chiffre') return this.recevoirChiffre(message.trame);
    if (message.t === 'appairage' && this.phase === 'appairage-attendu') return this.appairageDemande(message);
    if (message.t === 'presentation' && this.phase === 'presentation-attendue') return this.presentationRecue(message);
    if (message.t === 'accord' && this.phase === 'decision') return this.accordRecu();
    if (message.t === 'poignee' && this.phase === 'poignee-attendue') return this.repondre(message.m);
    if (message.t === 'poignee-reponse' && this.phase === 'poignee') return this.finirPoignee(message.m);
    return this.protocole('étape inattendue');
  }

  // ---- Appairage ---------------------------------------------------------------------------------------------

  // Côté visé : la preuve doit venir d'un code vivant, lié à ce demandeur et à son identité.
  private async appairageDemande(message: Appairage): Promise<void> {
    if (!this.hote.codeValide(this, message)) return this.refuserEtFermer('code faux ou expiré');
    this.distant = { identite: message.identite, nom: message.nom, utilisateur: message.utilisateur };
    const moi = await this.hote.identiteLocale();
    this.envoyerClair({
      t: 'presentation',
      identite: exporterIdentitePublique(moi.publique),
      nom: this.hote.nomLocal(),
      utilisateur: this.hote.utilisateurLocal(),
    });
    this.phase = 'decision';
    this.armer();
    this.hote.appairageRecu(this, this.distant);
  }

  private presentationRecue(message: Presentation): void {
    this.distant = { identite: message.identite, nom: message.nom, utilisateur: message.utilisateur };
    this.phase = 'decision';
    this.armer();
    this.hote.appairageRecu(this, this.distant);
  }

  private accordRecu(): void {
    this.accordDistant = true;
    if (this.decisionLocale) this.confirmer();
  }

  // Les deux côtés ont accepté les empreintes : la paire est enregistrée ; l'ouvrant ouvre la poignée.
  private confirmer(): void {
    if (!this.hote.appairageConfirme(this)) return this.refuserEtFermer('paire déjà établie');
    if (this.role === 'ouvrant') return void this.lancerPoignee();
    this.phase = 'poignee-attendue';
    this.armer();
  }

  // ---- Lien chiffré ------------------------------------------------------------------------------------------

  private async lancerPoignee(): Promise<void> {
    const cible = this.hote.identitePaire(this.membre);
    if (!cible) return this.protocole('pair inconnu : poignée impossible');
    const moi = await this.hote.identiteLocale();
    const destinataire = await importerIdentitePublique(cible);
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
      this.tunnel = new TunnelAiguilleur(canal, this.hote.journal);
    } catch (erreur) {
      this.hote.journal.warn({ err: erreur, canal: this.id }, 'poignée du duo refusée : identité non appairée');
      return this.refuserEtFermer('identité non appairée', true);
    }
    this.devenirOuvert();
  }

  private identiteAcceptee(id: IdentitePublique): boolean {
    return this.hote.identitePaire(this.membre) === exporterIdentitePublique(id);
  }

  private async finirPoignee(brut: unknown): Promise<void> {
    if (!this.attente) throw new ErreurChiffrement('poignée sans attente');
    this.tunnel = new TunnelAiguilleur(await terminerPoignee(this.attente, brut), this.hote.journal);
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

  // ---- Transport et fin --------------------------------------------------------------------------------------

  private envoyerClair(message: MessageDuoClair): void {
    this.transmettre(JSON.stringify(message));
  }

  // `charge` absente : fermeture (et non une donnée).
  private transmettre(charge: string | undefined): void {
    const message: MessageVersAiguilleur =
      charge === undefined ? { t: 'fermer', canal: this.id } : { t: 'donnees', canal: this.id, charge };
    this.hote.envoyerAiguilleur(message);
  }

  private refuserEtFermer(raison: string, refuse = false): void {
    this.envoyerClair({ t: 'refus', raison });
    this.terminer(raison, refuse, true);
  }

  private protocole(raison: string): void {
    this.hote.journal.warn({ canal: this.id, phase: this.phase, raison }, 'canal du duo fermé : protocole');
    this.fermer(raison);
  }

  private enfiler(tache: () => Promise<void>): Promise<void> {
    this.file = this.file.then(tache).catch((erreur: unknown) =>
      this.hote.journal.error({ err: erreur, canal: this.id }, 'canal du duo : traitement en échec'),
    );
    return this.file;
  }

  // `prevenir` : le pair doit savoir qu'on ferme (après un refus envoyé) ; sinon la fermeture part de l'aiguilleur.
  private terminer(raison: string, refuse: boolean, prevenir = false): void {
    if (this.phase === 'ferme') return;
    if (prevenir) this.transmettre(undefined);
    this.phase = 'ferme';
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    this.tunnel = null;
    this.attente = null;
    this.hote.canalFerme(this, raison, refuse);
  }

  // Un canal qui ne progresse pas se ferme seul ; la décision de Chris garde son propre délai.
  private armer(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
    const delai = this.delaiDe();
    if (delai !== null) this.minuterie = setTimeout(() => this.protocole('délai dépassé'), delai);
  }

  private delaiDe(): number | null {
    const d = this.hote.delais;
    if (this.phase === 'ouverture') return d.ouverture;
    if (this.phase === 'appairage-attendu' || this.phase === 'presentation-attendue') return d.message;
    if (this.phase === 'decision') return d.decision;
    if (this.phase === 'poignee-attendue' || this.phase === 'poignee') return d.poignee;
    return null;
  }
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}
