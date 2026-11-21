// Responsabilité : l'aiguillage des messages d'échange du lien (écrire, interrompre, ouvrir, dossiers, usage et leurs
// réponses) vers leur module. Un échec de traitement est journalisé ; il ne coupe jamais le lien.
import type { MessageLien } from '../../commun/duo.ts';
import { recevoirDossiers } from './sessions-pair.ts';
import { recevoirOuverture } from './sessions-pair.ts';
import { recevoirEcriture, recevoirInterruption } from './ecriture.ts';
import { recevoirUsage } from './usage.ts';
import type { Contexte } from './contexte.ts';

/** Rend `true` si le message relève des échanges (et est traité), `false` s'il est d'un autre domaine. */
export function traiterEchange(c: Contexte, nom: string, m: MessageLien): boolean {
  switch (m.type) {
    case 'ecrire':
      return lancer(c, () => recevoirEcriture(c, nom, m));
    case 'interrompre':
      return lancer(c, () => recevoirInterruption(c, nom, m));
    case 'ouvrir_session':
      return lancer(c, () => recevoirOuverture(c, nom, m));
    case 'dossiers':
      recevoirDossiers(c, m.ref);
      return true;
    case 'usage':
      recevoirUsage(c, m.ref);
      return true;
    case 'reponse':
    case 'dossiers_reponse':
    case 'usage_reponse':
      c.attentes.recevoir(m.ref, m);
      return true;
    default:
      return false;
  }
}

function lancer(c: Contexte, travail: () => Promise<void>): boolean {
  travail().catch((erreur: unknown) => c.log.error({ err: erreur }, 'échange du mode duo en échec'));
  return true;
}
