// Demandes d'appareil vues entre nœuds appariés : la photo part aux nœuds pairs (jamais à un appareil), la
// décision prise chez un pair est relayée au nœud qui tient la demande, et seule une demande d'appareil existante
// se tranche.
// Aiguilleur réel sur 127.0.0.1, nœuds et appareils réels ; mêmes helpers que les autres essais de la fédération.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { attendre, creerNoeud, monterAiguilleur, type Monte, type Noeud, relier } from './banc-federation.ts';
import { type Appareil, appairerAppareil, appareilAvecCode, nouveauNoeud, PROPRIETAIRE } from './banc-appareil.ts';
import { appairer } from './parite-banc.ts';

let monte: Monte;
let noeuds: Noeud[] = [];

beforeEach(() => {
  monte = monterAiguilleur();
  noeuds = [];
});

afterEach(() => {
  for (const n of noeuds) n.federation.arreter();
  monte.serveur.stop(true);
});

async function nouveauPortable(): Promise<Noeud> {
  const n = creerNoeud('portable');
  noeuds.push(n);
  await relier(n, monte, PROPRIETAIRE);
  await attendre(async () => (await n.federation.etat()).aiguilleur?.relie === true);
  return n;
}

/** La tour (sans écran) et le portable, appairés ; la tour est celle qui reçoit les demandes d'appareil. */
async function duo(): Promise<{ tour: Noeud; idTour: string; portable: Noeud }> {
  const { noeud: tour, id: idTour } = await nouveauNoeud(monte);
  noeuds.push(tour);
  const portable = await nouveauPortable();
  await appairer(portable, tour);
  return { tour, idTour, portable };
}

/** Un appareil demande à rejoindre la tour : la demande est pendante, Chris ne l'a pas encore tranchée. */
async function demandeAppareil(tour: Noeud, idTour: string): Promise<Appareil> {
  const appareil = await appareilAvecCode(monte);
  appareil.ouvrir('ap-2', idTour, 'appairage');
  await attendre(async () => (await tour.federation.etat()).demandes.some((d) => d.genre === 'appareil'));
  return appareil;
}

describe('photo des demandes d’appareil entre nœuds', () => {
  test('la demande d’appareil de la tour apparaît chez le portable, marquée de son nœud', async () => {
    const { tour, idTour, portable } = await duo();
    await demandeAppareil(tour, idTour);
    await attendre(async () => (await portable.federation.etat()).demandes.some((d) => d.noeud === idTour));
    const vue = (await portable.federation.etat()).demandes;
    const locale = (await tour.federation.etat()).demandes[0];
    expect(vue).toHaveLength(1);
    expect(vue[0]).toMatchObject({ genre: 'appareil', noeud: idTour, nom: 'iphone' });
    expect(vue[0]?.empreinte).toBe(locale?.empreinte);
    expect(vue[0]?.empreinteLocale).toBe((await tour.federation.etat()).empreinteLocale);
  });

  test('fermeture du lien : les demandes vues chez ce nœud disparaissent du portable', async () => {
    const { tour, idTour, portable } = await duo();
    await demandeAppareil(tour, idTour);
    await attendre(async () => (await portable.federation.etat()).demandes.some((d) => d.noeud === idTour));
    tour.federation.arreter();
    await attendre(async () => (await portable.federation.etat()).demandes.length === 0);
  });
});

describe('décision relayée à la tour', () => {
  test('acceptée chez le portable, la tour tranche : l’appareil est apparié, son lien s’ouvre', async () => {
    const { tour, idTour, portable } = await duo();
    const appareil = await demandeAppareil(tour, idTour);
    await attendre(async () => (await portable.federation.etat()).demandes.some((d) => d.noeud === idTour));
    const demandeVue = (await portable.federation.etat()).demandes.find((d) => d.noeud === idTour);
    expect(portable.federation.decider(demandeVue?.id ?? '', true).ok).toBe(true);
    await attendre(() => appareil.ouverts.includes('ap-2'));
    await attendre(async () => (await tour.federation.etat()).demandes.length === 0);
    await attendre(async () => (await portable.federation.etat()).demandes.length === 0);
  });

  test('une demande inconnue ou disparue ne se décide pas à distance (404)', async () => {
    const { tour, idTour, portable } = await duo();
    const introuvable = { ok: false, statut: 404, raison: 'demande introuvable' } as const;
    expect(portable.federation.decider('inconnue', true)).toEqual(introuvable);
    await demandeAppareil(tour, idTour);
    await attendre(async () => (await portable.federation.etat()).demandes.some((d) => d.noeud === idTour));
    const id = (await portable.federation.etat()).demandes.find((d) => d.noeud === idTour)?.id ?? '';
    tour.federation.arreter();
    await attendre(async () => (await portable.federation.etat()).demandes.length === 0);
    expect(portable.federation.decider(id, true)).toEqual(introuvable);
  });
});

describe('une décision n’est jamais reçue d’un appareil', () => {
  test('un appareil apparié qui envoie une décision est coupé ; l’autre demande reste pendante', async () => {
    const { noeud: tour, id: idTour } = await nouveauNoeud(monte);
    noeuds.push(tour);
    const premier = await appairerAppareil(monte, tour, idTour);
    const second = await demandeAppareil(tour, idTour);
    const idSecond = (await tour.federation.etat()).demandes.find((d) => d.genre === 'appareil')?.id ?? '';
    premier.canal.envoyer({ t: 'decision', id: idSecond, accord: true });
    await attendre(() => premier.appareil.fermes.includes('ap-1'));
    expect((await tour.federation.etat()).demandes.map((d) => d.id)).toEqual([idSecond]);
    expect(second.ouverts).not.toContain('ap-2');
  });
});
