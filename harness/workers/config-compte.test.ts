/**
 * `☠` Ce que la configuration d'un compte d'équipe doit contenir — et pourquoi
 * son absence était invisible.
 *
 * Isoler un compte par `CLAUDE_CONFIG_DIR` isole AUSSI toute la configuration :
 * ni CLAUDE.md, ni skills, ni règles, ni settings. Le harness compensait par des
 * liens symboliques posés à la main le 22/07, avec cette note au TODO : « à
 * refaire pour tout nouveau compte ajouté ». Un rappel n'est pas un mécanisme.
 *
 * Relevé le 01/08, neuf jours plus tard :
 *   · `reference/` n'était lié sur AUCUN des deux comptes, alors que CLAUDE.md
 *     et les règles y renvoient nommément — les leads lisaient des consignes
 *     pointant vers des fichiers inexistants ;
 *   · `settings.json` manquait sur `compte-b` seulement, donc les hooks avec.
 *     La rotation multi-comptes étant automatique, une équipe n'avait pas les
 *     mêmes capacités selon le compte tiré. Rien, nulle part, ne le disait.
 *
 * D'où ces tests : ils portent sur le CONSTAT, pas sur le refus. Une équipe mal
 * outillée doit démarrer quand même — elle travaille moins bien, pas faux — mais
 * l'écart doit être lisible.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elementsConfigManquants } from './preflight-config.ts';

const dossiers: string[] = [];

/** Le test CRÉE ce qu'il valide, sous `os.tmpdir()` — jamais un chemin du poste. */
function configDir(elements: readonly string[]): string {
  const d = mkdtempSync(join(tmpdir(), 'cfg-compte-'));
  dossiers.push(d);
  for (const nom of elements) {
    if (nom.endsWith('.json') || nom.endsWith('.md')) writeFileSync(join(d, nom), '{}', 'utf8');
    else mkdirSync(join(d, nom));
  }
  return d;
}

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('complétude de la config d’un compte d’équipe', () => {
  test('une config complète ne signale rien', async () => {
    const d = configDir(['CLAUDE.md', 'rules', 'reference', 'skills', 'settings.json']);
    expect(await elementsConfigManquants(d)).toEqual([]);
  });

  test('☠ `reference/` manquant est signalé — le cas réel des DEUX comptes', async () => {
    // CLAUDE.md et les règles y renvoient nommément. Sans lui, le lead suit une
    // consigne vers un fichier qui n'existe pas.
    const d = configDir(['CLAUDE.md', 'rules', 'skills', 'settings.json']);
    expect(await elementsConfigManquants(d)).toEqual(['reference']);
  });

  test('☠ `settings.json` manquant est signalé — le cas réel de compte-b', async () => {
    // C'est lui qui porte les hooks et le modèle. Son absence sur UN SEUL compte
    // rendait le comportement d'une équipe dépendant du tirage de la rotation.
    const d = configDir(['CLAUDE.md', 'rules', 'reference', 'skills']);
    expect(await elementsConfigManquants(d)).toEqual(['settings.json']);
  });

  test('un compte entièrement nu liste TOUT, pas seulement le premier manquant', async () => {
    // Un diagnostic qui s'arrête au premier écart fait réparer en plusieurs
    // passes, et on croit avoir fini après la première.
    const manquants = await elementsConfigManquants(configDir([]));
    expect(manquants).toContain('CLAUDE.md');
    expect(manquants).toContain('reference');
    expect(manquants).toContain('settings.json');
    expect(manquants.length).toBe(5);
  });

  test('sans configDir imposé, rien n’est réclamé — c’est la config du poste', async () => {
    // Le poste n'est pas le sujet : il a sa propre config, complète par nature.
    expect(await elementsConfigManquants(undefined)).toEqual([]);
  });

  test('☠ `plugins` n’est PAS réclamé — c’est de l’état, pas un réglage', async () => {
    // Le lier ferait écrire plusieurs workers concurrents dans le même dossier
    // (cache, marketplaces). `compte-b` a le sien en propre et fonctionne.
    const d = configDir(['CLAUDE.md', 'rules', 'reference', 'skills', 'settings.json']);
    expect(await elementsConfigManquants(d)).not.toContain('plugins');
  });
});
