// Responsabilité : l'environnement du relais et du poste local, et le fichier de configuration du poste (pur).
import { join } from 'node:path';

export interface ParametresEnvironnement {
  readonly donnees: string;
  readonly portWeb: number;
  readonly portPostes: number;
  readonly machine: string;
  readonly description: string;
  readonly secret: string;
  readonly empreinte: string;
  readonly claude: string | null;
  readonly socketTmux: string;
  readonly cc: string | null;
  readonly tmuxConf: string | null;
  readonly journal: string;
}

export interface ContenuPosteJson {
  readonly machine: string;
  readonly relais: string;
  readonly description: string;
  readonly racines: readonly string[];
  readonly donnees: string;
}

/** Les chemins que relais et poste lisent : une seule source, pour que rien n'aille chercher le réel de Chris. */
export function cheminsMoteur(donnees: string): { base: string; posteJson: string; secrets: string; poste: string } {
  return {
    base: join(donnees, 'relais.db'),
    posteJson: join(donnees, 'poste/poste.json'),
    secrets: join(donnees, 'secrets'),
    poste: join(donnees, 'poste'),
  };
}

export function construireEnvironnement(p: ParametresEnvironnement): Record<string, string> {
  const chemins = cheminsMoteur(p.donnees);
  const sansInterface = join(p.donnees, 'sans-interface');
  const env: Record<string, string> = {
    CCREMOTE_BASE: chemins.base,
    CCREMOTE_EMPREINTE_MOT_DE_PASSE: p.empreinte,
    CCREMOTE_SECRETS_POSTES: `${p.machine}=${p.secret}`,
    QUART_CONFIG_RELAIS: chemins.secrets,
    CCREMOTE_PORT_WEB: String(p.portWeb),
    CCREMOTE_HOTES_WEB: '127.0.0.1',
    CCREMOTE_PORT_POSTES: String(p.portPostes),
    CCREMOTE_HOTE_POSTES: '127.0.0.1',
    CCREMOTE_WEB: sansInterface,
    CCREMOTE_HQ: sansInterface,
    CCREMOTE_CONFIG_POSTE: chemins.posteJson,
    CCREMOTE_SECRET_POSTE: p.secret,
    CCREMOTE_TMUX_SOCKET: p.socketTmux,
    CCREMOTE_JOURNAL: p.journal,
    CCREMOTE_ADOPTER_TERMINAUX: 'non',
  };
  if (p.claude) env['CCREMOTE_CLAUDE'] = p.claude;
  if (p.cc) env['CCREMOTE_CC'] = p.cc;
  if (p.tmuxConf) env['CCREMOTE_TMUX_CONF'] = p.tmuxConf;
  return env;
}

/** poste.json : le poste local se connecte au relais embarqué, sur sa boucle, et voit le répertoire personnel. */
export function contenuPosteJson(p: ParametresEnvironnement): ContenuPosteJson {
  return {
    machine: p.machine,
    relais: `ws://127.0.0.1:${p.portPostes}/poste`,
    description: p.description,
    racines: ['~'],
    donnees: join(p.donnees, 'poste'),
  };
}
