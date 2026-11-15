// Responsabilité : LA configuration de connexion au relais pour toute l'app (source, adresse, jeton). En production
// l'app est servie par le relais sous /hq/ : sans VITE_RELAIS_URL, l'adresse est l'origine de la page.
import { lireConfig, stockageNavigateur, type ConfigMonde } from '../donnees';

export function envRelais(): { VITE_SOURCE?: string; VITE_RELAIS_URL?: string } {
  return {
    VITE_SOURCE: import.meta.env['VITE_SOURCE'],
    VITE_RELAIS_URL: import.meta.env['VITE_RELAIS_URL'] || location.origin,
  };
}

export function configRelais(): ConfigMonde {
  return lireConfig(envRelais(), stockageNavigateur());
}
