// Responsabilité : le tunnel chiffré d'un canal du duo par l'aiguilleur — un message du protocole du duo devient une
// trame (commun/chiffrement) et inversement. Les compteurs se prennent à l'appel : une file remet envois et réceptions
// dans l'ordre d'appel, même quand WebCrypto répond dans le désordre.
import type { Logger } from 'pino';
import type { MessageLien } from '../../commun/duo.ts';
import { ErreurChiffrement } from '../../commun/chiffrement/erreur.ts';
import type { Canal as CanalChiffre } from '../../commun/chiffrement/messages.ts';
import { depuisBase64url, enOctets, versBase64url } from '../../commun/chiffrement/octets.ts';
import { TAILLE_MAX_CLAIR_DUO } from '../../commun/duo-aiguilleur.ts';
import { lireMessage } from './lien-commun.ts';

export class TunnelAiguilleur {
  private envois: Promise<void> = Promise.resolve();
  private receptions: Promise<void> = Promise.resolve();

  constructor(
    private readonly canal: CanalChiffre,
    private readonly journal: Logger,
  ) {}

  /** Chiffre puis transmet la trame (enveloppe JSON `chiffre`). Faux si le message dépasse la taille permise. */
  envoyer(message: MessageLien, transmettre: (charge: string) => void): boolean {
    const clair = JSON.stringify(message);
    if (enOctets(clair).byteLength > TAILLE_MAX_CLAIR_DUO) return false;
    const trame = this.canal.chiffrer(enOctets(clair));
    this.envois = this.envois
      .then(async () => transmettre(JSON.stringify({ t: 'chiffre', trame: versBase64url(await trame) })))
      .catch((erreur: unknown) => this.journal.error({ err: erreur }, 'trame du duo non chiffrée : envoi annulé'));
    return true;
  }

  /** Attend que les envois déjà chiffrés soient partis (avant une fermeture : rien ne doit être coupé en route). */
  vider(): Promise<void> {
    return this.envois;
  }

  /** Déchiffre une trame reçue puis la remet à `traiter`. Une trame refusée (rejeu, altération) appelle `echec`. */
  recevoir(trame: string, traiter: (message: MessageLien) => void, echec: (raison: string) => void): void {
    const dechiffree = this.canal.dechiffrer(depuisBase64url(trame)).then(
      (clair) => ({ ok: true as const, clair }),
      (erreur: unknown) => ({ ok: false as const, erreur }),
    );
    this.receptions = this.receptions
      .then(async () => {
        const r = await dechiffree;
        if (!r.ok) return echec(raisonRefus(r.erreur));
        const message = lireMessage(new TextDecoder().decode(r.clair));
        if (message) traiter(message);
        else echec('message du duo chiffré hors protocole');
      })
      .catch((erreur: unknown) => this.journal.error({ err: erreur }, 'trame du duo : traitement en échec'));
  }
}

function raisonRefus(erreur: unknown): string {
  return erreur instanceof ErreurChiffrement ? erreur.message : 'trame refusée';
}
