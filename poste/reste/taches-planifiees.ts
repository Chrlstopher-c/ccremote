// Responsabilité : les tâches planifiées du poste (P7) — fichier `taches-planifiees.json` du dossier de données :
// création ou modification (inactive par défaut), suppression, exécution (session neuve, comme « Nouvelle session »).
// La minuterie (minuterie-taches.ts) appelle `verifier` ; ce module ne tourne pas seul.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  type CorpsTache,
  ExecutionTache,
  Frequence,
  IDENTIFIANT_TACHE,
  type TachePlanifiee,
} from '../../commun/reste-lot2.ts';
import type { DemandeSession } from '../../commun/session.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { estDue, prochaineEcheance } from './echeance.ts';

const TacheStockee = z.object({
  id: z.string().regex(IDENTIFIANT_TACHE),
  nom: z.string(),
  dossier: z.string(),
  prompt: z.string(),
  modele: z.string().nullable(),
  frequence: Frequence,
  active: z.boolean(),
  activeLe: z.string().nullable(),
  derniere: ExecutionTache.nullable(),
});
export type TacheStockee = z.infer<typeof TacheStockee>;
const FichierTaches = z.array(TacheStockee);

export interface DependancesTaches {
  readonly fichier: string;
  readonly machine: string;
  readonly description: string;
  readonly racines: readonly string[];
  readonly ouvrir: (d: DemandeSession) => Promise<Reponse>;
  readonly journal: Logger;
  readonly maintenant?: () => Date;
}

export class ServiceTaches {
  private readonly enCours = new Set<string>();

  constructor(private readonly d: DependancesTaches) {}

  /** Toutes les tâches, avec leur prochaine exécution calculée à l'instant de la lecture. */
  lister(): Reponse {
    try {
      const maintenant = this.maintenant();
      return { ok: true, donnees: { taches: this.lire().map((t) => vue(t, maintenant)) } };
    } catch (erreur) {
      return this.echec('lecture des tâches impossible', erreur);
    }
  }

  /** Crée ou modifie la tâche `id` (un identifiant absent est généré). Une tâche neuve est inactive sauf demande. */
  enregistrer(id: string | undefined, corps: CorpsTache): Reponse {
    try {
      const taches = this.lire();
      const maintenant = this.maintenant();
      const cible = id ?? randomUUID();
      const existante = taches.find((t) => t.id === cible);
      const active = corps.active ?? existante?.active ?? false;
      const activeLe = active ? this.activeLe(existante, maintenant) : null;
      const tache: TacheStockee = {
        id: cible,
        nom: corps.nom,
        dossier: corps.dossier,
        prompt: corps.prompt,
        modele: corps.modele ?? null,
        frequence: corps.frequence,
        active,
        activeLe,
        derniere: existante?.derniere ?? null,
      };
      const suivantes = existante ? taches.map((t) => (t.id === cible ? tache : t)) : [...taches, tache];
      this.ecrire(suivantes);
      return { ok: true, donnees: { tache: vue(tache, maintenant) } };
    } catch (erreur) {
      return this.echec('enregistrement impossible', erreur);
    }
  }

  supprimer(id: string): Reponse {
    try {
      const taches = this.lire();
      if (!taches.some((t) => t.id === id)) return { ok: false, erreur: 'tâche inconnue' };
      this.ecrire(taches.filter((t) => t.id !== id));
      return { ok: true, donnees: { id } };
    } catch (erreur) {
      return this.echec('suppression impossible', erreur);
    }
  }

  /** Exécution à la demande de Chris : une session neuve, notée comme une exécution programmée. */
  async executer(id: string): Promise<Reponse> {
    const t = this.lireSansEchec().find((x) => x.id === id);
    if (!t) return { ok: false, erreur: 'tâche inconnue' };
    return this.lancer(t, this.maintenant());
  }

  /** Un tour de la minuterie : chaque tâche active et due crée sa session. */
  async verifier(): Promise<void> {
    const maintenant = this.maintenant();
    for (const t of this.lireSansEchec()) {
      if (estDue(t, maintenant)) await this.lancer(t, maintenant);
    }
  }

  private async lancer(t: TacheStockee, maintenant: Date): Promise<Reponse> {
    if (this.enCours.has(t.id)) return { ok: false, erreur: 'tâche déjà en cours de lancement' };
    this.enCours.add(t.id);
    const session = randomUUID();
    try {
      const r = await this.ouvrirSur(t, session);
      const execution: ExecutionTache = r.ok
        ? { le: maintenant.toISOString(), session, etat: 'lancee', erreur: null }
        : { le: maintenant.toISOString(), session: null, etat: 'echec', erreur: r.erreur ?? 'ouverture refusée' };
      this.noter(t.id, execution);
      if (!r.ok) return { ok: false, erreur: execution.erreur ?? 'ouverture refusée' };
      const desactivee = t.frequence.type === 'unique' ? false : t.active;
      return { ok: true, donnees: { tache: vue({ ...t, derniere: execution, active: desactivee }, maintenant) } };
    } catch (erreur) {
      this.d.journal.error({ err: erreur, tache: t.id }, 'tâche planifiée : exécution en échec');
      return { ok: false, erreur: String(erreur) };
    } finally {
      this.enCours.delete(t.id);
    }
  }

  private async ouvrirSur(t: TacheStockee, session: string): Promise<Reponse> {
    try {
      return await this.d.ouvrir(this.demandeDe(t, session));
    } catch (erreur) {
      return { ok: false, erreur: String(erreur) };
    }
  }

  // Une session neuve comme « Nouvelle session » : dossier, prompt en premier message, modèle si donné, défauts.
  private demandeDe(t: TacheStockee, session: string): DemandeSession {
    return {
      sessionId: session,
      projet: { machine: this.d.machine, chemin: t.dossier, nom: basename(t.dossier) || t.dossier },
      titre: t.nom,
      message: t.prompt,
      objectif: null,
      autonomie: false,
      ...(t.modele ? { modele: t.modele } : {}),
      style_sortie: null,
      bac_a_sable: 'non',
      controle_distant: false,
      parc: [{ id: this.d.machine, description: this.d.description, racines: [...this.d.racines] }],
    };
  }

  // Une tâche à l'activation prend cet instant comme repère ; une tâche déjà active garde le sien.
  private activeLe(existante: TacheStockee | undefined, maintenant: Date): string {
    return existante?.active && existante.activeLe !== null ? existante.activeLe : maintenant.toISOString();
  }

  // Note l'exécution ; une tâche unique se désactive après sa tentative.
  private noter(id: string, execution: ExecutionTache): void {
    try {
      const suivantes = this.lire().map((t) => {
        if (t.id !== id) return t;
        const desactivee = t.frequence.type === 'unique' ? { active: false, activeLe: null } : {};
        return { ...t, derniere: execution, ...desactivee };
      });
      this.ecrire(suivantes);
    } catch (erreur) {
      this.d.journal.error({ err: erreur, tache: id }, 'tâche planifiée : exécution non notée');
    }
  }

  private lireSansEchec(): TacheStockee[] {
    try {
      return this.lire();
    } catch (erreur) {
      this.d.journal.error({ err: erreur }, 'tâches planifiées illisibles : aucune exécution ce tour');
      return [];
    }
  }

  // Un fichier absent est une liste vide ; un fichier illisible lève (jamais écrasé en silence).
  private lire(): TacheStockee[] {
    let texte: string;
    try {
      texte = readFileSync(this.d.fichier, 'utf8');
    } catch (erreur) {
      if (typeof erreur === 'object' && erreur !== null && 'code' in erreur && erreur.code === 'ENOENT') return [];
      throw erreur;
    }
    const lu = FichierTaches.safeParse(JSON.parse(texte));
    if (!lu.success) throw new Error('fichier des tâches invalide');
    return lu.data;
  }

  private ecrire(taches: readonly TacheStockee[]): void {
    mkdirSync(dirname(this.d.fichier), { recursive: true });
    const temporaire = `${this.d.fichier}.tmp`;
    writeFileSync(temporaire, JSON.stringify(taches, null, 2));
    renameSync(temporaire, this.d.fichier);
  }

  private echec(message: string, erreur: unknown): Reponse {
    this.d.journal.error({ err: erreur }, `tâches planifiées : ${message}`);
    return { ok: false, erreur: message };
  }

  private maintenant(): Date {
    return this.d.maintenant?.() ?? new Date();
  }
}

// La forme publique d'une tâche : la prochaine exécution est calculée à la lecture, jamais stockée.
function vue(t: TacheStockee, maintenant: Date): TachePlanifiee {
  const prochaine = prochaineEcheance(t, maintenant);
  return {
    id: t.id,
    nom: t.nom,
    dossier: t.dossier,
    prompt: t.prompt,
    modele: t.modele,
    frequence: t.frequence,
    active: t.active,
    derniere: t.derniere,
    prochaine: prochaine === null ? null : prochaine.toISOString(),
  };
}
