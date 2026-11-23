// Responsabilité : démarrage de l'aiguilleur à partir de l'environnement — annuaire, plafond d'échecs, écoutes HTTP.
import { creerJournal } from '../../commun/journal.ts';
import { PlafondEchecs } from '../acces/plafond.ts';
import { chargerConfigAiguilleur } from '../config.ts';
import { ouvrirAnnuaire } from './annuaire-base.ts';
import { Annuaire } from './annuaire.ts';
import { type Aiguilleur, creerAiguilleur } from './aiguilleur.ts';

const INTERVALLE_BALAYAGE_MS = 2000;

/** Les commandes locales écrivent dans l'annuaire : le balayage ferme les liens d'un membre révoqué dans ce délai. */
export function demarrerAiguilleur(env: Readonly<Record<string, string | undefined>> = process.env): Aiguilleur {
  const config = chargerConfigAiguilleur(env);
  const journal = creerJournal('aiguilleur');
  const annuaire = new Annuaire(ouvrirAnnuaire(config.base));
  const plafond = new PlafondEchecs(config.fichierEchecs, journal.child({ domaine: 'acces' }));
  const aiguilleur = creerAiguilleur({
    annuaire,
    journal,
    plafond,
    intervalleBalayageMs: INTERVALLE_BALAYAGE_MS,
    vpnInvites: config.vpnInvites,
  });
  for (const { hote, port } of config.ecouteWeb) {
    Bun.serve({ hostname: hote, port, idleTimeout: 75, fetch: aiguilleur.fetch, websocket: aiguilleur.websocket });
  }
  journal.info(
    { web: config.ecouteWeb.map((a) => `${a.hote}:${a.port}`), vpnInvites: config.vpnInvites !== null },
    'aiguilleur démarré',
  );
  return aiguilleur;
}
