// Le fil d'une session SDK relève les fichiers d'un tour : le crochet PreToolUse garde l'avant, la fin de tour émet
// `fichiers_tour` juste avant `tour_fini`, et un tour interrompu (session fermée avant son `result`) est clos de même.
import { describe, expect, test } from 'bun:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Evenement } from '../../commun/session.ts';
import { ToursSession } from '../modifications/tours.ts';
import { attendre, journal, persistee, RequeteFausse, traduction } from './faux-sdk.ts';
import { type EnvironnementSdk, SessionSdk } from './session-sdk.ts';

const base = mkdtempSync(join(tmpdir(), 'quart-sdk-tours-'));

// Déclenche le crochet d'édition que la session a passé au SDK, comme le CLI le ferait avant un Edit.
async function declencherCrochet(requete: RequeteFausse, fichier: string): Promise<void> {
  for (const matcher of requete.options.hooks?.PreToolUse ?? []) {
    for (const crochet of matcher.hooks) {
      // Entrée factice : seule `tool_input` est lue par la capture.
      const entree = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: fichier } };
      await crochet(entree as unknown as HookInput, 'tu-1', { signal: new AbortController().signal });
    }
  }
}

// Une session SDK dont le tour exécute `tour` : il reçoit la requête pour déclencher le crochet d'édition.
function montage(racine: string, tour: (requete: RequeteFausse) => Promise<{ type: string }[]>) {
  const evenements: Evenement[] = [];
  const tours = new ToursSession({ sessionId: 'quart-1', racine, donnees: join(base, 'donnees'), journal });
  const env: EnvironnementSdk = {
    journal,
    sortie: { evenement: (_id, evt) => void evenements.push(evt), resume: () => undefined },
    executable: null,
    requete: (p) => {
      const requete: RequeteFausse = new RequeteFausse(p.prompt, p.options, () => tour(requete), []);
      return requete;
    },
    traduction,
    env: { HOME: '/home/test' },
    socket: '/run/poste.sock',
    delaiMcpMs: 200,
    periodeMcpMs: 1,
    tours,
  };
  return { session: new SessionSdk(persistee(null), env), evenements };
}

describe('fichiers d’un tour dans une session SDK', () => {
  test('fichiers_tour part juste avant tour_fini, avec le fichier édité', async () => {
    const racine = mkdtempSync(join(base, 'tour-'));
    const fichier = join(racine, 'a.txt');
    writeFileSync(fichier, 'avant\n');
    const { session, evenements } = montage(racine, async (requete) => {
      await declencherCrochet(requete, fichier);
      writeFileSync(fichier, 'avant\naprès\n');
      return [{ type: 'result' }];
    });
    expect(await session.lancer('modifie')).toBeNull();
    await attendre(() => evenements.some((e) => e.type === 'tour_fini'));
    const types = evenements.map((e) => e.type);
    const i = types.indexOf('fichiers_tour');
    expect(i).toBeGreaterThan(-1);
    expect(types[i + 1]).toBe('tour_fini');
    expect(evenements[i]).toMatchObject({
      type: 'fichiers_tour',
      fichiers: [{ chemin: 'a.txt', etat: 'modifie', ajouts: 1, suppressions: 0, binaire: false }],
    });
    expect(readFileSync(fichier, 'utf8')).toBe('avant\naprès\n');
    rmSync(racine, { recursive: true, force: true });
  });

  test('un tour interrompu (session fermée avant son `result`) : fichiers relevés, pas de tour_fini', async () => {
    const racine = mkdtempSync(join(base, 'coupe-'));
    const fichier = join(racine, 'b.txt');
    writeFileSync(fichier, 'x\n');
    let edite = false;
    const { session, evenements } = montage(racine, async (requete) => {
      await declencherCrochet(requete, fichier);
      writeFileSync(fichier, 'y\n');
      edite = true;
      return [];
    });
    await session.lancer('coupe');
    await attendre(() => edite);
    expect(await session.fermer()).toBeNull();
    expect(evenements.map((e) => e.type)).toContain('fichiers_tour');
    expect(evenements.some((e) => e.type === 'tour_fini')).toBe(false);
    rmSync(racine, { recursive: true, force: true });
  });
});
