// Responsabilité : les machines du réseau vues de ce nœud — liste avec leur état et leur présence, action
// sur une machine (la nôtre, un réveil, ou une action relayée à un pair relié), et vérification des ordres
// signés du chef.
import { MEMBRE_MOI, type MachineReseau } from './etat-federation.ts';
import type { ActionMachine } from './actions-noeud.ts';
import { type ActionNoeud, type OrdreSigne } from '../../commun/federation.ts';
import { NoncesVus, verifierOrdre } from '../../commun/ordre-machine.ts';
import { echec, ok, type Resultat } from './resultat.ts';
import type { MachinesNoeud } from './machines-noeud.ts';
import type { PortNoeud } from './noeud-port.ts';

export class MachinesDuReseau {
  private readonly noncesOrdre = new NoncesVus();

  constructor(
    private readonly port: PortNoeud,
    private readonly machines: MachinesNoeud,
  ) {}

  /** Soi, puis chaque nœud apparié : son dernier état connu (null s'il n'en a jamais envoyé) et s'il est relié. */
  async machinesReseau(): Promise<MachineReseau[]> {
    const moi: MachineReseau = {
      membre: this.identifiantMoi(),
      nom: this.port.config()?.nom ?? this.port.options.machine,
      moi: true,
      enLigne: true,
      etat: await this.machines.mesurer(),
    };
    const pairs = this.port.pairs()
      .filter((p) => p.genre === 'noeud')
      .map((p): MachineReseau => ({
        membre: p.id,
        nom: p.nom,
        moi: false,
        enLigne: this.port.canaux.liaisonOuverteAvec(p.id) !== null,
        etat: this.machines.etats.de(p.id),
      }));
    return [moi, ...pairs];
  }

  /**
   * Une action sur une machine : la nôtre (exécutée ici), un réveil, ou une action relayée à un pair relié.
   * `ordre` : l'ordre signé par le téléphone chef, que le pair vérifiera dans sa propre charte.
   */
  async agirSurMachine(membre: string, action: ActionMachine, ordre?: OrdreSigne): Promise<Resultat<null>> {
    if (membre === MEMBRE_MOI || membre === this.port.identifiantProtocole()) {
      return this.machines.actions.executerLocale(action);
    }
    if (!this.port.estNoeud(membre)) return echec(404, 'nœud inconnu');
    if (action === 'reveiller') return this.machines.actions.reveiller(membre);
    const canal = this.port.canaux.liaisonOuverteAvec(membre);
    if (!canal) return echec(409, 'nœud hors ligne');
    return this.machines.actions.demander(canal, action, ordre);
  }

  /** Un ordre signé reçu d'un pair vaut ici si la charte locale le tient : cette cible, cette action, pas rejoué. */
  async ordreValide(ordre: OrdreSigne, action: ActionNoeud): Promise<boolean> {
    const moi = this.port.config()?.id;
    if (!moi) return false;
    const verdict = await verifierOrdre(this.port.charte.charte(), ordre, {
      cible: moi,
      maintenantMs: Date.now(),
      nonces: this.noncesOrdre,
    });
    if (!verdict.ok) {
      this.port.options.journal.warn({ motif: verdict.motif }, 'ordre de chef refusé');
      return false;
    }
    return verdict.ordre.action === action;
  }

  private identifiantMoi(): string {
    return this.port.identifiantProtocole() ?? MEMBRE_MOI;
  }

  /** L'identifiant de machine d'un nœud apparié (celui de son instantané), ou null tant qu'il n'est pas connu. */
  machineDe(membre: string): string | null {
    return this.port.distant.noeudsConnus().find((n) => n.membre === membre)?.machine ?? null;
  }
}
