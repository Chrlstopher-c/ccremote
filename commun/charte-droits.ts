// Responsabilité : les droits de la charte (voir, piloter, lancer, remoteControl) et les droits des amis du duo par
// machine — schémas, cohérence et nettoyage au retrait d'une machine. Aucune E/S ; ne dépend de la charte qu'en type.
import { z } from 'zod';
import type { Charte } from './charte.ts';

export const DROITS = ['voir', 'piloter', 'lancer', 'remoteControl'] as const;
export type Droit = (typeof DROITS)[number];
export const Droits = z.object({
  voir: z.boolean(),
  piloter: z.boolean(),
  lancer: z.boolean(),
  remoteControl: z.boolean(),
});
export type Droits = z.infer<typeof Droits>;
export const TOUS_DROITS: Droits = { voir: true, piloter: true, lancer: true, remoteControl: true };
export const AUCUN_DROIT: Droits = { voir: false, piloter: false, lancer: false, remoteControl: false };

export const ID_MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);
export const NOMBRE_MAX_AMIS = 50;

/** Droits d'un ami du duo, par machine du réseau : une machine absente de `machines` ne lui est pas ouverte. */
export const AmiCharte = z.object({
  ami: ID_MEMBRE,
  machines: z.record(ID_MEMBRE, Droits),
});
export type AmiCharte = z.infer<typeof AmiCharte>;

/** Un ami par entrée, et seulement des machines du parc (serveur ou pair non invité) dans ses droits. */
export function amisCoherents(c: Charte): boolean {
  const amis = c.amis ?? [];
  if (new Set(amis.map((a) => a.ami)).size !== amis.length) return false;
  return amis.every((a) =>
    Object.keys(a.machines).every((id) => {
      const cible = c.membres.find((m) => m.id === id);
      return cible !== undefined && cible.invite === undefined && cible.sorte !== 'telephone';
    }),
  );
}

/** Retire une machine retirée des droits de ses amis du duo (sinon la charte ne se relirait plus). */
export function sansMachineAmis(c: Charte, machine: string): Charte {
  if (c.amis === undefined) return c;
  const amis = c.amis.map((a) => ({
    ...a,
    machines: Object.fromEntries(Object.entries(a.machines).filter(([id]) => id !== machine)),
  }));
  return { ...c, amis };
}
