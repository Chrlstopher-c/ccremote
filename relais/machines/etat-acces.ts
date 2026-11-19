// Responsabilité : l'état d'accès d'une machine au relais (local, connecte, connexion, injoignable, non_installe) —
// fonctions pures : la décision depuis les faits, et la date du dernier changement.
import type { AccesVue, EtatAccesMachine } from '../../commun/api-clients.ts';

export interface FaitsAcces {
  readonly configuree: boolean; // machine SSH configurée (sinon : ce poste même, ou un poste sans tunnel)
  readonly installee: boolean; // poste installé par SSH (son secret existe)
  readonly posteEnLigne: boolean;
  readonly tunnelOuvert: boolean;
  readonly detailTunnel: string | null;
}

export interface EtatCalcule {
  readonly etat: EtatAccesMachine;
  readonly detail: string | null;
}

export function calculerAcces(f: FaitsAcces): EtatCalcule {
  if (!f.configuree) {
    return f.posteEnLigne ? { etat: 'local', detail: null } : { etat: 'injoignable', detail: 'poste hors ligne' };
  }
  if (!f.installee) return { etat: 'non_installe', detail: 'poste non installé' };
  if (f.posteEnLigne) return { etat: 'connecte', detail: null };
  if (f.tunnelOuvert) return { etat: 'connexion', detail: 'tunnel ouvert, poste pas encore connecté' };
  return { etat: 'injoignable', detail: f.detailTunnel ?? 'tunnel fermé' };
}

/** Le `depuis` ne bouge que si l'état ou son détail change : une simple relecture n'annonce rien de nouveau. */
export function avancerAcces(precedent: AccesVue | undefined, calcule: EtatCalcule, maintenant: string): AccesVue {
  if (precedent && precedent.etat === calcule.etat && precedent.detail === calcule.detail) return precedent;
  return { etat: calcule.etat, detail: calcule.detail, depuis: maintenant };
}
