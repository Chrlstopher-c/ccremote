import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import { ApiSessions } from '../clients/api-sessions.ts';
import { Diffusion } from '../clients/diffusion.ts';
import type { ReponsePoste } from '../parc/postes.ts';
import { ouvrirBase } from './base.ts';
import { Registre } from './registre.ts';

const MAJ = '2026-11-18T10:00:00.000Z';
const journal = pino({ enabled: false });

function session(id: string): ResumeSession {
  return {
    id,
    machine: 'tour',
    projet: { machine: 'tour', chemin: '/p', nom: 'p' },
    cwd: '/p',
    titre: id,
    objectif: null,
    modele: 'opus',
    compte: 'defaut',
    autonomie: false,
    statut: 'attente',
    contexte: { tokens: 0, max: 1_000_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: null,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function api(reponse: ReponsePoste, appels: string[]): ApiSessions {
  const r = new Registre(ouvrirBase(':memory:'));
  r.enregistrerSession(session('vivante'));
  const postes = {
    commander: (machine: string, c: { kind: string }) => {
      appels.push(`${machine}:${c.kind}`);
      return Promise.resolve(reponse);
    },
    decouvertes: () => [],
  };
  return new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
}

function requete(id: string, tache = ''): Request & { params: { id: string; tache: string } } {
  const chemin = tache ? `/api/sessions/${id}/taches/${tache}` : `/api/sessions/${id}/contexte`;
  return Object.assign(new Request(`http://relais.test${chemin}`), { params: { id, tache } });
}

describe('lectures du panneau de session', () => {
  test('le contexte relayé tel quel, null compris (session sans requête ouverte)', async () => {
    const appels: string[] = [];
    const rep = await api({ ok: true, donnees: null }, appels).contexte(requete('vivante'));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toBeNull();
    expect(appels).toEqual(['tour:contexte']);
  });

  test('une tâche absente du poste donne 404, une tâche présente est relayée', async () => {
    const absente = await api({ ok: true, donnees: null }, []).tache(requete('vivante', 'x'));
    expect(absente.status).toBe(404);
    const presente = await api({ ok: true, donnees: { id: 'x' } }, []).tache(requete('vivante', 'x'));
    expect(await presente.json()).toEqual({ id: 'x' });
  });

  test('un poste qui refuse : les connecteurs de la fiche ; une session inconnue 404', async () => {
    const hors = await api({ ok: false, erreur: 'hors ligne' }, []).connecteurs(requete('vivante'));
    expect(hors.status).toBe(200);
    expect(await hors.json()).toEqual([]);
    expect((await api({ ok: true }, []).taches(requete('ailleurs'))).status).toBe(404);
    expect((await api({ ok: true }, []).connecteurs(requete('ailleurs'))).status).toBe(404);
  });

  test('poste refusé : la fiche garde le dernier relevé reçu du poste', async () => {
    const r = new Registre(ouvrirBase(':memory:'));
    r.enregistrerSession({ ...session('vivante'), connecteurs: [{ nom: 'agenda', statut: 'connected' }] });
    const postes = {
      commander: () => Promise.resolve({ ok: false as const, erreur: 'hors ligne' }),
      decouvertes: () => [],
    };
    const api = new ApiSessions(r, postes, new Diffusion(), new Set(), journal);
    expect(await (await api.connecteurs(requete('vivante'))).json()).toEqual([{ nom: 'agenda', statut: 'connected' }]);
  });
});
