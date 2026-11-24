// Responsabilité : le client JS du navigateur de Noctis, pour un script (code mode) : `import { nav }`, puis
// `await nav.lire()`. Il parle au socket des outils du poste (une ligne JSON par requête et par réponse), avec le
// module `navigateur` et la session prise dans LANTERNE_SESSION_PILOTEE. JS pur, sans dépendance : Node ≥ 20 ou Bun.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const MODULE_NAV = 'navigateur';
export const VAR_SESSION_NAV = 'LANTERNE_SESSION_PILOTEE';
export const VAR_SOCKET_NAV = 'LANTERNE_SOCKET_OUTILS';
export const OUTILS_NAV = [
  'ouvrir',
  'aller',
  'precedent',
  'recharger',
  'fermer',
  'etat',
  'lire',
  'texte',
  'trouver',
  'cliquer',
  'saisir',
  'touche',
  'defiler',
  'executer',
];

const DELAI_CONNEXION_MS = 2_000;
const DELAI_REPONSE_MS = 40_000; // le poste répond avant 40 s, le navigateur avant 15 s
const SERVICE_ABSENT = 'Lanterne n’est pas en service sur cette machine';
const SANS_REPONSE = 'Lanterne ne répond pas dans le délai imparti';
const SANS_SESSION = 'session inconnue : le navigateur est propre à une session';
const DOSSIER_DONNEES = join(homedir(), '.local', 'share', 'ccremote', 'poste');

/** Chemin du socket, même règle que `cheminSocketOutils` (poste/presentation/socket-outils.ts). */
export function cheminSocketNav(env, uid, donnees = DOSSIER_DONNEES) {
  if (env[VAR_SOCKET_NAV]) return env[VAR_SOCKET_NAV];
  const surUid = uid !== undefined && existsSync(`/run/user/${uid}`) ? `/run/user/${uid}` : '';
  const runtime = env.XDG_RUNTIME_DIR || surUid;
  return join(runtime ? join(runtime, 'lanterne') : donnees, 'outils.sock');
}

function lireReponse(ligne) {
  try {
    const brut = JSON.parse(ligne);
    if (typeof brut === 'object' && brut !== null && typeof brut.ok === 'boolean') return brut;
  } catch {
    // ligne illisible : refus ci-dessous
  }
  return { ok: false, erreur: 'réponse illisible' };
}

/** Une requête, une connexion : la réponse est lue jusqu'à la fin de ligne. Jamais d'exception, un refus lisible. */
function echanger(chemin, corps) {
  return new Promise((resoudre) => {
    const s = createConnection(chemin);
    let recu = '';
    let minuteur;
    const fin = (r) => {
      clearTimeout(minuteur);
      s.destroy();
      resoudre(r);
    };
    minuteur = setTimeout(() => fin({ ok: false, erreur: SANS_REPONSE }), DELAI_CONNEXION_MS);
    s.on('connect', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => fin({ ok: false, erreur: SANS_REPONSE }), DELAI_REPONSE_MS);
      s.write(`${JSON.stringify(corps)}\n`);
    });
    s.on('data', (octets) => {
      recu += octets.toString('utf8');
      const coupure = recu.indexOf('\n');
      if (coupure !== -1) fin(lireReponse(recu.slice(0, coupure)));
    });
    s.on('error', () => fin({ ok: false, erreur: SERVICE_ABSENT }));
    s.on('close', () => fin({ ok: false, erreur: 'réponse interrompue' }));
  });
}

// Le résultat d'un outil revient en texte JSON ou en objet : on rend l'objet quand le texte en est un.
function resultatDe(donnees) {
  const brut = typeof donnees === 'object' && donnees !== null && 'resultat' in donnees ? donnees.resultat : null;
  if (typeof brut !== 'string') return brut ?? null;
  try {
    return JSON.parse(brut);
  } catch {
    return brut;
  }
}

/** Appelle un outil du navigateur pour la session de l'environnement ; rend son résultat ou lève une Error. */
export async function appelerNav(outil, args = {}, env = process.env) {
  const session = env[VAR_SESSION_NAV];
  if (!session) throw new Error(`navigateur.${outil} : ${SANS_SESSION}`);
  const corps = {
    id: randomUUID(),
    quoi: 'module_appeler',
    session,
    args: { module: MODULE_NAV, outil, arguments: args },
  };
  const r = await echanger(cheminSocketNav(env, process.getuid?.()), corps);
  if (!r.ok) throw new Error(`navigateur.${outil} : ${r.erreur ?? 'erreur inconnue'}`);
  return resultatDe(r.donnees);
}

/** Le navigateur de la session, un outil par méthode : `nav.lire()`, `nav.cliquer({ ref: 'ref_3' })`… */
export function creerNav(env = process.env) {
  const methodes = OUTILS_NAV.map((outil) => [outil, (args) => appelerNav(outil, args, env)]);
  return Object.freeze(Object.fromEntries(methodes));
}

export const nav = creerNav();
