/**
 * Banc d'essai RÉEL de la réduction déterministe d'un transcript (E2, C-1).
 *
 * Preuve que ce que les tests sur fixtures ne peuvent pas montrer : un vrai transcript
 * du disque, de taille quelconque, se réduit sans exception et sous la borne de
 * 2 000 tokens — lu en flux, sans jamais charger le fichier entier en mémoire
 * (PLAN-PORTAGE.md, E2, `☠`).
 *
 * ☠ Lecture seule : ce banc n'écrit rien, ne consomme aucun quota Claude, ne parle à
 * aucun modèle. Peut tourner sur n'importe quel transcript réel présent sur le disque.
 *
 * Usage : bun run acceptation/apprentissage-reduction-reel.ts <chemin.jsonl> [projet]
 */

import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { estimerTokensResumeMission, reduireTranscript } from '../apprentissage/observation/reduction-transcript.ts';

const BORNE_TOKENS = 2_000;

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main(): Promise<void> {
  const cheminTranscript = process.argv[2];
  if (cheminTranscript === undefined) {
    console.error('Usage : bun run acceptation/apprentissage-reduction-reel.ts <chemin.jsonl> [projet]');
    process.exitCode = 1;
    return;
  }
  const projet = process.argv[3] ?? '/mnt/projects/ccremote';
  const tailleOctets = statSync(cheminTranscript).size;
  horodate(`transcript : ${cheminTranscript} (${(tailleOctets / 1024 / 1024).toFixed(2)} Mo)`);

  const heapAvant = process.memoryUsage().heapUsed;
  const depart = performance.now();
  const resume = await reduireTranscript({
    missionId: basename(cheminTranscript, '.jsonl'),
    projet,
    mandat: null,
    critereArret: null,
    issue: 'inconnue',
    cheminTranscript,
  });
  const dureeMs = performance.now() - depart;
  const heapApres = process.memoryUsage().heapUsed;
  const tokens = estimerTokensResumeMission(resume);

  horodate(
    `réduit en ${dureeMs.toFixed(0)} ms — delta heap ${((heapApres - heapAvant) / 1024 / 1024).toFixed(2)} Mo ` +
      `(taille source ${(tailleOctets / 1024 / 1024).toFixed(2)} Mo)`,
  );
  horodate(`ResumeMission produit — ${tokens} tokens estimés (borne ${BORNE_TOKENS}) :`);
  console.log(JSON.stringify(resume, null, 2));

  if (tokens >= BORNE_TOKENS) {
    console.error(`☠ BORNE DÉPASSÉE : ${tokens} tokens ≥ ${BORNE_TOKENS}`);
    process.exitCode = 1;
  } else {
    horodate('borne respectée.');
  }
}

await main();
