// Responsabilité : l'ouverture d'un terminal à distance — authentifier, valider la cible, passer en WebSocket.
import type { Server } from 'bun';
import { z } from 'zod';
import { CibleTerminal } from '../../commun/appareil.ts';
import { type Acces, PROTOCOLE_FLUX } from '../acces/acces.ts';
import { erreur, REFUS_POSTE } from '../clients/http.ts';
import type { Postes } from '../parc/postes.ts';
import { donneesTerminal } from './terminaux.ts';

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
  if (!postes.enLigne(r.data.machine)) return erreur(`${r.data.machine} est hors ligne`, REFUS_POSTE);
  const parProtocole = (req.headers.get('sec-websocket-protocol') ?? '').startsWith(PROTOCOLE_FLUX);
  const data = donneesTerminal(r.data.machine, r.data.cible, r.data.colonnes, r.data.lignes);
  // Bun refuse un objet d'en-têtes vide : le client natif (jeton en Authorization) n'en reçoit aucun.
  const options = parProtocole ? { data, headers: { 'Sec-WebSocket-Protocol': PROTOCOLE_FLUX } } : { data };
  return serveur.upgrade(req, options) ? undefined : erreur('WebSocket attendu', 426);
}
