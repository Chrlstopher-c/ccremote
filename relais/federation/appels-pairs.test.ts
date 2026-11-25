// Responsabilité : tests du relais d'un appel de module entre nœuds de même propriétaire — l'appel part au pair, le
// pair l'exécute avec ses applis seulement (route locale, sans nouveau relais), le premier succès gagne, et un invité,
// un nœud d'un autre propriétaire ou un pair sans droit n'y ont pas accès.
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { RequeteDroit } from '../../commun/charte.ts';
import type { MessageChiffre } from '../../commun/federation.ts';
import { estGesteRelayable } from '../../commun/gestes-federes.ts';
import type { DemandeAppelModule, ReponseAppelModule } from '../../commun/modules.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { appelerLocalPair } from '../modules/api-appels.ts';
import { AppelsModules, AUCUNE_APPLI, MODULE_ABSENT, type RelaisPairs } from '../modules/appels.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { AppelsPairs, autoriserPair, estAppelPair, estPairRelayable, ROUTE_APPEL_PAIR } from './appels-pairs.ts';
import type { CanalNoeud } from './canal.ts';
import type { Echanges } from './echanges.ts';
import { executerGeste, type TableInterne } from './executeur.ts';

const journal = pino({ enabled: false });
const DEMANDE: DemandeAppelModule = { module: 'navigateur', outil: 'lire', arguments: {}, session: 'sess-1' };
const SANS_RELAIS: RelaisPairs = { relayer: async () => null };

/** Un nœud pair : ses applis locales (réponse `reponse`, ou aucune si null) et son propre `AppelsModules`. */
function pair(reponse: Omit<ReponseAppelModule, 'appel'> | null, relais: RelaisPairs = SANS_RELAIS) {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  const diffusion = new Diffusion();
  const recus: DemandeAppelModule[] = [];
  let appels: AppelsModules | null = null;
  if (reponse !== null) {
    const ws = {
      send: (texte: string) => {
        const m = JSON.parse(texte) as { type: string; appel?: string };
        if (m.type !== 'module_appel' || m.appel === undefined) return;
        setTimeout(() => appels?.repondre({ appel: m.appel as string, ...reponse }), 0);
      },
    };
    diffusion.ajouter(ws as unknown as ServerWebSocket<unknown>);
  }
  appels = new AppelsModules({ registre, diffusion, delaiMs: 1000, pairs: relais });
  const table: TableInterne = {
    '/api/modules/appel-pair': { POST: (req: Request) => appelerLocalPair(appels as AppelsModules, req) },
  };
  return { appels, recus, table };
}

type Pair = ReturnType<typeof pair>;

/** Les liens vers des pairs, simulés : chaque requête est exécutée par la route locale du pair visé. */
function relayeurAvec(pairs: { membre: string; noeud: Pair }[]): AppelsPairs {
  const canaux = pairs.map((p) => ({ membre: p.membre }) as unknown as CanalNoeud);
  const requeter = async (
    canal: CanalNoeud,
    construire: (ref: string) => MessageChiffre | readonly MessageChiffre[],
  ) => {
    const visé = pairs.find((p) => p.membre === canal.membre);
    if (!visé) return null;
    const m = construire('ref-1') as Extract<MessageChiffre, { t: 'geste' }>;
    const reponse = await executerGeste(visé.noeud.table, { geste: m.geste, methode: m.methode, corps: m.corps });
    return {
      t: 'geste_reponse' as const,
      ref: m.ref,
      statut: reponse.status,
      corps: await reponse.text(),
    } as MessageChiffre;
  };
  return new AppelsPairs({
    pairs: () => canaux,
    echanges: { requeter } as unknown as Pick<Echanges, 'requeter'>,
    journal,
  });
}

describe('relais d’un appel vers un pair de même propriétaire', () => {
  test('le pair a une appli : l’appel est exécuté là-bas, la session est gardée des deux côtés', async () => {
    const distant = pair({ ok: true, resultat: { url: 'https://x' } });
    const relayeur = relayeurAvec([{ membre: 'portable', noeud: distant }]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toEqual({ ok: true, resultat: { url: 'https://x' } });
  });

  test('pair sans appli : pas de succès, rien ne remonte comme résultat', async () => {
    const distant = pair(null);
    const relayeur = relayeurAvec([{ membre: 'portable', noeud: distant }]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toBeNull();
  });

  test('pair qui répond « module absent » : pas de succès', async () => {
    const distant = pair({ ok: false, erreur: MODULE_ABSENT });
    const relayeur = relayeurAvec([{ membre: 'portable', noeud: distant }]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toBeNull();
  });

  test('premier succès gagne : un pair sans appli n’empêche pas l’autre', async () => {
    const vide = pair(null);
    const ouvert = pair({ ok: true, resultat: 'second' });
    const relayeur = relayeurAvec([
      { membre: 'vide', noeud: vide },
      { membre: 'ouvert', noeud: ouvert },
    ]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toEqual({ ok: true, resultat: 'second' });
  });

  test('pas de boucle : le pair exécute l’appel avec ses applis, il ne le relaie jamais à son tour', async () => {
    let relaisEnAval = 0;
    const enAval: RelaisPairs = {
      relayer: async () => {
        relaisEnAval += 1;
        return null;
      },
    };
    const distant = pair(null, enAval);
    const relayeur = relayeurAvec([{ membre: 'portable', noeud: distant }]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toBeNull();
    expect(relaisEnAval).toBe(0);
  });

  test('aucun pair relayable : rien n’est envoyé', async () => {
    const relayeur = new AppelsPairs({ pairs: () => [], echanges: { requeter: async () => null }, journal });
    expect(await relayeur.relayer(DEMANDE, 1000)).toBeNull();
  });
});

describe('droits du relais', () => {
  const appel: RequeteDroit = { genre: 'geste', methode: 'POST', suffixe: ROUTE_APPEL_PAIR };
  const meme = (id: string) => id === 'portable';
  const toujoursPermis = () => true;

  test('la route d’appel est sur la liste fermée des gestes de nœud, et seulement là', () => {
    expect(estGesteRelayable('noeud', ROUTE_APPEL_PAIR)).toBe(true);
    expect(estGesteRelayable('session', ROUTE_APPEL_PAIR)).toBe(false);
    expect(estAppelPair(appel)).toBe(true);
    expect(estAppelPair({ genre: 'geste', methode: 'GET', suffixe: 'evenements' })).toBe(false);
  });

  test('un invité ou un nœud d’un autre propriétaire n’est pas relayable', () => {
    const enLigne = (id: string) => id === 'portable' || id === 'invite';
    expect(estPairRelayable('portable', enLigne, () => false)).toBe(true);
    expect(estPairRelayable('invite', enLigne, (id) => id === 'invite')).toBe(false);
    expect(estPairRelayable('ami', enLigne, () => false)).toBe(false);
  });

  test('un pair non relayable est refusé sur la route d’appel, même si la charte le permet', () => {
    expect(autoriserPair('ami', appel, meme, toujoursPermis)).toBe(false);
    expect(autoriserPair('invite', appel, meme, toujoursPermis)).toBe(false);
  });

  test('un pair relayable reste soumis à la charte ; les autres gestes ne sont pas touchés par la règle', () => {
    expect(autoriserPair('portable', appel, meme, () => false)).toBe(false);
    expect(autoriserPair('portable', appel, meme, toujoursPermis)).toBe(true);
    const autre: RequeteDroit = { genre: 'geste', methode: 'GET', suffixe: 'evenements' };
    expect(autoriserPair('ami', autre, meme, toujoursPermis)).toBe(true);
  });
});

describe('refus réel d’un pair qui a une appli', () => {
  test('sa raison remonte, au lieu de « aucun appareil »', async () => {
    const distant = pair({ ok: false, erreur: 'navigateur fermé pour cette session' });
    const relayeur = relayeurAvec([{ membre: 'portable', noeud: distant }]);
    expect(await relayeur.relayer(DEMANDE, 1000)).toEqual({ ok: false, erreur: 'navigateur fermé pour cette session' });
  });
});
