// Responsabilité : la persistance des réunions dans la base SQLite du relais — création, participants, messages,
// lecture. Aucune règle de salle ici : ce qui est écrit est décidé par `salle.ts`.
import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { MessageReunion, type Reunion } from '../../commun/reunion.ts';

type LigneReunion = { id: string; sujet: string; cree_le: string; participants: string };
type LigneMessage = { id: string; auteur: string; texte: string; ts: string; destinataires: string };

const Identifiants = z.array(z.string());

export interface NouvelleReunion {
  readonly id: string;
  readonly sujet: string;
  readonly creeLe: string;
}

export class RegistreReunions {
  constructor(private readonly db: Database) {}

  creer(reunion: NouvelleReunion): void {
    this.db
      .query<never, { i: string; s: string; c: string }>(
        `INSERT INTO reunions (id, sujet, cree_le, participants) VALUES ($i, $s, $c, '[]')`,
      )
      .run({ i: reunion.id, s: reunion.sujet, c: reunion.creeLe });
  }

  ajouterParticipants(id: string, sessionIds: readonly string[]): void {
    const ligne = this.db
      .query<{ participants: string }, { i: string }>('SELECT participants FROM reunions WHERE id = $i')
      .get({ i: id });
    if (!ligne) return;
    const fusion = [...new Set([...Identifiants.parse(JSON.parse(ligne.participants)), ...sessionIds])];
    this.db
      .query<never, { i: string; p: string }>('UPDATE reunions SET participants = $p WHERE id = $i')
      .run({ i: id, p: JSON.stringify(fusion) });
  }

  ajouterMessage(reunionId: string, message: MessageReunion): void {
    this.db
      .query<never, { i: string; r: string; a: string; t: string; ts: string; d: string }>(
        `INSERT INTO reunion_messages (id, reunion_id, auteur, texte, ts, destinataires)
         VALUES ($i, $r, $a, $t, $ts, $d)`,
      )
      .run({
        i: message.id,
        r: reunionId,
        a: message.auteur,
        t: message.texte,
        ts: message.ts,
        d: JSON.stringify(message.destinataires),
      });
  }

  majTexte(messageId: string, texte: string): void {
    this.db
      .query<never, { i: string; t: string }>('UPDATE reunion_messages SET texte = $t WHERE id = $i')
      .run({ i: messageId, t: texte });
  }

  lire(id: string): Reunion | null {
    const ligne = this.db
      .query<LigneReunion, { i: string }>('SELECT id, sujet, cree_le, participants FROM reunions WHERE id = $i')
      .get({ i: id });
    return ligne ? this.vue(ligne) : null;
  }

  lister(limite: number): Reunion[] {
    return this.db
      .query<LigneReunion, { l: number }>(
        'SELECT id, sujet, cree_le, participants FROM reunions ORDER BY cree_le DESC, id LIMIT $l',
      )
      .all({ l: limite })
      .map((ligne) => this.vue(ligne));
  }

  private vue(ligne: LigneReunion): Reunion {
    const messages = this.db
      .query<LigneMessage, { r: string }>(
        'SELECT id, auteur, texte, ts, destinataires FROM reunion_messages WHERE reunion_id = $r ORDER BY seq',
      )
      .all({ r: ligne.id });
    return {
      id: ligne.id,
      sujet: ligne.sujet,
      creeLe: ligne.cree_le,
      participants: Identifiants.parse(JSON.parse(ligne.participants)),
      messages: messages.map((m) => ({
        id: m.id,
        auteur: m.auteur,
        texte: m.texte,
        ts: m.ts,
        destinataires: Identifiants.parse(JSON.parse(m.destinataires)),
      })),
    };
  }
}
