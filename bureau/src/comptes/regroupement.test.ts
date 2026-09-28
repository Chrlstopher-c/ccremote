import { describe, expect, test } from 'bun:test';
import type { VueMachine } from '../../../commun/api-clients.ts';
import type { EtatCompte } from '../../../commun/comptes.ts';
import { connexionsEnCours, nomPropose, regrouper } from './regroupement.ts';

const compte = (e: Partial<EtatCompte>): EtatCompte => ({
  id: 'principal',
  defaut: true,
  connecte: true,
  email: 'a@x.fr',
  organisation: null,
  abonnement: 'max',
  session: null,
  semaine: null,
  autres: [],
  probleme: null,
  releveLe: '2026-09-28T10:00:00Z',
  connexion: null,
  ...e,
});

const machine = (id: string, etatComptes: EtatCompte[]): VueMachine => ({
  id,
  description: '',
  racines: [],
  projets: [],
  comptes: etatComptes.map((e) => e.id),
  etatComptes,
  version: '2',
  etat: null,
  derniereVue: '',
  enLigne: true,
});

const fenetre = (pourcent: number) => ({ libelle: 'Session (5 h)', pourcent, reinitialiseLe: null });

describe('regroupement des comptes', () => {
  test('même email sur deux machines : un compte, deux installations, relevé lisible le plus récent', () => {
    const r = regrouper([
      machine('tour', [compte({ probleme: 'jeton expiré', releveLe: '2026-09-28T12:00:00Z' })]),
      machine('portable', [compte({ session: fenetre(25), releveLe: '2026-09-28T11:00:00Z' })]),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.installations.map((i) => i.machine)).toEqual(['portable', 'tour']);
    expect(r[0]?.usage?.session?.pourcent).toBe(25);
  });

  test('compte déconnecté sans email : clé par machine ; connexion en cours listée à part', () => {
    const connexion = { url: 'https://claude.com/x', depuis: '2026-09-28T12:00:00Z' };
    const ms = [machine('vps', [compte({ id: 'compte-b', email: null, connecte: false }),
      compte({ id: 'neuf', email: null, connecte: false, connexion })])];
    expect(regrouper(ms).map((c) => c.cle)).toEqual(['vps/compte-b']);
    const attendu = { machine: 'vps', nom: 'neuf', url: connexion.url, depuis: connexion.depuis };
    expect(connexionsEnCours(ms)).toEqual([attendu]);
  });

  test('nom proposé : tiré de l’email, suffixé s’il est pris', () => {
    const m = machine('vps', [compte({ id: 'chris' })]);
    expect(nomPropose(m, 'Chris.C@x.fr')).toBe('chris-c');
    expect(nomPropose(m, 'chris@x.fr')).toBe('chris-2');
    expect(nomPropose(undefined, null)).toBe('compte');
  });
});
