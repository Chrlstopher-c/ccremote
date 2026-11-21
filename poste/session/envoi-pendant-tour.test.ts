// Un message de Chris envoyé pendant un tour part dans le flux d'entrée du SDK tout de suite (priorité « next »),
// sans attendre le `result` du tour, et ne fait qu'une bulle dans le fil.
import { describe, expect, test } from 'bun:test';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { attendre, nouvelleSession } from './faux-sdk.ts';
import { LIGNE_INTERRUPTION } from './session-sdk-envoi.ts';

describe('envoi pendant un tour', () => {
  test('le message entre dans le flux pendant le tour, priorité « next », sans attendre le result', async () => {
    const recus: SDKUserMessage[] = [];
    const textes: string[] = [];
    let libere: () => void = () => undefined;
    const attente = new Promise<void>((r) => {
      libere = r;
    });
    const { session } = nouvelleSession(
      async (texte) => {
        textes.push(texte);
        if (texte === 'un') await attente;
        return [{ type: 'result' }];
      },
      { messagesRecus: recus },
    );
    await session.lancer('un');
    await session.envoyer('deux');
    await attendre(() => recus.length >= 2);
    expect(textes).toEqual(['un']);
    expect(recus[1]?.priority).toBe('next');
    expect(recus[1]?.message.content).toBe('deux');
    libere();
  });

  test('une seule bulle pour le message : l’envoi, puis aucune bulle à la prise par le SDK', async () => {
    const recus: SDKUserMessage[] = [];
    let libere: () => void = () => undefined;
    const attente = new Promise<void>((r) => {
      libere = r;
    });
    const { session, evenements } = nouvelleSession(
      async (texte) => {
        if (texte === 'un') await attente;
        return [{ type: 'result' }];
      },
      { messagesRecus: recus },
    );
    await session.lancer('un');
    await session.envoyer('deux');
    libere();
    await attendre(() => evenements.some((e) => e.type === 'tour_fini'));
    const bulles = evenements.filter((e) => e.type === 'message' && e.texte === 'deux');
    expect(bulles).toHaveLength(1);
  });

  test('envoi maintenant : tour interrompu, message ensuite avec la ligne explicite, une seule bulle', async () => {
    const recus: SDKUserMessage[] = [];
    const textes: string[] = [];
    const { session, evenements } = nouvelleSession(
      async (texte, requete) => {
        textes.push(texte);
        if (texte === 'un') await attendre(() => requete.interrompue);
        return [{ type: 'result' }];
      },
      { messagesRecus: recus },
    );
    await session.lancer('un');
    await attendre(() => recus.length >= 1);
    expect(await session.envoyer('deux', [], undefined, true)).toBeNull();
    await attendre(() => textes.length >= 2);
    expect(textes[0]).toBe('un');
    expect(recus[1]?.message.content).toBe(`${LIGNE_INTERRUPTION}\ndeux`);
    expect(evenements.filter((e) => e.type === 'message' && e.texte === 'deux')).toHaveLength(1);
  });
});

