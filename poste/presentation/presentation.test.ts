import { titreNettoye } from './serveur.ts';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import { lireFichierSession } from './lecture.ts';
import { resoudreChemin } from './chemins.ts';
import { envoyerFichier, publierArtefact } from './envoi.ts';
import { afficherWidget } from './widget.ts';
import { imagesDeMessage, presenterImages } from './images.ts';
import { preparerPieces } from './pieces.ts';
import { type ContexteOutils } from './outils.ts';
import { Stockage } from './stockage.ts';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');

interface Banc {
  readonly c: ContexteOutils;
  readonly evenements: Evenement[];
  readonly cwd: string;
  readonly stockage: Stockage;
}

function banc(): Banc {
  const racine = mkdtempSync(join(tmpdir(), 'presentation-'));
  const cwd = join(racine, 'projet');
  mkdirSync(cwd, { recursive: true });
  const evenements: Evenement[] = [];
  const stockage = new Stockage(join(racine, 'donnees'));
  const c: ContexteOutils = {
    sessionId: 'sess-1',
    cwd,
    racines: [cwd],
    stockage,
    emettre: (evt) => evenements.push(evt),
    journal: pino({ level: 'silent' }),
  };
  return { c, evenements, cwd, stockage };
}

describe('resoudreChemin', () => {
  test('accepte un fichier sous le dossier de la session, relatif ou absolu', () => {
    const { cwd } = banc();
    writeFileSync(join(cwd, 'rapport.md'), '# r');
    const relatif = resoudreChemin('rapport.md', cwd, []);
    const absolu = resoudreChemin(join(cwd, 'rapport.md'), cwd, []);
    expect(relatif.ok && absolu.ok).toBe(true);
  });

  test('refuse un chemin hors des dossiers autorisés et un lien qui y mène', () => {
    const { cwd } = banc();
    expect(resoudreChemin('/etc/hostname', cwd, []).ok).toBe(false);
    symlinkSync('/etc/hostname', join(cwd, 'lien'));
    expect(resoudreChemin('lien', cwd, []).ok).toBe(false);
  });

  test('refuse un dossier et un fichier absent', () => {
    const { cwd } = banc();
    mkdirSync(join(cwd, 'dossier'));
    expect(resoudreChemin('dossier', cwd, []).ok).toBe(false);
    expect(resoudreChemin('absent.txt', cwd, []).ok).toBe(false);
  });
});

describe('envoyerFichier', () => {
  test('copie un rapport dans le stockage et émet un événement fichier en mode afficher', () => {
    const { c, evenements, cwd, stockage } = banc();
    writeFileSync(join(cwd, 'rapport.md'), '# Bilan');
    const r = envoyerFichier(c, { chemin: 'rapport.md', legende: '  Bilan du jour ' });
    expect(r.erreur).toBe(false);
    const evt = evenements[0];
    expect(evt).toMatchObject({
      type: 'fichier',
      nom: 'rapport.md',
      mime: 'text/markdown',
      mode: 'afficher',
      legende: 'Bilan du jour',
    });
    if (evt?.type !== 'fichier') throw new Error('événement attendu');
    expect(stockage.lire('sess-1', evt.fichier)?.octets.toString()).toBe('# Bilan');
  });

  test('refuse un type non présentable et l’explique dans le fil', () => {
    const { c, evenements, cwd } = banc();
    writeFileSync(join(cwd, 'archive.zip'), 'x');
    const r = envoyerFichier(c, { chemin: 'archive.zip' });
    expect(r.erreur).toBe(true);
    expect(evenements).toEqual([
      { type: 'relance', raison: 'présentation refusée : type de fichier non présentable : archive.zip' },
    ]);
  });

  test('refuse un fichier au-delà de 5 Mo sans rien stocker', () => {
    const { c, evenements, cwd } = banc();
    writeFileSync(join(cwd, 'gros.txt'), Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(envoyerFichier(c, { chemin: 'gros.txt' }).erreur).toBe(true);
    expect(evenements[0]?.type).toBe('relance');
  });
});

describe('publierArtefact', () => {
  test('publie une page puis une mise à jour versionnée', () => {
    const { c, evenements, stockage } = banc();
    const premier = publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v1</h1>' });
    expect(premier.erreur).toBe(false);
    const a = evenements[0];
    if (a?.type !== 'artefact') throw new Error('artefact attendu');
    expect(a.version).toBe(1);
    expect(stockage.versions('sess-1', a.artefact)).toBe(1);
    publierArtefact(c, { titre: 'Tableau', contenu: '<h1>v2</h1>', id: a.artefact });
    const b = evenements[1];
    if (b?.type !== 'artefact') throw new Error('artefact attendu');
    expect(b).toMatchObject({ artefact: a.artefact, version: 2 });
    expect(stockage.lire('sess-1', b.fichier)?.octets.toString()).toBe('<h1>v2</h1>');
  });

  test('refuse une mise à jour d’un artefact inconnu, un identifiant mal formé, ou les deux sources à la fois', () => {
    const { c } = banc();
    expect(publierArtefact(c, { titre: 'X', contenu: '<p/>', id: 'aaaaaaaaaaaaaaaa' }).erreur).toBe(true);
    expect(publierArtefact(c, { titre: 'X', contenu: '<p/>', id: '../etc' }).erreur).toBe(true);
    expect(publierArtefact(c, { titre: 'X', chemin: 'a.html', contenu: '<p/>' }).erreur).toBe(true);
    expect(publierArtefact(c, { titre: 'X' }).erreur).toBe(true);
  });

  test('prend une page HTML du poste et refuse un autre type', () => {
    const { c, cwd, evenements } = banc();
    writeFileSync(join(cwd, 'page.html'), '<p>ok</p>');
    writeFileSync(join(cwd, 'page.md'), '# non');
    expect(publierArtefact(c, { titre: 'Page', chemin: 'page.html' }).erreur).toBe(false);
    expect(publierArtefact(c, { titre: 'Page', chemin: 'page.md' }).erreur).toBe(true);
    expect(evenements.filter((e) => e.type === 'artefact')).toHaveLength(1);
  });
});

describe('afficherWidget', () => {
  test('affiche un SVG valide et refuse un SVG sans balise svg', () => {
    const { c, evenements } = banc();
    expect(afficherWidget(c, { titre: 'Courbe', code: '<svg viewBox="0 0 10 10"></svg>', type: 'svg' }).erreur).toBe(
      false,
    );
    expect(evenements[0]).toMatchObject({ type: 'widget', titre: 'Courbe', mime: 'image/svg+xml' });
    expect(afficherWidget(c, { titre: 'Mauvais', code: '<div></div>', type: 'svg' }).erreur).toBe(true);
  });

  test('refuse un widget vide ou trop lourd', () => {
    const { c } = banc();
    expect(afficherWidget(c, { titre: 'V', code: '   ', type: 'html' }).erreur).toBe(true);
    expect(afficherWidget(c, { titre: 'L', code: 'x'.repeat(300 * 1024 + 1), type: 'html' }).erreur).toBe(true);
  });
});

function messageUtilisateur(contenu: unknown, parent: string | null = null): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content: contenu },
    parent_tool_use_id: parent,
  } as unknown as SDKMessage;
}

describe('images des messages du SDK', () => {
  test('extrait une image directe et une image dans un résultat d’outil, ignore le reste', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1x1 } };
    const msg = messageUtilisateur([
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }, image] },
      { type: 'text', text: 'pas une image' },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zy8+' } },
    ]);
    expect(imagesDeMessage(msg)).toEqual([{ mime: 'image/png', base64: PNG_1x1 }]);
  });

  test('stocke et émet chaque image, avec l’agent auteur quand il y en a un', () => {
    const { c, evenements, stockage } = banc();
    presenterImages(c, [{ mime: 'image/png', base64: PNG_1x1 }], 'outil', 'agent-7');
    expect(evenements[0]).toMatchObject({ type: 'image', origine: 'outil', agent: 'agent-7', mime: 'image/png' });
    const evt = evenements[0];
    if (evt?.type !== 'image') throw new Error('image attendue');
    expect(stockage.lire('sess-1', evt.fichier)?.octets.length).toBeGreaterThan(0);
  });
});

describe('pièces jointes de Chris', () => {
  test('une image va au modèle en bloc, un fichier texte en chemin, un PDF en document', () => {
    const { c, stockage } = banc();
    const txt = Buffer.from('a,b\n1,2').toString('base64');
    const pdf = Buffer.from('%PDF-1.4').toString('base64');
    const r = preparerPieces(c, [
      { nom: 'photo.png', mime: 'image/png', base64: PNG_1x1 },
      { nom: 'donnees.csv', mime: 'text/csv', base64: txt },
      { nom: 'facture.pdf', mime: 'application/pdf', base64: pdf },
    ]);
    expect(r.blocs.map((b) => b.type)).toEqual(['image', 'document']);
    expect(r.evenements.map((e) => e.type)).toEqual(['image', 'fichier', 'fichier']);
    expect(r.complement).toContain('donnees.csv');
    expect(r.complement).toContain(stockage.dossier('sess-1'));
  });

  test('une pièce trop lourde ou d’un type non pris en charge refuse tout l’envoi', () => {
    const { c } = banc();
    expect(() => preparerPieces(c, [{ nom: 'script.exe', mime: 'application/octet-stream', base64: 'AAAA' }])).toThrow(
      'type non pris en charge',
    );
    const grosse = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
    expect(() => preparerPieces(c, [{ nom: 'g.png', mime: 'image/png', base64: grosse }])).toThrow('3 Mo');
  });
});

describe('lecture pour la route du relais', () => {
  test('rend le contenu en base64 avec nom et type, et null pour un identifiant inconnu', () => {
    const { c, evenements, cwd, stockage } = banc();
    writeFileSync(join(cwd, 'x.txt'), 'bonjour');
    envoyerFichier(c, { chemin: 'x.txt' });
    const evt = evenements[0];
    if (evt?.type !== 'fichier') throw new Error('fichier attendu');
    const lu = lireFichierSession(stockage, 'sess-1', evt.fichier, pino({ level: 'silent' }));
    expect(lu).toEqual({ nom: 'x.txt', mime: 'text/plain', base64: Buffer.from('bonjour').toString('base64') });
    expect(lireFichierSession(stockage, 'sess-1', 'aaaaaaaaaaaaaaaa', pino({ level: 'silent' }))).toBeNull();
    expect(lireFichierSession(stockage, 'sess-1', '../../../etc', pino({ level: 'silent' }))).toBeNull();
    expect(readFileSync(join(stockage.dossier('sess-1'), `${evt.fichier}.json`), 'utf8')).toContain('x.txt');
  });
});

describe('renommer_conversation', () => {
  test('le titre est nettoyé : espaces, guillemets, ponctuation finale, 60 caractères', () => {
    expect(titreNettoye('  « Refonte   du site » ')).toBe('Refonte du site');
    expect(titreNettoye('"Plan de la page tarifs."')).toBe('Plan de la page tarifs');
    expect(Array.from(titreNettoye('a'.repeat(200))).length).toBe(60);
    expect(titreNettoye('  "" ')).toBe('');
  });
});
