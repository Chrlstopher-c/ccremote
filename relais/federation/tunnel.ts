// Responsabilité : le tunnel chiffré d'un canal entre nœuds, côté nœud — un message du protocole devient une trame
// (commun/chiffrement) et inversement. Les compteurs se prennent à l'appel, donc les envois et les réceptions se font
// dans l'ordre de leur appel : une file les remet dans cet ordre même quand WebCrypto répond dans le désordre.
import type { Logger } from 'pino';
import { ErreurChiffrement } from '../../commun/chiffrement/erreur.ts';
import { type Canal } from '../../commun/chiffrement/messages.ts';
import { depuisBase64url, enOctets, versBase64url } from '../../commun/chiffrement/octets.ts';
import { lireMessageChiffre, MessageChiffre, TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';

export class Tunnel {
  private envois: Promise<void> = Promise.resolve();
  private receptions: Promise<void> = Promise.resolve();

  constructor(
    private readonly canal: Canal,
    private readonly journal: Logger,
  ) {}

  /** Chiffre puis transmet (via `transmettre`, la charge de l'aiguilleur). Faux si le message dépasse la taille. */
  envoyer(message: MessageChiffre, transmettre: (charge: string) => void): boolean {
    const clair = JSON.stringify(message);
    if (enOctets(clair).byteLength > TAILLE_MAX_CLAIR_OCTETS) return false;
    const trame = this.canal.chiffrer(enOctets(clair));
    this.envois = this.envois
      .then(async () => transmettre(JSON.stringify({ t: 'chiffre', trame: versBase64url(await trame) })))
      .catch((erreur: unknown) => this.journal.error({ err: erreur }, 'trame non chiffrée : envoi annulé'));
    return true;
  }

  /** Attend que les envois déjà chiffrés soient partis (avant une fermeture : rien ne doit être coupé en route). */
  vider(): Promise<void> {
    return this.envois;
  }

  /** Déchiffre une trame reçue puis la remet à `traiter`. Une trame refusée (rejeu, altération) appelle `echec`. */
  recevoir(trame: string, traiter: (message: MessageChiffre) => void, echec: (raison: string) => void): void {
    const dechiffree = this.dechiffrer(trame).then(
      (clair) => ({ ok: true as const, clair }),
      (erreur: unknown) => ({ ok: false as const, erreur }),
    );
    this.receptions = this.receptions
      .then(async () => {
        const r = await dechiffree;
        if (!r.ok) return echec(raisonRefus(r.erreur));
        const brut = lireJson(new TextDecoder().decode(r.clair));
        const message = lireMessageChiffre(brut);
        if (message) traiter(message);
        else if (typeInconnu(brut)) this.journal.debug({ t: (brut as { t: string }).t }, 'message d’une version plus récente ignoré');
        else echec('message chiffré hors protocole');
      })
      .catch((erreur: unknown) => this.journal.error({ err: erreur }, 'message chiffré : traitement en échec'));
  }

  private async dechiffrer(trame: string): Promise<Uint8Array<ArrayBuffer>> {
    return this.canal.dechiffrer(depuisBase64url(trame));
  }
}

function raisonRefus(erreur: unknown): string {
  return erreur instanceof ErreurChiffrement ? erreur.message : 'trame refusée';
}

// Compatibilité entre versions : un pair plus récent peut envoyer un genre de message que celui-ci ne connaît pas encore
// (ex. `admissions`). Il est ignoré au lieu de fermer le canal, sinon deux nœuds de versions différentes se coupent en
// boucle (22/11). Un genre CONNU mais mal formé reste une faute de protocole.
const GENRES_CONNUS: ReadonlySet<string> = new Set(
  MessageChiffre.options.map((o) => String((o.shape as { t: { value: unknown } }).t.value)),
);

function typeInconnu(brut: unknown): boolean {
  if (typeof brut !== 'object' || brut === null) return false;
  const t = (brut as { t?: unknown }).t;
  return typeof t === 'string' && t.length > 0 && t.length <= 40 && !GENRES_CONNUS.has(t);
}

function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}
