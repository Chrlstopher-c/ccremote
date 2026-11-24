// Responsabilité : tests d'une session SDK et de sa configuration — style de sortie, bac à sable, conversation annexe,
// connecteurs MCP, styles lus dans la requête vivante. Le faux SDK de faux-sdk.ts remplace le vrai modèle.
import { describe, expect, test } from 'bun:test';
import { OUTILS_INTERDITS_ANNEXE, CONSIGNE_ANNEXE } from './annexe.ts';
import { journal, nouvelleSession, type RequeteFausse } from './faux-sdk.ts';
import { optionsSdk } from './options-sdk.ts';
import { stylesDeSession } from './styles-session.ts';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIN = [{ type: 'result' }];

describe('style de sortie', () => {
  test('réglé à la création : passe aux options du SDK (settings.outputStyle)', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN, { resume: { style_sortie: 'Learning' } });
    await session.lancer('bonjour');
    expect((requetes[0] as RequeteFausse).options.settings).toEqual({ outputStyle: 'Learning' });
  });

  test('sans style : aucun réglage de sortie n’est envoyé au SDK', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    await session.lancer('bonjour');
    expect((requetes[0] as RequeteFausse).options.settings).toBeUndefined();
  });

  test('changé en cours de session : appliqué à la requête vivante et gardé dans la fiche', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    await session.lancer('bonjour');
    expect(await session.reglerSession({ kind: 'style', style: 'Explanatory' })).toBeNull();
    expect((requetes[0] as RequeteFausse).reglages).toContain('style:Explanatory');
    expect(session.resume.style_sortie).toBe('Explanatory');
  });
});

describe('bac à sable', () => {
  test('oui : sandbox activé, Bash auto-approuvé dans le bac ; strict : plus aucune commande hors bac', async () => {
    const oui = nouvelleSession(async () => FIN, { resume: { bac_a_sable: 'oui' } });
    await oui.session.lancer('x');
    expect((oui.requetes[0] as RequeteFausse).options.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
    });
    const strict = nouvelleSession(async () => FIN, { resume: { bac_a_sable: 'strict' } });
    await strict.session.lancer('x');
    expect((strict.requetes[0] as RequeteFausse).options.sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
    });
  });

  test('non : aucune clé sandbox', () => {
    const options = optionsSdk({
      session: 'x',
      identifiant: 'x',
      reprise: false,
      cwd: '/p',
      consignes: '',
      modele: undefined,
      mode: 'bypassPermissions',
      effort: null,
      executable: null,
      configDir: null,
      source: {},
      rythme: { type: 'stdio', command: 'node', args: [] },
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      bacASable: 'non',
    });
    expect('sandbox' in options).toBe(false);
  });
});

describe('conversation annexe', () => {
  test('outils d’écriture retirés, consigne annexe, pas de permission demandée', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN, {
      resume: { annexe_de: 'parente', mode: 'bypassPermissions' },
    });
    await session.lancer('résume-moi');
    const options = (requetes[0] as RequeteFausse).options;
    expect(options.disallowedTools).toEqual([...OUTILS_INTERDITS_ANNEXE]);
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(CONSIGNE_ANNEXE).toContain('sans modifier aucun fichier');
  });

  test('une session ordinaire n’a aucun outil retiré', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    await session.lancer('x');
    expect((requetes[0] as RequeteFausse).options.disallowedTools).toBeUndefined();
  });
});

describe('connecteurs MCP', () => {
  test('désactivé dans la session : appel au SDK, statut `disabled` ensuite', async () => {
    // Relevés dans l'ordre : l'attente au démarrage, le relevé après la bascule, la lecture du panneau.
    const { session, requetes } = nouvelleSession(async () => FIN, {
      mcp: [
        ['connected', 'connected'],
        ['connected', 'connected'],
        ['connected', 'connected'],
      ],
    });
    await session.lancer('x');
    expect(await session.basculerConnecteur('connecteur-1', false)).toBeNull();
    expect((requetes[0] as RequeteFausse).connecteursBascules).toEqual(['connecteur-1:inactif']);
    const etats = await session.connecteurs();
    expect(etats.map((e) => [e.nom, e.statut])).toEqual([
      ['connecteur-1', 'disabled'],
      ['connecteur-2', 'connected'],
    ]);
  });

  test('session arrêtée : le choix est retenu pour le prochain démarrage, rien n’est appelé', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    expect(await session.basculerConnecteur('connecteur-1', false)).toBeNull();
    expect(session.resume.connecteursCoupes).toEqual(['connecteur-1']);
    expect(requetes).toHaveLength(0);
  });
});

describe('styles lus dans la requête vivante', () => {
  test('session vivante : style courant et liste de la requête', async () => {
    const { session } = nouvelleSession(async () => FIN);
    await session.lancer('x');
    expect(await session.stylesVivants()).toEqual({
      actuel: 'default',
      disponibles: ['default', 'Explanatory', 'Learning'],
    });
  });

  test('session arrêtée : pas de requête, lecture sur disque (configuration puis projet)', async () => {
    const config = mkdtempSync(join(tmpdir(), 'cfg-sdk-'));
    mkdirSync(join(config, 'output-styles'), { recursive: true });
    writeFileSync(join(config, 'output-styles', 'maison.md'), '---\nname: Maison\n---\n');
    const { session } = nouvelleSession(async () => FIN, { configDir: config });
    expect(await session.stylesVivants()).toBeNull();
    const liste = await stylesDeSession(session, journal);
    expect(liste.actuel).toBe('default');
    expect(liste.disponibles).toContain('Maison');
  });

  test('rechargement : demandé à la requête vivante, sans effet à l’arrêt', async () => {
    const { session, requetes } = nouvelleSession(async () => FIN);
    await session.rechargerStyles();
    expect(requetes.length).toBe(0);
    await session.lancer('x');
    await session.rechargerStyles();
    expect((requetes[0] as RequeteFausse).rechargements).toBe(1);
  });
});
