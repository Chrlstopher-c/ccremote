// Responsabilité : commandes locales du relais, lancées sur sa machine avec son fichier d'environnement — `appairer`
// (affiche un code d'appairage à échanger contre une clé d'appareil) et `jeton-poste` (émet le secret d'un poste neuf,
// à poser dans sa configuration). Ce processus est distinct du relais, qui lit les jetons au démarrage : le redémarrer
// après une émission (l'appairage avec `machine` est, lui, pris en compte à chaud).
import { chargerConfig, type ConfigRelais } from './config.ts';
import { codeAppairageNeuf } from './acces/appairage.ts';
import { ouvrirBase } from './registre/base.ts';
import { Registre } from './registre/registre.ts';
import { emettreJetonPoste } from './machines/jeton-poste.ts';

const AIDE = `usage :
  bun run relais/commande.ts appairer
  bun run relais/commande.ts jeton-poste <machine> <adresse WebSocket du relais, ws://…/poste>`;

/** Un code d'appairage neuf, stocké (empreinte seulement) : rendu une fois, valable 10 minutes, usage unique. */
export function appairerLocal(config: ConfigRelais): string {
  const base = ouvrirBase(config.base);
  try {
    const c = codeAppairageNeuf();
    new Registre(base).creerCodeAppairage(c.empreinte, c.expireLe, 'commande locale');
    return `${c.code}\nvalable jusqu’à ${c.expireLe} (usage unique)`;
  } finally {
    base.close();
  }
}

/** Émet le secret d'un poste (commande locale : jamais de renouvellement silencieux) et rend ses deux fichiers. */
export function jetonPoste(
  dossier: string,
  machine: string,
  relais: string,
): { readonly posteJson: string; readonly posteEnv: string } {
  const { fichiers } = emettreJetonPoste({ dossier, machine, relais, secrets: new Map(), remplacer: false });
  return fichiers;
}

/** Exécute une commande et rend ce qu'elle affiche. Une commande inconnue ou absente lève une erreur avec l'aide. */
export function executer(argv: readonly string[], config: ConfigRelais): string {
  const [commande, ...args] = argv;
  if (commande === 'appairer') return appairerLocal(config);
  if (commande === 'jeton-poste' && args.length === 2) {
    const [machine = '', relais = ''] = args;
    const sortie = jetonPoste(config.dossierSecrets, machine, relais);
    return [
      '# poste.json (dans le dossier de configuration du poste)',
      sortie.posteJson,
      '# poste.env (secret : jamais dans un fichier suivi)',
      sortie.posteEnv,
      `Le relais lit ses jetons de poste au démarrage : le redémarrer pour que « ${machine} » se connecte.`,
    ].join('\n');
  }
  throw new Error(AIDE);
}

if (import.meta.main) {
  try {
    console.log(executer(process.argv.slice(2), chargerConfig()));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
