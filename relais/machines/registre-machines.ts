// Responsabilité : la table des machines configurées (connexion SSH), lue et écrite dans la base du relais.
// Aucun secret ici : la clé est un chemin vers un fichier hors dépôt ; le secret du poste est un fichier 600.
import type { Database } from 'bun:sqlite';
import type { ConfigMachine, ModifMachine } from './modele.ts';

export interface MachineConfiguree extends Omit<ConfigMachine, 'portDistant'> {
  readonly portDistant: number; // port d'écoute du tunnel sur la machine distante (toujours renseigné en base)
  readonly cree_le: string;
  readonly maj_le: string;
}

interface Ligne {
  id: string;
  description: string;
  hote: string;
  port: number;
  utilisateur: string;
  cle: string;
  dossier: string;
  port_distant: number;
  cree_le: string;
  maj_le: string;
}

const COLONNES = 'id, description, hote, port, utilisateur, cle, dossier, port_distant, cree_le, maj_le';

function versMachine(l: Ligne): MachineConfiguree {
  const { port_distant: portDistant, ...reste } = l;
  return { ...reste, portDistant };
}

export class RegistreMachines {
  constructor(private readonly db: Database) {}

  lister(): MachineConfiguree[] {
    return (this.db.query(`SELECT ${COLONNES} FROM machines_ssh ORDER BY id`).all() as Ligne[]).map(versMachine);
  }

  lire(id: string): MachineConfiguree | null {
    const l = this.db.query(`SELECT ${COLONNES} FROM machines_ssh WHERE id = $id`).get({ id }) as Ligne | null;
    return l ? versMachine(l) : null;
  }

  /** Port distant déjà pris par une autre machine (deux tunnels ne peuvent pas écouter sur le même port). */
  portPris(port: number, sauf: string): boolean {
    return this.lister().some((m) => m.portDistant === port && m.id !== sauf);
  }

  inserer(c: ConfigMachine, portDistant: number, quand: string): void {
    this.db
      .query(
        `INSERT INTO machines_ssh (id, description, hote, port, utilisateur, cle, dossier, port_distant, cree_le, maj_le)
         VALUES ($id, $description, $hote, $port, $utilisateur, $cle, $dossier, $portDistant, $quand, $quand)`,
      )
      .run({
        id: c.id,
        description: c.description,
        hote: c.hote,
        port: c.port,
        utilisateur: c.utilisateur,
        cle: c.cle,
        dossier: c.dossier,
        portDistant,
        quand,
      });
  }

  /** Mise à jour partielle : seuls les champs fournis changent. Rend false si la machine n'existe pas. */
  modifier(id: string, patch: ModifMachine, quand: string): boolean {
    const actuelle = this.lire(id);
    if (!actuelle) return false;
    const f = { ...actuelle, ...patch };
    this.db
      .query(
        `UPDATE machines_ssh SET description = $description, hote = $hote, port = $port, utilisateur = $utilisateur,
           cle = $cle, dossier = $dossier, port_distant = $portDistant, maj_le = $quand WHERE id = $id`,
      )
      .run({
        id,
        description: f.description,
        hote: f.hote,
        port: f.port,
        utilisateur: f.utilisateur,
        cle: f.cle,
        dossier: f.dossier,
        portDistant: f.portDistant,
        quand,
      });
    return true;
  }

  supprimer(id: string): boolean {
    return this.db.query('DELETE FROM machines_ssh WHERE id = $id').run({ id }).changes > 0;
  }
}
