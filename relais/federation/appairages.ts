// Responsabilité : les pairs et les appairages en cours vus par l'appli, et l'identité du nœud. Appairages en cours : pour chacun, la phase, et dès que le pair s'est présenté,
// son nom et l'empreinte de sa clé : ce que Chris compare à l'écran de l'autre machine avant qu'elle accepte.
import {
  empreinteIdentite,
  exporterIdentitePrivee,
  genererIdentite,
  type Identite,
  importerIdentitePrivee,
  importerIdentitePublique,
} from '../../commun/chiffrement/identite.ts';
import type { CanalNoeud } from './canal.ts';
import type { PairFederee, SecretsNoeud } from './secrets.ts';

export interface NoeudAppaire {
  readonly id: string;
  readonly nom: string;
  readonly empreinte: string;
  readonly enLigne: boolean;
  readonly liaisonOuverte: boolean;
}

/** Un pair apparié tel que l'appli le voit : nom, empreinte de sa clé, présence et état du lien. */
export async function noeudAppaire(p: PairFederee, enLigne: boolean, liaisonOuverte: boolean): Promise<NoeudAppaire> {
  const empreinte = await empreinteIdentite(await importerIdentitePublique(p.identite)).catch(() => '');
  return { id: p.id, nom: p.nom, empreinte, enLigne, liaisonOuverte };
}

/** L'identité du nœud : lue dans ses secrets, ou créée et gardée la première fois. */
export async function chargerIdentite(secrets: SecretsNoeud): Promise<Identite> {
  const existante = secrets.lireIdentitePrivee();
  if (existante) return importerIdentitePrivee(existante);
  const neuve = await genererIdentite();
  secrets.ecrireIdentitePrivee(await exporterIdentitePrivee(neuve));
  return neuve;
}

export interface AppairageEnCours {
  readonly membre: string;
  readonly phase: string;
  readonly nom: string | null;
  readonly empreinte: string | null;
}

export function appairagesEnCours(canaux: readonly CanalNoeud[]): Promise<AppairageEnCours[]> {
  return Promise.all(canaux.filter((c) => c.intention === 'appairage').map(appairage));
}

async function appairage(c: CanalNoeud): Promise<AppairageEnCours> {
  const p = c.presentationDuPair;
  const empreinte = p ? await empreinteIdentite(await importerIdentitePublique(p.identite)).catch(() => null) : null;
  return { membre: c.membre, phase: c.phase, nom: p?.nom ?? null, empreinte };
}
