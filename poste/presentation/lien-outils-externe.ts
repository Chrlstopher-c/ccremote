// Responsabilité : le client du socket des outils, côté serveur MCP externe — une requête par connexion, la réponse lue
// jusqu'à la fin de ligne. Socket absent, refus de connexion ou délai : un refus lisible, jamais une exception.
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import type { QuoiRelais, ReponseRelais } from '../../commun/modules.ts';
import {
  DELAI_CONNEXION_OUTILS_MS,
  DELAI_REPONSE_OUTILS_MS,
  lireReponse,
  MESSAGE_SANS_REPONSE,
  MESSAGE_SERVICE_ABSENT,
} from './socket-outils.ts';

export function requeteOutils(chemin: string, quoi: QuoiRelais, args: unknown): Promise<ReponseRelais> {
  return new Promise((resoudre) => {
    const s = createConnection(chemin);
    let recu = '';
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const fin = (r: ReponseRelais): void => {
      clearTimeout(minuteur);
      s.destroy();
      resoudre(r);
    };
    minuteur = setTimeout(() => fin({ ok: false, erreur: MESSAGE_SANS_REPONSE }), DELAI_CONNEXION_OUTILS_MS);
    s.on('connect', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => fin({ ok: false, erreur: MESSAGE_SANS_REPONSE }), DELAI_REPONSE_OUTILS_MS);
      s.write(`${JSON.stringify({ id: randomUUID(), quoi, args })}\n`);
    });
    s.on('data', (octets: Buffer) => {
      recu += octets.toString('utf8');
      const coupure = recu.indexOf('\n');
      if (coupure !== -1) fin(lireReponse(recu.slice(0, coupure)));
    });
    s.on('error', () => fin({ ok: false, erreur: MESSAGE_SERVICE_ABSENT }));
    s.on('close', () => fin({ ok: false, erreur: 'réponse interrompue' }));
  });
}
