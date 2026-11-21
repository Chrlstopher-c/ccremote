// Responsabilité : tests des requêtes du poste au relais — envoi sur le lien ouvert, réponse rendue à l'id, délai
// injectable (au-delà, erreur lisible), relais hors ligne (erreur immédiate, rien n'est envoyé).
import { describe, expect, test } from 'bun:test';
import type { MessagePoste } from '../../commun/protocole-poste.ts';
import { DELAI_REQUETE_RELAIS_MS, RequetesRelais } from './requetes-relais.ts';

function banc(opts: { ouvert?: boolean; delaiMs?: number } = {}): {
  requetes: RequetesRelais;
  envoyes: MessagePoste[];
} {
  const envoyes: MessagePoste[] = [];
  const requetes = new RequetesRelais({
    envoyer: (m) => envoyes.push(m),
    estOuvert: () => opts.ouvert ?? true,
    ...(opts.delaiMs !== undefined ? { delaiMs: opts.delaiMs } : {}),
  });
  return { requetes, envoyes };
}

describe('requetes du poste au relais', () => {
  test('délai de 35 s côté poste (le relais répond avant, à 30 s)', () => {
    expect(DELAI_REQUETE_RELAIS_MS).toBe(35_000);
  });

  test('envoie `requete_relais` (id, nom, arguments) ; résout à la réponse du même id', async () => {
    const { requetes, envoyes } = banc();
    const attente = requetes.requete('modules_lister', {});
    const envoi = envoyes[0];
    expect(envoi).toMatchObject({ kind: 'requete_relais', quoi: 'modules_lister', args: {} });
    if (envoi?.kind !== 'requete_relais') throw new Error('requête attendue');
    expect(envoi.id.length).toBeGreaterThan(0);
    requetes.recevoir({ id: envoi.id, ok: true, donnees: { modules: [] } });
    expect(await attente).toEqual({ ok: true, donnees: { modules: [] } });
  });

  test('deux requêtes ont des ids distincts et chaque réponse va à la bonne', async () => {
    const { requetes, envoyes } = banc();
    const a = requetes.requete('modules_lister', {});
    const b = requetes.requete('module_appeler', { module: 'carte' });
    const [idA, idB] = envoyes.map((m) => (m.kind === 'requete_relais' ? m.id : ''));
    expect(idA).not.toBe(idB);
    requetes.recevoir({ id: idB ?? '', ok: false, erreur: 'non' });
    requetes.recevoir({ id: idA ?? '', ok: true, donnees: 1 });
    expect(await a).toEqual({ ok: true, donnees: 1 });
    expect(await b).toEqual({ ok: false, erreur: 'non' });
  });

  test('une réponse d’un id inconnu est ignorée', () => {
    const { requetes } = banc();
    expect(() => requetes.recevoir({ id: 'inconnu', ok: true })).not.toThrow();
  });

  test('lien hors ligne : erreur immédiate, rien n’est envoyé', async () => {
    const { requetes, envoyes } = banc({ ouvert: false });
    const r = await requetes.requete('modules_lister', {});
    expect(r).toMatchObject({ ok: false, erreur: expect.stringContaining('relais injoignable') });
    expect(envoyes).toHaveLength(0);
  });

  test('aucune réponse dans le délai : erreur lisible, pas d’exception', async () => {
    const { requetes } = banc({ delaiMs: 10 });
    const r = await requetes.requete('module_appeler', { module: 'carte', outil: 'centrer' });
    expect(r).toMatchObject({ ok: false, erreur: expect.stringContaining('délai') });
  });
});
