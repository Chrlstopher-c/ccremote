// Responsabilité : les actions de chef sur la machine d'un nœud — arrêter, pause, reprendre, redémarrer (exécutées ici,
// sur la machine), réveiller un pair. Une action reçue d'un pair n'est exécutée que s'il est chef dans la charte : la
// décision se prend sur ce nœud, jamais sur parole de l'aiguilleur.
import type { Logger } from 'pino';
import type { ActionNoeud, MessageChiffre, OrdreSigne } from '../../commun/federation.ts';
import { commandeExtinction } from '../../poste/parc/alimentation.ts';
import type { Reveil } from '../entretien/reveil.ts';
import type { CanalNoeud } from './canal.ts';
import type { Echanges } from './echanges.ts';
import type { CommandesNoeud } from './etat-federation.ts';
import { peutArreterCetteMachine } from './etat-noeud.ts';
import type { PauseNoeud } from './pause-noeud.ts';
import { echec, ok, type Resultat } from './resultat.ts';

export const ACTIONS_MACHINE = ['arreter', 'pause', 'reprendre', 'redemarrer', 'reveiller'] as const;
export type ActionMachine = (typeof ACTIONS_MACHINE)[number];

export const DELAI_ACTION_MS = 10_000;
const COMMANDE_REDEMARRAGE: readonly string[] = ['systemctl', '--user', 'restart', 'lanterne-noeud.service'];
/** Délai entre la réponse et le redémarrage : la réponse doit partir avant que le service ne tombe. */
const DELAI_REDEMARRAGE_MS = 500;

export interface DependancesActions {
  readonly pause: PauseNoeud;
  readonly commandes?: CommandesNoeud;
  readonly estChef: (membre: string) => boolean;
  /** Vrai si l'ordre signé vaut pour CE nœud (charte, cible, fraîcheur, pas rejoué) et porte `action`. */
  readonly verifierOrdre: (ordre: OrdreSigne, action: ActionNoeud) => Promise<boolean>;
  readonly echanges: Pick<Echanges, 'requeter' | 'reponse'>;
  readonly machineDe: (membre: string) => string | null;
  readonly reveil: Reveil | null;
  readonly postesEnLigne: () => string[];
  readonly journal: Logger;
  readonly delaiMs?: number;
}

type ActionRecue = Extract<MessageChiffre, { t: 'action_noeud' }>;

/** Lance une commande et attend sa fin : null si elle a réussi, sinon un motif lisible (rien du système ne sort). */
async function lancer(argv: readonly string[], journal: Logger): Promise<string | null> {
  try {
    const processus = Bun.spawn([...argv], { stdout: 'ignore', stderr: 'pipe' });
    const code = await processus.exited;
    if (code === 0) return null;
    journal.error({ commande: argv[0], code }, 'commande refusée par le système');
    return `commande refusée (code ${code})`;
  } catch (erreur) {
    journal.error({ err: erreur, commande: argv[0] }, 'commande impossible à lancer');
    return 'commande impossible à lancer';
  }
}

export class ActionsNoeud {
  private minuterie: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: DependancesActions) {}

  arreter(): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.minuterie = null;
  }

  /** Une action que Chris lance sur la machine de son appli : pas de charte à consulter. */
  executerLocale(action: ActionMachine): Promise<Resultat<null>> {
    if (action === 'reveiller') return Promise.resolve(echec(400, 'une machine ne se réveille pas elle-même'));
    return this.executer(action);
  }

  /** Une action reçue d'un pair : chef, ou porteuse d'un ordre signé valide pour ce nœud ; sinon refusée. */
  async recevoir(canal: CanalNoeud, m: ActionRecue): Promise<void> {
    if (!(await this.autoriserRecue(canal, m))) {
      this.d.echanges.reponse(canal, m.ref, false, 'action réservée aux chefs du réseau');
      return;
    }
    const r = await this.executer(m.action);
    this.d.echanges.reponse(canal, m.ref, r.ok, r.ok ? undefined : r.raison);
  }

  private async autoriserRecue(canal: CanalNoeud, m: ActionRecue): Promise<boolean> {
    if (this.d.estChef(canal.membre)) return true;
    return m.ordre !== undefined && (await this.d.verifierOrdre(m.ordre, m.action));
  }

  /** Envoie une action à un pair relié et rend son verdict ; rien ne revient à temps : 504. */
  async demander(canal: CanalNoeud, action: ActionNoeud, ordre?: OrdreSigne): Promise<Resultat<null>> {
    const construire = (ref: string): MessageChiffre => ({
      t: 'action_noeud',
      ref,
      action,
      ...(ordre ? { ordre } : {}),
    });
    const r = await this.d.echanges.requeter(canal, construire, this.d.delaiMs ?? DELAI_ACTION_MS);
    if (r === null) return echec(504, 'pas de réponse du nœud à temps');
    if (r.t !== 'reponse') return echec(502, 'réponse inattendue du nœud');
    return r.ok ? ok(null) : echec(403, r.raison ?? 'refusé par le nœud');
  }

  /** Réveil d'un pair : la MAC vient de son état reçu, l'envoi passe par le réveil existant. */
  async reveiller(membre: string): Promise<Resultat<null>> {
    const reveil = this.d.reveil;
    if (!reveil) return echec(503, 'réveil non branché sur ce nœud');
    const machine = this.d.machineDe(membre);
    if (!machine) return echec(409, 'machine du nœud inconnue');
    const r = await reveil.reveiller(machine, this.d.postesEnLigne());
    return r.ok ? ok(null) : echec(409, r.erreur ?? 'réveil impossible');
  }

  private async executer(action: ActionNoeud): Promise<Resultat<null>> {
    switch (action) {
      case 'pause':
        return this.mettre(true);
      case 'reprendre':
        return this.mettre(false);
      case 'arreter':
        return this.arreterMachine();
      case 'redemarrer':
        return this.redemarrer();
    }
  }

  private mettre(pause: boolean): Resultat<null> {
    return this.d.pause.mettreEnPause(pause) ? ok(null) : echec(500, 'drapeau de pause non sauvegardé');
  }

  private async arreterMachine(): Promise<Resultat<null>> {
    if (!peutArreterCetteMachine()) return echec(409, 'arrêt impossible sur cette machine');
    const motif = await lancer(this.d.commandes?.extinction ?? commandeExtinction(), this.d.journal);
    return motif === null ? ok(null) : echec(500, motif);
  }

  // Le redémarrage part après la réponse, en tâche de fond : le service qu'il relance peut être celui qui répond.
  private redemarrer(): Resultat<null> {
    if (process.env['LANTERNE_MOTEUR_AUTONOME'] !== '1') return echec(409, 'redémarrage réservé au mode autonome');
    const argv = this.d.commandes?.redemarrage ?? COMMANDE_REDEMARRAGE;
    this.arreter();
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      void lancer(argv, this.d.journal);
    }, DELAI_REDEMARRAGE_MS);
    return ok(null);
  }
}
