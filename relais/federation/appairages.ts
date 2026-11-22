// Responsabilité : les appairages en cours vus par l'appli — pour chacun, la phase, et dès que le pair s'est présenté,
// son nom et l'empreinte de sa clé : ce que Chris compare à l'écran de l'autre machine avant qu'elle accepte.
import { empreinteIdentite, importerIdentitePublique } from '../../commun/chiffrement/identite.ts';
import type { CanalNoeud } from './canal.ts';

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
