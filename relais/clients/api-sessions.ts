// Responsabilité : les routes des sessions — ouvrir, lire le fil, parler, piloter (interrompre, compacter, fermer).
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { EffortSession, ModeSession, Projet, ReponseDialogue } from '../../commun/session.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { parcPour, verifierOuverture } from '../sessions/composition-parc.ts';
import type { Diffusion } from './diffusion.ts';
import { entier, erreur, json, lireCorps, REFUS_POSTE } from './http.ts';

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
});
const CorpsMessage = z.object({ texte: z.string().min(1) });
const CorpsAutonomie = z.object({ active: z.boolean() });
const CorpsNuit = z.object({ active: z.boolean(), objectif: z.string().max(300).optional() });
const CorpsMode = z.object({ mode: ModeSession });
const CorpsModele = z.object({ modele: z.string().min(1).max(120) });
const CorpsEffort = z.object({ effort: EffortSession.nullable() });
const CorpsTitre = z.object({ titre: z.string().trim().min(1).max(120) });
type Action = 'interrompre' | 'compacter' | 'fermer' | 'reprendre';
const ACTIONS: ReadonlySet<string> = new Set<string>(['interrompre', 'compacter', 'fermer', 'reprendre']);

type RequeteSession = Request & { params: { id: string; action?: string } };
type RequeteTache = Request & { params: { id: string; tache: string } };
type Lecture = { kind: 'contexte' } | { kind: 'connecteurs' } | { kind: 'taches' } | { kind: 'tache'; tache: string };

export class ApiSessions {
  constructor(
    private readonly registre: Registre,
    private readonly postes: Pick<Postes, 'commander'>,
    private readonly diffusion: Diffusion,
    private readonly isolees: ReadonlySet<string>,
    private readonly journal: Logger,
  ) {}

  async ouvrir(req: Request): Promise<Response> {
    const c = await lireCorps(req, CorpsOuverture);
    if (c instanceof Response) return c;
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
    };
    const r = await this.postes.commander(c.machine, { kind: 'ouvrir', demande });
    if (!r.ok) this.journal.warn({ machine: c.machine, erreur: r.erreur }, 'ouverture de session refusée');
    return r.ok ? json(r.donnees, 201) : erreur(r.erreur ?? 'ouverture refusée', REFUS_POSTE);
  }

  async evenements(req: RequeteSession): Promise<Response> {
    const url = new URL(req.url);
    const id = req.params.id;
    if (!this.registre.session(id)) return erreur('session inconnue', 404);
    if (!url.searchParams.has('apres')) return json(this.registre.derniersEvenements(id, 300));
    const apres = entier(url.searchParams.get('apres'), 0);
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
    return this.commander(req.params.id, { kind: 'envoyer', texte: c.texte });
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

  async renommer(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, CorpsTitre);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'renommer', titre: c.titre });
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

  connecteurs(req: RequeteSession): Promise<Response> {
    return this.lire(req.params.id, { kind: 'connecteurs' });
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
    if (!estAction(action)) return erreur('action inconnue', 404);
    return this.commander(req.params.id, { kind: action });
  }

  // Ranger est manuel : une session vivante est fermée d'abord (le fil reste lisible), et l'archivage n'est pas écrit
  // si la fermeture échoue. Le poste n'est jamais appelé pour désarchiver.
  private async archiver(sessionId: string, archivee: boolean): Promise<Response> {
    const session = this.registre.session(sessionId);
    if (!session) return erreur('session inconnue', 404);
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
  private epingler(sessionId: string, epinglee: boolean): Response {
    if (!this.registre.session(sessionId)) return erreur('session inconnue', 404);
    this.registre.definirEpinglee(sessionId, epinglee);
    const vue = this.registre.session(sessionId);
    if (vue) this.diffusion.diffuser({ type: 'session', session: vue });
    return json({ ok: true, epinglee });
  }

  private async lire(sessionId: string, c: Lecture, absenteEst404 = false): Promise<Response> {
    const session = this.registre.session(sessionId);
    if (!session) return erreur('session inconnue', 404);
    const r = await this.postes.commander(session.machine, { ...c, sessionId });
    if (!r.ok) {
      this.journal.warn({ sessionId, lecture: c.kind, erreur: r.erreur }, 'lecture refusée');
      return erreur(r.erreur ?? 'lecture refusée', REFUS_POSTE);
    }
    if (absenteEst404 && r.donnees === null) return erreur('tâche inconnue', 404);
    return json(r.donnees ?? null);
  }

  private async commander(
    sessionId: string,
    c:
      | { kind: 'envoyer'; texte: string }
      | { kind: 'autonomie'; active: boolean }
      | { kind: 'nuit'; active: boolean; objectif?: string | undefined }
      | { kind: 'repondre'; reponse: ReponseDialogue }
      | { kind: 'mode'; mode: ModeSession }
      | { kind: 'modele'; modele: string }
      | { kind: 'effort'; effort: EffortSession | null }
      | { kind: 'renommer'; titre: string }
      | { kind: Action },
  ): Promise<Response> {
    const session = this.registre.session(sessionId);
    if (!session) return erreur('session inconnue', 404);
    const r = await this.postes.commander(session.machine, { ...c, sessionId });
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
