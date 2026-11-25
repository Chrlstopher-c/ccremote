// Responsabilité : le protocole chiffré entre nœuds une fois le lien ouvert. Côté qui tient une session : instantané,
// fil, écriture, interruption, ouverture, abonnement au fil en direct. Côté qui la consulte : requêtes corrélées par
// référence, instantanés et événements reçus dans le cache mémoire. Les sessions du nœud se lisent dans le registre et
// ne s'écrivent jamais ailleurs.
import type { Logger } from 'pino';
import {
  NOMBRE_MAX_ABONNEMENTS,
  TAILLE_FIL_FEDERE,
  TAILLE_FLUX_MAX_CARACTERES,
  TAILLE_MORCEAU_CARACTERES,
  DELAI_REPONSE_FEDEREE_MS,
  type EvenementFedere,
  type MachineAnnoncee,
  type MessageChiffre,
} from '../../commun/federation.ts';
import { estGesteRelayable, type MethodeGeste, type PorteeGeste } from '../../commun/gestes-federes.ts';
import { droitRequis, type RequeteDroit } from '../../commun/charte.ts';
import { reponseRefusDroit, requeteDeMessage, requetePermise } from './droits-noeud-requete.ts';
import { type CorpsGeste, reponseGeste } from './gestes.ts';
import { decouper, nombreDeMorceaux, Reassemblage } from './transferts.ts';
import type { OuvertureChezProprietaire } from '../duo/pont-sessions.ts';
import type { ConfirmationDemandee } from '../../commun/api-clients.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { Registre } from '../registre/registre.ts';
import type { CanalNoeud } from './canal.ts';
import { AssemblageInstantane, messagesInstantane } from './instantane.ts';
import { CacheDistant } from './distant.ts';
import { nonceRef } from './identifiants.ts';
import { tenirDansLaLimite } from './trames.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { VerdictRequete } from '../invites/politique-requete.ts';
import type { VerdictGeste, GesteRecu } from '../invites/politique-geste.ts';
import { enListe, erreurTransfert, lireBilan, type Bilan } from './echanges-aides.ts';

const DESCRIPTION_LOCALE = 'Cet ordinateur';
/** Un delta de texte attend au plus ce délai avant de partir, avec les suivants du même bloc. */
export const DELAI_FLUX_MS = 60;
/** Les changements de sessions partent groupés : un instantané par rafale, après ce délai. */
const DELAI_INSTANTANE_MS = 300;

/** Ce que le nœud fait pour un pair au nom de son propriétaire : mêmes chemins qu'un geste local. */
export interface PontFederation {
  ouvrir(demande: OuvertureChezProprietaire): Promise<Response>;
  envoyer(session: string, texte: string): Promise<Response>;
  interrompre(session: string): Promise<Response>;
  /** Un geste relayé (liste fermée), exécuté par la route locale correspondante, sans autre contrôle d'accès. */
  geste?(geste: GesteLocal): Promise<Response>;
}

export interface GesteLocal {
  readonly geste: string;
  readonly methode: MethodeGeste;
  readonly session?: string;
  readonly machine?: string;
  readonly ami?: string; // au nom d'un ami du duo : son identifiant de charte, la machine visée le vérifie
  readonly requete?: string;
  readonly corps?: string;
  /** Ouverture d'un invité : cadre posé par le nœud (jamais par un corps reçu). */
  readonly invite?: CadreInvite;
}

/** Politique des invités (relais/invites) : requêtes et gestes d'un pair, instantanés vus par un membre. */
export interface PorteInvites {
  requete(membre: string, message: MessageChiffre): VerdictRequete;
  geste(membre: string, m: GesteRecu): VerdictGeste;
  sessionsPour(membre: string, sessions: readonly ResumeSession[]): ResumeSession[];
  estInvite(membre: string): boolean;
}

/** Le texte d'un bloc en cours d'écriture, tel que le nœud local le reçoit (`flux` local). */
export interface FluxLocal {
  readonly sessionId: string;
  readonly bloc: string;
  readonly delta: string;
  readonly genre?: 'texte' | 'reflexion';
  readonly agent?: string;
}

/** Ce que le nœud confie aux terminaux d'une session distante (ouverture, saisie, fermeture). */
export interface RecepteurTerminal {
  traiter(canal: CanalNoeud, message: MessageChiffre): void;
}

type MessageFlux = Extract<MessageChiffre, { t: 'flux' }>;
interface TamponFlux {
  readonly canal: CanalNoeud;
  readonly message: MessageFlux;
}

export interface OptionsEchanges {
  readonly registre: Registre;
  readonly pont: PontFederation;
  readonly machine: string;
  readonly nom: () => string;
  readonly distant: CacheDistant;
  readonly journal: Logger;
  readonly delaiReponseMs?: number;
  /** Terminaux d'une session distante : les messages `terminal_*` leur sont remis. */
  readonly terminaux?: RecepteurTerminal;
  /** Droits de la charte : un pair sans le droit d'une requête la voit refusée. Absent : tout est permis. */
  readonly autoriser?: (membre: string, requete: RequeteDroit) => boolean;
  /** Droits d'un ami du duo sur cette machine (la machine visée vérifie) ; absent : fermé. */
  readonly autoriserAmi?: (ami: string, requete: RequeteDroit) => boolean;
  /** Politique des invités : elle remplace la charte pour un invité, et restreint ce que les autres voient. */
  readonly invites?: PorteInvites;
}

type Attente = (m: MessageChiffre | null) => void;
/** Une requête en attente de réponse ; `membre` dit à qui elle est partie (un lien perdu la résout tout de suite). */
interface Attendue {
  readonly membre: string;
  readonly fin: Attente;
}

export class Echanges {
  private readonly attentes = new Map<string, Attendue>();
  private readonly transferts = new Reassemblage();
  private readonly assemblage = new AssemblageInstantane();
  private readonly abonnements = new Map<string, Set<string>>();
  private readonly tampons = new Map<string, TamponFlux>();
  private minuterieFlux: ReturnType<typeof setTimeout> | null = null;
  private instantaneEnAttente: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: OptionsEchanges) {}

  /**
   * L'instantané des sessions du nœud, en messages dans l'ordre d'envoi : d'abord les pages des sessions au-delà des
   * 150 plus récentes, puis la tête (instantane.ts). Seules les sessions de cette machine : le registre garde aussi des
   * copies d'autres machines (ex. la tour avant sa bascule).
   */
  instantanes(membre: string | null = null): MessageChiffre[] {
    const locales = this.options.registre
      .sessions(false)
      .filter((s) => !s.duo && s.machine === this.options.machine);
    const sessions = this.options.invites?.sessionsPour(membre ?? '', locales) ?? locales;
    const vue = this.machineAnnoncee();
    return messagesInstantane(sessions, (liste) => ({
      t: 'instantane',
      machine: this.options.machine,
      nom: this.options.nom(),
      sessions: [...liste],
      ...(vue ? { vue } : {}),
    }));
  }

  private machineAnnoncee(): MachineAnnoncee | null {
    const fiche = this.options.registre.machines().find((m) => m.id === this.options.machine);
    if (!fiche) return null;
    return {
      // « Cet ordinateur » ne veut rien dire chez un pair : il voit le nom du nœud à la place.
      description: (fiche.description === DESCRIPTION_LOCALE ? this.options.nom() : fiche.description).slice(0, 200),
      racines: fiche.racines.slice(0, 50),
      projets: fiche.projets.slice(0, 500),
      comptes: fiche.comptes.slice(0, 20),
      etatComptes: fiche.etatComptes.slice(0, 20),
    };
  }

  /** Un changement de sessions : un instantané complet part, groupé par rafale, aux liens ouverts (`canaux`). */
  programmerInstantane(canaux: () => readonly CanalNoeud[]): void {
    if (this.instantaneEnAttente) return;
    this.instantaneEnAttente = setTimeout(() => {
      this.instantaneEnAttente = null;
      for (const canal of canaux()) {
        if (this.peutVoir(canal.membre)) for (const message of this.instantanes(canal.membre)) canal.envoyer(message);
      }
    }, DELAI_INSTANTANE_MS);
  }

  /** Arrêt du nœud : les minuteries en attente tombent. */
  arreter(): void {
    if (this.instantaneEnAttente) clearTimeout(this.instantaneEnAttente);
    this.instantaneEnAttente = null;
    this.viderFlux();
  }

  /** Un événement local d'une session : envoyé en direct aux canaux dont le pair suit le fil de cette session. */
  diffuserEvenement(session: string, seq: number, ts: string, evt: Evenement, canaux: readonly CanalNoeud[]): void {
    this.viderFlux();
    for (const canal of canaux) {
      if (this.abonnements.get(canal.membre)?.has(session) && this.peutVoir(canal.membre)) {
        canal.envoyer({ t: 'evenement', session, seq, ts, evt });
      }
    }
  }

  /**
   * Un delta de texte local : regroupé par bloc pour chaque pair qui suit le fil, envoyé au plus tard après
   * DELAI_FLUX_MS. Un tampon plein part tout de suite ; le fil final reste la référence (non persisté).
   */
  diffuserFlux(flux: FluxLocal, canaux: readonly CanalNoeud[]): void {
    for (const canal of canaux) {
      if (!this.abonnements.get(canal.membre)?.has(flux.sessionId) || !this.peutVoir(canal.membre)) continue;
      const genre = flux.genre ?? '';
      const agent = flux.agent ?? '';
      const cle = `${canal.id}\u0000${flux.sessionId}\u0000${flux.bloc}\u0000${genre}\u0000${agent}`;
      this.empiler(cle, canal, flux);
    }
    this.armerFlux();
  }

  private empiler(cle: string, canal: CanalNoeud, flux: FluxLocal): void {
    const existant = this.tampons.get(cle);
    const delta = (existant?.message.delta ?? '') + flux.delta;
    const message: MessageFlux = {
      t: 'flux',
      session: flux.sessionId,
      bloc: flux.bloc,
      delta,
      ...(flux.genre ? { genre: flux.genre } : {}),
      ...(flux.agent ? { agent: flux.agent } : {}),
    };
    this.tampons.set(cle, { canal, message });
    if (delta.length >= TAILLE_FLUX_MAX_CARACTERES) this.partir(cle);
  }

  private armerFlux(): void {
    if (this.minuterieFlux || this.tampons.size === 0) return;
    this.minuterieFlux = setTimeout(() => this.viderFlux(), DELAI_FLUX_MS);
  }

  /** Envoie tous les deltas en attente, dans l'ordre d'arrivée. */
  viderFlux(): void {
    if (this.minuterieFlux) clearTimeout(this.minuterieFlux);
    this.minuterieFlux = null;
    for (const cle of [...this.tampons.keys()]) this.partir(cle);
  }

  private partir(cle: string): void {
    const tampon = this.tampons.get(cle);
    this.tampons.delete(cle);
    if (tampon && tampon.canal.ouvert) tampon.canal.envoyer(tampon.message);
  }

  /** Une confirmation de ce nœud part à chaque pair ouvert : eux l'affichent, et leur réponse revient ici. */
  diffuserConfirmation(confirmation: ConfirmationDemandee, canaux: readonly CanalNoeud[]): void {
    for (const canal of canaux) canal.envoyer({ t: 'confirmation', confirmation });
  }

  /**
   * Oublie ce qu'on gardait d'un pair (canal fermé ou révoqué) : abonnements, deltas, morceaux en route. Les requêtes
   * qui l'attendaient rendent « rien » tout de suite, sans attendre leur délai.
   */
  oublier(membre: string): void {
    this.abonnements.delete(membre);
    this.transferts.oublier(membre);
    this.assemblage.oublier(membre);
    for (const [cle, tampon] of [...this.tampons]) if (tampon.canal.membre === membre) this.tampons.delete(cle);
    for (const [ref, attente] of [...this.attentes]) if (attente.membre === membre) this.resoudre(ref, null);
  }

  /** Une requête entrante ou une réponse d'un pair, sur un lien ouvert. */
  async traiter(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    const politique = this.options.invites?.requete(canal.membre, message) ?? { ok: true as const };
    if (!politique.ok) return politique.reponse ? void canal.envoyer(politique.reponse) : undefined;
    if (this.refuseSansDroit(canal, message)) return undefined;
    return this.despacher(canal, message);
  }

  private async despacher(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    switch (message.t) {
      case 'instantane':
      case 'evenement':
        return this.recevoirCache(canal.membre, message);
      case 'instantane_suite':
        this.assemblage.recevoirSuite(canal.membre, message);
        return undefined;
      case 'fil':
        return this.repondreFil(canal, message.ref, message.session);
      case 'ecrire':
        return this.repondreEcriture(canal, message.ref, message.session, message.texte);
      case 'interrompre':
        return this.repondreInterruption(canal, message.ref, message.session);
      case 'ouvrir':
        return this.repondreOuverture(canal, message.ref, message.machine, message.chemin, message.message);
      case 'fil_reponse':
        return this.recevoirFil(canal, message.ref, message.session, message.evenements);
      case 'geste':
        return this.repondreGeste(canal, message);
      case 'reponse':
        return this.resoudre(message.ref, message);
      case 'geste_reponse':
        return this.recevoirReponse(canal.membre, message);
      case 'morceau':
        this.transferts.recevoir(canal.membre, message);
        return undefined;
      case 'confirmation':
        return this.options.distant.recevoirConfirmation(canal.membre, message.confirmation);
      case 'flux':
        return this.options.distant.recevoirFlux(canal.membre, message);
      default:
        return this.options.terminaux?.traiter(canal, message);
    }
  }

  /** Un pair sans `voir` ne reçoit ni instantané, ni événement, ni flux de session. */
  peutVoir(membre: string): boolean {
    return this.options.invites?.estInvite(membre) === true || this.permis(membre, { genre: 'fil' });
  }

  private permis(membre: string, requete: RequeteDroit): boolean {
    return this.options.autoriser?.(membre, requete) ?? true;
  }

  /** Un message qui exige un droit que le pair n'a pas est refusé ici (rend vrai), journalisé sans contenu. */
  private refuseSansDroit(canal: CanalNoeud, message: MessageChiffre): boolean {
    const requete = requeteDeMessage(message);
    if (!requete || this.permisRequete(canal.membre, message, requete)) return false;
    const droit = droitRequis(requete);
    this.options.journal.warn({ membre: canal.membre, t: message.t, droit }, 'requête refusée : droit manquant');
    const reponse = reponseRefusDroit(message, requete);
    if (reponse) canal.envoyer(reponse);
    return true;
  }

  // Le pair relais doit avoir le droit ; une requête au nom d'un ami du duo, la machine visée la vérifie aussi.
  private permisRequete(membre: string, message: MessageChiffre, requete: RequeteDroit): boolean {
    const amiPermis = (ami: string, r: RequeteDroit): boolean => this.options.autoriserAmi?.(ami, r) ?? false;
    return requetePermise(message, requete, this.permis(membre, requete), amiPermis);
  }

  // Instantané et événement d'un pair : le cache mémoire les garde.
  private recevoirCache(membre: string, m: Extract<MessageChiffre, { t: 'instantane' | 'evenement' }>): void {
    if (m.t === 'instantane') {
      // Les pages reçues avant la tête remplacent la liste d'un coup (si elles sont toutes là, sinon la tête seule).
      const suite = this.assemblage.terminer(membre);
      return this.options.distant.instantane(membre, m.machine, m.nom, [...m.sessions, ...suite], m.vue ?? null);
    }
    const evenement = { ...(m.seq !== undefined ? { seq: m.seq } : {}), ts: m.ts, evt: m.evt };
    return this.options.distant.ajouterEvenement(membre, m.session, evenement);
  }

  /**
   * Envoie une requête à un pair et rend sa réponse (ou null : hors ligne, lien perdu, trame refusée, délai dépassé).
   * `construire` rend un message, ou la suite de messages à envoyer dans l'ordre (morceaux puis requête).
   */
  requeter(
    canal: CanalNoeud,
    construire: (ref: string) => MessageChiffre | readonly MessageChiffre[],
    delaiMs?: number,
  ): Promise<MessageChiffre | null> {
    const ref = nonceRef();
    return new Promise((resoudre) => {
      const fin = (m: MessageChiffre | null): void => {
        clearTimeout(minuterie);
        this.attentes.delete(ref);
        resoudre(m);
      };
      const minuterie = setTimeout(() => fin(null), delaiMs ?? this.options.delaiReponseMs ?? DELAI_REPONSE_FEDEREE_MS);
      this.attentes.set(ref, { membre: canal.membre, fin });
      for (const m of enListe(construire(ref))) if (!canal.envoyer(m)) return fin(null);
    });
  }

  // Rend la réponse à la requête `ref`, si elle attend encore.
  private resoudre(ref: string, m: MessageChiffre | null): void {
    this.attentes.get(ref)?.fin(m);
  }

  // Une réponse dont le corps est en morceaux est réunie avant d'être rendue ; un transfert cassé devient un refus.
  private recevoirReponse(membre: string, m: Extract<MessageChiffre, { t: 'geste_reponse' }>): void {
    if (m.morceaux === undefined) return this.resoudre(m.ref, m);
    const corps = this.transferts.assembler(membre, m.ref, m.morceaux);
    if (corps === null) return this.resoudre(m.ref, erreurTransfert(m.ref));
    return this.resoudre(m.ref, { ...m, corps, morceaux: undefined });
  }

  // ---- Côté qui tient la session ------------------------------------------------------------------------------

  /** Relayés : une session, une machine ou le nœud, par une route de la liste fermée. Lire le fil abonne au direct. */
  private async repondreGeste(canal: CanalNoeud, recu: Extract<MessageChiffre, { t: 'geste' }>): Promise<void> {
    const refuser = (statut: number, texte: string): void =>
      void canal.envoyer({ t: 'geste_reponse', ref: recu.ref, statut, corps: JSON.stringify({ erreur: texte }) });
    const m = this.corpsEntier(canal.membre, recu);
    if (!m) return refuser(400, 'transfert interrompu');
    const pont = this.options.pont.geste;
    if (!pont) return refuser(501, 'geste non pris en charge par ce nœud');
    const porte = this.options.invites?.geste(canal.membre, m) ?? { ok: true as const, geste: m };
    if (!porte.ok) return refuser(porte.statut, porte.raison);
    const refus = this.refusGeste(m);
    if (refus) return refuser(404, refus);
    if (porte.geste.geste === 'evenements' && porte.geste.session) this.abonner(canal.membre, porte.geste.session);
    try {
      const reponse = await pont(porte.geste);
      this.envoyerReponse(canal, m.ref, await reponseGeste(reponse, m.geste));
    } catch (erreur) {
      this.options.journal.error({ err: erreur, geste: m.geste }, 'geste relayé en échec');
      refuser(500, 'geste en échec sur le nœud');
    }
  }

  // Le corps d'une requête reçue en morceaux, réuni ; null si le transfert est cassé.
  private corpsEntier(membre: string, m: Extract<MessageChiffre, { t: 'geste' }>): typeof m | null {
    if (m.morceaux === undefined) return m;
    const corps = this.transferts.assembler(membre, m.ref, m.morceaux);
    return corps === null ? null : { ...m, corps, morceaux: undefined };
  }

  // La réponse d'un geste : une trame si elle tient, sinon ses morceaux puis l'annonce de leur nombre.
  private envoyerReponse(canal: CanalNoeud, ref: string, r: CorpsGeste): void {
    const type = r.type ? { type: r.type } : {};
    const codage = r.codage ? { codage: r.codage } : {};
    if (r.corps.length <= TAILLE_MORCEAU_CARACTERES) {
      canal.envoyer({ t: 'geste_reponse', ref, statut: r.statut, corps: r.corps, ...type, ...codage });
      return;
    }
    for (const morceau of decouper(ref, r.corps)) canal.envoyer(morceau);
    const morceaux = nombreDeMorceaux(r.corps);
    canal.envoyer({ t: 'geste_reponse', ref, statut: r.statut, corps: '', morceaux, ...type, ...codage });
  }

  // Un geste relayé ne vise qu'une route de la liste : une session partagée (pas du duo), notre machine, ou le nœud.
  private refusGeste(m: Extract<MessageChiffre, { t: 'geste' }>): string | null {
    if (m.geste === 'ouvrir') return null;
    const portee: PorteeGeste = m.machine !== undefined ? 'machine' : m.session !== undefined ? 'session' : 'noeud';
    if (!estGesteRelayable(portee, m.geste)) return 'geste non relayable';
    if (portee === 'noeud') return null;
    if (portee === 'machine') return m.machine === this.options.machine ? null : 'machine inconnue';
    return m.session && this.sessionPartagee(m.session) ? null : 'session inconnue';
  }

  private sessionPartagee(session: string): boolean {
    const fiche = this.options.registre.session(session);
    return fiche !== null && !fiche.duo;
  }

  private repondreFil(canal: CanalNoeud, ref: string, session: string): void {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    this.abonner(canal.membre, session);
    const evenements = this.options.registre
      .derniersEvenements(session, TAILLE_FIL_FEDERE)
      .map((e) => ({ seq: e.seq, ts: e.ts, evt: e.evt }));
    const message = tenirDansLaLimite(evenements, (liste) => ({
      t: 'fil_reponse',
      ref,
      session,
      evenements: [...liste],
    }));
    canal.envoyer(message);
  }

  private abonner(membre: string, session: string): void {
    const suivies = this.abonnements.get(membre) ?? new Set<string>();
    if (suivies.size >= NOMBRE_MAX_ABONNEMENTS && !suivies.has(session)) return;
    suivies.add(session);
    this.abonnements.set(membre, suivies);
  }

  private async repondreEcriture(canal: CanalNoeud, ref: string, session: string, texte: string): Promise<void> {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    const r = await lireBilan(await this.options.pont.envoyer(session, texte));
    this.reponse(canal, ref, r.ok, r.raison);
  }

  private async repondreInterruption(canal: CanalNoeud, ref: string, session: string): Promise<void> {
    if (!this.sessionPartagee(session)) return this.reponse(canal, ref, false, 'session inconnue');
    const r = await lireBilan(await this.options.pont.interrompre(session));
    this.reponse(canal, ref, r.ok, r.raison);
  }

  private async repondreOuverture(
    canal: CanalNoeud,
    ref: string,
    machine: string,
    chemin: string,
    message: string,
  ): Promise<void> {
    if (machine !== this.options.machine) return this.reponse(canal, ref, false, 'machine inconnue');
    const nom = chemin.split('/').filter(Boolean).pop() ?? chemin;
    const demande: OuvertureChezProprietaire = {
      machine,
      projet: { machine, chemin, nom },
      message,
      autonomie: false,
      mode: 'default',
    };
    const r = await lireBilan(await this.options.pont.ouvrir(demande));
    if (!r.ok) return this.reponse(canal, ref, false, r.raison);
    const id = r.corps && typeof r.corps === 'object' && 'id' in r.corps ? String(r.corps.id) : undefined;
    this.reponse(canal, ref, id !== undefined, id === undefined ? 'session ouverte sans identifiant' : undefined, id);
  }

  /** Réponse à une requête d'un pair (ok, motif, session créée). */
  reponse(canal: CanalNoeud, ref: string, ok: boolean, raison?: string, session?: string): void {
    canal.envoyer({
      t: 'reponse',
      ref,
      ok,
      ...(raison !== undefined ? { raison } : {}),
      ...(session !== undefined ? { session } : {}),
    });
  }

  // ---- Côté qui consulte --------------------------------------------------------------------------------------

  private recevoirFil(canal: CanalNoeud, ref: string, session: string, evenements: readonly EvenementFedere[]): void {
    this.options.distant.remplacerFil(canal.membre, session, evenements);
    this.resoudre(ref, { t: 'fil_reponse', ref, session, evenements: [...evenements] });
  }
}
