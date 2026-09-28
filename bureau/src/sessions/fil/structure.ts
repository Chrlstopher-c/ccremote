// Responsabilité : structurer le fil brut d'une session — chaque résultat rejoint son outil, chaque sous-agent
// regroupe sous sa carte ce qu'il a fait. Pur, sans rendu.
import type { EvenementDate } from '../../../../commun/api-clients.ts';
import type { Evenement } from '../../../../commun/session.ts';

type De<T extends Evenement['type']> = Extract<Evenement, { type: T }>;

export interface ElementOutil { readonly genre: 'outil'; readonly seq: number; readonly ts: string; readonly outil: De<'outil'>; resultat: De<'resultat_outil'> | null }
export interface ElementSousAgent {
  readonly genre: 'sous_agent'; readonly seq: number; readonly ts: string; readonly agent: De<'sous_agent'>;
  readonly interieur: ElementInterne[]; resultat: De<'resultat_outil'> | null;
}
export type ElementInterne = ElementOutil | { readonly genre: 'texte'; readonly seq: number; readonly ts: string; readonly evt: De<'texte'> | De<'reflexion'> };
export type ElementFil =
  | ElementOutil
  | ElementSousAgent
  | { readonly genre: 'simple'; readonly seq: number; readonly ts: string; readonly evt: Evenement };

export function structurer(evts: readonly EvenementDate[]): ElementFil[] {
  const fil: ElementFil[] = [];
  const outils = new Map<string, ElementOutil | ElementSousAgent>();
  const agents = new Map<string, ElementSousAgent>();
  for (const { seq, ts, evt } of evts) {
    if (evt.type === 'tour_fini') continue;
    const agent = 'agent' in evt && evt.agent ? agents.get(evt.agent) : undefined;
    if (evt.type === 'resultat_outil') {
      const cible = outils.get(evt.outilId);
      // Un sous-agent en arrière-plan répond d'abord « lancé » : ce n'est pas sa fin, qui arrive plus tard.
      const accuse = cible?.genre === 'sous_agent' && evt.extrait.startsWith('Async agent launched');
      if (cible && !accuse) cible.resultat = evt;
      continue;
    }
    if (evt.type === 'outil') {
      const el: ElementOutil = { genre: 'outil', seq, ts, outil: evt, resultat: null };
      outils.set(evt.id, el);
      (agent ? agent.interieur : fil).push(el);
      continue;
    }
    if (evt.type === 'sous_agent') {
      const el: ElementSousAgent = { genre: 'sous_agent', seq, ts, agent: evt, interieur: [], resultat: null };
      outils.set(evt.id, el);
      agents.set(evt.id, el);
      fil.push(el);
      continue;
    }
    if (agent && (evt.type === 'texte' || evt.type === 'reflexion')) agent.interieur.push({ genre: 'texte', seq, ts, evt });
    else if (!('agent' in evt && evt.agent)) fil.push({ genre: 'simple', seq, ts, evt });
  }
  return fil;
}
