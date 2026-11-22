// Responsabilité : compte par défaut des sessions ouvertes sans compte (charte du réseau) — le corps prime, sinon le
// compte de la machine, et rien hors de la machine locale. Poste simulé : la demande reçue est lue telle quelle.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Diffusion } from './diffusion.ts';
import { ApiSessions } from './api-sessions.ts';

const journal = pino({ enabled: false });

function ouvrir(compteDefaut: (machine: string) => string | null, corps: Record<string, unknown>) {
  const demandes: Record<string, unknown>[] = [];
  const reponse: ReponsePoste = { ok: true, donnees: {} };
  const postes = {
    commander: (_machine: string, commande: Record<string, unknown>) => {
      demandes.push((commande['demande'] ?? {}) as Record<string, unknown>);
      return Promise.resolve(reponse);
    },
    attendreAuteur: () => undefined,
  } as unknown as Postes;
  const registre = new Registre(ouvrirBase(':memory:'));
  const api = new ApiSessions(registre, postes, new Diffusion(), new Set(), journal, null, compteDefaut);
  const base = { projet: { machine: 'tour', chemin: '/p', nom: 'p' }, message: 'bonjour', ...corps };
  const requete = new Request('http://r/api', { method: 'POST', body: JSON.stringify(base) });
  return api.ouvrir(requete).then(() => demandes[0]);
}

describe('compte par défaut', () => {
  test('sans compte dans le corps : le compte de la machine (charte) est pris', async () => {
    const demande = await ouvrir((m) => (m === 'tour' ? 'pro' : null), { machine: 'tour' });
    expect(demande?.['compte']).toBe('pro');
  });

  test('un compte explicite dans le corps prime sur celui de la charte', async () => {
    const demande = await ouvrir(() => 'pro', { machine: 'tour', compte: 'perso' });
    expect(demande?.['compte']).toBe('perso');
  });

  test('aucun compte choisi : la session part sans compte, comme avant', async () => {
    const demande = await ouvrir(() => null, { machine: 'tour' });
    expect(demande && 'compte' in demande).toBe(false);
  });
});
