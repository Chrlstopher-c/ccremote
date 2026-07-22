// Pompe temps virtuel ↔ microtâches.
// Une chaîne `await horloge.attendre(...)` ne progresse que si l'on alterne
// avancée du temps simulé et vidange des microtâches. C'est ce que fait `avancerAsync`.

import type { HorlogeSimulee } from './horloge-simulee.ts';

const TOURS_MICROTACHES = 16;
const GARDE_BOUCLE = 10_000;

/** Laisse les continuations `await` déjà résolues s'exécuter. */
export async function vidangerMicrotaches(): Promise<void> {
  for (let tour = 0; tour < TOURS_MICROTACHES; tour += 1) {
    await Promise.resolve();
  }
}

/**
 * Avance le temps simulé de `dureeMs` en déclenchant chaque minuterie à son
 * échéance exacte et en laissant les `await` reprendre entre deux.
 */
export async function avancerAsync(horloge: HorlogeSimulee, dureeMs: number): Promise<void> {
  const cible = horloge.maintenant() + Math.max(0, dureeMs);
  for (let garde = 0; garde < GARDE_BOUCLE; garde += 1) {
    await vidangerMicrotaches();
    const prochaine = horloge.prochaineEcheance();
    if (prochaine === null || prochaine > cible) break;
    horloge.avancerA(prochaine);
  }
  horloge.avancerA(cible);
  await vidangerMicrotaches();
}
