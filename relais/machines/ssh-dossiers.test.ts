import { describe, expect, test } from 'bun:test';
import { commandeListerDossiers, lireListeDossiers, listerDossiersSsh, parentDe } from './dossiers.ts';
import { argumentsSsh, Ssh, type ResultatSsh } from './ssh.ts';
import { lireRapport, testerMachine } from './tester.ts';

const CONNEXION = { hote: 'machine.exemple.test', port: 2222, utilisateur: 'utilisateur', cle: '/k/cle' };

function ssh(resultat: Partial<ResultatSsh>, appels: string[][] = []): Ssh {
  return new Ssh(async (args) => {
    appels.push(args);
    return { code: 0, sortie: '', erreurs: '', delaiDepasse: false, ...resultat };
  });
}

describe('ssh', () => {
  test('arguments : options fixes, clé, port, cible, commande en un seul argument', () => {
    const args = argumentsSsh(CONNEXION, 'echo ok');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('IdentitiesOnly=yes');
    expect(args.slice(-2)).toEqual(['utilisateur@machine.exemple.test', 'echo ok']);
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
    expect(args[args.indexOf('-i') + 1]).toBe('/k/cle');
  });

  test('un lanceur qui jette une exception rend un résultat d’échec, sans lever', async () => {
    const s = new Ssh(async () => {
      throw new Error('ssh absent');
    });
    const r = await s.executer(CONNEXION, 'x');
    expect(r.code).toBe(-1);
    expect(r.erreurs).toContain('ssh absent');
  });
});

describe('dossiers distants', () => {
  test('la commande quote le chemin (pas d’injection)', () => {
    const c = commandeListerDossiers("/srv/x'; rm -rf ~; '");
    expect(c).toContain(`cd -- '/srv/x'\\''; rm -rf ~; '\\'''`);
    expect(c).toContain("find . -mindepth 1 -maxdepth 1 -type d ! -name '.*'");
  });

  test('lecture : chemin réel, accueil, dossiers visibles seulement', () => {
    const liste = lireListeDossiers('/home/u/dev\n/home/u\nalpha\nbeta\n');
    expect(liste).toEqual({
      chemin: '/home/u/dev',
      parent: '/home/u',
      accueil: '/home/u',
      entrees: [
        { nom: 'alpha', type: 'dossier', taille: 0, modifie: '', cache: false },
        { nom: 'beta', type: 'dossier', taille: 0, modifie: '', cache: false },
      ],
    });
  });

  test('parent : la racine n’a pas de parent', () => {
    expect(parentDe('/')).toBeNull();
    expect(parentDe('/mnt')).toBe('/');
    expect(parentDe('/mnt/projects')).toBe('/mnt');
  });

  test('échec SSH : message de la dernière ligne d’erreur', async () => {
    const r = await listerDossiersSsh(ssh({ code: 255, erreurs: 'bruit\nPermission denied (publickey).\n' }), CONNEXION, '~');
    expect(r).toEqual({ ok: false, erreur: 'Permission denied (publickey).' });
  });

  test('dossier introuvable : le message distant remonte', async () => {
    const r = await listerDossiersSsh(ssh({ code: 3, erreurs: 'dossier introuvable' }), CONNEXION, '/absent');
    expect(r.ok).toBe(false);
  });
});

describe('test de machine', () => {
  test('lecture des lignes cle=valeur', () => {
    const v = lireRapport('ssh=ok\nclaude=oui 2.1.0 (Claude Code)\ntmux=non\n');
    expect(v.get('claude')).toBe('oui 2.1.0 (Claude Code)');
    expect(v.get('tmux')).toBe('non');
  });

  test('rapport complet : SSH, outils et poste', async () => {
    const r = await testerMachine(
      ssh({ sortie: 'ssh=ok\nclaude=oui 2.1.0\ntmux=oui 3.4\nbun=non\n' }),
      CONNEXION,
      true,
      true,
    );
    expect(r.ssh.ok).toBe(true);
    expect(r.claude).toEqual({ ok: true, detail: '2.1.0' });
    expect(r.bun.ok).toBe(false);
    expect(r.poste).toEqual({ ok: true, detail: 'connecté au relais' });
  });

  test('SSH en échec : les outils ne sont pas vérifiés, le poste l’est', async () => {
    const r = await testerMachine(ssh({ code: 255, erreurs: 'Connection refused' }), CONNEXION, false, false);
    expect(r.ssh).toEqual({ ok: false, detail: 'Connection refused' });
    expect(r.claude.detail).toBe('non vérifié');
    expect(r.poste).toEqual({ ok: false, detail: 'non installé' });
  });
});
