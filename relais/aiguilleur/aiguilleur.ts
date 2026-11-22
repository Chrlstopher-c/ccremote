// Responsabilité : l'aiguilleur, vu du réseau — les routes HTTP (appairage des membres, lien sortant `/aiguilleur`
// authentifié par jeton), la configuration du serveur WebSocket et le balayage périodique des révocations.
import type { Logger } from 'pino';
import type { Server, WebSocketHandler } from 'bun';
import { TAILLE_MAX_TRAME_OCTETS } from '../../commun/aiguilleur.ts';
import type { PlafondEchecs } from '../acces/plafond.ts';
import { erreur } from '../clients/http.ts';
import { type Annuaire, type Membre, empreinteSha256 } from './annuaire.ts';
import { CHEMIN_APPAIRAGE, routeAppairage } from './api-membres.ts';
import { type DonneesLien, Liens } from './liens.ts';

export const CHEMIN_LIEN = '/aiguilleur';

export interface OptionsAiguilleur {
  readonly annuaire: Annuaire;
  readonly journal: Logger;
  readonly plafond: PlafondEchecs;
  readonly maxCanaux?: number;
  /** Intervalle du balayage des révocations ; absent ou nul : pas de minuteur (le balayage se fait à la main). */
  readonly intervalleBalayageMs?: number;
}

export interface Aiguilleur {
  // undefined : la connexion a basculé en WebSocket (rien à répondre).
  readonly fetch: (req: Request, serveur: Server<DonneesLien>) => Response | Promise<Response> | undefined;
  readonly websocket: WebSocketHandler<DonneesLien>;
  balayer(): void;
  arreter(): void;
}

export function creerAiguilleur(options: OptionsAiguilleur): Aiguilleur {
  const liens = new Liens(options.annuaire, options.journal, options.maxCanaux);
  const appairage = routeAppairage(options.annuaire, options.plafond, options.journal);
  const minuteur = options.intervalleBalayageMs
    ? setInterval(() => liens.balayer(), options.intervalleBalayageMs)
    : null;
  return {
    fetch(req, serveur) {
      const chemin = new URL(req.url).pathname;
      if (chemin === CHEMIN_LIEN) return ouvrirLien(options.annuaire, options.journal, req, serveur);
      if (chemin === CHEMIN_APPAIRAGE && req.method === 'POST') return appairage(req, serveur);
      return erreur('introuvable', 404);
    },
    websocket: {
      // Bun remplit `data` à chaque connexion (upgrade) : la valeur de départ n'est jamais lue.
      data: {} as DonneesLien,
      open: (ws) => liens.ouvrir(ws),
      close: (ws) => liens.fermer(ws),
      message: (ws, m) => liens.recevoir(ws, m),
      idleTimeout: 120,
      sendPings: true,
      maxPayloadLength: TAILLE_MAX_TRAME_OCTETS,
    },
    balayer: () => liens.balayer(),
    arreter: () => {
      if (minuteur) clearInterval(minuteur);
    },
  };
}

function chercherMembre(annuaire: Annuaire, journal: Logger, jeton: string): Membre | null {
  try {
    return annuaire.membreDuJeton(empreinteSha256(jeton));
  } catch (e) {
    journal.error({ err: e }, 'lien : lecture de l’annuaire en échec');
    return null;
  }
}

// Le jeton d'un membre voyage dans l'en-tête Authorization (clients natifs) ; haché avant toute recherche.
function ouvrirLien(
  annuaire: Annuaire,
  journal: Logger,
  req: Request,
  serveur: Server<DonneesLien>,
): Response | undefined {
  const entete = req.headers.get('authorization') ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : '';
  const membre = jeton ? chercherMembre(annuaire, journal, jeton) : null;
  if (!membre || membre.revoqueLe) {
    journal.warn('lien refusé : jeton absent, inconnu ou révoqué');
    return erreur('non connecté', 401);
  }
  return serveur.upgrade(req, { data: { membre: membre.id } }) ? undefined : erreur('WebSocket attendu', 426);
}
