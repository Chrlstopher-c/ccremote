// Responsabilité : la fédération « mes machines » du nœud — relié à l'aiguilleur, il s'appaire à ses pairs
// (décision de Chris chez le visé), ouvre un lien chiffré avec chacun, puis fait voir et piloter ses sessions. Sans
// aiguilleur configuré, rien ne démarre : le mode tunnel reste le défaut. Ce nœud assemble les modules `*-noeud.ts`
// du dossier.
import type { MessageClient } from '../../commun/api-clients.ts';
import { exporterIdentitePublique, type Identite } from '../../commun/chiffrement/identite.ts';
import { type MessageChiffre, type OrdreSigne } from '../../commun/federation.ts';
import type { MessageSynchro } from '../../commun/synchro.ts';
import { type HandlerDuoAiguilleur, type PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import { ChefAppareil } from './chef-appareil.ts';
import { type HoteCanal } from './canal.ts';
import { Canaux } from './canaux.ts';
import { appairerNoeud, urlAiguilleurValide } from './aiguilleur-http.ts';
import { CacheDistant } from './distant.ts';
import { Distantes } from './distantes.ts';
import { DemandesAppairage } from './demandes.ts';
import { noeudsAnnonces, type NoeudAnnonce } from './admissions.ts';
import { Echanges } from './echanges.ts';
import { CharteNoeud } from './charte-noeud.ts';
import { surDiffusionFederee } from './diffusion-federee.ts';
import { NoeudInvites } from '../invites/noeud-invites.ts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type EtatFederation, type MachineReseau, type OptionsFederation } from './etat-federation.ts';
import type { ActionMachine } from './actions-noeud.ts';
import { creerMachinesNoeud, type MachinesNoeud } from './machines-noeud.ts';
import { TerminalFedere } from './terminal-federe.ts';
import type { TunnelSshConfig } from './tunnel-ssh.ts';
import { type ConfigAiguilleur, type PairFederee, SecretsNoeud } from './secrets.ts';
import { Voisinage } from './proprietaire.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { chargerIdentite, type NoeudAppaire } from './appairages.ts';
import { LiensNoeud } from './liens-noeud.ts';
import { AdmissionsNoeud } from './admissions-noeud.ts';
import { AppareilsNoeud } from './appareils-noeud.ts';
import { AppairageNoeud } from './appairage-noeud.ts';
import { MachinesDuReseau } from './machines-du-reseau.ts';
import type { PortNoeud } from './noeud-port.ts';
import { HoteNoeud } from './hote-noeud.ts';
import { etatFederation } from './vue-federation.ts';

export type { NoeudAppaire };

const DELAI_DEMANDE_MS = 10 * 60 * 1000;
const MARGE_APPAIRAGE_MS = 30_000;
export type { EtatFederation, OptionsFederation };

export class Federation {
  private readonly secrets: SecretsNoeud;
  private readonly distant = new CacheDistant();
  /** Sessions des autres nœuds : vue fusionnée pour l'appli, gestes relayés. */
  readonly distantes: Distantes;
  private readonly demandes: DemandesAppairage;
  private readonly echanges: Echanges;
  /** Les invités de ce nœud : politique appliquée ici, télémétrie, intentions d'invitation. */
  readonly invites: NoeudInvites;
  /** La charte signée du réseau : droits, appairage, édition (routes `/api/reseau/charte`). */
  readonly charte: CharteNoeud;
  private readonly canaux: Canaux;
  private readonly hote: HoteCanal;
  private pairs: PairFederee[];
  private readonly refus = new Set<string>();
  private readonly voisins = new Voisinage();
  private config: ConfigAiguilleur | null;
  /** Le lien vers l'aiguilleur, les liaisons directes et le duo (`liens-noeud.ts`). */
  private readonly liens: LiensNoeud;
  private readonly admissions: AdmissionsNoeud;
  private readonly appareils: AppareilsNoeud;
  private readonly appairage: AppairageNoeud;
  private readonly machinesDuReseau: MachinesDuReseau;
  private readonly machines: MachinesNoeud;
  private readonly chefAppareil: ChefAppareil;
  private readonly port: PortNoeud;
  private readonly hoteNoeud: HoteNoeud;
  /** Terminaux des sessions de ce nœud, ouverts par un pair (les terminaux de machine sont aux appareils). */
  readonly terminaux: TerminalFedere;
  private desabonner: (() => void) | null = null;
  private recepteurSynchro: ((membre: string, brut: unknown) => void) | null = null;
  private identiteEnCours: Promise<Identite> | null = null;

  constructor(private readonly options: OptionsFederation) {
    this.secrets = new SecretsNoeud(options.dossierSecrets, options.journal);
    this.pairs = this.secrets.lirePairs();
    this.config = this.secrets.lireAiguilleur();
    this.charte = this.creerCharte();
    this.demandes = new DemandesAppairage(options.delaiDemandeMs ?? DELAI_DEMANDE_MS, () => Date.now());
    this.invites = new NoeudInvites({
      moi: () => this.config?.id ?? null,
      machine: options.machine,
      charte: () => this.charte.charte(),
      registre: options.registre,
      dossier: options.dossierSecrets,
      racine: options.invitesRacine ?? process.env['LANTERNE_INVITES_DOSSIER'] ?? join(homedir(), 'lanterne-invites'),
      home: homedir(),
      racinesMachine: () => options.registre.machines().find((m) => m.id === options.machine)?.racines ?? [],
      envoyerAChefs: (m) => this.envoyerAChefs(m),
      journal: options.journal.child({ domaine: 'invites' }),
    });
    options.diffusion.vueApplis = (m) => this.invites.vueAppli(m);
    this.echanges = new Echanges({
      invites: this.invites,
      registre: options.registre,
      pont: options.pont,
      machine: options.machine,
      nom: () => this.config?.nom ?? options.machine,
      distant: this.distant,
      journal: options.journal,
      terminaux: { traiter: (c, m) => this.terminaux.traiter(c, m) },
      autoriser: (membre, requete) => this.charte.autorise(membre, requete),
      autoriserAmi: (ami, requete) => this.charte.autoriseAmi(ami, requete),
    });
    this.hote = this.creerHote();
    this.canaux = new Canaux(this.hote, (m) => this.liens.emettre(m));
    this.port = this.portNoeud();
    this.liens = new LiensNoeud(this.port);
    this.admissions = new AdmissionsNoeud(this.port);
    this.terminaux = new TerminalFedere({
      echanges: this.echanges,
      canaux: this.canaux,
      registre: options.registre,
      journal: options.journal,
      autorise: (membre, requete) => this.charte.autorise(membre, requete),
    });
    this.chefAppareil = this.creerChefAppareil();
    this.appareils = new AppareilsNoeud(this.port, this.terminaux, this.chefAppareil);
    this.distantes = new Distantes({
      registre: options.registre,
      diffusion: options.diffusion,
      machine: options.machine,
      cache: this.distant,
      echanges: this.echanges,
      liaison: (membre) => this.canaux.liaisonOuverteAvec(membre),
      journal: options.journal.child({ domaine: 'distantes' }),
    });
    const optionsMachines = {
      ...options,
      estChef: options.estChef ?? ((m: string) => this.charte.estChef(m)),
      compteChoisi: options.compteChoisi ?? (() => this.compteChoisi()),
    };
    this.machines = creerMachinesNoeud({
      options: optionsMachines,
      echanges: this.echanges,
      machineDe: (m) => this.machinesDuReseau.machineDe(m),
      verifierOrdre: (ordre, action) => this.machinesDuReseau.ordreValide(ordre, action),
    });
    this.machinesDuReseau = new MachinesDuReseau(this.port, this.machines);
    this.appairage = new AppairageNoeud(this.port, {
      liens: this.liens,
      admissions: this.admissions,
      demandes: this.demandes,
      terminaux: this.terminaux,
      machines: this.machines,
      echanges: this.echanges,
      chefAppareilRelie: () => this.chefAppareilRelie(),
    });
    this.hoteNoeud = new HoteNoeud(this.port, {
      echanges: this.echanges,
      invites: this.invites,
      machines: this.machines,
      admissions: this.admissions,
      appareils: this.appareils,
      appairage: this.appairage,
      terminaux: this.terminaux,
      demandes: this.demandes,
      recepteurSynchro: () => this.recepteurSynchro,
      estAppareil: (membre) => this.estAppareil(membre),
    });
  }

  /** Ce que les modules du nœud lisent ou écrivent ici : le nœud reste le seul propriétaire de ces données. */
  private portNoeud(): PortNoeud {
    return {
      options: this.options,
      secrets: this.secrets,
      canaux: this.canaux,
      voisins: this.voisins,
      charte: this.charte,
      distant: this.distant,
      refus: this.refus,
      pairs: () => this.pairs,
      definirPairs: (pairs) => {
        this.pairs = pairs;
      },
      config: () => this.config,
      definirConfig: (config) => {
        this.config = config;
      },
      identifiantProtocole: () => this.identifiantProtocole(),
      proprietaireLocal: () => this.proprietaireLocal(),
      estNoeud: (membre) => this.estNoeud(membre),
      identite: () => this.identite(),
      signaler: () => this.signaler(),
      sauverPairs: () => this.sauverPairs(),
    };
  }

  async etat(): Promise<EtatFederation> {
    return etatFederation(this.port, this.liens, this.demandes);
  }

  arreter(): void {
    this.invites.arreter();
    this.liens.arreterDirects();
    this.desabonner?.();
    this.desabonner = null;
    this.liens.arreterPlanificateur();
    this.echanges.arreter();
    this.machines.etats.arreter();
    this.machines.actions.arreter();
    this.canaux.fermerTout();
    this.appareils.arreter();
    this.demandes.arreter();
    this.liens.arreterLien();
    this.voisins.effacer();
  }

  /** Premier contact avec un nœud en ligne : une demande part, Chris la tranche chez lui. */
  appairer(membre: string): Resultat<{ canal: string }> {
    return this.appairage.appairer(membre);
  }

  /**
   * Premier contact sans aiguilleur : une liaison directe vers `adresse` (réseau local, VPN, tunnel), puis la demande
   * d'appairage, que Chris tranche chez le visé avec les deux empreintes. L'adresse n'est retenue qu'à l'accord.
   */
  async appairerDirect(adresse: string): Promise<Resultat<{ membre: string; canal: string }>> {
    return this.appairage.appairerDirect(adresse);
  }

  /** Le transport d'un pair apparié : une adresse directe (joignable sans aiguilleur), ou aucune (aiguilleur seul). */
  transportPair(membre: string, adresse: string | null): Resultat<null> {
    return this.liens.transportPair(membre, adresse);
  }

  /** Réglages de la liaison directe : écoute locale (`hôte:port`, vide pour aucune) et propriétaire du réseau. */
  configurerDirecte(corps: {
    ecoute?: string | null;
    proprietaire?: string | null;
    tunnels?: TunnelSshConfig[];
  }): Resultat<null> {
    return this.liens.configurerDirecte(corps);
  }

  /**
   * Décision de Chris sur une demande. Locale : tranchée ici. Vue chez un autre nœud : relayée à ce nœud, qui la
   * tranche chez lui ; si ce nœud n'est pas relié, rien ne part (409). Jamais d'acceptation automatique.
   */
  decider(id: string, accord: boolean): Resultat<null> {
    return this.appairage.decider(id, accord);
  }

  /** Le duo par l'aiguilleur (étape 7) partage ce lien : ses canaux (préfixe `duo-`) lui sont remis. */
  brancherDuo(handler: HandlerDuoAiguilleur): void {
    this.liens.brancherDuo(handler);
  }

  /** Soi, puis chaque nœud apparié : son dernier état connu (null s'il n'en a jamais envoyé) et s'il est relié. */
  async machinesReseau(): Promise<MachineReseau[]> {
    return this.machinesDuReseau.machinesReseau();
  }

  /**
   * Une action sur une machine : la nôtre (exécutée ici), un réveil, ou une action relayée à un pair relié.
   * `ordre` : l'ordre signé par le téléphone chef, que le pair vérifiera dans sa propre charte.
   */
  async agirSurMachine(membre: string, action: ActionMachine, ordre?: OrdreSigne): Promise<Resultat<null>> {
    return this.machinesDuReseau.agirSurMachine(membre, action, ordre);
  }
  private creerChefAppareil(): ChefAppareil {
    const { servirChef } = this.options;
    return new ChefAppareil({
      journal: this.options.journal.child({ domaine: 'chef-appareil' }),
      charte: () => this.charte.charte(),
      signee: () => this.charte.signee(),
      moi: () => this.config?.id ?? null,
      estChef: (membre) => this.charte.estChef(membre),
      proposer: (signee) => this.charte.proposer(signee),
      machinesReseau: () => this.machinesReseau(),
      agir: (membre, action, ordre) => this.agirSurMachine(membre, action, ordre),
      demandes: () => this.demandes.lister(),
      decider: (id, accord) => this.demandes.decider(id, accord),
      ...(servirChef ? { rejouer: servirChef } : {}),
    });
  }

  /** Écoute les changements locaux ; démarre le lien si ce nœud est déjà relié à un aiguilleur. */
  demarrer(): void {
    this.desabonner = this.options.diffusion.ecouter((m) => this.surDiffusion(m));
    this.invites.demarrer();
    void this.charte.demarrer();
    this.machines.etats.demarrer(() => this.canaux.ouverts().filter((c) => this.estNoeud(c.membre)));
    if (this.config) this.liens.demarrerLien();
    void this.liens.demarrerDirect();
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
    this.liens.demarrerLien();
    return ok({ id: r.id });
  }

  /** Ce nœud est-il chef du réseau, et ce membre l'est-il ? Sans charte : personne. */
  estChef(membre: string): boolean {
    return this.charte.estChef(membre);
  }

  /** Le compte choisi pour cette machine (charte) : compte par défaut des sessions ouvertes sans compte. */
  compteChoisi(): string | null {
    return this.charte.compteDeMoi();
  }

  portDuo(): PortAiguilleurDuo {
    return {
      membreLocal: () => this.config?.id ?? null,
      identiteLocale: () => this.identite(),
      envoyer: (m) => this.liens.emettre(m),
      enLigne: (membre) => this.voisins.enLigne(membre),
      relie: () => this.liens.lien?.connecte() ?? false,
    };
  }

  /**
   * Révocation : le pair perd son accès (un message le lui dit s'il est en ligne) et disparaît d'ici. Un appareil
   * révoqué l'est partout : sa révocation part à tous les nœuds pairs.
   */
  revoquer(membre: string): Resultat<null> {
    const pair = this.pairs.find((p) => p.id === membre);
    if (!pair) return echec(404, 'nœud non apparié');
    const canal = this.canaux.avec(membre);
    if (canal?.ouvert) canal.envoyer({ t: 'revocation' });
    this.admissions.marquerRevoque(membre);
    this.appairage.oublierPair(membre);
    canal?.fermerApresEnvois();
    if (pair.genre === 'appareil') this.admissions.marquerAppareilRevoque(membre);
    return ok(null);
  }

  /** Branche le service de synchronisation : chaque message synchro reçu d'un pair lui est remis. */
  brancherSynchro(recepteur: (membre: string, brut: unknown) => void): void {
    this.recepteurSynchro = recepteur;
  }

  identifiantLocal(): string | null {
    return this.identifiantProtocole();
  }

  /** L'identifiant du nœud dans le protocole : celui de l'aiguilleur s'il est relié, sinon celui de son identité. */
  private identifiantProtocole(): string | null {
    return this.config?.id ?? this.liens.idDirect;
  }

  /** Un message synchro vers un pair apparié dont le lien est ouvert ; rien ne part sinon. */
  envoyerSynchro(membre: string, message: MessageSynchro): Resultat<null> {
    if (!this.pairs.some((p) => p.id === membre)) return echec(409, 'nœud non apparié');
    const canal = this.canaux.liaisonOuverteAvec(membre);
    if (!canal) return echec(409, 'nœud hors ligne ou non relié');
    return canal.envoyer({ t: 'synchro', m: message }) ? ok(null) : echec(503, 'envoi impossible');
  }

  private creerCharte(): CharteNoeud {
    const { journal, machine, peutReprendre } = this.options;
    return new CharteNoeud({
      journal: journal.child({ domaine: 'charte' }),
      secrets: this.secrets,
      peutReprendre: peutReprendre ?? false,
      moi: () => this.identifiantProtocole(),
      nomLocal: () => this.config?.nom ?? machine,
      identite: () => this.identite(),
      pairs: () => this.pairs,
      liensNoeuds: () => this.canaux.ouverts().filter((c) => this.estNoeud(c.membre)),
      revoquer: (membre) => void this.revoquer(membre),
      signaler: () => this.signaler(),
      invitePrevue: (membre) => this.invites.intentions.prendre(membre),
    });
  }

  private creerHote(): HoteCanal {
    return {
      journal: this.options.journal,
      delaiAppairageMs: (this.options.delaiDemandeMs ?? DELAI_DEMANDE_MS) + MARGE_APPAIRAGE_MS,
      identiteLocale: () => this.identite(),
      nomLocal: () => this.config?.nom ?? this.options.machine,
      genreLocal: () => 'noeud',
      pairDe: (membre) => this.pairs.find((p) => p.id === membre) ?? null,
      envoyerAiguilleur: (m) => this.liens.emettre(m),
      presentationRecue: (canal, p) => void this.appairage.presentationRecue(canal, p),
      appairageAccepte: (canal, p) => this.appairage.appairageAccepte(canal.membre, p),
      appairageRefuse: (canal, raison) => {
        this.options.journal.warn({ membre: canal.membre, raison }, 'appairage refusé');
        this.signaler();
      },
      liaisonOuverte: (canal) => (this.hoteNoeud.liaisonOuverte(canal), this.signaler()),
      liaisonRefusee: (canal, raison) => this.hoteNoeud.liaisonRefusee(canal, raison),
      messageRecu: (canal, m) => void this.hoteNoeud.messageRecu(canal, m),
      canalFerme: (canal) => (this.hoteNoeud.canalFerme(canal), this.signaler()),
      motifRefusInconnu: (membre) => (this.admissions.estRevoque(membre) ? 'révoqué' : 'identité non appairée'),
    };
  }

  /** Ce nœud est en pause : aucune nouvelle session (les sessions en cours continuent). */
  enPause(): boolean {
    return this.machines.pause.enPause();
  }

  /** Un téléphone chef est relié à ce nœud : il tranche les demandes d'appairage qui arrivent ici. */
  private chefAppareilRelie(): boolean {
    return this.canaux.ouverts().some((c) => this.estAppareil(c.membre) && this.charte.estChef(c.membre));
  }

  private estNoeud(membre: string): boolean {
    return this.pairs.some((p) => p.id === membre && p.genre === 'noeud');
  }

  /** Les nœuds du réseau, soi compris, avec leur identifiant de membre et leur clé : servi aux appareils admis. */
  async noeudsAppareil(): Promise<{ noeuds: NoeudAnnonce[] }> {
    const config = this.config;
    if (!config) return { noeuds: noeudsAnnonces(this.pairs, null) };
    const identite = exporterIdentitePublique((await this.identite()).publique);
    const moi = { id: config.id, nom: config.nom, identite };
    return { noeuds: noeudsAnnonces(this.pairs, moi) };
  }

  private estAppareil(membre: string): boolean {
    return this.pairs.some((p) => p.id === membre && p.genre === 'appareil');
  }

  private proprietaireLocal(): string | null {
    return this.config?.proprietaire ?? this.liens.directs.config.proprietaire;
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

  /** Un message part aux chefs connectés (jamais à un invité) : l'activité des invités de ce nœud. */
  private envoyerAChefs(m: MessageChiffre): void {
    for (const c of this.canaux.ouverts()) {
      if (this.charte.estChef(c.membre) && !this.invites.estInvite(c.membre)) c.envoyer(m);
    }
  }

  /** Ouverture relayée vers le chef (ce nœud est invité) : même corps, la politique du chef décide. */
  ouvrirChez(membre: string, texte: string): Promise<Response> {
    return this.distantes.ouvrirChez(membre, texte);
  }

  machineEnLigne(membre: string): boolean {
    return this.canaux.liaisonOuverteAvec(membre) !== null;
  }

  private surDiffusion(m: MessageClient): void {
    if (m.type === 'session') this.invites.surSession(m.session);
    surDiffusionFederee(m, {
      distantes: this.distantes,
      echanges: this.echanges,
      liensPairs: () => this.canaux.ouverts().filter((c) => !this.estAppareil(c.membre)),
    });
  }
}

