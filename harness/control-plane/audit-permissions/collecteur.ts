/**
 * Responsabilité : collecteur d'audit exhaustif des permissions (branche C.5,
 * mission M-22). Périmètre strict : C.5.1 (ce qui est tracé), C.5.2 (ce que ça
 * permet de répondre), C.1.1 (source d'exhaustivité), C.1.2 (les trois
 * exceptions qui atteignent quand même `canUseTool`), H-40 (l'arbitrage
 * délégué que cette trace valide ou invalide).
 *
 * Ni le canal hors-bande (C.2.3 → M-23) ni la machine à états des demandes
 * escaladées (C.2/C.3 → M-21, déjà livrée) : ce module s'y raccroche via
 * `enregistrerEscaladeHumaine`, il ne la réimplémente pas.
 *
 * ☠ CASSE couvert par un test associé :
 *  - #23 (`canUseTool` utilisé pour l'audit exhaustif ⇒ angle mort sur
 *    l'auto-approuvé) — ce collecteur n'ingère JAMAIS `canUseTool` comme
 *    source d'exhaustivité, seulement `PreToolUse`.
 *
 * `⚠ HYP` structurante, à lire avant de faire confiance à `auteur` :
 * le SDK expose un discriminant structuré (`decision_reason_type`) pour les
 * REFUS (`SDKPermissionDeniedMessage`), mais aucun signal équivalent pour les
 * AUTORISATIONS. Une autorisation sans refus ni escalade est donc classée
 * `classifieur_probable` (inférée depuis le `permissionMode` actif), jamais
 * `classifieur` (réservé aux faits où le SDK l'affirme).
 *
 * **Correctif mesuré en réel le 2026-07-22** (`acceptation/audit-permissions-reel.ts`,
 * `permissionMode: 'auto'`, refus par `disallowedTools`) — le SDK n'affirme en
 * fait NI les autorisations, NI ce type de refus :
 *  - `SDKPermissionDeniedMessage` n'a **jamais** été émis ;
 *  - le hook `PermissionDenied` ne s'est **pas** déclenché non plus ;
 *  - le SEUL signal réel était un bloc `tool_result` (`is_error: true`) dans
 *    un message `user`, apparié par `tool_use_id` à la tentative `PreToolUse`.
 * ⇒ Ne JAMAIS rebrancher l'audit sur le seul message `system` pour ce chemin
 * de refus : `enregistrerRefusToolResult` est désormais la source de premier
 * rang pour les refus par règle scopée / plancher de déni. Le message
 * `system` reste ingéré (il existe dans le type du SDK et peut concerner
 * d'autres chemins — `asyncAgent`, escalade), mais plus comme source unique.
 * `PreToolUse` reste confirmé exhaustif à 100 % sur les tentatives (critère b).
 */

import { auditPermissionsLogger as journal } from './logger.ts';
import {
  HORLOGE_REELLE_AUDIT,
  TRONCATURE_MAX_CARACTERES,
  type AuteurDecision,
  type CouvertureAudit,
  type DemandeRecurrente,
  type EnregistrementAudit,
  type FaitEscaladeHumaine,
  type FaitExecution,
  type FaitRefusHook,
  type FaitRefusMessage,
  type FaitRefusToolResult,
  type FaitTentative,
  type HorlogeAudit,
  type VerdictAudit,
} from './types.ts';

interface EtatInterne {
  outil: string;
  entreeTronquee: string | null;
  sessionId: string | null;
  cwd: string | null;
  agentId: string | null;
  permissionMode: string | null;
  tentativeVueA: number | null;
  verdict: VerdictAudit;
  auteur: AuteurDecision;
  motif: string | null;
  verdictA: number | null;
}

/** Discriminants `decision_reason_type` documentés pour `SDKPermissionDeniedMessage`. */
function auteurDepuisDiscriminant(discriminant: string | undefined): AuteurDecision {
  switch (discriminant) {
    case 'classifier':
      return 'classifieur';
    case 'rule':
      return 'regle_scopee';
    case 'mode':
      return 'mode';
    case 'asyncAgent':
      return 'agent_asynchrone';
    default:
      return 'inconnu';
  }
}

function tronquer(entree: unknown): string | null {
  try {
    const brut = JSON.stringify(entree) ?? String(entree);
    return brut.length > TRONCATURE_MAX_CARACTERES ? `${brut.slice(0, TRONCATURE_MAX_CARACTERES)}…` : brut;
  } catch (erreur) {
    journal.warn({ erreur }, 'entree_non_serialisable');
    return '[entrée non sérialisable]';
  }
}

export class CollecteurAuditPermissions {
  readonly #demandes = new Map<string, EtatInterne>();
  readonly #horloge: HorlogeAudit;

  constructor(horloge: HorlogeAudit = HORLOGE_REELLE_AUDIT) {
    this.#horloge = horloge;
  }

  /**
   * C.1.1 — ancre l'exhaustivité. Créée ou mise à jour idempotemment par
   * `toolUseId` : un fait déjà vu (redélivrance, hook rejoué) ne duplique rien.
   */
  enregistrerTentative(fait: FaitTentative): void {
    const existant = this.#demandes.get(fait.toolUseId);
    if (existant !== undefined) {
      // Une tentative déjà vue peut arriver une deuxième fois (redélivrance) ;
      // ne jamais écraser un verdict déjà connu par un état « indéterminé ».
      return;
    }
    this.#demandes.set(fait.toolUseId, {
      outil: fait.outil,
      entreeTronquee: tronquer(fait.entree),
      sessionId: fait.sessionId,
      cwd: fait.cwd,
      agentId: fait.agentId,
      permissionMode: fait.permissionMode,
      tentativeVueA: this.#horloge.maintenant(),
      verdict: 'indetermine',
      auteur: 'inconnu',
      motif: null,
      verdictA: null,
    });
    this.#log('tentative_vue', fait.toolUseId, { outil: fait.outil });
  }

  /**
   * `PostToolUse` — l'outil a réellement tourné. Faute de signal positif du
   * classifieur (⚠ HYP ci-dessus), l'auteur est une INFÉRENCE : `classifieur`
   * seulement si un refus antérieur sur ce même `toolUseId` l'a déjà confirmé
   * (cas impossible en pratique — un refus empêche l'exécution), sinon
   * `classifieur_probable` quand `permissionMode === 'auto'`, `mode` sinon,
   * `inconnu` si le mode est lui-même absent du fait.
   */
  enregistrerExecution(fait: FaitExecution): void {
    const etat = this.#etatOuCreation(fait.toolUseId, fait.outil);
    if (etat.verdict === 'refuse') {
      // Contradiction : un outil marqué refusé n'aurait pas dû s'exécuter.
      // Ne jamais écraser silencieusement — c'est un défaut à voir, pas à cacher.
      this.#log('contradiction_execution_apres_refus', fait.toolUseId, {});
      return;
    }
    etat.verdict = 'autorise';
    etat.auteur = this.#inferAuteurAutorisation(etat.permissionMode);
    etat.verdictA = this.#horloge.maintenant();
    this.#log('execution_confirmee', fait.toolUseId, { auteur: etat.auteur });
  }

  #inferAuteurAutorisation(permissionMode: string | null): AuteurDecision {
    if (permissionMode === 'auto') return 'classifieur_probable';
    if (permissionMode === null) return 'inconnu';
    return 'mode';
  }

  /**
   * Hook `PermissionDenied` — refus court-circuité, texte libre uniquement.
   * Source secondaire : `enregistrerRefusMessage` (plus riche) prévaut si les
   * deux arrivent pour le même `toolUseId`.
   */
  enregistrerRefusHook(fait: FaitRefusHook): void {
    const etat = this.#etatOuCreation(fait.toolUseId, fait.outil);
    if (etat.auteur !== 'inconnu' && etat.verdict === 'refuse') {
      // Un refus plus riche (message structuré) est déjà en place — ne pas dégrader.
      return;
    }
    etat.verdict = 'refuse';
    etat.auteur = 'inconnu';
    etat.motif = fait.motif;
    etat.verdictA = this.#horloge.maintenant();
    this.#log('refus_hook', fait.toolUseId, { motif: fait.motif });
  }

  /**
   * `SDKPermissionDeniedMessage` — refus avec discriminant structuré
   * (`decision_reason_type`). C'est la source d'AUTEUR la plus fiable de tout
   * ce module : contrairement à une autorisation, un refus est affirmé par le
   * SDK, pas inféré.
   */
  enregistrerRefusMessage(fait: FaitRefusMessage): void {
    const etat = this.#etatOuCreation(fait.toolUseId, fait.outil);
    etat.verdict = 'refuse';
    etat.auteur = auteurDepuisDiscriminant(fait.discriminantAuteur);
    etat.motif = fait.motif ?? etat.motif;
    etat.agentId = etat.agentId ?? fait.agentId;
    etat.verdictA = this.#horloge.maintenant();
    this.#log('refus_message', fait.toolUseId, { auteur: etat.auteur });
    if (etat.auteur === 'inconnu' && fait.discriminantAuteur !== undefined) {
      // Vocabulaire non documenté rencontré — signal fort qu'une hypothèse a bougé.
      this.#log('discriminant_auteur_non_reconnu', fait.toolUseId, {
        discriminant: fait.discriminantAuteur,
      });
    }
  }

  /**
   * Source de premier rang pour les refus par règle scopée / plancher de déni
   * en mode `auto` (mesuré en réel, cf. en-tête de fichier) : bloc `tool_result`
   * `is_error: true` d'un message `user`, seul signal observé sur ce chemin.
   *
   * Ne porte aucun discriminant d'auteur — `auteur` reste `inconnu`, sauf si
   * un signal plus riche (message `system` structuré) est déjà en place, ou
   * arrive ensuite (`enregistrerRefusMessage` peut toujours upgrader après
   * coup). Une exécution déjà confirmée n'est jamais rétrogradée en refus :
   * c'est une contradiction à voir, pas à trancher en silence.
   */
  enregistrerRefusToolResult(fait: FaitRefusToolResult): void {
    const etat = this.#etatOuCreation(fait.toolUseId, fait.outil ?? 'inconnu');
    if (etat.verdict === 'autorise') {
      this.#log('contradiction_refus_apres_execution', fait.toolUseId, {});
      return;
    }
    if (etat.verdict === 'refuse' && etat.auteur !== 'inconnu') {
      // Un signal plus riche (message structuré) est déjà en place — ne pas dégrader.
      return;
    }
    etat.verdict = 'refuse';
    etat.motif = etat.motif ?? fait.texte;
    etat.verdictA = etat.verdictA ?? this.#horloge.maintenant();
    this.#log('refus_tool_result', fait.toolUseId, {});
  }

  /**
   * Verdict humain (bus-permissions, M-21, déjà livré) — mode `default` ou
   * l'une des trois exceptions de C.1.2 sous `auto`. Ce collecteur ne
   * réimplémente pas le cycle de vie de la demande : il consomme le verdict
   * final une fois émis par la machine à états.
   */
  enregistrerEscaladeHumaine(fait: FaitEscaladeHumaine): void {
    const etat = this.#etatOuCreation(fait.toolUseId, fait.outil);
    etat.verdict = fait.autorise ? 'autorise' : 'refuse';
    etat.auteur = 'humain';
    etat.motif = fait.motif ?? etat.motif;
    etat.verdictA = this.#horloge.maintenant();
    this.#log('escalade_humaine_tracee', fait.toolUseId, { autorise: fait.autorise });
  }

  #etatOuCreation(toolUseId: string, outil: string): EtatInterne {
    const existant = this.#demandes.get(toolUseId);
    if (existant !== undefined) return existant;
    // Un verdict peut arriver sans tentative préalable connue (le refus
    // court-circuité n'atteint jamais `PreToolUse`, cf. commentaire de module).
    const cree: EtatInterne = {
      outil,
      entreeTronquee: null,
      sessionId: null,
      cwd: null,
      agentId: null,
      permissionMode: null,
      tentativeVueA: null,
      verdict: 'indetermine',
      auteur: 'inconnu',
      motif: null,
      verdictA: null,
    };
    this.#demandes.set(toolUseId, cree);
    return cree;
  }

  /** Une seule demande, par `toolUseId` — pratique pour les tests et le fil d'une mission (H-64). */
  demandeParId(toolUseId: string): EnregistrementAudit | undefined {
    const etat = this.#demandes.get(toolUseId);
    return etat === undefined ? undefined : this.#vue(toolUseId, etat);
  }

  /** Vue complète, triée par premier horodatage connu — C.5.2 « que s'est-il passé ». */
  registre(): readonly EnregistrementAudit[] {
    return [...this.#demandes.entries()]
      .map(([toolUseId, e]) => this.#vue(toolUseId, e))
      .sort((a, b) => (a.tentativeVueA ?? a.verdictA ?? 0) - (b.tentativeVueA ?? b.verdictA ?? 0));
  }

  /**
   * C.5.2, question centrale de la mission : ce que le classifieur a
   * autorisé. `certaines` isole les cas où le SDK ne laisse aucune place à
   * l'inférence (aucun ici pour l'instant, cf. ⚠ HYP) ; `probables` est la
   * liste à revoir humainement pour répondre à « aurais-je autorisé ça ? ».
   */
  autorisationsClassifieur(): readonly EnregistrementAudit[] {
    return this.registre().filter(
      (e) => e.verdict === 'autorise' && (e.auteur === 'classifieur' || e.auteur === 'classifieur_probable'),
    );
  }

  refusParClassifieur(): readonly EnregistrementAudit[] {
    return this.registre().filter((e) => e.verdict === 'refuse' && e.auteur === 'classifieur');
  }

  /**
   * Tous les refus, quel que soit l'auteur connu. Nécessaire depuis le
   * correctif du 2026-07-22 : la majorité des refus réels (plancher de déni
   * en mode `auto`) n'ont PAS de discriminant d'auteur exploitable
   * (`auteur === 'inconnu'`) — `refusParClassifieur()` seul les manquerait.
   */
  tousLesRefus(): readonly EnregistrementAudit[] {
    return this.registre().filter((e) => e.verdict === 'refuse');
  }

  /** C.5.2 — angle mort : une tentative vue par `PreToolUse` jamais résolue. */
  tentativesNonResolues(seuilMs: number): readonly EnregistrementAudit[] {
    const maintenant = this.#horloge.maintenant();
    return this.registre().filter(
      (e) => e.verdict === 'indetermine' && e.tentativeVueA !== null && maintenant - e.tentativeVueA >= seuilMs,
    );
  }

  couverture(): CouvertureAudit {
    const registre = this.registre();
    return {
      tentativesVues: registre.filter((e) => e.tentativeVueA !== null).length,
      autorisees: registre.filter((e) => e.verdict === 'autorise').length,
      refusees: registre.filter((e) => e.verdict === 'refuse').length,
      nonResolues: registre.filter((e) => e.verdict === 'indetermine').length,
    };
  }

  /** C.5.2 — « quelles demandes reviennent assez souvent pour mériter une règle ? ». */
  demandesRecurrentes(seuilOccurrences: number): readonly DemandeRecurrente[] {
    const parSignature = new Map<string, EnregistrementAudit[]>();
    for (const e of this.registre()) {
      const signature = `${e.outil}::${e.entreeTronquee ?? ''}`;
      const groupe = parSignature.get(signature) ?? [];
      groupe.push(e);
      parSignature.set(signature, groupe);
    }
    const resultat: DemandeRecurrente[] = [];
    for (const [signature, groupe] of parSignature) {
      if (groupe.length < seuilOccurrences) continue;
      const dernier = groupe.at(-1);
      // Non-nul par construction : `groupe.length >= seuilOccurrences` et le
      // seuil n'a de sens qu'à partir de 1 — jamais un tableau vide ici.
      if (dernier === undefined) continue;
      resultat.push({ signature, occurrences: groupe.length, dernierExemple: dernier });
    }
    return resultat;
  }

  #vue(toolUseId: string, e: EtatInterne): EnregistrementAudit {
    return {
      toolUseId,
      outil: e.outil,
      entreeTronquee: e.entreeTronquee,
      sessionId: e.sessionId,
      cwd: e.cwd,
      agentId: e.agentId,
      permissionMode: e.permissionMode,
      tentativeVueA: e.tentativeVueA,
      verdict: e.verdict,
      auteur: e.auteur,
      motif: e.motif,
      verdictA: e.verdictA,
    };
  }

  #log(evenement: string, toolUseId: string, details: Record<string, unknown>): void {
    journal.debug({ evenement, toolUseId, ...details }, evenement);
  }
}
