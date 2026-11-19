// Responsabilité : point d'entrée du binaire lanterne-moteur — relais + poste local, et les sous-commandes du poste
// (`crochet <événement>` pour les hooks de Claude, `rythme` pour le serveur MCP de rythme des sessions).
import { executerCrochet } from '../poste/session/crochet.ts';
import { ErreurParametres, lireParametres } from './parametres.ts';
import { lancerMoteur } from './moteur.ts';

async function principal(): Promise<void> {
  const [, , sousCommande, argument] = process.argv;
  if (sousCommande === 'crochet') return executerCrochet(argument);
  if (sousCommande === 'rythme') return void (await import('../poste/session/mcp-rythme.ts'));
  try {
    return await lancerMoteur(lireParametres(process.env));
  } catch (erreur) {
    if (!(erreur instanceof ErreurParametres)) throw erreur;
    process.stderr.write(`lanterne-moteur : ${erreur.message} (variables LANTERNE_MOTEUR_*)\n`);
    process.exit(2);
  }
}

await principal();
