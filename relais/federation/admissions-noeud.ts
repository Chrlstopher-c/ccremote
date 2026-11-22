// Responsabilité : les admissions d'appareils entre nœuds de mêmes propriétaires (photo envoyée aux pairs, fusion
// reçue, révocation d'appareil) et les révocations de pairs ou d'appareils, gardées sur disque.
import type { CanalNoeud } from './canal.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { fusionner, photoAdmissions, verdictSource } from './admissions.ts';
import type { PortNoeud } from './noeud-port.ts';

export class AdmissionsNoeud {
  /** Pairs révoqués (définitif) : un pair révoqué garde son motif de refus, même après un redémarrage. */
  private readonly revoques: Set<string>;
  /** Appareils révoqués (définitif) : une admission reçue d'un pair pour l'un d'eux est ignorée. */
  private readonly appareilsRevoques: Set<string>;

  constructor(private readonly port: PortNoeud) {
    this.revoques = new Set(port.secrets.lireRevoques());
    this.appareilsRevoques = new Set(port.secrets.lireAppareilsRevoques());
  }

  /** Vrai si ce pair a été révoqué. */
  estRevoque(membre: string): boolean {
    return this.revoques.has(membre);
  }

  /** Un membre entré à nouveau dans le réseau n'est plus révoqué : la levée est sauvée. */
  readmettre(membre: string): void {
    if (this.revoques.delete(membre)) this.sauverRevoques();
    if (this.appareilsRevoques.delete(membre)) this.sauverAppareilsRevoques();
  }

  /** La photo des admissions part à un nœud pair relié, jamais à un appareil. */
  envoyerAdmissionsA(canal: CanalNoeud): void {
    const moi = this.port.identifiantProtocole();
    if (!moi || !this.port.estNoeud(canal.membre)) return;
    canal.envoyer({ t: 'admissions', ...photoAdmissions(this.port.pairs(), [...this.appareilsRevoques], moi) });
  }

  /** À chaque admission ou révocation d'appareil, la photo repart à tous les nœuds pairs reliés. */
  diffuserAdmissions(): void {
    for (const canal of this.port.canaux.ouverts()) this.envoyerAdmissionsA(canal);
  }

  // Un nœud pair de mêmes propriétaire range les admissions reçues ; s'il change quelque chose, il relaie.
  messageAdmissions(canal: CanalNoeud, message: Extract<MessageChiffre, { t: 'admissions' }>): void {
    const moi = this.port.identifiantProtocole();
    const refus = this.port.voisins.refusPour(canal.membre, this.port.proprietaireLocal());
    const verdict = verdictSource(this.port.pairs(), canal.membre, refus);
    if (verdict === 'non-appaire' || !moi) return canal.fermer();
    if (verdict === 'autre-proprietaire') {
      return this.port.options.journal.warn({ membre: canal.membre }, 'admissions refusées : autre propriétaire');
    }
    const liste = this.port.charte.filtrerAdmissions(message.liste);
    const fusion = fusionner({ ...message, liste }, this.port.pairs(), [...this.appareilsRevoques], moi);
    for (const conflit of fusion.conflits) {
      this.port.options.journal.warn(
        { membre: canal.membre, appareil: conflit },
        'admission ignorée : clé différente',
      );
    }
    if (!fusion.changee) return;
    this.port.definirPairs(fusion.pairs);
    this.port.sauverPairs();
    this.appareilsRevoques.clear();
    for (const id of fusion.revoques) this.appareilsRevoques.add(id);
    this.sauverAppareilsRevoques();
    for (const id of fusion.retires) this.fermerAppareil(id);
    this.diffuserAdmissions();
  }

  // Un appareil révoqué est prévenu s'il est en ligne, son canal est fermé ; il n'est plus admis nulle part.
  private fermerAppareil(id: string): void {
    const canal = this.port.canaux.liaisonOuverteAvec(id);
    if (canal) {
      canal.envoyer({ t: 'revocation' });
      canal.fermerApresEnvois();
    }
    this.marquerRevoque(id);
  }

  marquerAppareilRevoque(id: string): void {
    this.appareilsRevoques.add(id);
    this.sauverAppareilsRevoques();
    this.diffuserAdmissions();
  }

  private sauverAppareilsRevoques(): void {
    try {
      this.port.secrets.ecrireAppareilsRevoques([...this.appareilsRevoques]);
    } catch {
      this.port.options.journal.error('révocations d’appareils non sauvegardées');
    }
  }

  // Un pair révoqué garde son motif de refus, même après un redémarrage du nœud.
  marquerRevoque(membre: string): void {
    this.revoques.add(membre);
    this.sauverRevoques();
  }

  private sauverRevoques(): void {
    try {
      this.port.secrets.ecrireRevoques([...this.revoques]);
    } catch {
      this.port.options.journal.error('révocations de la fédération non sauvegardées');
    }
  }
}
