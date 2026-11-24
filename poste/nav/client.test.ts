// Responsabilité : tests du client JS du navigateur — requête au socket des outils (module navigateur, session prise
// dans l'environnement), résultat rendu en objet, refus du poste et absence du poste rendus en Error lisible.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cheminSocketNav, creerNav, OUTILS_NAV, VAR_SESSION_NAV, VAR_SOCKET_NAV } from './client.mjs';

interface Demande {
  readonly id: string;
  readonly quoi: string;
  readonly session?: string;
  readonly args: Record<string, unknown>;
}

interface Reponse {
  readonly ok: boolean;
  readonly donnees?: unknown;
  readonly erreur?: string;
}

let dossier = '';
let arreter: (() => void) | null = null;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'nav-client-'));
});

afterEach(() => {
  arreter?.();
  arreter = null;
  rmSync(dossier, { recursive: true, force: true });
});

/** Faux poste : un socket Unix qui note chaque demande et répond avec `repondre`. */
function fauxPoste(repondre: (d: Demande) => Reponse, recus: Demande[]): string {
  const chemin = join(dossier, 'outils.sock');
  const serveur = Bun.listen<{ tampon: string }>({
    unix: chemin,
    socket: {
      open(s) {
        s.data = { tampon: '' };
      },
      data(s, octets) {
        s.data.tampon += octets.toString('utf8');
        const fin = s.data.tampon.indexOf('\n');
        if (fin === -1) return;
        const demande = JSON.parse(s.data.tampon.slice(0, fin)) as Demande;
        recus.push(demande);
        s.write(`${JSON.stringify({ id: demande.id, ...repondre(demande) })}\n`);
      },
    },
  });
  arreter = () => serveur.stop(true);
  return chemin;
}

const ENV_SESSION = (chemin: string): Record<string, string> => ({
  [VAR_SOCKET_NAV]: chemin,
  [VAR_SESSION_NAV]: 'sess-1',
});

describe('client du navigateur', () => {
  test('lire : requête module_appeler vers le module navigateur, avec la session de l’environnement', async () => {
    const recus: Demande[] = [];
    const page = { url: 'https://exemple.org', titre: 'Accueil', arbre: '[ref_1] bouton "Ok"' };
    const chemin = fauxPoste(() => ({ ok: true, donnees: { resultat: JSON.stringify(page) } }), recus);
    const resultat = await creerNav(ENV_SESSION(chemin)).lire({ filtre: 'tout' });
    expect(resultat).toEqual(page);
    expect(recus).toHaveLength(1);
    expect(recus[0]).toMatchObject({
      quoi: 'module_appeler',
      session: 'sess-1',
      args: { module: 'navigateur', outil: 'lire', arguments: { filtre: 'tout' } },
    });
    expect(typeof recus[0]?.id).toBe('string');
  });

  test('un résultat déjà objet est rendu tel quel ; un texte non JSON est rendu comme texte', async () => {
    const resultat = (d: Demande): unknown => (d.args['outil'] === 'etat' ? 'pas du json' : { ok: true, y: 3 });
    const chemin = fauxPoste((d) => ({ ok: true, donnees: { resultat: resultat(d) } }), []);
    const nav = creerNav(ENV_SESSION(chemin));
    expect(await nav.defiler({ direction: 'bas' })).toEqual({ ok: true, y: 3 });
    const brut: unknown = await nav.etat();
    expect(brut).toBe('pas du json');
  });

  test('refus du poste : Error lisible avec l’outil et la raison', async () => {
    const chemin = fauxPoste(() => ({ ok: false, erreur: 'navigateur fermé pour cette session' }), []);
    await expect(creerNav(ENV_SESSION(chemin)).cliquer({ ref: 'ref_3' })).rejects.toThrow(
      'navigateur.cliquer : navigateur fermé pour cette session',
    );
  });

  test('sans session dans l’environnement : Error sans toucher au socket', async () => {
    const recus: Demande[] = [];
    const chemin = fauxPoste(() => ({ ok: true, donnees: {} }), recus);
    await expect(creerNav({ [VAR_SOCKET_NAV]: chemin }).lire()).rejects.toThrow('session inconnue');
    expect(recus).toEqual([]);
  });

  test('poste absent : Error lisible, jamais une exception brute', async () => {
    const env = { [VAR_SOCKET_NAV]: join(dossier, 'absent.sock'), [VAR_SESSION_NAV]: 'sess-1' };
    await expect(creerNav(env).texte()).rejects.toThrow('navigateur.texte : Lanterne n’est pas en service');
  });

  test('chaque outil du contrat 2 a sa méthode', () => {
    expect(Object.keys(creerNav({})).sort()).toEqual([...OUTILS_NAV].sort());
    expect(OUTILS_NAV).toHaveLength(14);
  });

  test('chemin du socket : variable explicite, puis runtime de l’utilisateur, puis dossier de données', () => {
    expect(cheminSocketNav({ [VAR_SOCKET_NAV]: '/x/s.sock' }, undefined, '/d')).toBe('/x/s.sock');
    expect(cheminSocketNav({ XDG_RUNTIME_DIR: '/run/u' }, 1000, '/d')).toBe('/run/u/lanterne/outils.sock');
    expect(cheminSocketNav({}, undefined, '/d')).toBe('/d/outils.sock');
  });
});
