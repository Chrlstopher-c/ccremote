// Responsabilité : tests du contrat des paquets de synchronisation (forme, bornes, périmètre) et de la fusion
// locale — ce qui part, ce qui s'applique, ce qui est ignoré et compté. Données de test seulement.
import { beforeEach, describe, expect, test } from 'bun:test';
import pino from 'pino';
import {
  lireMessageSynchro,
  NOMBRE_MAX_IDENTIFIANTS_PAQUET,
  paquetConforme,
  type PaquetSynchro,
  TAILLE_MAX_PAQUET_OCTETS,
} from '../../commun/synchro.ts';
import { ouvrirBase } from '../registre/base.ts';
import { Registre } from '../registre/registre.ts';
import { ficheDe, MAJ } from '../federation/banc-federation.ts';
import { appliquerPaquet, construirePaquet } from './paquet.ts';

const silencieux = pino({ enabled: false });
let registre: Registre;

beforeEach(() => {
  registre = new Registre(ouvrirBase(':memory:'), silencieux);
});

function session(id: string, epinglee = false): void {
  registre.enregistrerSession(ficheDe(id, 'tour', `titre ${id}`));
  if (epinglee) registre.definirEpinglee(id, true);
}

const DEMANDE = {
  t: 'demande',
  id: 'd1',
  genre: 'synchro',
  quoi: ['favoris'],
  de: 'aaaaaaaaaaaa',
  vers: 'bbbbbbbbbbbb',
  le: MAJ,
};

describe('lecture des messages synchro', () => {
  test('une demande bien formée est acceptée', () => {
    expect(lireMessageSynchro(DEMANDE).ok).toBe(true);
  });

  test('un champ inconnu ou un type hors protocole est refusé', () => {
    expect(lireMessageSynchro({ ...DEMANDE, extra: 1 }).ok).toBe(false);
    expect(lireMessageSynchro({ t: 'inconnu', id: 'x' }).ok).toBe(false);
    expect(lireMessageSynchro({ ...DEMANDE, quoi: ['favoris', 'favoris'] }).ok).toBe(false);
    expect(lireMessageSynchro({ ...DEMANDE, quoi: ['affichage'] }).ok).toBe(false);
  });

  test('un paquet au-delà de la taille maximale est refusé', () => {
    const grand = 'x'.repeat(TAILLE_MAX_PAQUET_OCTETS);
    const r = lireMessageSynchro({ t: 'paquet', id: 'd1', favoris: [grand] });
    expect(r).toEqual({ ok: false, raison: 'paquet trop grand' });
  });

  test('un paquet qui dépasse le nombre d identifiants est refusé', () => {
    const ids = Array.from({ length: NOMBRE_MAX_IDENTIFIANTS_PAQUET + 1 }, (_, i) => `s${i}`);
    expect(lireMessageSynchro({ t: 'paquet', id: 'd1', favoris: ids }).ok).toBe(false);
  });
});

describe('périmètre', () => {
  const favoris: PaquetSynchro = { t: 'paquet', id: 'd1', favoris: ['s1'] };

  test('un paquet porte exactement le périmètre demandé', () => {
    expect(paquetConforme(favoris, ['favoris'])).toBe(true);
    expect(paquetConforme(favoris, ['favoris', 'categories'])).toBe(false);
    expect(paquetConforme({ ...favoris, masquees: [] }, ['favoris'])).toBe(false);
  });

  test('le paquet construit ne contient que le périmètre accordé', () => {
    session('s1', true);
    registre.enregistrerCategories([{ id: 'c1', nom: 'Projets', replie: false, sessions: ['s1'] }]);
    const paquet = construirePaquet(registre, 'd1', ['favoris']);
    expect(Object.keys(paquet).sort()).toEqual(['favoris', 'id', 't']);
    expect(paquet.favoris).toEqual(['s1']);
  });
});

describe('fusion locale', () => {
  test('favoris : appliqués aux sessions connues, les inconnues sont comptées, rien n est effacé', () => {
    session('s1');
    session('s2', true);
    session('s9', true);
    const bilan = appliquerPaquet(registre, { t: 'paquet', id: 'd1', favoris: ['s1', 's2', 's3'] });
    expect(bilan.bilan).toEqual({ appliques: 1, dejaPresents: 1, ignores: 1 });
    expect(registre.session('s1')?.epinglee).toBe(true);
    expect(registre.session('s9')?.epinglee).toBe(true);
  });

  test('catégories : une absente est créée, une présente garde son nom ; une session déjà rangée reste', () => {
    session('s1');
    session('s2');
    session('s4');
    registre.enregistrerCategories([
      { id: 'c1', nom: 'Local', replie: true, sessions: ['s2'] },
    ]);
    const bilan = appliquerPaquet(registre, {
      t: 'paquet',
      id: 'd1',
      categories: [
        { id: 'c1', nom: 'Distant', replie: false, sessions: ['s1', 's2', 's7'] },
        { id: 'c2', nom: 'Nouvelle', replie: false, sessions: ['s4'] },
      ],
    });
    const categories = registre.categories();
    expect(categories.find((c) => c.id === 'c1')).toEqual({
      id: 'c1',
      nom: 'Local',
      replie: true,
      sessions: ['s2', 's1'],
    });
    expect(categories.find((c) => c.id === 'c2')?.sessions).toEqual(['s4']);
    expect(bilan.bilan.ignores).toBe(1);
    expect(bilan.bilan.dejaPresents).toBe(1);
  });

  test('groupes masqués : une catégorie absente localement ou une machine inconnue est ignorée', () => {
    session('s1');
    registre.enregistrerCategories([{ id: 'c1', nom: 'Projets', replie: false, sessions: [] }]);
    const groupe = (cle: string, genre: 'categorie' | 'machine', machine: string | null) => ({
      cle,
      libelle: cle,
      genre,
      machine,
      dossier: null,
      masqueLe: MAJ,
    });
    const bilan = appliquerPaquet(registre, {
      t: 'paquet',
      id: 'd1',
      masquees: [
        groupe('categorie:c1', 'categorie', null),
        groupe('categorie:cx', 'categorie', null),
        groupe('environnement:machine-inconnue', 'machine', 'machine-inconnue'),
      ],
    });
    expect(registre.groupesMasques().map((g) => g.cle)).toEqual(['categorie:c1']);
    expect(bilan.bilan).toEqual({ appliques: 1, dejaPresents: 0, ignores: 2 });
  });
});
