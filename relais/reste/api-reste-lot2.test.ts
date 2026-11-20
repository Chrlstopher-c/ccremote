// Responsabilité : tests des routes du lot 2 de la vague « reste » côté relais — compactions, PR, dictée (choix du
// premier poste en ligne qui l'a), tâches planifiées (identifiants, corps, relais vers le poste). Postes et registre
// simulés : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import type { CorpsTache } from '../../commun/reste-lot2.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { ApiDictee } from './api-dictee.ts';
import { ApiResteSessions } from './api-reste-sessions.ts';
import { ApiTaches } from './api-taches.ts';

const JOURNAL = { warn: () => undefined, error: () => undefined, info: () => undefined } as unknown as Logger;
const MAJ = '2026-11-20T10:00:00.000Z';
type Commande = Parameters<Postes['commander']>[1];
type Requete = Request & { params: Record<string, string> };
type Reponder = (machine: string, commande: Commande) => ReponsePoste;

interface Faux {
  readonly postes: Pick<Postes, 'vues' | 'commander'>;
  readonly appels: { machine: string; commande: Commande }[];
}

function postesFaux(machines: readonly { id: string; enLigne: boolean }[], reponder: Reponder): Faux {
  const appels: { machine: string; commande: Commande }[] = [];
  const postes = {
    vues: () => machines.map((m) => ({ id: m.id, enLigne: m.enLigne })),
    commander: async (machine: string, commande: Commande) => {
      appels.push({ machine, commande });
      return reponder(machine, commande);
    },
  } as unknown as Pick<Postes, 'vues' | 'commander'>;
  return { postes, appels };
}

function registreFaux(...sessions: { id: string; machine: string }[]): Pick<Registre, 'session'> {
  return {
    session: (id: string) => {
      const s = sessions.find((x) => x.id === id);
      return s ? ({ id: s.id, machine: s.machine } as unknown as ResumeSession) : null;
    },
  };
}

function requete(url: string, params: Record<string, string>, corps?: unknown, methode = 'GET'): Requete {
  const init: RequestInit = { method: methode };
  if (corps !== undefined) init.body = JSON.stringify(corps);
  return Object.assign(new Request(`http://relais.test${url}`, init), { params });
}

describe('compactions et fusion (session)', () => {
  test('session inconnue : aucun résumé, sans appel au poste', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { resumes: [] } }));
    const api = new ApiResteSessions({ registre: registreFaux(), postes: f.postes, journal: JOURNAL });
    const r = await api.compactions(requete('/api/sessions/x/compactions', { id: 'x' }));
    expect(await r.json()).toEqual({ resumes: [] });
    expect(f.appels.length).toBe(0);
  });

  test('résumés relayés depuis le poste de la session', async () => {
    const lus = { resumes: [{ ts: MAJ, texte: 'Résumé' }] };
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: lus }));
    const api = new ApiResteSessions({
      registre: registreFaux({ id: 's1', machine: 'tour' }),
      postes: f.postes,
      journal: JOURNAL,
    });
    const r = await api.compactions(requete('/api/sessions/s1/compactions', { id: 's1' }));
    expect(await r.json()).toEqual(lus);
    expect(f.appels[0]).toEqual({ machine: 'tour', commande: { kind: 'compactions', sessionId: 's1' } });
  });

  test('poste hors ligne : état absent avec la raison, jamais une erreur brute', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: false }], () => ({ ok: false, erreur: 'tour est hors ligne' }));
    const api = new ApiResteSessions({
      registre: registreFaux({ id: 's1', machine: 'tour' }),
      postes: f.postes,
      journal: JOURNAL,
    });
    const r = await api.etatFusion(requete('/api/sessions/s1/pr', { id: 's1' }));
    expect(await r.json()).toEqual({ etat: 'absente', raison: 'tour est hors ligne' });
  });

  test('création de PR : corps validé puis relayé avec la session', async () => {
    const pr = { numero: 3, titre: 'T', url: 'https://exemple.invalide/pr/3', etat: 'OPEN' };
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { etat: 'ok', pr } }));
    const api = new ApiResteSessions({
      registre: registreFaux({ id: 's1', machine: 'tour' }),
      postes: f.postes,
      journal: JOURNAL,
    });
    const mauvais = await api.creerFusion(requete('/api/sessions/s1/pr', { id: 's1' }, { titre: '' }, 'POST'));
    expect(mauvais.status).toBe(400);
    const bon = { titre: 'T', corps: 'C', brouillon: true };
    const r = await api.creerFusion(requete('/api/sessions/s1/pr', { id: 's1' }, bon, 'POST'));
    expect(await r.json()).toEqual({ etat: 'ok', pr });
    expect(f.appels[0]?.commande).toEqual({ kind: 'pr_creer', sessionId: 's1', ...bon });
  });
});

describe('dictée (parc)', () => {
  test('aucun poste en ligne : avis clair', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: false }], () => ({ ok: true }));
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL }).etat();
    expect(await r.json()).toEqual({
      disponible: false,
      machine: null,
      raison: "Aucune machine du parc n'est en ligne.",
    });
  });

  test('le premier poste dans l’ordre du parc qui a le service est choisi', async () => {
    const f = postesFaux(
      [
        { id: 'tour', enLigne: true },
        { id: 'portable', enLigne: true },
      ],
      (machine) => ({
        ok: true,
        donnees: { disponible: machine === 'portable', raison: machine === 'portable' ? null : 'absent' },
      }),
    );
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL }).etat();
    expect(await r.json()).toEqual({ disponible: true, machine: 'portable', raison: null });
  });

  test('transcription : audio transmis tel quel, langue par défaut, machine ajoutée', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], (_m, c) =>
      c.kind === 'dictee_etat'
        ? { ok: true, donnees: { disponible: true, raison: null } }
        : { ok: true, donnees: { etat: 'ok', texte: 'bonjour', ms: 12 } },
    );
    const api = new ApiDictee({ postes: f.postes, journal: JOURNAL });
    const r = await api.transcrire(requete('/api/dictee', {}, { pcm16: 'AAAA' }, 'POST'));
    expect(await r.json()).toEqual({ etat: 'ok', texte: 'bonjour', ms: 12, machine: 'tour' });
    expect(f.appels.at(-1)?.commande).toEqual({ kind: 'dictee_transcrire', pcm16: 'AAAA', langue: 'fr' });
  });

  test('aucun service : absente, sans transcription', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({
      ok: true,
      donnees: { disponible: false, raison: 'x' },
    }));
    const r = await new ApiDictee({ postes: f.postes, journal: JOURNAL }).transcrire(
      requete('/api/dictee', {}, { pcm16: 'AAAA' }, 'POST'),
    );
    expect(await r.json()).toEqual({
      etat: 'absente',
      raison: "Aucune machine du parc n'a le service de dictée en marche.",
    });
    expect(f.appels.some((a) => a.commande.kind === 'dictee_transcrire')).toBe(false);
  });
});

describe('tâches planifiées (machine)', () => {
  const corps: CorpsTache = {
    nom: 'Bilan',
    dossier: '/projets/app',
    prompt: 'Fais le bilan',
    frequence: { type: 'quotidienne', heure: '09:00' },
  };
  const tache = { id: 't1', ...corps, modele: null, active: false, derniere: null, prochaine: null };

  test('machine inconnue : 404', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true }));
    const r = await new ApiTaches({ postes: f.postes, journal: JOURNAL }).lister(requete('/x', { id: 'ailleurs' }));
    expect(r.status).toBe(404);
  });

  test('liste relayée et validée', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { taches: [tache] } }));
    const r = await new ApiTaches({ postes: f.postes, journal: JOURNAL }).lister(requete('/x', { id: 'tour' }));
    expect(await r.json()).toEqual({ taches: [tache] });
  });

  test('création : identifiant d’URL vérifié, corps relayé avec la tâche', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], () => ({ ok: true, donnees: { tache } }));
    const api = new ApiTaches({ postes: f.postes, journal: JOURNAL });
    const mauvais = await api.enregistrer(requete('/x', { id: 'tour', tid: 'a b' }, corps, 'PUT'));
    expect(mauvais.status).toBe(400);
    const r = await api.enregistrer(requete('/x', { id: 'tour', tid: 't1' }, corps, 'PUT'));
    expect(await r.json()).toEqual({ tache });
    expect(f.appels[0]?.commande).toEqual({ kind: 'tache_enregistrer', tache: 't1', corps });
  });

  test('suppression et exécution relayées ; refus du poste rendu en 409', async () => {
    const f = postesFaux([{ id: 'tour', enLigne: true }], (_m, c) =>
      c.kind === 'tache_executer' ? { ok: false, erreur: 'tâche inconnue' } : { ok: true, donnees: { id: 't1' } },
    );
    const api = new ApiTaches({ postes: f.postes, journal: JOURNAL });
    const sup = await api.supprimer(requete('/x', { id: 'tour', tid: 't1' }, undefined, 'DELETE'));
    expect(await sup.json()).toEqual({ id: 't1' });
    const exe = await api.executer(requete('/x', { id: 'tour', tid: 't1' }, undefined, 'POST'));
    expect(exe.status).toBe(409);
    expect(await exe.json()).toEqual({ erreur: 'tâche inconnue' });
  });
});
