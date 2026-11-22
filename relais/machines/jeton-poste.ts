// Responsabilité : émettre le jeton d'un poste (son secret), commun à la commande locale `jeton-poste` et à
// l'appairage d'une machine (POST /api/appareils/appairer avec `machine`). Un secret existant n'est renouvelé que si
// l'appelant le demande : le fichier 600 et la table du relais sont alors mis à jour ensemble.
import { join } from 'node:path';
import { type FichiersPoste, fichiersPoste } from './installer.ts';
import { chargerSecretsPostes, retirerSecretPoste, secretPoste } from './secrets.ts';

export const MACHINE_VALIDE = /^[a-z0-9-]+$/;
export const RELAIS_VALIDE = /^wss?:\/\//;

export interface DemandeJetonPoste {
  readonly dossier: string;
  readonly machine: string;
  readonly relais: string; // adresse WebSocket du lien des postes, vue par le poste
  readonly secrets: Map<string, string>; // table du relais (ou une table neuve pour la commande locale)
  readonly remplacer: boolean;
}

export interface JetonPoste {
  readonly secret: string;
  readonly fichiers: FichiersPoste;
}

export function emettreJetonPoste(demande: DemandeJetonPoste): JetonPoste {
  const { dossier, machine, relais, secrets, remplacer } = demande;
  if (!MACHINE_VALIDE.test(machine)) throw new Error(`identifiant de poste invalide : « ${machine} »`);
  if (!RELAIS_VALIDE.test(relais)) throw new Error('adresse du relais invalide : ws:// ou wss:// attendu');
  if (!remplacer && chargerSecretsPostes(dossier).has(machine)) {
    const fichier = join(dossier, `${machine}.secret`);
    throw new Error(`un jeton existe déjà pour « ${machine} » : supprimer ${fichier} pour le renouveler`);
  }
  if (remplacer) retirerSecretPoste(dossier, machine, secrets);
  const secret = secretPoste(dossier, machine, secrets);
  return { secret, fichiers: fichiersPoste(machine, machine, relais, secret) };
}
