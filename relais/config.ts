// Responsabilité : la configuration du relais, lue dans l'environnement (aucune valeur réelle dans le dépôt).
// Deux modes : local (relais embarqué dans l'appli, postes joints par tunnels SSH) et central (relais du Pi, les postes
// se connectent eux-mêmes ; écoute et données explicites).
import { dirname, join } from 'node:path';
import { dossierSecretsPostes } from './machines/secrets.ts';

/** Relais intégré à l'appli (variables LANTERNE_MOTEUR_*) : postes Lanterne joints par tunnel SSH inverse. */
export interface ConfigIntegre {
  readonly instance: string | null; // suffixe des noms distants (banc : « banc »)
  readonly portDistantDefaut: number; // port d'écoute distant par défaut d'une nouvelle machine
  readonly codePoste: string | null; // archive du code du poste embarquée (LANTERNE_MOTEUR_CODE_POSTE)
}

/** Une adresse d'écoute de l'API des clients : hôte et port. */
export interface AdresseEcoute {
  readonly hote: string;
  readonly port: number;
}

/** Une adresse d'écoute du lien des postes : hôte absent = toutes les interfaces (comportement d'origine). */
export interface EcoutePostes {
  readonly hote: string | undefined;
  readonly port: number;
}

interface Ecoute {
  readonly ecouteWeb: readonly AdresseEcoute[];
  readonly boucleWeb: AdresseEcoute; // adresse par laquelle le connecteur MCP local rejoint le relais
  readonly ecoutePostes: readonly EcoutePostes[];
}

export interface ConfigRelais extends Ecoute {
  readonly central: boolean; // LANTERNE_RELAIS_MODE=central : aucun tunnel SSH vers les postes
  readonly urlPoste: string | null; // lien des postes vu des clients (central, première adresse hors boucle)
  readonly empreinteMotDePasse: string;
  readonly secretsPostes: ReadonlyMap<string, string>;
  readonly dossierSecrets: string; // un fichier <machine>.secret par poste
  readonly isolees: ReadonlySet<string>;
  readonly wol: ReadonlyMap<string, string>;
  readonly diffusionWol: string;
  readonly base: string;
  readonly fichierEchecs: string;
  readonly portPostes: number;
  readonly web: string;
  readonly hq: string;
  readonly inactiviteMs: number;
  readonly origines: ReadonlySet<string>;
  readonly echo: { readonly url: string; readonly jeton: string } | null;
  readonly reunionLimite: number; // demandes de Chris relayées par réunion (CCREMOTE_REUNION_LIMITE)
  readonly relaisPostes: string | null; // adresse WebSocket du relais vue des machines SSH (CCREMOTE_RELAIS_POSTES)
  readonly urlApiPostes: string | null; // URL HTTP de l'API vue des postes distants (CCREMOTE_URL_API_POUR_POSTES)
  readonly integre: ConfigIntegre | null; // présent seulement si LANTERNE_MOTEUR_PORT_POSTES est défini (hors central)
  // lien du mode duo (LANTERNE_DUO_ECOUTE / _PORT) ; écoute absente : adresse WireGuard
  readonly duo: { readonly ecoute: string | null; readonly port: number };
}

const PORT_POSTES_CENTRAL_DEFAUT = 8721;

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

// Central : données explicites (relais.db dans LANTERNE_RELAIS_DONNEES) ; local : CCREMOTE_BASE ou le dépôt.
function cheminBase(donnees: string | null): string {
  if (donnees) return join(donnees, 'relais.db');
  return process.env['CCREMOTE_BASE'] ?? join(import.meta.dir, '..', '.donnees/relais.db');
}

function portPostesDe(central: boolean): number {
  if (central) return entierPositif(process.env['LANTERNE_RELAIS_PORT_POSTES'], PORT_POSTES_CENTRAL_DEFAUT);
  return Number(process.env['LANTERNE_MOTEUR_PORT_POSTES'] ?? process.env['CCREMOTE_PORT_POSTES'] ?? 8721);
}

function configDuo(): ConfigRelais['duo'] {
  return {
    ecoute: process.env['LANTERNE_DUO_ECOUTE'] || null, // absente : adresse WireGuard, à défaut la boucle locale
    port: entierPositif(process.env['LANTERNE_DUO_PORT'], 8722),
  };
}

export function chargerConfig(): ConfigRelais {
  const racine = join(import.meta.dir, '..');
  const central = process.env['LANTERNE_RELAIS_MODE'] === 'central';
  const donnees = central ? requis('LANTERNE_RELAIS_DONNEES') : null;
  const base = cheminBase(donnees);
  const portPostes = portPostesDe(central);
  const ecoute = central ? ecouteCentrale(portPostes) : ecouteLocale(portPostes);
  return {
    central,
    ...ecoute,
    urlPoste: central ? urlPostePour(ecoute.ecouteWeb, portPostes) : null,
    duo: configDuo(),
    empreinteMotDePasse: requis('CCREMOTE_EMPREINTE_MOT_DE_PASSE'),
    secretsPostes: paires(central ? process.env['CCREMOTE_SECRETS_POSTES'] : requis('CCREMOTE_SECRETS_POSTES')),
    dossierSecrets: donnees ? join(donnees, 'postes') : dossierSecretsPostes(),
    isolees: new Set(liste(process.env['CCREMOTE_MACHINES_ISOLEES'])),
    wol: paires(process.env['CCREMOTE_WOL']),
    diffusionWol: process.env['CCREMOTE_DIFFUSION_WOL'] ?? '255.255.255.255',
    base,
    fichierEchecs: process.env['CCREMOTE_ECHECS'] ?? join(dirname(base), 'echecs-connexion.json'),
    portPostes,
    web: process.env['CCREMOTE_WEB'] ?? join(racine, 'bureau/dist'),
    hq: process.env['CCREMOTE_HQ'] ?? join(racine, 'hq/dist'),
    inactiviteMs: minutes(process.env['CCREMOTE_INACTIVITE_MIN'], 30) * 60_000,
    echo: configEcho(),
    reunionLimite: entierPositif(process.env['CCREMOTE_REUNION_LIMITE'], 20),
    relaisPostes: process.env['CCREMOTE_RELAIS_POSTES'] || null,
    urlApiPostes: process.env['CCREMOTE_URL_API_POUR_POSTES'] || null,
    integre: central ? null : configIntegre(),
    origines: new Set(
      liste(process.env['CCREMOTE_ORIGINES'] ?? 'tauri://localhost,http://tauri.localhost,http://localhost:1420'),
    ),
  };
}

// Local : écoute sur la boucle locale (le tunnel Cloudflare est le seul chemin d'accès aux clients), postes sur
// CCREMOTE_HOTE_POSTES ou toutes les interfaces.
function ecouteLocale(portPostes: number): Ecoute {
  const portWeb = Number(process.env['LANTERNE_MOTEUR_PORT_WEB'] ?? process.env['CCREMOTE_PORT_WEB'] ?? 8766);
  const hotesWeb = liste(process.env['CCREMOTE_HOTES_WEB'] ?? '127.0.0.1,::1');
  return {
    ecouteWeb: hotesWeb.map((hote) => ({ hote, port: portWeb })),
    boucleWeb: { hote: hotesWeb[0] ?? '127.0.0.1', port: portWeb },
    ecoutePostes: [{ hote: process.env['CCREMOTE_HOTE_POSTES'] || undefined, port: portPostes }],
  };
}

// Central : l'API des clients écoute sur chaque adresse de LANTERNE_RELAIS_ECOUTE ; le lien des postes écoute sur les
// mêmes hôtes, au port LANTERNE_RELAIS_PORT_POSTES (un port séparé de l'API, jamais exposé par le tunnel).
function ecouteCentrale(portPostes: number): Ecoute {
  const adresses = parserEcoute(requis('LANTERNE_RELAIS_ECOUTE'));
  const boucle = adresses.find((a) => a.hote === '127.0.0.1') ?? adresses[0];
  if (!boucle) throw new Error('LANTERNE_RELAIS_ECOUTE vide');
  const hotes = [...new Set(adresses.map((a) => a.hote))];
  return {
    ecouteWeb: adresses,
    boucleWeb: boucle,
    ecoutePostes: hotes.map((hote) => ({ hote, port: portPostes })),
  };
}

// Adresses qu'un poste distant ne peut pas joindre : la boucle et les adresses « toutes interfaces ».
const ADRESSES_NON_JOIGNABLES = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', '::']);

/** ws://<première adresse joignable>:<port des postes>/poste, ou null si l'écoute n'a que des adresses locales. */
export function urlPostePour(adresses: readonly AdresseEcoute[], port: number): string | null {
  const hote = adresses.find((a) => !ADRESSES_NON_JOIGNABLES.has(a.hote))?.hote;
  if (!hote) return null;
  return `ws://${hote.includes(':') ? `[${hote}]` : hote}:${port}/poste`;
}

/** « hôte:port,[ipv6]:port » → adresses d'écoute ; une entrée invalide arrête le relais au démarrage. */
export function parserEcoute(brut: string): AdresseEcoute[] {
  const adresses = liste(brut).map(lireAdresse);
  if (adresses.length === 0) throw new Error('LANTERNE_RELAIS_ECOUTE vide : indiquer hôte:port');
  return adresses;
}

function lireAdresse(entree: string): AdresseEcoute {
  const i = entree.lastIndexOf(':');
  const hote = entree.slice(0, Math.max(i, 0)).replace(/^\[(.*)\]$/, '$1');
  const port = Number(entree.slice(i + 1));
  if (i <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`LANTERNE_RELAIS_ECOUTE : « ${entree} » n’est pas hôte:port`);
  }
  return { hote, port };
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

/** VPN des invités (aiguilleur) : dossier des demandes déposées pour le service root, et réglages WireGuard. */
export interface ConfigVpnInvites {
  readonly dossier: string; // LANTERNE_VPN_INVITES_DOSSIER
  readonly endpoint: string; // LANTERNE_VPN_ENDPOINT : hôte:port public du WireGuard
  readonly cleServeur: string; // LANTERNE_VPN_CLE_SERVEUR : clé publique du serveur WireGuard
  readonly adresseAiguilleur: string; // LANTERNE_VPN_ADRESSE_AIGUILLEUR : adresse VPN de l'aiguilleur
}

/** Aiguilleur (LANTERNE_RELAIS_MODE=aiguilleur) : écoute, et dossier de l'annuaire seulement (aucune autre donnée). */
export interface ConfigAiguilleur {
  readonly ecouteWeb: readonly AdresseEcoute[];
  readonly base: string;
  readonly fichierEchecs: string;
  readonly vpnInvites: ConfigVpnInvites | null; // null : VPN des invités non configuré (501 côté route)
}

/** Chemin de l'annuaire : LANTERNE_RELAIS_DONNEES/annuaire.db (les commandes locales ne demandent que celui-là). */
export function cheminAnnuaire(env: Environnement): string {
  const donnees = env['LANTERNE_RELAIS_DONNEES'];
  if (!donnees) throw new Error('LANTERNE_RELAIS_DONNEES absent de l’environnement de l’aiguilleur');
  return join(donnees, 'annuaire.db');
}

export function chargerConfigAiguilleur(env: Environnement = process.env): ConfigAiguilleur {
  const base = cheminAnnuaire(env);
  return {
    ecouteWeb: parserEcoute(env['LANTERNE_RELAIS_ECOUTE'] ?? ''),
    base,
    fichierEchecs: join(dirname(base), 'echecs-membres.json'),
    vpnInvites: configVpnInvites(env),
  };
}

const VALIDE_HOTE_PORT = /^[A-Za-z0-9._\-[\]:]+$/;
const VALIDE_CLE_PUBLIQUE = /^[A-Za-z0-9+/]{43}=$/;
const VALIDE_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Les quatre variables vont ensemble : une seule absente = VPN des invités non configuré (null). Une valeur fausse
// arrête l'aiguilleur au démarrage (elle finirait dans la configuration WireGuard remise aux invités).
function configVpnInvites(env: Environnement): ConfigVpnInvites | null {
  const dossier = env['LANTERNE_VPN_INVITES_DOSSIER'];
  const endpoint = env['LANTERNE_VPN_ENDPOINT'];
  const cleServeur = env['LANTERNE_VPN_CLE_SERVEUR'];
  const adresseAiguilleur = env['LANTERNE_VPN_ADRESSE_AIGUILLEUR'];
  if (!dossier || !endpoint || !cleServeur || !adresseAiguilleur) return null;
  if (!dossier.startsWith('/')) throw new Error('LANTERNE_VPN_INVITES_DOSSIER : chemin absolu attendu');
  if (!VALIDE_HOTE_PORT.test(endpoint)) throw new Error('LANTERNE_VPN_ENDPOINT : hôte:port attendu');
  if (!VALIDE_CLE_PUBLIQUE.test(cleServeur)) throw new Error('LANTERNE_VPN_CLE_SERVEUR : clé WireGuard attendue');
  if (!VALIDE_IPV4.test(adresseAiguilleur)) throw new Error('LANTERNE_VPN_ADRESSE_AIGUILLEUR : IPv4 attendue');
  return { dossier, endpoint, cleServeur, adresseAiguilleur };
}

type Environnement = Readonly<Record<string, string | undefined>>;
