// Responsabilité : la parité d'une session côté relais — contexte, résultats, tâches et dépôt lus par son poste dans le
// transcript. Le relais ne lit aucun fichier : il relaie, borne le délai, valide la réponse du poste et la rend telle
// quelle. Une session sans poste joignable donne la parité vide (200), pas une erreur.
import type { Logger } from 'pino';
import {
  DELAI_PARITE_MS,
  PARITE_VIDE,
  PariteSession,
  ReponseFilTacheParite,
  ReponseResultatParite,
  ReponseTacheParite,
} from '../../commun/parite.ts';
import { erreur, json, REFUS_POSTE } from '../clients/http.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import type { ResumeSession } from '../../commun/session.ts';

type Requete = Request & { params: Record<string, string> };
type CommandeSansId = Parameters<Postes['commander']>[1];

export interface DependancesParite {
  readonly registre: Pick<Registre, 'session'>;
  readonly postes: Pick<Postes, 'commander'>;
  readonly journal: Logger;
  readonly delaiMs?: number;
}

const DELAI_DEPASSE = Symbol('delai');
const LONGUEUR_MAX_CHEMIN = 4096;
const LONGUEUR_MAX_TACHE = 200;

export class ApiParite {
  constructor(private readonly d: DependancesParite) {}

  /** La parité de la session ; session inconnue, poste absent ou réponse illisible : parité vide. */
  async parite(req: Requete): Promise<Response> {
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return json(PARITE_VIDE);
    const r = await this.interroger(s, {
      kind: 'parite',
      sessionId: s.id,
      claudeSessionId: s.claudeSessionId,
      cwd: s.cwd,
    });
    if (r === null || !r.ok) return json(PARITE_VIDE);
    const lue = PariteSession.safeParse(r.donnees);
    if (lue.success) return json(lue.data);
    this.d.journal.warn({ session: s.id }, 'parité : réponse du poste illisible');
    return json(PARITE_VIDE);
  }

  /** Le détail d'une tâche (id du tool_use) : 404 si la session ou la tâche est inconnue. */
  async tache(req: Requete): Promise<Response> {
    const tache = req.params['tache'] ?? '';
    if (tache === '' || tache.length > LONGUEUR_MAX_TACHE) return erreur('identifiant de tâche invalide', 400);
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return erreur('session inconnue', 404);
    const r = await this.interroger(s, {
      kind: 'parite_tache',
      sessionId: s.id,
      claudeSessionId: s.claudeSessionId,
      cwd: s.cwd,
      tache,
    });
    if (r === null || !r.ok) return erreur(r?.erreur ?? 'tâche illisible : pas de réponse du poste', REFUS_POSTE);
    const lue = ReponseTacheParite.safeParse(r.donnees);
    if (!lue.success) return erreur('réponse du poste illisible', REFUS_POSTE);
    return lue.data.tache === null ? erreur('tâche inconnue', 404) : json(lue.data.tache);
  }

  /** Le fil complet d'un sous-agent (tâche = id du tool_use) : 404 si la session ou la tâche est inconnue. */
  async filTache(req: Requete): Promise<Response> {
    const tache = req.params['tache'] ?? '';
    if (tache === '' || tache.length > LONGUEUR_MAX_TACHE) return erreur('identifiant de tâche invalide', 400);
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return erreur('session inconnue', 404);
    const r = await this.interroger(s, {
      kind: 'parite_fil_tache',
      sessionId: s.id,
      claudeSessionId: s.claudeSessionId,
      cwd: s.cwd,
      tache,
    });
    if (r === null || !r.ok) return erreur(r?.erreur ?? 'fil illisible : pas de réponse du poste', REFUS_POSTE);
    const lue = ReponseFilTacheParite.safeParse(r.donnees);
    if (!lue.success) return erreur('réponse du poste illisible', REFUS_POSTE);
    return lue.data.fil === null ? erreur('tâche inconnue', 404) : json(lue.data.fil);
  }

  /** Le contenu d'un résultat de la session (`?chemin=`), seulement s'il en fait partie. */
  async resultat(req: Requete): Promise<Response> {
    const chemin = new URL(req.url).searchParams.get('chemin') ?? '';
    if (chemin === '' || chemin.length > LONGUEUR_MAX_CHEMIN) return erreur('chemin attendu', 400);
    const s = this.d.registre.session(req.params['id'] ?? '');
    if (!s) return erreur('session inconnue', 404);
    const r = await this.interroger(s, {
      kind: 'parite_resultat',
      sessionId: s.id,
      claudeSessionId: s.claudeSessionId,
      cwd: s.cwd,
      chemin,
    });
    if (r === null || !r.ok) return erreur(r?.erreur ?? 'résultat illisible : pas de réponse du poste', REFUS_POSTE);
    const lue = ReponseResultatParite.safeParse(r.donnees);
    if (!lue.success) return erreur('réponse du poste illisible', REFUS_POSTE);
    const reponse = lue.data;
    if (reponse.etat === 'refus') return erreur(reponse.raison, reponse.statut);
    return json({ mime: reponse.mime, base64: reponse.base64 });
  }

  // Le poste de la session, borné à DELAI_PARITE_MS ; null si le délai est dépassé.
  private async interroger(s: ResumeSession, commande: CommandeSansId): Promise<ReponsePoste | null> {
    const attente = this.d.postes.commander(s.machine, commande);
    const r = await avecDelai(attente, this.d.delaiMs ?? DELAI_PARITE_MS);
    return r === DELAI_DEPASSE ? null : r;
  }
}

async function avecDelai<T>(attente: Promise<T>, ms: number): Promise<T | typeof DELAI_DEPASSE> {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<typeof DELAI_DEPASSE>((resoudre) => {
    minuterie = setTimeout(() => resoudre(DELAI_DEPASSE), ms);
  });
  try {
    return await Promise.race([attente, delai]);
  } finally {
    clearTimeout(minuterie);
  }
}
