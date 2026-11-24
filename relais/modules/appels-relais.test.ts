// Responsabilité : tests du repli d'un appel de module vers les pairs — relayé quand aucune appli locale ne peut le
// traiter (aucune, ou toutes « module absent »), jamais quand une appli répond, et jamais relayé depuis un pair.
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { DemandeAppelModule, ReponseAppelModule } from '../../commun/modules.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import {
  AppelsModules,
  absentDeToutes,
  AUCUNE_APPLI,
  MODULE_ABSENT,
  type RelaisPairs,
  type ResultatAppel,
} from './appels.ts';

const journal = pino({ enabled: false });
const DEMANDE: DemandeAppelModule = {
  module: 'navigateur',
  outil: 'lire',
  arguments: { filtre: 'tout' },
  session: 'sess-1',
};

type Reponse = Omit<ReponseAppelModule, 'appel'>;

/** Une appli locale : répond `reponse` à chaque appel diffusé (rien si `reponse` est null). */
function applis(diffusion: Diffusion, appels: () => AppelsModules, reponse: Reponse | null): void {
  if (reponse === null) return;
  const ws = {
    send: (texte: string) => {
      const m = JSON.parse(texte) as { type: string; appel?: string };
      if (m.type !== 'module_appel' || m.appel === undefined) return;
      setTimeout(() => appels().repondre({ appel: m.appel as string, ...reponse }), 0);
    },
  };
  diffusion.ajouter(ws as unknown as ServerWebSocket<unknown>);
}

function noeud(
  reponse: Reponse | null,
  pairs?: RelaisPairs,
  delaiMs = 1000,
): { appels: AppelsModules; diffusion: Diffusion } {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  let instance: AppelsModules | null = null;
  applis(diffusion, () => instance as AppelsModules, reponse);
  instance = new AppelsModules({ registre, diffusion, delaiMs, ...(pairs ? { pairs } : {}) });
  return { appels: instance, diffusion };
}

function pairAvec(
  resultat: ResultatAppel | null,
): RelaisPairs & { recus: { demande: DemandeAppelModule; delai: number }[] } {
  const recus: { demande: DemandeAppelModule; delai: number }[] = [];
  return {
    recus,
    relayer: async (demande, delai) => {
      recus.push({ demande, delai });
      return resultat;
    },
  };
}

describe('repli vers les pairs', () => {
  test('aucune appli locale : l’appel part au pair, son résultat est rendu', async () => {
    const pair = pairAvec({ ok: true, resultat: { url: 'https://x' } });
    const { appels } = noeud(null, pair);
    expect(await appels.appeler(DEMANDE)).toEqual({ ok: true, resultat: { url: 'https://x' } });
    expect(pair.recus).toHaveLength(1);
    expect(pair.recus[0]?.demande).toEqual(DEMANDE);
  });

  test('toutes les applis locales répondent « module absent » : repli au pair', async () => {
    const pair = pairAvec({ ok: true, resultat: 'depuis le pair' });
    const { appels } = noeud({ ok: false, erreur: MODULE_ABSENT }, pair);
    expect(await appels.appeler(DEMANDE)).toEqual({ ok: true, resultat: 'depuis le pair' });
    expect(pair.recus).toHaveLength(1);
  });

  test('une appli locale qui répond : le pair n’est jamais sollicité', async () => {
    const pair = pairAvec({ ok: true, resultat: 'pair' });
    const { appels } = noeud({ ok: true, resultat: 'ici' }, pair);
    expect(await appels.appeler(DEMANDE)).toEqual({ ok: true, resultat: 'ici' });
    expect(pair.recus).toEqual([]);
  });

  test('une appli locale en échec réel (pas « module absent ») : pas de repli', async () => {
    const pair = pairAvec({ ok: true, resultat: 'pair' });
    const { appels } = noeud({ ok: false, erreur: 'fichier verrouillé' }, pair);
    expect(await appels.appeler(DEMANDE)).toEqual({ ok: false, erreur: 'fichier verrouillé' });
    expect(pair.recus).toEqual([]);
  });

  test('aucun pair ne réussit : le message d’origine est rendu (aucune appli, ou module absent partout)', async () => {
    const aucune = noeud(null, pairAvec(null));
    expect(await aucune.appels.appeler(DEMANDE)).toEqual({ ok: false, erreur: AUCUNE_APPLI });
    const absent = noeud({ ok: false, erreur: MODULE_ABSENT }, pairAvec(null));
    expect(await absent.appels.appeler(DEMANDE)).toEqual({ ok: false, erreur: absentDeToutes('navigateur') });
  });

  test('le délai restant transmis au pair ne dépasse pas le délai de l’appel', async () => {
    const pair = pairAvec(null);
    const { appels } = noeud(null, pair, 5000);
    await appels.appeler(DEMANDE);
    expect(pair.recus[0]?.delai).toBeGreaterThan(0);
    expect(pair.recus[0]?.delai).toBeLessThanOrEqual(5000);
  });

  test('appelerLocal ne relaie jamais : c’est le chemin d’un appel reçu d’un pair (pas de boucle)', async () => {
    const pair = pairAvec({ ok: true, resultat: 'boucle' });
    const { appels } = noeud(null, pair);
    expect(await appels.appelerLocal(DEMANDE)).toEqual({ ok: false, erreur: AUCUNE_APPLI });
    expect(pair.recus).toEqual([]);
  });
});
