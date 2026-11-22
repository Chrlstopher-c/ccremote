// Responsabilité : appliquer au registre la règle « une conversation, une entrée » (doublons-conversation.ts).
// La fiche principale reçoit l'épinglage, la non-lecture et la catégorie des fiches masquées ; les fiches dont
// la vue change sont diffusées. Sans changement, rien n'est écrit ni diffusé : le rapprochement peut être
// relancé à chaque écriture.
import type { Logger } from 'pino';
import type { Diffusion } from '../clients/diffusion.ts';
import type { Registre } from '../registre/registre.ts';
import { type PlanDoublons, planDoublons } from './doublons-conversation.ts';

export class Doublons {
  constructor(
    private readonly registre: Registre,
    private readonly diffusion: Diffusion,
    private readonly journal: Logger,
  ) {}

  reconcilier(): void {
    try {
      const plan = planDoublons(this.registre.sessionsBrutes());
      const anciennes = this.registre.sessionsMasqueesCourantes();
      const touchees = new Set<string>();
      this.reporterEtats(plan, touchees);
      this.reporterCategories(plan);
      this.registre.definirSessionsMasquees(new Set(plan.masquees.keys()));
      for (const id of changementsDeMasque(anciennes, plan)) touchees.add(id);
      for (const id of touchees) this.publier(id);
    } catch (e) {
      this.journal.error({ erreur: String(e) }, 'doublons de conversation : rapprochement impossible');
    }
  }

  // Épinglage et non-lecture : la principale garde ceux d'une fiche masquée, la fiche masquée les perd.
  private reporterEtats(plan: PlanDoublons, touchees: Set<string>): void {
    for (const [masquee, principale] of plan.masquees) {
      const m = this.registre.session(masquee);
      const p = this.registre.session(principale);
      if (!m || !p) continue;
      const epinglee = m.epinglee === true || p.epinglee === true;
      const nonLue = m.nonLue === true || p.nonLue === true;
      if (p.epinglee !== epinglee || p.nonLue !== nonLue) touchees.add(principale);
      if (m.epinglee === true || m.nonLue === true) touchees.add(masquee);
      if (p.epinglee !== epinglee) this.registre.definirEpinglee(principale, epinglee);
      if (p.nonLue !== nonLue) this.registre.definirNonLue(principale, nonLue);
      if (m.epinglee === true) this.registre.definirEpinglee(masquee, false);
      if (m.nonLue === true) this.registre.definirNonLue(masquee, false);
    }
  }

  // Catégories : une fiche masquée est remplacée par sa principale (dans les deux sens, selon qui est principal).
  private reporterCategories(plan: PlanDoublons): void {
    const avant = this.registre.categories();
    const apres = avant.map((c) => ({ ...c, sessions: c.sessions.map((id) => plan.masquees.get(id) ?? id) }));
    if (JSON.stringify(avant) === JSON.stringify(apres)) return;
    this.registre.enregistrerCategories(apres);
  }

  private publier(id: string): void {
    const session = this.registre.session(id);
    if (session) this.diffusion.diffuser({ type: 'session', session });
  }
}

// Fiches dont le masquage a changé depuis le rapprochement précédent (masquées ou redevenues visibles).
function changementsDeMasque(anciennes: ReadonlySet<string>, plan: PlanDoublons): string[] {
  const toutes = new Set([...anciennes, ...plan.masquees.keys()]);
  return [...toutes].filter((id) => anciennes.has(id) !== plan.masquees.has(id));
}
