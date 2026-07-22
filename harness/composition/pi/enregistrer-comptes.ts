#!/usr/bin/env bun
/**
 * Enregistre les comptes Claude dans le registre du control plane.
 *
 * `☠` Les comptes ne s'auto-découvrent pas : ils vivent sur le PC
 * (`CLAUDE_CONFIG_DIR`, H-53) et le Pi n'a aucun moyen de les deviner. Sans cet
 * enregistrement, la vue Comptes est vide et le plafond de parc (G.1.3) n'a
 * rien à mesurer — un garde-fou sans population à surveiller.
 *
 * `☠` N'écrit AUCUN secret : seulement l'identifiant, le chemin de
 * configuration et un libellé. Les credentials restent sur le PC, où ils sont
 * lus par le worker — jamais recopiés sur le Pi.
 *
 * Idempotent : relancer ne duplique rien.
 *
 * Usage (sur le Pi) :
 *   bun run composition/pi/enregistrer-comptes.ts compte-a=/chemin/a compte-b=/chemin/b
 */

import { ouvrirRegistre } from '../../control-plane/registre/index.ts';
import { envObligatoire } from '../env.ts';
import { compositionLogger } from '../logger.ts';

const log = compositionLogger.child({ composant: 'enregistrer-comptes' });

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage : enregistrer-comptes.ts <id>=<configDir> [<id>=<configDir> …]');
    process.exit(64);
  }

  const registre = ouvrirRegistre({ chemin: envObligatoire('CCREMOTE_PI_REGISTRE_DB') });
  try {
    for (const arg of args) {
      const separateur = arg.indexOf('=');
      if (separateur === -1) {
        console.error(`argument mal formé (attendu <id>=<configDir>) : ${arg}`);
        process.exit(64);
      }
      const id = arg.slice(0, separateur);
      const configDir = arg.slice(separateur + 1);
      // `organisation` sert de libellé d'affichage : « compte-a » est un
      // identifiant, pas quelque chose qu'on veut lire sur un téléphone.
      registre.comptes.enregistrer({ id, configDir, organisation: `Compte ${id.slice(-1).toUpperCase()}` });
      log.info({ id, configDir }, 'compte enregistré');
    }
    const total = registre.comptes.lister().length;
    console.log(`✓ ${total} compte(s) dans le registre : ${registre.comptes.lister().map((c) => c.id).join(', ')}`);
  } finally {
    registre.fermer();
  }
}

main();
