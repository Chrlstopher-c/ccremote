// Responsabilité : UNE session Remote Control d'un compte, vue depuis le poste par l'API de claude.ai. Implémente le
// contrat SessionPoste : historique relu (~400 derniers événements), suivi du fil en direct, pilotage (message,
// interruption, réglages, réponse aux permissions et questions). Rien n'est écrit sur disque.
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { PieceJointe } from '../../commun/presentation.ts';
import { type Evenement, ModeSession, type ReponseDialogue, type ResumeSession } from '../../commun/session.ts';
import { champsReglage } from '../session/reglages-sdk.ts';
import type { SessionPersistee } from '../session/persistance.ts';
import type { Reglage, ReponseCrochet, SessionPoste, SortieSession } from '../session/session-poste.ts';
import { type EtatTraduction, nouvelEtatTraduction } from '../session/traduction-sdk.ts';
import { type ResultatApi, envoyerEvenement, lireEvenements } from './client-claude-ai.ts';
import { type EvenementBrut, type SessionBrute, lireEvenement } from './donnees.ts';
import { objet, texte } from '../comptes/valeurs.ts';
import { type ModeleDate, plusRecent } from '../../commun/modele-date.ts';
import { FluxDistant, type TrameSse } from './flux-distant.ts';
import {
  demandeCloseePar,
  demandeEntrante,
  contenuAvecImages,
  messageUtilisateur,
  reponseControle,
  requeteControle,
  requeteReglage,
} from './controle-distant.ts';
import { AttenteDistante, type Resolution, titreDe } from './attente-distante.ts';
import { type ContexteDistant, resumeDistant } from './resume-distant.ts';
import { type StockeurPieces, traduireLot } from './traduction-distante.ts';
import { stockeurPieces } from './pieces-distantes.ts';
import type { Stockage } from '../presentation/stockage.ts';

export const PAS_ENCORE_CLAUDE_AI = 'pilotage claude.ai : pas encore pris en charge';

// Modèle qu'un événement du fil annonce : `system/init`, ou un message assistant (jamais un modèle « <…> »).
export function modeleDuFil(payload: unknown): string | null {
  const p = objet(payload);
  if (texte(p['type']) === 'system' && texte(p['subtype']) === 'init') return texte(p['model']);
  if (texte(p['type']) !== 'assistant') return null;
  const modele = texte(objet(p['message'])['model']);
  return modele !== null && !modele.startsWith('<') ? modele : null;
}
const PIECES_REFUSEES = 'à distance, seules les images peuvent être jointes';
const REGLAGE_REFUSE = 'réglage non pris en charge à distance';
const APPAREIL_REFUSE = 'Ce compte exige un appareil de confiance pour piloter cette session';
const JETON_EXPIRE = 'jeton expiré : reconnecte le compte';

const TAILLE_PAGE = 100;
const PAGES_HISTORIQUE = 4; // ~400 derniers événements au premier chargement
const PAGES_DIRECT = 5; // plafond d'une lecture de suivi : au-delà, le reste n'est pas relu
const TAILLE_PAGE_DIRECT = 30; // relu toutes les 5 s pendant un tour : petite page, la suivante si besoin

export interface DependancesDistante {
  readonly contexte: ContexteDistant;
  readonly configDir: string | null;
  readonly journal: Logger;
  readonly sortie: SortieSession;
  /** Republie le résumé après un changement (dialogue, erreur, réglage). */
  readonly publier: () => void;
  /** Stockage des pièces du fil (images, documents) ; sans lui, elles deviennent des pastilles. */
  readonly stockage?: Stockage;
  /** Modèle réglé par Remote Control et accepté par claude.ai : le poste le garde pour la conversation. */
  readonly surModele?: (conversation: string, modele: ModeleDate) => void;
}

type EchecEnvoi = Extract<ResultatApi<null>, { ok: false }>;

const REPUBLICATION_MS = 30_000;

/** La session travaille (ou attend Chris) selon claude.ai : son fil avance sans que last_event_at ne bouge. */
export function enTour(travail: string | null): boolean {
  return travail === 'running' || travail === 'requires_action';
}

export class SessionDistante implements SessionPoste {
  // Le résumé publié se dérive de `base` (l'état de la liste, réglages compris) plus le dialogue et les erreurs.
  private base: ResumeSession;
  resume: ResumeSession;
  readonly identifiants: readonly string[] = [];
  readonly transcriptConnu = false;
  private etat: EtatTraduction = nouvelEtatTraduction();
  private readonly attente = new AttenteDistante();
  private vus = new Set<string>(); // identifiants des événements déjà traités : jamais deux fois le même
  private derniereListe: string | null; // dernier événement vu dans la liste claude.ai (repère du suivi)
  private vuJusqua: string | null = null; // le même repère, au moment où le fil a été lu pour la dernière fois
  private chargee = false; // historique lu avec succès : sans lui, le premier passage recommence
  private probleme: string | null = null; // erreur de la liste ou du fil (tour suivant : réessai)
  private problemePilotage: string | null = null; // erreur du dernier envoi (levée par le prochain succès)
  private publie = ''; // dernier résumé publié, pour ne publier que les changements
  private modeVu: ModeSession | null = null; // dernier mode de permission annoncé par la session (system)
  // Modèle réel vu dans le fil ou réglé par Remote Control : il l'emporte sur celui de la liste claude.ai, qui ne suit
  // pas un /model fait dans Claude Desktop.
  private modeleVu: ModeleDate | null = null;
  private cwdVu: string | null = null; // dossier de travail annoncé par la session (system/init)
  // conversation Claude Code (session_id du fil) : rapproche la jumelle du poste
  private conversationVue: string | null = null;
  private travail: string | null; // worker_status de la liste : pendant un tour, le fil est relu à chaque passage
  private readonly pieces: StockeurPieces | undefined;
  private flux: FluxDistant | null = null; // flux SSE : porte le fil en direct, le sondage sert de secours
  private fluxRefuse = false; // refus durable du flux : pas de nouvel essai avant le prochain changement de travail
  private combler = false; // le flux a signalé un trou (catch_up_truncated) : le fil est relu une fois
  private dernierSeq: number | null = null; // plus haut numéro de séquence vu : la reprise du flux part de là

  constructor(
    private readonly d: DependancesDistante,
    brute: SessionBrute,
  ) {
    this.derniereListe = brute.dernierEvenement;
    this.travail = brute.travail;
    this.pieces = d.stockage ? stockeurPieces(d.stockage, brute.id, d.journal) : undefined;
    this.base = resumeDistant(brute, d.contexte, new Date().toISOString());
    this.resume = this.avecEtat(this.base);
  }

  get persistee(): SessionPersistee {
    const { resume, d } = this;
    return { resume, consignes: null, configDir: d.configDir, transcript: null, position: 0, aReprendre: false };
  }

  get vivante(): boolean {
    return this.resume.distant?.connexion === 'connectee';
  }

  /** Met le résumé et le fil à jour depuis la liste : historique au premier passage, suite ensuite. Rend l'erreur. */
  async synchroniser(brute: SessionBrute): Promise<string | null> {
    const travaillait = this.travail;
    this.derniereListe = brute.dernierEvenement;
    this.travail = brute.travail;
    this.base = resumeDistant(brute, this.d.contexte, this.base.creeLe);
    this.maj();
    if (!this.chargee) {
      const erreur = this.erreurDe(await this.charger());
      if (this.chargee) this.gererFlux(brute.travail, brute.travail);
      return erreur;
    }
    this.gererFlux(brute.travail, travaillait);
    const comble = this.combler;
    this.combler = false;
    // Flux vivant pendant un tour : il pousse le fil, le sondage ne revient qu'en secours.
    if (!comble && this.fluxVivant() && enTour(brute.travail)) return null;
    // last_event_at ne bouge qu'en fin de tour (événement `result`) : pendant un tour, ou au passage qui le clôt, le
    // fil est relu quand même, sinon message de Chris, outils et texte n'arrivent qu'à la fin.
    if (!comble && this.derniereListe === this.vuJusqua && !enTour(brute.travail) && !enTour(travaillait)) return null;
    return this.erreurDe(await this.suivre());
  }

  // Le flux s'ouvre à la première synchronisation du fil et reste ouvert tant que la session est suivie. Un refus
  // durable n'est retenté qu'au prochain changement d'état de travail.
  private gererFlux(travail: string | null, avant: string | null): void {
    if (travail !== avant) this.fluxRefuse = false;
    if (this.flux || this.fluxRefuse) return;
    const flux = new FluxDistant({
      configDir: this.d.configDir,
      idSession: this.resume.id,
      journal: this.d.journal,
      depuis: this.dernierSeq,
      surTrame: (trame: TrameSse) => this.trameDirecte(trame),
      surRefus: (statut: number) => this.refusFlux(statut),
    });
    this.flux = flux;
    flux.demarrer();
  }

  private fluxVivant(): boolean {
    return this.flux?.vivant === true;
  }

  /** Ferme le flux de la session (session retirée du suivi, arrêt du poste). */
  arreterFlux(): void {
    this.flux?.arreter();
    this.flux = null;
  }

  private refusFlux(statut: number): void {
    this.flux = null;
    this.fluxRefuse = true;
    this.d.journal.warn({ statut }, 'flux Remote Control refusé : fil relu par sondage');
  }

  // Une trame du flux : un événement du fil est traité une seule fois (identifiant), un trou demande une relecture.
  private trameDirecte(trame: TrameSse): void {
    if (trame.event === 'catch_up_truncated') {
      this.combler = true;
      return;
    }
    if (trame.event !== 'client_event') return;
    let json: unknown;
    try {
      json = JSON.parse(trame.data);
    } catch (erreur) {
      this.d.journal.warn({ err: erreur }, 'flux claude.ai : trame illisible, ignorée');
      return;
    }
    const brut = lireEvenement(json);
    if (brut === null || this.vus.has(brut.id)) return;
    this.appliquer([brut]);
    this.publier();
  }

  /** Le résumé s'il a changé depuis la dernière publication, sinon null. */
  // Republiée au moins toutes les 30 s même inchangée : au démarrage, le premier relevé peut finir avant que le
  // lien avec le relais soit ouvert, et une publication perdue ne doit pas cacher la session jusqu'au changement suivant.
  private publieLe = 0;

  resumePourPublication(maintenant: number = Date.now()): ResumeSession | null {
    const signature = JSON.stringify(this.resume);
    if (signature === this.publie && maintenant - this.publieLe < REPUBLICATION_MS) return null;
    this.publie = signature;
    this.publieLe = maintenant;
    return this.resume;
  }

  marquerProbleme(probleme: string | null): void {
    this.probleme = probleme;
    this.maj();
  }

  /** La session n'est plus dans la liste active de claude.ai : elle est rangée ou la connexion est tombée. */
  passerFermee(): void {
    this.arreterFlux();
    const distant = this.base.distant ?? null;
    this.base = {
      ...this.base,
      statut: 'fermee',
      distant: distant ? { ...distant, connexion: 'deconnectee' } : null,
    };
    this.maj();
  }

  /** Historique : relit les derniers événements (le fil repart de zéro), les émet en lot dans l'ordre d'origine. */
  async charger(): Promise<ResultatApi<number>> {
    this.etat = nouvelEtatTraduction();
    this.vus = new Set();
    const r = await this.lirePages(PAGES_HISTORIQUE, () => false, TAILLE_PAGE);
    if (!r.ok) return r;
    const chronologique = [...r.donnees].reverse();
    const evenements = traduireLot(chronologique, this.etat, this.pieces);
    this.releverMode(chronologique);
    this.traiterControle(chronologique, false);
    for (const e of r.donnees) this.vus.add(e.id);
    this.avancerSeq(r.donnees);
    this.vuJusqua = this.derniereListe;
    this.chargee = true;
    if (evenements.length > 0) this.d.sortie.historique?.(this.resume.id, evenements);
    return { ok: true, donnees: evenements.length };
  }

  /** Suivi en direct : émet un à un les événements arrivés depuis le dernier passage. */
  async suivre(): Promise<ResultatApi<number>> {
    const r = await this.lirePages(PAGES_DIRECT, (id) => this.vus.has(id), TAILLE_PAGE_DIRECT);
    if (!r.ok) return r;
    const nouveaux = [...r.donnees].reverse();
    this.vuJusqua = this.derniereListe;
    this.appliquer(nouveaux);
    return { ok: true, donnees: nouveaux.length };
  }

  // Événements nouveaux, du plus ancien au plus récent : repères, mode, demandes, traduction, émission dans le fil.
  private appliquer(lot: readonly EvenementBrut[]): void {
    for (const e of lot) this.vus.add(e.id);
    this.avancerSeq(lot);
    this.releverMode(lot);
    const questions = this.traiterControle(lot, true);
    for (const h of traduireLot(lot, this.etat, this.pieces)) this.d.sortie.evenement(this.resume.id, h.evt);
    for (const evt of questions) this.d.sortie.evenement(this.resume.id, evt);
  }

  private avancerSeq(lot: readonly EvenementBrut[]): void {
    for (const seq of lot.map((e) => e.seq ?? null)) {
      if (seq !== null && (this.dernierSeq === null || seq > this.dernierSeq)) this.dernierSeq = seq;
    }
  }

  // Les demandes de Claude (permission, question, plan) entrent dans la file ; les messages qui les closent en sortent.
  // En direct, une nouvelle demande est annoncée dans le fil (événement `question`), comme au terminal.
  private traiterControle(brutes: readonly EvenementBrut[], direct: boolean): Evenement[] {
    const annonces: Evenement[] = [];
    let change = false;
    for (const b of brutes) {
      const demande = demandeEntrante(b.payload);
      if (demande) {
        const nouvelle = this.attente.ajouter(demande);
        change = change || nouvelle !== null;
        if (nouvelle && direct) annonces.push({ type: 'question', question: titreDe(nouvelle) });
        continue;
      }
      const close = demandeCloseePar(b.payload);
      change = (close !== null && this.attente.fermer(close)) || change;
    }
    if (change) this.maj();
    return annonces;
  }

  private erreurDe(r: ResultatApi<number>): string | null {
    this.probleme = r.ok ? null : r.probleme;
    return this.probleme;
  }

  /** Le résumé tel que Quart le publie : dialogue et erreurs de pilotage par-dessus l'état de la liste. */
  private avecEtat(base: ResumeSession): ResumeSession {
    const dialogue = base.statut === 'fermee' ? null : this.attente.dialogue();
    const distant = base.distant ?? null;
    return {
      ...base,
      statut: dialogue ? 'question' : base.statut,
      dialogue,
      distant: distant ? { ...distant, probleme: this.problemePilotage ?? this.probleme } : null,
    };
  }

  private maj(): void {
    const etat = this.avecEtat(this.base);
    const avecModele = this.modeleVu ? { ...etat, modele: this.modeleVu.modele, modeleLe: this.modeleVu.le } : etat;
    const avecCwd =
      this.cwdVu !== null && avecModele.distant
        ? { ...avecModele, distant: { ...avecModele.distant, cwd: this.cwdVu } }
        : avecModele;
    const conversation = this.conversationVue;
    const avecConv =
      conversation !== null && avecCwd.distant
        ? { ...avecCwd, distant: { ...avecCwd.distant, conversation } }
        : avecCwd;
    this.resume = this.modeVu === null ? avecConv : { ...avecConv, mode: this.modeVu };
  }

  // Le modèle le plus récent l'emporte ; à égalité, ou quand le nouveau n'a pas de date, le modèle déjà vu reste.
  private rendreModele(nouveau: ModeleDate): void {
    if (this.modeleVu && plusRecent(this.modeleVu, nouveau) === this.modeleVu) return;
    this.modeleVu = nouveau;
  }

  /**
   * Mode de permission, dossier de travail et conversation, tels que le fil les annonce (le plus récent gagne).
   * `session_id` du payload = conversation Claude Code, la même que `claudeSessionId` de la session du poste.
   */
  private releverMode(lot: readonly EvenementBrut[]): void {
    for (const e of lot) {
      // lecture défensive d'un JSON libre
      const p = e.payload as {
        type?: unknown;
        subtype?: unknown;
        permissionMode?: unknown;
        cwd?: unknown;
        session_id?: unknown;
      } | null;
      const mode = ModeSession.safeParse(p?.permissionMode);
      if (p?.type === 'system' && mode.success) this.modeVu = mode.data;
      if (p?.type === 'system' && p.subtype === 'init' && typeof p.cwd === 'string' && p.cwd) this.cwdVu = p.cwd;
      if (typeof p?.session_id === 'string' && p.session_id !== '') this.conversationVue = p.session_id;
      const modele = modeleDuFil(e.payload);
      if (modele !== null) this.rendreModele({ modele, le: e.creeLe });
    }
    this.maj();
  }

  private publier(): void {
    this.maj();
    this.d.publier();
  }

  /** Les événements lus page par page, du plus récent au plus ancien ; s'arrête avant le premier déjà connu. */
  private async lirePages(
    pages: number,
    dejaConnu: (id: string) => boolean,
    taille: number,
  ): Promise<ResultatApi<EvenementBrut[]>> {
    const lus: EvenementBrut[] = [];
    let curseur: string | null = null;
    for (let i = 0; i < pages; i++) {
      const page = await lireEvenements(this.d.configDir, this.resume.id, this.d.journal, {
        curseur,
        limite: taille,
      });
      if (!page.ok) return { ok: false, statut: page.statut, probleme: page.probleme };
      for (const e of page.donnees.evenements) {
        if (dejaConnu(e.id)) return { ok: true, donnees: lus };
        lus.push(e);
      }
      if (page.donnees.suivant === null || page.donnees.evenements.length === 0) break;
      curseur = page.donnees.suivant;
    }
    return { ok: true, donnees: lus };
  }

  // Pilotage : chaque envoi est un événement POSTé à la session ; la réponse de claude.ai dit si elle est acceptée.
  async envoyer(texte: string, pieces: readonly PieceJointe[] = []): Promise<string | null> {
    if (pieces.some((p) => !p.mime.startsWith('image/'))) return PIECES_REFUSEES;
    const contenu = pieces.length > 0 ? contenuAvecImages(texte, pieces) : texte;
    return this.poster(messageUtilisateur(this.resume.id, contenu, randomUUID()));
  }

  async interrompre(): Promise<string | null> {
    return this.controle({ subtype: 'interrupt' });
  }

  async reglerSession(r: Reglage): Promise<string | null> {
    const requete = requeteReglage(r);
    if (!requete) return REGLAGE_REFUSE;
    const le = new Date().toISOString();
    const miseAJour = r.kind === 'modele' ? { modele: r.modele, modeleLe: le } : champsReglage(r);
    const erreur = await this.controle(requete, miseAJour);
    if (!erreur && r.kind === 'modele') this.annoncerModele({ modele: r.modele, le });
    return erreur;
  }

  // Le choix accepté est gardé pour la conversation qu'il tient (inconnue : rien à garder).
  private annoncerModele(choix: ModeleDate): void {
    if (this.conversationVue !== null) this.d.surModele?.(this.conversationVue, choix);
    else this.d.journal.warn({ session: this.resume.id }, 'modèle réglé sans conversation connue : non gardé');
  }

  async repondre(r: ReponseDialogue): Promise<string | null> {
    const res = this.attente.repondre(r);
    if (typeof res === 'string') return res;
    if (res.resultat === null) return this.progres(res);
    const erreur = await this.poster(reponseControle(randomUUID(), res.demande.requestId, res.resultat));
    if (erreur) return erreur;
    this.attente.fermer(res.demande.requestId);
    this.annoncerResolu(res);
    this.publier();
    return null;
  }

  // Une question répondue parmi d'autres : rien n'est envoyé, la suivante s'affiche.
  private progres(res: Resolution): null {
    this.annoncerResolu(res);
    this.publier();
    return null;
  }

  private annoncerResolu(res: Resolution): void {
    const base = { type: 'dialogue_resolu' as const, dialogue: res.dialogue };
    const evt: Evenement = res.decision ? { ...base, decision: res.decision } : { ...base, reponses: [...res.valeurs] };
    this.d.sortie.evenement(this.resume.id, evt);
  }

  private controle(requete: Record<string, unknown>, miseAJour?: Partial<ResumeSession>): Promise<string | null> {
    return this.poster(requeteControle(randomUUID(), requete), miseAJour);
  }

  private async poster(evt: Record<string, unknown>, miseAJour?: Partial<ResumeSession>): Promise<string | null> {
    const r = await envoyerEvenement(this.d.configDir, this.resume.id, evt, this.d.journal);
    if (!r.ok) {
      const erreur = this.erreurDePilotage(r);
      this.publier();
      return erreur;
    }
    this.problemePilotage = null;
    if (miseAJour) this.base = { ...this.base, ...miseAJour };
    if (miseAJour?.modele) this.rendreModele({ modele: miseAJour.modele, le: miseAJour.modeleLe ?? null });
    this.publier();
    return null;
  }

  private erreurDePilotage(r: EchecEnvoi): string {
    if (r.refusAppareil) {
      this.problemePilotage = 'appareil_de_confiance';
      return APPAREIL_REFUSE;
    }
    if (r.statut === 401) {
      this.problemePilotage = 'jeton_expire';
      return JETON_EXPIRE;
    }
    return r.statut > 0 ? `${r.probleme} (HTTP ${r.statut})` : r.probleme;
  }

  // Commandes qui restent hors de portée depuis claude.ai : pas encore pris en charge.
  lancer(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  compacter(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  fermer(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  reprendre(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  basculerNuit(): Promise<string | null> {
    return Promise.resolve(PAS_ENCORE_CLAUDE_AI);
  }
  /** Sans effet : l'autonomie d'une session claude.ai ne se règle pas encore depuis le poste. */
  basculerAutonomie(): void {}

  // Découverte et crochets : rien à rattacher, pas de TUI ni de transcript local.
  rattacher(): void {}
  rattacherTerminal(): void {}
  definirTranscript(): void {}
  lire(): void {}
  async releverEcran(): Promise<void> {}
  async veillerNuit(): Promise<void> {}
  crochet(): ReponseCrochet {
    return {};
  }
  rythme(): string {
    return PAS_ENCORE_CLAUDE_AI;
  }
}
