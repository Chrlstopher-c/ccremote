/**
 * Banc d'essai RÉEL du client d'inférence et de sa garde de sortie (E5, C-3).
 *
 * `☠ CORRECTION DE CAP (2026-08-08)` — remplace `apprentissage-vllm-reel.ts` : l'inférence
 * passe par le SDK Claude Code (Haiku 4.5, compte-a), pas par un serveur vLLM local. Ce banc
 * envoie un vrai `ResumeMission` d'exemple au modèle et affiche la réponse brute ET le
 * verdict de la garde — la preuve de grande valeur demandée par le mandat E5 : contrairement
 * à vLLM (jamais joignable au moment d'écrire ce plan), le compte Claude Code EST joignable.
 *
 * Usage :
 *   bun run acceptation/apprentissage-inference-reel.ts
 *   CCREMOTE_APPRENTISSAGE_CONFIG_DIR=/home/trinity/.claude-comptes/compte-a \
 *   CCREMOTE_APPRENTISSAGE_MODELE=claude-haiku-4-5-20251001 \
 *     bun run acceptation/apprentissage-inference-reel.ts
 */

import { creerClientInference, MODELE_APPRENTISSAGE_PAR_DEFAUT } from '../apprentissage/extraction/client-inference.ts';
import { validerLeconsExtraites } from '../apprentissage/extraction/garde-sortie.ts';
import { construirePromptExtraction } from '../apprentissage/extraction/prompts.ts';
import type { ResumeMission } from '../apprentissage/types.ts';

const RESUME_EXEMPLE: ResumeMission = {
  missionId: 'banc-inference-reel',
  sessionId: 'banc-inference-reel',
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
  extraitFinal:
    'Correctif appliqué : le collecteur de télémétrie oubliait de vider ses tâches de fond ' +
    'après une relance. Vérifié sur 100 cycles sans croissance mémoire, tests verts.',
};

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main(): Promise<void> {
  const configDir = process.env['CCREMOTE_APPRENTISSAGE_CONFIG_DIR'];
  const modele = process.env['CCREMOTE_APPRENTISSAGE_MODELE'] ?? MODELE_APPRENTISSAGE_PAR_DEFAUT;
  horodate(`CONFIG_DIR=${configDir ?? '(repli compte-a)'} MODELE=${modele}`);

  const prompt = construirePromptExtraction(RESUME_EXEMPLE, []);
  horodate(`prompt construit (${prompt.length} caractères)`);

  const client = creerClientInference();
  const depart = performance.now();
  const reponse = await client.appelerModele({ prompt });
  const dureeMs = performance.now() - depart;

  horodate(`réponse en ${dureeMs.toFixed(0)} ms :`);
  console.log(JSON.stringify(reponse, null, 2));

  if (!reponse.disponible) {
    horodate('modèle indisponible — résultat TYPÉ, aucune exception n’a remonté.');
    return;
  }

  const verdict = validerLeconsExtraites(reponse.contenu);
  horodate('verdict de la garde de sortie :');
  console.log(JSON.stringify(verdict, null, 2));
}

await main();
