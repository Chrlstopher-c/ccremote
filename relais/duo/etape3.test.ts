// Responsabilité : tests de l'étape 3 du mode duo, à deux relais en mémoire reliés par leur lien réel — passer la main,
// messages entre sessions des deux, modules en commun, fil d'activité, alerte de fichier touché des deux côtés.
/// <reference types="bun" />
import { afterEach, describe, expect, test } from 'bun:test';
import { DROITS_PAR_DEFAUT, type Droits } from '../../commun/duo.ts';
import type { ManifesteModule } from '../../commun/modules.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { requeteServeurModule } from '../modules/api-serveur.ts';
import { type Banc, attendre, deuxBancs, ficheOuverte, MAJ, poster } from './banc-duo.ts';

const bancs: Banc[] = [];
afterEach(() => {
  for (const b of bancs.splice(0)) b.duo.arreter();
});

async function duo(): Promise<{ a: Banc; b: Banc }> {
  const { a, b } = await deuxBancs({ delaiDemandeMs: 5_000 });
  bancs.push(a, b);
  return { a, b };
}

const droits = (surcharge: Partial<Droits>): Droits => ({ ...DROITS_PAR_DEFAUT, ...surcharge });
const ouvertures = (x: Banc): Record<string, unknown>[] => x.commandes.filter((c) => c['kind'] === 'ouvrir');

function requeteEnvoi(id: string, corps: unknown): Request & { params: { id: string } } {
  return Object.assign(
    new Request(`http://relais/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }),
    { params: { id } },
  );
}

const evenement = (sessionId: string, evt: object): object => ({ kind: 'evenement', sessionId, ts: MAJ, evt });
const outil = (fichier: string): object => ({
  type: 'outil',
  id: 't1',
  nom: 'Edit',
  resume: fichier,
  detail: JSON.stringify({ file_path: fichier }, null, 1),
});
// Projet nommé comme sur le poste (nom = dernier segment du chemin) : le même projet des deux côtés.
const sessionProjet = (id: string, chemin: string, mode?: ResumeSession['mode']): ResumeSession => ({
  ...ficheOuverte(id, chemin, mode),
  projet: { machine: 'tour', chemin, nom: 'proj' },
});

describe('passer la main', () => {
  test('demande, accord avec dossier → session neuve avec le paquet ; refus → rien ; fil du donneur', async () => {
    const { a, b } = await duo();
    poster(b, { kind: 'session', session: sessionProjet('p1', '/pb/proj', 'default') });
    poster(b, evenement('p1', { type: 'message', texte: 'premier' }));
    poster(b, evenement('p1', { type: 'message', texte: 'second' }));
    poster(b, evenement('p1', { type: 'texte', texte: 'bilan de Claude' }));
    poster(b, evenement('p1', { type: 'fichiers_tour', tour: 't1', fichiers: [fichierTouche('/pb/proj/a.ts')] }));

    const r = await b.duo.avances.passerLaMain('p1', 'à reprendre');
    expect(r).toMatchObject({ ok: true, valeur: { etat: 'en_attente' } });
    await attendre(() => a.duo.listerDemandes().length === 1);
    expect(a.duo.listerDemandes()[0]).toMatchObject({ genre: 'passer_la_main', de: 'bob', detail: 'Titre p1' });
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', true, { machine: 'tour', chemin: '/pa/neuf' });
    await attendre(() => b.recus.some((m) => m.type === 'duo_issue'));
    expect(b.recus).toContainEqual(expect.objectContaining({ type: 'duo_issue', accord: true }));
    const ouverte = ouvertures(a)[0]?.['demande'] as { message: string; projet: { chemin: string } } | undefined;
    expect(ouverte?.projet.chemin).toBe('/pa/neuf');
    expect(ouverte?.message).toContain('Session passée par bob : Titre p1');
    expect(ouverte?.message).toContain('- premier');
    expect(ouverte?.message).toContain('- second');
    expect(ouverte?.message).toContain('bilan de Claude');
    expect(ouverte?.message).toContain('/pb/proj/a.ts');
    expect(ouverte?.message).toContain('**Note de bob**\n\nà reprendre');
    const fil = b.registre.derniersEvenements('p1', 50).map((e) => e.evt);
    expect(fil).toContainEqual({ type: 'duo_main', vers: 'alice' });
    expect(a.duo.journalDuo()[0]).toMatchObject({ qui: 'bob', action: 'passer_la_main' });

    const avant = ouvertures(a).length;
    const refus = await b.duo.avances.passerLaMain('p1', undefined);
    expect(refus).toMatchObject({ ok: true, valeur: { etat: 'en_attente' } });
    await attendre(() => a.duo.listerDemandes().length === 1);
    a.duo.decider(a.duo.listerDemandes()[0]?.id ?? '', false);
    await attendre(() => b.recus.filter((m) => m.type === 'duo_issue').length === 2);
    expect(b.recus).toContainEqual(
      expect.objectContaining({ type: 'duo_issue', accord: false, raison: 'refusé par alice' }),
    );
    expect(ouvertures(a)).toHaveLength(avant);
    const passages = b.registre.derniersEvenements('p1', 50).filter((e) => e.evt.type === 'duo_main');
    expect(passages).toHaveLength(1);
  });
});

function fichierTouche(chemin: string): object {
  return { chemin, etat: 'modifie', ajouts: 1, suppressions: 0, binaire: false };
}

describe('messages entre sessions des deux', () => {
  test('message relayé vers une session du pair en écriture, avec la trace ; refusé en lecture', async () => {
    const { a, b } = await duo();
    poster(b, { kind: 'session', session: ficheOuverte('p1', '/pb/proj', 'default') });
    poster(b, { kind: 'session', session: ficheOuverte('p2', '/pb/autre', 'default') });
    b.duo.partager({ cible: 'p1', genre: 'session', niveau: 'ecriture' });
    b.duo.partager({ cible: 'p2', genre: 'session', niveau: 'lecture' });
    await attendre(() => a.registre.session('p1')?.duo?.niveau === 'ecriture' && a.registre.session('p2') !== null);
    poster(a, { kind: 'session', session: ficheOuverte('s1', '/pa/proj') });

    const corps = { texte: 'salut', relayeDe: { session: 's1', titre: 'Titre s1' } };
    const reponse = await a.sessions.envoyer(requeteEnvoi('p1', corps));
    expect(reponse.status).toBe(200);
    await attendre(() => b.commandes.some((c) => c['kind'] === 'tracer_relais'));
    const envoi = { kind: 'envoyer', sessionId: 'p1', texte: 'salut', auteur: 'alice' };
    expect(b.commandes).toContainEqual(expect.objectContaining(envoi));
    expect(b.commandes).toContainEqual(
      expect.objectContaining({
        kind: 'tracer_relais',
        sessionId: 'p1',
        sens: 'entrant',
        autre: { session: 's1', titre: 'Titre s1', compte: 'alice' },
        texte: 'salut',
      }),
    );

    const lecture = await a.sessions.envoyer(requeteEnvoi('p2', { texte: 'non' }));
    expect(lecture.status).toBe(409);
    expect(((await lecture.json()) as { erreur: string }).erreur).toContain('lecture seule');
  });
});

const MANIFESTE: ManifesteModule = {
  id: 'carte',
  nom: 'Carte',
  version: '1.0.0',
  description: 'Test',
  icone: 'map',
  point: 'index.js',
  emplacements: ['panneau'],
  serveur: { point: 'serveur/index.ts' },
};
const base64 = (texte: string): string => Buffer.from(texte).toString('base64');

function publierModule(r: Banc, texte: string, empreinte: string): void {
  const fichiers = [{ chemin: 'index.js', base64: base64(texte) }];
  poster(r, { kind: 'module', id: 'carte', manifeste: MANIFESTE, fichiers, empreinte });
}

describe('modules en commun', () => {
  test('proposé, accepté → servi chez le pair ; mise à jour repoussée ; serveur relayé ; retiré', async () => {
    const { a, b } = await duo();
    publierModule(a, 'v1', 'a'.repeat(64));
    a.duo.majDroits(droits({ modulesPartages: ['carte'] }));
    await attendre(() => b.duo.avances.listerModules().some((m) => m.id === 'carte'));
    expect(b.duo.avances.listerModules()[0]).toMatchObject({ id: 'carte', accepte: false, erreur: null });
    expect(b.registre.modules.obtenir('carte')).toBeNull();

    b.duo.avances.accorderModule('carte', true);
    await attendre(() => b.registre.modules.obtenir('carte') !== null);
    expect(b.registre.modules.obtenir('carte')?.machine).toBe('duo:alice');
    expect(b.registre.modules.fichier('carte', 'index.js')?.base64).toBe(base64('v1'));

    publierModule(a, 'v2', 'b'.repeat(64));
    await attendre(() => b.registre.modules.obtenir('carte')?.empreinte === 'b'.repeat(64));
    expect(b.registre.modules.fichier('carte', 'index.js')?.base64).toBe(base64('v2'));

    const reponseServeur = { status: 200, headers: {}, body: 'pong', encodage: 'texte' };
    a.postes.commander = async () => ({ ok: true, donnees: reponseServeur });
    const relayee = await b.duo.avances.serveurDuPair('carte', { chemin: '/ping' });
    expect(relayee).toMatchObject({ ok: true, valeur: { status: 200, body: 'pong' } });
    const corps = JSON.stringify({ chemin: '/ping' });
    const requete = new Request('http://relais/x', { method: 'POST', body: corps });
    const r = await requeteServeurModule(b.registre, b.postes, 'carte', requete, (id, d) =>
      b.duo.avances.serveurDuPair(id, d),
    );
    expect(((await r.json()) as { body: string }).body).toBe('pong');

    a.duo.majDroits(droits({ modulesPartages: [] }));
    await attendre(() => b.registre.modules.obtenir('carte') === null);
    expect(b.duo.avances.listerModules()).toEqual([]);
  });

  test('module local de même identifiant : le reçu n’écrase pas le local, le conflit est signalé', async () => {
    const { a, b } = await duo();
    publierModule(b, 'local', 'c'.repeat(64));
    publierModule(a, 'v1', 'a'.repeat(64));
    a.duo.majDroits(droits({ modulesPartages: ['carte'] }));
    await attendre(() => b.duo.avances.listerModules().length === 1);
    b.duo.avances.accorderModule('carte', true);
    await attendre(() => b.duo.avances.listerModules()[0]?.erreur !== null);
    expect(b.registre.modules.obtenir('carte')?.machine).toBe('tour');
    expect(b.registre.modules.fichier('carte', 'index.js')?.base64).toBe(base64('local'));
  });
});

describe('fil d’activité', () => {
  test('sessions partagées des deux côtés, avec qui et à quel niveau', async () => {
    const { a, b } = await duo();
    poster(a, { kind: 'session', session: ficheOuverte('s1', '/pa/proj') });
    a.duo.partager({ cible: 's1', genre: 'session', niveau: 'lecture' });
    poster(b, { kind: 'session', session: ficheOuverte('p1', '/pb/proj') });
    poster(b, { kind: 'session', session: ficheOuverte('p9', '/pb/prive') });
    b.duo.partager({ cible: 'p1', genre: 'session', niveau: 'ecriture' });
    await attendre(() => a.registre.session('p1') !== null && b.registre.session('s1') !== null);

    const chezAlice = a.duo.avances.activite();
    expect(chezAlice.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 's1', qui: 'alice', partagee: 'lecture' }),
        expect.objectContaining({ id: 'p1', qui: 'bob', partagee: 'ecriture' }),
      ]),
    );
    expect(chezAlice.sessions.map((s) => s.id)).not.toContain('p9');
    expect(b.duo.avances.activite().sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 's1', qui: 'alice', partagee: 'lecture' })]),
    );
    expect(chezAlice.demandes).toEqual([]);
  });
});

describe('projets communs : fichier touché des deux côtés', () => {
  test('signalé une seule fois dans la fenêtre de 30 min', async () => {
    const { a, b } = await duo();
    poster(a, { kind: 'session', session: sessionProjet('s1', '/pa/proj') });
    a.duo.partager({ cible: 'tour:/pa/proj', genre: 'projet', niveau: 'ecriture' });
    poster(b, { kind: 'session', session: sessionProjet('p1', '/pb/proj') });
    b.duo.partager({ cible: 'p1', genre: 'session', niveau: 'ecriture' });
    await attendre(() => a.registre.session('p1') !== null);

    poster(a, evenement('s1', outil('/pa/proj/src/a.ts')));
    poster(b, evenement('p1', outil('/pb/proj/src/a.ts')));
    await attendre(() => a.recus.some((m) => m.type === 'duo_conflit'));
    poster(b, evenement('p1', outil('/pb/proj/src/a.ts')));
    await attendre(() => a.registre.derniersEvenements('p1', 10).length === 2);
    poster(a, evenement('s1', outil('/pa/proj/src/a.ts')));

    expect(a.recus.filter((m) => m.type === 'duo_conflit')).toEqual([
      { type: 'duo_conflit', projet: 'proj', fichier: 'src/a.ts', qui: 'bob', session: 's1', sessionPair: 'p1' },
    ]);
    expect(a.duo.avances.conflitsDuo()).toHaveLength(1);
  });
});
