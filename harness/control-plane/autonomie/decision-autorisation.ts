/**
 * Responsabilité : décider si un mandat proposé démarre seul ou attend un clic.
 * Pur, aucune I/O — toute la connaissance arrive en paramètre.
 *
 * `☠` Ce module remplace H-61 dans sa forme littérale (« chaque équipe exige un
 * clic »), et il faut être précis sur ce qui change : l'autorisation humaine
 * n'est pas supprimée, elle est DÉPLACÉE. Elle porte désormais sur une
 * conversation entière — le premier mandat validé à la main engage les suivants
 * — ou sur une fenêtre datée que Chris a ouverte lui-même. Dans les deux cas un
 * humain a dit oui, en connaissance de cause, avant que quoi que ce soit parte.
 *
 * Ce qui disparaît : l'idée qu'une autorisation ne vaut que pour une équipe.
 * Elle rendait le produit impossible — l'orchestrateur passait sa nuit à
 * attendre un clic devant un écran éteint.
 *
 * `☠` Trois bornes subsistent, et elles ne sont pas décoratives : sans elles,
 * une conversation engagée devient un droit de dispatch illimité, et une boucle
 * mal partie brûle le quota jusqu'au matin sans que personne ne l'arrête.
 *   1. le plafond d'auto-approbations (ci-dessous) ;
 *   2. le plafond de parc (H-58) et H-56, appliqués en amont, inchangés ;
 *   3. la fin de fenêtre, qui referme l'autonomie même si le compteur reste bas.
 */

/**
 * Combien d'équipes une conversation peut lancer sans qu'un humain reclique.
 *
 * `☠` Généreux VOLONTAIREMENT : la valeur n'est pas là pour rationner le travail
 * normal — une plage de huit heures peut légitimement enchaîner beaucoup
 * d'équipes — mais pour qu'une boucle pathologique s'arrête d'elle-même. Un
 * plafond serré serait plus « prudent » et plus nuisible : il transformerait
 * chaque nuit productive en attente, ce que ce module existe pour supprimer.
 */
export const AUTO_APPROBATIONS_MAX = 40;

export type ModeAutorisation = 'humain' | 'auto';

export interface DecisionAutorisation {
  readonly mode: ModeAutorisation;
  /** Phrase destinée à l'orchestrateur ET au journal — jamais un code. */
  readonly raison: string;
}

export interface ContexteAutorisation {
  /** Un humain a-t-il déjà approuvé un mandat dans CE fil ? */
  readonly approbationHumaineAnterieure: boolean;
  /** Mandats déjà partis seuls dans ce fil. */
  readonly autoApprouveesDeja: number;
  /** Bornes de la fenêtre d'autonomie du fil, `null` si aucune. */
  readonly fenetreDebut: number | null;
  readonly fenetreFin: number | null;
  readonly maintenant: number;
  /** Plafond effectif, injecté pour rester testable. */
  readonly plafond?: number;
}

/**
 * À partir de quel instant compter les mandats partis seuls dans un fil.
 *
 * `☠` LE POINT DU DÉFAUT (production, 07/08). Le refus de plafond dit à
 * l'orchestrateur « sa prochaine approbation manuelle relance le compteur ».
 * C'était faux : le comptage partait de `autonomieDebut` seul, qu'une
 * approbation humaine ne déplace pas. Après 40 équipes, `autoApprouveesDeja`
 * restait à 40 pour toujours — un clic de Chris ne changeait rien, `mon_autonomie`
 * annonçait le mur, et le fil était définitivement mort.
 *
 * Deux issues possibles : corriger le message, ou corriger le compteur. C'est le
 * COMPTEUR qui est corrigé, parce que le message décrivait le comportement
 * attendu — un humain qui reprend la main doit rouvrir l'autonomie, sinon
 * l'approbation manuelle ne sert plus à rien une fois le plafond touché, et
 * l'unique geste qui reste à Chris est de créer un autre fil.
 *
 * Le plus TARDIF des deux jalons gagne : une fenêtre ouverte après le dernier
 * clic ne doit pas ressusciter des auto-approbations que ce clic venait de
 * solder, et réciproquement. Aucun jalon ⇒ 0, c'est-à-dire toute la vie du fil.
 */
export function seuilComptageAutonomie(
  autonomieDebut: number | null,
  derniereApprobationHumaine: number | null,
): number {
  return Math.max(autonomieDebut ?? 0, derniereApprobationHumaine ?? 0);
}

/** La fenêtre est-elle ouverte à cet instant ? Bornes absentes ⇒ non. */
export function fenetreOuverte(ctx: ContexteAutorisation): boolean {
  if (ctx.fenetreDebut === null || ctx.fenetreFin === null) return false;
  return ctx.maintenant >= ctx.fenetreDebut && ctx.maintenant < ctx.fenetreFin;
}

/**
 * `☠` Ordre des règles VOLONTAIRE, et il compte : le plafond est vérifié AVANT
 * les raisons d'autoriser. Placé après, un fil engagé dépasserait sa borne à
 * chaque nouvelle raison trouvée — le plafond ne serait plus une limite, mais
 * une suggestion.
 */
export function deciderAutorisation(ctx: ContexteAutorisation): DecisionAutorisation {
  const plafond = ctx.plafond ?? AUTO_APPROBATIONS_MAX;

  if (ctx.autoApprouveesDeja >= plafond) {
    return {
      mode: 'humain',
      raison:
        `plafond d'autonomie atteint (${ctx.autoApprouveesDeja}/${plafond} équipes lancées sans clic) — ` +
        'ce mandat attend une autorisation humaine. Si le travail est légitime, dis-le à Chris : ' +
        'sa prochaine approbation manuelle relance le compteur.',
    };
  }

  if (fenetreOuverte(ctx)) {
    const restant = Math.max(0, Math.round(((ctx.fenetreFin ?? 0) - ctx.maintenant) / 60_000));
    return {
      mode: 'auto',
      raison:
        `fenêtre d'autonomie ouverte, ${restant} min avant l'échéance — l'équipe démarre sans attendre. ` +
        `(${ctx.autoApprouveesDeja + 1}/${plafond})`,
    };
  }

  if (ctx.approbationHumaineAnterieure) {
    return {
      mode: 'auto',
      raison:
        "Chris a déjà autorisé un mandat dans cette conversation : les suivants partent seuls. " +
        `(${ctx.autoApprouveesDeja + 1}/${plafond})`,
    };
  }

  return {
    mode: 'humain',
    raison:
      "premier mandat de cette conversation : Chris l'autorise à la main. Une fois qu'il aura " +
      'cliqué, les mandats suivants de ce fil démarreront sans lui redemander.',
  };
}
