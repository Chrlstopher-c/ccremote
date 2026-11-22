// Demandes et commandes de session en fédéré : un dialogue de permission affiché chez le pair et répondu par sa route
// de session ; une confirmation d'outil du nœud affichée chez le pair, sa réponse revenant au nœud ; remote control et
// rembobinage relayés au nœud qui tient la session. Deux nœuds réels sur un aiguilleur réel.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MessageClient } from '../../commun/api-clients.ts';
import { Confirmations } from '../machines/confirmations.ts';
import { attendre, ficheDe } from './banc-federation.ts';
import { arreterBanc, demarrerBanc, ecouter, nouveau, requete, SESSION_A, sessionVue } from './parite-banc.ts';

beforeEach(() => demarrerBanc());
afterEach(() => arreterBanc());

const PERMISSION = {
  id: 'perm-1',
  titre: 'Autoriser Bash ?',
  options: [
    { libelle: 'Autoriser', description: '' },
    { libelle: 'Refuser', description: '' },
  ],
  multiple: false,
  saisie: null,
  coches: [],
  permission: { outil: 'Bash', entree: 'rm -rf ./build', suggestion: false },
};

describe('dialogue de session (permission) en fédéré', () => {
  test('affiché chez le pair, la réponse est relayée par la route de session du nœud qui la tient', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const fiche = { ...ficheDe(SESSION_A, 'tour', 'Titre A'), dialogue: PERMISSION };
    a.registre.enregistrerSession(fiche);
    a.diffusion.diffuser({ type: 'session', session: fiche });
    await attendre(() => b.federation.distantes.sessions().some((s) => s.session.dialogue?.id === 'perm-1'));
    const reponse = await b.federation.distantes.intercepter(
      requete(`/api/sessions/${SESSION_A}/repondre`, 'POST', '{"id":"perm-1","index":0}'),
    );
    expect(reponse?.status).toBe(200);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: 'repondre', corps: '{"id":"perm-1","index":0}' });
  });
});

describe('confirmation d’un outil du nœud en fédéré', () => {
  test('affichée chez le pair, la réponse revient à son nœud ; la confirmation ne repart jamais vers lui', async () => {
    const emission: { emettre: (m: MessageClient) => void } = { emettre: () => undefined };
    const conf = new Confirmations((m) => emission.emettre(m));
    const a = await nouveau('tour', (g) => {
      if (!g.geste.startsWith('confirmations/')) return undefined;
      const id = g.geste.split('/')[1] ?? '';
      const accord = (JSON.parse(g.corps ?? '{}') as { accord?: boolean }).accord === true;
      const r = conf.repondre(id, accord);
      return Response.json(r.ok ? { ok: true } : { erreur: r.erreur }, { status: r.ok ? 200 : 404 });
    });
    emission.emettre = (m) => a.diffusion.diffuser(m);
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const recusB = ecouter(b);
    const demandee = conf.demander({ action: 'Bash', cible: 'tour', resume: 'rm -rf ./build' });
    const pendantes = (): string[] =>
      recusB.flatMap((m) => (m.type === 'confirmation' && m.confirmation.id === demandee.id ? [m.confirmation.statut] : []));
    await attendre(() => pendantes().includes('en_attente'));
    const reponse = await b.federation.distantes.intercepter(
      requete(`/api/confirmations/${demandee.id}/reponse`, 'POST', '{"accord":true}'),
    );
    expect(reponse?.status).toBe(200);
    expect(conf.lire(demandee.id)?.statut).toBe('accordee');
    await attendre(() => pendantes().includes('accordee'));
    expect(pendantes()).toEqual(['en_attente', 'accordee']);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: `confirmations/${demandee.id}/reponse` });
  });
});

describe('remote control et rembobinage en fédéré', () => {
  test('remote control : activé depuis le portable, relayé au nœud qui tient la session', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const r = await b.federation.distantes.intercepter(
      requete(`/api/sessions/${SESSION_A}/remote-control`, 'POST', '{"actif":true}'),
    );
    expect(r?.status).toBe(200);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: 'remote-control', corps: '{"actif":true}' });
  });

  test('rembobiner (annuler un tour) : relayé au nœud qui tient la session', async () => {
    const a = await nouveau('tour');
    const b = await nouveau('portable');
    await sessionVue(a, b);
    const r = await b.federation.distantes.intercepter(
      requete(`/api/sessions/${SESSION_A}/rembobiner`, 'POST', '{"messageId":"m-3"}'),
    );
    expect(r?.status).toBe(200);
    expect(a.appels.gestes.at(-1)).toMatchObject({ geste: 'rembobiner', corps: '{"messageId":"m-3"}' });
  });
});
