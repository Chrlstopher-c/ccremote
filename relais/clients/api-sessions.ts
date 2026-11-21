// Responsabilité : les routes des sessions — ouvrir, lire le fil, parler, piloter (interrompre, compacter, fermer).
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  AutreSession,
  BacASable,
  EffortSession,
  ModeSession,
  Projet,
  ReponseDialogue,
  type ResumeSession,
  SensRelais,
} from '../../commun/session.ts';
import { estIdFichier, FichierLu, NOMBRE_MAX_PIECES, PieceJointe } from '../../commun/presentation.ts';
import { reponseFichier } from './fichiers-session.ts';
import { TAILLE_MAX_TEXTE_SESSION } from '../../commun/fichiers-session.ts';
import type { Registre } from '../registre/registre.ts';
import { aiguillage, TEXTE_REFUS_SANS_JUMELLE } from '../parc/aiguillage.ts';
import { parcPour, verifierOuverture } from '../sessions/composition-parc.ts';
import type { Diffusion } from './diffusion.ts';
import { entier, erreur, json, lireCorps, REFUS_POSTE } from './http.ts';
import type { Postes } from '../parc/postes.ts';
import { type SessionAdoptable, sessionAdoptee } from './session-adoptee.ts';
import {
  ecrireAuPair,
  interrompreAuPair,
  type PontPair,
  TEXTE_REFUS_DUO,
} from './api-sessions-pair.ts';

const CorpsOuverture = z.object({
  machine: z.string(),
  projet: Projet,
  message: z.string().min(1),
  titre: z.string().max(120).optional(),
  objectif: z.string().nullable().optional(),
  autonomie: z.boolean().default(true),
  modele: z.string().optional(),
  compte: z.string().optional(),
  mode: ModeSession.optional(),
  effort: EffortSession.optional(),
  rapide: z.boolean().optional(), // mode rapide demandé à l'ouverture (SDK)
  ultracode: z.boolean().optional(), // Ultracode demandé à l'ouverture (SDK)
  style_sortie: z.string().min(1).max(80).nullable().optional(),
  bac_a_sable: BacASable.optional(),
  controle_distant: z.boolean().optional(),
  pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(),
  auteur: z.string().min(1).max(64).optional(), // ouverture demandée par le pair (mode duo) : son nom
});
export type CorpsOuverture = z.infer<typeof CorpsOuverture>;
const CorpsMessage = z.object({
  texte: z.string().min(1),
  pieces: z.array(PieceJointe).max(NOMBRE_MAX_PIECES).optional(),
  // Message relayé depuis une autre session (« Envoyer à une autre session ») : le receveur en trace l'origine.
  relayeDe: z.object({ session: z.string().min(1).max(200), titre: z.string().max(200) }).optional(),
  maintenant: z.boolean().optional(), // « Envoyer maintenant » : le poste interrompt le tour, puis remet le message
});
const CorpsRelais = z.object({
  sens: SensRelais,
  autre: AutreSession,
  texte: z.string().min(1).max(TAILLE_MAX_TEXTE_SESSION),
});
const CorpsAutonomie = z.object({ active: z.boolean() });
const CorpsNuit = z.object({ active: z.boolean(), objectif: z.string().max(300).optional() });
const CorpsRemoteControl = z.object({ actif: z.boolean() });
const CorpsMode = z.object({ mode: ModeSession });
const CorpsModele = z.object({ modele: z.string().min(1).max(120) });
const CorpsEffort = z.object({ effort: EffortSession.nullable() });
const CorpsActif = z.object({ actif: z.boolean() });
const CorpsMessageId = z.object({ messageId: z.string().min(1).max(200) });
const CorpsChapitre = z.object({ messageId: z.string().min(1).max(200), epingle: z.boolean() });
const IDENTIFIANT = /^[A-Za-z0-9-]{1,100}$/;
const CorpsTitre = z.object({ titre: z.string().trim().min(1).max(120) });
const CorpsEnvironnement = z.object({
  machine: z.string().min(1).max(120),
  dossier: z.string().trim().min(1).max(1000),
});
const CorpsImport = z.object({ ids: z.array(z.string().regex(IDENTIFIANT)).min(1).max(100) });
type Action = 'interrompre' | 'compacter' | 'fermer' | 'reprendre';
const ACTIONS: ReadonlySet<string> = new Set<string>(['interrompre', 'compacter', 'fermer', 'reprendre']);

type RequeteSession = Request & { params: { id: string; action?: string } };
type RequeteTache = Request & { params: { id: string; tache: string } };
type RequeteMachine = Request & { params: { id: string } };
type RequeteFichier = Request & { params: { id: string; fichier: string } };
type Lecture = { kind: 'contexte' } | { kind: 'connecteurs' } | { kind: 'taches' } | { kind: 'tache'; tache: string };

export class ApiSessions {
  constructor(
    private readonly registre: Registre,
    private readonly postes: SessionAdoptable & Partial<Pick<Postes, 'attendreAuteur'>>,
    private readonly diffusion: Diffusion,
    private readonly isolees: ReadonlySet<string>,
    private readonly journal: Logger,
    private readonly pair: PontPair | null = null,
  ) {}

  async ouvrir(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsOuverture);
    if (c instanceof Response) return c;
    return this.ouvrirAvec(c);
  }

  /** Ouverture à partir d'un corps déjà lu : route de Chris, et ouverture demandée par le pair (mode duo). */
  async ouvrirAvec(c: CorpsOuverture): Promise<Response> {
    const refus = verifierOuverture(c.machine, c.projet, this.isolees);
    if (refus) return erreur(refus, 403);
    const demande = {
      sessionId: randomUUID(),
      projet: c.projet,
      message: c.message,
      objectif: c.objectif ?? null,
      autonomie: c.autonomie,
      titre: c.titre?.trim() || titreDepuis(c.message),
      parc: parcPour(c.machine, this.registre.machines(), this.isolees),
      ...(c.modele ? { modele: c.modele } : {}),
      ...(c.compte ? { compte: c.compte } : {}),
      ...(c.mode ? { mode: c.mode } : {}),
      ...(c.effort ? { effort: c.effort } : {}),
      ...(c.rapide ? { rapide: true } : {}),
      ...(c.ultracode ? { ultracode: true } : {}),
      style_sortie: c.style_sortie ?? null,
      bac_a_sable: c.bac_a_sable ?? 'non',
      controle_distant: c.controle_distant ?? false,
      ...(c.pieces ? { pieces: c.pieces } : {}),
    };
    if (c.auteur) this.postes.attendreAuteur?.(demande.sessionId, c.auteur);
    const r = await this.postes.commander(c.machine, { kind: 'ouvrir', demande });
    if (!r.ok) this.journal.warn({ machine: c.machine, erreur: r.erreur }, 'ouverture de session refusée');
    return r.ok ? json(r.donnees, 201) : erreur(r.erreur ?? 'ouverture refusée', REFUS_POSTE);
  }

  async evenements(req: RequeteSession): Promise<Response> {
    const url = new URL(req.url);
    const id = req.params.id;
    const session = await this.sessionDe(id);
    if (session instanceof Response) return session;
    if (url.searchParams.has('avant')) {
      const limite = Math.min(Math.max(entier(url.searchParams.get('limite'), 300), 1), 1000);
      return json(this.registre.evenementsAvant(id, entier(url.searchParams.get('avant'), 0), limite));
    }
    if (!url.searchParams.has('apres')) {
      await this.relireSiVide(session);
      return json(this.registre.derniersEvenements(id, 300));
    }
    const apres = entier(url.searchParams.get('apres'), 0);
    if (url.searchParams.has('limite')) {
      // Page suivante du fil paginé (descente) : au plus `limite` (1 à 1000), sans attente.
      const limite = Math.min(Math.max(entier(url.searchParams.get('limite'), 300), 1), 1000);
      return json(this.registre.evenements(id, apres, limite));
    }
    const attendre = Math.min(entier(url.searchParams.get('attendre'), 0), 30);
    let evts = this.registre.evenements(id, apres);
    const echeance = Date.now() + attendre * 1000;
    while (evts.length === 0 && Date.now() < echeance) {
      await this.diffusion.attendre(echeance - Date.now());
      evts = this.registre.evenements(id, apres);
    }
    return json(evts);
  }

  async envoyer(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsMessage);
    if (c instanceof Response) return c;
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (session.duo && c.maintenant) return erreur('envoi maintenant indisponible en mode duo', REFUS_POSTE);
    if (session.duo) return ecrireAuPair(this.pair, session, c.texte, c.pieces ?? [], c.relayeDe);
    return this.commander(req.params.id, {
      kind: 'envoyer',
      texte: c.texte,
      ...(c.pieces ? { pieces: c.pieces } : {}),
      ...(c.maintenant ? { maintenant: true } : {}),
    });
  }

  // Rembobinage : le poste ferme la session et retient le point de reprise ; le fil du relais est retiré à partir du
  // message (le message compris), puis la fiche repart vers l'interface.
  async rembobiner(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsMessageId);
    if (c instanceof Response) return c;
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    const rang = this.registre.rangMessage(session.id, c.messageId);
    if (rang === null && !this.filVide(session.id)) return erreur('message introuvable dans le fil', 404);
    const r = await this.postes.commander(session.machine, {
      kind: 'rembobiner',
      sessionId: session.id,
      messageId: c.messageId,
    });
    if (!r.ok) {
      this.journal.warn({ sessionId: session.id, erreur: r.erreur }, 'rembobinage refusé');
      return erreur(r.erreur ?? 'rembobinage refusé', REFUS_POSTE);
    }
    if (rang !== null) this.registre.tronquerDepuis(session.id, rang);
    const vue = this.registre.session(session.id);
    if (vue) this.diffusion.diffuser({ type: 'session', session: vue });
    return json(r.donnees ?? {});
  }

  // Duplication : le poste copie la conversation jusqu'au message (ou à la fin de la réponse) et la rend reprenable ;
  // sa fiche arrive ensuite.
  async dupliquer(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsMessageId);
    if (c instanceof Response) return c;
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (this.registre.rangEntree(session.id, c.messageId) === null && !this.filVide(session.id)) {
      return erreur('message introuvable dans le fil', 404);
    }
    const r = await this.postes.commander(session.machine, {
      kind: 'dupliquer',
      sessionId: session.id,
      messageId: c.messageId,
    });
    if (!r.ok) {
      this.journal.warn({ sessionId: session.id, erreur: r.erreur }, 'duplication refusée');
      return erreur(r.erreur ?? 'duplication refusée', REFUS_POSTE);
    }
    return json(r.donnees ?? {}, 201);
  }

  // Recherche dans tout le fil : `q` (texte, sans casse), `limite` (1 à 200, 50 par défaut). Rend le total et les
  // occurrences les plus récentes en ordre croissant ; le poste ouvre la page qui contient une occurrence.
  async rechercherFil(req: RequeteSession): Promise<Response> {
    const url = new URL(req.url);
    if (!this.registre.session(req.params.id)) return erreur('session inconnue', 404);
    const limite = Math.min(Math.max(entier(url.searchParams.get('limite'), 50), 1), 200);
    return json(this.registre.rechercherFil(req.params.id, url.searchParams.get('q') ?? '', limite));
  }

  // Chapitres épinglés de la session (uuid), tous rangs confondus : le fil partiel les applique à chaque page.
  async chapitres(req: RequeteSession): Promise<Response> {
    if (!this.registre.session(req.params.id)) return erreur('session inconnue', 404);
    return json(this.registre.chapitresEpingles(req.params.id));
  }

  // Chapitre : épingle un message de Chris ou une réponse dans le fil (événement persisté, retirable).
  async chapitre(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsChapitre);
    if (c instanceof Response) return c;
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (this.registre.rangEntree(req.params.id, c.messageId) === null)
      return erreur('message introuvable dans le fil', 404);
    const e = this.registre.ajouterEvenement(req.params.id, new Date().toISOString(), {
      type: 'chapitre',
      uuid: c.messageId,
      epingle: c.epingle,
    });
    this.diffusion.diffuser({ type: 'evenement', evenement: e });
    return json({ ok: true, epingle: c.epingle });
  }

  // Fichier présenté par la session (artefact, image, fichier) : lu sur le poste, servi tel quel. Le relais ne le garde pas.
  async fichier(req: RequeteFichier): Promise<Response> {
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (!estIdFichier(req.params.fichier)) return erreur('fichier inconnu', 404);
    const r = await this.postes.commander(session.machine, {
      kind: 'fichier_session',
      sessionId: req.params.id,
      fichier: req.params.fichier,
    });
    if (!r.ok) return erreur(r.erreur ?? 'fichier introuvable', REFUS_POSTE);
    const lu = FichierLu.safeParse(r.donnees);
    if (!lu.success) return erreur('réponse du poste illisible', 500);
    return reponseFichier(lu.data, new URL(req.url).searchParams.get('telecharger') === '1');
  }

  async autonomie(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsAutonomie);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'autonomie', active: c.active });
  }

  async nuit(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsNuit);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'nuit', active: c.active, objectif: c.objectif });
  }

  // Remote Control : le poste bascule la session entre le SDK et le TUI (voir gestionnaire), la réponse attend ce tour.
  async remoteControl(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsRemoteControl);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'remote_control', actif: c.actif });
  }

  async mode(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsMode);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'mode', mode: c.mode });
  }

  async modele(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsModele);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'modele', modele: c.modele });
  }

  async effort(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsEffort);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'effort', effort: c.effort });
  }

  async rapide(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsActif);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'rapide', actif: c.actif });
  }

  async ultracode(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsActif);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'ultracode', actif: c.actif });
  }

  async renommer(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsTitre);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'renommer', titre: c.titre });
  }

  // Trace d'un message relayé entre deux sessions : le poste de la session la garde et la montre dans son fil.
  async relais(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsRelais);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'tracer_relais', sens: c.sens, autre: c.autre, texte: c.texte });
  }

  async repondre(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, ReponseDialogue);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'repondre', reponse: c });
  }

  // Panneau de session : lectures sur le poste, rien ne change. Le contexte vaut `null` hors requête ouverte.
  contexte(req: RequeteSession): Promise<Response> {
    return this.lire(req.params.id, { kind: 'contexte' });
  }

  // Le poste garde le relevé du SDK au repos ; hors ligne, la fiche garde le dernier relevé qu'elle a reçu.
  async connecteurs(req: RequeteSession): Promise<Response> {
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    const r = await this.postes.commander(session.machine, { kind: 'connecteurs', sessionId: session.id });
    if (r.ok) return json(r.donnees ?? []);
    this.journal.warn({ sessionId: session.id, erreur: r.erreur }, 'connecteurs lus sur la fiche');
    return json(session.connecteurs ?? []);
  }

  taches(req: RequeteSession): Promise<Response> {
    return this.lire(req.params.id, { kind: 'taches' });
  }

  tache(req: RequeteTache): Promise<Response> {
    return this.lire(req.params.id, { kind: 'tache', tache: req.params.tache }, true);
  }

  async action(req: RequeteSession): Promise<Response> {
    const action = req.params.action ?? '';
    if (action === 'archiver' || action === 'desarchiver') return this.archiver(req.params.id, action === 'archiver');
    if (action === 'epingler' || action === 'desepingler') return this.epingler(req.params.id, action === 'epingler');
    if (action === 'marquer_non_lue' || action === 'marquer_lue') {
      return this.marquerNonLue(req.params.id, action === 'marquer_non_lue');
    }
    if (!estAction(action)) return erreur('action inconnue', 404);
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    if (session.duo) {
      return action === 'interrompre'
        ? interrompreAuPair(this.pair, session)
        : erreur(TEXTE_REFUS_DUO, REFUS_POSTE);
    }
    return this.commander(req.params.id, { kind: action });
  }

  // Ranger est manuel : une session vivante est fermée d'abord (le fil reste lisible), et l'archivage n'est pas écrit
  // si la fermeture échoue. Le poste n'est jamais appelé pour désarchiver.
  private async archiver(sessionId: string, archivee: boolean): Promise<Response> {
    const session = await this.sessionDe(sessionId);
    if (session instanceof Response) return session;
    if (archivee && session.statut !== 'fermee') {
      const r = await this.postes.commander(session.machine, { kind: 'fermer', sessionId });
      if (!r.ok) return erreur(r.erreur ?? 'fermeture refusée, archivage annulé', REFUS_POSTE);
    }
    this.registre.definirArchivee(sessionId, archivee);
    const vue = this.registre.session(sessionId);
    if (vue) this.diffusion.diffuser({ type: 'session', session: vue });
    return json({ ok: true, archivee });
  }

  // Épingler ne touche pas au poste : c'est un drapeau du relais, comme l'archivage sans fermeture.
  private async epingler(sessionId: string, epinglee: boolean): Promise<Response> {
    const session = await this.sessionDe(sessionId);
    if (session instanceof Response) return session;
    this.registre.definirEpinglee(sessionId, epinglee);
    const vue = this.registre.session(sessionId);
    if (vue) this.diffusion.diffuser({ type: 'session', session: vue });
    return json({ ok: true, epinglee });
  }

  // Non lue : un drapeau du relais, comme l'épinglage ; le poste n'est pas appelé.
  private async marquerNonLue(sessionId: string, nonLue: boolean): Promise<Response> {
    const session = await this.sessionDe(sessionId);
    if (session instanceof Response) return session;
    this.registre.definirNonLue(sessionId, nonLue);
    const vue = this.registre.session(sessionId);
    if (vue) this.diffusion.diffuser({ type: 'session', session: vue });
    return json({ ok: true, nonLue });
  }

  // Suppression sur demande explicite de Chris (la confirmation est côté interface) : le poste retire le transcript,
  // la fiche ne part du relais qu'ensuite. Si le poste refuse ou est hors ligne, rien n'est effacé ici.
  async supprimer(req: RequeteSession): Promise<Response> {
    const session = await this.sessionDe(req.params.id);
    if (session instanceof Response) return session;
    const r = await this.postes.commander(session.machine, { kind: 'supprimer', sessionId: session.id });
    if (!r.ok) {
      this.journal.warn({ sessionId: session.id, erreur: r.erreur }, 'suppression refusée par le poste');
      return erreur(r.erreur ?? 'suppression refusée', REFUS_POSTE);
    }
    this.registre.supprimerSession(session.id);
    this.diffusion.diffuser({ type: 'supprimee', id: session.id });
    await this.supprimerAnnexes(session.id);
    return json({ ok: true });
  }

  // Les conversations annexes partent avec leur parente : chacune est retirée du poste, puis du registre.
  private async supprimerAnnexes(parente: string): Promise<void> {
    for (const annexe of this.registre.sessions(true).filter((s) => s.annexe_de === parente)) {
      const r = await this.postes.commander(annexe.machine, { kind: 'supprimer', sessionId: annexe.id });
      if (!r.ok) {
        this.journal.warn({ sessionId: annexe.id, erreur: r.erreur }, 'annexe non supprimée par le poste');
        continue;
      }
      this.registre.supprimerSession(annexe.id);
      this.diffusion.diffuser({ type: 'supprimee', id: annexe.id });
    }
  }

  // Environnements : ceux que Chris a enregistrés, puis les dossiers des sessions récentes (sans doublon).
  environnements(): Response {
    const enregistres = this.registre.environnementsEnregistres().map((e) => ({ ...e, enregistre: true }));
    const recents = this.registre
      .sessions(true)
      .map((s) => ({ machine: s.machine, dossier: s.cwd, enregistre: false }));
    const vus = new Set<string>();
    const liste = [...enregistres, ...recents].filter((e) => {
      const cle = `${e.machine}\n${e.dossier}`;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    });
    return json(liste.slice(0, 50));
  }

  async enregistrerEnvironnement(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsEnvironnement);
    if (c instanceof Response) return c;
    if (!this.machineConnue(c.machine)) return erreur('machine inconnue', 404);
    this.registre.enregistrerEnvironnement(c.machine, c.dossier, new Date().toISOString());
    return json({ ok: true }, 201);
  }

  // Sessions Claude Code du poste non encore connues de Quart.
  importables(req: RequeteMachine): Promise<Response> {
    return this.commanderMachine(req.params.id, { kind: 'importables' });
  }

  async importer(req: RequeteMachine): Promise<Response> {
    const c = await lireCorps(req, CorpsImport);
    if (c instanceof Response) return c;
    return this.commanderMachine(req.params.id, { kind: 'importer', ids: c.ids });
  }

  private machineConnue(id: string): boolean {
    return this.registre.machines().some((m) => m.id === id);
  }

  private async commanderMachine(
    machine: string,
    c: { kind: 'importables' } | { kind: 'importer'; ids: string[] },
  ): Promise<Response> {
    if (!this.machineConnue(machine)) return erreur('machine inconnue', 404);
    const r = await this.postes.commander(machine, c);
    if (!r.ok) this.journal.warn({ machine, commande: c.kind, erreur: r.erreur }, 'commande de machine refusée');
    return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'commande refusée', REFUS_POSTE);
  }

  // Arrêt d'une tâche de fond : l'identifiant vient du SDK ; il est vérifié avant d'aller au poste.
  arreterTache(req: RequeteTache): Promise<Response> {
    const tache = req.params.tache;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(tache)) return Promise.resolve(erreur('identifiant de tâche invalide', 400));
    return this.commander(req.params.id, { kind: 'arreter_tache', tache });
  }

  // Session adoptée sans fil au relais (son historique n'y remonte pas) : le poste vérifie le message.
  private filVide(id: string): boolean {
    return this.registre.derniersEvenements(id, 1).length === 0;
  }

  // Fil vide au relais alors que le poste connaît la session : son transcript repasse au relais (sans effet si rien).
  private async relireSiVide(session: ResumeSession): Promise<void> {
    if (!this.filVide(session.id)) return;
    const r = await this.postes.commander(session.machine, { kind: 'historique', sessionId: session.id });
    if (!r.ok) this.journal.debug({ sessionId: session.id, erreur: r.erreur }, 'historique non relu');
  }

  // Session de l'action : connue du relais, ou découverte puis adoptée par le poste (voir session-adoptee.ts).
  private sessionDe(id: string): Promise<ResumeSession | Response> {
    return sessionAdoptee(this.registre, this.postes, id);
  }

  private async lire(sessionId: string, c: Lecture, absenteEst404 = false): Promise<Response> {
    const session = await this.sessionDe(sessionId);
    if (session instanceof Response) return session;
    const r = await this.postes.commander(session.machine, { ...c, sessionId });
    if (!r.ok) {
      this.journal.warn({ sessionId, lecture: c.kind, erreur: r.erreur }, 'lecture refusée');
      return erreur(r.erreur ?? 'lecture refusée', REFUS_POSTE);
    }
    if (absenteEst404 && r.donnees === null) return erreur('tâche inconnue', 404);
    return json(r.donnees ?? null);
  }

  /** Un message du pair (mode duo), chez le propriétaire : même chemin qu'un message local, signé de son nom. */
  envoyerDuPair(sessionId: string, texte: string, pieces: readonly PieceJointe[], auteur: string): Promise<Response> {
    return this.commander(sessionId, { kind: 'envoyer', texte, pieces: [...pieces], auteur });
  }

  interrompreDuPair(sessionId: string): Promise<Response> {
    return this.commander(sessionId, { kind: 'interrompre' });
  }

  // Trace d'un message relayé reçu d'un pair : la session locale garde « relayé depuis <titre> de <nom> ».
  tracerDuPair(
    sessionId: string,
    trace: { sens: SensRelais; autre: AutreSession; texte: string },
  ): Promise<Response> {
    return this.commander(sessionId, { kind: 'tracer_relais', ...trace });
  }

  private async commander(
    sessionId: string,
    c:
      | { kind: 'envoyer'; texte: string; pieces?: PieceJointe[]; auteur?: string; maintenant?: boolean }
      | { kind: 'autonomie'; active: boolean }
      | { kind: 'nuit'; active: boolean; objectif?: string | undefined }
      | { kind: 'remote_control'; actif: boolean }
      | { kind: 'repondre'; reponse: ReponseDialogue }
      | { kind: 'tracer_relais'; sens: SensRelais; autre: AutreSession; texte: string }
      | { kind: 'mode'; mode: ModeSession }
      | { kind: 'modele'; modele: string }
      | { kind: 'effort'; effort: EffortSession | null }
      | { kind: 'rapide'; actif: boolean }
      | { kind: 'ultracode'; actif: boolean }
      | { kind: 'renommer'; titre: string }
      | { kind: 'arreter_tache'; tache: string }
      | { kind: Action },
  ): Promise<Response> {
    const session = await this.sessionDe(sessionId);
    if (session instanceof Response) return session;
    // Session du pair (mode duo) : elle tourne chez lui, aucune commande locale ne part vers un poste.
    if (session.duo) return erreur(TEXTE_REFUS_DUO, REFUS_POSTE);
    const aiguille = aiguillage(session, c.kind, this.registre.sessions(false));
    if (aiguille.kind === 'refus') {
      this.journal.warn({ sessionId, commande: c.kind }, 'session tenue ailleurs sans Remote Control');
      return erreur(TEXTE_REFUS_SANS_JUMELLE, REFUS_POSTE);
    }
    const cible = aiguille.kind === 'jumelle' ? aiguille.session : session;
    const r = await this.postes.commander(cible.machine, { ...c, sessionId: cible.id });
    if (!r.ok) this.journal.warn({ sessionId, commande: c.kind, erreur: r.erreur }, 'commande refusée');
    return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'commande refusée', REFUS_POSTE);
  }
}

function estAction(valeur: string): valeur is Action {
  return ACTIONS.has(valeur);
}

function titreDepuis(message: string): string {
  const ligne = message.trim().split('\n')[0] ?? 'Session';
  return ligne.length > 60 ? `${ligne.slice(0, 60)}…` : ligne;
}
