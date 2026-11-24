// Responsabilité : point d'entrée de la CLI noctis-nav quand node l'exécute (lanceurs sh et cmd) ; la logique est dans
// cli.mjs. Le binaire compilé passe par la sous-commande `nav` (sous-commande.ts) et n'a pas besoin de ce fichier.
import { executerCli } from './cli.mjs';

process.exitCode = await executerCli(process.argv.slice(2));
