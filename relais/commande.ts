// Responsabilité : commandes locales du relais, lancées sur sa machine avec son fichier d'environnement — `appairer`
// (affiche un code d'appairage à échanger contre une clé d'appareil) et `jeton-poste` (émet le secret d'un poste neuf,
// à poser dans sa configuration). Le relais lit les jetons de poste au démarrage : le redémarrer après une émission.
import { join } from 'node:path';
import { chargerConfig, type ConfigRelais } from './config.ts';
import { codeAppairageNeuf } from './acces/appairage.ts';
import { ouvrirBase } from './registre/base.ts';
import { Registre } from './registre/registre.ts';
import { fichiersPoste } from './machines/installer.ts';
import { chargerSecretsPostes, secretPoste } from './machines/secrets.ts';

const AIDE = `usage :
  bun run relais/commande.ts appairer
  bun run relais/commande.ts jeton-poste <machine> <adresse WebSocket du relais, ws://…/poste>`;
const MACHINE_VALIDE = /^[a-z0-9-]+$/;
const RELAIS_VALIDE = /^wss?:\/\//;

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

/** Émet le secret d'un poste : fichier 600 dans le dossier des secrets, et les deux fichiers de config du poste. */
export function jetonPoste(
  dossier: string,
  machine: string,
  relais: string,
): { readonly posteJson: string; readonly posteEnv: string } {
  if (!MACHINE_VALIDE.test(machine)) throw new Error(`identifiant de poste invalide : « ${machine} »`);
  if (!RELAIS_VALIDE.test(relais)) throw new Error('adresse du relais invalide : ws:// ou wss:// attendu');
  if (chargerSecretsPostes(dossier).has(machine)) {
    const fichier = join(dossier, `${machine}.secret`);
    throw new Error(`un jeton existe déjà pour « ${machine} » : supprimer ${fichier} pour le renouveler`);
  }
  const secret = secretPoste(dossier, machine, new Map());
  return fichiersPoste(machine, machine, relais, secret);
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
