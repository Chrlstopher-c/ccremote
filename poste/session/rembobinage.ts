// Responsabilité : où repart la conversation quand Chris rembobine à un de ses messages. Pur, sans I/O.
export interface EntreeTranscript {
  readonly uuid?: string;
  readonly type: string;
}

export type PointRembobinage =
  | { readonly tag: 'premier' } // premier message : la conversation repart de zéro
  | { readonly tag: 'point'; readonly uuid: string } // la reprise part de l'entrée qui précède le message
  | { readonly tag: 'absent'; readonly raison: string };

export function pointDeRembobinage(entrees: readonly EntreeTranscript[], messageId: string): PointRembobinage {
  const rang = entrees.findIndex((e) => e.uuid === messageId && e.type === 'user');
  if (rang < 0) return { tag: 'absent', raison: 'message introuvable dans la conversation' };
  if (rang === 0) return { tag: 'premier' };
  const precedent = entrees[rang - 1]?.uuid;
  if (!precedent) return { tag: 'absent', raison: 'point de reprise introuvable avant ce message' };
  return { tag: 'point', uuid: precedent };
}
