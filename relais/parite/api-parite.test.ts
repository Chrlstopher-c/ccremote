// Responsabilité : tests de la parité côté relais — session inconnue ou poste muet → parité vide (200), détail 404,
// refus de résultat relayé avec son statut, délai borné. Postes et registre simulés : aucune machine contactée.
import { describe, expect, test } from 'bun:test';
import type { Logger } from 'pino';
import { PARITE_VIDE } from '../../commun/parite.ts';
import type { ResumeSession } from '../../commun/session.ts';
import type { Postes, ReponsePoste } from '../parc/postes.ts';
import type { Registre } from '../registre/registre.ts';
import { ApiParite } from './api-parite.ts';
import { routesParite } from './routes.ts';

const JOURNAL = { warn: () => undefined, error: () => undefined, info: () => undefined } as unknown as Logger;
type Requete = Request & { params: Record<string, string> };
type Commande = Parameters<Postes['commander']>[1];

const SESSION = {
  id: 's1',
  machine: 'tour',
  cwd: '/mnt/projects/x',
  claudeSessionId: 'conv-1',
} as unknown as ResumeSession;

function registreAvec(...sessions: ResumeSession[]): Pick<Registre, 'session'> {
  return { session: (id: string) => sessions.find((s) => s.id === id) ?? null };
}

function postesAvec(reponse: (c: Commande) => ReponsePoste | Promise<ReponsePoste>): Pick<Postes, 'commander'> {
  return { commander: async (_machine: string, c: Commande) => reponse(c) } as unknown as Pick<Postes, 'commander'>;
}

function requete(url: string, params: Record<string, string>): Requete {
  return Object.assign(new Request(`http://relais.test${url}`), { params });
}

describe("parité d'une session", () => {
  test('session inconnue du registre : parité vide, 200', async () => {
    const api = new ApiParite({ registre: registreAvec(), postes: postesAvec(() => ({ ok: true })), journal: JOURNAL });
    const r = await api.parite(requete('/api/sessions/x/parite', { id: 'x' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(PARITE_VIDE);
  });

  test('poste hors ligne ou muet : parité vide, 200', async () => {
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec(() => ({ ok: false, erreur: 'tour est hors ligne' })),
      journal: JOURNAL,
    });
    const r = await api.parite(requete('/api/sessions/s1/parite', { id: 's1' }));
    expect(await r.json()).toEqual(PARITE_VIDE);
  });

  test('délai dépassé : parité vide, 200', async () => {
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec(() => new Promise<ReponsePoste>(() => undefined)),
      journal: JOURNAL,
      delaiMs: 5,
    });
    const r = await api.parite(requete('/api/sessions/s1/parite', { id: 's1' }));
    expect(await r.json()).toEqual(PARITE_VIDE);
  });

  test('réponse du poste valide : relayée ; commande envoyée avec la cible de la fiche', async () => {
    const envoyees: Commande[] = [];
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec((c) => {
        envoyees.push(c);
        return { ok: true, donnees: { ...PARITE_VIDE, transcript: true } };
      }),
      journal: JOURNAL,
    });
    const r = await api.parite(requete('/api/sessions/s1/parite', { id: 's1' }));
    expect(await r.json()).toEqual({ ...PARITE_VIDE, transcript: true });
    expect(envoyees[0]).toMatchObject({
      kind: 'parite',
      sessionId: 's1',
      claudeSessionId: 'conv-1',
      cwd: '/mnt/projects/x',
    });
  });

  test('réponse du poste illisible : parité vide, 200', async () => {
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec(() => ({ ok: true, donnees: { n: 'importe quoi' } })),
      journal: JOURNAL,
    });
    const r = await api.parite(requete('/api/sessions/s1/parite', { id: 's1' }));
    expect(await r.json()).toEqual(PARITE_VIDE);
  });
});

describe('détail et résultats', () => {
  test('tâche inconnue sur le poste : 404 ; session inconnue : 404', async () => {
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec(() => ({ ok: true, donnees: { tache: null } })),
      journal: JOURNAL,
    });
    const absente = await api.tache(requete('/api/sessions/s1/parite/taches/t', { id: 's1', tache: 't' }));
    expect(absente.status).toBe(404);
    const sansSession = await api.tache(requete('/api/sessions/x/parite/taches/t', { id: 'x', tache: 't' }));
    expect(sansSession.status).toBe(404);
  });

  test('fil d’un sous-agent : relayé ; tâche inconnue du poste : 404 ; identifiant vide : 400', async () => {
    const fil = {
      agent: 'a1',
      description: 'Relecture',
      modele: 'haiku',
      termine: true,
      evenements: [{ ts: '2026-11-20T10:00:00.000Z', evt: { type: 'message', texte: 'consigne' } }],
    };
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec((c) =>
        c.kind === 'parite_fil_tache' && c.tache === 'connue'
          ? { ok: true, donnees: { fil } }
          : { ok: true, donnees: { fil: null } },
      ),
      journal: JOURNAL,
    });
    const ok = await api.filTache(requete('/api/sessions/s1/parite/taches/connue/fil', { id: 's1', tache: 'connue' }));
    expect(await ok.json()).toEqual(fil);
    const absente = await api.filTache(requete('/api/sessions/s1/parite/taches/x/fil', { id: 's1', tache: 'x' }));
    expect(absente.status).toBe(404);
    const vide = await api.filTache(requete('/api/sessions/s1/parite/taches//fil', { id: 's1', tache: '' }));
    expect(vide.status).toBe(400);
  });

  test('résultat : contenu relayé ; refus 413 relayé avec son statut ; chemin absent : 400', async () => {
    const api = new ApiParite({
      registre: registreAvec(SESSION),
      postes: postesAvec((c) =>
        c.kind === 'parite_resultat' && c.chemin === '/gros.png'
          ? { ok: true, donnees: { etat: 'refus', statut: 413, raison: 'trop volumineux' } }
          : { ok: true, donnees: { etat: 'ok', mime: 'image/png', base64: 'AQID' } },
      ),
      journal: JOURNAL,
    });
    const ok = await api.resultat(requete('/api/sessions/s1/parite/resultat?chemin=/petit.png', { id: 's1' }));
    expect(await ok.json()).toEqual({ mime: 'image/png', base64: 'AQID' });
    const gros = await api.resultat(requete('/api/sessions/s1/parite/resultat?chemin=/gros.png', { id: 's1' }));
    expect(gros.status).toBe(413);
    const sans = await api.resultat(requete('/api/sessions/s1/parite/resultat', { id: 's1' }));
    expect(sans.status).toBe(400);
  });

  test('les routes sont protégées par le garde fourni et couvrent les trois chemins', () => {
    const api = new ApiParite({ registre: registreAvec(), postes: postesAvec(() => ({ ok: true })), journal: JOURNAL });
    const table = routesParite(api, (g) => g);
    expect(Object.keys(table).sort()).toEqual([
      '/api/sessions/:id/parite',
      '/api/sessions/:id/parite/resultat',
      '/api/sessions/:id/parite/taches/:tache',
      '/api/sessions/:id/parite/taches/:tache/fil',
    ]);
  });
});
