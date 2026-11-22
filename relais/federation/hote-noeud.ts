// Responsabilité : ce qui se passe sur un canal du nœud — ouvert, refusé, message reçu, fermé — et qui le
// traite (charte, appareils, admissions, appairage, machines, invités). Le canal lui-même reste dans
// `canaux.ts`.
import type { CanalNoeud } from './canal.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { verdictSource, type VerdictSource } from './admissions.ts';
import type { Echanges } from './echanges.ts';
import type { NoeudInvites } from '../invites/noeud-invites.ts';
import type { MachinesNoeud } from './machines-noeud.ts';
import type { AdmissionsNoeud } from './admissions-noeud.ts';
import type { AppareilsNoeud } from './appareils-noeud.ts';
import type { AppairageNoeud } from './appairage-noeud.ts';
import type { TerminalFedere } from './terminal-federe.ts';
import type { DemandesAppairage } from './demandes.ts';
import { MOTIF_PAUSE } from './pause-noeud.ts';
import type { PortNoeud } from './noeud-port.ts';

/** Ce que l'hôte des canaux confie aux modules du nœud (le nœud les câble, jamais l'inverse). */
export interface DepsHote {
  readonly echanges: Echanges;
  readonly invites: NoeudInvites;
  readonly machines: MachinesNoeud;
  readonly admissions: AdmissionsNoeud;
  readonly appareils: AppareilsNoeud;
  readonly appairage: AppairageNoeud;
  readonly terminaux: TerminalFedere;
  readonly demandes: DemandesAppairage;
  readonly recepteurSynchro: () => ((membre: string, brut: unknown) => void) | null;
  readonly estAppareil: (membre: string) => boolean;
}

export class HoteNoeud {
  constructor(
    private readonly port: PortNoeud,
    private readonly deps: DepsHote,
  ) {}

  liaisonOuverte(canal: CanalNoeud): void {
    this.port.refus.delete(canal.membre);
    if (this.deps.estAppareil(canal.membre)) return;
    this.port.distant.enLigne(canal.membre, true);
    if (this.deps.echanges.peutVoir(canal.membre)) {
      for (const message of this.deps.echanges.instantanes(canal.membre)) canal.envoyer(message);
    }
    this.deps.invites.emettreActivites();
    this.deps.admissions.envoyerAdmissionsA(canal);
    this.port.charte.envoyerA(canal);
    void this.deps.machines.etats.envoyerA(canal);
  }

  liaisonRefusee(canal: CanalNoeud, raison: string): void {
    this.port.refus.add(canal.membre);
    this.port.options.journal.warn(
      { membre: canal.membre, raison },
      'lien refusé par le nœud : appairage à refaire',
    );
  }

  async messageRecu(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    if (message.t === 'charte') return this.port.charte.recevoir(canal.membre, message, this.sourceDe(canal.membre));
    if (this.deps.estAppareil(canal.membre)) return this.deps.appareils.messageAppareil(canal, message);
    if (message.t === 'api' || message.t === 'api_reponse') return canal.fermer();
    if (message.t === 'admissions') return this.deps.admissions.messageAdmissions(canal, message);
    if (message.t === 'revocation') {
      this.deps.appairage.oublierPair(canal.membre);
      // Un lien rouvert entre-temps (planification) vers ce pair ne doit pas survivre à la révocation.
      for (const autre of this.port.canaux.actifs()) if (autre.membre === canal.membre) autre.fermer();
      return;
    }
    if (message.t === 'synchro') return this.deps.recepteurSynchro()?.(canal.membre, message.m);
    if (message.t === 'etat_noeud') return this.deps.machines.etats.recevoir(canal.membre, message.etat);
    if (message.t === 'activite_invites') return this.deps.invites.recevoirActivite(canal.membre, message.activites);
    if (message.t === 'action_noeud') return this.deps.machines.actions.recevoir(canal, message);
    if (message.t === 'ouvrir' && this.deps.machines.pause.enPause()) {
      return this.deps.echanges.reponse(canal, message.ref, false, MOTIF_PAUSE);
    }
    await this.deps.echanges.traiter(canal, message);
  }

  canalFerme(canal: CanalNoeud): void {
    this.deps.terminaux.fermerPour(canal.membre);
    this.deps.appareils.fermerPour(canal);
    this.port.canaux.retirer(canal);
    this.deps.demandes.retirerPour(canal.membre);
    if (this.port.canaux.liaisonOuverteAvec(canal.membre)) return;
    this.port.distant.enLigne(canal.membre, false);
    this.deps.echanges.oublier(canal.membre);
  }

  /** Le verdict d'une source (nœud apparié de mêmes propriétaires ou non), pour la charte. */
  private sourceDe(membre: string): VerdictSource {
    return verdictSource(this.port.pairs(), membre, this.port.voisins.refusPour(membre, this.port.proprietaireLocal()));
  }
}
