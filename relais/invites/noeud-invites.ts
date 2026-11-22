// Responsabilité : la politique des invités appliquée par ce nœud — qui fait tourner les sessions d'un invité, à qui
// elles se montrent, leurs limites (part, simultanées, modèles), leur télémétrie. Le point d'entrée des autres modules.
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Charte, MembreCharte } from '../../commun/charte.ts';
import { membreDe, reglagesInviteDe } from '../../commun/charte.ts';
import type { MessageClient } from '../../commun/api-clients.ts';
import type { CadreInvite } from '../../commun/cadre-invite.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { type ActiviteInvite, fusionnerActivites, type ReglagesInvite, verifierPart } from '../../commun/invites.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { CorpsOuverture } from '../clients/api-sessions.ts';
import { json } from '../clients/http.ts';
import { refusContenuLocal } from './garde-locale.ts';
import type { GesteLocal } from '../federation/echanges.ts';
import type { Registre } from '../registre/registre.ts';
import { activiteDe, jourLocal } from './activite.ts';
import { CompteursInvites, type MembreCompteur } from './compteurs.ts';
import { Intentions } from './intention.ts';
import { ajouterEcart, consommeCourant, releveDuCompte, type Releve, SuiviTours } from './part.ts';
import { type CtxGeste, verdictGeste, type GesteRecu, type VerdictGeste } from './politique-geste.ts';
import { type CtxRequete, type VerdictRequete, verdictRequete } from './politique-requete.ts';
import { corpsLu, preparerOuverture, type CtxOuverture, type OuvertureInvite } from './ouverture.ts';
import { inviteDe, sessionsDe, sessionsEnCoursDe } from './sessions-invite.ts';
import { messageVuPar, sessionsVues } from './vue.ts';

const INTERVALLE_ACTIVITE_MS = 60_000;
const DUREE_INTENTION_MS = 30 * 60_000;

export interface OptionsInvites {
  readonly moi: () => string | null;
  readonly machine: string;
  readonly charte: () => Charte | null;
  readonly registre: Registre;
  readonly dossier: string;
  readonly racine: string;
  readonly home: string;
  readonly racinesMachine: () => string[];
  readonly envoyerAChefs: (m: MessageChiffre) => void;
  readonly journal: Logger;
  readonly maintenant?: () => number;
}

/** Le rendu d'une ouverture relayée : la session créée (fiche) ou un refus. */
type OuvrirCadre = (c: CorpsOuverture, cadre: CadreInvite) => Promise<Response>;

export class NoeudInvites {
  readonly compteurs: CompteursInvites;
  readonly intentions: Intentions;
  private readonly tours = new SuiviTours();
  private readonly statuts = new Map<string, string>();
  private readonly recues = new Map<string, Map<string, ActiviteInvite>>();
  private minuterie: ReturnType<typeof setInterval> | null = null;
  private readonly maintenant: () => number;

  constructor(private readonly o: OptionsInvites) {
    this.maintenant = o.maintenant ?? Date.now;
    this.compteurs = new CompteursInvites(join(o.dossier, 'invites', 'compteurs.json'), o.journal);
    this.intentions = new Intentions(join(o.dossier, 'invites', 'intentions.json'), o.journal, this.maintenant);
  }

  // ---- Qui est invité ---------------------------------------------------------------------------------------------

  reglagesDe(membre: string): ReglagesInvite | null {
    return reglagesInviteDe(this.o.charte(), membre);
  }

  estInvite(membre: string): boolean {
    return this.reglagesDe(membre) !== null;
  }

  /** Un compte Claude est connecté sur cette machine (sert à savoir si une session y est permise). */
  compteLocal(): boolean {
    return this.comptesLocaux().some((c) => c.connecte);
  }

  /** Le membre de ce nœud dans la charte (null sans charte). */
  moi(): string | null {
    return this.o.moi();
  }

  /** Vrai si ce nœud fait tourner les sessions d'un invité (ce nœud est invité lui-même). */
  moiEstInvite(): boolean {
    const moi = this.o.moi();
    return moi !== null && this.estInvite(moi);
  }

  // ---- Requêtes et gestes d'un pair -------------------------------------------------------------------------------

  /** Verdict d'une requête (fil, écriture, interruption, ouverture, terminal) ; une écriture ouvre le tour compté. */
  requete(membre: string, message: MessageChiffre): VerdictRequete {
    const verdict = verdictRequete(this.ctxRequete(), membre, message);
    if (verdict.ok && verdict.invite && message.t === 'ecrire') this.debutTour(message.session, membre);
    if (!verdict.ok) this.o.journal.warn({ membre, t: message.t, raison: 'politique d’invité' }, 'requête refusée');
    return verdict;
  }

  /** Verdict d'un geste (corps relu) : rend le geste à exécuter, avec le cadre pour une ouverture. */
  geste(membre: string, m: GesteRecu): VerdictGeste {
    const verdict = verdictGeste(this.ctxGeste(), membre, m);
    if (verdict.ok && m.session !== undefined && (m.geste === 'messages' || m.geste === 'repondre')) {
      if (this.estInvite(membre)) this.debutTour(m.session, membre);
    }
    if (!verdict.ok) this.o.journal.warn({ membre, geste: m.geste, raison: verdict.raison }, 'geste refusé');
    return verdict;
  }

  /** Une ouverture acceptée (geste relayé) : la session est créée avec son cadre, son tour et son activité comptés. */
  async executerOuverture(g: GesteLocal, ouvrir: OuvrirCadre): Promise<Response> {
    const cadre = g.invite;
    const corps = lireCorpsOuverture(g.corps);
    if (cadre === undefined || corps === null) return json({ erreur: 'ouverture invalide' }, 400);
    const reponse = await ouvrir(corps, cadre);
    if (reponse.ok) await this.ouvertureFaite(cadre.membre, reponse);
    return reponse;
  }

  private async ouvertureFaite(membre: string, reponse: Response): Promise<void> {
    const id = await identifiantDe(reponse);
    this.compterOuverture(membre);
    if (id !== null) this.debutTour(id, membre);
  }

  /** Vue d'un membre sur les sessions du nœud (l'appli locale = ce nœud) : invité → les siennes, autre → masquées. */
  sessionsPour(viewer: string | null, sessions: readonly ResumeSession[]): ResumeSession[] {
    const v = viewer ?? this.o.moi() ?? '';
    return sessionsVues(v, this.reglagesDe(v), sessions);
  }

  /** Vrai s'il existe au moins un invité dans la charte (sinon aucune vérification de session n'est utile). */
  private auMoinsUnInvite(): boolean {
    return this.o.charte()?.membres.some((m) => m.invite !== undefined) === true;
  }

  /** Ce que l'appli locale reçoit en direct ; null = rien ne part (contenu d'une session d'invité). */
  vueAppli(m: MessageClient): MessageClient | null {
    if (!this.auMoinsUnInvite()) return m;
    return messageVuPar(this.o.moi() ?? '', m, (id) => this.o.registre.session(id));
  }

  /** Refus 403 d'une route locale qui viserait le contenu d'une session d'invité, ou null. */
  gardeLocale(url: string): Response | null {
    if (!this.auMoinsUnInvite()) return null;
    return refusContenuLocal(url, this.o.moi(), (id) => this.o.registre.session(id));
  }

  /** Une session change d'état : un tour d'invité qui quitte le travail se compte. */
  surSession(s: ResumeSession): void {
    const etait = this.statuts.get(s.id);
    this.statuts.set(s.id, s.statut);
    if (etait === 'travail' && s.statut !== 'travail' && inviteDe(s) !== null) this.finTour(s.id);
  }

  // ---- Limites ----------------------------------------------------------------------------------------------------

  /** Part de l'invité : consommation connue dans la fenêtre (null = inconnue, permis) contre sa part. */
  partDe(membre: string, reglages: ReglagesInvite): { ok: true } | { ok: false; raison: string } {
    const c = this.compteurs.membre(membre);
    const releves = this.relevesDuNoeud();
    return verifierPart(
      reglages,
      consommeCourant(c.session, releves?.session),
      reglages.partSemaine === null ? null : consommeCourant(c.semaine, releves?.semaine),
    );
  }

  private relevesDuNoeud(): Releve | null {
    return releveDuCompte(this.comptesLocaux(), this.compteDeMoi());
  }

  private comptesLocaux() {
    return this.o.registre.machines().find((m) => m.id === this.o.machine)?.etatComptes ?? [];
  }

  private compteDeMoi(): string | null {
    const moi = this.o.moi();
    return moi === null ? null : (membreDe(this.o.charte(), moi)?.compte ?? null);
  }

  private debutTour(session: string, membre: string): void {
    const compte = this.compteDeMoi();
    const jetons = this.jetonsDe(session);
    this.tours.debut(session, {
      membre,
      compte,
      avant: releveDuCompte(this.comptesLocaux(), compte),
      jetonsAvant: jetons,
    });
  }

  private jetonsDe(session: string): number {
    const j = this.o.registre.jetonsSession(session);
    return j.entree + j.sortie;
  }

  private finTour(session: string): void {
    const tour = this.tours.fin(session);
    if (tour === null) return;
    const apres = releveDuCompte(this.comptesLocaux(), tour.compte);
    const jour = jourLocal(new Date(this.maintenant()));
    const jetons = Math.max(0, this.jetonsDe(session) - tour.jetonsAvant);
    this.compteurs.miseAJour(tour.membre, (m) => ({
      ...m,
      session: ajouterEcart(m.session, tour.avant?.session ?? null, apres?.session ?? null),
      semaine: ajouterEcart(m.semaine, tour.avant?.semaine ?? null, apres?.semaine ?? null),
      jours: majJour(m, jour, (j) => ({ ...j, jetons: j.jetons + jetons, derniere: this.iso() })),
    }));
  }

  private compterOuverture(membre: string): void {
    const jour = jourLocal(new Date(this.maintenant()));
    this.compteurs.miseAJour(membre, (m) => ({
      ...m,
      jours: majJour(m, jour, (j) => ({ ...j, sessions: j.sessions + 1, derniere: this.iso() })),
    }));
  }

  private iso(): string {
    return new Date(this.maintenant()).toISOString();
  }

  // ---- Télémétrie -------------------------------------------------------------------------------------------------

  demarrer(): void {
    this.minuterie ??= setInterval(() => this.emettreActivites(), INTERVALLE_ACTIVITE_MS);
  }

  arreter(): void {
    if (this.minuterie) clearInterval(this.minuterie);
    this.minuterie = null;
  }

  /** Activité des invités (télémétrie active, sessions ici) envoyée aux chefs : des nombres, jamais de contenu. */
  emettreActivites(): void {
    const charte = this.o.charte();
    if (charte === null) return;
    const activites = charte.membres
      .filter((m) => m.invite?.telemetrie === true && sessionsDe(this.o.registre, m.id).length > 0)
      .map((m) => ({ membre: m.id, activite: this.activiteLocale(m.id) }));
    if (activites.length > 0) this.o.envoyerAChefs({ t: 'activite_invites', activites });
  }

  /** Un pair non invité rapporte l'activité de ses invités : gardée par (émetteur, invité), jamais d'un invité. */
  recevoirActivite(source: string, activites: readonly { membre: string; activite: ActiviteInvite }[]): void {
    const charte = this.o.charte();
    const emetteur = charte === null ? null : membreDe(charte, source);
    if (emetteur === null || emetteur.invite !== undefined) return;
    const par = this.recues.get(source) ?? new Map<string, ActiviteInvite>();
    for (const { membre, activite } of activites) par.set(membre, activite);
    this.recues.set(source, par);
  }

  /** L'activité d'un invité pour le chef : ce nœud + ce que les pairs rapportent ; rien si la télémétrie est coupée. */
  activitePour(membre: string): { telemetrie: boolean; activite: ActiviteInvite | null } {
    const reglages = this.reglagesDe(membre);
    if (reglages === null || !reglages.telemetrie) return { telemetrie: false, activite: null };
    const locale = this.activiteLocale(membre);
    const rapportees = [...this.recues.values()]
      .map((p) => p.get(membre))
      .filter((a): a is ActiviteInvite => a !== undefined);
    return { telemetrie: true, activite: fusionnerActivites([locale, ...rapportees]) };
  }

  private activiteLocale(membre: string): ActiviteInvite {
    const reglages = this.reglagesDe(membre);
    if (reglages === null) throw new Error(`membre non invité : ${membre}`);
    return activiteDe({
      reglages,
      compteurs: this.compteurs.membre(membre),
      enCours: sessionsEnCoursDe(this.o.registre, membre),
      jour: jourLocal(new Date(this.maintenant())),
      releves: this.relevesDuNoeud(),
    });
  }

  // ---- Contextes des politiques -----------------------------------------------------------------------------------

  private ctxRequete(): CtxRequete {
    return {
      sessionDe: (id) => this.o.registre.session(id),
      enCours: (membre) => sessionsEnCoursDe(this.o.registre, membre),
      reglagesDe: (membre) => this.reglagesDe(membre),
      partDe: (membre, reglages) => this.partDe(membre, reglages),
      sessionsAutres: (membre) => this.reglagesDe(membre)?.acces.sessionsAutres ?? false,
    };
  }

  private ctxGeste(): CtxGeste {
    return {
      ...this.ctxRequete(),
      ouvrir: (membre, texte) => this.preparer(membre, texte),
    };
  }

  /** Une ouverture préparée pour `membre` sur ce nœud (limites, corps réécrit, cadre). */
  preparer(membre: string, texte: string | undefined): OuvertureInvite {
    const reglages = this.reglagesDe(membre);
    if (reglages === null) return { ok: false, statut: 403, raison: 'pas un invité' };
    const charte = this.o.charte();
    const moi = this.o.moi() ?? '';
    const compteur = this.compteurs.membre(membre);
    const releves = this.relevesDuNoeud();
    const ctx: CtxOuverture = {
      moi,
      machine: this.o.machine,
      reglages,
      nom: membreDe(charte, membre)?.nom ?? membre,
      compteDeMoi: this.compteDeMoi(),
      compteSurSaMachine: this.compteLocal(),
      sessionsEnCours: sessionsEnCoursDe(this.o.registre, membre),
      consomme5h: consommeCourant(compteur.session, releves?.session),
      consommeSemaine: consommeCourant(compteur.semaine, releves?.semaine),
      racines: this.o.racinesMachine(),
      racine: this.o.racine,
      home: this.o.home,
    };
    return preparerOuverture(ctx, membre, texte);
  }
}

function majJour(
  m: MembreCompteur,
  jour: string,
  fn: (j: { sessions: number; jetons: number; derniere: string | null }) => {
    sessions: number;
    jetons: number;
    derniere: string | null;
  },
): MembreCompteur['jours'] {
  const actuel = m.jours[jour] ?? { sessions: 0, jetons: 0, derniere: null };
  return { ...m.jours, [jour]: fn(actuel) };
}

function lireCorpsOuverture(corps: string | undefined): CorpsOuverture | null {
  const lu = CorpsOuverture.safeParse(corpsLu(corps));
  return lu.success ? lu.data : null;
}

async function identifiantDe(reponse: Response): Promise<string | null> {
  const corps: unknown = await reponse
    .clone()
    .json()
    .catch(() => null);
  return corps !== null && typeof corps === 'object' && 'id' in corps ? String(corps.id) : null;
}
