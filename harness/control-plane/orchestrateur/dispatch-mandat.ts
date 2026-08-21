/**
 * Responsabilité : ce qui se passe quand l'opérateur AUTORISE un mandat (H-61).
 * C'est le seul endroit du harness où une équipe est réellement créée.
 *
 * `☠` H-61 est la règle la plus stricte du produit : l'orchestrateur propose,
 * l'humain seul dispose. Ce module n'est donc jamais appelé par une session
 * orchestrateur — uniquement par la route d'écriture déclenchée par un clic.
 *
 * `☠` L'ordre des opérations n'est pas cosmétique. La mission est inscrite au
 * registre AVANT le démarrage : si le PC répond mal (ou pas), on a une trace
 * d'une mission `planifiee` que la réconciliation pourra rattraper. L'inverse —
 * démarrer puis inscrire — laisserait un worker vivant que le Pi ne connaîtrait
 * pas, c'est-à-dire exactement une équipe fantôme (panne #11).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Proposition, Registre } from '../registre/index.ts';
import type { DemandeDemarrageTransportable } from '../../superviseur/index.ts';
import { effortsDe, messageModeleInconnu, normaliserModele } from '../../shared/modeles-claude.ts';
import {
  ACCES_DEFAUT,
  estAccesMandat,
  outilsRefusesPour,
  OUTILS_INTERACTION_HUMAINE,
  type AccesMandat,
} from '../../shared/acces-mandat.ts';
import { PLANCHER_DENI_SDK } from '../../plancher-deni/motifs.ts';
import { PLAFOND_EQUIPE_USD, plafondEffectifUsd } from '../../shared/budget-equipe.ts';
import { processusOrchestrateurLogger } from './processus/logger.ts';

const log = processusOrchestrateurLogger.child({ composant: 'dispatch-mandat' });

/** Ce que le Pi sait faire démarrer sur le PC. */
export interface DemarreurEquipe {
  demarrer(demande: DemandeDemarrageTransportable): Promise<{
    readonly detail: string;
    /** Chemin/branche RÉELLEMENT alloués côté PC (worktree git) — absent en mode dégradé non-git. */
    readonly worktree?: { readonly chemin: string; readonly branche: string | null };
  }>;
}

export interface DependancesDispatch {
  readonly registre: Registre;
  readonly demarreur: DemarreurEquipe;
  /**
   * Machine de travail où cette équipe va RÉELLEMENT tourner (migration 22).
   *
   * `☠` Résolue par l'appelant AVANT d'arriver ici — c'est la composition, seule
   * à connaître le parc, qui sait quel `demarreur` correspond à quelle machine.
   * Les deux vont ENSEMBLE : écrire une machine et démarrer sur une autre
   * produirait une équipe qu'aucun ordre d'arrêt ne pourrait plus atteindre.
   * `null` reste accepté pour les chemins qui n'ont pas de parc (bancs, tests,
   * restauration) — la mission n'est alors routable que sans ambiguïté.
   */
  readonly machine?: string | null;
  /**
   * Vérifie que le projet EXISTE sur la machine visée. Absent ⇒ aucune
   * vérification (bancs, tests).
   *
   * `☠` Sans lui, un mandat visant `stockiop` depuis un fil du PC part quand
   * même : le worker démarre dans un cwd inexistant, et l'échec arrive bien plus
   * loin, sous une forme qui ne nomme pas sa cause. Le refus doit tomber ICI,
   * avant la première écriture (`code-standards.md` : « valider avant la
   * première écriture, pas au point d'usage »).
   */
  readonly verifierProjet?: (chemin: string) => Promise<VerificationProjet>;
  /** Racine des projets sur le PC — le worktree en dérive. */
  readonly repertoireProjets: string;
  /** Motifs d'outils refusés d'office (plancher de déni, H-41). */
  readonly deniedToolPatterns?: readonly string[];
  /** Plafond d'équipes simultanées sur un projet GIT. Défaut : `PLAFOND_EQUIPES_PROJET_GIT_DEFAUT`. */
  readonly plafondEquipesParProjet?: number;
}

export interface ResultatDispatch {
  readonly missionId: string;
  readonly detail: string;
}

/**
 * Budget par défaut d'une équipe, quand le mandat n'en fixe pas.
 *
 * `☠` Valait 12 $ — la valeur exacte du PREMIER palier d'inspection anti-boucle.
 * L'équipe mourait donc au moment précis où le juge devait la regarder pour la
 * première fois. Dérivé de l'échelle depuis (`shared/budget-equipe.ts`), pour
 * que les deux ne puissent plus se croiser en silence.
 */
const BUDGET_DEFAUT_USD = PLAFOND_EQUIPE_USD;

/**
 * Plafond d'équipes simultanées sur un projet GIT (mandat E3). Motifs : disque
 * (chaque worktree porte ses propres node_modules/target), VRAM partagée (12 Go),
 * lisibilité d'une fusion à plus de quatre branches. Un projet non-git reste à 1
 * (H-56 strict), ce plafond ne s'applique jamais à lui.
 */
export const PLAFOND_EQUIPES_PROJET_GIT_DEFAUT = 4;

/**
 * `☠` Défauts du team leader, POSÉS et non hérités du CLI (décision Chris,
 * 2026-07-23). Un lead est le cerveau d'une équipe : le laisser tomber sur le
 * modèle ou l'effort par défaut de la machine le ferait échouer lentement, sans
 * qu'aucun signal ne le dise. L'orchestrateur peut les remplacer si l'opérateur
 * le lui demande (« sonnet 5 medium »), jamais de sa propre initiative.
 */
// `☠` Suivait `claude-opus-4-8`, qui a DISPARU de `supportedModels()` au passage
// au SDK 0.3.220 (CLI 2.1.220) : tout dispatch serait parti sur un modèle que le
// CLI n'expose plus. Mesuré le 31/07, pas supposé.
export const MODELE_LEAD_DEFAUT = 'claude-opus-5';
export const EFFORT_LEAD_DEFAUT = 'high';

/**
 * `☠` Un effort invalide est SILENCIEUSEMENT ignoré par le SDK (mesuré le
 * 2026-07-22 : `effort: 'ultra'` passe sans erreur et retombe au défaut). On le
 * refuse ici plutôt que de croire l'avoir appliqué.
 *
 * `☠` Les niveaux acceptés DÉPENDENT DU MODÈLE — la liste vivait en dur ici et
 * ignorait `max`, qui retombait donc en silence sur `high` alors qu'il est
 * valide partout sauf sur Haiku. Source unique : `shared/modeles-claude.ts`.
 */
type EffortWorker = 'low' | 'medium' | 'high' | 'xhigh';

function effortValide(brut: string | null, modele: string): EffortWorker {
  // `☠` `max` est retiré des choix POUR UN WORKER : il n'existe que via
  // `applyFlagSettings` (portée session), et un worker reçoit son effort par la
  // cascade de settings persistés, qui l'exclut. L'accepter ici donnerait un
  // réglage qu'on croit posé et qui ne l'est pas — voir `superviseur/types.ts`.
  const acceptes = effortsDe(modele).filter((e): e is EffortWorker => e !== 'max');
  // Haiku n'accepte AUCUN effort ; rien à valider, le défaut passe tel quel.
  if (acceptes.length === 0) return EFFORT_LEAD_DEFAUT as EffortWorker;
  const e = (brut ?? EFFORT_LEAD_DEFAUT).toLowerCase() as EffortWorker;
  if (!acceptes.includes(e)) {
    log.warn(
      { effort: brut, modele, acceptes },
      'niveau de raisonnement indisponible pour ce modèle sur un worker — repli sur le défaut',
    );
    return EFFORT_LEAD_DEFAUT as EffortWorker;
  }
  return e;
}

/**
 * Le modèle demandé n'est pas reconnaissable. `☠` Erreur NOMMÉE, levée AVANT
 * toute écriture : l'orchestrateur est un modèle, il se corrige tout seul si on
 * lui rend la liste des valeurs acceptées. Une équipe morte deux secondes après
 * son démarrage ne lui apprend rien (vécu le 31/07 avec « sonnet 5 »).
 */
export class ErreurModeleInconnu extends Error {
  constructor(readonly demande: string) {
    super(messageModeleInconnu(demande));
    this.name = 'ErreurModeleInconnu';
  }
}

/**
 * Compose le premier message du lead. `☠` Jamais vide : un flux d'entrée
 * silencieux n'émet jamais `init`, et le worker resterait muet (piège H-60).
 */
/**
 * `☠` LE bloc que le lead ignorait, et qui décide de tout depuis le 01/08.
 *
 * `rapport_equipe` ne rend PAS une synthèse construite : il rend le DERNIER BLOC
 * TEXTE que le lead a produit, tel quel. Et depuis que la fin d'une équipe
 * notifie l'orchestrateur, ce bloc est lu automatiquement pour décider de la
 * suite — relancer, enchaîner, ou rendre la main à Chris.
 *
 * Autrement dit : un lead qui termine par « Voilà, c'est fait ✅ » ne laisse rien
 * d'exploitable, et la décision suivante se prend sur du vide. Le défaut est
 * symétrique de celui corrigé sur l'orchestrateur toute la journée du 01/08 —
 * une information écrite d'un côté, jamais dite à l'autre.
 */
const BLOC_RAPPORT = [
  'TON DERNIER MESSAGE EST TON RAPPORT — ce n’est pas une formule.',
  'Le harness ne construit aucune synthèse : il transmet littéralement le dernier bloc de',
  'texte que tu écris, et l’orchestrateur décide de la suite dessus, souvent sans qu’un',
  'humain le relise. « C’est fait » ne lui apprend rien et lui fait relancer une équipe',
  'pour rien. Termine donc TOUJOURS par un bloc qui contient, dans cet ordre :',
  '  1. le critère d’arrêt est-il atteint — oui, non, ou partiellement, et pourquoi ;',
  '  2. ce que tu as changé, fichier par fichier, sans raconter ta démarche ;',
  '  3. ce que tu as VÉRIFIÉ et comment (commande lancée, résultat obtenu) — pas',
  '     « les tests passent », mais ce que tu as exécuté et ce qu’il a rendu ;',
  '  4. ce qui reste ouvert, et les questions que tu n’as pas pu trancher.',
].join('\n');

/**
 * `☠` Un message peut arriver PENDANT le travail (`envoyer_a_equipe`, H-67). Le
 * lead ne le savait pas : il pouvait le lire comme une interruption à laquelle
 * répondre puis s'arrêter, alors que c'est une correction de cap à intégrer.
 */
const BLOC_MESSAGES = [
  'L’orchestrateur peut t’écrire pendant que tu travailles. Ce n’est jamais un ordre',
  'de t’arrêter : c’est une précision ou une correction de cap. Intègre-la et poursuis',
  'ton mandat — ne réponds pas par un rapport de fin à un message de milieu de course.',
  'Il te regarde aussi en direct (tes dernières lignes) : dis en une phrase ce que tu',
  'fais quand tu changes de piste, c’est ce qui lui évite de te relancer à tort.',
].join('\n');

/**
 * `☠` Dit explicitement, parce que demander est le réflexe par défaut d'un agent :
 * personne ne lit ce flux pendant que l'équipe travaille. Un lead qui « attend
 * confirmation » brûle son budget à ne rien faire.
 */
/**
 * H-66 — attribution de l'émetteur. `☠` Vivait dans `CLAUSES_FIXES`, qui ne
 * partait nulle part : le lead ne pouvait donc PAS distinguer une instruction de
 * l'orchestrateur d'une parole de Chris, et faisait porter à l'un les décisions
 * de l'autre.
 */
const BLOC_ATTRIBUTION = [
  'Tu es une équipe parmi d’autres, parfois en parallèle, toutes dirigées par le même',
  'orchestrateur maître. Tes instructions viennent normalement de LUI, pas de l’humain.',
  'L’opérateur peut aussi te parler directement — ces messages-là sont identifiés comme',
  'tels. Ne jamais attribuer à l’opérateur une instruction venue de l’orchestrateur.',
].join('\n');

/**
 * `☠` Les outils que l'équipe a RÉELLEMENT depuis le 01/08 — et qu'elle n'avait
 * jamais eus auparavant.
 *
 * Relevé ce jour-là : `mcpServers: []` dans le config dir de chaque compte.
 * Aucune équipe n'a jamais disposé d'un seul serveur MCP depuis l'origine du
 * harness, alors que son mandat lui ordonnait déjà d'utiliser Playwright pour
 * valider. Corrigé (`workers/mcp-du-poste.ts`) et vérifié sur un worker réel :
 * l'équipe appelle `mcp__codeindex__…` et obtient une réponse, un témoin sans
 * transmission répond « aucun serveur CodeIndex n'est monté ici ».
 *
 * `☠` Les nommer un par un n'est pas de la décoration : un outil qu'un modèle
 * ne sait pas qu'il possède n'existe pas pour lui. Le lead se rabattait sur le
 * shell — beaucoup plus de tours, et les tours sont ce qu'on paie.
 */
const BLOC_OUTILS = [
  'TES OUTILS — tu en as plus que tu ne crois, sers-t’en avant de tâtonner au shell.',
  '  · CodeIndex (`mcp__codeindex__*`) — AVANT toute exploration manuelle d’un projet.',
  '    `query_project` et `search_functions` remplacent cinq à dix lectures de fichiers.',
  '  · Playwright (`mcp__playwright__*`) — le navigateur réel : naviguer, cliquer, remplir,',
  '    lire les erreurs console, capturer. C’est LUI qui valide une interface, pas la relecture.',
  '  · Log Watcher (`mcp__log-watcher__*`) — démarre les processus (`process_start`) et relis',
  '    leurs erreurs (`process_get_errors`). Ne laisse jamais un serveur tourner sans surveillance.',
  '  · pty-mcp (`mcp__pty-mcp__*`) — pour tout ce qui est interactif en terminal.',
  '  · Mémoire sémantique (`mcp__semantic-memory__*`) — le contexte durable du projet.',
  '  · Ta dépense (`mcp__ccremote-depense__ma_depense`) — ce que ta mission a coûté jusqu’ici, ton',
  '    plafond, la part déjà consommée. Appelle-le avant d’engager un travail long, ou dès que tu',
  '    hésites à approfondir une piste — ne bâtis jamais une hypothèse sur un dépassement de',
  '    budget supposé sans l’avoir vérifié ici. Lecture seule, appelle-le aussi souvent que tu veux.',
  '',
  '`☠` La mémoire sémantique est PARTAGÉE avec l’humain et avec les autres équipes.',
  'Tu peux y lire librement. Si tu y écris, écris dans le projet sur lequel tu travailles,',
  'jamais dans son profil personnel, et n’attribue JAMAIS à l’humain une décision qui vient',
  'de l’orchestrateur ou de toi — une mémoire fausse survit longtemps à l’équipe qui l’a posée.',
  '',
  // `☠` LA FORME EXACTE DU BLOCAGE, ISOLÉE EN QUATRE MESURES (03/08) — la
  // première rédaction disait « un `sleep` nu est refusé », et c'était faux
  // assez pour nuire : un agent l'aurait lu comme une interdiction générale et
  // aurait contourné des formes parfaitement acceptées. Mesuré : `sleep 1` seul
  // PASSE · `sleep 35` seul est BLOQUÉ · `echo; sleep 35; echo` PASSE ·
  // `echo; sleep 170; echo` PASSE. Les deux propriétés comptent ensemble —
  // seul ET long. Le `sleep 2` d'une boucle `until` n'a jamais été menacé.
  //
  // `☠` Le plafond de 120 s N'EST PAS SYSTÉMATIQUE, contrairement à ce qu'on a
  // d'abord écrit : il a coupé deux sous-agents le matin (exit 143 sur des
  // boucles `until`), et l'après-midi un script de 150 s lancé au premier plan
  // sans rien préciser est passé (157 s mesurées). Le `timeout` explicite est
  // donc une PRÉCAUTION qui supprime le risque, pas la parade à une fatalité —
  // le dire autrement ferait douter un agent de ce qu'il observe.
  //
  // Ce bloc est ici et pas dans les clauses de la carte d'autorisation : celles-là
  // ne partent qu'à l'écran de Chris, jamais au worker (défaut du 01/08, qu'un
  // test d'assemblage a rattrapé une seconde fois le 03/08 avant déploiement).
  'ATTENDRE, AU SHELL — ce que l’outil Bash refuse, et ce qu’il accepte.',
  'Un `sleep` SEUL ET LONG est refusé (`sleep 35` : bloqué). Court, il passe (`sleep 1`), et',
  'accompagné il passe aussi — `cmd && sleep 2 && verif`, ou le `sleep 2` d’une boucle, n’ont',
  'jamais été refusés. Pour attendre une durée, la forme sûre :',
  '  fin=$(( $(date +%s) + N )); until [ $(date +%s) -ge $fin ]; do sleep 2; done',
  'Pour attendre une CONDITION, la même boucle `until` sur le test qui doit devenir vrai —',
  'c’est presque toujours ce qu’il faut : attendre qu’un port réponde vaut mieux qu’attendre',
  '« assez longtemps ». Au-delà de deux minutes, règle le paramètre `timeout` de l’outil',
  '(en millisecondes, au-delà de N) : une commande longue est parfois coupée à 120 s, pas',
  'toujours, et la précaution coûte moins cher que la relance.',
  '',
  // `☠` MESURÉ LE 03/08, ET BIEN PLUS SYSTÉMATIQUE QUE LE CAS `sleep` — relevé
  // par l'orchestrateur en lisant un transcript : un sous-agent a capturé `$!`
  // après `nohup … &` en croyant tenir le PID de son serveur ; il tenait le
  // wrapper bash de l'outil. Son `kill` n'a rien tué, le serveur répondait
  // toujours, et il a fallu deux commandes de plus pour s'en apercevoir.
  'ARRÊTER CE QUE TU AS LANCÉ EN ARRIÈRE-PLAN. Après `cmd &` ou `nohup cmd &`, `$!` désigne',
  'souvent le shell qui enveloppe ta commande, pas ton process : le `kill` réussit et le',
  'service tourne encore. Retrouve le vrai PID (`pgrep -af "<motif unique>"`), tue celui-là,',
  'et VÉRIFIE après coup — le port ne répond plus, le process a disparu. Un service laissé',
  'vivant sur un worktree éphémère survit à ton équipe.',
].join('\n');

/**
 * `☠` LE défaut de coût, mesuré le 01/08 sur la production.
 *
 * Le site lumen a coûté **52,93 $ en six vagues**, aucune sous 3,85 $. Cause
 * lue dans le SDK, pas déduite : `AgentInput.model` est OPTIONNEL et
 * « if omitted, inherits from the parent ». Un lead Opus 5 qui lance trois
 * sous-agents sans rien préciser lance donc trois Opus 5 — et rien, nulle part,
 * ne le lui disait. Moyenne mesurée : 6,40 $ par mission Opus contre 0,67 $ par
 * mission Sonnet.
 *
 * `☠` Les valeurs sont des ALIAS (`sonnet`, `opus`, `haiku`, `fable`), jamais des
 * identifiants complets. Écrire `claude-sonnet-5` ici est le défaut du 31/07 sous
 * une autre forme — une chaîne plausible refusée par l'outil.
 *
 * `☠` La contrepartie est nommée, sinon la consigne se retourne : Sonnet rend
 * plus souvent un travail non vérifié. La parade n'est PAS une relecture Opus
 * systématique (qui réintroduirait le coût qu'on retire) mais une PREUVE
 * MÉCANIQUE, qui ne coûte aucun token.
 */
const BLOC_DIMENSIONNEMENT = [
  'DIMENSIONNE TES SOUS-AGENTS — c’est toi qui paies, et par défaut tu paies le prix fort.',
  'L’outil Task accepte un paramètre `model`. OMIS, le sous-agent HÉRITE DE TON MODÈLE :',
  'trois sous-agents lancés sans rien préciser par un lead Opus, ce sont trois Opus en',
  'parallèle. Mesuré le 01/08 : un site vitrine a coûté 52,93 $ de cette façon.',
  '',
  'Valeurs acceptées — des alias, jamais un identifiant complet : `sonnet`, `opus`, `haiku`.',
  '',
  '  · `sonnet` — TON DÉFAUT. Tout ce qui est cadré : écrire du code sur une spec établie,',
  '    appliquer un correctif décrit, écrire des tests, refactorer, explorer une base,',
  '    rédiger de la doc, brancher une API connue. C’est la majorité d’un mandat.',
  '  · `opus` — RÉSERVÉ à deux choses, et tu dois pouvoir dire laquelle : la profondeur de',
  '    raisonnement (architecture non triviale, diagnostic d’un défaut qui résiste, arbitrage',
  '    aux conséquences lointaines) et la création (direction artistique, motion design,',
  '    tout ce qui doit aller loin plutôt que rendre une idée plate).',
  '  · `haiku` — mécanique et volumineux : renommage massif, extraction, tri, relevé.',
  '',
  'Le vrai critère n’est pas la difficulté ressentie, c’est : « ai-je déjà tranché comment',
  'faire ? » Si oui, c’est de l’exécution — `sonnet`. Si la décision fait partie du travail,',
  'c’est `opus`. Quand tu hésites, prends `sonnet` et garde la main pour vérifier.',
  '',
  'CE QUE TU DOIS À UN RENDU DE SOUS-AGENT — surtout `sonnet`, qui déclare plus souvent',
  'terminé un travail qu’il n’a pas vérifié. N’accepte JAMAIS un rendu sur sa parole :',
  'exige une PREUVE MÉCANIQUE et lis-la toi-même. Une commande et sa sortie (`tsc`, les',
  'tests, le linter), un fichier relu, une page ouverte. Cela ne coûte aucun token de',
  'modèle et attrape ce qu’une relecture manquerait. Ne repasse derrière avec un sous-agent',
  '`opus` que si la preuve mécanique est impossible — c’est le second filet, pas le premier.',
].join('\n');

/**
 * `☠` Les trois gestes qui séparent un correctif prouvé d'un correctif décoré.
 * Mesuré sur ce dépôt le 31/07 : trois pannes en une session, toutes VERTES sur
 * le papier, toutes causées par l'absence d'un de ces trois gestes.
 */
const BLOC_VALIDATION = [
  'UN CORRECTIF VERT PEUT CACHER UNE PANNE INTACTE. Avant de déclarer corrigé :',
  '  · valide ton test dans les DEUX SENS — annule ton correctif, vois le test échouer,',
  '    restaure. Un test qui ne sait pas échouer ne prouve rien, il décore ;',
  '  · lis un artefact RÉEL avant et après (une ligne en base, une ligne de log), jamais',
  '    seulement un test qui passe ;',
  '  · quand tu remplaces une constante par un calcul, la question n’est pas « le calcul',
  '    est-il juste ? » mais « ce qu’il lit est-il jamais écrit ? » ;',
  '  · si un symptôme survit à ta correction, compare sa SIGNATURE avant/après. Identique,',
  '    c’est une réfutation : la variable que tu as changée n’est pas la cause.',
].join('\n');

const BLOC_AUTONOMIE = [
  'Tu décides seul, de bout en bout. Personne ne lit ce fil pendant que tu travailles :',
  'aucune question posée ici n’atteindra un humain, et l’outil pour en poser une ne t’est',
  'pas fourni. Tes sous-agents te demandent, TOI tu tranches. Si un choix te dépasse',
  'vraiment, prends l’option la plus réversible, poursuis, et écris la question dans ton',
  'rapport final — c’est là qu’elle sera lue, et elle deviendra un autre mandat.',
].join('\n');

/** Ce que l'accès autorise, annoncé au lead en plus d'être appliqué. */
function ligneAcces(acces: AccesMandat): string {
  // `☠` Vient du MÊME calcul que les refus d'outils (paramètre, jamais relu
  // depuis `p`) : deux lectures indépendantes finiraient par diverger, et le
  // lead brûlerait son budget à retenter des outils qu'on lui a dit d'utiliser.
  if (acces === 'lecture') {
    return (
      'Accès : LECTURE SEULE. Write, Edit et NotebookEdit te sont refusés par le harness — ' +
      'inutile de les tenter. Bash reste disponible : explore librement au shell ' +
      '(rg, git log, find…), mais n’écris pas de fichier par ce biais — ce mandat ne ' +
      'te demande pas de modifier le projet. Rends tes conclusions par écrit.'
    );
  }
  if (acces === 'rapport') {
    return (
      'Accès : LECTURE sur le projet, ÉCRITURE CONFINÉE à ton propre worktree. Write, Edit ' +
      'et NotebookEdit fonctionnent, mais SEULEMENT sur des chemins à l’intérieur de ton ' +
      'répertoire de travail — un chemin hors de ce répertoire est refusé par le harness, ' +
      'pas par consigne. Utilise-les pour tes scripts d’analyse jetables ; ton rapport final ' +
      'reste ta livraison, pas une modification du projet lui-même.'
    );
  }
  return 'Accès : lecture et écriture, dans les limites du plancher de déni.';
}

/**
 * `☠` Le budget est ANNONCÉ. Il coupe la session quand il est atteint, sans
 * préavis et sans que le lead comprenne pourquoi : un mandat interrompu à
 * mi-chemin ressemble à un crash, et la relance repart sur les mêmes rails pour
 * se faire couper au même endroit.
 */
function ligneBudget(budgetUsd: number): string {
  const montant = plafondEffectifUsd(budgetUsd);
  // `☠` Le montant seul ne suffit pas — l'incident qui a motivé ce bloc (18/08) :
  // une équipe de diagnostic a bâti son hypothèse principale sur un supposé
  // dépassement de budget alors qu'elle était à 15 % de son plafond. Dire
  // D'OÙ VIENT le plafond (mission propre, ou parc par défaut) évite qu'un
  // lead le devine — ou pire, suppose qu'il n'y en a pas.
  const origine =
    budgetUsd > 0
      ? 'plafond propre à cette mission'
      : 'aucun plafond propre n’a été fixé pour cette mission — tu cours sous le plafond de parc';
  return (
    `Budget : ${montant.toFixed(2)} $ (${origine}). Au-delà, ta session est coupée net, où que tu en sois. ` +
    'Dimensionne ton travail en conséquence : mieux vaut un rapport honnête à mi-parcours ' +
    'qu’un chantier tranché en deux par le plafond. Pour savoir où tu en es à tout moment sans ' +
    'attendre une coupure : `ma_depense`, voir TES OUTILS ci-dessous.'
  );
}

/**
 * Le RÔLE et les règles permanentes du lead — ce qui part en `systemPrompt`.
 *
 * `☠` LA distinction qui manquait, et elle est mécanique, pas stylistique : le
 * `systemPrompt` survit à la compaction, le premier message NON. Or les workers
 * tournent avec `autoCompactEnabled: true` — sur un mandat long, le lead
 * compacte et perd son premier message. Tout ce qui vivait uniquement là
 * disparaissait donc au moment précis où il en avait le plus besoin : la règle
 * du rapport, son accès, son budget, son critère d'arrêt. Il ne lui restait que
 * `mandate: p.objectif` — une ligne.
 *
 * `☠` Deuxième moitié du même défaut : les CLAUSES_FIXES de
 * `mcp-controle/mandat.ts` (H-52 validation réelle, H-66 attribution) ne sont
 * jamais parties au worker. Elles ne servaient qu'à composer le texte AFFICHÉ à
 * Chris sur la carte d'autorisation. Dixième occurrence du motif « écrit,
 * testé, branché sur rien » — et cette fois sur deux règles H.
 *
 * Règle qui en découle : tout ce qui doit rester vrai au tour 50 va ICI. Le
 * premier message ne porte que l'amorce.
 */
export function composerMandatSysteme(p: Proposition, acces: AccesMandat): string {
  const critere = p.critereArret ?? 'non fixé — rends la main dès que l’objectif est atteint';
  return [
    'Tu es le team leader d’une équipe ccremote, responsable de A à Z : conception,',
    'développement, tests, debug, validation end-to-end AVANT de déclarer terminé.',
    'Utilise les MCP à disposition (Playwright, Log Watcher, pty-mcp…) pour valider',
    'réellement — lire du code ne suffit pas.',
    '',
    `TON MANDAT — projet ${p.projet}`,
    `Objectif : ${p.objectif}`,
    `Critère d'arrêt : ${critere}`,
    `Périmètre : ${p.perimetre} (interdiction de sortir du worktree)`,
    ligneAcces(acces),
    ligneBudget(p.budgetMaxUsd),
    '',
    BLOC_AUTONOMIE,
    '',
    BLOC_OUTILS,
    '',
    BLOC_DIMENSIONNEMENT,
    '',
    BLOC_ATTRIBUTION,
    '',
    BLOC_MESSAGES,
    '',
    BLOC_VALIDATION,
    '',
    BLOC_RAPPORT,
  ].join('\n');
}

/**
 * Le premier message. `☠` Jamais vide : un flux d'entrée silencieux n'émet
 * jamais `init`, et le worker resterait muet (piège H-60). Court par
 * conception — tout ce qui compte vit dans le `systemPrompt`, qui lui survivra
 * à la compaction.
 */
export function composerPromptInitial(p: Proposition, acces: AccesMandat): string {
  return [
    `Mandat autorisé par l'opérateur — projet ${p.projet}.`,
    ``,
    `Objectif : ${p.objectif}`,
    ligneAcces(acces),
    ``,
    `Le cadre complet (critère d'arrêt, périmètre, budget, forme du rapport attendu) est`,
    `dans tes instructions système : relis-les, elles restent valables jusqu'au bout.`,
    ``,
    `Commence par établir l'état des lieux avant de modifier quoi que ce soit.`,
  ].join('\n');
}

/**
 * `☠` L'epoch DOIT croître à chaque dispatch sur un même worktree : le fencing
 * (M-11) rejette explicitement une égalité, précisément pour empêcher deux
 * workers de coexister sur le même répertoire. Un `epoch: 1` codé en dur rendait
 * donc tout second dispatch impossible sur un projet déjà utilisé (constaté en
 * prod le 23/07 : `collision_meme_epoch`).
 *
 * `☠` Le maximum se lit sur TOUTE la colonne, jamais sur une fenêtre de
 * récence : filtrer les 200 missions les plus récentes tous projets confondus
 * faisait redescendre l'epoch d'un projet peu actif dès que le harness
 * dépassait 200 missions au total — la collision revenait par la porte de
 * derrière, des mois après le correctif.
 */
function prochainEpoch(registre: Registre, projet: string): number {
  return registre.missions.epochMaxDuProjet(projet) + 1;
}

/**
 * Les refus d'outils réellement posés sur le worker.
 *
 * `☠` Le PLANCHER est INCONDITIONNEL (H-41) : il ne dépend ni de l'accès demandé
 * ni de l'appelant. Il existait, il était testé, il était utilisé par les bancs
 * d'acceptation — et il n'était branché sur AUCUN chemin de production : le seul
 * site de dispatch réel n'alimente pas `deps.deniedToolPatterns`, donc le `?? []`
 * rendait un tableau vide, que `options-composition.ts` posait tel quel en
 * `disallowedTools`. Neuvième occurrence du motif « écrit, testé, branché sur
 * rien » sur ce projet ; constaté le 2026-07-31. Rien n'interdisait à un worker
 * d'écraser `~/.ssh` ou les identifiants OAuth du poste.
 *
 * L'accès s'ajoute par-dessus, il ne remplace jamais le plancher.
 *
 * `☠` Les outils d'interaction humaine sont refusés INCONDITIONNELLEMENT, comme
 * le plancher : personne ne regarde le flux d'une équipe qui travaille, une
 * question posée là n'atteint aucun humain.
 */
function composerDenis(acces: AccesMandat, supplementaires?: readonly string[]): readonly string[] {
  return [
    ...PLANCHER_DENI_SDK,
    ...OUTILS_INTERACTION_HUMAINE,
    ...outilsRefusesPour(acces),
    ...(supplementaires ?? []),
  ];
}

/**
 * Crée la mission puis démarre l'équipe. Lève si le compte ou le PC manquent —
 * l'appelant traduit en erreur visible : un mandat autorisé dont rien ne part
 * doit se voir, jamais se perdre.
 */
/**
 * Une équipe est déjà active sur ce projet (H-56 : une seule à la fois). Erreur
 * NOMMÉE, pas générique : l'appelant doit pouvoir en faire un refus lisible
 * plutôt qu'un 500 anonyme.
 */
export class ErreurProjetOccupe extends Error {
  constructor(
    readonly missionId: string,
    readonly projet: string,
    readonly etat: string,
  ) {
    super(
      `${projet} n'est pas un dépôt git : une seule équipe à la fois, faute d'isolation possible ` +
        `(git worktree indisponible). Équipe déjà active : mission ${missionId.slice(0, 8)}, état ${etat} — ` +
        'termine-la avec arreter_equipe avant d’en lancer une autre (H-56, projets non-git).',
    );
    this.name = 'ErreurProjetOccupe';
  }
}

/**
 * Le plafond d'équipes simultanées sur un projet GIT est atteint (mandat E3).
 * Erreur NOMMÉE, sur le même principe que `ErreurProjetOccupe` : un refus lisible
 * plutôt qu'une contrainte SQL anonyme — la base ne connaît d'ailleurs pas ce
 * plafond, il n'existe qu'en application.
 */
export class ErreurPlafondEquipesProjetAtteint extends Error {
  constructor(
    readonly projet: string,
    readonly actives: number,
    readonly plafond: number,
  ) {
    super(
      `« ${projet} » a déjà ${actives} équipe(s) active(s), au plafond configuré (${plafond}) — ` +
        'termine-en une avec `arreter_equipe` avant d’en lancer une autre.',
    );
    this.name = 'ErreurPlafondEquipesProjetAtteint';
  }
}

/**
 * Le mandat a déjà été tranché — approuvé automatiquement, approuvé ailleurs, ou
 * refusé. Erreur NOMMÉE pour la même raison que la précédente : l'appelant doit
 * pouvoir en faire un refus lisible plutôt qu'un 500 anonyme.
 *
 * `☠` Mesuré en prod le 01/08 : mandat auto-approuvé 1,5 s après sa création,
 * puis approuvé d'un clic 16 s plus tard sur une carte d'écran restée périmée.
 * L'`Error` nue remontait en 500 « échec interne du harness » — alors que
 * l'équipe TOURNAIT. Le message dit maintenant ce qui s'est passé et où
 * regarder : c'est exactement ce qui manque à un opérateur devant une erreur.
 */
/**
 * Le projet visé n'existe pas sur la machine choisie pour ce fil.
 *
 * `☠` Le message NOMME la machine et le chemin cherché. L'appelant est
 * l'orchestrateur — un modèle : un refus nu le laisse réémettre le même mandat
 * au tour suivant, tandis qu'un refus qui dit « stockiop n'est pas sur
 * trinityarch » le fait changer de machine ou de projet immédiatement
 * (`rules/code-standards.md`, « Model output is untrusted input »).
 */
export class ErreurProjetAbsentDeLaMachine extends Error {
  constructor(
    readonly projet: string,
    readonly machine: string,
    readonly chemin: string,
    /** Ce que la machine a réellement répondu — jamais reformulé en « absent ». */
    readonly note?: string,
  ) {
    super(
      `le projet « ${projet} » n'est pas exploitable sur la machine « ${machine} » (cherché : ${chemin}${note === undefined || note === '' ? '' : ` — ${note}`}) — choisir une autre machine pour ce fil, ou un projet présent sur celle-ci`,
    );
    this.name = 'ErreurProjetAbsentDeLaMachine';
  }
}

/**
 * Verdict de présence d'un projet sur une machine.
 *
 * `☠` `note` porte la RAISON telle que la machine l'a donnée — « chemin
 * inexistant », « répertoire illisible », « machine injoignable ». La réduire à
 * un booléen ferait annoncer « projet absent » alors que la vraie cause est un
 * lien coupé, et l'opérateur chercherait au mauvais endroit.
 */
export interface VerificationProjet {
  readonly present: boolean;
  readonly note?: string;
  /** Absent ou `false` ⇒ traité comme non-git (défaut conservateur, préserve H-56 strict
   * pour tout appelant qui ne le fournit pas). */
  readonly estGit?: boolean;
}

export class ErreurMandatDejaTranche extends Error {
  constructor(
    readonly statut: string,
    readonly missionId: string | null,
  ) {
    super(
      statut === 'approuvee'
        ? 'ce mandat a déjà été autorisé — l’équipe est lancée, elle est visible dans le Parc'
        : `ce mandat a déjà été ${statut} — il n’y a plus rien à décider dessus`,
    );
    this.name = 'ErreurMandatDejaTranche';
  }
}

export async function dispatcherMandat(p: Proposition, deps: DependancesDispatch): Promise<ResultatDispatch> {
  // `☠` Rotation (H-53) : `listerDisponibles()` exclut les comptes marqués
  // `rejected` par le balayage de télémétrie. C'est ici que la bascule se fait —
  // silencieusement pour l'opérateur, mais tracée.
  const disponibles = deps.registre.comptes.listerDisponibles();
  const compte = disponibles[0];
  if (compte === undefined) {
    const tous = deps.registre.comptes.lister().length;
    throw new Error(
      tous === 0
        ? 'aucun compte Claude enregistré — impossible de démarrer une équipe'
        : `les ${tous} comptes connus sont saturés — attends une remise à zéro de fenêtre avant de relancer`,
    );
  }
  if (deps.registre.comptes.lister()[0]?.id !== compte.id) {
    log.info({ compteId: compte.id }, 'rotation de compte : le précédent est saturé');
  }

  // `☠` Le worktree vit sur le PC, pas sur le Pi. Un projet déjà donné en chemin
  // absolu est pris tel quel : le concaténer au répertoire de projets du Pi
  // produisait `/home/pi/projets/mnt/projects/vela` — un chemin qui n'existe sur
  // aucune des deux machines (constaté en prod le 23/07).
  const cwd = p.projet.startsWith('/') ? p.projet : join(deps.repertoireProjets, p.projet);

  // `☠` AVANT la première écriture, jamais au point d'usage. Un mandat qui vise
  // un projet absent de la machine choisie doit être refusé net : laisser passer
  // produirait un worker démarré dans un cwd inexistant, une mission inscrite au
  // registre, et un échec surgissant beaucoup plus loin sous une forme qui ne
  // nomme pas sa cause. Un demi-enregistrement suivi d'un dispatch raté est pire
  // qu'un refus propre — il laisse un état à réconcilier.
  //
  // `☠` Déplacé AVANT le contrôle H-56 : c'est ce verdict (`estGit`) qui décide
  // quelle règle appliquer — mono-équipe stricte ou plafond git.
  let estGit = false;
  if (deps.verifierProjet !== undefined) {
    const verdict = await deps.verifierProjet(cwd);
    if (!verdict.present) {
      throw new ErreurProjetAbsentDeLaMachine(p.projet, deps.machine ?? '(non précisée)', cwd, verdict.note);
    }
    estGit = verdict.estGit === true;
  }

  // `☠` H-56 VÉRIFIÉ ICI, avant toute écriture. L'index unique partiel de la base
  // fait bien son travail, mais son échec remontait en `SQLITE_CONSTRAINT_UNIQUE`
  // ⇒ 500 ⇒ « erreur interne du control plane » à l'écran (constaté en prod le
  // 23/07). Une règle métier connue n'est PAS une panne : elle se refuse en
  // clair, en nommant l'équipe qui bloque, sinon l'opérateur clique trois fois
  // sans jamais comprendre pourquoi rien ne part.
  //
  // `☠` Depuis le mandat E3 : mono-équipe (H-56 strict) UNIQUEMENT pour un projet
  // non-git — un projet git accepte plusieurs équipes, une par worktree, jusqu'à
  // un plafond appliqué ICI (la base ne le connaît pas, elle ignore ce qu'est
  // un worktree).
  const actives = deps.registre.missions.listerActives().filter((m) => m.projet === p.projet);
  if (!estGit) {
    const dejaActive = actives[0];
    if (dejaActive !== undefined) {
      throw new ErreurProjetOccupe(dejaActive.id, p.projet, dejaActive.etatHarness);
    }
  } else {
    const plafond = deps.plafondEquipesParProjet ?? PLAFOND_EQUIPES_PROJET_GIT_DEFAUT;
    if (actives.length >= plafond) {
      throw new ErreurPlafondEquipesProjetAtteint(p.projet, actives.length, plafond);
    }
  }

  const missionId = randomUUID();
  const sessionId = randomUUID();
  const lotId = randomUUID();
  // `☠` VALIDÉ ICI, avant la moindre écriture : la valeur vient d'un LLM qui
  // écrit en langage naturel. « sonnet 5 » partait tel quel au CLI et tuait
  // l'équipe deux secondes après son démarrage (31/07).
  const modele = p.modele === null || p.modele === undefined ? MODELE_LEAD_DEFAUT : normaliserModele(p.modele);
  if (modele === null) throw new ErreurModeleInconnu(p.modele ?? '');
  const effort = effortValide(p.effort, modele);
  // `☠` Même traitement pour l'accès, et pour la même raison : un appelant qui
  // construirait une proposition sans ce champ (chemin non câblé, restauration,
  // test) ne doit pas obtenir l'écriture par omission. Une seule lecture, servant
  // À LA FOIS le prompt et les refus d'outils.
  const acces: AccesMandat = estAccesMandat(p.acces) ? p.acces : ACCES_DEFAUT;
  // `☠` Calculé UNE FOIS, puis écrit au registre ET envoyé au PC. Il n'était
  // qu'envoyé : la colonne restait à 0, et comme `prochainEpoch()` la lit, il
  // rendait toujours 1 — deux dispatchs successifs sur un même worktree
  // portaient donc le même epoch, ce que le fencing (M-11) doit justement
  // rejeter. Deux valeurs calculées séparément divergeraient de la même façon.
  const epoch = prochainEpoch(deps.registre, p.projet);

  deps.registre.lots.creer({ id: lotId, intention: p.objectif, origine: 'orchestrateur' });
  deps.registre.missions.creer({
    id: missionId,
    lotId,
    nom: p.objectif.slice(0, 80),
    projet: p.projet,
    compteId: compte.id,
    sessionId,
    mandat: p.objectif,
    critereArret: p.critereArret,
    budgetMaxUsd: p.budgetMaxUsd,
    worktree: cwd,
    // `☠` Le modèle est CONNU ici : c'est le harness qui l'impose, pas le CLI qui
    // le choisit. L'écrire évite un « (non résolu) » à l'écran alors que la
    // valeur ne fait aucun doute. Ce qui reste réellement inconnu du Pi tant que
    // la télémétrie n'existe pas : coût, contexte, état SDK.
    modeleDemande: modele,
    modeleResolu: modele,
    epoch,
    // `☠` Le fil d'où vient cette équipe, propagé jusqu'à la mission. La
    // proposition le portait déjà — il s'arrêtait là, et plus rien en aval ne
    // savait à qui rendre compte. C'est ce chaînon qui permet à une fin d'équipe
    // de revenir dans la conversation qui l'a demandée (migration 14).
    conversationId: p.conversationId,
    // `☠` Écrite ICI, à partir de la machine réellement retenue, et solidaire du
    // `demarreur` que la composition a choisi pour elle. Sans cette colonne, un
    // ordre d'arrêt ne saurait plus à qui s'adresser dès que deux machines
    // tournent (migration 22).
    machine: deps.machine ?? null,
    // `☠` Conditionne H-56 (mono-équipe non-git vs plafond git) — voir migration 25.
    projetEstGit: estGit,
  });

  const demande: DemandeDemarrageTransportable = {
    missionId,
    epoch,
    promptInitial: composerPromptInitial(p, acces),
    parametres: {
      sessionId,
      cwd,
      // `☠` Le RÔLE et les règles permanentes, pas seulement l'objectif. Ce
      // champ devient le `systemPrompt` du worker : c'est la SEULE partie qui
      // survit à sa compaction. Avant, il portait une ligne — et un lead qui
      // compactait perdait son critère d'arrêt, son accès, son budget et la
      // forme du rapport attendu, au tour précis où il en avait besoin.
      mandate: composerMandatSysteme(p, acces),
      deniedToolPatterns: composerDenis(acces, deps.deniedToolPatterns),
      // `☠` Garde 3 — le verrou RÉEL de l'accès `rapport` : voir
      // `workers/confinement-ecriture.ts`. `outilsRefusesPour('rapport')` rend
      // `[]` (les outils d'écriture ne sont pas refusés par nom), c'est ce
      // champ, câblé au hook `PreToolUse`, qui confine leur cible au worktree.
      confinerEcritureCwd: acces === 'rapport',
      maxBudgetUsd: plafondEffectifUsd(p.budgetMaxUsd),
      // `☠` Même condition que `ligneBudget()` et `plafondEffectifUsd` — une
      // SEULE source, jamais deux calculs indépendants qui pourraient diverger
      // sur ce qu'ils disent au lead. Consommé par `mcp-depense/serveur.ts`.
      budgetMaxUsdPropre: p.budgetMaxUsd > 0,
      model: modele,
      effortLevel: effort,
      configDir: compte.configDir,
      // `☠` L'IDENTITÉ du compte accompagne son chemin : c'est la seule des deux
      // qui traverse les machines. La machine de travail réécrit le chemin avec
      // le sien (H-44) — sans cet identifiant elle ne pourrait pas.
      compteId: compte.id,
    },
  };

  let resultatDemarrage: Awaited<ReturnType<DemarreurEquipe['demarrer']>>;
  try {
    resultatDemarrage = await deps.demarreur.demarrer(demande);
  } catch (erreur) {
    // `☠` ROLLBACK. Panne mesurée en prod le 2026-08-01 : la mission est
    // inscrite AVANT le démarrage (à dessein — sinon un worker vivant serait
    // inconnu du Pi, panne #11), mais rien ne la retirait quand le démarrage
    // échouait. Elle restait donc `planifiee`, donc ACTIVE au sens de H-56, et
    // occupait le projet POUR TOUJOURS : le second clic de l'opérateur se
    // heurtait à « une équipe est déjà active sur ce projet » devant un parc
    // vide. Un échec doit rendre le projet, sinon le premier raté le condamne.
    deps.registre.etats.appliquerEtatHarness(missionId, 'echec_definitif', {
      raisonTerminale: 'demarrage_refuse',
      motif: erreur instanceof Error ? erreur.message.slice(0, 300) : String(erreur),
    });
    log.error({ err: erreur, missionId, projet: p.projet }, 'démarrage refusé — mission close, projet libéré');
    throw erreur;
  }
  // `☠` Le worktree RÉELLEMENT alloué côté PC (chemin, branche dédiée) peut
  // différer du `cwd` provisoire écrit plus haut — mis à jour ici, une fois connu.
  if (resultatDemarrage.worktree !== undefined) {
    deps.registre.missions.definirWorktree(
      missionId,
      resultatDemarrage.worktree.chemin,
      resultatDemarrage.worktree.branche,
    );
  }
  // `☠` L'état n'est avancé qu'APRÈS un démarrage confirmé : une mission laissée
  // `planifiee` alors que le worker tourne serait une équipe fantôme, et
  // l'inverse ferait croire à une équipe vivante qui n'existe pas.
  deps.registre.etats.appliquerEtatHarness(missionId, 'en_cours', { motif: 'mandat autorisé par l’opérateur' });
  log.info({ missionId, projet: p.projet, compteId: compte.id }, 'équipe démarrée après autorisation humaine (H-61)');
  return { missionId, detail: resultatDemarrage.detail };
}
