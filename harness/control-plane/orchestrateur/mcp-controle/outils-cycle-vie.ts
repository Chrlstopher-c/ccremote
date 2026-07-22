/**
 * Responsabilité : groupe « cycle de vie » de la surface d'outils (A.2.2) — mutatif.
 * Chaque fonction délègue à un port (B/D, hors périmètre de la mission A.2) et ne
 * s'expose jamais à une attente indéfinie : tout appel de port passe par
 * `avecPlafond` (acceptation (a), garantie mécanique, pas de discipline d'écriture).
 *
 * ☠ (d) Aucune fonction ici ne laisse une exception s'échapper.
 */

import { randomUUID } from 'node:crypto';
import type { Registre } from '../../registre/index.ts';
import { construireMessageUtilisateur } from '../entree/index.ts';
import { accepte, applique, echecInattendu, refuse } from './contrat.ts';
import { construireMandatPropose } from './mandat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import { avecPlafond } from './plafond.ts';
import type { ArreteurMission, ContratRetour, RelanceurMission, RepertoireCibles } from './types.ts';

const RAISON_DELAI = "aucune confirmation du port dans le délai — le lien avec l'équipe est peut-être coupé";

/**
 * `creer_equipe` (A.2.2, H-61 — TRANCHÉ, FAIT AUTORITÉ). Ne crée RIEN et ne
 * dispatche RIEN : retourne une proposition de mandat que l'UI présente à
 * l'approbation humaine explicite. La création effective part du clic de
 * l'opérateur, pas du tour de l'orchestrateur — voir `mandat.ts`.
 */
export function proposerCreationEquipe(
  projet: string,
  objectif: string,
  critereArret: string | null,
  perimetre: string,
): ContratRetour {
  const intention = `proposer une équipe sur ${projet}`;
  try {
    const proposition = construireMandatPropose(projet, objectif, critereArret, perimetre);
    return {
      ok: true,
      intention,
      effet: 'differe',
      ref: randomUUID(),
      etat: JSON.stringify(proposition),
    };
  } catch (erreur) {
    journal.error({ err: erreur, projet }, 'proposerCreationEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `envoyer_a_equipe` (A.2.2) — met en file, n'interrompt jamais (H-67). Émetteur
 * toujours `orchestrateur` (H-66) : ce chemin est le dispatch normal, jamais une
 * intervention directe de l'opérateur (celle-là passe par l'UI, hors ce module).
 */
export async function envoyerAEquipe(
  repertoire: RepertoireCibles,
  missionId: string,
  texte: string,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `envoyer un message à ${missionId}`;
  try {
    const cible = repertoire.cible(missionId);
    if (cible === null) return refuse(intention, 'équipe introuvable ou plus vivante');
    const message = construireMessageUtilisateur(`[émetteur:orchestrateur]\n${texte}`, { sessionId: missionId });
    const resultat = await avecPlafond(cible.envoyerMessage(message), plafondMs);
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    return accepte(intention, missionId, 'message mis en file, lu au prochain tour disponible');
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'envoyerAEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `interrompre_equipe` (A.2.2) — stoppe le tour en cours. `interrupt()` du SDK ne
 * résout qu'une fois l'interruption effective (B.4) : la résolution EST la
 * confirmation, contrairement aux autres outils de ce fichier — d'où `applique`.
 */
export async function interrompreEquipe(repertoire: RepertoireCibles, missionId: string): Promise<ContratRetour> {
  const intention = `interrompre ${missionId}`;
  try {
    const cible = repertoire.cible(missionId);
    if (cible === null) return refuse(intention, 'équipe introuvable ou plus vivante');
    const resultat = await avecPlafond(cible.interrupt());
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    const degrade = resultat.valeur === undefined;
    return applique(intention, degrade ? 'interrompue (reçu dégradé — H-46)' : 'interrompue, reçu confirmé');
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'interrompreEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `arreter_equipe` (A.2.2) — fin de vie. L'état harness (autorité du Pi, E.1.1)
 * est écrit immédiatement et localement ; la libération réelle du worker (PC)
 * reste asynchrone et best-effort — d'où `accepte`, jamais `applique`.
 */
export async function arreterEquipe(
  arreteur: ArreteurMission,
  registre: Registre,
  missionId: string,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `arrêter ${missionId}`;
  try {
    const mission = registre.missions.lire(missionId);
    if (mission === null) return refuse(intention, 'mission introuvable');
    registre.etats.appliquerEtatHarness(missionId, 'annulee', { motif: 'arrêtée depuis le control plane' });
    const resultat = await avecPlafond(arreteur.arreter(missionId), plafondMs);
    if (resultat.etat === 'delai_depasse') {
      return accepte(intention, missionId, 'arrêt enregistré au registre — confirmation du worker non reçue à temps');
    }
    return accepte(intention, missionId, 'arrêt enregistré, libération du worker en cours');
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'arreterEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/** `relancer_equipe` (A.2.2) — reprise après crash, `resume` (B.3.3). Toujours `accepte`. */
export async function relancerEquipe(relanceur: RelanceurMission, registre: Registre, missionId: string): Promise<ContratRetour> {
  const intention = `relancer ${missionId}`;
  try {
    const mission = registre.missions.lire(missionId);
    if (mission === null) return refuse(intention, 'mission introuvable');
    if (mission.sessionId === null) return refuse(intention, 'aucune session à reprendre pour cette mission');
    const resultat = await avecPlafond(relanceur.relancer(missionId, mission.sessionId));
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    return accepte(intention, missionId, 'relance transmise au superviseur');
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'relancerEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}
