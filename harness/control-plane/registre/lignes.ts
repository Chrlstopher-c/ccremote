/**
 * Responsabilité : formes brutes des lignes SQLite et conversion vers le domaine.
 * SQLite ne connaît ni booléen ni camelCase — la traduction est isolée ici.
 */

import type {
  Capacite,
  Compte,
  EtatHarness,
  EtatSdk,
  Lot,
  Mission,
  OrigineTransition,
  PosteContexteMission,
  Quota,
  StatutQuota,
  Transition,
} from './types.ts';

/**
 * `☠` La ventilation est stockée en JSON. Un contenu illisible (colonne écrite
 * par une version antérieure, écriture tronquée) ne doit JAMAIS faire échouer la
 * lecture d'une mission : on rend `null`, l'interface affiche la jauge sans
 * détail. Perdre le pilotage d'une mission pour un chiffre d'affichage serait un
 * très mauvais échange.
 */
function lireVentilation(brut: string | null): readonly PosteContexteMission[] | null {
  if (brut === null || brut.length === 0) return null;
  try {
    const analyse: unknown = JSON.parse(brut);
    if (!Array.isArray(analyse)) return null;
    return analyse
      .filter((p): p is { nom: string; tokens: number; differe?: boolean } =>
        typeof p === 'object' && p !== null &&
        typeof (p as { nom?: unknown }).nom === 'string' &&
        typeof (p as { tokens?: unknown }).tokens === 'number')
      .map((p) => ({ nom: p.nom, tokens: p.tokens, differe: p.differe === true }));
  } catch {
    return null;
  }
}

export interface LigneLot {
  id: string;
  intention: string;
  origine: string | null;
  cree_a: number;
  clos_a: number | null;
}

export interface LigneCompte {
  id: string;
  config_dir: string;
  email: string | null;
  organisation: string | null;
  type_abonnement: string | null;
  fournisseur_api: string | null;
  actif: number;
  cree_a: number;
  maj_a: number;
}

export interface LigneQuota {
  compte_id: string;
  type_fenetre: string;
  statut: string;
  reset_a: number | null;
  utilisation: number | null;
  statut_overage: string | null;
  utilise_overage: number | null;
  seuil_depasse: string | null;
  observe_a: number;
}

export interface LigneMission {
  id: string;
  lot_id: string;
  nom: string;
  projet: string;
  worktree: string | null;
  branche: string | null;
  session_id: string | null;
  compte_id: string;
  mandat: string | null;
  critere_arret: string | null;
  modele_demande: string | null;
  modele_resolu: string | null;
  etat_sdk: string | null;
  etat_sdk_maj_a: number | null;
  etat_harness: string;
  etat_harness_maj_a: number;
  epoch: number;
  high_water_mark: number;
  budget_max_usd: number | null;
  budget_consomme_usd: number;
  contexte_tokens_utilises: number | null;
  contexte_tokens_max: number | null;
  contexte_ventilation: string | null;
  compteur_relances: number;
  derniere_raison_terminale: string | null;
  conversation_id: string | null;
  cree_a: number;
  demarree_a: number | null;
  terminee_a: number | null;
}

export interface LigneTransition {
  id: number;
  mission_id: string;
  origine: string;
  etat_precedent: string | null;
  etat_nouveau: string;
  motif: string | null;
  survenu_a: number;
}

export interface LigneCapacite {
  mission_id: string;
  capacite: string;
  presente: number;
  observe_a: number;
}

export function versLot(l: LigneLot): Lot {
  return {
    id: l.id,
    intention: l.intention,
    origine: l.origine,
    creeA: l.cree_a,
    closA: l.clos_a,
  };
}

export function versCompte(l: LigneCompte): Compte {
  return {
    id: l.id,
    configDir: l.config_dir,
    email: l.email,
    organisation: l.organisation,
    typeAbonnement: l.type_abonnement,
    fournisseurApi: l.fournisseur_api,
    actif: l.actif === 1,
    creeA: l.cree_a,
    majA: l.maj_a,
  };
}

export function versQuota(l: LigneQuota): Quota {
  return {
    compteId: l.compte_id,
    typeFenetre: l.type_fenetre,
    // as : la colonne porte un CHECK IN ('allowed','allowed_warning','rejected'),
    // aucune autre valeur ne peut exister en base.
    statut: l.statut as StatutQuota,
    resetA: l.reset_a,
    utilisation: l.utilisation,
    statutOverage: l.statut_overage,
    utiliseOverage: l.utilise_overage === null ? null : l.utilise_overage === 1,
    seuilDepasse: l.seuil_depasse,
    observeA: l.observe_a,
  };
}

export function versMission(l: LigneMission): Mission {
  return {
    id: l.id,
    lotId: l.lot_id,
    nom: l.nom,
    projet: l.projet,
    worktree: l.worktree,
    branche: l.branche,
    sessionId: l.session_id,
    compteId: l.compte_id,
    mandat: l.mandat,
    critereArret: l.critere_arret,
    modeleDemande: l.modele_demande,
    modeleResolu: l.modele_resolu,
    // as : colonnes protégées par des CHECK disjoints (voir migration 1) — un état
    // harness ne peut pas atterrir dans etat_sdk et réciproquement (panne #30).
    etatSdk: l.etat_sdk === null ? null : (l.etat_sdk as EtatSdk),
    etatSdkMajA: l.etat_sdk_maj_a,
    etatHarness: l.etat_harness as EtatHarness,
    etatHarnessMajA: l.etat_harness_maj_a,
    epoch: l.epoch,
    highWaterMark: l.high_water_mark,
    budgetMaxUsd: l.budget_max_usd,
    budgetConsommeUsd: l.budget_consomme_usd,
    contexteTokensUtilises: l.contexte_tokens_utilises,
    contexteTokensMax: l.contexte_tokens_max,
    contexteVentilation: lireVentilation(l.contexte_ventilation),
    compteurRelances: l.compteur_relances,
    derniereRaisonTerminale: l.derniere_raison_terminale,
    conversationId: l.conversation_id,
    creeA: l.cree_a,
    demarreeA: l.demarree_a,
    termineeA: l.terminee_a,
  };
}

export function versTransition(l: LigneTransition): Transition {
  return {
    id: l.id,
    missionId: l.mission_id,
    // as : colonne sous CHECK IN ('sdk','harness').
    origine: l.origine as OrigineTransition,
    etatPrecedent: l.etat_precedent,
    etatNouveau: l.etat_nouveau,
    motif: l.motif,
    survenuA: l.survenu_a,
  };
}

export function versCapacite(l: LigneCapacite): Capacite {
  return {
    missionId: l.mission_id,
    capacite: l.capacite,
    presente: l.presente === 1,
    observeA: l.observe_a,
  };
}
