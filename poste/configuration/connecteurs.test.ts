import { describe, expect, test } from 'bun:test';
import { analyserConnecteurs, CACHE_CONNECTEURS_MS, creerListeurConnecteurs } from './connecteurs.ts';
import type { SortieCommande } from './exec.ts';

// Sortie de `claude mcp list` : noms et cibles fictifs.
const SORTIE = [
  'Checking MCP server health…',
  '',
  'claude.ai Calendrier Exemple: https://exemple.invalide/mcp - ✔ Connected',
  'claude.ai Notes Exemple: https://exemple.invalide/notes - ! Needs authentication',
  'claude.ai Panne Exemple: https://exemple.invalide/panne - ✘ Failed to connect — HTTP 502',
  'outil-local: /chemin/fictif/serveur --option - ✔ Connected',
  'autre: pending - ◌ Checking',
].join('\n');

function sortie(texte: string, code = 0, delaiDepasse = false): SortieCommande {
  return { code, sortie: texte, erreurs: '', delaiDepasse };
}

describe('analyserConnecteurs', () => {
  test('nom, cible et état de chaque serveur ; lignes sans forme ignorées', () => {
    expect(analyserConnecteurs(SORTIE)).toEqual([
      { nom: 'claude.ai Calendrier Exemple', cible: 'https://exemple.invalide/mcp', etat: 'connecte' },
      { nom: 'claude.ai Notes Exemple', cible: 'https://exemple.invalide/notes', etat: 'authentification' },
      { nom: 'claude.ai Panne Exemple', cible: 'https://exemple.invalide/panne', etat: 'echec' },
      { nom: 'outil-local', cible: '/chemin/fictif/serveur --option', etat: 'connecte' },
      { nom: 'autre', cible: 'pending', etat: 'inconnu' },
    ]);
  });
});

describe('creerListeurConnecteurs', () => {
  test('garde le résultat 30 s, puis relance la commande', async () => {
    let appels = 0;
    let t = 0;
    const liste = creerListeurConnecteurs({
      lancer: async () => {
        appels += 1;
        return sortie(SORTIE);
      },
      maintenant: () => t,
    });
    await liste.lister();
    t = CACHE_CONNECTEURS_MS - 1;
    await liste.lister();
    expect(appels).toBe(1);
    t = CACHE_CONNECTEURS_MS + 1;
    await liste.lister();
    expect(appels).toBe(2);
  });

  test('délai dépassé : erreur explicite, rien n’est gardé', async () => {
    const liste = creerListeurConnecteurs({ lancer: async () => sortie('', -1, true) });
    expect(await liste.lister()).toEqual({ ok: false, erreur: 'délai dépassé' });
  });

  test('sortie vide et code en échec : erreur de la CLI', async () => {
    const liste = creerListeurConnecteurs({
      lancer: async () => ({ code: 1, sortie: '', erreurs: 'claude: introuvable', delaiDepasse: false }),
    });
    expect(await liste.lister()).toEqual({ ok: false, erreur: 'claude: introuvable' });
  });
});
