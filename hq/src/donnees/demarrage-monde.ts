// Responsabilité : brancher une source sur le magasin — choix de la source selon la configuration, chargement de l'état
// et des fils, et resynchronisation après une coupure du flux.
import type { ConfigMonde } from './config';
import { creerSourceDemo } from './demo';
import { journaliser } from './journal';
import type { MagasinMonde } from './monde-etat';
import type { EtatLien, SourceMonde } from './source-monde';
import { creerSourceRelais } from './transport';

export function creerSourceMonde(config: ConfigMonde): SourceMonde {
  if (config.source === 'relais') return creerSourceRelais({ base: config.base, jeton: config.jeton });
  return creerSourceDemo();
}

// Charge l'état, puis écoute le flux. Renvoie la fonction d'arrêt.
export async function demarrerMonde(source: SourceMonde, magasin: MagasinMonde): Promise<() => void> {
  await synchroniser(source, magasin);
  let apresCoupure = false;
  source.demarrer({
    surMessage: (message) => magasin.appliquer(message),
    surLien: (lien: EtatLien) => {
      magasin.definirLien(lien);
      if (lien === 'coupe') apresCoupure = true;
      if (lien === 'ouvert' && apresCoupure) {
        apresCoupure = false;
        synchroniser(source, magasin).catch(() => undefined); // déjà journalisé dans synchroniser
      }
    },
  });
  return () => source.arreter();
}

async function synchroniser(source: SourceMonde, magasin: MagasinMonde): Promise<void> {
  try {
    magasin.initialiser(await source.etatInitial());
  } catch (erreur) {
    journaliser('error', 'état du monde indisponible', { source: source.nom, erreur: String(erreur) });
    throw erreur;
  }
  await Promise.all(magasin.lire().sessions.map((s) => chargerFil(source, magasin, s.id)));
}

async function chargerFil(source: SourceMonde, magasin: MagasinMonde, sessionId: string): Promise<void> {
  try {
    magasin.chargerFil(sessionId, await source.evenements(sessionId));
  } catch (erreur) {
    journaliser('warn', 'fil de session indisponible', { sessionId, erreur: String(erreur) });
  }
}
