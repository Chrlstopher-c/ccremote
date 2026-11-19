// Responsabilité : attendre que le poste local soit en ligne sur le relais embarqué, puis annoncer le moteur prêt.
import type { Logger } from 'pino';
import { z } from 'zod';

export const LIGNE_PRET = 'LANTERNE-MOTEUR-PRET';
const INTERVALLE_MS = 500;

const EtatRelais = z.object({ machines: z.array(z.object({ id: z.string(), enLigne: z.boolean() })) });

export function ligneDePret(machine: string, version: string): string {
  return `${LIGNE_PRET} ${JSON.stringify({ machine, version })}\n`;
}

export async function attendrePosteLocal(
  url: string,
  jeton: string,
  machine: string,
  delaiMs: number,
  journal: Logger,
): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (await estEnLigne(url, jeton, machine, journal)) return;
    await Bun.sleep(INTERVALLE_MS);
  }
  throw new Error(`le poste local ne s'est pas connecté au relais dans ${delaiMs / 1000} s`);
}

async function estEnLigne(url: string, jeton: string, machine: string, journal: Logger): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/etat`, {
      headers: { authorization: `Bearer ${jeton}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return false;
    const etat = EtatRelais.safeParse(await r.json());
    return etat.success && etat.data.machines.some((m) => m.id === machine && m.enLigne);
  } catch (erreur) {
    journal.debug({ err: erreur }, 'relais pas encore prêt, nouvel essai');
    return false;
  }
}
