// Responsabilité : UNE session Claude Code dans tmux — son fil (lu dans le transcript), ses commandes (via tmux)
// et, si ccremote l'a lancée, son rythme : relance autonome, compaction pilotée, garde des sous-agents.
import type { Logger } from 'pino';
import type { Evenement, ReponseDialogue, ResumeSession, StatutSession } from '../../commun/session.ts';
import { approuverDossier } from './confiance.ts';
import { GardeSousAgents, type DecisionCrochet } from './garde-sous-agents.ts';
import { commandeClaude, commandeReprise, VAR_SESSION, VAR_SOCKET } from './lanceur.ts';
import type { SessionPersistee } from './persistance.ts';
import { CONSIGNE_COMPACTION, deciderCompaction } from './politique-compaction.ts';
import { deciderSuite, type Suite } from './suite-du-tour.ts';
import * as tmux from './tmux.ts';
import { SuiviSousAgents } from './sous-agents.ts';
import { SuiviDialogue } from './suivi-dialogue.ts';
import { LecteurTranscript } from './transcript.ts';
import { contexteDe, type Ligne, traduire, travailEnCours } from './traduction.ts';

export interface SortieSession {
  evenement(sessionId: string, evt: Evenement): void;
  resume(r: ResumeSession): void;
}

export interface EnvironnementSession {
  readonly socket: string;
  readonly journal: Logger;
  readonly sortie: SortieSession;
}

const RELANCE_APRES_COMPACTION =
  'Session compactée. Reprends l’objectif là où tu en étais (STATE.md / TODO.md font foi), ' +
  'sans refaire le travail livré.';

export class SessionTmux {
  private etat: ResumeSession;
  private lecteur: LecteurTranscript | null;
  private sousAgents: SuiviSousAgents | null;
  private readonly garde = new GardeSousAgents();
  private readonly dialogue = new SuiviDialogue();
  private tour = { outils: 0, etapeTerminee: false, debut: Date.now() };
  private drapeaux = { objectifAtteint: false, questionPosee: false, compactionDemandee: false };
  private relancesSansProgres = 0;
  private readonly enVol: string[] = []; // textes envoyés par Chris pendant un tour, pas encore soumis par Claude
  private readonly internes = new Set<string>(); // textes collés par le poste lui-même (relance, compaction)

  constructor(
    private readonly p: SessionPersistee,
    private readonly env: EnvironnementSession,
  ) {
    this.etat = p.resume;
    this.lecteur = p.transcript ? new LecteurTranscript(p.transcript, p.position) : null;
    this.sousAgents = p.transcript ? new SuiviSousAgents(p.transcript) : null;
  }

  get resume(): ResumeSession {
    return this.etat;
  }

  get persistee(): SessionPersistee {
    return { ...this.p, resume: this.etat, transcript: this.lecteur?.chemin ?? null, position: this.lecteur?.lu ?? 0 };
  }

  get transcriptConnu(): boolean {
    return this.lecteur !== null;
  }

  // --- découverte : l'état réel vient de tmux et du transcript ---

  rattacher(pane: tmux.PaneTmux | null): void {
    if (!pane) {
      if (this.etat.tmux !== null) this.maj({ tmux: null, attachee: false, statut: 'fermee' });
      return;
    }
    const titre = this.p.consignes === null ? pane.titre : this.etat.titre;
    if (pane.nom !== this.etat.tmux || pane.attachee !== this.etat.attachee || titre !== this.etat.titre) {
      this.maj({
        tmux: pane.nom,
        attachee: pane.attachee,
        titre,
        ...(this.etat.statut === 'fermee' ? { statut: 'attente' } : {}),
      });
    }
  }

  /** Session lancée dans un terminal ordinaire : ouverte tant que son processus vit, fermée ensuite. */
  rattacherTerminal(vivant: boolean): void {
    if (vivant && (this.etat.statut === 'fermee' || !this.etat.terminal))
      this.maj({ terminal: true, statut: 'attente' });
    if (!vivant && this.etat.terminal) this.maj({ terminal: false, statut: 'fermee' });
  }

  /** Une session dans un terminal n'a pas de tmux : on ne peut que la lire à distance. */
  private refusTerminal(): string | null {
    return this.etat.terminal
      ? 'Session ouverte dans un terminal (hors tmux) : lisible ici, pilotable seulement depuis ce terminal.'
      : null;
  }

  // Session adoptée : on rejoue ses derniers événements pour que le fil ne s'ouvre pas vide.
  definirTranscript(chemin: string, historique: number, claudeSessionId: string): void {
    this.etat = { ...this.etat, claudeSessionId };
    this.lecteur = new LecteurTranscript(chemin);
    this.sousAgents = new SuiviSousAgents(chemin);
    const evts: Evenement[] = [];
    for (const l of this.lecteur.lire()) evts.push(...this.absorber(l));
    for (const evt of evts.slice(-historique)) this.env.sortie.evenement(this.etat.id, evt);
    const vivante = this.etat.tmux !== null || this.etat.terminal === true;
    this.etat = { ...this.etat, dialogue: vivante ? this.dialogue.courant : null };
    this.publier();
  }

  lire(): void {
    if (!this.lecteur) return;
    const lignes = this.lecteur.lire();
    for (const l of lignes) for (const evt of this.absorber(l)) this.emettre(evt);
    const internes = this.sousAgents?.lire() ?? [];
    for (const evt of internes) this.emettre(evt);
    if (internes.length > 0) this.tour.outils += internes.filter((e) => e.type === 'outil').length;
    if (lignes.length > 0) this.publierDialogue() || this.publier();
  }

  // --- dialogues du TUI (AskUserQuestion, permission, plan) ---

  /** Relève l'écran du pane : un menu du TUI qui attend une réponse devient un dialogue répondable de Quart. */
  async releverEcran(): Promise<void> {
    if (!this.etat.tmux) return;
    this.dialogue.releverEcran(await tmux.capturer(this.etat.tmux));
    this.publierDialogue();
  }

  async repondre(r: ReponseDialogue): Promise<string | null> {
    const refus = this.refusTerminal();
    if (refus) return refus;
    if (!this.etat.tmux) return 'session fermée';
    const erreur = await this.dialogue.repondre(this.etat.tmux, r);
    if (!erreur) void this.releverEcran();
    return erreur;
  }

  // Publie le dialogue s'il a changé ; un nouveau dialogue devient aussi une question du fil (et une alerte).
  private publierDialogue(): boolean {
    const vivante = this.etat.tmux !== null || this.etat.terminal === true;
    const d = vivante ? this.dialogue.courant : null;
    if ((d?.id ?? null) === (this.etat.dialogue?.id ?? null)) return false;
    if (d) this.emettre({ type: 'question', question: resumeDialogue(d) });
    this.maj({ dialogue: d });
    return true;
  }

  private absorber(l: Ligne): Evenement[] {
    this.dialogue.absorber(l);
    const contexte = contexteDe(l);
    if (contexte !== null) this.etat = { ...this.etat, contexte: { ...this.etat.contexte, tokens: contexte } };
    if (l.type === 'custom-title' && typeof l.customTitle === 'string')
      this.etat = { ...this.etat, titre: l.customTitle };
    const travail = travailEnCours(l);
    const vivante = this.etat.tmux !== null || this.etat.terminal === true;
    if (!this.etat.pilotee && travail !== null && vivante)
      this.etat = { ...this.etat, statut: travail ? 'travail' : 'attente' };
    const evts = traduire(l);
    if (this.etat.pilotee && evts.some((e) => e.type === 'erreur')) this.etat = { ...this.etat, statut: 'erreur' };
    for (const evt of evts) {
      if (evt.type === 'outil' || evt.type === 'sous_agent') this.tour.outils += 1;
      if (evt.type === 'compaction') {
        this.etat = {
          ...this.etat,
          compactions: this.etat.compactions + 1,
          contexte: { ...this.etat.contexte, tokens: evt.apres },
        };
      }
    }
    return evts;
  }

  // --- commandes de Chris ---

  async envoyer(texte: string): Promise<string | null> {
    const refus = this.refusTerminal();
    if (refus) return refus;
    this.drapeaux.objectifAtteint = false;
    this.drapeaux.questionPosee = false;
    this.relancesSansProgres = 0;
    if (!this.etat.tmux) return this.reprendre(texte);
    if (this.etat.statut === 'travail' || this.etat.statut === 'compaction') this.enVol.push(texte.trim());
    const r = await tmux.envoyerTexte(this.etat.tmux, texte);
    return r.code === 0 ? null : `tmux refuse l’envoi : ${r.erreur}`;
  }

  async interrompre(): Promise<string | null> {
    const refus = this.refusTerminal();
    if (refus) return refus;
    if (!this.etat.tmux) return 'session fermée';
    const r = await tmux.touche(this.etat.tmux, 'Escape');
    return r.code === 0 ? null : r.erreur;
  }

  async compacter(): Promise<string | null> {
    const refus = this.refusTerminal();
    if (refus) return refus;
    if (!this.etat.tmux) return 'session fermée';
    if (this.etat.statut === 'travail') {
      this.drapeaux.compactionDemandee = true;
      return null;
    }
    return this.lancerCompaction('demandée par Chris');
  }

  async fermer(): Promise<string | null> {
    const refus = this.refusTerminal();
    if (refus) return refus;
    if (!this.etat.tmux) return null;
    const r = await tmux.tuer(this.etat.tmux);
    this.maj({ tmux: null, attachee: false, statut: 'fermee' });
    return r.code === 0 ? null : r.erreur;
  }

  // Jamais deux processus sur une conversation : on ne reprend qu'une session sans tmux.
  async reprendre(message?: string): Promise<string | null> {
    const occupee = this.refusTerminal();
    if (occupee) return occupee;
    if (this.etat.tmux) return null;
    if (!this.etat.claudeSessionId) return 'conversation inconnue : impossible de la reprendre';
    const refus = this.preparer();
    if (refus) return refus;
    const nom = await tmux.nomLibre(this.etat.projet.nom);
    const commande =
      this.p.consignes === null
        ? commandeReprise(this.etat.claudeSessionId)
        : commandeClaude({
            sessionId: this.etat.claudeSessionId,
            titre: this.etat.titre,
            consignes: this.p.consignes,
            modele: null,
            reprise: true,
          });
    const r = await tmux.creer(nom, this.etat.cwd, message ? [...commande, message] : commande, this.variables());
    if (r.code !== 0) return `tmux refuse la reprise : ${r.erreur}`;
    this.maj({ tmux: nom, statut: message ? 'travail' : 'attente' });
    return null;
  }

  async lancer(message: string, modele: string | null): Promise<string | null> {
    const refus = this.preparer();
    if (refus) return refus;
    const nom = await tmux.nomLibre(this.etat.projet.nom);
    const commande = commandeClaude({
      sessionId: this.etat.id,
      titre: this.etat.titre,
      consignes: this.p.consignes ?? '',
      modele,
      reprise: false,
    });
    const r = await tmux.creer(nom, this.etat.cwd, [...commande, message], this.variables());
    if (r.code !== 0) return `tmux refuse la session : ${r.erreur}`;
    this.maj({ tmux: nom, statut: 'travail' });
    return null;
  }

  basculerAutonomie(active: boolean): void {
    this.relancesSansProgres = 0;
    this.maj({ autonomie: active });
  }

  private preparer(): string | null {
    try {
      approuverDossier(this.etat.cwd, this.p.configDir);
      return null;
    } catch (erreur) {
      return `approbation du dossier impossible : ${String(erreur)}`;
    }
  }

  private variables(): Record<string, string> {
    return {
      [VAR_SESSION]: this.etat.id,
      [VAR_SOCKET]: this.env.socket,
      ...(this.p.configDir ? { CLAUDE_CONFIG_DIR: this.p.configDir } : {}),
    };
  }

  // --- crochets du CLI (sessions pilotées seulement) ---

  crochet(type: string, entree: Record<string, unknown>): DecisionCrochet | { decision?: 'block'; reason?: string } {
    if (type === 'PreToolUse') return this.garde.decider(String(entree['tool_name'] ?? ''), entree['tool_input']);
    if (type === 'SessionStart') this.surDemarrage(entree);
    if (type === 'UserPromptSubmit') this.surPrompt(String(entree['prompt'] ?? ''));
    if (type === 'Stop') return this.surStop();
    return {};
  }

  private surDemarrage(entree: Record<string, unknown>): void {
    const id = typeof entree['session_id'] === 'string' ? entree['session_id'] : null;
    const chemin = typeof entree['transcript_path'] === 'string' ? entree['transcript_path'] : null;
    if (chemin && chemin !== this.lecteur?.chemin) {
      this.lecteur = new LecteurTranscript(chemin);
      this.sousAgents = new SuiviSousAgents(chemin);
    }
    if (id && id !== this.etat.claudeSessionId) this.maj({ claudeSessionId: id });
    if (entree['source'] === 'compact') this.apresCompaction();
  }

  private surPrompt(prompt: string): void {
    const texte = prompt.trim();
    const i = this.enVol.indexOf(texte);
    if (i >= 0) this.enVol.splice(i, 1);
    if (!this.internes.delete(texte)) this.relancesSansProgres = 0;
    this.tour = { outils: 0, etapeTerminee: this.tour.etapeTerminee, debut: Date.now() };
    this.maj({ statut: this.etat.statut === 'compaction' ? 'compaction' : 'travail' });
  }

  private surStop(): { decision?: 'block'; reason?: string } {
    this.lire();
    this.emettre({ type: 'tour_fini', dureeMs: Date.now() - this.tour.debut, contexte: this.etat.contexte.tokens });
    return this.appliquer(this.suite(false));
  }

  private apresCompaction(): void {
    const suite = this.suite(true);
    if (suite.action !== 'relancer') {
      if (suite.action === 'arreter') this.maj({ statut: suite.statut });
      return;
    }
    this.emettre({ type: 'relance', raison: suite.raison });
    this.maj({ statut: 'travail' });
    setTimeout(() => void this.coller(RELANCE_APRES_COMPACTION), 1_500);
  }

  private suite(sortDeCompaction: boolean): Suite {
    return deciderSuite({
      sortDeCompaction,
      messagesChrisEnVol: this.enVol.length,
      ...this.drapeaux,
      autonomie: this.etat.autonomie,
      aUnObjectif: this.etat.objectif !== null,
      outilsCeTour: this.tour.outils,
      relancesSansProgres: this.relancesSansProgres,
      contexte: this.etat.contexte.tokens,
      maxTokens: this.etat.contexte.max,
      etapeTerminee: this.tour.etapeTerminee,
      sousAgentsActifs: this.sousAgents?.actifs() ?? 0,
    });
  }

  private appliquer(suite: Suite): { decision?: 'block'; reason?: string } {
    const outils = this.tour.outils;
    this.tour = { outils: 0, etapeTerminee: false, debut: Date.now() };
    if (suite.action === 'laisser') return {};
    if (suite.action === 'patienter') {
      this.maj({ statut: 'travail' });
      return {};
    }
    if (suite.action === 'compacter') {
      setTimeout(() => void this.lancerCompaction(suite.raison), 800);
      return {};
    }
    if (suite.action === 'arreter') {
      if (suite.note) this.emettre({ type: 'relance', raison: suite.note });
      this.maj({ statut: suite.statut });
      return {};
    }
    this.relancesSansProgres = outils === 0 ? this.relancesSansProgres + 1 : 0;
    this.emettre({ type: 'relance', raison: suite.raison });
    return { decision: 'block', reason: suite.texte };
  }

  private async lancerCompaction(raison: string): Promise<string | null> {
    this.drapeaux.compactionDemandee = false;
    this.emettre({ type: 'relance', raison: `compaction : ${raison}` });
    this.maj({ statut: 'compaction' });
    return this.coller(CONSIGNE_COMPACTION);
  }

  private async coller(texte: string): Promise<string | null> {
    if (!this.etat.tmux) return 'session fermée';
    this.internes.add(texte.trim());
    const r = await tmux.envoyerTexte(this.etat.tmux, texte);
    if (r.code !== 0) this.env.journal.warn({ session: this.etat.id, erreur: r.erreur }, 'collage refusé par tmux');
    return r.code === 0 ? null : r.erreur;
  }

  // --- outils de rythme (MCP) ---

  rythme(outil: string, args: Record<string, unknown>): string {
    const champ = (k: string): string => String(args[k] ?? '');
    if (outil === 'etape_terminee') {
      this.tour.etapeTerminee = true;
      this.garde.nouvelleEtape();
      this.maj({ etapes: this.etat.etapes + 1 });
      this.emettre({ type: 'etape', resume: champ('resume'), suite: champ('suite') });
      const k = Math.round(this.etat.contexte.tokens / 1000);
      if (!deciderCompaction(this.etat.contexte.tokens, this.etat.contexte.max, true).agir) {
        return `Étape enregistrée. Contexte léger (${k}k) : pas de compaction, enchaîne directement sur la suite.`;
      }
      return (
        `Étape enregistrée. Contexte lourd (${k}k) : termine ton tour par une phrase de bilan ; le harness compacte ` +
        'puis te relance sur la suite.'
      );
    }
    if (outil === 'objectif_atteint') {
      this.drapeaux.objectifAtteint = true;
      this.emettre({ type: 'objectif_atteint', bilan: champ('bilan') });
      return 'Chris est notifié. Termine ton tour.';
    }
    if (outil === 'poser_question') {
      this.drapeaux.questionPosee = true;
      this.emettre({ type: 'question', question: champ('question') });
      return 'Question transmise à Chris. Termine ton tour : sa réponse arrivera comme prochain message.';
    }
    return `outil inconnu : ${outil}`;
  }

  private dernierMessage = '';

  // Le CLI réécrit la commande /compact dans le transcript après la compaction : un message identique au précédent est
  // tu.
  private emettre(evt: Evenement): void {
    if (evt.type === 'message') {
      if (evt.texte === this.dernierMessage) return;
      this.dernierMessage = evt.texte;
    }
    this.env.sortie.evenement(this.etat.id, evt);
  }

  private maj(champs: Partial<ResumeSession> & { statut?: StatutSession }): void {
    this.etat = { ...this.etat, ...champs };
    this.publier();
  }

  private publier(): void {
    this.etat = { ...this.etat, majLe: new Date().toISOString() };
    this.env.sortie.resume(this.etat);
  }
}

function resumeDialogue(d: NonNullable<ResumeSession['dialogue']>): string {
  if (d.genre === 'choix') return `${d.titre || 'Choix attendu'} — ${d.options.join(' / ')}`;
  return d.questions.map((q) => q.question).join('\n');
}
