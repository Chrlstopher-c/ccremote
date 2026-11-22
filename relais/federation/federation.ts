// Responsabilité : la fédération « mes machines » du nœud — relié à l'aiguilleur, il s'appaire à ses pairs (décision de
// Chris chez le visé), ouvre un lien chiffré avec chacun, puis fait voir et piloter ses sessions. Sans aiguilleur
// configuré, rien ne démarre : le mode tunnel reste le défaut. Les données des autres nœuds restent en mémoire.
import type { Logger } from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { MessageDeAiguilleur, MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import {
  empreinteIdentite,
  exporterIdentitePublique,
  type Identite,
  importerIdentitePublique,
} from '../../commun/chiffrement/identite.ts';
import {
  type EvenementFedere,
  type MessageChiffre,
  NOMBRE_MAX_DEMANDES,
  TAILLE_MORCEAU_APPAREIL_CARACTERES,
} from '../../commun/federation.ts';
import { messagesAvecCorps, Reassemblage } from './transferts.ts';
import { DiffusionAppareil } from './appareil-diffusion.ts';
import { TerminalAppareil } from './terminal-appareil.ts';
import type { MessageSynchro } from '../../commun/synchro.ts';
import { concerneDuo, type HandlerDuoAiguilleur, type PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import { type CanalNoeud, type HoteCanal, type PresentationDistante } from './canal.ts';
import { Canaux } from './canaux.ts';
import { appairerNoeud, urlAiguilleurValide } from './aiguilleur-http.ts';
import { CacheDistant } from './distant.ts';
import { Distantes } from './distantes.ts';
import { type DemandeAppairage, DemandesAppairage } from './demandes.ts';
import { DemandesFederees, photoDemandesAppareil } from './demandes-federees.ts';
import { Echanges, type PontFederation } from './echanges.ts';
import { surDiffusionFederee } from './diffusion-federee.ts';
import type { EtatFederation, OptionsFederation } from './etat-federation.ts';
import { TerminalFedere } from './terminal-federe.ts';
import { LienAiguilleur, type MotifArret } from './lien-aiguilleur.ts';
import { type ConfigAiguilleur, type PairFederee, SecretsNoeud } from './secrets.ts';
import type { DemandeAppareil as DemandeAppareilFedere, ReponseAppareil as ReponseAppareilFedere, ServirAppareil } from './appareils.ts';
import { type MembreVu, Voisinage } from './proprietaire.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import {
  type AppairageEnCours,
  appairagesEnCours,
  chargerIdentite,
  noeudAppaire,
  type NoeudAppaire,
} from './appairages.ts';

export type { NoeudAppaire };

const DELAI_DEMANDE_MS = 10 * 60 * 1000;
const MARGE_APPAIRAGE_MS = 30_000;
const DELAI_LIEN_MIN_MS = 1_000;
const DELAI_LIEN_MAX_MS = 30_000;
const INTERVALLE_PLANIFICATION_MS = 5_000;
export type { EtatFederation, OptionsFederation };

export class Federation {
  private readonly secrets: SecretsNoeud;
  private readonly distant = new CacheDistant();
  /** Sessions des autres nœuds : vue fusionnée pour l'appli, gestes relayés. */
  readonly distantes: Distantes;
  private readonly demandes: DemandesAppairage;
  /** Demandes d'appareil vues chez les autres nœuds (photos reçues, en mémoire seulement). */
  private readonly demandesFederees = new DemandesFederees();
  private readonly echanges: Echanges;
  private readonly canaux: Canaux;
  private readonly hote: HoteCanal;
  private pairs: PairFederee[];
  private readonly refus = new Set<string>();
  private readonly voisins = new Voisinage();
  private config: ConfigAiguilleur | null;
  private duo: HandlerDuoAiguilleur | null = null;
  private lien: LienAiguilleur | null = null;
  private motifArret: MotifArret | null = null;
  private identiteEnCours: Promise<Identite> | null = null;
  private desabonner: (() => void) | null = null;
  private planificateur: ReturnType<typeof setInterval> | null = null;
  private recepteurSynchro: ((membre: string, brut: unknown) => void) | null = null;
  readonly terminaux: TerminalFedere;
  /** Flux en direct des appareils (par l'aiguilleur) et morceaux de leurs requêtes en route. */
  private readonly diffusionAppareil: DiffusionAppareil;
  private readonly terminauxAppareil: TerminalAppareil;
  private readonly transfertsAppareil = new Reassemblage();
  private readonly revoques: Set<string>;

  constructor(private readonly options: OptionsFederation) {
    this.secrets = new SecretsNoeud(options.dossierSecrets, options.journal);
    this.pairs = this.secrets.lirePairs();
    this.revoques = new Set(this.secrets.lireRevoques());
    this.diffusionAppareil = new DiffusionAppareil(options.diffusion);
    this.terminauxAppareil = new TerminalAppareil(() => this.terminaux.locauxBranches);
    this.config = this.secrets.lireAiguilleur();
    this.demandes = new DemandesAppairage(options.delaiDemandeMs ?? DELAI_DEMANDE_MS, () => Date.now());
    this.echanges = new Echanges({
      registre: options.registre,
      pont: options.pont,
      machine: options.machine,
      nom: () => this.config?.nom ?? options.machine,
      distant: this.distant,
      journal: options.journal,
      terminaux: { traiter: (c, m) => this.terminaux.traiter(c, m) },
    });
    this.hote = this.creerHote();
    this.canaux = new Canaux(this.hote, (m) => this.emettre(m));
    const { registre, journal } = options;
    this.terminaux = new TerminalFedere({ echanges: this.echanges, canaux: this.canaux, registre, journal });
    this.distantes = new Distantes({
      registre: options.registre,
      diffusion: options.diffusion,
      machine: options.machine,
      cache: this.distant,
      echanges: this.echanges,
      liaison: (membre) => this.canaux.liaisonOuverteAvec(membre),
      journal: options.journal.child({ domaine: 'distantes' }),
    });
  }

  /** Écoute les changements locaux ; démarre le lien si ce nœud est déjà relié à un aiguilleur. */
  demarrer(): void {
    this.desabonner = this.options.diffusion.ecouter((m) => this.surDiffusion(m));
    if (this.config) this.demarrerLien();
  }

  arreter(): void {
    this.desabonner?.();
    this.desabonner = null;
    if (this.planificateur) clearInterval(this.planificateur);
    this.planificateur = null;
    this.echanges.arreter();
    this.canaux.fermerTout();
    this.diffusionAppareil.fermerTout();
    this.demandes.arreter();
    this.lien?.arreter();
    this.lien = null;
    this.voisins.effacer();
  }

  /** Rejoint un aiguilleur avec un code d'appairage (une seule fois par nœud). */
  async rejoindreAiguilleur(corps: {
    url: string;
    code: string;
    nom: string;
    sansEcran?: boolean;
  }): Promise<Resultat<{ id: string }>> {
    const adresse = urlAiguilleurValide(corps.url);
    if (!adresse) return echec(400, 'adresse de l’aiguilleur invalide');
    if (this.config) return echec(409, 'nœud déjà relié à un aiguilleur');
    const identite = await this.identite();
    const cle = exporterIdentitePublique(identite.publique);
    const sansEcran = corps.sansEcran ?? false;
    const r = await appairerNoeud(adresse, { code: corps.code, nom: corps.nom, cle, sansEcran }, this.options.journal);
    if (!r.ok) return echec(r.statut, r.raison);
    try {
      this.config = { url: adresse, jeton: r.jeton, id: r.id, nom: corps.nom, proprietaire: r.proprietaire };
      this.secrets.ecrireAiguilleur(this.config);
    } catch {
      this.config = null;
      return echec(500, 'configuration de l’aiguilleur non écrite');
    }
    this.demarrerLien();
    return ok({ id: r.id });
  }

  /** Le duo par l'aiguilleur (étape 7) partage ce lien : ses canaux (préfixe `duo-`) lui sont remis. */
  brancherDuo(handler: HandlerDuoAiguilleur): void {
    this.duo = handler;
  }

  portDuo(): PortAiguilleurDuo {
    return {
      membreLocal: () => this.config?.id ?? null,
      identiteLocale: () => this.identite(),
      envoyer: (m) => this.emettre(m),
      enLigne: (membre) => this.voisins.enLigne(membre),
      relie: () => this.lien?.connecte() ?? false,
    };
  }

  /** Premier contact avec un nœud en ligne : une demande part, Chris la tranche chez lui. */
  appairer(membre: string): Resultat<{ canal: string }> {
    if (!this.lien?.connecte()) return echec(409, 'aiguilleur non relié');
    if (this.pairs.some((p) => p.id === membre)) return echec(409, 'nœud déjà apparié');
    const refus = this.voisins.refusPour(membre, this.proprietaireLocal());
    if (refus) return echec(409, refus);
    if (!this.voisins.enLigne(membre)) return echec(409, 'nœud hors ligne');
    if (this.canaux.avec(membre)) return echec(409, 'un échange est déjà en cours avec ce nœud');
    const canal = this.canaux.ouvrir(membre, 'appairage');
    this.signaler();
    return canal ? ok({ canal: canal.id }) : echec(503, 'aiguilleur indisponible');
  }

  /**
   * Décision de Chris sur une demande. Locale : tranchée ici. Vue chez un autre nœud : relayée à ce nœud, qui la
   * tranche chez lui ; si ce nœud n'est pas relié, rien ne part (409). Jamais d'acceptation automatique.
   */
  decider(id: string, accord: boolean): Resultat<null> {
    if (this.demandes.decider(id, accord)) return ok(null);
    const noeud = this.demandesFederees.noeudDe(id);
    if (!noeud) return echec(404, 'demande introuvable');
    const canal = this.canaux.liaisonOuverteAvec(noeud);
    if (!canal) return echec(409, 'nœud hors ligne');
    return canal.envoyer({ t: 'decision', id, accord }) ? ok(null) : echec(503, 'envoi impossible');
  }

  /** Révocation : le pair perd son accès (un message le lui dit s'il est en ligne) et disparaît d'ici. */
  revoquer(membre: string): Resultat<null> {
    if (!this.pairs.some((p) => p.id === membre)) return echec(404, 'nœud non apparié');
    const canal = this.canaux.avec(membre);
    if (canal?.ouvert) canal.envoyer({ t: 'revocation' });
    this.marquerRevoque(membre);
    this.oublierPair(membre);
    canal?.fermerApresEnvois();
    return ok(null);
  }

  /** Branche le service de synchronisation : chaque message synchro reçu d'un pair lui est remis. */
  brancherSynchro(recepteur: (membre: string, brut: unknown) => void): void {
    this.recepteurSynchro = recepteur;
  }

  identifiantLocal(): string | null {
    return this.config?.id ?? null;
  }

  /** Un message synchro vers un pair apparié dont le lien est ouvert ; rien ne part sinon. */
  envoyerSynchro(membre: string, message: MessageSynchro): Resultat<null> {
    if (!this.pairs.some((p) => p.id === membre)) return echec(409, 'nœud non apparié');
    const canal = this.canaux.liaisonOuverteAvec(membre);
    if (!canal) return echec(409, 'nœud hors ligne ou non relié');
    return canal.envoyer({ t: 'synchro', m: message }) ? ok(null) : echec(503, 'envoi impossible');
  }

  async etat(): Promise<EtatFederation> {
    const identite = await this.identite();
    const lien = (id: string): boolean => this.canaux.liaisonOuverteAvec(id) !== null;
    const noeuds = await Promise.all(
      this.pairs
        .filter((p) => p.genre === 'noeud')
        .map((p) => noeudAppaire(p, this.voisins.enLigne(p.id), lien(p.id))),
    );
    const config = this.config;
    return {
      aiguilleur: config
        ? {
            url: config.url,
            id: config.id,
            nom: config.nom,
            proprietaire: config.proprietaire ?? null,
            relie: this.lien?.connecte() ?? false,
            motif: this.motifArret,
          }
        : null,
      empreinteLocale: await empreinteIdentite(identite.publique),
      membres: this.voisins.liste(this.proprietaireLocal()),
      noeuds,
      demandes: [...this.demandes.lister(), ...this.demandesFederees.lister()],
      appairages: await appairagesEnCours(this.canaux.actifs()),
    };
  }

  // ---- Lien avec l'aiguilleur ---------------------------------------------------------------------------------

  private demarrerLien(): void {
    const config = this.config;
    if (!config) return;
    this.lien?.arreter();
    this.motifArret = null;
    this.lien = new LienAiguilleur(
      {
        url: config.url,
        jeton: config.jeton,
        delaiMinMs: DELAI_LIEN_MIN_MS,
        delaiMaxMs: DELAI_LIEN_MAX_MS,
        journal: this.options.journal.child({ domaine: 'aiguilleur' }),
      },
      {
        surMessage: (m) => this.surMessage(m),
        surConnexion: (connecte) => this.surConnexion(connecte),
        surArret: (motif) => this.surArret(motif),
      },
    );
    this.lien.demarrer();
    this.planificateur ??= setInterval(
      () => this.planifier(),
      this.options.intervallePlanificationMs ?? INTERVALLE_PLANIFICATION_MS,
    );
  }

  private emettre(message: MessageVersAiguilleur): boolean {
    if (message.t === 'donnees') this.options.observer?.('envoi', message.charge);
    return this.lien?.envoyer(message) ?? false;
  }

  private surMessage(message: MessageDeAiguilleur): void {
    if (message.t === 'presence') return this.surPresence(message);
    if (message.t === 'ouvrir' && message.proprietaire) this.voisins.memoriserOuvrant(message.de, message.proprietaire);
    if (message.t === 'donnees') this.options.observer?.('reception', message.charge);
    if (concerneDuo(message)) return this.duo?.surMessage(message);
    this.canaux.surMessage(message);
  }

  private surPresence(message: Extract<MessageDeAiguilleur, { t: 'presence' }>): void {
    const change = this.voisins.remplacer(message.membres);
    this.apprendreProprietaire(message.proprietaire);
    this.planifier();
    if (change) this.signaler();
  }

  /** Le propriétaire du nœud vient de l'appairage ; à défaut, de la présence, et il est alors gardé. */
  private apprendreProprietaire(proprietaire: string | undefined): void {
    const config = this.config;
    if (!config || !proprietaire || config.proprietaire === proprietaire) return;
    if (config.proprietaire) {
      return this.options.journal.error('propriétaire différent de celui de la présence : ignoré');
    }
    this.config = { ...config, proprietaire };
    try {
      this.secrets.ecrireAiguilleur(this.config);
    } catch {
      this.options.journal.error('propriétaire du nœud non sauvegardé');
    }
  }

  private proprietaireLocal(): string | null {
    return this.config?.proprietaire ?? null;
  }

  // Le lien part du nœud au plus petit identifiant : un seul canal par paire, sans collision à l'ouverture.
  // Seuls nos nœuds, en ligne, sont reliés : un pair qui n'est plus des nôtres ne reçoit plus de lien.
  private planifier(): void {
    const moi = this.config?.id;
    if (!moi || !this.lien?.connecte()) return;
    const proprio = this.proprietaireLocal();
    for (const p of this.pairs) {
      if (p.genre === 'appareil') continue;
      if (p.id <= moi || this.refus.has(p.id) || !this.voisins.joignable(p.id, proprio)) continue;
      if (!this.canaux.avec(p.id)) this.canaux.ouvrir(p.id, 'lien');
    }
  }

  private surConnexion(connecte: boolean): void {
    this.options.journal.info({ connecte }, 'lien vers l’aiguilleur');
    this.duo?.surConnexion(connecte);
    this.signaler();
    if (connecte) return;
    for (const canal of this.canaux.actifs()) canal.surFermetureDistante();
    this.voisins.effacer();
    for (const p of this.pairs) this.distant.enLigne(p.id, false);
  }

  private surArret(motif: MotifArret): void {
    this.motifArret = motif;
    this.signaler();
    this.options.journal.warn({ motif }, 'lien vers l’aiguilleur arrêté : ce nœud n’est plus relié');
  }

  // ---- Hôte des canaux ------------------------------------------------------------------------------------------

  private creerHote(): HoteCanal {
    return {
      journal: this.options.journal,
      delaiAppairageMs: (this.options.delaiDemandeMs ?? DELAI_DEMANDE_MS) + MARGE_APPAIRAGE_MS,
      identiteLocale: () => this.identite(),
      nomLocal: () => this.config?.nom ?? this.options.machine,
      genreLocal: () => 'noeud',
      pairDe: (membre) => this.pairs.find((p) => p.id === membre) ?? null,
      envoyerAiguilleur: (m) => this.emettre(m),
      presentationRecue: (canal, p) => void this.presentationRecue(canal, p),
      appairageAccepte: (canal, p) => this.appairageAccepte(canal.membre, p),
      appairageRefuse: (canal, raison) => {
        this.options.journal.warn({ membre: canal.membre, raison }, 'appairage refusé');
        this.signaler();
      },
      liaisonOuverte: (canal) => (this.liaisonOuverte(canal), this.signaler()),
      liaisonRefusee: (canal, raison) => this.liaisonRefusee(canal, raison),
      messageRecu: (canal, m) => void this.messageRecu(canal, m),
      canalFerme: (canal) => (this.canalFerme(canal), this.signaler()),
      motifRefusInconnu: (membre) => (this.revoques.has(membre) ? 'révoqué' : 'identité non appairée'),
    };
  }

  // Côté visé : la demande part avec les deux empreintes ; Chris accepte ou refuse, l'expiration vaut refus.
  private async presentationRecue(canal: CanalNoeud, presentation: PresentationDistante): Promise<void> {
    const refus =
      presentation.genre === 'appareil'
        ? this.voisins.refusAppareil(canal.membre, this.proprietaireLocal())
        : this.voisins.refusPour(canal.membre, this.proprietaireLocal());
    if (refus) {
      this.options.journal.warn({ membre: canal.membre, raison: refus }, 'présentation refusée : pas un de nos nœuds');
      return canal.decider(false);
    }
    try {
      const empreinte = await empreinteIdentite(await importerIdentitePublique(presentation.identite));
      const locale = await empreinteIdentite((await this.identite()).publique);
      if (!canal.actif) return;
      if (this.demandes.lister().length >= NOMBRE_MAX_DEMANDES) return canal.decider(false);
      this.demandes.ajouter(
        {
          membre: canal.membre,
          nom: presentation.nom,
          empreinte,
          empreinteLocale: locale,
          genre: presentation.genre ?? 'noeud',
        },
        (accord) => (this.decisionAppairage(canal, presentation, accord), this.signaler(), this.diffuserDemandes()),
      );
      this.options.notifier?.(
        'Demande d’appairage',
        `${presentation.nom} demande à rejoindre tes machines : compare les empreintes dans Paramètres › Réseau.`,
      );
      this.signaler();
      this.diffuserDemandes();
    } catch (erreur) {
      this.options.journal.error({ err: erreur, membre: canal.membre }, 'présentation d’un nœud illisible');
      canal.fermer();
    }
  }

  private decisionAppairage(canal: CanalNoeud, presentation: PresentationDistante, accord: boolean): void {
    if (accord) this.enregistrerPair(canal.membre, presentation);
    canal.decider(accord);
  }

  private appairageAccepte(membre: string, presentation: PresentationDistante): void {
    this.enregistrerPair(membre, presentation);
  }

  private liaisonOuverte(canal: CanalNoeud): void {
    this.refus.delete(canal.membre);
    if (this.estAppareil(canal.membre)) return;
    this.distant.enLigne(canal.membre, true);
    canal.envoyer(this.echanges.instantane());
    this.envoyerDemandesA(canal);
  }

  private liaisonRefusee(canal: CanalNoeud, raison: string): void {
    this.refus.add(canal.membre);
    this.options.journal.warn({ membre: canal.membre, raison }, 'lien refusé par le nœud : appairage à refaire');
  }

  private async messageRecu(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    if (this.estAppareil(canal.membre)) return this.messageAppareil(canal, message);
    if (message.t === 'api' || message.t === 'api_reponse') return canal.fermer();
    if (message.t === 'demandes' || message.t === 'decision') return this.messageDemandes(canal, message);
    if (message.t === 'revocation') {
      this.oublierPair(canal.membre);
      // Un lien rouvert entre-temps (planification) vers ce pair ne doit pas survivre à la révocation.
      for (const autre of this.canaux.actifs()) if (autre.membre === canal.membre) autre.fermer();
      return;
    }
    if (message.t === 'synchro') return this.recepteurSynchro?.(canal.membre, message.m);
    await this.echanges.traiter(canal, message);
  }

  /**
   * Un appareil n'échange que l'API clients, le flux en direct et le terminal de ce nœud ; tout autre message ferme
   * son canal.
   */
  private async messageAppareil(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    switch (message.t) {
      case 'api':
        return this.requeteAppareil(canal, message);
      case 'morceau':
        this.transfertsAppareil.recevoir(canal.membre, message);
        return undefined;
      case 'diffusion_ouvrir':
        return this.diffusionAppareil.ouvrir(canal);
      case 'diffusion_fermer':
        return this.diffusionAppareil.fermer(canal);
      case 'terminal_poste':
        return this.terminauxAppareil.ouvrir(canal, message);
      case 'terminal_entree':
      case 'terminal_taille':
      case 'terminal_fermer':
        if (this.terminauxAppareil.recu(canal, message)) return undefined;
        return this.terminaux.traiter(canal, message);
      case 'terminal_ouvrir':
        return this.terminaux.traiter(canal, message);
      default:
        return canal.fermer();
    }
  }

  // Une requête de l'API : son corps (en morceaux si besoin) est réuni, rejoué, et la réponse repart de même.
  private async requeteAppareil(canal: CanalNoeud, m: Extract<MessageChiffre, { t: 'api' }>): Promise<void> {
    const corps = this.corpsAppareil(canal.membre, m);
    const reponse =
      corps === null
        ? { statut: 400, corps: JSON.stringify({ erreur: 'transfert interrompu' }) }
        : await this.servirAppareil({ methode: m.methode, chemin: m.chemin, corps, codage: m.codage, type: m.type });
    for (const message of messagesAvecCorps(m.ref, reponse.corps, (texte, morceaux) => ({
      t: 'api_reponse',
      ref: m.ref,
      statut: reponse.statut,
      corps: texte,
      ...(reponse.codage ? { codage: reponse.codage } : {}),
      ...(reponse.type ? { type: reponse.type } : {}),
      ...(morceaux !== undefined ? { morceaux } : {}),
    }), TAILLE_MORCEAU_APPAREIL_CARACTERES)) {
      canal.envoyer(message);
    }
  }

  // Le corps d'une requête : tel quel, ou réuni depuis ses morceaux ; null si le transfert est cassé.
  private corpsAppareil(membre: string, m: Extract<MessageChiffre, { t: 'api' }>): string | undefined | null {
    if (m.morceaux === undefined) return m.corps;
    return this.transfertsAppareil.assembler(membre, m.ref, m.morceaux);
  }

  private async servirAppareil(demande: DemandeAppareilFedere): Promise<ReponseAppareilFedere> {
    if (!this.options.servirAppareil) {
      return { statut: 503, corps: JSON.stringify({ erreur: 'API appareil non branchée' }) };
    }
    return this.options.servirAppareil(demande);
  }

  // ---- Demandes d'appareil entre nœuds appariés ------------------------------------------------------------------

  private estNoeud(membre: string): boolean {
    return this.pairs.some((p) => p.id === membre && p.genre === 'noeud');
  }

  /** La photo des demandes d'appareil part à un nœud pair relié, jamais à un appareil. */
  private envoyerDemandesA(canal: CanalNoeud): void {
    if (!this.estNoeud(canal.membre)) return;
    canal.envoyer({ t: 'demandes', liste: photoDemandesAppareil(this.demandes.lister()) });
  }

  /** À chaque changement des demandes locales, la photo repart à tous les nœuds pairs reliés. */
  private diffuserDemandes(): void {
    for (const canal of this.canaux.ouverts()) this.envoyerDemandesA(canal);
  }

  private messageDemandes(canal: CanalNoeud, message: Extract<MessageChiffre, { t: 'demandes' | 'decision' }>): void {
    if (!this.estNoeud(canal.membre)) return canal.fermer();
    if (message.t === 'demandes') {
      this.demandesFederees.recevoir(canal.membre, message.liste);
      return this.signaler();
    }
    this.decisionDistante(canal.membre, message.id, message.accord);
  }

  // Une décision relayée par un nœud pair ne tranche qu'une demande d'appareil existante ici ; le reste est ignoré.
  private decisionDistante(noeud: string, id: string, accord: boolean): void {
    const existe = this.demandes.lister().some((d) => d.id === id && d.genre === 'appareil');
    if (!existe) {
      const motif = 'décision distante ignorée : demande inconnue';
      return this.options.journal.warn({ membre: noeud, demande: id }, motif);
    }
    this.demandes.decider(id, accord);
  }

  // Un pair révoqué garde son motif de refus, même après un redémarrage du nœud.
  private marquerRevoque(membre: string): void {
    this.revoques.add(membre);
    this.sauverRevoques();
  }

  private sauverRevoques(): void {
    try {
      this.secrets.ecrireRevoques([...this.revoques]);
    } catch {
      this.options.journal.error('révocations de la fédération non sauvegardées');
    }
  }

  private estAppareil(membre: string): boolean {
    return this.pairs.some((p) => p.id === membre && p.genre === 'appareil');
  }

  private canalFerme(canal: CanalNoeud): void {
    this.terminaux.fermerPour(canal.membre);
    this.terminauxAppareil.fermerPour(canal.membre);
    this.diffusionAppareil.fermer(canal);
    this.transfertsAppareil.oublier(canal.membre);
    this.canaux.retirer(canal);
    this.demandes.retirerPour(canal.membre);
    this.diffuserDemandes();
    if (this.canaux.liaisonOuverteAvec(canal.membre)) return;
    this.demandesFederees.oublier(canal.membre);
    this.distant.enLigne(canal.membre, false);
    this.echanges.oublier(canal.membre);
  }

  // ---- Pairs, identité, diffusion locale -----------------------------------------------------------------------

  private enregistrerPair(membre: string, presentation: PresentationDistante): void {
    const pair: PairFederee = {
      id: membre,
      nom: presentation.nom,
      identite: presentation.identite,
      creeLe: new Date().toISOString(),
      genre: presentation.genre ?? 'noeud',
    };
    this.pairs = [...this.pairs.filter((p) => p.id !== membre), pair];
    this.refus.delete(membre);
    if (this.revoques.delete(membre)) this.sauverRevoques();
    this.distant.connaitre(membre, pair.nom);
    this.sauverPairs();
  }

  private oublierPair(membre: string): void {
    this.terminaux.fermerPour(membre);
    this.pairs = this.pairs.filter((p) => p.id !== membre);
    this.sauverPairs();
    this.distant.retirer(membre);
    this.demandes.retirerPour(membre);
    this.demandesFederees.oublier(membre);
    this.echanges.oublier(membre);
    this.refus.delete(membre);
  }

  /** L'état de la fédération a changé : l'appli relit `GET /api/federation`. */
  private signaler(): void {
    this.options.diffusion.diffuser({ type: 'federation_modifiee' });
  }

  private sauverPairs(): void {
    this.signaler();
    try {
      this.secrets.ecrirePairs(this.pairs);
    } catch {
      this.options.journal.error('pairs de la fédération non sauvegardés');
    }
  }

  private identite(): Promise<Identite> {
    this.identiteEnCours ??= chargerIdentite(this.secrets);
    return this.identiteEnCours;
  }
  private surDiffusion(m: MessageClient): void {
    surDiffusionFederee(m, {
      distantes: this.distantes,
      echanges: this.echanges,
      liensPairs: () => this.canaux.ouverts().filter((c) => !this.estAppareil(c.membre)),
    });
  }

}
