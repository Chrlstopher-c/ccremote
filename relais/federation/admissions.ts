// Responsabilité : la propagation des admissions d'appareils entre nœuds de mêmes propriétaire. Un appareil admis
// une fois (appairage accepté par Chris) est reconnu par toutes les machines : chaque nœud envoie à ses pairs
// la photo de ses appareils admis et de leurs révocations, et range celle de ses pairs. Fonctions pures :
// Federation sauvegarde, ferme les canaux et relaie.
import { type AppareilAdmis, NOMBRE_MAX_APPAREILS_ADMIS } from '../../commun/federation.ts';
import type { PairFederee } from './secrets.ts';

export interface PhotoAdmissions {
  readonly liste: AppareilAdmis[];
  readonly retires: string[];
}

export interface FusionAdmissions {
  readonly pairs: PairFederee[];
  readonly revoques: string[];
  readonly ajoutes: string[];
  readonly retires: string[];
  /** Identifiants reçus avec une clé différente de celle qu'on connaît : ignorés, à signaler. */
  readonly conflits: string[];
  /** Vrai si la fusion a changé quelque chose (à relayer aux autres pairs). */
  readonly changee: boolean;
}

/** D'où vient une photo : un de nos nœuds, un autre propriétaire, ou un membre qui n'est pas apparié. */
export type VerdictSource = 'accepte' | 'non-appaire' | 'autre-proprietaire';

export function verdictSource(
  pairs: readonly PairFederee[],
  membre: string,
  refusProprietaire: string | null,
): VerdictSource {
  if (!pairs.some((p) => p.id === membre && p.genre === 'noeud')) return 'non-appaire';
  return refusProprietaire === null ? 'accepte' : 'autre-proprietaire';
}

/** La photo que ce nœud envoie : ses appareils admis (les siens et ceux reçus de ses pairs) et les révocations. */
export function photoAdmissions(
  pairs: readonly PairFederee[],
  revoques: readonly string[],
  moi: string,
): PhotoAdmissions {
  const liste = pairs
    .filter((p) => p.genre === 'appareil')
    .slice(0, NOMBRE_MAX_APPAREILS_ADMIS)
    .map((p) => ({ id: p.id, nom: p.nom, identite: p.identite, admisPar: p.admisPar ?? moi, le: p.creeLe }));
  return { liste, retires: revoques.slice(0, NOMBRE_MAX_APPAREILS_ADMIS) };
}

/**
 * Range la photo d'un pair. Une révocation est définitive (elle retire l'appareil et bloque toute admission future de
 * cet identifiant) ; une admission ajoute l'appareil, sauf si son identifiant est révoqué ou désigne un nœud.
 */
export function fusionner(
  photo: PhotoAdmissions,
  pairs: readonly PairFederee[],
  revoques: readonly string[],
  moi: string,
): FusionAdmissions {
  const morts = new Set(revoques);
  const avant = morts.size;
  const { etat, retires } = appliquerRetraits(photo.retires, [...pairs], morts, moi);
  const { ajoutes, conflits } = appliquerAdmissions(photo.liste, etat, morts, moi);
  const changee = ajoutes.length > 0 || retires.length > 0 || morts.size !== avant;
  return { pairs: etat.courant, revoques: [...morts], ajoutes, retires, conflits, changee };
}

/** Les nœuds à présenter à un appareil admis : soi-même d'abord (s'il est connu), puis les nœuds appairés. */
export interface NoeudAnnonce {
  readonly id: string;
  readonly nom: string;
  readonly identite: string;
}

export function noeudsAnnonces(pairs: readonly PairFederee[], moi: NoeudAnnonce | null): NoeudAnnonce[] {
  const appaires = pairs
    .filter((p) => p.genre === 'noeud')
    .map((p) => ({ id: p.id, nom: p.nom, identite: p.identite }));
  return moi ? [moi, ...appaires] : appaires;
}

function estNoeud(pairs: readonly PairFederee[], id: string): boolean {
  return pairs.some((p) => p.id === id && p.genre === 'noeud');
}

function appliquerRetraits(
  ids: readonly string[],
  courant: PairFederee[],
  morts: Set<string>,
  moi: string,
): { etat: { courant: PairFederee[] }; retires: string[] } {
  const retires: string[] = [];
  for (const id of ids) {
    if (estNoeud(courant, id) || id === moi) continue;
    morts.add(id);
    const pair = courant.find((p) => p.id === id);
    if (pair?.genre !== 'appareil') continue;
    courant.splice(courant.indexOf(pair), 1);
    retires.push(id);
  }
  return { etat: { courant }, retires };
}

function appliquerAdmissions(
  liste: readonly AppareilAdmis[],
  etat: { courant: PairFederee[] },
  morts: Set<string>,
  moi: string,
): { ajoutes: string[]; conflits: string[] } {
  const ajoutes: string[] = [];
  const conflits: string[] = [];
  for (const admis of liste) {
    if (morts.has(admis.id) || admis.id === moi || estNoeud(etat.courant, admis.id)) continue;
    const existant = etat.courant.find((p) => p.id === admis.id);
    if (!existant) {
      etat.courant.push(pairDe(admis));
      ajoutes.push(admis.id);
    } else if (existant.identite !== admis.identite) {
      conflits.push(admis.id);
    }
  }
  return { ajoutes, conflits };
}

function pairDe(admis: AppareilAdmis): PairFederee {
  return {
    id: admis.id,
    nom: admis.nom,
    identite: admis.identite,
    creeLe: admis.le,
    genre: 'appareil',
    admisPar: admis.admisPar,
  };
}
