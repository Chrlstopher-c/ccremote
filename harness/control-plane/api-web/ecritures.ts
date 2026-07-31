/**
 * Responsabilité : les ordres que l'opérateur envoie depuis son téléphone.
 * Lecture et écriture sont séparées ici parce qu'elles n'ont pas la même
 * conséquence : une lecture fausse affiche une bêtise, une écriture fausse
 * arrête une mission.
 *
 * `☠` N'expose QUE ce qui existe réellement de bout en bout. Une route
 * d'écriture à moitié câblée est **pire qu'absente** : l'opérateur y croit et
 * n'insiste pas. D'où le 501 explicite dès qu'un port manque, jamais un 200
 * poli.
 */

import { ErreurApi, requeteInvalide } from './enveloppe.ts';

/** Ce que le PC sait faire, vu du control plane. Sous-ensemble volontaire. */
export interface OrdresVersPc {
  /** `arreter_worker` du canal de contrôle (D.3). */
  arreter(missionId: string): Promise<void>;
  /**
   * A.2.2 — pilotage d'une mission vivante. `☠` Une instruction envoyée à une
   * mission EN PAUSE est retenue et transmise à la reprise ; le `detail` rendu
   * le dit, et l'interface doit le montrer — sinon l'opérateur attend une
   * réaction qui ne viendra qu'après la reprise.
   */
  envoyerInstruction?(missionId: string, texte: string): Promise<{ readonly detail: string }>;
  mettreEnPause?(missionId: string): Promise<void>;
  reprendre?(missionId: string): Promise<void>;
  /** Arrêt d'urgence G.4 — ne traverse JAMAIS l'orchestrateur. */
  arretUrgence?(graceMs?: number): Promise<unknown>;
}

/** Conversation avec la session orchestrateur maître (peut être absente : opt-in). */
export interface OrchestrateurConversation {
  envoyer(texte: string): Promise<string>;
}

export interface DependancesEcritures {
  readonly pc: OrdresVersPc;
  readonly orchestrateur?: OrchestrateurConversation;
}

export interface ResultatEcriture {
  readonly ok: true;
  readonly effet: string;
  /** Renseigné pour un aller-retour de conversation orchestrateur. */
  readonly reply?: string;
}

/**
 * Traite un ordre. Retourne `null` si le chemin n'est pas une écriture connue,
 * pour que l'appelant continue son routage.
 */
export async function traiterEcriture(
  chemin: string,
  corps: Record<string, unknown>,
  deps: DependancesEcritures,
): Promise<ResultatEcriture | null> {
  const terminer = chemin.match(/^\/missions\/([^/]+)\/terminate$/);
  if (terminer?.[1] !== undefined) {
    await deps.pc.arreter(decodeURIComponent(terminer[1]));
    return { ok: true, effet: 'arrêt de la mission demandé au PC' };
  }

  const instruction = chemin.match(/^\/missions\/([^/]+)\/instruction$/);
  if (instruction?.[1] !== undefined) {
    if (deps.pc.envoyerInstruction === undefined) throw new ErreurApi(501, 'pilotage non câblé sur ce déploiement');
    const texte = corps['text'];
    if (typeof texte !== 'string' || texte.trim().length === 0) throw requeteInvalide('texte d’instruction vide');
    const { detail } = await deps.pc.envoyerInstruction(decodeURIComponent(instruction[1]), texte);
    return { ok: true, effet: detail };
  }

  const pause = chemin.match(/^\/missions\/([^/]+)\/(pause|resume)$/);
  if (pause?.[1] !== undefined && pause[2] !== undefined) {
    const missionId = decodeURIComponent(pause[1]);
    if (pause[2] === 'pause') {
      if (deps.pc.mettreEnPause === undefined) throw new ErreurApi(501, 'pilotage non câblé sur ce déploiement');
      await deps.pc.mettreEnPause(missionId);
      return { ok: true, effet: 'mission mise en pause — session retenue, contexte préservé' };
    }
    if (deps.pc.reprendre === undefined) throw new ErreurApi(501, 'pilotage non câblé sur ce déploiement');
    await deps.pc.reprendre(missionId);
    return { ok: true, effet: 'mission reprise — messages retenus transmis' };
  }

  if (chemin === '/orchestrator/message') {
    // `☠` L'orchestrateur est opt-in : sans session maître sur le Pi, on répond
    // 501 explicite, jamais une réponse fabriquée. L'ancienne UI simulait ici
    // une réponse codée en dur — c'est précisément ce qu'on remplace.
    if (deps.orchestrateur === undefined) {
      throw new ErreurApi(501, 'session orchestrateur non active sur ce déploiement (CCREMOTE_PI_ORCHESTRATEUR=1)');
    }
    const texte = corps['text'];
    if (typeof texte !== 'string' || texte.trim().length === 0) throw requeteInvalide('message vide');
    const reply = await deps.orchestrateur.envoyer(texte);
    return { ok: true, effet: 'répondu', reply };
  }

  if (chemin === '/safety/emergency-stop') {
    if (deps.pc.arretUrgence === undefined) {
      throw new ErreurApi(501, "arrêt d'urgence non câblé sur ce déploiement");
    }
    await deps.pc.arretUrgence();
    return { ok: true, effet: "arrêt d'urgence diffusé (G.4)" };
  }

  return null;
}
