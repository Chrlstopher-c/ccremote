// Responsabilité : l'ouverture d'un terminal à distance — authentifier, valider la cible, passer en WebSocket.
// Deux entrées : une cible libre (`/api/terminal`), ou une session (`/api/sessions/:id/terminal`) dont le relais
// tire la machine et le dossier : le client n'a pas à les connaître.
import type { Server } from 'bun';
import { z } from 'zod';
import { CibleTerminal } from '../../commun/appareil.ts';
import { type Acces, PROTOCOLE_FLUX } from '../acces/acces.ts';
import { erreur, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { donneesTerminal, type DonneesTerminal } from './terminaux.ts';

const Parametres = z.object({
  machine: z.string().min(1),
  cible: CibleTerminal,
  colonnes: z.coerce.number().int().min(2).max(1000).default(100),
  lignes: z.coerce.number().int().min(2).max(1000).default(30),
});

function cibleDe(p: URLSearchParams): unknown {
  const tmux = p.get('tmux');
  if (tmux) return { type: 'tmux', tmux };
  const dossier = p.get('dossier');
  return dossier ? { type: 'shell', dossier } : { type: 'shell' };
}

/** Passe la requête en WebSocket de terminal, ou rend l'erreur HTTP qui la refuse. */
function passerEnTerminal(
  req: Request,
  serveur: Server<unknown>,
  postes: Postes,
  data: DonneesTerminal,
): Response | undefined {
  if (!postes.enLigne(data.machine)) return erreur(`${data.machine} est hors ligne`, REFUS_POSTE);
  const parProtocole = (req.headers.get('sec-websocket-protocol') ?? '').startsWith(PROTOCOLE_FLUX);
  // Bun refuse un objet d'en-têtes vide : le client natif (jeton en Authorization) n'en reçoit aucun.
  const options = parProtocole ? { data, headers: { 'Sec-WebSocket-Protocol': PROTOCOLE_FLUX } } : { data };
  return serveur.upgrade(req, options) ? undefined : erreur('WebSocket attendu', 426);
}

export function ouvrirTerminal(
  req: Request,
  serveur: Server<unknown>,
  acces: Acces,
  postes: Postes,
): Response | undefined {
  if (!acces.autorise(req)) return erreur('non connecté', 401);
  const p = new URL(req.url).searchParams;
  const r = Parametres.safeParse({
    machine: p.get('machine'),
    cible: cibleDe(p),
    colonnes: p.get('colonnes') ?? undefined,
    lignes: p.get('lignes') ?? undefined,
  });
  if (!r.success) return erreur('terminal : paramètres invalides');
  const data = donneesTerminal(r.data.machine, r.data.cible, r.data.colonnes, r.data.lignes);
  return passerEnTerminal(req, serveur, postes, data);
}

/** Terminal dans le dossier de la session, sur la machine de la session. */
export function ouvrirTerminalSession(
  req: Request,
  serveur: Server<unknown>,
  acces: Acces,
  postes: Postes,
  registre: Pick<Registre, 'session'>,
  id: string,
): Response | undefined {
  if (!acces.autorise(req)) return erreur('non connecté', 401);
  const session = registre.session(id);
  if (!session) return erreur('session inconnue', 404);
  const p = new URL(req.url).searchParams;
  const r = z
    .object({
      colonnes: z.coerce.number().int().min(2).max(1000).default(100),
      lignes: z.coerce.number().int().min(2).max(1000).default(30),
    })
    .safeParse({ colonnes: p.get('colonnes') ?? undefined, lignes: p.get('lignes') ?? undefined });
  if (!r.success) return erreur('terminal : paramètres invalides');
  const cible = { type: 'shell' as const, dossier: session.cwd };
  const data = donneesTerminal(session.machine, cible, r.data.colonnes, r.data.lignes);
  return passerEnTerminal(req, serveur, postes, data);
}
