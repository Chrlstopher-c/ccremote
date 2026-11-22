// Responsabilité : les synchronisations sur demande entre nœuds — une demande part vers un pair apparié, le pair
// la tranche (décision de Chris chez lui) ; seul un accord déclenche l'envoi du périmètre demandé, et le receveur
// applique une fusion. Tout se journalise des deux côtés. Les demandes vivent en mémoire, le journal sur disque.
import type { Logger } from 'pino';
import type { Diffusion } from '../clients/diffusion.ts';
import {
  compterElements,
  compterIdentifiants,
  DELAI_DEMANDE_SYNCHRO_MS,
  type DecisionSynchro,
  type DemandeSynchro,
  lireMessageSynchro,
  NOMBRE_MAX_DEMANDES_SYNCHRO,
  NOMBRE_MAX_IDENTIFIANTS_PAQUET,
  type PaquetSynchro,
  type PerimetreSynchro,
  paquetConforme,
  TAILLE_MAX_PAQUET_OCTETS,
  tailleOctets,
  type MessageSynchro,
} from '../../commun/synchro.ts';
import { nonceRef } from '../federation/identifiants.ts';
import { echec, ok, type Resultat } from '../federation/resultat.ts';
import { Doublons } from '../parc/doublons.ts';
import type { Registre } from '../registre/registre.ts';
import type { EntreeJournal, JournalSynchro } from './journal.ts';
import { appliquerPaquet, type BilanFusion, construirePaquet } from './paquet.ts';

/** Ce que le service attend du lien fédéré : son identifiant, et l'envoi d'un message à un pair apparié. */
export interface LienSynchro {
  identifiant(): string | null;
  envoyer(membre: string, message: MessageSynchro): Resultat<null>;
}

export interface OptionsSynchro {
  readonly registre: Registre;
  readonly diffusion: Diffusion;
  readonly lien: LienSynchro;
  readonly journal: JournalSynchro;
  readonly logger: Logger;
  readonly delaiMs?: number;
  /** Une demande reçue attend la décision de Chris : notification dans l'appli. */
  readonly surDemandeRecue?: (demande: DemandeSynchro) => void;
}

export type EtatSynchro = 'en-attente' | 'accordee' | 'refusee' | 'expiree' | 'appliquee';
type EtatFinal = 'refusee' | 'expiree' | 'appliquee';

export interface DemandeVue {
  readonly id: string;
  readonly genre: 'synchro';
  readonly quoi: readonly PerimetreSynchro[];
  readonly de: string;
  readonly vers: string;
  readonly le: string;
  readonly etat: EtatSynchro;
  readonly raison?: string;
}

interface Suivie {
  readonly demande: DemandeSynchro;
  etat: EtatSynchro;
  raison?: string;
  minuterie: ReturnType<typeof setTimeout> | null;
}

/** Demandes envoyées déjà tranchées gardées pour l'affichage (le journal, lui, garde tout). */
const NOMBRE_MAX_DEMANDES_TERMINEES = 20;

export class ServiceSynchro {
  private readonly recues = new Map<string, Suivie>();
  private readonly envoyees = new Map<string, Suivie>();

  constructor(private readonly options: OptionsSynchro) {}

  /** Demande à un pair apparié le périmètre indiqué. Rien n'est stocké si le message ne part pas. */
  demander(vers: string, quoi: readonly PerimetreSynchro[]): Resultat<DemandeVue> {
    const de = this.options.lien.identifiant();
    if (!de) return echec(409, 'nœud non relié à un aiguilleur');
    const demande: DemandeSynchro = {
      t: 'demande',
      id: nonceRef(),
      genre: 'synchro',
      quoi: [...quoi],
      de,
      vers,
      le: new Date().toISOString(),
    };
    const envoi = this.options.lien.envoyer(vers, demande);
    if (!envoi.ok) return echec(envoi.statut, envoi.raison);
    this.suivre(this.envoyees, demande, () => this.expirerEnvoyee(demande.id));
    this.journaliser('demandee', vers, demande.id, quoi);
    return ok(vue(demande, 'en-attente'));
  }

  /** La décision de Chris sur une demande reçue. Faux si elle n'existe pas (déjà tranchée ou expirée). */
  decider(id: string, accord: boolean): boolean {
    const suivie = this.recues.get(id);
    if (!suivie) return false;
    this.retirer(this.recues, id);
    if (accord) this.accorder(suivie.demande);
    else this.refuser(suivie.demande, 'refusé par le nœud visé');
    return true;
  }

  lister(): { recues: DemandeVue[]; envoyees: DemandeVue[] } {
    return {
      recues: [...this.recues.values()].map((s) => vue(s.demande, s.etat)),
      envoyees: [...this.envoyees.values()].map((s) => vue(s.demande, s.etat, s.raison)),
    };
  }

  journal(): EntreeJournal[] {
    return this.options.journal.lister();
  }

  /** Un message synchro d'un pair apparié, déjà authentifié par le canal chiffré. */
  recevoir(membre: string, brut: unknown): void {
    const lecture = lireMessageSynchro(brut);
    if (!lecture.ok) return this.rejeter(membre, '', lecture.raison);
    const message = lecture.message;
    if (message.t === 'demande') return this.recevoirDemande(membre, message);
    if (message.t === 'decision') return this.recevoirDecision(membre, message);
    return this.recevoirPaquet(membre, message);
  }

  arreter(): void {
    for (const carte of [this.recues, this.envoyees]) {
      for (const suivie of carte.values()) if (suivie.minuterie) clearTimeout(suivie.minuterie);
    }
  }

  // ---- Côté qui détient les données -----------------------------------------------------------------------------

  private recevoirDemande(membre: string, demande: DemandeSynchro): void {
    if (demande.de !== membre || demande.vers !== this.options.lien.identifiant()) {
      return this.rejeter(membre, demande.id, 'identités incohérentes', demande.quoi);
    }
    if (this.recues.has(demande.id)) return;
    if (this.recues.size >= NOMBRE_MAX_DEMANDES_SYNCHRO) {
      this.options.lien.envoyer(membre, { t: 'decision', id: demande.id, accord: false, raison: 'trop de demandes' });
      return this.rejeter(membre, demande.id, 'trop de demandes en attente', demande.quoi);
    }
    this.suivre(this.recues, demande, () => this.expirerRecue(demande.id));
    this.journaliser('recue', membre, demande.id, demande.quoi);
    this.options.surDemandeRecue?.(demande);
  }

  private accorder(demande: DemandeSynchro): void {
    const paquet = construirePaquet(this.options.registre, demande.id, demande.quoi);
    if (tropGrand(paquet)) return this.refuser(demande, 'paquet trop grand');
    const decision: DecisionSynchro = { t: 'decision', id: demande.id, accord: true };
    if (!this.options.lien.envoyer(demande.de, decision).ok) return this.envoiImpossible(demande);
    if (!this.options.lien.envoyer(demande.de, paquet).ok) return this.envoiImpossible(demande);
    this.journaliser('accordee', demande.de, demande.id, demande.quoi);
    this.journaliser('envoyee', demande.de, demande.id, demande.quoi, { elements: compterElements(paquet) });
  }

  private refuser(demande: DemandeSynchro, raison: string): void {
    const decision: DecisionSynchro = { t: 'decision', id: demande.id, accord: false, raison };
    this.options.lien.envoyer(demande.de, decision);
    this.journaliser('refusee', demande.de, demande.id, demande.quoi, { detail: raison });
  }

  private envoiImpossible(demande: DemandeSynchro): void {
    this.journaliser('rejetee', demande.de, demande.id, demande.quoi, { detail: 'envoi impossible' });
  }

  private expirerRecue(id: string): void {
    const suivie = this.recues.get(id);
    if (!suivie) return;
    this.retirer(this.recues, id);
    const decision: DecisionSynchro = { t: 'decision', id, accord: false, raison: 'expirée', expiree: true };
    this.options.lien.envoyer(suivie.demande.de, decision);
    this.journaliser('expiree', suivie.demande.de, id, suivie.demande.quoi);
  }

  // ---- Côté qui demande -----------------------------------------------------------------------------------------

  private recevoirDecision(membre: string, decision: DecisionSynchro): void {
    const suivie = this.envoyees.get(decision.id);
    if (!suivie || suivie.demande.vers !== membre || suivie.etat !== 'en-attente') {
      return this.rejeter(membre, decision.id, 'décision sans demande en attente');
    }
    if (decision.accord) {
      suivie.etat = 'accordee';
      this.signaler();
      return this.journaliser('accordee', membre, decision.id, suivie.demande.quoi);
    }
    const etat = decision.expiree ? 'expiree' : 'refusee';
    this.terminer(suivie, etat, decision.raison);
  }

  private recevoirPaquet(membre: string, paquet: PaquetSynchro): void {
    const suivie = this.envoyees.get(paquet.id);
    if (!suivie || suivie.demande.vers !== membre || suivie.etat !== 'accordee') {
      return this.rejeter(membre, paquet.id, 'paquet sans accord');
    }
    if (!paquetConforme(paquet, suivie.demande.quoi)) {
      return this.rejeter(membre, paquet.id, 'paquet hors périmètre', suivie.demande.quoi);
    }
    this.appliquer(suivie, paquet);
  }

  private appliquer(suivie: Suivie, paquet: PaquetSynchro): void {
    try {
      const resultat = appliquerPaquet(this.options.registre, paquet);
      new Doublons(this.options.registre, this.options.diffusion, this.options.logger).reconcilier();
      this.terminer(suivie, 'appliquee', undefined, resultat.bilan);
      for (const id of resultat.sessions) this.diffuserSession(id);
    } catch (erreur) {
      this.options.logger.error({ err: erreur }, 'synchro : fusion impossible');
      this.rejeter(suivie.demande.vers, paquet.id, 'écriture impossible', suivie.demande.quoi);
    }
  }

  private expirerEnvoyee(id: string): void {
    const suivie = this.envoyees.get(id);
    if (!suivie) return;
    const raison = suivie.etat === 'accordee' ? 'paquet non reçu' : 'pas de décision';
    this.terminer(suivie, 'expiree', raison);
  }

  // ---- Outils ---------------------------------------------------------------------------------------------------

  private terminer(suivie: Suivie, etat: EtatFinal, raison?: string, bilan?: BilanFusion): void {
    if (suivie.minuterie) clearTimeout(suivie.minuterie);
    suivie.minuterie = null;
    suivie.etat = etat;
    suivie.raison = raison;
    this.journaliser(etat, suivie.demande.vers, suivie.demande.id, suivie.demande.quoi, {
      ...(raison ? { detail: raison } : {}),
      ...(bilan ? { bilan } : {}),
    });
    this.bornerTerminees();
    this.signaler();
  }

  private suivre(carte: Map<string, Suivie>, demande: DemandeSynchro, expirer: () => void): void {
    const minuterie = setTimeout(expirer, this.options.delaiMs ?? DELAI_DEMANDE_SYNCHRO_MS);
    carte.set(demande.id, { demande, etat: 'en-attente', minuterie });
    this.signaler();
  }

  private retirer(carte: Map<string, Suivie>, id: string): void {
    const suivie = carte.get(id);
    if (suivie?.minuterie) clearTimeout(suivie.minuterie);
    carte.delete(id);
    this.signaler();
  }

  private bornerTerminees(): void {
    const finies = [...this.envoyees.entries()].filter(([, s]) => s.etat !== 'en-attente' && s.etat !== 'accordee');
    for (const [id] of finies.slice(0, Math.max(0, finies.length - NOMBRE_MAX_DEMANDES_TERMINEES))) {
      this.envoyees.delete(id);
    }
  }

  private rejeter(membre: string, demande: string, raison: string, quoi: readonly PerimetreSynchro[] = []): void {
    this.options.logger.warn({ pair: membre, demande, raison }, 'synchro : message refusé');
    this.options.journal.ajouter({ sens: 'rejetee', pair: membre, demande, quoi: [...quoi], detail: raison });
  }

  private journaliser(
    sens: EntreeJournal['sens'],
    pair: string,
    demande: string,
    quoi: readonly PerimetreSynchro[],
    extra: Partial<Pick<EntreeJournal, 'detail' | 'bilan' | 'elements'>> = {},
  ): void {
    this.options.journal.ajouter({ sens, pair, demande, quoi: [...quoi], ...extra });
  }

  private diffuserSession(id: string): void {
    const session = this.options.registre.session(id);
    if (session) this.options.diffusion.diffuser({ type: 'session', session });
  }

  private signaler(): void {
    this.options.diffusion.diffuser({ type: 'synchro_modifie' });
  }
}

function vue(demande: DemandeSynchro, etat: EtatSynchro, raison?: string): DemandeVue {
  return {
    id: demande.id,
    genre: 'synchro',
    quoi: demande.quoi,
    de: demande.de,
    vers: demande.vers,
    le: demande.le,
    etat,
    ...(raison ? { raison } : {}),
  };
}

function tropGrand(paquet: PaquetSynchro): boolean {
  const trop = compterIdentifiants(paquet) > NOMBRE_MAX_IDENTIFIANTS_PAQUET;
  return trop || tailleOctets(paquet) > TAILLE_MAX_PAQUET_OCTETS;
}
