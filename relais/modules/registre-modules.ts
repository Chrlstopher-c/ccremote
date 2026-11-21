// Responsabilité : la table des modules du relais — un enregistrement par identifiant, le plus récent gagne. Un module
// en erreur a `erreur` renseigné et ni manifeste ni fichiers ; un retrait ne touche que la machine qui le possède.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import type { FichierModule, ManifesteModule } from '../../commun/modules.ts';
import type { MessagePoste } from '../../commun/protocole-poste.ts';

export type MessageModuleRecu = Extract<MessagePoste, { kind: 'module' | 'module_erreur' }>;

export interface ModuleRelais {
  readonly id: string;
  readonly manifeste: ManifesteModule | null;
  readonly empreinte: string | null;
  readonly machine: string;
  readonly maj_le: string;
  readonly erreur: string | null;
  /** Chemins des fichiers du module (vide pour un module en erreur) : le client sait quoi télécharger. */
  readonly fichiers: readonly string[];
}

type LigneModule = {
  id: string;
  machine: string;
  manifeste: string | null;
  fichiers: string;
  empreinte: string | null;
  maj_le: string;
  erreur: string | null;
};

export class RegistreModules {
  constructor(
    private readonly db: Database,
    private readonly journal?: Logger,
  ) {}

  /** Enregistre un module ou son erreur venu de `machine` ; rend vrai si l'état visible a changé. */
  enregistrer(machine: string, m: MessageModuleRecu): boolean {
    const erreur = m.kind === 'module_erreur' ? m.erreur : null;
    const empreinte = m.kind === 'module' ? m.empreinte : null;
    const actuel = this.ligne(m.id);
    const inchange =
      actuel !== null && actuel.machine === machine && actuel.erreur === erreur && actuel.empreinte === empreinte;
    if (inchange) return false;
    const manifeste = m.kind === 'module' ? JSON.stringify(m.manifeste) : null;
    const fichiers = m.kind === 'module' ? JSON.stringify(m.fichiers) : '[]';
    try {
      this.db
        .query(
          `INSERT INTO modules (id, machine, manifeste, fichiers, empreinte, maj_le, erreur)
           VALUES ($id, $machine, $manifeste, $fichiers, $empreinte, $maj, $erreur)
           ON CONFLICT(id) DO UPDATE SET machine = $machine, manifeste = $manifeste, fichiers = $fichiers,
             empreinte = $empreinte, maj_le = $maj, erreur = $erreur`,
        )
        .run({ id: m.id, machine, manifeste, fichiers, empreinte, maj: new Date().toISOString(), erreur });
    } catch (e) {
      this.journal?.error({ erreur: String(e), module: m.id }, 'module : écriture impossible');
      throw e;
    }
    return true;
  }

  /** Retire le module s'il appartient à `machine` ; rend vrai s'il a été retiré. */
  retirer(id: string, machine: string): boolean {
    return this.db.query('DELETE FROM modules WHERE id = $id AND machine = $machine').run({ id, machine }).changes > 0;
  }

  lister(): ModuleRelais[] {
    const lignes = this.db.query('SELECT * FROM modules ORDER BY id').all() as LigneModule[];
    return lignes.map((l) => ({
      id: l.id,
      manifeste: l.manifeste === null ? null : (JSON.parse(l.manifeste) as ManifesteModule),
      empreinte: l.empreinte,
      machine: l.machine,
      maj_le: l.maj_le,
      erreur: l.erreur,
      fichiers: l.erreur === null ? (JSON.parse(l.fichiers) as FichierModule[]).map((f) => f.chemin) : [],
    }));
  }

  /** Contenu d'un fichier d'un module sain ; `null` si le module est absent, en erreur, ou sans ce fichier. */
  fichier(id: string, chemin: string): FichierModule | null {
    const l = this.ligne(id);
    if (!l || l.erreur !== null) return null;
    const fichiers = JSON.parse(l.fichiers) as FichierModule[];
    return fichiers.find((f) => f.chemin === chemin) ?? null;
  }

  private ligne(id: string): LigneModule | null {
    return (this.db.query('SELECT * FROM modules WHERE id = $id').get({ id }) as LigneModule | null) ?? null;
  }
}
