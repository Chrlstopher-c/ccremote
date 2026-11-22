// Responsabilité : la liaison du duo avec l'aiguilleur — les canaux du duo reçus du lien de la fédération (un seul lien
// par nœud), la reprise du lien confirmé quand le pair est en ligne, et l'appairage (code, identités, décision de Chris
// des deux côtés). Ne touche ni aux sessions ni aux partages : les messages du duo sont remis à Duo par `pont`.
import type { Logger } from 'pino';
import type { MessageDeAiguilleur } from '../../commun/aiguilleur.ts';
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import { empreinteIdentite, importerIdentitePublique } from '../../commun/chiffrement/identite.ts';
import type { EtatAiguilleurDuo, MessageLien } from '../../commun/duo.ts';
import {
  type Appairage,
  type HandlerDuoAiguilleur,
  nonceCanalDuo,
  type PortAiguilleurDuo,
  preuveAppairage,
  preuveAppairageValide,
} from '../../commun/duo-aiguilleur.ts';
import {
  CanalDuo,
  type DelaisCanal,
  type Distant,
  type HoteCanal,
  type Intention,
  type Role,
} from './canal-aiguilleur.ts';
import type { CodesAppairage } from './codes.ts';
import type { Paire, PaireStockee } from './paire-stockee.ts';
import { nonce } from './preuve.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import type { Canal } from './lien-commun.ts';

export const DELAIS_DUO_AIGUILLEUR: DelaisCanal = {
  ouverture: 10_000,
  message: 10_000,
  decision: 10 * 60 * 1000,
  poignee: 20_000,
};
const INTERVALLE_PLANIFICATION_MS = 2_000;
const DELAI_REESSAI_MS = 60_000;

/** Ce que Duo offre à la liaison : remise des messages et du lien, refus, notification de changement. */
export interface PontLiaison {
  liaison(canal: Canal): void;
  fermee(canal: Canal): void;
  recevoir(paire: string, m: MessageLien): void;
  refus(raison: string): void;
  notifier(): void;
}

export interface OptionsLiaison {
  readonly port: PortAiguilleurDuo;
  readonly paires: PaireStockee;
  readonly codes: CodesAppairage;
  readonly pont: PontLiaison;
  readonly utilisateur: string;
  readonly nomLocal: () => string;
  readonly journal: Logger;
  readonly maintenant: () => number;
  readonly delais?: DelaisCanal;
  readonly intervallePlanificationMs?: number;
}

interface EnAttente {
  readonly canal: CanalDuo;
  readonly distant: Distant;
  readonly empreintes: { readonly locale: string; readonly distante: string };
}

type Resolution = (r: Resultat<null>) => void;

export class LiaisonAiguilleur implements HandlerDuoAiguilleur {
  private readonly canaux = new Map<string, CanalDuo>();
  private readonly demandes = new Map<string, Resolution>();
  private readonly reessai = new Map<string, number>();
  private readonly hote: HoteCanal;
  private readonly delais: DelaisCanal;
  private attente: EnAttente | null = null;
  private locale: string | null = null;
  private planificateur: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: OptionsLiaison) {
    this.delais = options.delais ?? DELAIS_DUO_AIGUILLEUR;
    this.hote = this.creerHote();
  }

  /** Calcule l'empreinte de ce nœud une fois : l'état du duo se lit de façon synchrone. */
  async preparer(): Promise<void> {
    this.locale = await empreinteIdentite((await this.options.port.identiteLocale()).publique);
  }

  demarrer(): void {
    this.preparer().catch((erreur: unknown) =>
      this.options.journal.error({ err: erreur }, 'duo : empreinte locale absente'),
    );
    this.planificateur ??= setInterval(
      () => this.planifier(),
      this.options.intervallePlanificationMs ?? INTERVALLE_PLANIFICATION_MS,
    );
  }

  arreter(): void {
    if (this.planificateur) clearInterval(this.planificateur);
    this.planificateur = null;
    for (const canal of [...this.canaux.values()]) canal.fermer('duo arrêté');
  }

  /** Identifiant de ce nœud sur l'aiguilleur (null si le nœud n'y est pas relié). */
  membre(): string | null {
    return this.options.port.membreLocal();
  }

  etat(): EtatAiguilleurDuo {
    const paire = this.options.paires.lire();
    const attente = this.attente;
    const aiguilleur = paire?.transport === 'aiguilleur';
    return {
      transport: paire ? (aiguilleur ? 'aiguilleur' : 'direct') : null,
      empreintes:
        aiguilleur && this.locale && paire?.empreinte ? { locale: this.locale, distante: paire.empreinte } : null,
      appairage: attente
        ? {
            nom: attente.distant.nom,
            utilisateur: attente.distant.utilisateur,
            decisionLocale: attente.canal.decisionLocale,
            empreintes: attente.empreintes,
          }
        : null,
    };
  }

  /** Demande d'appairage à un nœud : résolue quand les deux présentations sont échangées (empreintes à comparer). */
  demanderAppairage(membre: string, code: string): Promise<Resultat<null>> {
    const refus = this.refusDemande(membre);
    if (refus) return Promise.resolve(refus);
    return new Promise((resoudre) => {
      const id = nonceCanalDuo();
      this.demandes.set(id, resoudre);
      const canal = this.creer(id, membre, 'appairage', 'ouvrant', code);
      if (!this.options.port.envoyer({ t: 'ouvrir', canal: canal.id, vers: membre })) {
        canal.fermer('aiguilleur indisponible');
      }
    });
  }

  /** Décision de Chris sur les empreintes : accord, ou refus qui annule l'appairage des deux côtés. */
  decider(accord: boolean): Resultat<null> {
    const attente = this.attente;
    if (!attente) return echec(404, 'aucun appairage en attente');
    if (attente.canal.phase !== 'decision') return echec(409, 'appairage pas encore prêt');
    attente.canal.decider(accord);
    this.options.pont.notifier();
    return ok(null);
  }

  /** Révocation pendant un appairage en attente : le pair en est prévenu. */
  annuler(): void {
    this.attente?.canal.decider(false);
  }

  // ---- Lien de la fédération : messages du duo et vie du lien ---------------------------------------------------

  surConnexion(connecte: boolean): void {
    if (connecte) return this.planifier();
    for (const canal of [...this.canaux.values()]) canal.surFermetureDistante('lien avec l’aiguilleur coupé');
  }

  surMessage(message: MessageDeAiguilleur): void {
    if (message.t === 'ouvrir') return this.accueillir(message.canal, message.de);
    if (message.t === 'presence') return;
    if (message.t === 'erreur') return this.erreur(message.motif, message.canal);
    const canal = this.canaux.get(message.canal);
    if (!canal) return this.options.journal.warn({ canal: message.canal, t: message.t }, 'duo : canal inconnu');
    if (message.t === 'accepter') return void canal.surAccepter();
    if (message.t === 'refuser') return canal.surRefus();
    if (message.t === 'donnees') return void canal.surDonnees(message.charge);
    canal.surFermetureDistante('fermé par le pair');
  }

  // ---- Ouverture et accueil -----------------------------------------------------------------------------------

  private accueillir(id: string, de: string): void {
    const intention = this.intentionPour(de);
    if (this.canaux.has(id) || intention === null || this.canalActifAvec(de)) {
      this.options.journal.warn({ de, intention }, 'duo : ouverture refusée');
      return void this.envoyer({ t: 'refuser', canal: id });
    }
    this.creer(id, de, intention, 'accepteur');
    this.envoyer({ t: 'accepter', canal: id });
  }

  // Un pair confirmé ouvre le lien ; un inconnu ne peut qu'appairer, si un code vit et qu'aucun appairage n'attend.
  private intentionPour(de: string): Intention | null {
    if (this.paireDe(de)) return 'lien';
    if (this.options.paires.lire() || this.appairageEnCours() || this.options.codes.vivants().length === 0) return null;
    return 'appairage';
  }

  // Un seul appairage à la fois : un canal qui négocie ses présentations compte, comme une décision qui attend.
  private appairageEnCours(): boolean {
    return this.attente !== null || [...this.canaux.values()].some((c) => c.intention === 'appairage' && c.actif);
  }

  private refusDemande(membre: string): Resultat<null> | null {
    if (this.appairageEnCours()) return echec(409, 'un appairage est déjà en cours');
    if (!this.options.port.relie()) return echec(503, 'aiguilleur non relié');
    if (this.canalActifAvec(membre)) return echec(409, 'un échange est déjà en cours avec ce nœud');
    return null;
  }

  // Le plus petit identifiant ouvre le lien confirmé : un seul canal par paire, sans collision à l'ouverture.
  private planifier(): void {
    const moi = this.options.port.membreLocal();
    const paire = this.options.paires.lire();
    if (!moi || !paire || paire.transport !== 'aiguilleur' || !paire.membre) return;
    if (!this.options.port.relie() || paire.membre <= moi) return;
    if (this.canalActifAvec(paire.membre)) return;
    if ((this.reessai.get(paire.membre) ?? 0) > this.options.maintenant()) return;
    this.ouvrirLien(paire.membre);
  }

  private ouvrirLien(membre: string): void {
    const canal = this.creer(nonceCanalDuo(), membre, 'lien', 'ouvrant');
    if (!this.options.port.envoyer({ t: 'ouvrir', canal: canal.id, vers: membre })) {
      canal.fermer('aiguilleur indisponible');
    }
  }

  private creer(id: string, membre: string, intention: Intention, role: Role, code: string | null = null): CanalDuo {
    const canal = new CanalDuo(id, membre, intention, role, this.hote, code);
    this.canaux.set(id, canal);
    return canal;
  }

  private envoyer(message: MessageVersAiguilleur): boolean {
    return this.options.port.envoyer(message);
  }

  private canalActifAvec(membre: string): boolean {
    return [...this.canaux.values()].some((c) => c.membre === membre && c.actif);
  }

  private paireDe(membre: string): Paire | null {
    const p = this.options.paires.lire();
    return p?.transport === 'aiguilleur' && p.membre === membre ? p : null;
  }

  private erreur(motif: string, canal?: string): void {
    this.options.journal.warn({ motif, canal }, 'duo : erreur de l’aiguilleur');
    if (canal !== undefined) this.canaux.get(canal)?.surFermetureDistante(motif);
  }

  // ---- Hôte des canaux ----------------------------------------------------------------------------------------

  private creerHote(): HoteCanal {
    const o = this.options;
    return {
      journal: o.journal,
      delais: this.delais,
      membreLocal: () => o.port.membreLocal() ?? '',
      utilisateurLocal: () => o.utilisateur,
      nomLocal: () => o.nomLocal(),
      identiteLocale: () => o.port.identiteLocale(),
      envoyerAiguilleur: (m) => this.envoyer(m),
      codeValide: (canal, m) => this.codeValide(canal, m),
      appairageRecu: (canal, distant) => void this.appairageRecu(canal, distant),
      appairageConfirme: (canal) => this.appairageConfirme(canal),
      identitePaire: (membre) => this.paireDe(membre)?.identite ?? null,
      liaisonOuverte: (canal) => o.pont.liaison(canal),
      messageRecu: (canal, m) => this.messageRecu(canal, m),
      canalFerme: (canal, raison, refuse) => this.canalFerme(canal, raison, refuse),
    };
  }

  // La preuve doit venir d'un code vivant, lié à ce demandeur et à son identité ; un code utilisé est brûlé.
  private codeValide(canal: CanalDuo, m: Appairage): boolean {
    const visee = this.options.port.membreLocal() ?? '';
    for (const code of this.options.codes.vivants()) {
      if (!preuveAppairageValide(preuveAppairage(code, visee, canal.membre, m.identite), m.preuve)) continue;
      return this.options.codes.consommer(code) === 'ok';
    }
    this.options.codes.echec();
    this.options.journal.warn({ de: canal.membre }, 'duo : preuve d’appairage fausse');
    return false;
  }

  private async appairageRecu(canal: CanalDuo, distant: Distant): Promise<void> {
    try {
      const locale = this.locale ?? (await empreinteIdentite((await this.options.port.identiteLocale()).publique));
      const distante = await empreinteIdentite(await importerIdentitePublique(distant.identite));
      this.attente = { canal, distant, empreintes: { locale, distante } };
      this.resoudre(canal.id, ok(null));
      this.options.pont.notifier();
    } catch (erreur) {
      this.options.journal.error({ err: erreur }, 'duo : identité du pair illisible');
      canal.fermer('identité illisible');
    }
  }

  // Les deux côtés ont accepté les empreintes : la paire est enregistrée, la poignée peut suivre.
  private appairageConfirme(canal: CanalDuo): boolean {
    const attente = this.attente;
    if (!attente || attente.canal !== canal || this.options.paires.lire()) return false;
    try {
      this.options.paires.ecrire({
        id: nonce(),
        cle: '',
        utilisateur: attente.distant.utilisateur,
        adresse: null,
        creeLe: new Date(this.options.maintenant()).toISOString(),
        transport: 'aiguilleur',
        membre: canal.membre,
        identite: attente.distant.identite,
        empreinte: attente.empreintes.distante,
      });
    } catch {
      return false;
    }
    this.attente = null;
    this.options.pont.notifier();
    return true;
  }

  private messageRecu(canal: CanalDuo, m: MessageLien): void {
    const paire = this.paireDe(canal.membre);
    if (paire) this.options.pont.recevoir(paire.id, m);
  }

  private canalFerme(canal: CanalDuo, raison: string, refuse: boolean): void {
    if (this.canaux.get(canal.id) === canal) this.canaux.delete(canal.id);
    this.resoudre(canal.id, echec(502, raison));
    if (this.attente?.canal === canal) this.attente = null;
    this.options.pont.fermee(canal);
    if (canal.role === 'ouvrant' && canal.intention === 'lien' && !canal.ouvert) {
      this.reessai.set(canal.membre, this.options.maintenant() + DELAI_REESSAI_MS);
    }
    if (refuse && canal.intention === 'lien') this.options.pont.refus(raison);
    this.options.journal.info({ canal: canal.id, intention: canal.intention, raison }, 'duo : canal fermé');
    this.options.pont.notifier();
  }

  private resoudre(id: string, r: Resultat<null>): void {
    const f = this.demandes.get(id);
    if (!f) return;
    this.demandes.delete(id);
    f(r);
  }
}
