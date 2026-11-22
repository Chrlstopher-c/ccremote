// Responsabilité : ce que le nœud sert à un appareil admis sur son canal — requêtes de l'API rejouées sous
// le droit de la charte, flux en direct, morceaux des requêtes en route, terminaux de machine. Les
// admissions restent à `admissions-noeud.ts`.
import { messagesAvecCorps, Reassemblage } from './transferts.ts';
import { DiffusionAppareil } from './appareil-diffusion.ts';
import { TerminalAppareil } from './terminal-appareil.ts';
import type { TerminalFedere } from './terminal-federe.ts';
import { ChefAppareil, estRouteTelephone } from './chef-appareil.ts';
import { envoyerReponseFlux } from './reponse-flux-appareil.ts';
import type {
  DemandeAppareil as DemandeAppareilFedere,
  ReponseAppareil as ReponseAppareilFedere,
} from './appareils.ts';
import { type MessageChiffre, TAILLE_MORCEAU_APPAREIL_CARACTERES } from '../../commun/federation.ts';
import type { CanalNoeud } from './canal.ts';
import type { PortNoeud } from './noeud-port.ts';

export class AppareilsNoeud {
  private readonly transferts = new Reassemblage();
  private readonly diffusion: DiffusionAppareil;
  private readonly terminauxAppareil: TerminalAppareil;

  constructor(
    private readonly port: Pick<PortNoeud, 'options' | 'charte'>,
    private readonly terminaux: TerminalFedere,
    private readonly chef: ChefAppareil,
  ) {
    this.diffusion = new DiffusionAppareil(port.options.diffusion);
    this.terminauxAppareil = new TerminalAppareil(
      () => terminaux.locauxBranches,
      (membre, requete) => port.charte.autorise(membre, requete),
    );
  }

  /** Un canal d'appareil fermé : ses terminaux de machine, son flux et ses morceaux en route sont abandonnés. */
  fermerPour(canal: CanalNoeud): void {
    this.terminauxAppareil.fermerPour(canal.membre);
    this.diffusion.fermer(canal);
    this.transferts.oublier(canal.membre);
  }

  /** Arrêt du nœud : le flux des appareils se ferme. */
  arreter(): void {
    this.diffusion.fermerTout();
  }

  /**
   * Un appareil n'échange que l'API clients, le flux en direct et le terminal de ce nœud ; tout autre message ferme
   * son canal.
   */
  async messageAppareil(canal: CanalNoeud, message: MessageChiffre): Promise<void> {
    switch (message.t) {
      case 'api':
        return this.requeteAppareil(canal, message);
      case 'morceau':
        this.transferts.recevoir(canal.membre, message);
        return undefined;
      case 'diffusion_ouvrir':
        return this.diffusion.ouvrir(canal);
      case 'diffusion_fermer':
        return this.diffusion.fermer(canal);
      case 'terminal_poste':
        return this.terminauxAppareil.ouvrir(canal, message);
      case 'terminal_entree':
      case 'terminal_taille':
      case 'terminal_fermer':
        if (this.terminauxAppareil.recu(canal, message)) return undefined;
        return this.terminaux.traiter(canal, message);
      case 'terminal_ouvrir':
        return this.terminaux.traiter(canal, message);
      default:
        return canal.fermer();
    }
  }

  // Une requête de l'API : son corps (en morceaux si besoin) est réuni, rejoué, et la réponse repart de même.
  private async requeteAppareil(canal: CanalNoeud, m: Extract<MessageChiffre, { t: 'api' }>): Promise<void> {
    const corps = this.corpsAppareil(canal.membre, m);
    const reponse: ReponseAppareilFedere =
      corps === null
        ? { statut: 400, corps: JSON.stringify({ erreur: 'transfert interrompu' }) }
        : await this.reponseAppareil(canal.membre, m, corps);
    if (reponse.flux) {
      const flux = { statut: reponse.statut, type: reponse.type, flux: reponse.flux };
      return envoyerReponseFlux((message) => canal.envoyer(message), m.ref, flux, this.port.options.journal);
    }
    for (const message of messagesAvecCorps(m.ref, reponse.corps, (texte, morceaux) => ({
      t: 'api_reponse',
      ref: m.ref,
      statut: reponse.statut,
      corps: texte,
      ...(reponse.codage ? { codage: reponse.codage } : {}),
      ...(reponse.type ? { type: reponse.type } : {}),
      ...(morceaux !== undefined ? { morceaux } : {}),
    }), TAILLE_MORCEAU_APPAREIL_CARACTERES)) {
      canal.envoyer(message);
    }
  }

  // Le corps d'une requête : tel quel, ou réuni depuis ses morceaux ; null si le transfert est cassé.
  private corpsAppareil(membre: string, m: Extract<MessageChiffre, { t: 'api' }>): string | undefined | null {
    if (m.morceaux === undefined) return m.corps;
    return this.transferts.assembler(membre, m.ref, m.morceaux);
  }

  // Un appareil sans le droit de la requête (charte) reçoit 403, sans que la route soit servie.
  private async reponseAppareil(
    membre: string,
    m: Extract<MessageChiffre, { t: 'api' }>,
    corps: string | undefined,
  ): Promise<ReponseAppareilFedere> {
    if (estRouteTelephone(m.chemin)) {
      const demande = { methode: m.methode, chemin: m.chemin, corps, codage: m.codage, type: m.type };
      return this.chef.servir(membre, demande);
    }
    if (!this.port.charte.autorise(membre, { genre: 'api', methode: m.methode, chemin: m.chemin })) {
      return { statut: 403, corps: JSON.stringify({ erreur: 'droit refusé' }) };
    }
    return this.servirAppareil({ methode: m.methode, chemin: m.chemin, corps, codage: m.codage, type: m.type });
  }

  private async servirAppareil(demande: DemandeAppareilFedere): Promise<ReponseAppareilFedere> {
    if (!this.port.options.servirAppareil) {
      return { statut: 503, corps: JSON.stringify({ erreur: 'API appareil non branchée' }) };
    }
    return this.port.options.servirAppareil(demande);
  }
}
