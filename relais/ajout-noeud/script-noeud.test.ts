// Le script distant : paramètres validés puis cités, code jamais sur une ligne de commande, syntaxe bash valide.
import { describe, expect, test } from 'bun:test';
import { commandeDepotCode, commandeRetourArriere, commandeSonde, scriptNoeud } from './script-noeud.ts';

const BASE = {
  sha: 'a1b2c3d4e5f6',
  machine: 'tour',
  nom: 'Tour',
  aiguilleur: 'http://aiguilleur.exemple.test:8080',
  code: 'ABCD-EFGH',
  pair: '0123456789ab',
};

function syntaxe(script: string): number {
  return Bun.spawnSync(['bash', '-n'], { stdin: new TextEncoder().encode(script) }).exitCode;
}

describe('scriptNoeud', () => {
  test('en-tête cité, corps embarqué, syntaxe valide', () => {
    const s = scriptNoeud(BASE);
    expect(s).toContain("MACHINE='tour'");
    expect(s).toContain("CODE='ABCD-EFGH'");
    expect(s).toContain('fixer_identite');
    expect(s).toContain('retour-arriere.sh');
    expect(syntaxe(s)).toBe(0);
  });

  test('une apostrophe dans le nom reste une donnée', () => {
    const s = scriptNoeud({ ...BASE, nom: "Pi d'Élie" });
    expect(s).toContain(`NOM_NOEUD='Pi d'\\''Élie'`);
    expect(syntaxe(s)).toBe(0);
  });

  test('relance d’un nœud déjà relié : code vide', () => {
    expect(scriptNoeud({ ...BASE, code: null })).toContain("CODE=''");
  });

  test.each([
    ['nom', 'Tour"; rm -rf ~; "'],
    ['nom', 'Tour $(id)'],
    ['machine', 'Tour'],
    ['machine', 'tour;id'],
    ['aiguilleur', 'http://hote/chemin;id'],
    ['aiguilleur', 'file:///etc/passwd'],
    ['code', "x' ; id"],
    ['pair', 'tour'],
    ['sha', '../../etc'],
  ])('refuse un %s invalide', (champ, valeur) => {
    expect(() => scriptNoeud({ ...BASE, [champ]: valeur })).toThrow();
  });
});

describe('commandes fixes', () => {
  test('dépôt du code : empreinte validée', () => {
    expect(commandeDepotCode('a1b2c3d4e5f6')).toContain('versions/a1b2c3d4e5f6/poste-code.tgz');
    expect(() => commandeDepotCode('a1b2; id')).toThrow();
  });

  test('sonde et retour arrière : aucune donnée variable', () => {
    expect(commandeSonde()).toContain('federation/aiguilleur.json');
    expect(commandeRetourArriere()).toBe('bash "$HOME/.local/share/lanterne-noeud/retour-arriere.sh"');
  });
});
