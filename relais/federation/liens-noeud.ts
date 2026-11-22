// Responsabilité : les deux tuyaux du nœud — la liaison avec l'aiguilleur (relais des messages, présence,
// planification des liens) et les liaisons directes sans aiguilleur — avec le propriétaire du réseau et le duo qui
// partage le lien.
import { type MessageDeAiguilleur, type MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import type { Identite } from '../../commun/chiffrement/identite.ts';
import { concerneDuo, type HandlerDuoAiguilleur } from '../../commun/duo-aiguilleur.ts';
import { identifiantDerive, type Locale } from './direct-poignee.ts';
import { adresseDirecteValide, NoeudDirect } from './direct-noeud.ts';
import type { LienDirect } from './direct-lien.ts';
import { LienAiguilleur, type MotifArret } from './lien-aiguilleur.ts';
import { Tuyaux } from './tuyaux.ts';
import type { TunnelSshConfig } from './tunnel-ssh.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import { join } from 'node:path';
import type { PortNoeud } from './noeud-port.ts';

const DELAI_LIEN_MIN_MS = 1_000;
const DELAI_LIEN_MAX_MS = 30_000;
const INTERVALLE_PLANIFICATION_MS = 5_000;

export class LiensNoeud {
  /** Le lien vers l'aiguilleur (null sans aiguilleur, ou une fois arrêté). */
  lien: LienAiguilleur | null = null;
  motifArret: MotifArret | null = null;
  /** Les messages du nœud vers l'aiguilleur ou vers une liaison directe. */
  readonly tuyaux: Tuyaux;
  /** Les liaisons directes (sans aiguilleur) : écoute, pairs joignables par adresse. */
  readonly directs: NoeudDirect;
  private planificateur: ReturnType<typeof setInterval> | null = null;
  idDirect: string | null = null;
  identiteChargee: Identite | null = null;
  duo: HandlerDuoAiguilleur | null = null;

  constructor(private readonly port: PortNoeud) {
    this.directs = new NoeudDirect({
      journal: port.options.journal.child({ domaine: 'directe' }),
      config: port.secrets.lireDirecte(),
      sauver: (c) => port.secrets.ecrireDirecte(c),
      locale: () => this.localeDirecte(),
      pairs: () => port.pairs(),
      ouvert: (lien) => this.liaisonDirecteOuverte(lien),
      ferme: (lien) => this.liaisonDirecteFermee(lien),
      message: (lien, m) => this.messageDirect(lien, m),
      commandeSsh: port.options.commandeSsh ?? 'ssh',
      knownHosts: join(port.options.dossierSecrets, 'federation', 'known_hosts'),
    });
    this.tuyaux = new Tuyaux({
      envoyerAiguilleur: (m) => this.lien?.envoyer(m) ?? false,
      envoyerDirect: (membre, m) => this.directs.envoyer(membre, m),
    });
  }

  /** Arrête les liaisons directes (sans aiguilleur). */
  arreterDirects(): void {
    this.directs.arreter();
  }

  /** Arrête la planification des liens. */
  arreterPlanificateur(): void {
    if (this.planificateur) clearInterval(this.planificateur);
    this.planificateur = null;
  }

  /** Arrête le lien vers l'aiguilleur. */
  arreterLien(): void {
    this.lien?.arreter();
    this.lien = null;
  }

  // Le propriétaire est appris de la présence de l'aiguilleur quand il manque ; il est alors gardé.
  private apprendreProprietaire(proprietaire: string | undefined): void {
    const config = this.port.config();
    if (!config || !proprietaire || config.proprietaire === proprietaire) return;
    if (config.proprietaire) {
      return this.port.options.journal.error('propriétaire différent de celui de la présence : ignoré');
    }
    const nouvelle = { ...config, proprietaire };
    this.port.definirConfig(nouvelle);
    try {
      this.port.secrets.ecrireAiguilleur(nouvelle);
    } catch {
      this.port.options.journal.error('propriétaire du nœud non sauvegardé');
    }
  }

  async demarrerDirect(): Promise<void> {
    this.identiteChargee = await this.port.identite();
    this.idDirect = await identifiantDerive(this.identiteChargee.publique);
    this.directs.demarrer();
    this.demarrerPlanificateur();
  }

  /** Le duo par l'aiguilleur (étape 7) partage ce lien : ses canaux (préfixe `duo-`) lui sont remis. */
  brancherDuo(handler: HandlerDuoAiguilleur): void {
    this.duo = handler;
  }

  /** Le transport d'un pair apparié : une adresse directe (joignable sans aiguilleur), ou aucune (aiguilleur seul). */
  transportPair(membre: string, adresse: string | null): Resultat<null> {
    if (!this.port.pairs().some((p) => p.id === membre && p.genre === 'noeud')) return echec(404, 'nœud non apparié');
    if (adresse !== null && !adresseDirecteValide(adresse)) return echec(400, 'adresse invalide');
    if (adresse === null) this.directs.oublier(membre);
    else this.directs.retenirAdresse(membre, adresse.trim());
    this.directs.relancer();
    this.port.signaler();
    return ok(null);
  }

  /** Réglages de la liaison directe : écoute locale (`hôte:port`, vide pour aucune) et propriétaire du réseau. */
  configurerDirecte(corps: {
    ecoute?: string | null;
    proprietaire?: string | null;
    tunnels?: TunnelSshConfig[];
  }): Resultat<null> {
    if (corps.ecoute && !adresseDirecteValide(corps.ecoute)) return echec(400, 'adresse d’écoute invalide');
    if (corps.proprietaire && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(corps.proprietaire)) {
      return echec(400, 'propriétaire : minuscules, chiffres, tirets');
    }
    this.directs.configurer({
      ...(corps.ecoute !== undefined ? { ecoute: corps.ecoute || null } : {}),
      ...(corps.proprietaire !== undefined ? { proprietaire: corps.proprietaire || null } : {}),
      ...(corps.tunnels !== undefined ? { tunnels: corps.tunnels } : {}),
    });
    this.port.signaler();
    return ok(null);
  }

  private localeDirecte(): Locale | null {
    const identite = this.identiteChargee;
    const id = this.port.identifiantProtocole();
    if (!identite || !id) return null;
    return {
      id,
      identite,
      nom: this.port.config()?.nom ?? this.port.options.machine,
      proprietaire: this.port.proprietaireLocal(),
    };
  }

  demarrerLien(): void {
    const config = this.port.config();
    if (!config) return;
    this.lien?.arreter();
    this.motifArret = null;
    this.lien = new LienAiguilleur(
      {
        url: config.url,
        jeton: config.jeton,
        delaiMinMs: DELAI_LIEN_MIN_MS,
        delaiMaxMs: DELAI_LIEN_MAX_MS,
        journal: this.port.options.journal.child({ domaine: 'aiguilleur' }),
      },
      {
        surMessage: (m) => this.surMessage(m),
        surConnexion: (connecte) => this.surConnexion(connecte),
        surArret: (motif) => this.surArret(motif),
      },
    );
    this.lien.demarrer();
    void this.port.charte.essayerReprise();
    this.demarrerPlanificateur();
  }

  private demarrerPlanificateur(): void {
    this.planificateur ??= setInterval(
      () => this.planifier(),
      this.port.options.intervallePlanificationMs ?? INTERVALLE_PLANIFICATION_MS,
    );
  }

  // Liaison directe ouverte : le pair est joignable (le voisinage le sait), et on le retient comme en ligne.
  private liaisonDirecteOuverte(lien: LienDirect): void {
    const pair = lien.pair;
    if (!pair) return;
    this.port.voisins.memoriserDirect({
      id: pair.id,
      enLigne: true,
      nom: pair.nom,
      genre: 'noeud',
      proprietaire: pair.proprietaire ?? null,
    });
    this.port.options.journal.info({ membre: pair.id }, 'liaison directe : pair joint');
    this.port.signaler();
  }

  private liaisonDirecteFermee(lien: LienDirect): void {
    const id = lien.pair?.id;
    if (!id) return;
    this.port.voisins.retirerDirect(id);
    for (const canal of this.port.canaux.actifs()) if (canal.membre === id) canal.surFermetureDistante();
    this.port.signaler();
  }

  emettre(message: MessageVersAiguilleur): boolean {
    if (message.t === 'donnees') this.port.options.observer?.('envoi', message.charge);
    return this.tuyaux.envoyer(message);
  }

  private messageDirect(lien: LienDirect, message: MessageDeAiguilleur): void {
    const membre = lien.pair?.id;
    if (!membre || concerneDuo(message)) {
      return this.port.options.journal.warn({ membre }, 'liaison directe : message refusé');
    }
    if (message.t === 'ouvrir') this.tuyaux.ouvertParPair(message.canal, membre);
    this.surMessageRelaye(message);
  }

  private surMessage(message: MessageDeAiguilleur): void {
    if (message.t === 'presence') return this.surPresence(message);
    if (message.t === 'ouvrir' && message.proprietaire) {
      this.port.voisins.memoriserOuvrant(message.de, message.proprietaire);
    }
    this.surMessageRelaye(message);
  }

  // Ce que l'aiguilleur et une liaison directe ont en commun : canaux, données, duo.
  private surMessageRelaye(message: MessageDeAiguilleur): void {
    if (message.t === 'fermer') this.tuyaux.oublier(message.canal);
    if (message.t === 'donnees') this.port.options.observer?.('reception', message.charge);
    if (concerneDuo(message)) return this.duo?.surMessage(message);
    this.port.canaux.surMessage(message);
  }

  private surPresence(message: Extract<MessageDeAiguilleur, { t: 'presence' }>): void {
    const change = this.port.voisins.remplacer(message.membres);
    this.apprendreProprietaire(message.proprietaire);
    this.planifier();
    if (change) this.port.signaler();
  }

  // Le lien part du nœud au plus petit identifiant : un seul canal par paire, sans collision à l'ouverture.
  // Seuls nos nœuds, en ligne, sont reliés : un pair qui n'est plus des nôtres ne reçoit plus de lien.
  private planifier(): void {
    const moi = this.port.identifiantProtocole();
    if (!moi) return;
    this.directs.relancer();
    const proprio = this.port.proprietaireLocal();
    for (const p of this.port.pairs()) {
      if (p.genre === 'appareil') continue;
      if (p.id <= moi || this.port.refus.has(p.id) || !this.port.voisins.joignable(p.id, proprio)) continue;
      if (!this.port.canaux.avec(p.id)) this.port.canaux.ouvrir(p.id, 'lien');
    }
  }

  private surConnexion(connecte: boolean): void {
    this.port.options.journal.info({ connecte }, 'lien vers l’aiguilleur');
    this.duo?.surConnexion(connecte);
    this.port.signaler();
    if (connecte) return;
    for (const canal of this.port.canaux.actifs()) canal.surFermetureDistante();
    this.port.voisins.effacer();
    for (const p of this.port.pairs()) this.port.distant.enLigne(p.id, false);
  }

  private surArret(motif: MotifArret): void {
    this.motifArret = motif;
    this.port.signaler();
    this.port.options.journal.warn({ motif }, 'lien vers l’aiguilleur arrêté : ce nœud n’est plus relié');
  }
}
