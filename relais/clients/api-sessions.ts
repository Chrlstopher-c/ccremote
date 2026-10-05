// Responsabilité : les routes des sessions — ouvrir, lire le fil, parler, piloter (interrompre, compacter, fermer).
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { Projet, ReponseDialogue } from '../../commun/session.ts';
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
});
const CorpsMessage = z.object({ texte: z.string().min(1) });
const CorpsAutonomie = z.object({ active: z.boolean() });
const CorpsNuit = z.object({ active: z.boolean(), objectif: z.string().max(300).optional() });
const ACTIONS = new Set(['interrompre', 'compacter', 'fermer', 'reprendre'] as const);
type Action = 'interrompre' | 'compacter' | 'fermer' | 'reprendre';

type RequeteSession = Request & { params: { id: string; action?: string } };

export class ApiSessions {
  constructor(
    private readonly registre: Registre,
    private readonly postes: Postes,
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

  async repondre(req: RequeteSession): Promise<Response> {
    const c = await lireCorps(req, ReponseDialogue);
    if (c instanceof Response) return c;
    return this.commander(req.params.id, { kind: 'repondre', reponse: c });
  }

  async action(req: RequeteSession): Promise<Response> {
    const action = req.params.action as Action; // vérifié juste en dessous contre la liste fermée
    if (!ACTIONS.has(action)) return erreur('action inconnue', 404);
    return this.commander(req.params.id, { kind: action });
  }

  private async commander(
    sessionId: string,
    c:
      | { kind: 'envoyer'; texte: string }
      | { kind: 'autonomie'; active: boolean }
      | { kind: 'nuit'; active: boolean; objectif?: string | undefined }
      | { kind: 'repondre'; reponse: ReponseDialogue }
      | { kind: Action },
  ): Promise<Response> {
    const session = this.registre.session(sessionId);
    if (!session) return erreur('session inconnue', 404);
    const r = await this.postes.commander(session.machine, { ...c, sessionId });
    if (!r.ok) this.journal.warn({ sessionId, commande: c.kind, erreur: r.erreur }, 'commande refusée');
    return r.ok ? json(r.donnees ?? {}) : erreur(r.erreur ?? 'commande refusée', REFUS_POSTE);
  }
}

function titreDepuis(message: string): string {
  const ligne = message.trim().split('\n')[0] ?? 'Session';
  return ligne.length > 60 ? `${ligne.slice(0, 60)}…` : ligne;
}
