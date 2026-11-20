// Responsabilité : les tâches planifiées (P7) côté relais — liste, création ou modification, suppression, exécution
// à la demande. Chaque geste est relayé au poste de la machine ; le relais ne planifie rien lui-même.
import type { Logger } from 'pino';
import { z } from 'zod';
import { CorpsTache, IDENTIFIANT_TACHE, TachePlanifiee, TachesPlanifiees } from '../../commun/reste-lot2.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';

type Requete = Request & { params: Record<string, string> };

export interface DependancesTaches {
  readonly postes: Pick<Postes, 'vues' | 'commander'>;
  readonly journal: Logger;
}

const ReponseTache = z.object({ tache: TachePlanifiee });
const ReponseSuppression = z.object({ id: z.string() });

export class ApiTaches {
  constructor(private readonly d: DependancesTaches) {}

  async lister(req: Requete): Promise<Response> {
    const machine = this.machineConnue(req);
    if (typeof machine !== 'string') return machine;
    const r = await this.d.postes.commander(machine, { kind: 'taches_lister' });
    if (!r.ok) return erreur(r.erreur ?? 'tâches illisibles', REFUS_POSTE);
    const lues = TachesPlanifiees.safeParse(r.donnees);
    return lues.success ? json(lues.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  async enregistrer(req: Requete): Promise<Response> {
    const machine = this.machineConnue(req);
    if (typeof machine !== 'string') return machine;
    const tache = req.params['tid'] ?? '';
    if (!IDENTIFIANT_TACHE.test(tache)) return erreur('identifiant de tâche invalide', 400);
    const corps = await lireCorps(req, CorpsTache);
    if (corps instanceof Response) return corps;
    const r = await this.d.postes.commander(machine, { kind: 'tache_enregistrer', tache, corps });
    if (!r.ok) return erreur(r.erreur ?? 'enregistrement refusé', REFUS_POSTE);
    const lue = ReponseTache.safeParse(r.donnees);
    return lue.success ? json(lue.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  async supprimer(req: Requete): Promise<Response> {
    const machine = this.machineConnue(req);
    if (typeof machine !== 'string') return machine;
    const tache = req.params['tid'] ?? '';
    if (!IDENTIFIANT_TACHE.test(tache)) return erreur('identifiant de tâche invalide', 400);
    const r = await this.d.postes.commander(machine, { kind: 'tache_supprimer', tache });
    if (!r.ok) return erreur(r.erreur ?? 'suppression refusée', REFUS_POSTE);
    const lue = ReponseSuppression.safeParse(r.donnees);
    return lue.success ? json(lue.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  async executer(req: Requete): Promise<Response> {
    const machine = this.machineConnue(req);
    if (typeof machine !== 'string') return machine;
    const tache = req.params['tid'] ?? '';
    if (!IDENTIFIANT_TACHE.test(tache)) return erreur('identifiant de tâche invalide', 400);
    const r = await this.d.postes.commander(machine, { kind: 'tache_executer', tache });
    if (!r.ok) return erreur(r.erreur ?? 'exécution refusée', REFUS_POSTE);
    const lue = ReponseTache.safeParse(r.donnees);
    if (!lue.success) this.d.journal.warn({ machine, tache }, 'tâche : réponse du poste illisible');
    return lue.success ? json(lue.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  // La machine de l'URL, si elle figure au parc ; sinon la réponse 404 à rendre telle quelle.
  private machineConnue(req: Requete): string | Response {
    const id = req.params['id'] ?? '';
    return this.d.postes.vues().some((v) => v.id === id) ? id : erreur('machine inconnue', 404);
  }
}
