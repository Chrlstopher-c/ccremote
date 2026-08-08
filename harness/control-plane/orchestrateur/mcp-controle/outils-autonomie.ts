/**
 * Responsabilité : groupe « autonomie » de la surface d'outils — l'orchestrateur
 * pilote la fenêtre d'autonomie de SON fil (migration 15).
 *
 * `☠` LA LIGNE DE PARTAGE, et elle n'est pas négociable : une fenêtre est
 * exactement ce qui le dispense de demander l'autorisation. Se l'accorder seul
 * reviendrait à lui donner la clé de sa propre laisse, et aucun garde-fou en
 * aval ne rattraperait ça — le plafond de parc borne la dépense, pas le droit
 * de lancer. Donc :
 *   · RESSERRER (avancer la fin, préciser l'objectif, baisser le plafond) et
 *     TERMINER → direct, sans clic : ces gestes lui retirent du pouvoir ;
 *   · OUVRIR ou ÉLARGIR → une demande écrite dans `demande_rallonge`, que Chris
 *     tranche d'un clic (`POST /orchestrator/rallonges/:id/approve`).
 *
 * `☠` La garde porte sur la VALEUR comparée à l'existant (`natureFin`,
 * `naturePlafond`), jamais sur le nom de l'outil appelé. Une garde qui ferait
 * confiance à « ajuster ne peut qu'ajuster » se contournerait en une ligne de
 * prompt : il suffirait d'appeler `ajuster_autonomie` avec une fin plus
 * lointaine. Ici, `ajuster_autonomie` refuse une extension et nomme la valeur
 * maximale acceptable — l'appelant est un modèle, un refus nu le fait réémettre
 * la même valeur au tour suivant.
 *
 * `☠` Borné à LA conversation appelante, même garde que `outils-fil.ts` :
 * `conversationId` vient de la closure du serveur, jamais d'un paramètre.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import { randomUUID } from 'node:crypto';
import {
  ErreurFenetreInvalide,
  ErreurInstantInvalide,
  ErreurPlafondInvalide,
  decrirePlafond,
  instantLisible,
  natureFin,
  naturePlafond,
  normaliserInstant,
  normaliserReglagePlafond,
  plafondEffectif,
  validerFenetre,
  type Fenetre,
  type ReglagePlafond,
} from '../../autonomie/index.ts';
import type { Conversation, Registre } from '../../registre/index.ts';
import { applique, differe, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

const SANS_FIL = 'cette session n’est rattachée à aucune conversation : il n’y a aucune autonomie à piloter';
const SANS_FENETRE =
  'aucune fenêtre d’autonomie n’est posée sur ce fil. Ouvrir une plage est une EXTENSION de ton ' +
  'pouvoir : passe par `demander_fenetre_autonomie`, Chris tranche.';

type Verdict<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly raison: string };

/** Résout le fil appelant. Toute absence est un refus nommé, jamais un silence. */
function lireFil(registre: Registre, conversationId: string | null): Verdict<Conversation> {
  if (conversationId === null) return { ok: false, raison: SANS_FIL };
  const conv = registre.conversations.lire(conversationId);
  if (conv === null) return { ok: false, raison: `conversation « ${conversationId} » introuvable au registre` };
  return { ok: true, valeur: conv };
}

/**
 * Normalise et valide une plage AVANT toute écriture. `☠` Les deux erreurs du
 * domaine portent déjà les formes acceptées et les bornes : on les rend telles
 * quelles plutôt que d'en réécrire une version qui divergerait.
 */
function bornesValides(debutBrut: string, finBrut: string, maintenant: number): Verdict<Fenetre> {
  try {
    const debut = normaliserInstant(debutBrut, maintenant);
    const fin = normaliserInstant(finBrut, maintenant);
    return { ok: true, valeur: validerFenetre(debut, fin, maintenant) };
  } catch (erreur) {
    if (erreur instanceof ErreurInstantInvalide || erreur instanceof ErreurFenetreInvalide) {
      return { ok: false, raison: erreur.message };
    }
    throw erreur;
  }
}

/**
 * Ouvre ou prolonge la fenêtre — par une DEMANDE, jamais par une écriture.
 *
 * `☠` Rien n'est appliqué ici : ni `poserFenetreAutonomie`, ni quoi que ce soit
 * d'autre. Seul le clic de Chris applique, par le même chemin que les rallonges
 * de plafond (`assembler-control-plane.ts`).
 */
export function demanderFenetreAutonomie(
  registre: Registre,
  conversationId: string | null,
  finBrut: string,
  objectif: string,
  debutBrut: string = 'maintenant',
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = `demander une fenêtre d'autonomie jusqu'à « ${finBrut} »`;
  try {
    const fil = lireFil(registre, conversationId);
    if (!fil.ok) return refuse(intention, fil.raison);
    const bornes = bornesValides(debutBrut, finBrut, maintenant);
    if (!bornes.ok) return refuse(intention, bornes.raison);

    const refusMetier = refusDemandeFenetre(registre, fil.valeur, bornes.valeur);
    if (refusMetier !== null) return refuse(intention, refusMetier);
    return deposerDemandeFenetre(registre, fil.valeur.id, bornes.valeur, objectif, maintenant, intention);
  } catch (erreur) {
    journal.error({ err: erreur, conversationId, finBrut }, 'demanderFenetreAutonomie en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * Écrit la demande. `☠` `motif` reçoit l'objectif tel quel : c'est le seul texte
 * que Chris lit pour décider, et lui demander deux rédactions voisines
 * produirait un motif bâclé sur la carte qui porte le clic.
 */
function deposerDemandeFenetre(
  registre: Registre,
  conversationId: string,
  bornes: Fenetre,
  objectif: string,
  maintenant: number,
  intention: string,
): ContratRetour {
  const demande = registre.rallonges.creer(
    {
      id: randomUUID(),
      conversationId,
      plafondDemande: null,
      fenetreDebut: bornes.debut,
      fenetreFin: bornes.fin,
      fenetreObjectif: objectif,
      motif: objectif,
    },
    maintenant,
  );
  journal.info({ conversationId, demandeId: demande.id, ...bornes }, 'fenêtre d’autonomie demandée');
  return differe(
    intention,
    demande.id,
    `demande transmise à Chris : plage du ${instantLisible(bornes.debut)} au ` +
      `${instantLisible(bornes.fin)}. RIEN n’est ouvert tant qu’il n’a pas cliqué — ` +
      'ton autonomie actuelle reste celle en vigueur, continue avec elle.',
  );
}

/** Les deux refus métier d'une demande de fenêtre. `null` ⇒ la demande passe. */
function refusDemandeFenetre(registre: Registre, conv: Conversation, voulue: Fenetre): string | null {
  if (natureFin(conv.autonomieFin, voulue.fin) === 'restriction') {
    return (
      `cette plage RESSERRE ta fenêtre (fin actuelle ${instantLisible(conv.autonomieFin ?? 0)}) : ` +
      'elle ne demande rien à Chris. Applique-la toi-même avec `ajuster_autonomie`, sans clic.'
    );
  }
  // `☠` Une demande déjà en attente sur CE fil bloque la suivante : sans cette
  // garde, l'orchestrateur empilerait dix demandes pour le même besoin et Chris
  // trierait un doublon pour chaque clic utile.
  const dejaEnAttente = registre.rallonges.enAttente(conv.id);
  if (dejaEnAttente.length > 0) {
    return (
      `une demande attend déjà la décision de Chris sur ce fil (${dejaEnAttente[0]?.id}) — ` +
      'attends sa réponse plutôt que d’en poser une seconde.'
    );
  }
  return null;
}

export interface AjustementAutonomie {
  /** Nouvelle échéance, strictement plus proche que l'actuelle. */
  readonly fin?: string;
  /** Nouvelle consigne pour la plage en cours. Aucune borne : préciser ne donne aucun pouvoir. */
  readonly objectif?: string;
  /** Nouveau plafond, strictement plus bas que l'effectif en vigueur. */
  readonly plafond?: string;
}

/** Ce qu'un ajustement va écrire, une fois toutes les gardes passées. */
interface EcrituresAjustement {
  fin: number | null;
  objectif: string | null;
  plafond: ReglagePlafond | null;
  effets: string[];
}

/**
 * Resserre l'autonomie du fil, sans clic. Chaque volet est gardé sur sa VALEUR :
 * un volet qui élargit fait refuser l'appel ENTIER, avant toute écriture — un
 * ajustement à moitié appliqué laisserait un état que personne n'a décidé.
 */
export function ajusterAutonomie(
  registre: Registre,
  conversationId: string | null,
  plafondParcDefaut: number | null,
  ajustement: AjustementAutonomie,
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = 'ajuster mon autonomie';
  try {
    const fil = lireFil(registre, conversationId);
    if (!fil.ok) return refuse(intention, fil.raison);
    if (ajustement.fin === undefined && ajustement.objectif === undefined && ajustement.plafond === undefined) {
      return refuse(intention, 'rien à ajuster : donne au moins `fin`, `objectif` ou `plafond`.');
    }
    const prevu = preparerAjustement(fil.valeur, plafondParcDefaut, ajustement, maintenant);
    if (!prevu.ok) return refuse(intention, prevu.raison);

    appliquerAjustement(registre, fil.valeur, prevu.valeur);
    journal.info({ conversationId, effets: prevu.valeur.effets }, 'autonomie resserrée par l’orchestrateur');
    return applique(intention, prevu.valeur.effets.join(' '));
  } catch (erreur) {
    journal.error({ err: erreur, conversationId }, 'ajusterAutonomie en échec');
    return echecInattendu(intention, erreur);
  }
}

/** Volet « objectif » — aucune borne : préciser une consigne ne donne aucun pouvoir. */
function preparerObjectif(conv: Conversation, objectif: string, prevu: EcrituresAjustement): string | null {
  if (conv.autonomieFin === null) return SANS_FENETRE;
  prevu.objectif = objectif;
  prevu.effets.push(`Objectif de la plage remplacé par « ${objectif} ».`);
  return null;
}

/**
 * Volet « échéance » — refus nommé, ou écriture à poser.
 *
 * `☠` Les bornes de DURÉE (`validerFenetre`) ne s'appliquent PAS ici : elles
 * gardent l'OUVERTURE d'une plage, pas son raccourcissement. Les appliquer
 * ferait refuser le resserrement d'une fenêtre longue posée à la main —
 * c'est-à-dire refuser le seul geste qui la ramènerait dans les clous.
 */
function preparerFin(
  conv: Conversation,
  finBrut: string,
  prevu: EcrituresAjustement,
  maintenant: number,
): string | null {
  if (conv.autonomieDebut === null || conv.autonomieFin === null) return SANS_FENETRE;
  let fin: number;
  try {
    fin = normaliserInstant(finBrut, maintenant);
  } catch (erreur) {
    if (erreur instanceof ErreurInstantInvalide) return erreur.message;
    throw erreur;
  }
  if (fin <= maintenant || fin <= conv.autonomieDebut) {
    return (
      `« ${finBrut} » (${instantLisible(fin)}) est déjà passé, ou précède le début de la plage ` +
      `(${instantLisible(conv.autonomieDebut)}) : pour fermer la fenêtre tout de suite, ` +
      'appelle `terminer_autonomie`.'
    );
  }
  if (natureFin(conv.autonomieFin, fin) !== 'restriction') {
    return (
      `« ${finBrut} » ne resserre rien : ta fenêtre finit déjà le ${instantLisible(conv.autonomieFin)}. ` +
      "Sans clic, tu ne peux poser qu'une fin STRICTEMENT antérieure à cet instant. Pour la " +
      'repousser, passe par `demander_fenetre_autonomie`.'
    );
  }
  prevu.fin = fin;
  prevu.effets.push(`Fenêtre avancée au ${instantLisible(fin)}.`);
  return null;
}

/** Volet « plafond » d'un ajustement — refus nommé, ou écriture à poser. */
function preparerPlafond(
  conv: Conversation,
  plafondParcDefaut: number | null,
  brut: string,
  prevu: EcrituresAjustement,
): string | null {
  let voulu: ReglagePlafond;
  try {
    voulu = normaliserReglagePlafond(brut);
  } catch (erreur) {
    if (erreur instanceof ErreurPlafondInvalide) return erreur.message;
    throw erreur;
  }
  const effectif = plafondEffectif(conv.plafondAutonomie, plafondParcDefaut);
  const nature = naturePlafond(effectif, voulu);
  if (nature !== 'restriction') {
    return (
      `« ${brut} » ne baisse pas ton plafond : il est actuellement de ${decrirePlafond(effectif)}. ` +
      (effectif === null
        ? 'Il est déjà illimité — il n’y a rien en dessous à poser sans clic.'
        : `Sans clic, tu ne peux poser qu'un entier strictement inférieur à ${effectif}. `) +
      'Pour le relever, passe par `demander_rallonge_autonomie`.'
    );
  }
  prevu.plafond = voulu;
  prevu.effets.push(`Plafond abaissé à ${decrirePlafond(plafondEffectif(voulu, plafondParcDefaut))}.`);
  return null;
}

/** Assemble les deux volets. `☠` Aucune écriture ici : tout est refusé d'abord. */
function preparerAjustement(
  conv: Conversation,
  plafondParcDefaut: number | null,
  ajustement: AjustementAutonomie,
  maintenant: number,
): Verdict<EcrituresAjustement> {
  const prevu: EcrituresAjustement = { fin: null, objectif: null, plafond: null, effets: [] };
  const refus =
    (ajustement.objectif === undefined ? null : preparerObjectif(conv, ajustement.objectif, prevu)) ??
    (ajustement.fin === undefined ? null : preparerFin(conv, ajustement.fin, prevu, maintenant)) ??
    (ajustement.plafond === undefined ? null : preparerPlafond(conv, plafondParcDefaut, ajustement.plafond, prevu));
  return refus === null ? { ok: true, valeur: prevu } : { ok: false, raison: refus };
}

/**
 * `☠` La fenêtre se réécrit ENTIÈRE (`poserFenetreAutonomie` prend les trois
 * champs et les traite comme un bloc) : les valeurs non touchées sont relues du
 * fil, jamais laissées à `null`, sinon resserrer l'échéance effacerait
 * l'objectif que Chris avait confié.
 */
function appliquerAjustement(registre: Registre, conv: Conversation, prevu: EcrituresAjustement): void {
  if (prevu.fin !== null || prevu.objectif !== null) {
    registre.conversations.poserFenetreAutonomie(
      conv.id,
      conv.autonomieDebut,
      prevu.fin ?? conv.autonomieFin,
      prevu.objectif ?? conv.autonomieObjectif,
    );
  }
  if (prevu.plafond !== null) registre.conversations.reglerPlafondAutonomie(conv.id, prevu.plafond);
}

/**
 * Ferme la fenêtre, sans clic. Le fil repasse par la règle du premier clic —
 * c'est une reddition de pouvoir, elle ne peut pas mal tourner.
 */
export function terminerAutonomie(
  registre: Registre,
  conversationId: string | null,
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = 'terminer ma fenêtre d’autonomie';
  try {
    const fil = lireFil(registre, conversationId);
    if (!fil.ok) return refuse(intention, fil.raison);
    const conv = fil.valeur;
    // `☠` Refus et non succès muet : rendre `applique` sur un non-geste ferait
    // rapporter à Chris « fenêtre fermée » alors qu'il n'y en avait aucune.
    if (conv.autonomieDebut === null || conv.autonomieFin === null) {
      return refuse(intention, 'aucune fenêtre d’autonomie n’est posée sur ce fil : il n’y a rien à fermer.');
    }
    registre.conversations.poserFenetreAutonomie(conv.id, null, null, null);
    journal.info({ conversationId, finPrevue: conv.autonomieFin, maintenant }, 'fenêtre d’autonomie terminée');
    return applique(
      intention,
      `Fenêtre fermée (elle courait jusqu'au ${instantLisible(conv.autonomieFin)}). Tes prochains ` +
        'mandats repassent par la règle du premier clic, sauf si un mandat a déjà été autorisé ici.',
    );
  } catch (erreur) {
    journal.error({ err: erreur, conversationId }, 'terminerAutonomie en échec');
    return echecInattendu(intention, erreur);
  }
}
