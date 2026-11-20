// Responsabilité : les lectures et gestes du lot 2 liés à UNE session — résumés de compaction (B5) et demande de
// fusion (P3). Chaque geste est relayé au poste de la session ; le relais ne lit aucun fichier.
import type { Logger } from 'pino';
import { Compactions, CorpsFusion, EtatFusion, ResultatFusion } from '../../commun/reste-lot2.ts';
import { erreur, json, lireCorps, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';

type Requete = Request & { params: Record<string, string> };

export interface DependancesResteSessions {
  readonly registre: Pick<Registre, 'session'>;
  readonly postes: Pick<Postes, 'commander'>;
  readonly journal: Logger;
}

export class ApiResteSessions {
  constructor(private readonly d: DependancesResteSessions) {}

  /** Résumés de compaction de la session, plus ancien d'abord ; session inconnue : aucun résumé. */
  async compactions(req: Requete): Promise<Response> {
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return json({ resumes: [] });
    const r = await this.d.postes.commander(s.machine, { kind: 'compactions', sessionId: s.id });
    if (!r.ok) return erreur(r.erreur ?? 'compactions illisibles', REFUS_POSTE);
    const lus = Compactions.safeParse(r.donnees);
    return lus.success ? json(lus.data) : erreur('réponse du poste illisible', REFUS_POSTE);
  }

  /** La PR de la branche de la session, lue sur son poste. Poste injoignable : état absent, raison à l'appui. */
  async etatFusion(req: Requete): Promise<Response> {
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return erreur('session inconnue', 404);
    const r = await this.d.postes.commander(s.machine, { kind: 'pr_etat', sessionId: s.id });
    if (!r.ok) return json({ etat: 'absente', raison: r.erreur ?? 'poste injoignable' });
    const lu = EtatFusion.safeParse(r.donnees);
    return json(lu.success ? lu.data : { etat: 'absente', raison: 'réponse du poste illisible' });
  }

  /** Pousse la branche et crée la PR sur le poste de la session (brouillon si demandé). */
  async creerFusion(req: Requete): Promise<Response> {
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return erreur('session inconnue', 404);
    const c = await lireCorps(req, CorpsFusion);
    if (c instanceof Response) return c;
    const r = await this.d.postes.commander(s.machine, { kind: 'pr_creer', sessionId: s.id, ...c });
    if (!r.ok) return json({ etat: 'erreur', raison: r.erreur ?? 'poste injoignable' });
    const lu = ResultatFusion.safeParse(r.donnees);
    return json(lu.success ? lu.data : { etat: 'erreur', raison: 'réponse du poste illisible' });
  }
}
