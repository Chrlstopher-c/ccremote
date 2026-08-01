#!/usr/bin/env bun
/**
 * Banc RÉEL côté PC — moitié cliente du test à deux machines (H-75).
 * Voir `lien-deux-machines-pi.ts` pour le pourquoi.
 *
 * Se comporte comme `composition/pc/bin-pc.ts` sur le seul point qui compte
 * ici : connexion sortante, reconnexion automatique avec backoff et gigue,
 * arrêt du process sur fermeture TERMINALE (secret refusé) — jamais de
 * martèlement.
 */

import { hostname } from 'node:os';
import { creerClientLienPi } from '../composition/pc/client-lien-pi.ts';
import { envObligatoire } from '../composition/env.ts';

const CODE_SORTIE_CONFIG = 78;

const urlPi = envObligatoire('CCREMOTE_LIEN_URL_PI');
const secret = envObligatoire('CCREMOTE_LIEN_SECRET');

const lien = creerClientLienPi({
  urlPi,
  secret,
  machineId: process.env['CCREMOTE_MACHINE_ID'] ?? hostname(),
  surFermetureTerminale: (fermeture): void => {
    console.log(`[banc-pc] fermeture TERMINALE ${fermeture.code} — ${fermeture.raison}`);
    console.log(`[banc-pc] sortie ${CODE_SORTIE_CONFIG} (configuration), aucune reconnexion interne`);
    process.exit(CODE_SORTIE_CONFIG);
  },
});

void lien.connecter();

// Trace périodique : c'est elle qui rend la reconnexion OBSERVABLE depuis le
// terminal, sans avoir à interpréter des journaux.
setInterval(() => {
  console.log(`[banc-pc] état=${lien.etat()} rattachements=${lien.rattachements()} transitoires=${lien.remonteesTransitoires()}`);
}, 2000);

const arreter = (signal: string): void => {
  console.log(`[banc-pc] arrêt (${signal})`);
  lien.fermer();
  process.exit(0);
};
process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));
