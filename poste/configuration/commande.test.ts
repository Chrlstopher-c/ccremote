import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { CommandeRelais } from '../../commun/protocole-poste.ts';
import { creerListeurConnecteurs } from './connecteurs.ts';
import {
  type CommandeConfiguration,
  type DependancesConfiguration,
  estCommandeConfiguration,
  executerConfiguration,
} from './commande.ts';
import { empreinte } from './instructions.ts';

const journal = pino({ level: 'silent' });
let config = '';

beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'commande-'));
});
afterEach(() => rmSync(config, { recursive: true, force: true }));

function deps(extra: Partial<DependancesConfiguration> = {}): DependancesConfiguration {
  return {
    dossierConfig: config,
    lancer: async () => ({ code: 0, sortie: '[]', erreurs: '', delaiDepasse: false }),
    connecteurs: creerListeurConnecteurs({
      lancer: async () => ({ code: 0, sortie: 'exemple: /fictif - ✔ Connected', erreurs: '', delaiDepasse: false }),
    }),
    recharger: () => undefined,
    journal,
    ...extra,
  };
}

describe('commandes de configuration', () => {
  test('reconnaît ses commandes et laisse passer les autres', () => {
    const lire = { kind: 'instructions_lire', id: '1' } as CommandeRelais;
    const session = { kind: 'envoyer', id: '1', sessionId: 's', texte: 'x' } as CommandeRelais;
    expect(estCommandeConfiguration(lire)).toBe(true);
    expect(estCommandeConfiguration(session)).toBe(false);
  });

  test('création de style : rend le nom, recharge les sessions ; un doublon est refusé sans recharge', async () => {
    let rechargements = 0;
    const d = deps({ recharger: () => (rechargements += 1) });
    const cree = {
      kind: 'styles_creer',
      id: '1',
      nom: 'Sobre',
      description: '',
      instructions: 'Court.',
    } as CommandeConfiguration;
    expect(await executerConfiguration(cree, d)).toEqual({ ok: true, donnees: { nom: 'Sobre' } });
    expect(rechargements).toBe(1);
    expect((await executerConfiguration(cree, d)).ok).toBe(false);
    expect(rechargements).toBe(1);
  });

  test('instructions : écriture avec empreinte à jour, puis conflit si elle est périmée', async () => {
    const d = deps();
    const lu = await executerConfiguration({ kind: 'instructions_lire', id: '1' } as CommandeConfiguration, d);
    const empreinteLue = (lu.donnees as { empreinte: string }).empreinte;
    const ok = await executerConfiguration(
      {
        kind: 'instructions_ecrire',
        id: '2',
        contenu: 'nouveau',
        empreinte_avant: empreinteLue,
      } as CommandeConfiguration,
      d,
    );
    expect(ok.ok).toBe(true);
    expect(readFileSync(join(config, 'CLAUDE.md'), 'utf8')).toBe('nouveau');
    const perimee = await executerConfiguration(
      {
        kind: 'instructions_ecrire',
        id: '3',
        contenu: 'autre',
        empreinte_avant: empreinte(''),
      } as CommandeConfiguration,
      d,
    );
    expect(perimee).toEqual({ ok: false, erreur: 'conflit' });
  });

  test('compétence hors liste : refus `interdit`', async () => {
    const hors = join(config, 'pas-une-competence.md');
    writeFileSync(hors, 'x');
    const r = await executerConfiguration(
      { kind: 'competences_contenu', id: '1', chemin: hors } as CommandeConfiguration,
      deps(),
    );
    expect(r).toEqual({ ok: false, erreur: 'interdit' });
  });

  test('compétence listée : contenu rendu', async () => {
    mkdirSync(join(config, 'skills', 'x'), { recursive: true });
    const chemin = join(config, 'skills', 'x', 'SKILL.md');
    writeFileSync(chemin, '---\nname: x\n---\nCorps');
    const r = await executerConfiguration(
      { kind: 'competences_contenu', id: '1', chemin } as CommandeConfiguration,
      deps(),
    );
    expect(r).toEqual({ ok: true, donnees: { contenu: '---\nname: x\n---\nCorps' } });
  });

  test('connecteurs et plug-ins : rendus tels que lus', async () => {
    const d = deps({
      lancer: async (args) =>
        args[1] === 'list'
          ? {
              code: 0,
              sortie: '[{"id":"e@m","version":"1","scope":"user","enabled":false}]',
              erreurs: '',
              delaiDepasse: false,
            }
          : {
              code: 0,
              sortie: '[{"id":"e@m","version":"1","scope":"user","enabled":true}]',
              erreurs: '',
              delaiDepasse: false,
            },
    });
    const conn = await executerConfiguration({ kind: 'connecteurs_machine', id: '1' } as CommandeConfiguration, d);
    expect(conn).toEqual({ ok: true, donnees: [{ nom: 'exemple', cible: '/fictif', etat: 'connecte' }] });
    const plugins = await executerConfiguration({ kind: 'plugins_lister', id: '2' } as CommandeConfiguration, d);
    expect(plugins.donnees).toEqual([{ id: 'e@m', version: '1', portee: 'user', actif: false, description: '' }]);
  });
});
