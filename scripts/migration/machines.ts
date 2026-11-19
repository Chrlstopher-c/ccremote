// Responsabilité : copier les environnements et les machines SSH de la source vers la cible — sans la machine locale,
// avec la machine tour ajoutée depuis les options (jamais une adresse en dur).
import type { Database } from 'bun:sqlite';
import type { OptionsTour } from './options.ts';
import { compte, type Compte } from './rapport.ts';

interface LigneEnvironnement {
  readonly machine: string;
  readonly dossier: string;
  readonly enregistre_le: string;
}

interface LigneMachineSsh {
  readonly id: string;
  readonly description: string;
  readonly hote: string;
  readonly port: number;
  readonly utilisateur: string;
  readonly cle: string;
  readonly dossier: string;
  readonly cree_le: string;
  readonly maj_le: string;
}

export const ID_TOUR = 'tour';

export function copierEnvironnements(source: Database, cible: Database): Compte {
  const requete = 'SELECT machine, dossier, enregistre_le FROM environnements';
  const lignes = source.query(requete).all() as LigneEnvironnement[];
  let ajoutes = 0;
  let misesAJour = 0;
  for (const ligne of lignes) {
    const existant = cible
      .query('SELECT enregistre_le FROM environnements WHERE machine = $m AND dossier = $d')
      .get({ m: ligne.machine, d: ligne.dossier }) as { enregistre_le: string } | null;
    if (existant === null) {
      cible
        .query('INSERT INTO environnements (machine, dossier, enregistre_le) VALUES ($m, $d, $q)')
        .run({ m: ligne.machine, d: ligne.dossier, q: ligne.enregistre_le });
      ajoutes++;
    } else if (existant.enregistre_le !== ligne.enregistre_le) {
      cible
        .query('UPDATE environnements SET enregistre_le = $q WHERE machine = $m AND dossier = $d')
        .run({ m: ligne.machine, d: ligne.dossier, q: ligne.enregistre_le });
      misesAJour++;
    }
  }
  return compte(lignes.length, ajoutes, misesAJour);
}

export interface BilanMachines {
  readonly compte: Compte;
  readonly retirees: number;
}

export function copierMachinesSsh(
  source: Database,
  cible: Database,
  machineLocale: string,
  tour: OptionsTour | null,
): BilanMachines {
  const lignes = (source.query('SELECT * FROM machines_ssh ORDER BY id').all() as LigneMachineSsh[]).filter(
    (l) => l.id !== machineLocale,
  );
  const retirees = cible.query('DELETE FROM machines_ssh WHERE id = $id').run({ id: machineLocale }).changes;
  let ajoutees = 0;
  let misesAJour = 0;
  for (const ligne of lignes) {
    const etat = inscrire(cible, ligne);
    if (etat === 'ajoutee') ajoutees++;
    if (etat === 'mise_a_jour') misesAJour++;
  }
  let lus = lignes.length;
  if (tour !== null) {
    lus++;
    const etat = inscrireTour(cible, tour);
    if (etat === 'ajoutee') ajoutees++;
    if (etat === 'mise_a_jour') misesAJour++;
  } else if (!presente(cible, ID_TOUR)) {
    throw new Error(
      `la machine « ${ID_TOUR} » est absente de la cible : passer --tour-hote, --tour-utilisateur et --tour-cle`,
    );
  }
  return { compte: compte(lus, ajoutees, misesAJour), retirees };
}

type EtatLigne = 'ajoutee' | 'mise_a_jour' | 'ignoree';

function inscrire(cible: Database, ligne: LigneMachineSsh): EtatLigne {
  const existante = cible.query('SELECT * FROM machines_ssh WHERE id = $id').get({ id: ligne.id }) as
    | LigneMachineSsh
    | null;
  if (existante !== null && JSON.stringify(existante) === JSON.stringify(ligne)) return 'ignoree';
  cible
    .query(
      `INSERT INTO machines_ssh (id, description, hote, port, utilisateur, cle, dossier, cree_le, maj_le)
      VALUES ($id, $description, $hote, $port, $utilisateur, $cle, $dossier, $cree_le, $maj_le)
      ON CONFLICT(id) DO UPDATE SET description = $description, hote = $hote, port = $port,
      utilisateur = $utilisateur, cle = $cle, dossier = $dossier, cree_le = $cree_le, maj_le = $maj_le`,
    )
    .run({
      id: ligne.id,
      description: ligne.description,
      hote: ligne.hote,
      port: ligne.port,
      utilisateur: ligne.utilisateur,
      cle: ligne.cle,
      dossier: ligne.dossier,
      cree_le: ligne.cree_le,
      maj_le: ligne.maj_le,
    });
  return existante === null ? 'ajoutee' : 'mise_a_jour';
}

// La machine tour ne vient jamais de la source (le relais de la tour ne se connaît pas) : elle vient des options.
function inscrireTour(cible: Database, tour: OptionsTour): EtatLigne {
  const existante = cible.query('SELECT * FROM machines_ssh WHERE id = $id').get({ id: ID_TOUR }) as
    | LigneMachineSsh
    | null;
  const maintenant = new Date().toISOString();
  const ligne: LigneMachineSsh = {
    id: ID_TOUR,
    description: tour.description,
    hote: tour.hote,
    port: tour.port,
    utilisateur: tour.utilisateur,
    cle: tour.cle,
    dossier: existante?.dossier ?? '~',
    cree_le: existante?.cree_le ?? maintenant,
    maj_le: maintenant,
  };
  const memeConnexion =
    existante !== null &&
    existante.hote === tour.hote &&
    existante.port === tour.port &&
    existante.utilisateur === tour.utilisateur &&
    existante.cle === tour.cle &&
    existante.description === tour.description;
  if (memeConnexion) return 'ignoree';
  return inscrire(cible, ligne) === 'ajoutee' ? 'ajoutee' : 'mise_a_jour';
}

function presente(cible: Database, id: string): boolean {
  return cible.query('SELECT 1 FROM machines_ssh WHERE id = $id').get({ id }) !== null;
}
