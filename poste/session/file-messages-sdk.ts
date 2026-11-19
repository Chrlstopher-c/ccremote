// Responsabilité : alimenter la requête d'une session SDK — une file asynchrone que Chris remplit, et le message
// utilisateur qu'attend le SDK. Le premier message ne part qu'une fois les connecteurs MCP prêts.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'pino';
import type { BlocPiece } from '../presentation/pieces.ts';

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

// Pièces de Chris (images, PDF) : le texte d'abord, puis les blocs, dans le même message.
export function messageUtilisateur(texte: string, blocs: readonly BlocPiece[] = [], uuid?: SDKUserMessage['uuid']): SDKUserMessage {
  const contenu = blocs.length > 0 ? [{ type: 'text' as const, text: texte }, ...blocs] : texte;
  return { type: 'user', message: { role: 'user', content: contenu }, parent_tool_use_id: null, ...(uuid ? { uuid } : {}) };
}

export function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface EtatMcp {
  readonly name: string;
  readonly status: string;
}

// Le premier message n'attend que les connecteurs MCP de la config : le SDK ne les a pas tous à l'init.
// `surEtats` reçoit chaque relevé : la fiche garde ainsi les connecteurs sans appel de plus au SDK.
export async function attendreConnecteurs(
  requete: { mcpServerStatus(): Promise<readonly EtatMcp[]> },
  reglage: { readonly delaiMs: number; readonly periodeMs: number; readonly session: string },
  journal: Logger,
  surEtats: (etats: readonly EtatMcp[]) => void = () => undefined,
): Promise<void> {
  const fin = Date.now() + reglage.delaiMs;
  try {
    while (Date.now() < fin) {
      const etats = await requete.mcpServerStatus();
      surEtats(etats);
      if (!etats.some((e) => e.status === 'pending')) return;
      await pause(reglage.periodeMs);
    }
    journal.warn({ session: reglage.session }, 'connecteurs MCP encore en attente : message envoyé quand même');
  } catch (erreur) {
    journal.warn({ err: erreur, session: reglage.session }, 'état des connecteurs MCP illisible');
  }
}
