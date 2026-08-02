/**
 * Responsabilité : groupe « cycle de vie » de la surface d'outils (A.2.2) — mutatif.
 * Chaque fonction délègue à un port (B/D, hors périmètre de la mission A.2) et ne
 * s'expose jamais à une attente indéfinie : tout appel de port passe par
 * `avecPlafond` (acceptation (a), garantie mécanique, pas de discipline d'écriture).
 *
 * ☠ (d) Aucune fonction ici ne laisse une exception s'échapper.
 */

import type { Mission, Registre } from '../../registre/index.ts';
import { deciderCreationMission } from '../../../budgets/index.ts';
import { accepte, applique, echecInattendu, refuse } from './contrat.ts';
import { resoudreMission } from './outils-inspection.ts';
import { construireMandatPropose } from './mandat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import { avecPlafond } from './plafond.ts';
import type { AccesMandat } from '../../../shared/acces-mandat.ts';
import type {
  ArreteurMission,
  ConfigPlafondParc,
  ContratRetour,
  EmetteurEquipe,
  EnregistreurProposition,
  LecteurUtilisationParc,
  RelanceurMission,
} from './types.ts';

const RAISON_DELAI = "aucune confirmation du port dans le délai — le lien avec l'équipe est peut-être coupé";

/**
 * Évalue le plafond de parc (G.1.3, `deciderCreationMission`) sur TOUS les comptes
 * connus, faute d'un compte déjà assigné à ce stade (la proposition n'en choisit
 * aucun — H-61). Autorise dès qu'AU MOINS UN compte peut encore héberger une
 * mission ; l'assignation réelle du compte reste hors périmètre de A.2 (branche F).
 * Aucun compte connu ⇒ rien à borner, autorisé par défaut (cohérent avec H-58 :
 * le plafond est un frein, pas une exigence de préconditions).
 */
function evaluerPlafondParc(
  lecteur: LecteurUtilisationParc,
  config: ConfigPlafondParc,
): { readonly autorise: boolean; readonly motif: string } {
  const comptes = lecteur.comptesConnus();
  if (comptes.length === 0) {
    return { autorise: true, motif: 'aucun compte connu — rien à borner (G.1.3)' };
  }
  const decisions = comptes.map((compteId) => ({
    compteId,
    decision: deciderCreationMission(lecteur.releves(compteId), config),
  }));
  const viable = decisions.find((d) => d.decision.autorise);
  if (viable !== undefined) {
    return { autorise: true, motif: `compte « ${viable.compteId} » disponible (G.1.3) : ${viable.decision.motif}` };
  }
  const detail = decisions.map((d) => `compte « ${d.compteId} » : ${d.decision.motif}`).join(' ; ');
  return { autorise: false, motif: `plafond de parc (G.1.3) atteint sur tous les comptes connus — ${detail}` };
}

/**
 * `creer_equipe` (A.2.2, H-61 — TRANCHÉ, FAIT AUTORITÉ). Ne crée RIEN et ne
 * dispatche RIEN : retourne une proposition de mandat que l'UI présente à
 * l'approbation humaine explicite. La création effective part du clic de
 * l'opérateur, pas du tour de l'orchestrateur — voir `mandat.ts`.
 *
 * G.1.3 : la proposition elle-même est bornée par le plafond de parc — inutile
 * de présenter à l'opérateur un mandat qu'aucun compte ne peut plus héberger.
 * `lecteur` est un port SYNCHRONE (voir `types.ts`) : une exception qu'il lève
 * retombe dans le `catch` ci-dessous comme n'importe quelle autre, sans jamais
 * bloquer l'outil (acceptation (a)/(d)) — `avecPlafond` n'a pas de raison
 * d'être ici, il n'y a pas d'attente à borner.
 */
export function proposerCreationEquipe(
  projet: string,
  objectif: string,
  critereArret: string | null,
  perimetre: string,
  acces: AccesMandat,
  lecteur: LecteurUtilisationParc,
  config: ConfigPlafondParc,
  enregistreur?: EnregistreurProposition,
  modele?: string | null,
  effort?: string | null,
): ContratRetour {
  const intention = `proposer une équipe sur ${projet}`;
  try {
    const plafond = evaluerPlafondParc(lecteur, config);
    if (!plafond.autorise) return refuse(intention, plafond.motif);
    const proposition = construireMandatPropose(projet, objectif, critereArret, perimetre, acces);
    // `☠` Sans enregistreur, la proposition ne survit pas à ce tour : l'interface
    // n'aurait rien à autoriser et H-61 deviendrait une impasse. On le DIT au
    // modèle plutôt que de le laisser annoncer un bouton qui n'existe pas.
    if (enregistreur === undefined) {
      return refuse(intention, "aucun registre de propositions câblé : impossible de soumettre ce mandat à l'opérateur");
    }
    const depot = enregistreur.enregistrer({ projet, objectif, critereArret, perimetre, acces, modele, effort });
    // `☠` `applique` quand l'équipe est PARTIE, `differe` quand elle attend un
    // clic. Le contrat A.2.3 distingue les deux justement pour que le modèle ne
    // promette pas un résultat qu'il n'a pas — garder `differe` dans les deux cas
    // lui ferait annoncer une attente alors que le travail a commencé.
    if (depot.autoApprouve) {
      return applique(intention, `${depot.detail} (mandat ${depot.ref})`);
    }
    return {
      ok: true,
      intention,
      effet: 'differe',
      ref: depot.ref,
      etat: JSON.stringify({ ...proposition, attente: depot.detail }),
    };
  } catch (erreur) {
    journal.error({ err: erreur, projet }, 'proposerCreationEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * États harness dans lesquels une équipe peut encore ENTENDRE. `en_pause` en
 * fait partie : le message y est retenu localement et transmis à la reprise
 * (`superviseur/pilotage-workers.ts`), ce qui est un service rendu, pas un échec.
 *
 * `☠` `idle` côté SDK n'est PAS un état mort — c'est l'équipe qui a rendu la
 * main et attend. C'est même le moment le plus utile pour lui parler : le
 * message est lu immédiatement au lieu d'attendre la fin d'un tour.
 */
const ETATS_JOIGNABLES: readonly string[] = ['en_cours', 'en_pause'];

/**
 * Résout une équipe DESTINATAIRE et vérifie qu'elle peut encore entendre.
 *
 * `☠` Accepte une désignation libre (id, nom, projet) comme `suivre_equipe` :
 * l'orchestrateur désigne ses équipes par leur nom dans tout le reste de sa
 * boîte à outils, et se voyait refuser ici pour la seule raison qu'il n'avait
 * pas recopié un UUID.
 */
function destinataire(
  registre: Registre,
  designation: string,
  intention: string,
): { readonly mission: Mission } | { readonly refus: ContratRetour } {
  const resolution = resoudreMission(registre, designation);
  if ('absent' in resolution) return { refus: refuse(intention, 'aucune équipe ne correspond à cette désignation') };
  if ('ambigu' in resolution) {
    const noms = resolution.ambigu.map((m) => `${m.nom} (${m.id})`).join(', ');
    return { refus: refuse(intention, `désignation ambiguë — préciser l'identifiant parmi : ${noms}`) };
  }
  const mission = resolution.trouve;
  if (!ETATS_JOIGNABLES.includes(mission.etatHarness)) {
    return {
      refus: refuse(
        intention,
        `équipe « ${mission.nom} » en état ${mission.etatHarness} — plus joignable` +
          (mission.etatHarness === 'terminee' ? ' (son rapport est disponible via rapport_equipe)' : ''),
      ),
    };
  }
  return { mission };
}

/**
 * `envoyer_a_equipe` (A.2.2) — met en file, n'interrompt jamais (H-67). Émetteur
 * toujours `orchestrateur` (H-66) : ce chemin est le dispatch normal, jamais une
 * intervention directe de l'opérateur (celle-là passe par l'UI, hors ce module).
 *
 * `☠` Le texte porte le préfixe d'émetteur, et la construction du `SDKUserMessage`
 * appartient à la MACHINE qui héberge le worker (`pilotage-workers.ts`) : ce qui
 * traverse le lien est du texte, jamais un objet du SDK.
 */
export async function envoyerAEquipe(
  emetteur: EmetteurEquipe,
  registre: Registre,
  designation: string,
  texte: string,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `envoyer un message à ${designation}`;
  try {
    if (texte.trim().length === 0) return refuse(intention, 'message vide — rien à transmettre');
    const cible = destinataire(registre, designation, intention);
    if ('refus' in cible) return cible.refus;
    const { mission } = cible;
    const resultat = await avecPlafond(emetteur.envoyer(mission.id, `[émetteur:orchestrateur]\n${texte}`), plafondMs);
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    // `☠` Le détail vient de la MACHINE (« instruction transmise » / « RETENUE,
    // mission en pause ») : le rapporter tel quel évite de promettre une lecture
    // immédiate à un message qui dort jusqu'à la reprise.
    const detail = resultat.valeur?.detail ?? '';
    return accepte(
      intention,
      mission.id,
      detail === '' ? 'message mis en file, lu au prochain tour disponible' : detail,
    );
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'envoyerAEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `interrompre_equipe` (A.2.2) — stoppe le tour en cours. `interrupt()` du SDK ne
 * résout qu'une fois l'interruption effective (B.4) : la résolution EST la
 * confirmation, contrairement aux autres outils de ce fichier — d'où `applique`.
 */
export async function interrompreEquipe(
  emetteur: EmetteurEquipe,
  registre: Registre,
  designation: string,
  plafondMs?: number,
): Promise<ContratRetour> {
  const intention = `interrompre ${designation}`;
  try {
    const cible = destinataire(registre, designation, intention);
    if ('refus' in cible) return cible.refus;
    const resultat = await avecPlafond(emetteur.interrompre(cible.mission.id), plafondMs);
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    return applique(intention, 'tour interrompu, reçu confirmé par la machine hôte');
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'interrompreEquipe en échec');
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

/**
 * `relancer_equipe` (A.2.2) — reprise après crash, `resume` (B.3.3). Toujours `accepte`.
 *
 * `⚖` Arbitrage explicite (voir consigne de mission) : NE PASSE PAS par le plafond
 * de parc (G.1.3). `deciderCreationMission` documente lui-même sa portée : « Décide
 * si une NOUVELLE mission peut être créée » (`budgets/plafond-parc.ts`). Une relance
 * réutilise le `missionId` et le `compteId` déjà attribués en registre (H-53) — le
 * parc ne grandit pas, une mission déjà comptée reprend. La bloquer ici punirait un
 * crash (panne infra) exactement comme une saturation de quota, alors que G.1.3 vise
 * spécifiquement la CROISSANCE du parc, pas la continuité d'un travail déjà approuvé
 * par l'opérateur (H-61). Le frein sur compte saturé existe déjà à la bonne couche :
 * `politique-usage.ts` (G.1.4) suspend les CRÉATIONS sur limite atteinte, et un
 * `statut: 'rejected'` (H-54) est un fait déjà porté par le registre, indépendant de
 * ce module.
 */
export async function relancerEquipe(relanceur: RelanceurMission, registre: Registre, missionId: string): Promise<ContratRetour> {
  const intention = `relancer ${missionId}`;
  try {
    const mission = registre.missions.lire(missionId);
    if (mission === null) return refuse(intention, 'mission introuvable');
    if (mission.sessionId === null) return refuse(intention, 'aucune session à reprendre pour cette mission');
    const resultat = await avecPlafond(relanceur.relancer(missionId, mission.sessionId));
    if (resultat.etat === 'delai_depasse') return refuse(intention, RAISON_DELAI);
    // `☠` La machine dit si elle a RÉELLEMENT relancé. Un worker déjà vivant
    // (typiquement `idle` : l'équipe a rendu la main et attend) rend la relance
    // sans effet — l'annoncer « transmise » faisait croire à un réveil qui
    // n'arrivait jamais, et l'orchestrateur recommençait au lieu de parler.
    if (resultat.valeur?.dejaVivant === true) {
      return refuse(
        intention,
        "l'équipe est déjà vivante — la relance ne sert qu'après un crash. Pour lui parler : " +
          'envoyer_a_equipe ; pour couper son tour en cours : interrompre_equipe',
      );
    }
    return accepte(intention, missionId, 'relance transmise au superviseur');
  } catch (erreur) {
    journal.error({ err: erreur, missionId }, 'relancerEquipe en échec');
    return echecInattendu(intention, erreur);
  }
}
