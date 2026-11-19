import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { DefinitionConnecteur, MASQUE_VALEUR } from '../../commun/configuration.ts';
import { type DependancesConfiguration, executerConfiguration } from './commande.ts';
import { fichierConfigClaude } from './connecteurs-edition.ts';
import type { LanceurClaude } from './exec.ts';

const journal = pino({ enabled: false });
let ancien: string | undefined;
let dossier = '';
let invalidations = 0;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'commande-connecteurs-'));
  ancien = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CLAUDE_CONFIG_DIR'] = dossier;
  writeFileSync(fichierConfigClaude(), JSON.stringify({ mcpServers: {} }));
  invalidations = 0;
});

afterEach(() => {
  if (ancien === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = ancien;
});

// Faux `claude` : add-json échoue si le nom contient « refus ».
const lancer: LanceurClaude = async (args) => {
  if (args[1] === 'add-json' && (args[2] ?? '').includes('refus')) {
    return { code: 1, sortie: '', erreurs: 'Invalid configuration: refusé', delaiDepasse: false };
  }
  return { code: 0, sortie: '', erreurs: '', delaiDepasse: false };
};

function deps(): DependancesConfiguration {
  return {
    dossierConfig: dossier,
    lancer,
    connecteurs: {
      lister: async () => ({ ok: true, connecteurs: [] }),
      invalider: () => {
        invalidations += 1;
      },
    },
    recharger: () => undefined,
    journal,
  };
}

const DEF = DefinitionConnecteur.parse({ nom: 'web', type: 'http', url: 'https://exemple.invalide/mcp' });

describe('commandes de connecteurs sur le poste', () => {
  test('écriture : le cache de la liste est périmé, succès ou refus', async () => {
    const d = deps();
    await executerConfiguration({ kind: 'connecteur_ajouter', id: '1', definition: DEF }, d);
    expect(invalidations).toBe(1);
    const refus = DefinitionConnecteur.parse({ ...DEF, nom: 'refus' });
    const r = await executerConfiguration({ kind: 'connecteur_ajouter', id: '2', definition: refus }, d);
    expect(r).toEqual({ ok: false, erreur: 'Invalid configuration: refusé' });
    expect(invalidations).toBe(2);
  });

  test('lecture : masquée sans `reveler`, en clair avec', async () => {
    writeFileSync(
      fichierConfigClaude(),
      JSON.stringify({
        mcpServers: { web: { type: 'http', url: 'https://exemple.invalide/mcp', headers: { A: 'secret' } } },
      }),
    );
    const masque = await executerConfiguration(
      { kind: 'connecteur_lire', id: '3', nom: 'web', reveler: false },
      deps(),
    );
    expect(masque).toMatchObject({ ok: true, donnees: { entetes: { A: MASQUE_VALEUR } } });
    const clair = await executerConfiguration({ kind: 'connecteur_lire', id: '4', nom: 'web', reveler: true }, deps());
    expect(clair).toMatchObject({ ok: true, donnees: { entetes: { A: 'secret' } } });
    expect(invalidations).toBe(0);
  });

  test('lecture d’un connecteur absent : erreur lisible', async () => {
    const r = await executerConfiguration({ kind: 'connecteur_lire', id: '5', nom: 'fantome', reveler: false }, deps());
    expect(r).toEqual({ ok: false, erreur: 'connecteur introuvable : fantome' });
  });
});
