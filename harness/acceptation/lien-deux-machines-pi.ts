#!/usr/bin/env bun
/**
 * Banc RÉEL côté Pi — moitié serveur du test à deux machines (H-75).
 *
 * `☠` Pourquoi ce banc existe : jusqu'ici le lien n'avait tourné qu'en boucle
 * locale. Or le scénario que Chris a énoncé — « j'éteins le PC, je vais me
 * coucher, je le relance le lendemain, tout doit se reconnecter tout seul » —
 * met en jeu exactement ce que la boucle locale ne reproduit pas : un vrai
 * réseau, une vraie latence, un vrai process qui meurt et renaît sur une autre
 * machine.
 *
 * N'ouvre AUCUNE session Claude Code : ce banc éprouve le transport, pas
 * l'orchestrateur. Il ne consomme donc aucun quota.
 *
 * Expose un état lisible sur `/etat` pour que la machine d'en face puisse
 * constater sans lire les journaux à la main.
 */

import { demarrerServeurLienPc } from '../composition/pi/serveur-lien-pc.ts';
import { envNombreOptionnel, envObligatoire } from '../composition/env.ts';

const port = envNombreOptionnel('BANC_LIEN_PORT', 8721);
const portEtat = envNombreOptionnel('BANC_ETAT_PORT', 8723);
const secret = envObligatoire('CCREMOTE_LIEN_SECRET');

let rattachements = 0;
const journal: string[] = [];

function noter(ligne: string): void {
  const horodatage = new Date().toISOString().slice(11, 19);
  journal.push(`${horodatage} ${ligne}`);
  console.log(`[banc-pi] ${horodatage} ${ligne}`);
}

// `0.0.0.0` ASSUMÉ ICI, et uniquement ici : le PC est une autre machine du LAN.
// En production le lien est joint par le tunnel Cloudflare, donc en loopback.
const serveur = demarrerServeurLienPc({
  port,
  hostname: '0.0.0.0',
  secret,
  surConnexionAcceptee: () => {
    rattachements += 1;
    noter(`rattachement n°${rattachements} accepté`);
  },
});

noter(`serveur du lien en écoute sur 0.0.0.0:${serveur.port}`);

Bun.serve({
  port: portEtat,
  hostname: '0.0.0.0',
  fetch(): Response {
    return Response.json({
      etatLien: serveur.lien.etat(),
      rattachements,
      // `☠` LE compteur du test : il doit rester à 0 sur une reconnexion
      // légitime. Non nul ⇒ le Pi prend le retour du PC pour un second PC.
      supersedes: serveur.supersedes(),
      rattachementsTransport: serveur.lien.rattachements(),
      remonteesTransitoires: serveur.lien.remonteesTransitoires(),
      coupuresSilencieuses: serveur.lien.coupuresSilencieusesDetectees(),
      journal: journal.slice(-30),
    });
  },
});

noter(`état lisible sur http://0.0.0.0:${portEtat}/`);

const arreter = (signal: string): void => {
  noter(`arrêt demandé (${signal})`);
  serveur.arreter();
  process.exit(0);
};
process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));
