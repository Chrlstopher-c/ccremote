/**
 * Responsabilité : groupe « inspection » de la surface d'outils (A.2.2) — lecture
 * seule, auto-approuvable (`readOnlyHint`). Délègue à E (registre) et F (projets).
 *
 * ☠ (d) Aucune fonction ici ne laisse une exception s'échapper : le registre
 * (E) rejette en `ErreurRegistre`, `chargerProjets` peut rejeter sur un
 * répertoire illisible — les deux sont interceptés, jamais relancés.
 */

import {
  InterrogateurGitReel,
  chargerProjets,
  type ConfigProjet,
  type InterrogateurGit,
  type ProjetRejete,
} from '../../../projets/index.ts';
import type { Mission, Registre } from '../../registre/index.ts';
import { applique, echecInattendu } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

function resumerMission(m: Mission): string {
  return `${m.id} · ${m.nom} · projet=${m.projet} · harness=${m.etatHarness} · sdk=${m.etatSdk ?? 'inconnu'}`;
}

/** Combien d'équipes terminées restent visibles à l'orchestrateur — les récentes suffisent. */
const TERMINEES_VISIBLES = 15;

/**
 * `☠` Une équipe TERMINÉE doit rester interrogeable. `lister_equipes` ne rendait
 * que `listerActives()` : à la seconde où une mission s'achevait, elle
 * disparaissait de tout ce que l'orchestrateur peut voir. Il répondait donc
 * « équipe introuvable » à l'opérateur qui venait de la voir finir sous ses yeux
 * — constaté le 23/07. Une équipe qui vient de se terminer est précisément celle
 * dont on veut le bilan.
 */
export type EtatListe = 'actives' | 'terminees' | 'toutes';
export type PorteeListe = 'fil' | 'parc';

export interface OptionsListe {
  readonly etat?: EtatListe;
  readonly portee?: PorteeListe;
  readonly limite?: number;
  /** Le fil qui appelle — sert la portée `fil`. Absent ⇒ portée `parc` forcée. */
  readonly conversationId?: string | null;
}

/**
 * `☠` Les équipes ACTIVES ne sont JAMAIS filtrées par fil, quelle que soit la
 * portée demandée — et ce n'est pas un oubli.
 *
 * Constat de Chris le 01/08 : « c'est une nouvelle discussion, c'est censé être
 * individuel ». Vrai pour l'HISTORIQUE, faux pour le vivant. Le parc est une
 * ressource partagée : H-56 n'autorise qu'une équipe active par projet, le
 * plafond de parc et la fenêtre de quota sont communs à tous les fils. Un
 * orchestrateur qui ne verrait pas l'équipe lancée depuis un AUTRE fil
 * proposerait un mandat sur un projet déjà occupé — refusé en 409 après coup,
 * ou pire, il conclurait que le projet est libre et le dirait à Chris.
 *
 * Le cloisonnement porte donc sur ce qui est du bruit (l'historique des autres
 * fils), jamais sur ce qui engage une décision (ce qui tourne en ce moment).
 */
function resumerCourt(m: Mission): string {
  // Nom tronqué : sur une liste, le mandat entier de quinze équipes est un pavé
  // que personne ne lit — et qui coûte du contexte à chaque appel.
  const nom = m.nom.length > 46 ? `${m.nom.slice(0, 46)}…` : m.nom;
  return `${m.id.slice(0, 8)} · ${nom} · ${m.projet.split('/').pop() ?? m.projet} · ${m.etatHarness}`;
}

export function listerEquipes(registre: Registre, options: OptionsListe = {}): ContratRetour {
  const etat = options.etat ?? 'toutes';
  const portee = options.conversationId == null ? 'parc' : (options.portee ?? 'fil');
  const limite = Math.min(Math.max(Math.trunc(options.limite ?? TERMINEES_VISIBLES), 1), 50);
  const intention = `lister les équipes (${etat}, ${portee})`;
  try {
    const recentes = registre.missions.listerRecentes(200);
    const actives = new Set(registre.missions.listerActives().map((m) => m.id));
    const parties: string[] = [];

    if (etat !== 'terminees') {
      // Toujours TOUT le parc — voir le commentaire ci-dessus.
      const vivantes = recentes.filter((m) => actives.has(m.id));
      parties.push(
        vivantes.length === 0
          ? 'aucune équipe active sur le parc'
          : `actives (tout le parc): ${vivantes.map(resumerMission).join(' | ')}`,
      );
    }

    if (etat !== 'actives') {
      const closes = recentes.filter((m) => !actives.has(m.id));
      const retenues = portee === 'fil' ? closes.filter((m) => m.conversationId === options.conversationId) : closes;
      const visibles = retenues.slice(0, limite);
      if (visibles.length === 0) {
        parties.push(
          portee === 'fil'
            ? 'aucune équipe terminée dans CE fil (portee="parc" pour voir tout l’historique)'
            : 'aucune équipe terminée',
        );
      } else {
        const cadre = portee === 'fil' ? 'terminées dans ce fil' : 'terminées (tout le parc)';
        const reste = retenues.length > visibles.length ? ` (+${retenues.length - visibles.length} plus anciennes)` : '';
        parties.push(`${cadre}: ${visibles.map(resumerCourt).join(' | ')}${reste}`);
      }
    }

    return applique(intention, parties.join(' — '));
  } catch (erreur) {
    journal.error({ err: erreur, etat, portee }, 'lister_equipes en échec');
    return echecInattendu(intention, erreur);
  }
}

export type ResolutionMission =
  | { readonly trouve: Mission }
  | { readonly ambigu: readonly Mission[] }
  | { readonly absent: true };

/**
 * Résout une désignation d'équipe : identifiant exact, sinon nom, sinon projet,
 * sinon fragment de l'un des trois.
 *
 * `☠` L'opérateur désigne une équipe par son NOM — c'est ce qu'il lit à l'écran.
 * N'accepter que l'identifiant obligeait l'orchestrateur à répondre
 * « introuvable » sur une équipe parfaitement existante (23/07). Une
 * correspondance ambiguë n'est jamais tranchée au hasard : on rend les
 * candidats, l'orchestrateur redemande.
 */
export function resoudreMission(registre: Registre, designation: string): ResolutionMission {
  const exact = registre.missions.lire(designation);
  if (exact !== null) return { trouve: exact };
  const aiguille = designation.trim().toLowerCase();
  if (aiguille.length === 0) return { absent: true };
  const candidats = registre.missions.listerRecentes(200);
  const parChamp = candidats.filter(
    (m) => m.nom.toLowerCase() === aiguille || m.projet.toLowerCase() === aiguille,
  );
  const retenus =
    parChamp.length > 0
      ? parChamp
      : candidats.filter(
          (m) =>
            m.id.toLowerCase().includes(aiguille) ||
            m.nom.toLowerCase().includes(aiguille) ||
            m.projet.toLowerCase().includes(aiguille),
        );
  if (retenus.length === 0) return { absent: true };
  // `listerRecentes` trie par activité décroissante : le premier est le plus récent.
  if (retenus.length === 1) return { trouve: retenus[0] as Mission };
  return { ambigu: retenus.slice(0, 10) };
}

/** `etat_equipe` (A.2.2) — détail d'une équipe : tâche, coût, contexte, capacités manquantes. */
export function etatEquipe(registre: Registre, designation: string): ContratRetour {
  const intention = `état de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if ('absent' in resolution) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    if ('ambigu' in resolution) {
      const listeCandidats = resolution.ambigu.map((m) => `${m.id} (${m.nom})`).join(' | ');
      return {
        ok: false,
        intention,
        effet: 'refuse',
        raison: `désignation ambiguë — préciser l'identifiant parmi : ${listeCandidats}`,
      };
    }
    const mission = resolution.trouve;
    const manquantes = registre.capacites.manquantesSurveillees(mission.id);
    const etat = [
      resumerMission(mission),
      resumerDepot(mission),
      `budget=${mission.budgetConsommeUsd}/${mission.budgetMaxUsd ?? '∞'} USD`,
      `contexte=${mission.contexteTokensUtilises ?? '?'}/${mission.contexteTokensMax ?? '?'}`,
      manquantes.length > 0 ? `capacités manquantes: ${manquantes.join(', ')}` : 'capacités surveillées toutes présentes',
    ].join(' · ');
    return applique(intention, etat);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'etat_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * L'état du dépôt tel que le dernier relevé l'a vu (migration 23).
 *
 * `☠` Trois valeurs distinctes, dont « jamais relevé » : le repli sur « propre »
 * est exactement ce qui faisait passer une équipe non commitée pour une équipe
 * qui a livré.
 */
function resumerDepot(mission: Mission): string {
  const constat = mission.constatGit;
  if (constat === null) return 'dépôt=non relevé';
  if (constat.fichiersModifies === 0) return `dépôt=propre (${constat.branche ?? 'branche inconnue'})`;
  return `dépôt=⚠ ${constat.fichiersModifies} fichier(s) NON COMMITÉ(S) sur ${constat.branche ?? 'branche inconnue'}`;
}

function resumerProjet(p: ConfigProjet): string {
  return `${p.id} (${p.isolationGarantie ? 'worktree' : 'dégradé — isolation NON garantie'})`;
}

function resumerRejet(r: ProjetRejete): string {
  return `${r.idPresume ?? r.fichierSource} rejeté: ${r.echecs.map((e) => e.code).join(', ')}`;
}

/**
 * `lister_projets` (A.2.2) — projets connus et leur worktree. Délègue à F.
 * `interrogateurGit` injectable pour le test, réel par défaut — même motif que
 * `DependancesChargeur` de `projets/chargeur-projets.ts`.
 */
export async function listerProjets(
  repertoireProjets: string,
  interrogateurGit: InterrogateurGit = new InterrogateurGitReel(),
): Promise<ContratRetour> {
  const intention = 'lister les projets connus';
  try {
    const resultat = await chargerProjets(repertoireProjets, { interrogateurGit });
    const parties = [
      resultat.projets.length === 0 ? 'aucun projet valide' : resultat.projets.map(resumerProjet).join(' | '),
      ...(resultat.rejetes.length > 0 ? [`rejetés: ${resultat.rejetes.map(resumerRejet).join(' | ')}`] : []),
    ];
    return applique(intention, parties.join(' — '));
  } catch (erreur) {
    journal.error({ err: erreur, repertoireProjets }, 'lister_projets en échec');
    return echecInattendu(intention, erreur);
  }
}

/** `historique_equipe` (A.2.2) — dernières transitions d'état, résumées (jamais le flux brut). */
export function historiqueEquipe(registre: Registre, designation: string, limite = 20): ContratRetour {
  const intention = `historique de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if (!('trouve' in resolution)) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    const missionId = resolution.trouve.id;
    const transitions = registre.etats.historique(missionId, limite);
    if (transitions.length === 0) return applique(intention, 'aucune transition connue');
    const resume = transitions
      .map((t) => `[${t.origine}] ${t.etatPrecedent ?? '∅'} → ${t.etatNouveau}${t.motif ? ` (${t.motif})` : ''}`)
      .join(' | ');
    return applique(intention, resume);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'historique_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `rapport_equipe` — ce que l'équipe a RÉELLEMENT écrit.
 *
 * `☠` H-45 interdit de déverser le flux brut d'un worker dans le contexte de
 * l'orchestrateur, et cet outil ne le fait pas : il rend les textes que le lead a
 * produits, déjà bornés à l'écriture, et seulement les derniers. Sans lui,
 * l'orchestrateur n'avait accès qu'aux états et compteurs — il pouvait dire
 * qu'une équipe avait fini, jamais ce qu'elle avait trouvé (constaté le 23/07).
 */
export function rapportEquipe(registre: Registre, designation: string): ContratRetour {
  const intention = `rapport de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if (!('trouve' in resolution)) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    const dernier = registre.missions.dernierTexte(resolution.trouve.id);
    if (dernier === null) {
      return applique(intention, "aucun texte produit n'a encore été rapatrié pour cette équipe");
    }
    // `☠` ENTIER, jamais tronqué : c'est la synthèse de fin de l'équipe. En
    // couper la moitié la rend inutilisable — décision de l'opérateur (23/07).
    return applique(intention, dernier.texte);
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'rapport_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}


/**
 * Combien de lignes du fil d'une équipe l'orchestrateur voit par défaut, et au
 * maximum.
 *
 * `☠` Les deux bornes ont la même raison d'être, opposée : son contexte est la
 * ressource la plus rare du harness — c'est le seul fil qui doit tenir une
 * fenêtre d'autonomie entière. Dix lignes suffisent à savoir où en est une
 * équipe ; deux cents lui laissent de quoi comprendre un dérapage sans devenir
 * lui-même le lecteur du transcript. Au-delà, ce n'est plus son rôle : c'est
 * celui de l'équipe, et lire à sa place le ferait compacter, donc oublier ce
 * qu'il surveillait.
 */
export const SUIVI_LIGNES_DEFAUT = 10;
export const SUIVI_LIGNES_MAX = 200;

/** Rend une ligne du fil lisible d'un coup d'œil, sans noyer le contexte. */
function resumerActivite(a: { texte: string; type: string; outil: string | null }): string {
  const marqueur = a.type === 'outil' ? `⚙ ${a.outil ?? 'outil'}` : a.type === 'reflexion' ? '…' : '›';
  // `☠` Tronqué ICI, et assumé : une ligne de fil n'est pas une synthèse. Le
  // rapport de fin, lui, n'est JAMAIS tronqué (`rapport_equipe`) — la
  // distinction est ce qui rend ce suivi consultable en continu.
  const texte = a.texte.length > 220 ? `${a.texte.slice(0, 220)}…` : a.texte;
  return `${marqueur} ${texte.replace(/\s+/g, ' ').trim()}`;
}

/**
 * Ce qu'une équipe est en train de faire, en direct.
 *
 * `☠` Comble le seul angle mort qui restait à l'orchestrateur : il pouvait lire
 * l'ÉTAT d'une équipe (compteurs, coût) et son RAPPORT de fin, mais rien entre
 * les deux. Une équipe partie de travers restait donc invisible jusqu'à sa
 * synthèse — trop tard pour la corriger d'un message, alors que `envoyer_a_equipe`
 * existe et n'interrompt même pas son tour.
 */
export function suivreEquipe(registre: Registre, designation: string, lignes?: number): ContratRetour {
  const intention = `suivi de ${designation}`;
  try {
    const resolution = resoudreMission(registre, designation);
    if (!('trouve' in resolution)) {
      return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe ne correspond à cette désignation' };
    }
    const mission = resolution.trouve;
    // Borné des deux côtés : une valeur absurde donne un résultat utile, jamais
    // un refus — un modèle qui demande 5000 lignes veut « le plus possible ».
    const demandees = Math.min(Math.max(Math.trunc(lignes ?? SUIVI_LIGNES_DEFAUT), 1), SUIVI_LIGNES_MAX);
    const activites = registre.missions.activites(mission.id, demandees);
    if (activites.length === 0) {
      return applique(intention, `${resumerMission(mission)} — aucune activité rapatriée pour le moment.`);
    }
    const entete =
      `${resumerMission(mission)} · ${activites.length} dernière(s) ligne(s) sur ${demandees} demandée(s)` +
      (demandees < SUIVI_LIGNES_MAX ? ` (jusqu'à ${SUIVI_LIGNES_MAX} disponibles)` : '');
    return applique(intention, [entete, ...activites.map(resumerActivite)].join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur, designation }, 'suivre_equipe en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * Suivi de PLUSIEURS équipes en un seul appel.
 *
 * `☠` Demandé par Chris le 01/08 sur un constat d'usage : l'orchestrateur se
 * posait des rappels toutes les 5 à 30 minutes pour aller regarder ses équipes
 * une par une. Le rappel n'était pas un contournement, c'était un COMBLEMENT —
 * son prompt lui dit de surveiller, jamais avec quelle cadence, et
 * `suivre_equipe` ne prend qu'une équipe. Trois équipes en vol coûtaient trois
 * appels, donc trois allers-retours de contexte.
 *
 * `☠` Le budget de lignes est RÉPARTI sur les équipes demandées, jamais multiplié
 * par leur nombre : lire quatre transcrits entiers saturerait le contexte de
 * l'orchestrateur, et un orchestrateur saturé oublie sa mission. Une équipe
 * introuvable ne fait pas échouer les autres — elle est signalée à sa ligne.
 */
export function suivreEquipes(registre: Registre, designations: readonly string[], lignes?: number): ContratRetour {
  const intention = `suivi de ${designations.length} équipe(s)`;
  if (designations.length === 0) {
    return { ok: false, intention, effet: 'refuse', raison: 'aucune équipe désignée' };
  }
  try {
    const total = Math.min(Math.max(Math.trunc(lignes ?? SUIVI_LIGNES_DEFAUT), 1), SUIVI_LIGNES_MAX);
    // Plancher de 3 : chaque équipe doit dire quelque chose, même quand on en
    // demande beaucoup d'un coup.
    const parEquipe = Math.max(3, Math.floor(total / designations.length));
    const blocs: string[] = [];
    for (const designation of designations) {
      const resolution = resoudreMission(registre, designation);
      if (!('trouve' in resolution)) {
        blocs.push(`— ${designation} : aucune équipe ne correspond à cette désignation.`);
        continue;
      }
      const mission = resolution.trouve;
      const activites = registre.missions.activites(mission.id, parEquipe);
      blocs.push(
        activites.length === 0
          ? `— ${resumerMission(mission)} — aucune activité rapatriée pour le moment.`
          : [`— ${resumerMission(mission)} · ${activites.length} ligne(s)`, ...activites.map(resumerActivite)].join('\n'),
      );
    }
    return applique(intention, blocs.join('\n\n'));
  } catch (erreur) {
    journal.error({ err: erreur, designations }, 'suivre_equipes en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * Ce que l'orchestrateur sait de sa propre autonomie.
 *
 * `☠` Il ne peut PAS le déduire : la fenêtre vit dans le registre, et son
 * système prompt est écrit une fois pour toutes. Sans cet outil, un orchestrateur
 * à qui Chris a confié une plage de huit heures l'ignore complètement — il
 * travaille comme si chaque mandat devait être validé, et perd la plage à
 * attendre. L'échéance est aussi ce qui le fait ARBITRER : lancer une équipe de
 * plus, ou consolider ce qui est déjà fait.
 */
export function autonomieDuFil(
  registre: Registre,
  conversationId: string | null,
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = 'état de mon autonomie';
  try {
    if (conversationId === null) {
      return applique(intention, "cette session n'est rattachée à aucune conversation : aucune autonomie déléguée.");
    }
    const conv = registre.conversations.lire(conversationId);
    if (conv === null) return applique(intention, 'conversation introuvable au registre.');

    const humain = registre.propositions.aApprobationHumaine(conversationId);
    const auto = registre.propositions.compterAutoApprouvees(conversationId, conv.autonomieDebut ?? 0);
    const lignes: string[] = [];

    if (conv.autonomieDebut !== null && conv.autonomieFin !== null) {
      const ouverte = maintenant >= conv.autonomieDebut && maintenant < conv.autonomieFin;
      const restantMin = Math.max(0, Math.round((conv.autonomieFin - maintenant) / 60_000));
      lignes.push(
        ouverte
          ? `Fenêtre d'autonomie OUVERTE jusqu'au ${new Date(conv.autonomieFin).toLocaleString('fr-FR')} ` +
              `— ${restantMin} min restantes. Tes mandats démarrent sans clic.`
          : maintenant < conv.autonomieDebut
            ? `Fenêtre d'autonomie PROGRAMMÉE à partir du ${new Date(conv.autonomieDebut).toLocaleString('fr-FR')}.`
            : `Fenêtre d'autonomie CLOSE depuis le ${new Date(conv.autonomieFin).toLocaleString('fr-FR')}.`,
      );
      if (conv.autonomieObjectif !== null) lignes.push(`Objectif confié pour cette plage : ${conv.autonomieObjectif}`);
    } else {
      lignes.push("Aucune fenêtre d'autonomie sur ce fil.");
    }

    lignes.push(
      humain
        ? `Chris a déjà autorisé un mandat ici : les suivants partent seuls (${auto} lancé(s) sans clic).`
        : "Aucun mandat encore autorisé ici : le prochain que tu proposes attendra son clic.",
    );
    return applique(intention, lignes.join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur, conversationId }, 'autonomieDuFil en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * Seuils d'utilisation à partir desquels le carburant change la conduite.
 *
 * `☠` En POURCENTAGE, jamais en dollars (H-70, mesuré) : sur abonnement, les
 * champs `*_dollars` de l'API d'usage sont `null`. Un arbitrage bâti dessus
 * verrait 0 % en permanence et laisserait saturer la fenêtre sans prévenir.
 */
const CARBURANT_TENDU_PCT = 75;
const CARBURANT_CRITIQUE_PCT = 90;

/** Délai relatif lisible — « 42 min », « 3 h 20 », « expirée ». */
function delaiLisible(resetMs: number | null, maintenant: number): string {
  if (resetMs === null) return 'reset inconnu';
  const restant = resetMs - maintenant;
  if (restant <= 0) return 'fenêtre expirée';
  const minutes = Math.round(restant / 60_000);
  if (minutes < 60) return `reset dans ${minutes} min`;
  return `reset dans ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * `☠` La CONSIGNE, pas seulement la mesure. Un pourcentage brut ne fait rien
 * changer à la conduite d'un modèle : il faut lui dire ce que ce chiffre
 * implique pour sa prochaine décision. C'est la différence entre une jauge et
 * un arbitrage.
 */
function conseilCarburant(pireUtil: number, compteSain: boolean): string {
  if (!compteSain) {
    return (
      'AUCUN compte disponible : tous saturés. Ne lance rien — un dispatch ' +
      "échouera ou basculera en surcoût payant. Attends le reset le plus proche, " +
      'et dis-le à Chris plutôt que de réessayer en boucle.'
    );
  }
  if (pireUtil >= CARBURANT_CRITIQUE_PCT) {
    return (
      `Carburant CRITIQUE (${pireUtil} %). Ne lance plus de nouvelle équipe : ` +
      'termine et consolide ce qui tourne. Une équipe démarrée maintenant sera ' +
      'coupée en cours de route, et une équipe coupée coûte tout ce qu’elle a ' +
      'consommé pour rien.'
    );
  }
  if (pireUtil >= CARBURANT_TENDU_PCT) {
    return (
      `Carburant TENDU (${pireUtil} %). Préfère un mandat court et bien borné à ` +
      'un gros chantier. Si l’objectif demande une grosse équipe, attends le reset ' +
      'et occupe la fenêtre avec un travail plus léger qui sert le même but.'
    );
  }
  return `Carburant CONFORTABLE (${pireUtil} %). Rien ne t’empêche de lancer.`;
}

/**
 * Où en est le carburant du parc — et ce que ça implique pour la suite.
 *
 * `☠` Sans cet outil, l'autonomie est aveugle : l'orchestrateur pouvait lancer
 * quarante équipes dans sa fenêtre sans jamais savoir qu'il était à 95 % de sa
 * fenêtre 5 h. Les données existaient (`balayage-quotas` tourne depuis le 23/07,
 * les jauges sont à l'écran) — il n'avait ni moyen de les lire ni raison de s'en
 * servir. Une mesure que personne ne consulte ne protège de rien.
 */
export function carburantParc(registre: Registre, maintenant: number = Date.now()): ContratRetour {
  const intention = 'état du carburant du parc';
  try {
    const comptes = registre.comptes.lister();
    if (comptes.length === 0) return applique(intention, 'aucun compte enregistré au registre.');

    const disponibles = new Set(registre.comptes.listerDisponibles(maintenant).map((c) => c.id));
    let pireUtil = 0;
    const lignes: string[] = [];

    for (const compte of comptes) {
      const quotas = registre.comptes.listerQuotas(compte.id);
      const cinqH = quotas.find((q) => q.typeFenetre === 'five_hour');
      const septJ = quotas.find((q) => q.typeFenetre === 'seven_day');
      const util = cinqH?.utilisation ?? null;
      if (util !== null && util > pireUtil && disponibles.has(compte.id)) pireUtil = util;
      const etat = disponibles.has(compte.id) ? 'disponible' : 'ÉCARTÉ (saturé)';
      const details = [
        `5 h : ${util === null ? 'non mesuré' : `${util} %`} · ${delaiLisible(cinqH?.resetA ?? null, maintenant)}`,
        `7 j : ${septJ?.utilisation === null || septJ === undefined ? 'non mesuré' : `${septJ.utilisation} %`}`,
      ];
      // `☠` Le surcoût est distinct du statut : `rejected` NE COUPE PAS la
      // session (H-63.1, mesuré), elle continue en `extra_usage` PAYANT. Taire
      // ce cas ferait dépenser de l'argent réel sans que personne ne le sache.
      if (cinqH?.utiliseOverage === true) details.push('⚠ EN SURCOÛT PAYANT');
      lignes.push(`${compte.id} — ${etat} · ${details.join(' · ')}`);
    }

    lignes.push('', conseilCarburant(pireUtil, disponibles.size > 0));
    return applique(intention, lignes.join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur }, 'carburantParc en échec');
    return echecInattendu(intention, erreur);
  }
}
