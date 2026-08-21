/**
 * Responsabilité : groupe « historique des fils » — l'orchestrateur relit les
 * conversations déjà enregistrées au registre, la sienne comme les autres.
 * Lecture SEULE (A.2.2, `readOnlyHint`) : délègue à `registre.filsHistorique`
 * (`control-plane/registre/fils-historique.ts`), qui n'exécute que des `SELECT`.
 *
 * `☠` Contrairement à `outils-fil.ts` (qui n'agit que sur LE fil appelant, via
 * la closure du serveur), ces deux outils prennent un identifiant de fil en
 * paramètre : relire un fil ARCHIVÉ ou celui d'une autre session est le but
 * même de cet outillage, pas une fuite à colmater.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import { ErreurInstantInvalide, instantLisible, normaliserInstant } from '../../autonomie/index.ts';
import type { EvenementConversation, Registre, ResumeFil } from '../../registre/index.ts';
import { applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

/** Bornes de `lister_fils` : assez pour balayer un historique sans noyer le contexte. */
export const LISTE_FILS_DEFAUT = 20;
export const LISTE_FILS_MAX = 100;

/** Bornes de `lire_fil` : mêmes ordres de grandeur que `suivre_equipe` (outils-inspection.ts). */
export const LECTURE_FIL_DEFAUT = 50;
export const LECTURE_FIL_MAX = 200;

/** Un message affiché entier au-delà de cette taille noierait la page dans un seul événement. */
const CONTENU_TRONQUE = 500;

type Verdict<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly raison: string };

/**
 * Normalise et valide une plage de dates AVANT toute lecture. `☠` Réutilise
 * `normaliserInstant` du domaine autonomie — MÊME grammaire que
 * `demander_fenetre_autonomie` (« maintenant », « +8h », ISO avec heure) :
 * l'orchestrateur n'a qu'une seule syntaxe de date à connaître dans tout le
 * serveur de contrôle.
 */
function resoudreBornes(
  depuisBrut: string | undefined,
  jusquaBrut: string | undefined,
  maintenant: number,
): Verdict<{ debut: number; fin: number }> {
  try {
    const debut = depuisBrut === undefined ? 0 : normaliserInstant(depuisBrut, maintenant);
    const fin = jusquaBrut === undefined ? maintenant : normaliserInstant(jusquaBrut, maintenant);
    if (debut > fin) {
      return {
        ok: false,
        raison: `« ${depuisBrut ?? '(début)'} » est postérieur à « ${jusquaBrut ?? '(fin)'} » : la plage est vide.`,
      };
    }
    return { ok: true, valeur: { debut, fin } };
  } catch (erreur) {
    if (erreur instanceof ErreurInstantInvalide) return { ok: false, raison: erreur.message };
    throw erreur;
  }
}

function borner(valeur: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(valeur), min), max);
}

function resumerFil(f: ResumeFil): string {
  return (
    `${f.id} · « ${f.titre} » · ${f.nombreMessages} message(s) · ` +
    `du ${instantLisible(f.premierEvenementA)} au ${instantLisible(f.dernierEvenementA)}`
  );
}

/**
 * `lister_fils` — les fils enregistrés, filtrables par plage de dates.
 *
 * `☠` Le filtre décide QUELS fils apparaissent (au moins un événement dans la
 * plage), jamais ce qu'on affiche d'eux : les dates et le compte rendus par
 * `resumerFil` portent sur le fil ENTIER (voir `fils-historique.ts`). Un fil
 * ouvert avant la plage et toujours actif après doit rester lisible en un
 * coup d'œil, pas tronqué à la fenêtre demandée.
 */
export function listerFils(
  registre: Registre,
  depuisBrut?: string,
  jusquaBrut?: string,
  limiteBrute?: number,
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = 'lister les fils enregistrés';
  try {
    const bornes = resoudreBornes(depuisBrut, jusquaBrut, maintenant);
    if (!bornes.ok) return refuse(intention, bornes.raison);
    const limite = borner(limiteBrute ?? LISTE_FILS_DEFAUT, 1, LISTE_FILS_MAX);
    const fils = registre.filsHistorique.lister({ depuis: bornes.valeur.debut, jusqua: bornes.valeur.fin, limite });
    if (fils.length === 0) return applique(intention, 'aucun fil ne correspond à cette plage.');
    const entete = `${fils.length} fil(s) rendu(s), jusqu’à ${limite} demandé(s).`;
    return applique(intention, [entete, ...fils.map(resumerFil)].join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur, depuisBrut, jusquaBrut }, 'listerFils en échec');
    return echecInattendu(intention, erreur);
  }
}

/** Émetteur lisible d'un événement — pas le type SQL brut. */
function emetteurEvenement(type: string): string {
  if (type === 'operateur') return 'Chris';
  if (type === 'notification') return 'notification';
  return 'orchestrateur';
}

function resumerEvenement(e: EvenementConversation): string {
  const texte = e.contenu.length > CONTENU_TRONQUE ? `${e.contenu.slice(0, CONTENU_TRONQUE)}…` : e.contenu;
  const propre = texte.replace(/\s+/g, ' ').trim();
  return `[${instantLisible(e.creeA)}] ${emetteurEvenement(e.type)} (${e.type}) — ${propre}`;
}

export interface OptionsLireFil {
  readonly depuis?: string;
  readonly jusqua?: string;
  readonly recherche?: string;
  readonly decalage?: number;
  readonly limite?: number;
}

/**
 * `lire_fil` — le contenu d'un fil, chronologique, paginé.
 *
 * `☠` Un fil inexistant est un REFUS nommé, jamais une page vide : les deux se
 * confondraient sinon avec « ce fil existe mais ce filtre ne trouve rien ».
 */
export function lireFil(
  registre: Registre,
  filId: string,
  options: OptionsLireFil = {},
  maintenant: number = Date.now(),
): ContratRetour {
  const intention = `lire le fil ${filId}`;
  try {
    const conv = registre.conversations.lire(filId);
    if (conv === null) return refuse(intention, `aucun fil ne correspond à l’identifiant « ${filId} ».`);

    const bornes = resoudreBornes(options.depuis, options.jusqua, maintenant);
    if (!bornes.ok) return refuse(intention, bornes.raison);

    const decalage = Math.max(Math.trunc(options.decalage ?? 0), 0);
    const limite = borner(options.limite ?? LECTURE_FIL_DEFAUT, 1, LECTURE_FIL_MAX);
    const recherche = options.recherche?.trim();

    const page = registre.filsHistorique.evenements(filId, {
      depuis: bornes.valeur.debut,
      jusqua: bornes.valeur.fin,
      recherche: recherche === undefined || recherche.length === 0 ? null : recherche,
      decalage,
      limite,
    });

    if (page.total === 0) {
      return applique(intention, `« ${conv.titre} » — aucun message ne correspond à ce filtre.`);
    }

    const reste = page.total - decalage - page.evenements.length;
    const entete =
      `« ${conv.titre} » · ${page.evenements.length} message(s) rendu(s) sur ${page.total} correspondant(s)` +
      (reste > 0 ? ` (+${reste} au-delà — augmente \`decalage\` pour continuer)` : '');
    return applique(intention, [entete, ...page.evenements.map(resumerEvenement)].join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur, filId }, 'lireFil en échec');
    return echecInattendu(intention, erreur);
  }
}
