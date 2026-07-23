import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { construireFeed, type SourceDemandes } from './vue-feed.ts';
import type { DemandePermission } from '../bus-permissions/index.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'corriger le login' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'auth', projet: 'alpha', compteId: 'compte1' });
});

afterEach(() => registre.fermer());

function demandes(liste: readonly DemandePermission[]): SourceDemandes {
  return { parWorker: () => liste };
}

const BASE: Omit<DemandePermission, 'requestId' | 'etat' | 'verdict'> = {
  idWorker: 'm-1',
  outil: 'Bash',
  recueA: 1_700_000_000_000,
  enAttenteDepuisA: null,
  repondueA: null,
  confirmeeA: null,
};

describe('vue-feed — le fil d’une mission', () => {
  test('☠ les transitions d’état alimentent le fil (avant : « 0 évènements » sur une équipe qui travaillait)', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    const feed = construireFeed(registre, 'm-1');
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.some((e) => e.type === 'system' && e.text.includes('en_cours'))).toBe(true);
  });

  test('l’horodatage respecte le format HH:MM:SS du contrat', () => {
    registre.etats.appliquerEtatHarness('m-1', 'en_cours');
    for (const e of construireFeed(registre, 'm-1')) expect(e.ts).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('☠ une permission résolue SEULE par le lead figure au fil (H-64, trace d’audit)', () => {
    const feed = construireFeed(
      registre,
      'm-1',
      demandes([{ ...BASE, requestId: 'r1', etat: 'resolue_auto', verdict: { behavior: 'allow' } }]),
    );
    const permission = feed.find((e) => e.type === 'permission');
    expect(permission?.auto).toBe(true);
    expect(permission?.resolved).toBe('autorisée');
  });

  test('une permission en attente est marquée pending, un refus est rendu comme tel', () => {
    const feed = construireFeed(registre, 'm-1', demandes([
      { ...BASE, requestId: 'r2', etat: 'en_attente', verdict: null, enAttenteDepuisA: BASE.recueA },
      { ...BASE, requestId: 'r3', etat: 'repondue', verdict: { behavior: 'deny', message: 'hors scope' } },
    ]));
    const permissions = feed.filter((e) => e.type === 'permission');
    expect(permissions.find((p) => p.pending === true)).toBeDefined();
    expect(permissions.find((p) => p.resolved === 'refusée')).toBeDefined();
  });

  test('le chemin bloqué est rendu quand il existe, jamais inventé quand il manque', () => {
    const avec = construireFeed(registre, 'm-1', demandes([
      { ...BASE, requestId: 'r4', etat: 'en_attente', verdict: null, blockedPath: '/etc/passwd' },
    ]));
    expect(avec.find((e) => e.type === 'permission')?.path).toBe('/etc/passwd');
    const sans = construireFeed(registre, 'm-1', demandes([
      { ...BASE, requestId: 'r5', etat: 'en_attente', verdict: null },
    ]));
    expect(sans.find((e) => e.type === 'permission')?.path).toBeUndefined();
  });
});
