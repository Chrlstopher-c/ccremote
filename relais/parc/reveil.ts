// Responsabilité : réveiller une machine éteinte par Wake-on-LAN (paquet magique en diffusion UDP).
import { createSocket } from 'node:dgram';

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
