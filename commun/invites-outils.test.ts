// Responsabilité : tests du confinement des outils d'invité — chemins, motifs, URL, adresses privées.
import { describe, expect, test } from 'bun:test';
import {
  adressePrivee,
  cheminsDeOutil,
  type Confinement,
  outilInvitePermis,
  verifierChemin,
  verifierOutil,
  verifierUrlSyntaxe,
} from './invites-outils.ts';

const HOME = '/home/u';
const ESPACE = '/data/invites/x/espace';
const LIEN = `${ESPACE}/lien.txt`;

function confinement(lecture: string[] = [], resoudre: (chemin: string) => string = (c) => c): Confinement {
  return { espace: ESPACE, lecture, home: HOME, resoudre };
}

const RESOLU_LIEN = (chemin: string): string => (chemin === LIEN ? '/data/autre/secret' : chemin);

describe('outils permis', () => {
  test('les outils de lecture et d écriture sont permis, Bash et les outils MCP ne le sont pas', () => {
    expect(outilInvitePermis('Read')).toBe(true);
    expect(outilInvitePermis('TodoWrite')).toBe(true);
    expect(outilInvitePermis('Bash')).toBe(false);
    expect(outilInvitePermis('Task')).toBe(false);
    expect(outilInvitePermis('mcp__lanterne__reseau_inviter')).toBe(false);
    expect(verifierOutil(confinement(), 'Bash', { command: 'ls' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'mcp__x__y', {}).ok).toBe(false);
  });

  test('un fichier de l espace se lit et s écrit', () => {
    const c = confinement();
    expect(verifierOutil(c, 'Read', { file_path: `${ESPACE}/notes.md` })).toEqual({ ok: true });
    expect(verifierOutil(c, 'Write', { file_path: 'rapport.md' })).toEqual({ ok: true });
  });
});

describe('chemins', () => {
  test('la configuration Claude, le tilde, le relatif hors espace et le lien résolu hors espace sont refusés', () => {
    const c = confinement();
    expect(verifierOutil(c, 'Read', { file_path: `${HOME}/.claude/.credentials.json` }).ok).toBe(false);
    expect(verifierOutil(c, 'Read', { file_path: '~/.claude/.credentials.json' }).ok).toBe(false);
    expect(verifierOutil(c, 'Read', { file_path: '../x' }).ok).toBe(false);
    expect(verifierOutil(confinement([], RESOLU_LIEN), 'Read', { file_path: LIEN }).ok).toBe(false);
  });

  test('l écriture reste dans l espace et refuse les racines de lecture', () => {
    const c = confinement(['/mnt/projets']);
    expect(verifierChemin(c, '/mnt/projets/x.md', 'lecture')).toEqual({ ok: true });
    expect(verifierChemin(c, '/mnt/projets/x.md', 'ecriture').ok).toBe(false);
    expect(verifierOutil(c, 'Write', { file_path: '/etc/passwd' }).ok).toBe(false);
  });

  test('un chemin sensible reste refusé même sous une racine de lecture qui l englobe', () => {
    const c = confinement([HOME]);
    expect(verifierChemin(c, `${HOME}/.ssh/id_ed25519`, 'lecture').ok).toBe(false);
    expect(verifierChemin(c, '/proc/self/environ', 'lecture').ok).toBe(false);
  });

  test('un dossier .claude refusé dans l espace, en lecture comme en écriture', () => {
    const c = confinement();
    expect(verifierOutil(c, 'Write', { file_path: `${ESPACE}/.claude/settings.json` }).ok).toBe(false);
    expect(verifierOutil(c, 'Read', { file_path: '.claude/settings.json' }).ok).toBe(false);
  });

  test('un chemin vide, un octet nul ou un ~ en tête est refusé', () => {
    const c = confinement();
    expect(verifierChemin(c, '', 'lecture').ok).toBe(false);
    expect(verifierChemin(c, 'a\0b', 'lecture').ok).toBe(false);
    expect(verifierChemin(c, '~/x', 'lecture').ok).toBe(false);
  });
});

describe('motifs de recherche', () => {
  test('Glob sur /home/** refusé ; motif relatif dans l espace permis', () => {
    const c = confinement();
    expect(verifierOutil(c, 'Glob', { pattern: '/home/**' }).ok).toBe(false);
    expect(verifierOutil(c, 'Glob', { pattern: '**/*.md' })).toEqual({ ok: true });
  });

  test('Grep avec un glob absolu hors espace refusé', () => {
    const c = confinement();
    expect(verifierOutil(c, 'Grep', { pattern: 'x', glob: '/root/*' }).ok).toBe(false);
    expect(verifierOutil(c, 'Grep', { pattern: 'x', path: 'src' })).toEqual({ ok: true });
  });

  test('cheminsDeOutil : valeurs par défaut, partie fixe absolue, valeur non chaîne refusée', () => {
    expect(cheminsDeOutil('Glob', { pattern: '/srv/data/**/*.ts' })).toEqual({
      lecture: ['.', '/srv/data/'],
      ecriture: [],
    });
    expect(cheminsDeOutil('Read', { file_path: 3 })).toBeNull();
    expect(cheminsDeOutil('WebSearch', { query: 'x' })).toEqual({ lecture: [], ecriture: [] });
  });
});

describe('URL', () => {
  test('boucle locale, localhost, réseau privé et noms locaux refusés ; https public permis', () => {
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'http://127.0.0.1:4000/' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'http://localhost' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'http://nas.local/x' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'http://10.0.0.5/' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'http://[::1]/' }).ok).toBe(false);
    expect(verifierOutil(confinement(), 'WebFetch', { url: 'https://example.com' })).toEqual({ ok: true });
  });

  test('protocole, nom sans point, url absente ou non texte refusés', () => {
    expect(verifierUrlSyntaxe('ftp://example.com/x').ok).toBe(false);
    expect(verifierUrlSyntaxe('http://interne/').ok).toBe(false);
    expect(verifierUrlSyntaxe('https://example.com/a')).toEqual({ ok: true, hote: 'example.com' });
    expect(verifierUrlSyntaxe(undefined).ok).toBe(false);
    expect(verifierUrlSyntaxe(42).ok).toBe(false);
  });
});

describe('adresses privées', () => {
  test('IPv4 : réseaux privés, boucle, lien local, multicast refusés ; adresse publique permise', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '127.0.0.1']) {
      expect(adressePrivee(ip)).toBe(true);
    }
    for (const ip of ['169.254.1.1', '0.0.0.0', '224.0.0.1']) expect(adressePrivee(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1']) expect(adressePrivee(ip)).toBe(false);
  });

  test('IPv6 : boucle, non spécifiée, unique locale, lien local, mappée IPv4 ; publique permise', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      expect(adressePrivee(ip)).toBe(true);
    }
    expect(adressePrivee('2001:4860:4860::8888')).toBe(false);
    expect(adressePrivee('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('chemins Windows (invité sur un PC Windows, recette 0.2)', () => {
  const ESPACE_W = 'C:\\Users\\Elie\\lanterne-invites\\ab12cd34ef56\\espace';
  const conf: Confinement = {
    espace: ESPACE_W,
    lecture: [],
    home: 'C:\\Users\\Elie',
    resoudre: (c) => c,
    windows: true,
  };

  test('écrire dans son espace est permis (chemin absolu à barres inverses, relatif, casse différente)', () => {
    expect(verifierChemin(conf, `${ESPACE_W}\\notes.txt`, 'ecriture')).toEqual({ ok: true });
    expect(verifierChemin(conf, 'sous\\dossier\\a.txt', 'ecriture')).toEqual({ ok: true });
    expect(verifierChemin(conf, 'c:/users/elie/lanterne-invites/ab12cd34ef56/espace/b.txt', 'ecriture')).toEqual({
      ok: true,
    });
  });

  test('hors de l’espace, configuration Claude et dossiers sensibles restent refusés', () => {
    expect(verifierChemin(conf, 'C:\\Users\\Elie\\Desktop\\x.txt', 'ecriture').ok).toBe(false);
    expect(verifierChemin(conf, `${ESPACE_W}\\..\\..\\x.txt`, 'ecriture').ok).toBe(false);
    expect(verifierChemin(conf, 'C:\\Users\\Elie\\.claude\\.credentials.json', 'lecture').ok).toBe(false);
    expect(verifierChemin(conf, `${ESPACE_W}\\.claude\\settings.json`, 'ecriture').ok).toBe(false);
    expect(verifierChemin(conf, `${ESPACE_W}espace-voisin\\a.txt`, 'ecriture').ok).toBe(false);
  });
});
