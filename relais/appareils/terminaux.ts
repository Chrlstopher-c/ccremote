// Responsabilité : les terminaux à distance côté relais — un WebSocket de client relié à un PTY sur un poste.
// La frappe arrive en binaire et repart telle quelle ; la sortie du poste redescend en binaire au client.
import type { ServerWebSocket } from 'bun';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { type CibleTerminal, MessageClientTerminal } from '../../commun/appareil.ts';
import type { Postes } from '../parc/postes.ts';

export interface DonneesTerminal {
  readonly type: 'terminal';
  readonly terminal: string;
  readonly machine: string;
  readonly cible: CibleTerminal;
  readonly colonnes: number;
  readonly lignes: number;
}

export type ServeurTerminal = ServerWebSocket<DonneesTerminal>;

export function estTerminal(ws: ServerWebSocket<{ readonly type: string }>): ws is ServeurTerminal {
  return ws.data.type === 'terminal';
}

export type MessageTerminalPoste =
  | { readonly kind: 'terminal_sortie'; readonly terminal: string; readonly base64: string }
  | { readonly kind: 'terminal_fin'; readonly terminal: string; readonly code: number | null };

export function donneesTerminal(
  machine: string,
  cible: CibleTerminal,
  colonnes: number,
  lignes: number,
): DonneesTerminal {
  return { type: 'terminal', terminal: randomUUID(), machine, cible, colonnes, lignes };
}

export class TerminauxRelais {
  private readonly clients = new Map<string, ServeurTerminal>();

  constructor(
    private readonly postes: Postes,
    private readonly journal: Logger,
  ) {}

  async ouvert(ws: ServeurTerminal): Promise<void> {
    const { terminal, machine, cible, colonnes, lignes } = ws.data;
    this.clients.set(terminal, ws);
    const r = await this.postes.commander(machine, { kind: 'terminal_ouvrir', terminal, cible, colonnes, lignes });
    if (r.ok) return this.journal.info({ machine, cible }, 'terminal à distance ouvert');
    this.journal.warn({ machine, erreur: r.erreur }, 'terminal à distance refusé');
    ws.send(JSON.stringify({ type: 'erreur', message: r.erreur ?? 'refusé' }));
    ws.close(4409, 'terminal refusé');
  }

  recu(ws: ServeurTerminal, message: string | Buffer): void {
    const { terminal, machine } = ws.data;
    if (typeof message !== 'string') {
      this.postes.envoyer(machine, { kind: 'terminal_entree', terminal, base64: message.toString('base64') });
      return;
    }
    let taille: z.infer<typeof MessageClientTerminal>;
    try {
      taille = MessageClientTerminal.parse(JSON.parse(message));
    } catch {
      return; // un message texte qui n'est pas un redimensionnement n'a aucun sens ici
    }
    this.postes.envoyer(machine, {
      kind: 'terminal_taille',
      terminal,
      colonnes: taille.colonnes,
      lignes: taille.lignes,
    });
  }

  ferme(ws: ServeurTerminal): void {
    const { terminal, machine } = ws.data;
    if (this.clients.get(terminal) !== ws) return;
    this.clients.delete(terminal);
    this.postes.envoyer(machine, { kind: 'terminal_fermer', terminal });
  }

  /** Ce que le poste renvoie. Un poste ne parle qu'aux terminaux ouverts SUR LUI. */
  duPoste(machine: string, m: MessageTerminalPoste): void {
    const ws = this.clients.get(m.terminal);
    if (!ws || ws.data.machine !== machine) return;
    if (m.kind === 'terminal_sortie') {
      ws.send(Buffer.from(m.base64, 'base64'));
      return;
    }
    this.clients.delete(m.terminal);
    ws.send(JSON.stringify({ type: 'fin', code: m.code }));
    ws.close(1000, 'terminal terminé');
  }

  posteDeconnecte(machine: string): void {
    for (const [terminal, ws] of this.clients) {
      if (ws.data.machine !== machine) continue;
      this.clients.delete(terminal);
      ws.send(JSON.stringify({ type: 'erreur', message: `${machine} s’est déconnecté` }));
      ws.close(4410, 'poste déconnecté');
    }
  }
}
