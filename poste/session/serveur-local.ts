// Responsabilité : le socket Unix local par lequel les crochets et le MCP de rythme des sessions joignent le poste.
// Local à la machine, fichier en 0600 : seul l'utilisateur du poste (donc ses Claude) peut y parler.
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import type { Logger } from 'pino';
import type { GestionnaireSessions } from './gestionnaire.ts';

export function servirLocal(socket: string, sessions: GestionnaireSessions, journal: Logger): void {
  if (existsSync(socket)) unlinkSync(socket);
  Bun.serve({
    unix: socket,
    async fetch(req) {
      const url = new URL(req.url);
      const [, famille, nom] = url.pathname.split('/');
      const session = sessions.session(url.searchParams.get('session') ?? '');
      if (!session || !nom) return new Response('session inconnue', { status: 404 });
      let corps: Record<string, unknown> = {};
      try {
        corps = (await req.json()) as Record<string, unknown>;
      } catch {
        journal.debug({ famille, nom }, 'corps de crochet vide ou illisible');
      }
      if (famille === 'crochet') return Response.json(session.crochet(nom, corps));
      if (famille === 'rythme') return new Response(session.rythme(nom, corps));
      return new Response('introuvable', { status: 404 });
    },
  });
  chmodSync(socket, 0o600);
}
