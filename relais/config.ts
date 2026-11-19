// Responsabilité : la configuration du relais, lue exclusivement dans l'environnement (aucune valeur réelle dans le
// dépôt).
import { dirname, join } from 'node:path';

/** Relais intégré à l'appli (variables LANTERNE_MOTEUR_*) : postes Lanterne joints par tunnel SSH inverse. */
export interface ConfigIntegre {
  readonly instance: string | null; // suffixe des noms distants (banc : « banc »)
  readonly portDistantDefaut: number; // port d'écoute distant par défaut d'une nouvelle machine
  readonly codePoste: string | null; // archive du code du poste embarquée (LANTERNE_MOTEUR_CODE_POSTE)
}

export interface ConfigRelais {
  readonly empreinteMotDePasse: string;
  readonly secretsPostes: ReadonlyMap<string, string>;
  readonly isolees: ReadonlySet<string>;
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
  readonly base: string;
  readonly portWeb: number;
  readonly hotesWeb: readonly string[];
  readonly fichierEchecs: string;
  readonly portPostes: number;
  readonly hotePostes: string | undefined; // absent : toutes les interfaces (comportement d'origine)
  readonly web: string;
  readonly hq: string;
  readonly inactiviteMs: number;
  readonly origines: ReadonlySet<string>;
  readonly echo: { readonly url: string; readonly jeton: string } | null;
  readonly reunionLimite: number; // demandes de Chris relayées par réunion (CCREMOTE_REUNION_LIMITE)
  readonly relaisPostes: string | null; // adresse WebSocket du relais vue des machines SSH (CCREMOTE_RELAIS_POSTES)
  readonly urlApiPostes: string | null; // URL HTTP de l'API vue des postes distants (CCREMOTE_URL_API_POUR_POSTES)
  readonly integre: ConfigIntegre | null; // présent seulement si LANTERNE_MOTEUR_PORT_POSTES est défini
}

// « a=x,b=y » → Map ; « a,b » → Set
function paires(v: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = p.indexOf('=');
    if (i > 0) m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
}

// Minutes entières positives ; une valeur absente ou fausse prend le défaut.
function minutes(v: string | undefined, defaut: number): number {
  return entierPositif(v, defaut);
}

function entierPositif(v: string | undefined, defaut: number): number {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 ? n : defaut;
}

function requis(nom: string): string {
  const v = process.env[nom];
  if (!v) throw new Error(`${nom} absent de l’environnement du relais`);
  return v;
}

export function chargerConfig(): ConfigRelais {
  const racine = join(import.meta.dir, '..');
  const base = process.env['CCREMOTE_BASE'] ?? join(racine, '.donnees/relais.db');
  return {
    empreinteMotDePasse: requis('CCREMOTE_EMPREINTE_MOT_DE_PASSE'),
    secretsPostes: paires(requis('CCREMOTE_SECRETS_POSTES')),
    isolees: new Set(liste(process.env['CCREMOTE_MACHINES_ISOLEES'])),
    wol: paires(process.env['CCREMOTE_WOL']),
    diffusionWol: process.env['CCREMOTE_DIFFUSION_WOL'] ?? '255.255.255.255',
    base,
    portWeb: Number(process.env['LANTERNE_MOTEUR_PORT_WEB'] ?? process.env['CCREMOTE_PORT_WEB'] ?? 8766),
    // Boucle locale seulement : le tunnel Cloudflare est le seul chemin d'accès aux clients.
    hotesWeb: liste(process.env['CCREMOTE_HOTES_WEB'] ?? '127.0.0.1,::1'),
    fichierEchecs: process.env['CCREMOTE_ECHECS'] ?? join(dirname(base), 'echecs-connexion.json'),
    portPostes: Number(process.env['LANTERNE_MOTEUR_PORT_POSTES'] ?? process.env['CCREMOTE_PORT_POSTES'] ?? 8721),
    hotePostes: process.env['CCREMOTE_HOTE_POSTES'] || undefined,
    web: process.env['CCREMOTE_WEB'] ?? join(racine, 'bureau/dist'),
    hq: process.env['CCREMOTE_HQ'] ?? join(racine, 'hq/dist'),
    inactiviteMs: minutes(process.env['CCREMOTE_INACTIVITE_MIN'], 30) * 60_000,
    echo: configEcho(),
    reunionLimite: entierPositif(process.env['CCREMOTE_REUNION_LIMITE'], 20),
    relaisPostes: process.env['CCREMOTE_RELAIS_POSTES'] || null,
    urlApiPostes: process.env['CCREMOTE_URL_API_POUR_POSTES'] || null,
    integre: configIntegre(),
    origines: new Set(
      liste(process.env['CCREMOTE_ORIGINES'] ?? 'tauri://localhost,http://tauri.localhost,http://localhost:1420'),
    ),
  };
}

// « a, b » → liste sans espaces ni vides
function liste(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Relais intégré : présent si le port des postes Lanterne est fixé (le binaire de l'appli le fixe toujours).
function configIntegre(): ConfigIntegre | null {
  if (!process.env['LANTERNE_MOTEUR_PORT_POSTES']) return null;
  const instance = process.env['LANTERNE_MOTEUR_INSTANCE'] || null;
  return {
    instance,
    portDistantDefaut: instance === 'banc' ? 47322 : 47321,
    codePoste: process.env['LANTERNE_MOTEUR_CODE_POSTE'] || null,
  };
}

// Echo (cerveau sur le Pi) : facultatif ; sans ces deux variables, Quart n'a pas de vue Echo.
function configEcho(): ConfigRelais['echo'] {
  const url = process.env['CCREMOTE_ECHO_URL'];
  const jeton = process.env['CCREMOTE_ECHO_JETON'];
  return url && jeton ? { url, jeton } : null;
}
