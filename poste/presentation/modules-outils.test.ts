// Responsabilité : tests des outils `modules` côté poste — lister et appeler passent par le lien au relais (requête
// relayée, pas HTTP), restent exposés même sans API configurée, afficher n'émet qu'un événement `integration` exact.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { Evenement } from '../../commun/session.ts';
import type { ReponseRelais } from '../../commun/modules.ts';
import { afficherModule, appelerModule, listerModules } from './modules-outils.ts';
import type { ContexteOutils, RequeteRelais } from './outils.ts';
import { outilsModules } from './serveur.ts';
import { Stockage } from './stockage.ts';

const journal = pino({ level: 'silent' });

function banc(relais?: RequeteRelais): { c: ContexteOutils; evenements: Evenement[] } {
  const racine = mkdtempSync(join(tmpdir(), 'modules-outils-'));
  const evenements: Evenement[] = [];
  const c: ContexteOutils = {
    sessionId: 'sess-1',
    cwd: racine,
    racines: [racine],
    stockage: new Stockage(join(racine, 'donnees')),
    emettre: (evt) => evenements.push(evt),
    journal,
    ...(relais ? { relais } : {}),
  };
  return { c, evenements };
}

/** Un lien au relais factice : rend `reponse` et range ce qui a été demandé dans `demandes`. */
function lien(reponse: ReponseRelais, demandes: { quoi: string; args: unknown }[] = []): RequeteRelais {
  return async (quoi, args) => {
    demandes.push({ quoi, args });
    return reponse;
  };
}

describe('outils modules sans API configurée', () => {
  test('modules_lister, module_appeler et module_afficher sont toujours exposés', () => {
    const { c } = banc();
    expect(outilsModules(c).map((t) => t.name)).toEqual(['modules_lister', 'module_appeler', 'module_afficher']);
  });
});

describe('modules_lister', () => {
  test('rend les modules reçus du relais par le lien, avec leurs outils', async () => {
    const demandes: { quoi: string; args: unknown }[] = [];
    const modules = [{ module: 'carte', nom: 'Carte', outils: [{ nom: 'centrer' }], integrations: [] }];
    const r = await listerModules(banc(lien({ ok: true, donnees: modules }, demandes)).c);
    expect(r.erreur).toBe(false);
    expect(JSON.parse(r.texte)).toEqual({ modules });
    expect(demandes).toEqual([{ quoi: 'modules_lister', args: {} }]);
  });

  test('erreur du relais : rendue à l’agent', async () => {
    const r = await listerModules(banc(lien({ ok: false, erreur: 'panne' })).c);
    expect(r).toEqual({ texte: 'Échec : panne', erreur: true });
  });

  test('pas de lien au relais : refus lisible, pas d’exception', async () => {
    const r = await listerModules(banc().c);
    expect(r).toMatchObject({ erreur: true, texte: expect.stringContaining('lien au relais') });
  });

  test('lien qui lève : refus lisible, pas d’exception', async () => {
    const relais: RequeteRelais = () => Promise.reject(new Error('boum'));
    const r = await listerModules(banc(relais).c);
    expect(r).toMatchObject({ erreur: true, texte: expect.stringContaining('requête au relais en échec') });
  });
});

describe('module_appeler', () => {
  test('transmet le module, l’outil, les arguments et la session ; rend le résultat', async () => {
    const demandes: { quoi: string; args: unknown }[] = [];
    const reponse: ReponseRelais = { ok: true, donnees: { resultat: { centre: 'ok' } } };
    const r = await appelerModule(banc(lien(reponse, demandes)).c, {
      module: 'carte',
      outil: 'centrer',
      arguments: { lat: 1 },
    });
    expect(r.erreur).toBe(false);
    expect(JSON.parse(r.texte)).toEqual({ centre: 'ok' });
    expect(demandes).toEqual([
      {
        quoi: 'module_appeler',
        args: { module: 'carte', outil: 'centrer', arguments: { lat: 1 }, session: 'sess-1' },
      },
    ]);
  });

  test('aucune appli ouverte : l’erreur du relais est rendue à l’agent', async () => {
    const aucune = "Lanterne n'est ouverte sur aucun appareil";
    const r = await appelerModule(banc(lien({ ok: false, erreur: aucune })).c, { module: 'carte', outil: 'centrer' });
    expect(r).toEqual({ texte: `Échec : ${aucune}`, erreur: true });
  });

  test('pas de lien au relais : refus lisible', async () => {
    const r = await appelerModule(banc().c, { module: 'carte', outil: 'centrer' });
    expect(r).toMatchObject({ erreur: true, texte: expect.stringContaining('lien au relais') });
  });
});

describe('module_afficher', () => {
  test('émet exactement l’événement `integration` du fil', () => {
    const { c, evenements } = banc();
    const donnees = { lieux: [{ nom: 'Bar', lat: 48.8, lon: 2.3 }] };
    const r = afficherModule(c, { module: 'carte', integration: 'lieux', donnees, titre: 'Bars' });
    expect(r.erreur).toBe(false);
    expect(evenements).toEqual([
      { type: 'integration', module: 'carte', integration: 'lieux', donnees, titre: 'Bars' },
    ]);
  });

  test('sans titre, pas de champ titre ; données de plus de 64 Ko refusées sans événement', () => {
    const { c, evenements } = banc();
    afficherModule(c, { module: 'carte', integration: 'lieux', donnees: { a: 1 } });
    expect(evenements[0]).toEqual({ type: 'integration', module: 'carte', integration: 'lieux', donnees: { a: 1 } });
    const trop = afficherModule(c, { module: 'carte', integration: 'lieux', donnees: { t: 'x'.repeat(65 * 1024) } });
    expect(trop.erreur).toBe(true);
    expect(evenements.filter((e) => e.type === 'integration')).toHaveLength(1);
  });
});
