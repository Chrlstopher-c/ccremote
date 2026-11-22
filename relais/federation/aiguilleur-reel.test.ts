// Fédération sur le vrai processus de l'aiguilleur (relais/bin.ts en mode aiguilleur, commandes locales lancées à
// part) : deux nœuds s'y relient, s'appairent, se voient ; la révocation d'un nœud par la commande coupe son lien ; et
// l'annuaire du processus ne contient aucun contenu de session. Données de test seulement.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attendre, creerNoeud, ficheDe, MAJ, type Noeud } from './banc-federation.ts';

const RACINE = join(import.meta.dir, '..', '..');
const TEXTE_SECRET = 'contenu réel-simulé de A, jamais dans l’annuaire';

let processus: ReturnType<typeof Bun.spawn> | null = null;
let donnees = '';
let env: Record<string, string> = {};
let url = '';

function portLibre(): number {
  const s = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p ?? 0;
}

function environnement(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (valeur === undefined || cle.startsWith('CCREMOTE_') || cle.startsWith('LANTERNE_')) continue;
    base[cle] = valeur;
  }
  return { ...base, ...extra };
}

async function commande(args: string[]): Promise<string> {
  const p = Bun.spawn([process.execPath, 'run', 'relais/aiguilleur/commande.ts', ...args], {
    cwd: RACINE,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const sortie = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`commande ${args.join(' ')} en échec`);
  return sortie;
}

async function attendreHttp(adresse: string, statut: number): Promise<void> {
  const fin = Date.now() + 20_000;
  while (Date.now() < fin) {
    try {
      if ((await fetch(adresse)).status === statut) return;
    } catch {
      // le processus n'écoute pas encore
    }
    await Bun.sleep(150);
  }
  throw new Error(`pas de réponse ${statut} sur ${adresse}`);
}

beforeAll(async () => {
  donnees = mkdtempSync(join(tmpdir(), 'fede-aiguilleur-reel-'));
  const port = portLibre();
  url = `http://127.0.0.1:${port}`;
  env = environnement({
    LANTERNE_RELAIS_MODE: 'aiguilleur',
    LANTERNE_RELAIS_ECOUTE: `127.0.0.1:${port}`,
    LANTERNE_RELAIS_DONNEES: donnees,
    CCREMOTE_JOURNAL: join(donnees, 'aiguilleur.log'),
  });
  processus = Bun.spawn([process.execPath, 'run', 'relais/bin.ts'], {
    cwd: RACINE,
    env,
    stdout: 'ignore',
    stderr: Bun.file(join(donnees, 'aiguilleur.err')),
  });
  await attendreHttp(`${url}/aiguilleur`, 401);
}, 60_000);

afterAll(() => {
  processus?.kill();
});

test('deux nœuds sur le vrai aiguilleur : appairage, sessions, fil, écriture, révocation par commande', async () => {
  const a: Noeud = creerNoeud('tour');
  const b: Noeud = creerNoeud('portable');
  try {
    const codeA = (await commande(['appairer', 'alice'])).split('\n')[0]?.trim() ?? '';
    const codeB = (await commande(['appairer', 'alice'])).split('\n')[0]?.trim() ?? '';
    expect((await a.federation.rejoindreAiguilleur({ url, code: codeA, nom: 'tour' })).ok).toBe(true);
    expect((await b.federation.rejoindreAiguilleur({ url, code: codeB, nom: 'portable' })).ok).toBe(true);
    const idA = (await a.federation.etat()).aiguilleur?.id ?? '';
    const idB = (await b.federation.etat()).aiguilleur?.id ?? '';
    await attendre(async () => (await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne));

    expect(a.federation.appairer(idB).ok).toBe(true);
    await attendre(async () => (await b.federation.etat()).demandes.length === 1);
    expect(b.federation.decider((await b.federation.etat()).demandes[0]?.id ?? '', true).ok).toBe(true);
    await attendre(async () => (await b.federation.etat()).noeuds.some((n) => n.liaisonOuverte), 8000);

    a.registre.enregistrerSession(ficheDe('s-reelle', 'tour', 'Titre réel'));
    a.diffusion.diffuser({ type: 'session', session: ficheDe('s-reelle', 'tour', 'Titre réel') });
    a.registre.ajouterEvenement('s-reelle', MAJ, { type: 'message', texte: TEXTE_SECRET });
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.id === 's-reelle'), 8000);
    const fil = await b.federation.distantes.fil(idA, 's-reelle');
    expect(fil.ok && fil.valeur.length).toBe(1);
    expect((await b.federation.distantes.ecrire(idA, 's-reelle', 'depuis le portable')).ok).toBe(true);

    await commande(['revoquer', idB]);
    await attendre(() => b.federation.etat().then((e) => e.aiguilleur?.motif === 'revoque'), 10_000);
    expect((await b.federation.etat()).aiguilleur?.relie).toBe(false);
    // Un membre révoqué n'est plus joignable : il disparaît de la présence de A, et son lien n'existe plus.
    await attendre(async () => !(await a.federation.etat()).membres.some((m) => m.id === idB && m.enLigne), 8000);
    await attendre(async () => (await a.federation.etat()).noeuds.every((n) => !n.liaisonOuverte), 8000);
  } finally {
    a.federation.arreter();
    b.federation.arreter();
  }
  const annuaire = join(donnees, 'annuaire.db');
  expect(existsSync(annuaire)).toBe(true);
  expect(readFileSync(annuaire).includes(Buffer.from(TEXTE_SECRET))).toBe(false);
  expect(readFileSync(annuaire).includes(Buffer.from('Titre réel'))).toBe(false);
}, 60_000);
