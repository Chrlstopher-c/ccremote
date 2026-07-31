/**
 * Responsabilité : formes de données du serveur MCP de contrôle (branche A.2,
 * mission M-40). Aucune I/O ici.
 *
 * Deux familles de types :
 *  - le contrat de retour uniforme (A.2.3), imposé à tout outil ;
 *  - les ports vers les branches déléguées (E, F, C) dont les outils ont besoin.
 *
 * ☠ Aucun port ci-dessous n'implémente une action réelle sur un worker (B). La
 * frontière A↔B est délibérément inexistante (03-couche-1.md, table des six
 * frontières) : tout passe par ces ports. Leur implémentation réelle appartient
 * aux branches B/D, hors périmètre de la mission A.2 — même motif que
 * `control-plane/reconciliation/types.ts` (`InventairePc`, `ReinitialisateurSession`).
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { FileEntreeCiblee, SourceInterruption } from '../../../pause/index.ts';
import type { ConfigPlafondParc, RelevePourPlafond } from '../../../budgets/index.ts';
import type { AccesMandat } from '../../../shared/acces-mandat.ts';

/**
 * `'accepte'` ≠ `'applique'` (A.2.3) : le premier dit « pris en compte, pas
 * terminé », le second dit « fait ». C'est cette distinction qui empêche
 * l'orchestrateur de croire qu'un travail long est fini.
 *
 * `'differe'` existe dès cette version, mais aucun outil ne l'émet encore pour
 * une action réellement dispatchée (H-61 : la création d'équipe attend une
 * autorisation humaine explicite, non implémentée ici — voir `outils-cycle-vie.ts`).
 * La valeur est prête à être réutilisée sans refonte du contrat le jour où
 * l'autorisation humaine est câblée.
 */
export type EffetOutil = 'applique' | 'accepte' | 'refuse' | 'differe';

/** Contrat de retour uniforme (A.2.3). Tout outil le retourne, jamais une exception (A.2.4). */
export interface ContratRetour {
  readonly ok: boolean;
  readonly intention: string;
  readonly effet: EffetOutil;
  /** Id de suivi pour un effet asynchrone (`accepte`) ou une proposition (`differe`). */
  readonly ref?: string;
  /** État APRÈS l'opération, résumé court — évite un aller-retour de lecture. */
  readonly etat?: string;
  /** Obligatoire quand `effet === 'refuse'`. */
  readonly raison?: string;
}

// ---------------------------------------------------------------------------
// Ports — ce que ce module attend d'une équipe vivante (B/D, hors périmètre)
// ---------------------------------------------------------------------------

/**
 * Ce qu'un outil mutatif peut atteindre sur une équipe vivante. Réutilise les
 * formes déjà publiques de `pause/` (mêmes signatures que `FileEntreeCiblee` et
 * `SourceInterruption`) plutôt que d'en dupliquer une troisième version —
 * l'implémentation réelle appartient à B, mais la FORME est déjà stable.
 */
export interface CibleEquipe extends FileEntreeCiblee, SourceInterruption {}

/** Résout la cible d'une mission active. `null` = mission inconnue ou plus vivante. */
export interface RepertoireCibles {
  cible(missionId: string): CibleEquipe | null;
}

/** Port de fin de vie (F puis B, A.2.2) — libère le worktree, termine le worker. */
export interface ArreteurMission {
  arreter(missionId: string): Promise<void>;
}

/** Port de relance après crash (B, `resume`, A.2.2). */
export interface RelanceurMission {
  relancer(missionId: string, sessionId: string): Promise<void>;
}

/** Port de garde-fou (G) — plafond par mission, filet de dernier recours (H-68). */
export interface DefinisseurBudget {
  definir(missionId: string, maxUsd: number): Promise<void>;
}

/**
 * Port de garde-fou (G.1.3) — lecture d'utilisation pour le plafond de parc
 * (`deciderCreationMission`, `budgets/plafond-parc.ts`). Délibérément
 * SYNCHRONE : la donnée vient d'un relevé de quota déjà en registre (lecture
 * locale, jamais un appel réseau depuis `proposerCreationEquipe` — acceptation
 * (a)/(d)). Une implémentation qui introduirait de l'I/O réelle derrière ce
 * port violerait son contrat ; elle doit alors passer par `avecPlafond` comme
 * les autres ports asynchrones de ce fichier.
 */
export interface LecteurUtilisationParc {
  /** Comptes actifs connus au moment de l'appel — pas un snapshot mis en cache. */
  comptesConnus(): readonly string[];
  /** Relevés de quota (toutes fenêtres connues) pour un compte donné. `[]` si inconnu. */
  releves(compteId: string): readonly RelevePourPlafond[];
}

export type { ConfigPlafondParc, SDKUserMessage };

/**
 * Persiste un mandat proposé pour qu'il soit soumis à l'opérateur (H-61) et
 * rend sa référence. Implémenté par la composition, qui capture la conversation
 * d'où vient la demande — c'est ce qui permet d'afficher la carte au bon endroit
 * dans le fil plutôt que dans une liste hors contexte.
 */
export interface EnregistreurProposition {
  enregistrer(mandat: {
    readonly projet: string;
    readonly objectif: string;
    readonly critereArret: string | null;
    readonly perimetre: string;
    /** Droit réel de l'équipe. Absent ⇒ défaut sûr (`lecture`), jamais l'écriture. */
    readonly acces?: AccesMandat;
    readonly modele?: string | null;
    readonly effort?: string | null;
  }): ResultatEnregistrement;
}

/**
 * Ce que devient un mandat déposé.
 *
 * `☠` `autoApprouve` remonte jusqu'au modèle, et ce n'est pas cosmétique :
 * l'orchestrateur doit dire à Chris ce qui s'est RÉELLEMENT passé. Annoncer
 * « en attente de ton autorisation » alors que l'équipe travaille déjà, ou
 * l'inverse, est la forme la plus coûteuse d'écran qui ment — celle où
 * l'opérateur attend devant un bouton qui ne viendra pas.
 */
export interface ResultatEnregistrement {
  readonly ref: string;
  readonly autoApprouve: boolean;
  /** Phrase à reprendre telle quelle : dit pourquoi ça part ou pourquoi ça attend. */
  readonly detail: string;
}

/**
 * Lit le CONTENU d'un fichier de projet, qui vit sur le PC (H-75).
 *
 * `☠` Complément indispensable d'`ExplorateurProjets` : l'arborescence seule
 * laissait l'orchestrateur synthétiser « d'après le code » sans avoir jamais lu
 * une ligne. Lecture seule et bornée à la racine — la garde vit côté PC
 * (`superviseur/lecture-fichier.ts`), jamais dans l'appelant.
 */
/**
 * Cherche un motif dans le CONTENU des projets, qui vivent sur le PC (H-75).
 *
 * `☠` Complément d'`ExplorateurProjets` et de `LecteurFichierProjet` : lister
 * puis lire ne permet de trouver que ce qu'on sait déjà nommer. Sur un dépôt
 * inconnu, cadrer un mandat sans chercher revient à ouvrir les fichiers un par
 * un — et à saturer son contexte avant d'avoir trouvé quoi que ce soit.
 */
export interface ChercheurProjets {
  rechercherProjets(motif: string, chemin?: string, max?: number): Promise<ResultatRechercheProjets>;
}

export interface OccurrenceProjet {
  readonly fichier: string;
  readonly ligne: number;
  readonly texte: string;
}

export interface ResultatRechercheProjets {
  readonly motif: string;
  readonly chemin: string;
  readonly occurrences: readonly OccurrenceProjet[];
  readonly note?: string;
}

export interface LecteurFichierProjet {
  lireFichier(chemin: string): Promise<{
    readonly ok: boolean;
    readonly racine: string;
    readonly chemin: string;
    readonly contenu: string;
    readonly octets: number;
    readonly tronque: boolean;
    readonly note?: string;
  }>;
}

/** Parcourt l'arborescence des projets, qui vit sur le PC (H-75). */
export interface ExplorateurProjets {
  explorerProjets(chemin?: string): Promise<{
    readonly racine: string;
    readonly chemin: string;
    readonly entrees: readonly { readonly nom: string; readonly type: string; readonly chemin: string; readonly depotGit?: boolean }[];
    readonly note?: string;
  }>;
}
