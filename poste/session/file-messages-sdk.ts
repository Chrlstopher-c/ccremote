// Responsabilité : alimenter la requête d'une session SDK — une file asynchrone que Chris remplit, et le message
// utilisateur qu'attend le SDK. Le premier message ne part qu'une fois les connecteurs MCP prêts.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class FileAsynchrone<T> implements AsyncIterable<T> {
  private readonly valeurs: { readonly valeur: T }[] = [];
  private attente: ((r: IteratorResult<T>) => void) | null = null;
  private clos = false;

  push(valeur: T): void {
    if (this.clos) return;
    const resoudre = this.attente;
    if (resoudre) {
      this.attente = null;
      resoudre({ value: valeur, done: false });
    } else {
      this.valeurs.push({ valeur });
    }
  }

  clore(): void {
    this.clos = true;
    const resoudre = this.attente;
    this.attente = null;
    resoudre?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.suivant() };
  }

  private suivant(): Promise<IteratorResult<T>> {
    const suivant = this.valeurs.shift();
    if (suivant) return Promise.resolve({ value: suivant.valeur, done: false });
    if (this.clos) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resoudre) => {
      this.attente = resoudre;
    });
  }
}

export async function* messagesAvecConnecteurs(
  fil: AsyncIterable<SDKUserMessage>,
  pret: Promise<void>,
): AsyncGenerator<SDKUserMessage> {
  for await (const message of fil) {
    await pret;
    yield message;
  }
}

export function messageUtilisateur(texte: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: texte }, parent_tool_use_id: null };
}
