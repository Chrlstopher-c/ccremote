// Responsabilité : le câblage des machines d'un nœud (pause, état de la machine, actions de chef) à partir des options
// de la fédération. Chaque pièce vit dans son module ; ce fichier ne fait que les relier.
import { join } from 'node:path';
import type { ActionNoeud, EtatNoeud, OrdreSigne } from '../../commun/federation.ts';
import { ActionsNoeud } from './actions-noeud.ts';
import type { Echanges } from './echanges.ts';
import type { OptionsFederation } from './etat-federation.ts';
import { EtatsNoeud } from './etat-noeud-echange.ts';
import { mesurerEtatNoeud } from './etat-noeud.ts';
import { PauseNoeud } from './pause-noeud.ts';

export interface MachinesNoeud {
  readonly pause: PauseNoeud;
  readonly etats: EtatsNoeud;
  readonly actions: ActionsNoeud;
  /** L'état de cette machine, mesuré à la demande. */
  readonly mesurer: () => Promise<EtatNoeud>;
}

export interface DependancesMachines {
  readonly options: OptionsFederation;
  readonly echanges: Echanges;
  readonly machineDe: (membre: string) => string | null;
  readonly verifierOrdre: (ordre: OrdreSigne, action: ActionNoeud) => Promise<boolean>;
}

export function creerMachinesNoeud(d: DependancesMachines): MachinesNoeud {
  const { options, machineDe } = d;
  const journal = options.journal;
  const pause = new PauseNoeud(join(options.dossierSecrets, 'federation'), journal.child({ domaine: 'pause' }));
  const mesurer = (): Promise<EtatNoeud> =>
    mesurerEtatNoeud({
      journal: journal.child({ domaine: 'etat-noeud' }),
      pause: () => pause.enPause(),
      comptes: () => options.registre.machines().find((m) => m.id === options.machine)?.comptes ?? [],
      compteChoisi: options.compteChoisi,
      fonctions: options.fonctions,
      nvidiaSmi: options.commandes?.nvidiaSmi,
      reseau: options.reseauLocal,
    });
  return {
    pause,
    etats: new EtatsNoeud({
      mesurer,
      reseaux: options.reseaux,
      machineDe,
      journal: journal.child({ domaine: 'etat-noeud' }),
    }),
    actions: new ActionsNoeud({
      pause,
      commandes: options.commandes,
      estChef: options.estChef ?? (() => false),
      verifierOrdre: d.verifierOrdre,
      echanges: d.echanges,
      machineDe,
      reveil: options.reveil ?? null,
      postesEnLigne: options.postesEnLigne ?? (() => []),
      journal: journal.child({ domaine: 'actions-noeud' }),
    }),
    mesurer,
  };
}
