// Responsabilité : tests du service de fichiers — client du relais avec faux fetch, et service de démo en mémoire.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { PROJET_DEMO, RACINE_DEMO } from './arbre-demo';
import { creerFichiersRelais, type ServiceFichiers, TAILLE_MAX_EDITION } from './fichiers';
import { creerFichiersDemo } from './fichiers-demo';
import { ErreurRelais, type Recuperer } from './transport-http';

interface Appel {
  readonly url: string;
  readonly methode: string;
  readonly entetes: Record<string, string>;
  readonly corps: unknown;
}

function fauxRelais(reponse: () => Response): { recuperer: Recuperer; appels: Appel[] } {
  const appels: Appel[] = [];
  const recuperer: Recuperer = async (url, init) => {
    appels.push({
      url,
      methode: init.method ?? 'GET',
      entetes: { ...(init.headers as Record<string, string>) }, // en-têtes posés par le client : objet simple
      corps: init.body ?? null,
    });
    return reponse();
  };
  return { recuperer, appels };
}

function service(reponse: () => Response): { fichiers: ServiceFichiers; appels: Appel[] } {
  const { recuperer, appels } = fauxRelais(reponse);
  const base = 'https://relais.example.com/';
  return { fichiers: creerFichiersRelais({ base, jeton: 'jeton-test', recuperer }), appels };
}

function flux(morceaux: Uint8Array[], entetes: Record<string, string> = {}): Response {
  const lecture = [...morceaux];
  const corps = new ReadableStream<Uint8Array>({
    pull(controleur) {
      const suivant = lecture.shift();
      if (suivant) controleur.enqueue(suivant);
      else controleur.close();
    },
  });
  return new Response(corps, { headers: entetes });
}

// Attend un échec et rend l'erreur typée ; un succès ou une autre erreur fait échouer le test.
async function erreurDe(promesse: Promise<unknown>): Promise<ErreurRelais> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof ErreurRelais) return erreur;
    throw erreur;
  }
  throw new Error('une erreur était attendue');
}

describe('client du relais', () => {
  test('lister : GET sur la machine, chemin encodé, jeton porteur', async () => {
    const liste = { chemin: '/srv', parent: '/', accueil: '/srv', entrees: [] };
    const { fichiers, appels } = service(() => Response.json(liste));
    expect(await fichiers.lister('poste-a', '/srv/projet x')).toEqual(liste);
    expect(appels[0]?.url).toBe('https://relais.example.com/api/machines/poste-a/fichiers?chemin=%2Fsrv%2Fprojet%20x');
    expect(appels[0]?.entetes['authorization']).toBe('Bearer jeton-test');
  });

  test('lire : les morceaux reçus sont réassemblés en texte UTF-8', async () => {
    const octets = new TextEncoder().encode('bonjour é');
    const { fichiers, appels } = service(() => flux([octets.slice(0, 3), octets.slice(3)]));
    expect(await fichiers.lire('poste-a', '/srv/a.txt')).toBe('bonjour é');
    expect(appels[0]?.url).toBe('https://relais.example.com/api/machines/poste-a/fichier?chemin=%2Fsrv%2Fa.txt');
  });

  test('lire refuse un fichier annoncé plus grand que la limite d’édition, sans le lire', async () => {
    const { fichiers } = service(() => flux([], { 'content-length': String(TAILLE_MAX_EDITION + 1) }));
    expect((await erreurDe(fichiers.lire('poste-a', '/srv/gros.bin'))).statut).toBe(413);
  });

  test('lire coupe la lecture dès que les morceaux dépassent la limite, sans en-tête fiable', async () => {
    const gros = new Uint8Array(TAILLE_MAX_EDITION + 1);
    const { fichiers } = service(() => flux([gros]));
    expect((await erreurDe(fichiers.lire('poste-a', '/srv/gros.bin'))).statut).toBe(413);
  });

  test('ecrire : PUT des octets du texte, type application/octet-stream', async () => {
    const { fichiers, appels } = service(() => Response.json({ ok: true, taille: 3 }));
    await fichiers.ecrire('poste-a', '/srv/a.txt', 'é!');
    expect(appels[0]?.methode).toBe('PUT');
    expect(appels[0]?.entetes['content-type']).toBe('application/octet-stream');
    expect(appels[0]?.corps).toEqual(new TextEncoder().encode('é!'));
  });

  test('renommer : POST JSON sur la route dédiée', async () => {
    const { fichiers, appels } = service(() => Response.json({ ok: true }));
    await fichiers.renommer('poste-a', '/srv/a', '/srv/b');
    expect(appels[0]?.url).toBe('https://relais.example.com/api/machines/poste-a/fichiers/renommer');
    expect(appels[0]?.corps).toBe('{"de":"/srv/a","vers":"/srv/b"}');
  });

  test('créer un dossier et supprimer passent chacun par leur route', async () => {
    const { fichiers, appels } = service(() => Response.json({ ok: true }));
    await fichiers.creerDossier('poste-a', '/srv/nouveau');
    await fichiers.supprimer('poste-a', '/srv/nouveau');
    expect(appels.map((a) => a.url)).toEqual([
      'https://relais.example.com/api/machines/poste-a/fichiers/dossier',
      'https://relais.example.com/api/machines/poste-a/fichiers/supprimer',
    ]);
  });

  test('une réponse en erreur remonte le message du relais et le statut', async () => {
    const { fichiers } = service(() => Response.json({ erreur: 'poste hors ligne' }, { status: 409 }));
    const erreur = await erreurDe(fichiers.supprimer('poste-a', '/srv/x'));
    expect(erreur.message).toBe('poste hors ligne');
    expect(erreur.statut).toBe(409);
  });

  test('un relais injoignable devient une erreur de statut 0', async () => {
    const recuperer: Recuperer = async () => {
      throw new TypeError('fetch failed');
    };
    const fichiers = creerFichiersRelais({ base: 'https://relais.example.com', jeton: 'j', recuperer });
    expect((await erreurDe(fichiers.lister('poste-a'))).statut).toBe(0);
  });
});

describe('service de fichiers de la démo', () => {
  test('lister la racine donne le projet de démo', async () => {
    const liste = await creerFichiersDemo().lister('poste-a');
    expect(liste.chemin).toBe(RACINE_DEMO);
    expect(liste.entrees.map((e) => e.nom)).toEqual(['agent-hq']);
    expect(liste.entrees[0]?.type).toBe('dossier');
  });

  test('lister un dossier de projet : dossiers en tête, fichiers cachés marqués', async () => {
    const liste = await creerFichiersDemo().lister('poste-a', PROJET_DEMO);
    expect(liste.entrees.slice(0, 2).map((e) => e.nom)).toEqual(['docs', 'src']);
    expect(liste.entrees.find((e) => e.nom === '.env.example')?.cache).toBe(true);
    expect(liste.entrees.find((e) => e.nom === 'README.md')?.cache).toBe(false);
  });

  test('lire un fichier de démo, et refuser un dossier traité comme fichier', async () => {
    const demo = creerFichiersDemo();
    expect(await demo.lire('poste-a', `${PROJET_DEMO}/TODO.md`)).toContain('# TODO');
    expect((await erreurDe(demo.lire('poste-a', `${PROJET_DEMO}/src`))).statut).toBe(404);
  });

  test('écrire un fichier puis le relire', async () => {
    const demo = creerFichiersDemo();
    await demo.ecrire('poste-a', `${PROJET_DEMO}/notes.md`, new TextEncoder().encode('# Notes'));
    expect(await demo.lire('poste-a', `${PROJET_DEMO}/notes.md`)).toBe('# Notes');
  });

  test('écrire dans un dossier absent est refusé', async () => {
    expect((await erreurDe(creerFichiersDemo().ecrire('poste-a', '/ailleurs/x.txt', 'x'))).statut).toBe(404);
  });

  test('renommer un dossier déplace tout son contenu', async () => {
    const demo = creerFichiersDemo();
    await demo.renommer('poste-a', `${PROJET_DEMO}/src`, `${PROJET_DEMO}/lib`);
    expect(await demo.lire('poste-a', `${PROJET_DEMO}/lib/main.ts`)).toContain('demarrer');
    const noms = (await demo.lister('poste-a', PROJET_DEMO)).entrees.map((e) => e.nom);
    expect(noms).toContain('lib');
    expect(noms).not.toContain('src');
  });

  test('renommer vers un nom déjà pris est refusé', async () => {
    const erreur = await erreurDe(
      creerFichiersDemo().renommer('poste-a', `${PROJET_DEMO}/TODO.md`, `${PROJET_DEMO}/README.md`),
    );
    expect(erreur.statut).toBe(409);
  });

  test('créer un dossier, y écrire, puis le supprimer avec son contenu', async () => {
    const demo = creerFichiersDemo();
    await demo.creerDossier('poste-a', `${PROJET_DEMO}/tmp`);
    await demo.ecrire('poste-a', `${PROJET_DEMO}/tmp/a.txt`, 'a');
    await demo.supprimer('poste-a', `${PROJET_DEMO}/tmp`);
    expect((await erreurDe(demo.lire('poste-a', `${PROJET_DEMO}/tmp/a.txt`))).statut).toBe(404);
  });

  test('une machine inconnue de la démo est refusée', async () => {
    expect((await erreurDe(creerFichiersDemo().lister('machine-inconnue'))).statut).toBe(404);
  });

  test('la racine du poste ne se supprime pas', async () => {
    expect((await erreurDe(creerFichiersDemo().supprimer('poste-a', '/'))).statut).toBe(403);
  });
});
