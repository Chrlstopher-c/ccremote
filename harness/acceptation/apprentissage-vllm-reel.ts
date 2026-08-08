/**
 * Banc d'essai RÉEL du client vLLM et de sa garde de sortie (E4, C-3).
 *
 * Preuve exigée par PLAN-PORTAGE.md E4 : envoie un `ResumeMission` d'exemple au vrai
 * serveur vLLM, affiche la réponse brute ET le verdict de la garde — et démontre le cas
 * serveur éteint : `disponible: false` typé, jamais une exception qui remonte.
 *
 * ☠ ATTENTION : « serveur éteint » est le régime NORMAL sur cette machine (le PC ne réserve
 * pas sa VRAM en permanence — SPEC §3). Ce banc réussit dans les deux cas ; il n'échoue que
 * si le client laisse fuiter une exception.
 *
 * Usage :
 *   bun run acceptation/apprentissage-vllm-reel.ts
 *   CCREMOTE_APPRENTISSAGE_VLLM_URL=http://127.0.0.1:8000 \
 *   CCREMOTE_APPRENTISSAGE_VLLM_MODELE=qwen3-8b-awq \
 *     bun run acceptation/apprentissage-vllm-reel.ts
 */

import { appellerVllm } from '../apprentissage/extraction/client-vllm.ts';
import { validerLeconsExtraites } from '../apprentissage/extraction/garde-sortie.ts';
import { construirePromptExtraction } from '../apprentissage/extraction/prompts.ts';
import type { ResumeMission } from '../apprentissage/types.ts';

const RESUME_EXEMPLE: ResumeMission = {
  missionId: 'banc-vllm-reel',
  sessionId: 'banc-vllm-reel',
  projet: '/mnt/projects/ccremote',
  mandatResume: 'Corriger la fuite mémoire du superviseur de workers.',
  critereArret: 'Les tests passent, la mémoire ne croît plus sur 100 cycles.',
  issue: 'livree',
  dureeMs: 420_000,
  nbTours: 12,
  outils: [
    { nom: 'Bash', appels: 8, echecs: 1 },
    { nom: 'Edit', appels: 3, echecs: 0 },
  ],
  erreurs: ['ENOENT: fichier de verrou absent au premier essai'],
  fichiersTouches: ['harness/superviseur/superviseur-workers.ts'],
  commandesEchouees: [],
  sousAgents: [],
  extraitFinal: 'Correctif appliqué et vérifié sur 100 cycles sans croissance mémoire.',
};

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main(): Promise<void> {
  const url = process.env['CCREMOTE_APPRENTISSAGE_VLLM_URL'];
  const modele = process.env['CCREMOTE_APPRENTISSAGE_VLLM_MODELE'];
  horodate(`URL=${url ?? '(non configurée)'} MODELE=${modele ?? '(non configuré)'}`);

  const prompt = construirePromptExtraction(RESUME_EXEMPLE, []);
  horodate(`prompt construit (${prompt.length} caractères)`);

  const depart = performance.now();
  const reponse = await appellerVllm({ prompt });
  const dureeMs = performance.now() - depart;

  horodate(`réponse en ${dureeMs.toFixed(0)} ms :`);
  console.log(JSON.stringify(reponse, null, 2));

  if (!reponse.disponible) {
    horodate('vLLM indisponible — résultat TYPÉ, aucune exception n’a remonté. Régime normal si le serveur est éteint.');
    return;
  }

  const verdict = validerLeconsExtraites(reponse.contenu);
  horodate('verdict de la garde de sortie :');
  console.log(JSON.stringify(verdict, null, 2));
}

await main();
