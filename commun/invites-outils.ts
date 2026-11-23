// Responsabilité : les outils qu'une session d'invité peut appeler, et le confinement de leurs chemins et de leurs URL.
// Pur : la résolution réelle des chemins (realpath) et du DNS est injectée par l'appelant.
import { posix, win32 } from 'node:path';

export const OUTILS_INVITE_PERMIS: readonly string[] = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
];

export const OUTILS_INVITE_INTERDITS: readonly string[] = [
  'Bash',
  'BashOutput',
  'KillShell',
  'KillBash',
  'Task',
  'Agent',
  'NotebookEdit',
  'Skill',
  'SlashCommand',
  'ExitPlanMode',
  'EnterPlanMode',
  'ListMcpResources',
  'ReadMcpResource',
];

/** Outils de Noctis (serveurs lanterne et ccremote), permis à une session qui tourne sur la machine de l'invité. */
export const PREFIXES_OUTILS_NOCTIS: readonly string[] = ['mcp__lanterne__', 'mcp__ccremote__'];

/** Outils sans chemin, permis à une session sur la machine de l'invité : mode Plan, chargement d'outils, tâches. */
export const OUTILS_LOCAUX_SANS_CHEMIN: readonly string[] = [
  'ExitPlanMode',
  'EnterPlanMode',
  'ToolSearch',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
];

/** Outils du terminal, permis seulement sur la machine de l'invité quand le chef l'a accordé. */
export const OUTILS_TERMINAL: readonly string[] = ['Bash', 'BashOutput', 'KillShell', 'KillBash'];

export interface Confinement {
  /** Terminal accordé, et la session tourne sur la machine de l'invité (jamais sur une machine du chef). */
  readonly terminal?: boolean;
  /** La session tourne sur la machine de l'invité : les outils de Noctis (artefacts, visuels) agissent chez lui. */
  readonly local?: boolean;
  readonly espace: string;
  /** Machine de l'invité : dossier où Claude Code écrit ses plans (mode Plan), permis en écriture. */
  readonly plans?: string;
  readonly lecture: readonly string[];
  readonly home: string;
  resoudre(chemin: string): string; // realpath du plus proche parent existant, fourni par l'appelant
  /** Chemins Windows (barres inverses, lecteur, casse ignorée) ; absent : celui de la machine qui exécute. */
  readonly windows?: boolean;
}

function surWindows(c: Pick<Confinement, 'windows'>): boolean {
  return c.windows ?? process.platform === 'win32';
}

/** Forme comparable d'un chemin : barres obliques, et sous Windows sans casse (« C:\\A » = « c:/a »). */
function forme(chemin: string, windows: boolean): string {
  if (!windows) return posix.normalize(chemin).replace(/\/+$/, '');
  return win32.normalize(chemin).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export type VerdictAcces = { ok: true } | { ok: false; raison: string };
export type VerdictUrl = { ok: true; hote: string } | { ok: false; raison: string };
type Sens = 'lecture' | 'ecriture';
interface Chemins {
  readonly lecture: string[];
  readonly ecriture: string[];
}

const SUFFIXES_LOCAUX: readonly string[] = ['.local', '.lan', '.internal', '.home', '.localhost'];
const CARACTERES_MOTIF = /[*?[{]/;

export function outilInvitePermis(nom: string): boolean {
  return OUTILS_INVITE_PERMIS.includes(nom) && !nom.startsWith('mcp__');
}

export function cheminsSensibles(home: string, windows = false): string[] {
  if (windows)
    return ['.claude', '.claude.json', '.config', '.ssh', '.local\\share', '.gnupg', 'AppData'].map((d) =>
      win32.join(home, d),
    );
  return [
    `${home}/.claude`,
    `${home}/.claude.json`,
    `${home}/.config`,
    `${home}/.ssh`,
    `${home}/.local/share`,
    `${home}/.gnupg`,
    '/proc',
    '/sys',
    '/etc',
    '/root',
  ];
}

function chaine(entree: Record<string, unknown>, cle: string): string | null {
  const valeur = entree[cle];
  return typeof valeur === 'string' ? valeur : null;
}

function cheminOuPoint(entree: Record<string, unknown>, cle: string): string | null {
  return entree[cle] === undefined ? '.' : chaine(entree, cle);
}

function unChemin(valeur: string | null, sens: Sens): Chemins | null {
  if (valeur === null) return null;
  return sens === 'lecture' ? { lecture: [valeur], ecriture: [] } : { lecture: [], ecriture: [valeur] };
}

/** Partie fixe d'un motif absolu (avant le premier caractère joker) ; un motif relatif n'a pas de partie absolue. */
function partieFixeAbsolue(motif: string): string | null {
  if (!motif.startsWith('/')) return null;
  return motif.split(CARACTERES_MOTIF)[0] ?? '/';
}

function cheminsGlob(entree: Record<string, unknown>): Chemins | null {
  const base = cheminOuPoint(entree, 'path');
  const motif = chaine(entree, 'pattern');
  if (base === null || motif === null) return null;
  const fixe = partieFixeAbsolue(motif);
  return { lecture: fixe === null ? [base] : [base, fixe], ecriture: [] };
}

function cheminsGrep(entree: Record<string, unknown>): Chemins | null {
  const base = cheminOuPoint(entree, 'path');
  if (base === null) return null;
  const glob = entree.glob;
  if (glob === undefined) return { lecture: [base], ecriture: [] };
  if (typeof glob !== 'string') return null;
  return { lecture: glob.startsWith('/') ? [base, glob] : [base], ecriture: [] };
}

export function cheminsDeOutil(nom: string, entree: Record<string, unknown>): Chemins | null {
  switch (nom) {
    case 'Read':
      return unChemin(chaine(entree, 'file_path'), 'lecture');
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return unChemin(chaine(entree, 'file_path'), 'ecriture');
    case 'LS':
      return unChemin(chaine(entree, 'path'), 'lecture');
    case 'Glob':
      return cheminsGlob(entree);
    case 'Grep':
      return cheminsGrep(entree);
    case 'WebSearch':
    case 'WebFetch':
    case 'TodoWrite':
      return { lecture: [], ecriture: [] };
    default:
      return null;
  }
}

function estDessous(chemin: string, racine: string, windows = false): boolean {
  const base = forme(racine, windows);
  const vise = forme(chemin, windows);
  return vise === base || vise.startsWith(`${base}/`);
}

function raisonSyntaxe(chemin: string): string | null {
  if (chemin === '') return 'chemin vide';
  if (chemin.includes('\0')) return 'octet nul dans le chemin';
  return chemin.startsWith('~') ? 'chemin ~ interdit' : null;
}

function porteClaude(chemin: string): boolean {
  return chemin.split(/[\\/]/).some((partie) => partie.toLowerCase() === '.claude');
}

function raisonSensible(home: string, chemins: readonly string[], windows: boolean): string | null {
  const sensibles = cheminsSensibles(home, windows);
  const touche = chemins.some((chemin) => sensibles.some((s) => estDessous(chemin, s, windows)));
  return touche ? 'chemin sensible' : null;
}

function raisonChemin(c: Confinement, normalise: string, resolu: string, sens: Sens): string | null {
  const windows = surWindows(c);
  if (porteClaude(normalise) || porteClaude(resolu)) return 'chemin de configuration Claude';
  const dansEspace = (chemin: string): boolean => estDessous(chemin, c.espace, windows);
  // L'espace d'un invité vit sous son dossier personnel (AppData compris sous Windows) : il n'est jamais « sensible ».
  if (!dansEspace(resolu)) {
    const sensible = raisonSensible(c.home, [normalise, resolu], windows);
    if (sensible !== null) return sensible;
  }
  const dansPlans = c.local === true && c.plans !== undefined && estDessous(resolu, c.plans, windows);
  if (sens === 'ecriture') return dansEspace(resolu) || dansPlans ? null : "écriture hors de l'espace";
  const lisible = [c.espace, ...c.lecture].some((racine) => estDessous(resolu, racine, windows));
  return lisible ? null : "lecture hors de l'espace";
}

export function verifierChemin(c: Confinement, chemin: string, sens: Sens): VerdictAcces {
  const syntaxe = raisonSyntaxe(chemin);
  if (syntaxe !== null) return { ok: false, raison: syntaxe };
  const chemins = surWindows(c) ? win32 : posix;
  const normalise = chemins.normalize(chemins.isAbsolute(chemin) ? chemin : chemins.join(c.espace, chemin));
  const raison = raisonChemin(c, normalise, c.resoudre(normalise), sens);
  return raison === null ? { ok: true } : { ok: false, raison };
}

function verifierListe(c: Confinement, chemins: readonly string[], sens: Sens): VerdictAcces {
  for (const chemin of chemins) {
    const verdict = verifierChemin(c, chemin, sens);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}

export function verifierOutil(c: Confinement, nom: string, entree: Record<string, unknown>): VerdictAcces {
  if (c.terminal === true && OUTILS_TERMINAL.includes(nom)) return { ok: true };
  if (c.local === true && PREFIXES_OUTILS_NOCTIS.some((p) => nom.startsWith(p))) return { ok: true };
  if (c.local === true && OUTILS_LOCAUX_SANS_CHEMIN.includes(nom)) return { ok: true };
  if (!outilInvitePermis(nom)) return { ok: false, raison: `outil non permis : ${nom}` };
  if (nom === 'WebFetch') {
    const url = verifierUrlSyntaxe(entree.url);
    return url.ok ? { ok: true } : { ok: false, raison: url.raison };
  }
  const chemins = cheminsDeOutil(nom, entree);
  if (chemins === null) return { ok: false, raison: `entrée invalide pour ${nom}` };
  const lecture = verifierListe(c, chemins.lecture, 'lecture');
  return lecture.ok ? verifierListe(c, chemins.ecriture, 'ecriture') : lecture;
}

function lireIpv4(texte: string): readonly number[] | null {
  const parties = texte.split('.');
  if (parties.length !== 4 || !parties.every((p) => /^\d{1,3}$/.test(p))) return null;
  const nombres = parties.map(Number);
  return nombres.every((n) => n <= 255) ? nombres : null;
}

function ipv4Privee(nombres: readonly number[]): boolean {
  const [a = -1, b = -1] = nombres;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function lireGroupes(texte: string): number[] | null {
  if (texte === '') return [];
  const morceaux = texte.split(':');
  if (!morceaux.every((m) => /^[0-9a-f]{1,4}$/.test(m))) return null;
  return morceaux.map((m) => Number.parseInt(m, 16));
}

/** Remplace une queue décimale (::ffff:1.2.3.4) par ses deux groupes hexadécimaux. */
function convertirQueueV4(texte: string): string {
  const coupe = texte.lastIndexOf(':');
  const queue = texte.slice(coupe + 1);
  const nombres = queue.includes('.') ? lireIpv4(queue) : null;
  if (nombres === null) return texte;
  const [a = 0, b = 0, c = 0, d = 0] = nombres;
  return `${texte.slice(0, coupe + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

/** Huit groupes de 16 bits, `::` déployé ; null si l'écriture n'est pas une IPv6 valable. */
function huitGroupes(ip: string): number[] | null {
  const morceaux = convertirQueueV4(ip.toLowerCase()).split('::');
  if (morceaux.length > 2) return null;
  const gauche = lireGroupes(morceaux[0] ?? '');
  const droite = lireGroupes(morceaux[1] ?? '');
  if (gauche === null || droite === null) return null;
  if (morceaux.length === 1) return gauche.length === 8 ? gauche : null;
  const vides = 8 - gauche.length - droite.length;
  return vides < 1 ? null : [...gauche, ...Array<number>(vides).fill(0), ...droite];
}

function versIpv4(deux: readonly number[]): number[] {
  const [g6 = 0, g7 = 0] = deux;
  return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
}

function adresseV6Privee(ip: string): boolean {
  const groupes = huitGroupes(ip);
  if (groupes === null) return true; // illisible : échec fermé
  const tete = groupes.slice(0, 6);
  const queue = groupes.slice(6);
  if (tete.every((g) => g === 0)) return ipv4Privee(versIpv4(queue)); // ::, ::1, forme compatible
  if (tete.slice(0, 5).every((g) => g === 0) && tete[5] === 0xffff) return ipv4Privee(versIpv4(queue));
  const premier = groupes[0] ?? 0;
  return (premier & 0xfe00) === 0xfc00 || (premier & 0xffc0) === 0xfe80; // fc00::/7, fe80::/10
}

/** Adresse IPv4 ou IPv6 dans un réseau privé, de boucle locale, de lien local ou réservée (illisible : privée). */
export function adressePrivee(ip: string): boolean {
  if (ip.includes(':')) return adresseV6Privee(ip);
  const nombres = lireIpv4(ip);
  return nombres === null || ipv4Privee(nombres);
}

function estAdresseIp(hote: string): boolean {
  return hote.includes(':') || lireIpv4(hote) !== null;
}

function raisonHote(hote: string): string | null {
  if (hote === '') return 'hôte vide';
  if (estAdresseIp(hote)) return adressePrivee(hote) ? 'adresse privée ou locale' : null;
  if (hote === 'localhost' || SUFFIXES_LOCAUX.some((suffixe) => hote.endsWith(suffixe))) return 'hôte local';
  return hote.includes('.') ? null : 'nom sans point';
}

function lireUrl(texte: string): URL | null {
  try {
    return new URL(texte);
  } catch {
    return null;
  }
}

/** Syntaxe seulement : rend l'hôte pour la résolution DNS faite par l'appelant (rebond possible entre les deux). */
export function verifierUrlSyntaxe(url: unknown): VerdictUrl {
  if (typeof url !== 'string') return { ok: false, raison: 'url absente' };
  const lue = lireUrl(url);
  if (lue === null) return { ok: false, raison: 'url illisible' };
  if (lue.protocol !== 'http:' && lue.protocol !== 'https:') return { ok: false, raison: 'protocole non permis' };
  const hote = lue.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  const raison = raisonHote(hote);
  return raison === null ? { ok: true, hote } : { ok: false, raison };
}
