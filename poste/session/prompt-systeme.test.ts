// Responsabilité : tests de la commande prompt_systeme — le prompt de la conversation part avec la requête suivante,
// et une session d'invité sans jeton du chef ne lance aucun processus.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { attendre, nouvelleSession, persistee, RequeteFausse, traduction } from './faux-sdk.ts';
import { SessionSdk } from './session-sdk.ts';

function ajout(r: RequeteFausse | undefined): string {
  const sp = r?.options.systemPrompt;
  return sp && typeof sp === 'object' && 'append' in sp ? (sp.append ?? '') : '';
}

describe('commande prompt_systeme', () => {
  test('changé au repos : la requête est fermée, la suite part avec le nouveau prompt', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }]);
    await session.lancer('premier');
    await attendre(() => session.resume.statut === 'attente');
    expect(await session.promptSysteme('Réponds en vers.')).toBeNull();
    expect(requetes[0]?.fermee).toBe(true);
    expect(session.resume.prompt_systeme).toBe('Réponds en vers.');
    expect(await session.envoyer('deuxième')).toBeNull();
    await attendre(() => requetes.length === 2);
    expect(ajout(requetes[1])).toContain('Réponds en vers.');
    expect(ajout(requetes[0])).not.toContain('Réponds en vers.');
  });

  test('vide : le prompt de la conversation est retiré à la reprise suivante', async () => {
    const { session, requetes } = nouvelleSession(async () => [{ type: 'result' }], {
      resume: { prompt_systeme: 'Ancien prompt.' },
    });
    await session.lancer('premier');
    await attendre(() => session.resume.statut === 'attente');
    await session.promptSysteme(null);
    expect(session.resume.prompt_systeme).toBeNull();
    await session.envoyer('deuxième');
    await attendre(() => requetes.length === 2);
    expect(ajout(requetes[1])).not.toContain('Ancien prompt.');
  });
});

describe('session d’invité sans jeton du chef', () => {
  test('la session passe en erreur avec le message du cadre, aucun processus n’est lancé', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'prompt-systeme-test-'));
    try {
      const journal = pino({ level: 'silent' });
      const base = persistee(null);
      const invite = { cadre: cadreVide(racine), configCompte: join(racine, 'sans-identifiants') };
      let fabrique = 0;
      const env = {
        journal,
        sortie: { evenement: () => undefined, resume: () => undefined },
        executable: null,
        socket: '/run/poste.sock',
        requete: (p: { options: unknown }) => {
          fabrique += 1;
          throw new Error(`processus lancé à tort : ${String(p.options)}`);
        },
        traduction,
        env: { HOME: racine },
        delaiMcpMs: 200,
        periodeMcpMs: 1,
      };
      const session = new SessionSdk({ ...base, invite }, env);
      expect(await session.lancer('bonjour', null, [])).toBe('Le compte Claude du chef doit se reconnecter (jeton expiré)');
      expect(session.resume.statut).toBe('erreur');
      expect(fabrique).toBe(0);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  });
});

function cadreVide(racine: string) {
  return {
    membre: 'abcdefabcdef',
    nom: 'Elie',
    espace: racine,
    config: join(racine, 'config'),
    lecture: [],
    prompt: '',
    remoteControl: false,
  };
}
