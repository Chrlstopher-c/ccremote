/**
 * Responsabilité : passe de consolidation périodique (C-4, SPEC §5, PLAN-PORTAGE.md E10) —
 * transitions d'état par horloge (sans modèle) puis retrait des doublons actifs d'un même
 * projet. Sauvegarde AVANT toute mutation (`sauvegarde.ts` `☠`), rapport Markdown daté après.
 *
 * `☠` Portes : ≥ 7 jours depuis la dernière passe (`horloge-consolidation.ts`), AUCUNE mission
 * active sur la machine — un booléen **injecté par l'appelant**, jamais estimé ni mesuré ici :
 * ce domaine n'importe jamais `control-plane/registre/` (frontière A↔B stricte, `harness/
 * ARCHITECTURE.md`), donc le seul fait qui compte vient du registre, lu par le composant qui
 * appelle cette fonction. Première observation ⇒ on sème l'horodatage et on diffère d'un
 * intervalle complet (SPEC §5, C-4).
 *
 * `☠` Jamais de suppression : `obsolete` est un état comme les autres, la ligne/le fichier
 * restent (SPEC §5, C-4 `☠`, réduction de H-9).
 *
 * `☠` ÉCART DOCUMENTÉ À LA SPEC : SPEC §5 (C-4) décrit une fusion « par le modèle local ».
 * Cette implémentation retire les doublons par similarité LEXICALE seule (même mécanisme
 * déjà éprouvé par `rapprochement.ts`/C-5, seuil FORT = quasi-identique) — aucun appel
 * réseau dans cette passe. Choix assumé pour cette étape (budget, déterminisme, tests sans
 * dépendance réseau) ; brancher un appel modèle pour les cas ambigus (zone grise, comme C-5)
 * reste un axe d'amélioration explicite, pas un correctif à ce fichier lui-même.
 *
 * Conception inspirée de Hermes Agent (Nous Research) — MIT. Transposition indépendante en TypeScript.
 */

import type { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { obtenirDernierePasseA, enregistrerDernierePasseA } from '../base/horloge-consolidation.ts';
import { listerToutesLecons, transitionnerEtatLecon } from '../base/lecons.ts';
import { changerEtatCompetence, listerCompetences } from '../competences/depot-competences.ts';
import { negationDivergente, SEUIL_SIMILARITE_FORTE, similarite } from '../extraction/similarite-lexicale.ts';
import { journal } from '../logger.ts';
import type { Competence, Lecon } from '../types.ts';
import { cheminApprentissageParDefaut, sauvegarderAvantPasse, type ResultatSauvegarde } from './sauvegarde.ts';

/** SPEC §5, C-4 : intervalle minimum entre deux passes. */
export const INTERVALLE_MIN_MS = 7 * 24 * 60 * 60 * 1000;
/** SPEC §5, C-4 : mise en dormance après ce délai sans confirmation. */
export const DELAI_DORMANCE_MS = 60 * 24 * 60 * 60 * 1000;
/** Même seuil que `confirmerLecon` (base/lecons.ts) — rattrapage idempotent, pas une nouvelle règle. */
const SEUIL_CONFIRMATIONS_PROMOTION = 2;

export interface EntreeConsolidation {
  readonly db: Database;
  readonly cheminDb: string;
  readonly racineCompetences: string;
  /** `☠` Calculé par l'appelant depuis le registre — jamais une estimation de durée (E10 `☠`). */
  readonly aucuneMissionActive: boolean;
  readonly racineSauvegardes?: string;
  readonly racineRapports?: string;
  readonly maintenant?: number;
}

export interface TransitionsAppliquees {
  readonly promues: number;
  readonly misesEnDormance: number;
  readonly reveillees: number;
  readonly perimees: number;
  readonly leconsFusionnees: number;
  readonly competencesFusionnees: number;
}

export interface ResultatConsolidation {
  readonly executee: boolean;
  readonly motif: string;
  readonly transitions: TransitionsAppliquees | null;
  readonly rapportChemin: string | null;
}

function verifierPortes(
  db: Database,
  aucuneMissionActive: boolean,
  maintenant: number,
): { readonly ouverte: true } | { readonly ouverte: false; readonly motif: string } {
  if (!aucuneMissionActive) {
    return { ouverte: false, motif: 'une mission est active sur la machine (registre) — passe différée' };
  }
  const derniere = obtenirDernierePasseA(db);
  if (derniere === null) {
    enregistrerDernierePasseA(db, maintenant);
    return { ouverte: false, motif: 'première observation — horodatage semé, passe différée d’un intervalle complet' };
  }
  if (maintenant - derniere < INTERVALLE_MIN_MS) {
    const joursRestants = Math.ceil((INTERVALLE_MIN_MS - (maintenant - derniere)) / (24 * 60 * 60 * 1000));
    return { ouverte: false, motif: `moins de 7 jours depuis la dernière passe (encore ${joursRestants} j)` };
  }
  return { ouverte: true };
}

/**
 * Quatre transitions par horloge, sans modèle (SPEC §5, C-4) :
 * `candidate → active` (rattrapage, même seuil que C-5 en temps réel) ·
 * `active → dormante` (60 j sans confirmation) ·
 * `dormante → active` (une confirmation plus récente que le délai de dormance) ·
 * `candidate → obsolete` (contradictions ≥ confirmations — voir note ci-dessous).
 *
 * `☠` ÉCART DOCUMENTÉ : SPEC §5 nomme la 4ᵉ transition `active → obsolete`. En pratique,
 * `contredireLecon` (base/lecons.ts, C-5, déjà livré) rétrograde IMMÉDIATEMENT `active` en
 * `candidate` dès la première contradiction — aucune leçon `active` contredite n'existe donc
 * au moment où cette passe tourne. Cette fonction traite la question réellement observable :
 * une leçon `candidate` dont les contradictions ont rattrapé ou dépassé les confirmations est
 * périmée, plutôt que de rester en limbe indéfiniment.
 */
function appliquerTransitionsHorloge(db: Database, maintenant: number): Omit<TransitionsAppliquees, 'leconsFusionnees' | 'competencesFusionnees'> {
  let promues = 0;
  let misesEnDormance = 0;
  let reveillees = 0;
  let perimees = 0;

  for (const l of listerToutesLecons(db)) {
    if (l.etat === 'candidate' && l.confirmations >= SEUIL_CONFIRMATIONS_PROMOTION && l.contradictions < l.confirmations) {
      transitionnerEtatLecon(db, l.id, 'active');
      promues += 1;
    } else if (l.etat === 'active' && maintenant - l.derniereConfirmationA >= DELAI_DORMANCE_MS) {
      transitionnerEtatLecon(db, l.id, 'dormante');
      misesEnDormance += 1;
    } else if (l.etat === 'dormante' && maintenant - l.derniereConfirmationA < DELAI_DORMANCE_MS) {
      transitionnerEtatLecon(db, l.id, 'active');
      reveillees += 1;
    } else if (l.etat === 'candidate' && l.contradictions >= 1 && l.contradictions >= l.confirmations) {
      transitionnerEtatLecon(db, l.id, 'obsolete');
      perimees += 1;
    }
  }
  return { promues, misesEnDormance, reveillees, perimees };
}

interface PaireConvergente<T> {
  readonly a: T;
  readonly b: T;
}

/** Paires dont le texte dépasse le seuil FORT — quasi-identiques, comme un match net de C-5. */
function pairesConvergentes<T>(items: readonly T[], texte: (item: T) => string): readonly PaireConvergente<T>[] {
  const paires: PaireConvergente<T>[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (similarite(texte(items[i]!), texte(items[j]!)) >= SEUIL_SIMILARITE_FORTE) {
        paires.push({ a: items[i]!, b: items[j]! });
      }
    }
  }
  return paires;
}

function grouperPar<T>(items: readonly T[], cle: (item: T) => string): ReadonlyMap<string, T[]> {
  const groupes = new Map<string, T[]>();
  for (const item of items) {
    const groupe = groupes.get(cle(item)) ?? [];
    groupe.push(item);
    groupes.set(cle(item), groupe);
  }
  return groupes;
}

/** Retire les leçons `active` redondantes d'un même projet+catégorie — la moins confirmée périme. */
function fusionnerLeconsRedondantes(db: Database): number {
  const groupes = grouperPar(listerToutesLecons(db, 'active'), (l: Lecon) => `${l.projet}::${l.categorie}`);
  let fusionnees = 0;
  const traitees = new Set<string>();
  for (const groupe of groupes.values()) {
    for (const paire of pairesConvergentes(groupe, (l) => l.enonce)) {
      if (traitees.has(paire.a.id) || traitees.has(paire.b.id)) continue;
      if (negationDivergente(paire.a.enonce, paire.b.enonce)) continue; // contraires : pas des doublons
      const retiree = paire.a.confirmations <= paire.b.confirmations ? paire.a : paire.b;
      transitionnerEtatLecon(db, retiree.id, 'obsolete');
      traitees.add(retiree.id);
      fusionnees += 1;
    }
  }
  return fusionnees;
}

/** Même principe pour les compétences `active` d'un même projet, comparées par description. */
function fusionnerCompetencesRedondantes(racine: string, dateIso: string): number {
  const actives = listerCompetences(racine).filter((c) => c.etat === 'active');
  const groupes = grouperPar(actives, (c: Competence) => c.projet ?? '*');
  let fusionnees = 0;
  const traitees = new Set<string>();
  for (const groupe of groupes.values()) {
    for (const paire of pairesConvergentes(groupe, (c) => c.description)) {
      if (traitees.has(paire.a.slug) || traitees.has(paire.b.slug)) continue;
      const retiree = paire.a.confirmations <= paire.b.confirmations ? paire.a : paire.b;
      changerEtatCompetence(racine, retiree.slug, 'obsolete', dateIso);
      traitees.add(retiree.slug);
      fusionnees += 1;
    }
  }
  return fusionnees;
}

function construireRapport(iso: string, sauvegarde: ResultatSauvegarde, transitions: TransitionsAppliquees): string {
  return [
    `# Passe de consolidation — ${iso}`,
    '',
    '## Sauvegarde (prise avant toute mutation)',
    `· dossier : ${sauvegarde.dossier}`,
    `· base copiée : ${sauvegarde.aCopieDb ? 'oui' : 'non (absente)'}`,
    `· compétences copiées : ${sauvegarde.aCopieCompetences ? 'oui' : 'non (absentes)'}`,
    '',
    '## Transitions par horloge (C-4, sans modèle)',
    `· candidate → active (rattrapage) : ${transitions.promues}`,
    `· active → dormante (60 j sans confirmation) : ${transitions.misesEnDormance}`,
    `· dormante → active (nouvelle confirmation) : ${transitions.reveillees}`,
    `· candidate → obsolete (contradictions ≥ confirmations) : ${transitions.perimees}`,
    '',
    '## Retrait des doublons actifs (similarité lexicale forte)',
    `· leçons retirées (état obsolete, jamais supprimées) : ${transitions.leconsFusionnees}`,
    `· compétences retirées (état obsolete, jamais supprimées) : ${transitions.competencesFusionnees}`,
    '',
  ].join('\n');
}

function ecrireRapport(racineRapports: string, iso: string, contenu: string): string {
  mkdirSync(racineRapports, { recursive: true });
  const chemin = join(racineRapports, `${iso}.md`);
  writeFileSync(chemin, contenu, 'utf8');
  return chemin;
}

/**
 * Exécute la passe de consolidation si les portes sont ouvertes. Ne lève JAMAIS : toute
 * panne (disque, base verrouillée) rend `{ executee: false, motif }`, jamais une exception —
 * même contrat que le reste du domaine (SPEC §1).
 */
export function executerConsolidation(entree: EntreeConsolidation): ResultatConsolidation {
  const maintenant = entree.maintenant ?? Date.now();
  try {
    const porte = verifierPortes(entree.db, entree.aucuneMissionActive, maintenant);
    if (!porte.ouverte) return { executee: false, motif: porte.motif, transitions: null, rapportChemin: null };

    // `☠` Sauvegarde AVANT toute passe mutante (SPEC §5, C-4 `☠` ; PLAN-PORTAGE.md E10 `☠`).
    const sauvegarde = sauvegarderAvantPasse({
      cheminDb: entree.cheminDb,
      racineCompetences: entree.racineCompetences,
      racineSauvegardes: entree.racineSauvegardes,
      maintenant: new Date(maintenant),
    });

    const partielles = appliquerTransitionsHorloge(entree.db, maintenant);
    const leconsFusionnees = fusionnerLeconsRedondantes(entree.db);
    const dateIso = new Date(maintenant).toISOString().slice(0, 10);
    const competencesFusionnees = fusionnerCompetencesRedondantes(entree.racineCompetences, dateIso);
    const transitions: TransitionsAppliquees = { ...partielles, leconsFusionnees, competencesFusionnees };

    const racineRapports = entree.racineRapports ?? join(cheminApprentissageParDefaut(), 'rapports');
    const isoDossier = new Date(maintenant).toISOString().replace(/[:.]/g, '-');
    const rapportChemin = ecrireRapport(racineRapports, isoDossier, construireRapport(isoDossier, sauvegarde, transitions));

    enregistrerDernierePasseA(entree.db, maintenant);
    journal.info({ transitions, rapportChemin }, 'passe de consolidation exécutée (C-4)');
    return { executee: true, motif: 'passe exécutée', transitions, rapportChemin };
  } catch (cause) {
    journal.error({ err: cause }, 'passe de consolidation en échec — non bloquant');
    return { executee: false, motif: cause instanceof Error ? cause.message : String(cause), transitions: null, rapportChemin: null };
  }
}
