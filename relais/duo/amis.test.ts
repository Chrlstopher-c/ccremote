// Responsabilité : tests de la liste d'amis du mode duo — le principal est le duo d'avant, ajout et réutilisation d'un
// emplacement, suspension persistante, retrait avec effacement, routage de l'aiguilleur partagé, `?ami=` et demandes.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { MessageVersAiguilleur } from '../../commun/aiguilleur.ts';
import type { PortAiguilleurDuo } from '../../commun/duo-aiguilleur.ts';
import { Diffusion } from '../clients/diffusion.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { Postes } from '../parc/postes.ts';
import { routesAmis } from './api-amis.ts';
import { type Requete, routesDuo } from './api-duo.ts';
import { AmisDuo } from './amis.ts';
import { type Paire, PaireStockee } from './paire-stockee.ts';
import type { Resultat } from './resultat.ts';

const journal = pino({ enabled: false });
const MAJ = Date.parse('2026-11-22T10:00:00.000Z');
const sansSessions = (): Promise<Response> =>
  Promise.resolve(Response.json({ erreur: 'sans sessions' }, { status: 409 }));
const pontSimule = { ouvrir: sansSessions, envoyer: sansSessions, interrompre: sansSessions, tracer: sansSessions };

const dossiers: string[] = [];
const ouverts: AmisDuo[] = [];

afterEach(() => {
  for (const amis of ouverts.splice(0)) amis.arreter();
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

function nouveauDossier(): string {
  const dossier = mkdtempSync(join(tmpdir(), 'duo-amis-'));
  dossiers.push(dossier);
  return dossier;
}

function creer(dossier: string): AmisDuo {
  const base = ouvrirBase(':memory:');
  const registre = new Registre(base, journal);
  const diffusion = new Diffusion();
  const postes = new Postes(registre, diffusion, new Map<string, string>(), journal);
  const amis = new AmisDuo({
    registre,
    diffusion,
    base,
    utilisateur: 'tour',
    dossierSecrets: dossier,
    ecoute: '127.0.0.1',
    port: 0,
    journal,
    maintenant: () => MAJ,
    delaiReconnexionMs: 20,
    postes,
    sessions: pontSimule,
  });
  ouverts.push(amis);
  return amis;
}

function paire(utilisateur: string, membre?: string): Paire {
  const base: Paire = {
    id: `id-${utilisateur}`,
    cle: 'cle-de-test',
    utilisateur,
    adresse: null,
    creeLe: new Date(MAJ).toISOString(),
  };
  return membre === undefined ? base : { ...base, transport: 'aiguilleur', membre };
}

function valeur<T>(r: Resultat<T>): T {
  if (!r.ok) throw new Error(r.raison);
  return r.valeur;
}

function requete(chemin: string, corps?: unknown, params: Record<string, string> = {}): Requete {
  const init: RequestInit =
    corps === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' } };
  return Object.assign(new Request(`http://relais.test${chemin}`, init), { params });
}

// Port de l'aiguilleur sans lien réel : les envois sont notés, l'identité locale n'est pas nécessaire ici.
function portFaux(envoyes: MessageVersAiguilleur[]): PortAiguilleurDuo {
  return {
    membreLocal: () => 'noeud-tour',
    identiteLocale: () => Promise.reject(new Error('identité absente en test')),
    envoyer: (m) => {
      envoyes.push(m);
      return true;
    },
    enLigne: () => false,
    relie: () => true,
  };
}

// Un ami ajouté, appairé à un membre de l'aiguilleur ; le principal est apparié en direct (le duo d'avant).
function avecAmiAppaire(dossier: string, envoyes: MessageVersAiguilleur[]): { amis: AmisDuo; id: string } {
  new PaireStockee(dossier, journal).ecrire(paire('alpha'));
  const amis = creer(dossier);
  amis.brancherAiguilleur(portFaux(envoyes));
  const id = valeur(amis.ajouter());
  new PaireStockee(join(dossier, 'duo', 'amis', id), journal).ecrire(paire('beta', 'membre-a'));
  return { amis, id };
}

describe('liste d’amis du mode duo', () => {
  test('le principal est le duo d’avant : sa paire relue telle quelle, sans migration', () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    amis.brancherAiguilleur(portFaux([]));
    expect(amis.lister()).toEqual([
      { id: 'principal', nom: 'alpha', utilisateur: 'alpha', etat: 'hors_ligne', suspendu: false,
        transport: 'direct', appairage: false },
    ]);
    expect(amis.principal.etat().pair?.utilisateur).toBe('alpha');
  });

  test('ajouter crée un emplacement neuf, aux droits par défaut, dans son dossier', () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    const id = valeur(amis.ajouter());
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(amis.lister()).toHaveLength(2);
    expect(amis.instance(id)?.droitsAccordes()).toMatchObject({
      ecrireSansPermissions: 'demander',
      dossiersOuverts: [],
    });
    expect(existsSync(join(dossier, 'duo', 'amis', id, 'duo.sqlite'))).toBe(true);
  });

  test('ajouter réutilise un emplacement sans paire plutôt que d’en créer un autre', () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    const premier = valeur(amis.ajouter());
    expect(valeur(amis.ajouter())).toBe(premier);
    expect(amis.lister()).toHaveLength(2);
  });

  test('suspendre arrête l’emplacement : plus d’ouverture acceptée, et l’état persiste', () => {
    const dossier = nouveauDossier();
    const envoyes: MessageVersAiguilleur[] = [];
    const { amis, id } = avecAmiAppaire(dossier, envoyes);
    const handler = amis.brancherAiguilleur(portFaux(envoyes));
    handler.surMessage({ t: 'ouvrir', canal: 'duo-aaaa', de: 'membre-a' });
    expect(envoyes).toContainEqual({ t: 'accepter', canal: 'duo-aaaa' });

    expect(amis.suspendre(id, true)).toMatchObject({ ok: true });
    handler.surMessage({ t: 'ouvrir', canal: 'duo-bbbb', de: 'membre-a' });
    expect(envoyes).toContainEqual({ t: 'refuser', canal: 'duo-bbbb' });

    const relu = creer(dossier).lister().find((a) => a.id === id);
    expect(relu).toMatchObject({ suspendu: true, utilisateur: 'beta' });
  });

  test('retirer révoque la paire et efface le dossier et l’entrée de l’ami ajouté', () => {
    const dossier = nouveauDossier();
    const envoyes: MessageVersAiguilleur[] = [];
    const { amis, id } = avecAmiAppaire(dossier, envoyes);
    expect(amis.retirer(id)).toMatchObject({ ok: true });
    expect(existsSync(join(dossier, 'duo', 'amis', id))).toBe(false);
    expect(amis.instance(id)).toBeNull();
    expect(creer(dossier).lister().map((a) => a.id)).toEqual(['principal']);
  });

  test('une ouverture entrante va au lien de son pair ; une ouverture inconnue sans code est refusée', () => {
    const dossier = nouveauDossier();
    const envoyes: MessageVersAiguilleur[] = [];
    const { amis } = avecAmiAppaire(dossier, envoyes);
    const handler = amis.brancherAiguilleur(portFaux(envoyes));
    handler.surMessage({ t: 'ouvrir', canal: 'duo-aaaa', de: 'membre-a' });
    handler.surMessage({ t: 'ouvrir', canal: 'duo-cccc', de: 'inconnu' });
    expect(envoyes).toContainEqual({ t: 'accepter', canal: 'duo-aaaa' });
    expect(envoyes).toContainEqual({ t: 'refuser', canal: 'duo-cccc' });
  });

  test('un ami ajouté ne rouvre pas de lien direct', async () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    const id = valeur(amis.ajouter());
    const r = await amis.instance(id)?.rejoindre('127.0.0.1:9', 'ABCDEFGH');
    expect(r).toMatchObject({ ok: false, statut: 409, raison: 'lien direct réservé au premier ami' });
  });

  test('?ami inconnu : 404 ; sans ?ami : le principal ; demandes : tous les amis, ou celui du ?ami', async () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    const id = valeur(amis.ajouter());
    const table = routesDuo(amis, (g) => g);
    expect((await table['/api/duo'].GET(requete('/api/duo?ami=ffffffffffff'))).status).toBe(404);
    expect((await table['/api/duo'].GET(requete('/api/duo'))).status).toBe(200);
    expect((await table['/api/duo'].GET(requete(`/api/duo?ami=${id}`))).status).toBe(200);

    const tous = await table['/api/duo/demandes'].GET(requete('/api/duo/demandes'));
    expect(await tous.json()).toEqual([]);
    const d = await table['/api/duo/demandes'].GET(requete('/api/duo/demandes?ami=ffffffffffff'));
    expect(d.status).toBe(404);
    const decision = requete('/api/duo/demandes/x?ami=ffffffffffff', { accord: true }, { id: 'x' });
    expect((await table['/api/duo/demandes/:id'].POST(decision)).status).toBe(404);
  });

  test('les routes de la liste : ajouter, suspendre, retirer répondent avec la liste à jour', async () => {
    const dossier = nouveauDossier();
    new PaireStockee(dossier, journal).ecrire(paire('alpha'));
    const amis = creer(dossier);
    const routes = routesAmis(amis, (g) => g);
    const ajoute = await routes['/api/duo/amis'].POST(requete('/api/duo/amis', {}));
    expect(ajoute.status).toBe(200);
    const id = amis.lister()[1]?.id ?? '';
    const suspendu = await routes['/api/duo/amis/:ami/suspendre'].POST(
      requete(`/api/duo/amis/${id}/suspendre`, { suspendu: true }, { ami: id }),
    );
    expect(await suspendu.json()).toMatchObject({ amis: [{ id: 'principal' }, { id, suspendu: true }] });
    const retire = await routes['/api/duo/amis/:ami/retirer'].POST(
      requete(`/api/duo/amis/${id}/retirer`, undefined, { ami: id }),
    );
    expect(await retire.json()).toMatchObject({ amis: [{ id: 'principal' }] });
  });
});
