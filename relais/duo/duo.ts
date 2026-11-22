// Responsabilité : le mode duo d'un relais — appairage, lien permanent avec le pair, partages, présence. Ce module
// orchestre le lien, la synchro et la paire stockée ; le registre et la diffusion restent ceux du relais.
import type { Logger } from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import {
  type ChoixDossier,
  type CorpsOuvertureDuo,
  type CorpsPartage,
  DUREE_DEMANDE_MS,
  type DemandeDuo,
  type Droits,
  type DossierPair,
  type EntreeJournal,
  type EtatDuo,
  type MessageLien,
  type UsagePartage,
} from '../../commun/duo.ts';
import { EchangesAvances } from './echanges-avances.ts';
import { Attentes } from './attentes.ts';
import type { PieceJointe } from '../../commun/presentation.ts';
import type { Contexte, Engagement } from './contexte.ts';
import { Demandes } from './demandes.ts';
import { DroitsDuo } from './droits.ts';
import { ecrireAPair as envoyerAuPair, interrompreAPair as interrompreAuPair } from './ecriture.ts';
import { traiterEchange } from './echanges.ts';
import { JournalDuo } from './journal.ts';
import { choisirEcoute, type InterfacesReseau } from './ecoute.ts';
import { IdentiteDuo } from './identite.ts';
import { networkInterfaces } from 'node:os';
import { dossiersDuPair, ouvrirChezPair } from './sessions-pair.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { usageDuPair } from './usage.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import { CodesAppairage, RAISON_CODE } from './codes.ts';
import { appairerAupres, DELAI_RECONNEXION_MAX_MS, LienAppelant, RAISON_INJOIGNABLE } from './lien-appelant.ts';
import type { Canal } from './lien-commun.ts';
import { ouvrirEcouteDuo, type ResultatAppairage, type ServeurDuo } from './lien-serveur.ts';
import { type Paire, PaireStockee } from './paire-stockee.ts';
import { PartagesDuo } from './partages.ts';
import { cleNeuve, nonce } from './preuve.ts';
import { VALIDE_IDENTIFIANT } from '../../commun/aiguilleur.ts';
import type { PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import { LiaisonAiguilleur } from './liaison-aiguilleur.ts';
import { Synchro } from './synchro.ts';

export type { Resultat } from './resultat.ts';

import type { OptionsDuo } from './options-duo.ts';


export class Duo {
  readonly utilisateur: string;
  private readonly registre: Registre;
  private readonly diffusion: Diffusion;
  private readonly horloge: () => number;
  private readonly codes: CodesAppairage;
  private readonly paires: PaireStockee;
  private readonly partages: PartagesDuo;
  private readonly synchro: Synchro;
  private readonly presences = new Set<string>();
  private readonly delaiMin: number;
  private readonly ecoute: { readonly hote: string; readonly port: number };
  private readonly ecouteDirecte: boolean;
  private readonly journal: Logger;
  private serveur: ServeurDuo | null = null;
  private aiguilleur: LiaisonAiguilleur | null = null;
  private canal: Canal | null = null;
  private appelant: LienAppelant | null = null;
  private refuse = false;
  private desabonner: (() => void) | null = null;
  private readonly identite: IdentiteDuo;
  private readonly stockDroits: DroitsDuo;
  private readonly historique: JournalDuo;
  private readonly demandes: Demandes;
  private readonly attentes = new Attentes();
  private readonly contexte: Contexte;
  /** Étape 3 : passer la main, modules en commun, alertes de conflit, fil d'activité. */
  readonly avances: EchangesAvances;

  constructor(options: OptionsDuo) {
    this.utilisateur = options.utilisateur;
    this.registre = options.registre;
    this.diffusion = options.diffusion;
    this.horloge = options.maintenant ?? Date.now;
    this.delaiMin = options.delaiReconnexionMs ?? 1_000;
    this.codes = new CodesAppairage(this.horloge);
    this.paires = new PaireStockee(options.dossierSecrets, options.journal);
    this.partages = new PartagesDuo(options.base);
    this.identite = new IdentiteDuo(options.base, options.utilisateur);
    this.synchro = new Synchro(options.registre, options.diffusion, this.partages, options.journal, () =>
      this.identite.nomPair(), () => this.stockDroits.lire(),
    );
    this.ecoute = { hote: options.ecoute ?? choisirEcoute(networkInterfaces()), port: options.port };
    this.ecouteDirecte = options.ecouteDirecte !== false;
    this.journal = options.journal;
    this.stockDroits = new DroitsDuo(options.base, options.journal);
    this.historique = new JournalDuo(options.base, options.journal);
    this.demandes = new Demandes({
      diffusion: options.diffusion,
      horloge: this.horloge,
      delaiMs: options.delaiDemandeMs ?? DUREE_DEMANDE_MS,
    });
    this.contexte = this.construireContexte(options);
    this.avances = this.creerAvances(options);
  }

  brancherAiguilleur(port: PortAiguilleurDuo): LiaisonAiguilleur {
    this.aiguilleur = new LiaisonAiguilleur({ port, paires: this.paires, codes: this.codes, pont: this,
      utilisateur: this.utilisateur, nomLocal: () => this.identite.nomLocal(), journal: this.journal,
      maintenant: this.horloge });
    this.aiguilleur.demarrer();
    return this.aiguilleur;
  }
  confirmerAppairage(accord: boolean): Resultat<null> {
    return this.aiguilleur?.decider(accord) ?? echec(409, 'nœud non relié à un aiguilleur');
  }

  /** Ouvre le port d'écoute du lien et reprend le lien sortant si une paire existe. */
  demarrer(): void {
    this.desabonner = this.diffusion.ecouter((m) => this.surDiffusion(m));
    try {
      if (this.ecouteDirecte) this.serveur = ouvrirEcouteDuo(this.ecoute.hote, this.ecoute.port, this);
    } catch (erreur) {
      // Port pris ou adresse absente : le relais tourne sans le mode duo plutôt que de tomber.
      this.journal.error({ err: erreur, port: this.ecoute.port }, 'lien duo non ouvert');
    }
    const paire = this.paires.lire();
    if (paire) this.lancerAppelant(paire);
  }

  arreter(): void {
    this.demandes.arreter();
    this.attentes.annuler();
    this.desabonner?.();
    this.desabonner = null;
    this.appelant?.arreter();
    this.appelant = null;
    this.canal?.fermer();
    this.canal = null;
    this.serveur?.stop(true);
    this.serveur = null;
    this.aiguilleur?.arreter();
  }

  get portEcoute(): number {
    return this.serveur?.port ?? this.ecoute.port;
  }

  etat(): EtatDuo {
    const paire = this.paires.lire();
    return {
      utilisateur: this.utilisateur,
      nom: this.identite.nomLocal(),
      ecoute: this.adresseEcoute(),
      pair: paire
        ? { utilisateur: paire.utilisateur, nom: this.identite.nomPair() ?? paire.utilisateur, adresse: paire.adresse }
        : null,
      etat: !paire ? 'absent' : this.canal ? 'connecte' : this.refuse ? 'refuse' : 'hors_ligne',
      partages: this.partages.lister(),
      presences: [...this.presences],
      ...this.aiguilleur?.etat(),
    };
  }

  codeAppairage(): Resultat<{ code: string; expireLe: string; port: number; membre: string | null }> {
    if (this.paires.lire()) return echec(409, 'déjà appairé : révoquez la paire avant');
    return ok({ ...this.codes.creer(), port: this.portEcoute, adresse: this.adresseEcoute(),
      membre: this.aiguilleur?.membre() ?? null });
  }

  async rejoindre(adresse: string, code: string): Promise<Resultat<EtatDuo>> {
    if (this.paires.lire()) return echec(409, 'déjà appairé : révoquez la paire avant');
    if (VALIDE_IDENTIFIANT.test(adresse)) {
      const r = await this.aiguilleur?.demanderAppairage(adresse, code);
      return !r ? echec(409, 'nœud non relié à un aiguilleur') : r.ok ? ok(this.etat()) : r;
    }
    if (!this.ecouteDirecte) return echec(409, 'lien direct réservé au premier ami');
    const r = await appairerAupres(adresse, code, this.utilisateur);
    if (!r.ok) return echec(r.raison === RAISON_INJOIGNABLE ? 502 : 403, r.raison);
    const paire: Paire = { id: r.paire, cle: r.cle, utilisateur: r.utilisateur, adresse, creeLe: this.maintenant() };
    this.paires.ecrire(paire);
    this.refuse = false;
    this.lancerAppelant(paire);
    this.notifier();
    return ok(this.etat());
  }

  /** Révocation des deux côtés : le pair l'apprend par le lien, ses sessions reçues disparaissent. */
  revoquer(): EtatDuo {
    this.aiguilleur?.annuler();
    const canal = this.dissoudre();
    canal?.envoyer({ type: 'revocation' });
    canal?.fermer();
    this.notifier();
    return this.etat();
  }

  partager(corps: CorpsPartage): Resultat<EtatDuo> {
    if (!this.paires.lire()) return echec(409, 'aucun pair appairé');
    this.partages.ajouter(corps.cible, corps.genre, corps.niveau, this.maintenant());
    this.envoyerInstantane();
    return ok(this.etat());
  }

  retirerPartage(cible: string): Resultat<EtatDuo> {
    if (this.partages.retirer(cible) === 0) return echec(404, 'partage introuvable');
    this.envoyerInstantane();
    return ok(this.etat());
  }

  /** « Je regarde cette session » : signalé au pair si la session est une des siennes, partagée avec moi. */
  signalerPresence(session: string, present: boolean): Resultat<null> {
    if (!this.canal) return echec(409, 'pair non connecté');
    if (!this.registre.session(session)?.duo) return echec(404, 'session du pair introuvable');
    this.canal.envoyer({ type: 'duo_presence', session, present });
    return ok(null);
  }

  /** Coupure réseau simulée : le lien tombe et se rétablit par son recul. */
  couperLien(): void {
    this.appelant?.couper();
    this.canal?.fermer();
  }

  // ---- Étape 2 : droits, demandes, journal, échanges à deux ----------------------------------------------------

  droitsAccordes(): Droits {
    return this.stockDroits.lire();
  }

  majDroits(droits: Droits): Droits {
    const enregistres = this.stockDroits.ecrire(droits);
    this.avances.synchroniser();
    this.envoyerInstantane();
    return enregistres;
  }

  listerDemandes(): DemandeDuo[] {
    return this.demandes.lister();
  }

  decider(id: string, accord: boolean, choix?: ChoixDossier): boolean {
    return this.demandes.decider(id, accord, choix);
  }

  majNom(nom: string): EtatDuo {
    this.identite.ecrireNomLocal(nom);
    this.envoyerIdentite();
    this.notifier();
    return this.etat();
  }

  journalDuo(): EntreeJournal[] {
    return this.historique.lister();
  }

  ecrireAPair(
    session: string,
    texte: string,
    pieces: readonly PieceJointe[],
    relayeDe?: { readonly session: string; readonly titre: string },
  ): Promise<Resultat<string | null>> {
    return envoyerAuPair(this.contexte, session, texte, pieces, relayeDe);
  }

  interrompreAPair(session: string): Promise<Resultat<string | null>> {
    return interrompreAuPair(this.contexte, session);
  }

  ouvrirChezPair(demande: CorpsOuvertureDuo): Promise<Resultat<Engagement>> {
    return ouvrirChezPair(this.contexte, demande);
  }

  dossiersDuPair(): Promise<Resultat<DossierPair[]>> {
    return dossiersDuPair(this.contexte);
  }

  usageDuPair(): Promise<Resultat<UsagePartage | null>> {
    return usageDuPair(this.contexte);
  }

  // ---- Pont vers le lien entrant et sortant -----------------------------------------------------------------

  appairer(code: string, utilisateurDistant: string): ResultatAppairage {
    if (this.paires.lire()) return { ok: false, raison: 'déjà appairé' };
    const verdict = this.codes.consommer(code);
    if (verdict !== 'ok') return { ok: false, raison: RAISON_CODE[verdict] };
    const id = nonce();
    const cle = cleNeuve();
    this.paires.ecrire({ id, cle, utilisateur: utilisateurDistant, adresse: null, creeLe: this.maintenant() });
    this.notifier();
    return { ok: true, paire: id, cle };
  }

  cleDe(paire: string): string | null {
    const p = this.paires.lire();
    return p?.id === paire ? p.cle : null;
  }

  liaison(canal: Canal): void {
    if (this.canal && this.canal !== canal) this.canal.fermer();
    this.canal = canal;
    this.refuse = false;
    canal.envoyer(this.messageIdentite());
    canal.envoyer(this.synchro.instantane());
    this.avances.liaison();
    this.notifier();
  }

  fermee(canal: Canal): void {
    if (this.canal !== canal) return;
    this.canal = null;
    this.attentes.annuler();
    this.presences.clear();
    this.avances.fermee();
    this.notifier();
  }

  refus(raison: string): void {
    this.journal.warn({ raison }, 'lien du pair refusé');
    this.refuse = true;
    this.notifier();
  }

  recevoir(paire: string, m: MessageLien): void {
    const p = this.paires.lire();
    if (!p || p.id !== paire) return;
    this.traiter(p.utilisateur, m);
  }

  // ---- Privé ------------------------------------------------------------------------------------------------

  private traiter(nom: string, m: MessageLien): void {
    switch (m.type) {
      case 'partage':
        for (const id of this.synchro.appliquerInstantane(nom, m.sessions)) {
          this.canal?.envoyer({ type: 'historique_demande', sessionId: id });
        }
        return;
      case 'fiche':
        return this.synchro.appliquerFiche(nom, m);
      case 'evenement':
        return this.synchro.appliquerEvenement(nom, m.sessionId, m.ts, m.evt);
      case 'historique_demande': {
        const relecture = this.synchro.relecture(m.sessionId);
        if (relecture) this.canal?.envoyer(relecture);
        return;
      }
      case 'historique':
        return this.synchro.appliquerRelecture(nom, m.sessionId, m.evenements);
      case 'duo_presence':
        return this.presenceRecue(m.session, m.present);
      case 'identite':
        this.identite.ecrireNomPair(m.nom);
        this.synchro.rafraichirNom(nom);
        this.notifier();
        return;
      case 'revocation': {
        const canal = this.dissoudre();
        canal?.fermer();
        this.notifier();
        return;
      }
      default:
        if (!traiterEchange(this.contexte, this.identite.nomPair() ?? nom, m)) this.avances.traiter(nom, m);
        return;
    }
  }

  private presenceRecue(session: string, present: boolean): void {
    if (!this.synchro.partagee(session)) return;
    if (present) this.presences.add(session);
    else this.presences.delete(session);
    this.diffusion.diffuser({ type: 'duo_presence', session, present });
    this.notifier();
  }

  // Efface la paire et ses partages ; rend le lien courant (à fermer par l'appelant), sans rien envoyer.
  private dissoudre(): Canal | null {
    const paire = this.paires.lire();
    this.appelant?.arreter();
    this.appelant = null;
    const canal = this.canal;
    this.canal = null;
    this.paires.effacer();
    this.partages.vider();
    this.identite.ecrireNomPair(null);
    this.attentes.annuler();
    this.presences.clear();
    this.refuse = false;
    if (paire) {
      this.synchro.retirerPair(paire.utilisateur);
      this.avances.dissoudre(paire.utilisateur);
    }
    return canal;
  }

  private lancerAppelant(paire: Paire): void {
    if (!paire.adresse) return;
    this.appelant?.arreter();
    this.appelant = new LienAppelant(paire.adresse, paire.id, this, {
      min: this.delaiMin,
      max: DELAI_RECONNEXION_MAX_MS,
    });
    this.appelant.demarrer();
  }

  private surDiffusion(m: MessageClient): void {
    if (m.type === 'modules_modifies') this.avances.synchroniser();
    if (m.type === 'evenement') this.avances.observer(m.evenement.sessionId, m.evenement.evt);
    if (!this.canal) return;
    const sortant = this.synchro.versLien(m);
    if (sortant) this.canal.envoyer(sortant);
  }

  private creerAvances(options: OptionsDuo): EchangesAvances {
    return new EchangesAvances({
      base: options.base,
      registre: options.registre,
      postes: options.postes,
      diffusion: options.diffusion,
      partages: this.partages,
      demandes: this.demandes,
      historique: this.historique,
      droits: this.stockDroits,
      attentes: this.attentes,
      contexte: this.contexte,
      horloge: this.horloge,
      envoyer: (m) => this.envoyerLien(m),
      maintenant: () => this.maintenant(),
      nomLocal: () => this.identite.nomLocal(),
      nomPair: () => this.identite.nomPair() ?? 'le pair',
      log: options.journal,
    });
  }

  private construireContexte(options: OptionsDuo): Contexte {
    return {
      nomLocal: () => this.identite.nomLocal(),
      registre: this.registre,
      partages: this.partages,
      droits: this.stockDroits,
      demandes: this.demandes,
      historique: this.historique,
      sessions: options.sessions,
      attentes: this.attentes,
      log: options.journal,
      delaiDemandeMs: options.delaiDemandeMs ?? DUREE_DEMANDE_MS,
      maintenant: () => this.maintenant(),
      envoyer: (m) => this.envoyerLien(m),
      connecte: () => this.canal !== null,
      nomPair: () => this.identite.nomPair() ?? 'le pair',
      partagerOuverte: (session) => this.partagerOuverte(session),
      fil: (session, evt) => {
        const evenement = this.registre.ajouterEvenement(session, this.maintenant(), evt);
        this.diffusion.diffuser({ type: 'evenement', evenement });
      },
      diffuser: (m) => this.diffusion.diffuser(m),
    };
  }

  private messageIdentite(): MessageLien {
    return { type: 'identite', utilisateur: this.utilisateur, nom: this.identite.nomLocal() };
  }

  private envoyerIdentite(): void {
    this.canal?.envoyer(this.messageIdentite());
  }

  private adresseEcoute(): string {
    return `${this.ecoute.hote}:${this.portEcoute}`;
  }

  private envoyerLien(m: MessageLien): boolean {
    if (!this.canal) return false;
    this.canal.envoyer(m);
    return true;
  }

  // Une session ouverte pour le pair : partagée en écriture avec lui, et envoyée tout de suite.
  private partagerOuverte(session: string): void {
    this.partages.ajouter(session, 'session', 'ecriture', this.maintenant());
    this.envoyerInstantane();
  }

  private envoyerInstantane(): void {
    this.canal?.envoyer(this.synchro.instantane());
    this.notifier();
  }

  notifier(): void {
    this.diffusion.diffuser({ type: 'duo_modifie' });
  }

  private maintenant(): string {
    return new Date(this.horloge()).toISOString();
  }
}

