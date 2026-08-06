/**
 * Responsabilité : réveil Wake-on-LAN du PC, en UDP broadcast LOCAL depuis le Pi.
 *
 * `☠ H-75 / POURQUOI PAS LE CANAL DE CONTRÔLE.` Le canal D.3 (`canal-controle.ts`)
 * exige un lien Pi↔PC déjà établi — et c'est le PC qui l'initie, jamais le Pi
 * (H-75, `16-decisions-operateur.md:1075-1101`). Un PC ÉTEINT n'a par définition
 * aucun lien à emprunter : il n'y a donc rien à traverser pour le réveiller. Ce
 * module est la SEULE opération de contrôle qui ne passe jamais par
 * `canal-controle.ts` — elle part du Pi tout seul, en diffusion locale, sans
 * réponse attendue.
 *
 * Porté depuis `pi-web/pc_client.py:13-18` (Python, éprouvé en prod) : même
 * construction de paquet (6 octets `0xFF`, puis 16 répétitions de la MAC), même
 * port de diffusion (9, "discard").
 *
 * `☠` L'ADRESSE MAC EST UNE CONSTANTE DE CONFIGURATION CÔTÉ PI, JAMAIS UN
 * ARGUMENT DU MODÈLE (voir `outils-machine.ts` : `machine` y est un
 * `z.enum(['pc'])` fermé). Un LLM qui pourrait fournir un MAC arbitraire
 * pourrait faire réveiller n'importe quelle machine du LAN par un magic packet
 * signé du Pi — cette constante est ce qui l'en empêche structurellement.
 *
 * `☠` SURCHARGEABLE via `CCREMOTE_PC_MAC` (même logique que `CCREMOTE_MACHINE_ID`
 * ailleurs dans le dépôt : lu au moment de l'appel, défaut si absent) — une
 * carte réseau change, une constante versionnée non. Une valeur d'environnement
 * malformée est REFUSÉE explicitement (log + exception), jamais tronquée ni
 * ignorée au profit du défaut : substituer silencieusement une MAC en placerait
 * une autre que celle voulue par l'opérateur, sans que rien ne le signale.
 */

import { createSocket } from 'node:dgram';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'reveil-wol' });

/** Valeur par défaut : `pi-web/config.py:9` et `client/config.py:3` (légataires Python, lecture seule). */
const MAC_PC_PAR_DEFAUT = 'aa:bb:cc:dd:ee:ff';

/** Même forme que `construireMagicPacket` : 6 octets hex séparés par « : » ou « - ». */
const MOTIF_MAC = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

/**
 * Résout la MAC du PC à réveiller : `CCREMOTE_PC_MAC` si défini, sinon le
 * défaut historique. Valide le format AVANT tout usage — une variable
 * d'environnement est une entrée externe comme une autre (doctrine « model
 * output is untrusted input », mais elle vaut tout autant pour un opérateur qui
 * fait une faute de frappe dans un `.env`).
 */
export function resoudreMacPc(): string {
  const brut = process.env['CCREMOTE_PC_MAC'];
  if (brut === undefined || brut.trim().length === 0) return MAC_PC_PAR_DEFAUT;
  const propre = brut.trim();
  if (!MOTIF_MAC.test(propre)) {
    log.error({ macRecue: propre }, 'CCREMOTE_PC_MAC invalide — attendu 6 octets hex séparés par « : » ou « - »');
    throw new Error(`CCREMOTE_PC_MAC invalide : « ${propre} »`);
  }
  return propre;
}

/** Port de diffusion WoL conventionnel ("discard") — identique à `pi-web/pc_client.py`. */
const PORT_DIFFUSION_WOL = 9;
const ADRESSE_DIFFUSION = '255.255.255.255';

/**
 * Construit le magic packet WoL : 6 octets `0xFF`, puis 16 répétitions des 6
 * octets de la MAC — 102 octets au total. Pure, testable sans ouvrir de socket.
 */
export function construireMagicPacket(mac: string): Buffer {
  const hex = mac.replace(/[:-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) {
    throw new Error(`adresse MAC invalide pour le magic packet : « ${mac} »`);
  }
  const macBytes = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(macBytes)]);
}

/**
 * Émet le magic packet en UDP broadcast LOCAL. Fire-and-forget : AUCUNE réponse
 * n'est attendue — le PC est peut-être précisément éteint, c'est le but même de
 * l'appel.
 *
 * `☠` ne garantit PAS l'allumage : un magic packet émis peut se perdre, ou le
 * WoL peut être désactivé au BIOS, ou le câble débranché. Ce que cette fonction
 * promet : le paquet a été ÉMIS sur le réseau local, rien de plus — c'est
 * `outils-machine.ts` qui traduit cette limite dans le contrat rendu au modèle
 * (`accepte`, jamais `applique`).
 */
export async function reveillerPc(): Promise<void> {
  const paquet = construireMagicPacket(resoudreMacPc());
  const socket = createSocket('udp4');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(paquet, PORT_DIFFUSION_WOL, ADRESSE_DIFFUSION, (erreur) => {
          if (erreur) reject(erreur);
          else resolve();
        });
      });
    });
    log.info({}, 'magic packet WoL émis en broadcast local');
  } catch (erreur) {
    log.error({ err: erreur }, "échec d'émission du magic packet WoL");
    throw erreur;
  } finally {
    socket.close();
  }
}
