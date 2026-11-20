// Responsabilité : le réveil Wake-on-LAN — paquet magique en diffusion UDP, et le banc : une ligne JSON écrite au lieu
// de l'envoi quand CCREMOTE_REVEIL_FACTICE désigne un fichier (relais et poste utilisent le même chemin).
import { appendFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import type { Logger } from 'pino';

export interface EnvoiReveil {
  readonly mac: string;
  readonly diffusion: string;
  readonly par: string;
}

export function paquetMagique(mac: string): Buffer {
  const octets = mac.split(/[:-]/).map((h) => Number.parseInt(h, 16));
  if (octets.length !== 6 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255))
    throw new Error(`MAC invalide : ${mac}`);
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => Buffer.from(octets))]);
}

export function reveiller(mac: string, diffusion: string): Promise<void> {
  const paquet = paquetMagique(mac);
  const socket = createSocket('udp4');
  return new Promise((resoudre, rejeter) => {
    socket.once('error', (e) => {
      socket.close();
      rejeter(e);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(paquet, 9, diffusion, (e) => {
        socket.close();
        if (e) rejeter(e);
        else resoudre();
      });
    });
  });
}

/** Banc : une ligne JSON par réveil demandé ; rien n'est envoyé sur le réseau. */
export function enregistrerReveilFactice(chemin: string, envoi: EnvoiReveil, ts: string): void {
  appendFileSync(chemin, `${JSON.stringify({ ts, ...envoi })}\n`);
}

/** Envoie le réveil, ou l'écrit dans le fichier du banc si `factice` est donné. Une erreur d'E/S est journalisée. */
export async function envoyerReveil(envoi: EnvoiReveil, factice: string | undefined, journal: Logger): Promise<void> {
  try {
    if (factice) enregistrerReveilFactice(factice, envoi, new Date().toISOString());
    else await reveiller(envoi.mac, envoi.diffusion);
  } catch (erreur) {
    journal.warn({ err: erreur, par: envoi.par }, 'réveil impossible');
    throw erreur;
  }
}
