import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dossierSousAgents, lireSousAgents } from './sous-agents-disque.ts';

const SESSION = 'sess-1';
const CWD = '/mnt/projets/demo';
let configDir: string;

/** Reproduit la disposition RÉELLE du CLI, vérifiée sur le disque du PC (23/07). */
async function poserAgent(
  agentId: string,
  meta: Record<string, unknown> | null,
  lignes: readonly string[],
): Promise<void> {
  const dossier = dossierSousAgents(SESSION, CWD, configDir);
  await mkdir(dossier, { recursive: true });
  await writeFile(join(dossier, `agent-${agentId}.jsonl`), lignes.join('\n'));
  if (meta !== null) await writeFile(join(dossier, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

function messageAssistant(texte: string, horodatage: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: horodatage,
    message: { content: [{ type: 'text', text: texte }] },
  });
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'ccremote-sousagents-'));
});

afterEach(() => rm(configDir, { recursive: true, force: true }));

describe('sous-agents — la liste vient du DISQUE, pas du flux', () => {
  test('☠ les CINQ sous-agents sont rendus — le flux n’en livrait que 3 à 4 (H-72.4)', async () => {
    for (const nom of ['mer', 'montagne', 'forêt', 'désert', 'ville']) {
      await poserAgent(
        `a-${nom}`,
        { agentType: 'general-purpose', description: `Paragraphe sur ${nom}`, toolUseId: `toolu_${nom}`, spawnDepth: 1 },
        [messageAssistant(`Texte sur ${nom}`, '2026-07-22T16:32:24.619Z')],
      );
    }
    expect(await lireSousAgents(SESSION, CWD, configDir)).toHaveLength(5);
  });

  test('☠ le `toolUseId` du meta est remonté — c’est le pont flux ⟷ store', async () => {
    await poserAgent(
      'a-1',
      { agentType: 'Explore', description: 'Chercher X', toolUseId: 'toolu_013ZArBF', spawnDepth: 1 },
      [messageAssistant('trouvé', '2026-07-22T16:32:24.619Z')],
    );
    const [agent] = await lireSousAgents(SESSION, CWD, configDir);
    expect(agent?.toolUseId).toBe('toolu_013ZArBF');
    expect(agent?.type).toBe('Explore');
    expect(agent?.description).toBe('Chercher X');
  });

  test('☠ un agent SANS meta lisible est rendu quand même — jamais omis', async () => {
    await poserAgent('a-orphelin', null, [messageAssistant('je travaille', '2026-07-22T16:32:24.619Z')]);
    const [agent] = await lireSousAgents(SESSION, CWD, configDir);
    expect(agent?.agentId).toBe('a-orphelin');
    expect(agent?.type).toBeNull();
    expect(agent?.derniereAction).toBe('je travaille');
  });

  test('une dernière ligne TRONQUÉE (le CLI écrit pendant qu’on lit) ne perd pas l’agent', async () => {
    await poserAgent('a-1', { agentType: 'general-purpose' }, [
      messageAssistant('première', '2026-07-22T16:32:24.619Z'),
      '{"type":"assistant","messa',
    ]);
    const [agent] = await lireSousAgents(SESSION, CWD, configDir);
    expect(agent?.derniereAction).toBe('première');
  });

  test('aucun sous-agent dispatché ⇒ liste vide, jamais une exception', async () => {
    expect(await lireSousAgents('session-sans-agents', CWD, configDir)).toEqual([]);
  });
});

describe('sous-agents — statut déduit du silence', () => {
  test('une activité récente ⇒ actif', async () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    await poserAgent('a-1', { agentType: 'general-purpose' }, [messageAssistant('en cours', recent)]);
    const [agent] = await lireSousAgents(SESSION, CWD, configDir);
    expect(agent?.statut).toBe('actif');
  });

  test('☠ silence prolongé ⇒ terminé — un faux « actif » ferait croire à une équipe qui travaille', async () => {
    await poserAgent('a-1', { agentType: 'general-purpose' }, [
      messageAssistant('fini il y a longtemps', '2026-07-22T16:32:24.619Z'),
    ]);
    const [agent] = await lireSousAgents(SESSION, CWD, configDir);
    expect(agent?.statut).toBe('termine');
  });
});

/**
 * `☠ LE CLI RANGE SOUS LE CHEMIN RÉEL` (03/08). Sur le VPS, `/mnt/projects` est un
 * lien vers `~/dev` : le worker démarre avec `cwd=/mnt/projects/bac-a-sable`, le
 * CLI résout le realpath et écrit sous `-home-ubuntu-dev-bac-a-sable`, et le
 * harness cherchait `-mnt-projects-bac-a-sable`. Résultat mesuré sur la mission
 * `acbb7465` : sept transcrits sur le disque, « sous-agents : aucun » à l'écran
 * pendant toute la mission. Une machine à liens symboliques ne montrait donc
 * JAMAIS un sous-agent, en silence, depuis la bascule multi-machines.
 */
describe('sous-agents — projet atteint par un lien symbolique', () => {
  test('le dossier est trouvé même quand le cwd passe par un lien', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ccremote-lien-'));
    const reel = join(base, 'reel');
    const lien = join(base, 'lien');
    await mkdir(reel, { recursive: true });
    await symlink(reel, lien);

    // Le CLI écrit sous la clé du chemin RÉEL…
    const dossier = dossierSousAgents(SESSION, reel, configDir);
    await mkdir(dossier, { recursive: true });
    await writeFile(
      join(dossier, 'agent-lien-1.jsonl'),
      messageAssistant('ALPHA', new Date().toISOString()),
    );
    await writeFile(join(dossier, 'agent-lien-1.meta.json'), JSON.stringify({ agentType: 'general-purpose' }));

    // … et le harness interroge avec le chemin SYMBOLIQUE, celui du mandat.
    const agents = await lireSousAgents(SESSION, lien, configDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.derniereAction).toBe('ALPHA');
    await rm(base, { recursive: true, force: true });
  });
});
