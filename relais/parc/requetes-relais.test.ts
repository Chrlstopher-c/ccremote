// Responsabilité : tests de bout en bout du lien poste ↔ relais pour les outils de modules — le poste envoie
// `requete_relais`, le relais la traite comme les routes HTTP (capacités, appel relayé à une appli factice) et répond
// `reponse_relais` à l'id. Le poste et le relais sont les vrais modules ; seuls les sockets sont factices.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import pino from 'pino';
import type { MessageClient } from '../../commun/api-clients.ts';
import { CommandeRelais, type MessagePoste } from '../../commun/protocole-poste.ts';
import type { ManifesteModule } from '../../commun/modules.ts';
import { RequetesRelais } from '../../poste/parc/requetes-relais.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { traiterRequeteRelais } from '../modules/api-appels.ts';
import { AppelsModules, AUCUNE_APPLI } from '../modules/appels.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { type DonneesPoste, Postes } from './postes.ts';

const journal = pino({ enabled: false });
const EMPREINTE = 'a'.repeat(64);
const MANIFESTE: ManifesteModule = {
  id: 'carte',
  nom: 'Carte',
  version: '1.0.0',
  description: 'Test',
  icone: 'map',
  point: 'index.js',
  emplacements: ['panneau'],
  outils: [{ nom: 'centrer', description: 'Centre la carte', schema: { type: 'object' } }],
};

interface Banc {
  readonly requetes: RequetesRelais;
  readonly appels: AppelsModules;
  readonly diffusion: Diffusion;
  readonly recusParAppli: MessageClient[];
}

/** Un poste « tour » relié au relais ; une appli factice (optionnelle) répond à `module_appel` par `reponse`. */
function banc(opts: { appli?: boolean; delaiMs?: number } = {}): Banc {
  const registre = new Registre(ouvrirBase(':memory:'), journal);
  registre.modules.enregistrer('tour', {
    kind: 'module',
    id: 'carte',
    manifeste: MANIFESTE,
    fichiers: [],
    empreinte: EMPREINTE,
  });
  const diffusion = new Diffusion();
  const appels = new AppelsModules({ registre, diffusion, ...(opts.delaiMs ? { delaiMs: opts.delaiMs } : {}) });
  const recusParAppli: MessageClient[] = [];
  if (opts.appli ?? true) {
    const appli = {
      send: (t: string) => {
        const m = JSON.parse(t) as MessageClient;
        recusParAppli.push(m);
        if (m.type === 'module_appel') {
          const resultat = { centre: 'ok', recu: m.arguments };
          queueMicrotask(() => appels.repondre({ appel: m.appel, ok: true, resultat }));
        }
      },
    };
    diffusion.ajouter(appli as unknown as ServerWebSocket<unknown>);
  }
  const postes = new Postes(registre, diffusion, new Map([['tour', 'secret']]), journal);
  postes.requetes.surRequete = (quoi, args) => traiterRequeteRelais(appels, quoi, args);
  const envoi = { send: (t: string) => versPoste(t) };
  const poste = { data: { machine: 'tour' }, ...envoi } as unknown as ServerWebSocket<DonneesPoste>;
  postes.ouvert(poste);
  // Le lien du poste : ce qu'il envoie part au relais ; ce que le relais renvoie revient à l'attente du poste.
  const requetes = new RequetesRelais({
    envoyer: (m: MessagePoste) => postes.recu(poste, JSON.stringify(m)),
    estOuvert: () => true,
    delaiMs: 2000,
  });
  function versPoste(texte: string): void {
    const c = CommandeRelais.parse(JSON.parse(texte));
    if (c.kind === 'reponse_relais') requetes.recevoir(c);
  }
  return { requetes, appels, diffusion, recusParAppli };
}

describe('lien poste ↔ relais pour les outils de modules', () => {
  test('modules_lister : le relais rend les outils des modules sains, par le lien', async () => {
    const { requetes } = banc();
    const r = await requetes.requete('modules_lister', {});
    expect(r).toEqual({
      ok: true,
      donnees: [{ module: 'carte', nom: 'Carte', outils: MANIFESTE.outils, integrations: [] }],
    });
  });

  test('module_appeler : l’appli factice répond, le résultat revient au poste', async () => {
    const { requetes, recusParAppli } = banc();
    const args = { module: 'carte', outil: 'centrer', arguments: { lat: 1 }, session: 'sess-1' };
    const r = await requetes.requete('module_appeler', args);
    expect(r).toEqual({ ok: true, donnees: { resultat: { centre: 'ok', recu: { lat: 1 } } } });
    expect(recusParAppli).toContainEqual(
      expect.objectContaining({ type: 'module_appel', module: 'carte', outil: 'centrer', session: 'sess-1' }),
    );
  });

  test('module_appeler sans appli ouverte : l’erreur du relais revient au poste', async () => {
    const { requetes } = banc({ appli: false });
    const r = await requetes.requete('module_appeler', { module: 'carte', outil: 'centrer', session: 'sess-1' });
    expect(r).toEqual({ ok: false, erreur: AUCUNE_APPLI });
  });

  test('module_appeler aux arguments invalides : refus sans rien relayer', async () => {
    const { requetes, recusParAppli } = banc();
    const r = await requetes.requete('module_appeler', { module: 'carte' });
    expect(r).toEqual({ ok: false, erreur: 'arguments d’appel invalides' });
    expect(recusParAppli.filter((m) => m.type === 'module_appel')).toHaveLength(0);
  });

  test('pas de réponse de l’appli au délai du relais : erreur de délai rendue au poste', async () => {
    const registre = new Registre(ouvrirBase(':memory:'), journal);
    const diffusion = new Diffusion();
    diffusion.ajouter({ send: () => undefined } as unknown as ServerWebSocket<unknown>);
    const appels = new AppelsModules({ registre, diffusion, delaiMs: 5 });
    const args = { module: 'carte', outil: 'centrer', session: 's' };
    const r = await traiterRequeteRelais(appels, 'module_appeler', args);
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('n\'a pas répondu à temps') });
  });

  test('appel venu d’une session hors Lanterne (session null) : accepté, pas rejeté comme invalide', async () => {
    const registre = new Registre(ouvrirBase(':memory:'), journal);
    const diffusion = new Diffusion();
    diffusion.ajouter({ send: () => undefined } as unknown as ServerWebSocket<unknown>);
    const appels = new AppelsModules({ registre, diffusion, delaiMs: 5 });
    const args = { module: 'carte', outil: 'centrer', session: null };
    const r = await traiterRequeteRelais(appels, 'module_appeler', args);
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('n\'a pas répondu à temps') });
  });
});
