/**
 * La FRONTIÈRE HTTP du multi-machines, éprouvée sur un vrai serveur.
 *
 * `☠` Pourquoi ce fichier existe séparément des tests de routage : le 01/08, un
 * champ correctement collecté, correctement persisté et correctement typé
 * n'arrivait quand même PAS dans la réponse HTTP — douzième occurrence du motif
 * « écrit, testé, branché sur rien ». Le typecheck ne garde pas une route, et un
 * test qui appelle la fonction interne ne prouve pas qu'un navigateur la voit.
 *
 * Ce que ces tests couvrent, et rien d'autre : ce que le navigateur reçoit
 * réellement quand il demande la liste des machines et qu'il crée un fil.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { demarrerServeurApiWeb, type ServeurApiWeb } from '../../control-plane/api-web/index.ts';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import type { MachineApi } from '../../control-plane/api-web/serveur-api.ts';
import { ErreurProjetAbsentDeLaMachine } from '../../control-plane/orchestrateur/dispatch-mandat.ts';
import { ErreurRoutageMachine } from '../../shared/routage-machine.ts';

let registre: Registre;
let api: ServeurApiWeb | null = null;
let machines: MachineApi[];
let creees: { titre?: string; machine?: string | null }[];
let refusApprobation: Error | null;

function demarrer(avecConversations = true): ServeurApiWeb {
  api = demarrerServeurApiWeb({
    port: 0,
    registre,
    pcEnLigne: () => machines.some((m) => m.enLigne),
    machines: () => machines,
    mandats: {
      enAttente: () => [],
      refuser: () => true,
      approuver: async () => {
        if (refusApprobation !== null) throw refusApprobation;
        return { missionId: 'm-1', detail: 'équipe démarrée' };
      },
    },
    ...(avecConversations
      ? {
          conversations: {
            listerConversations: () => [],
            creer: (titre?: string, machine?: string | null) => {
              creees.push({ titre, machine });
              return { id: 'conv-neuve', titre: titre ?? 'Nouveau fil', creeA: 0, majA: 0 };
            },
            renommer: () => true,
            archiver: () => true,
            detail: () => null,
            evenementsDepuis: () => null,
          } as never,
        }
      : {}),
  });
  return api;
}

async function lire(chemin: string): Promise<{ statut: number; corps: Record<string, unknown> }> {
  const rep = await fetch(`http://127.0.0.1:${api?.port}/api/harness${chemin}`);
  return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
}

async function ecrire(chemin: string, corps: unknown): Promise<{ statut: number; corps: Record<string, unknown> }> {
  const rep = await fetch(`http://127.0.0.1:${api?.port}/api/harness${chemin}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  return { statut: rep.status, corps: (await rep.json()) as Record<string, unknown> };
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  creees = [];
  refusApprobation = null;
  machines = [
    { id: 'trinityarch', enLigne: true, supersedes: 0 },
    { id: 'vps-e411b5c7', enLigne: false, supersedes: 0 },
  ];
});

afterEach(() => {
  api?.arreter();
  api = null;
  registre.fermer();
});

describe('GET /machines — ce que le sélecteur reçoit vraiment', () => {
  test('☠ la liste ARRIVE dans la réponse HTTP, machines hors ligne comprises', async () => {
    demarrer();
    const { statut, corps } = await lire('/machines');
    expect(statut).toBe(200);
    // Une machine éteinte reste LISTÉE : la masquer laisserait croire qu'elle
    // n'existe pas, et l'opérateur ne comprendrait pas pourquoi son fil d'hier
    // vise une machine dont l'interface n'a jamais parlé (H-75).
    expect(corps['data']).toEqual([
      { id: 'trinityarch', enLigne: true, supersedes: 0 },
      { id: 'vps-e411b5c7', enLigne: false, supersedes: 0 },
    ]);
  });

  test('la route existe même sans orchestrateur assemblé', async () => {
    // `☠` Le piège déjà payé deux fois (mandats, puis rappels) : le sous-routeur
    // des conversations court-circuite tout dès que `conversations` est absent.
    // Les machines vivent dans le LIEN, pas dans une session — les y enterrer
    // rendrait le sélecteur vide sur un déploiement sans orchestrateur.
    demarrer(false);
    const { statut, corps } = await lire('/machines');
    expect(statut).toBe(200);
    expect((corps['data'] as unknown[]).length).toBe(2);
  });

  test('aucune machine connue ⇒ liste vide, jamais une machine fabriquée', async () => {
    machines = [];
    demarrer();
    const { corps } = await lire('/machines');
    expect(corps['data']).toEqual([]);
    expect(corps['pcOnline']).toBe(false);
  });
});

describe('POST /orchestrator/conversations — la machine choisie', () => {
  test('la machine traverse jusqu’au gestionnaire', async () => {
    demarrer();
    const { statut } = await ecrire('/orchestrator/conversations', { machine: 'trinityarch' });
    expect(statut).toBe(200);
    expect(creees).toEqual([{ titre: undefined, machine: 'trinityarch' }]);
  });

  test('☠ une machine INCONNUE est refusée à la création, pas au premier mandat', async () => {
    // La valeur vient du navigateur, finit en clé de routage et en colonne SQL.
    // L'accepter produirait un fil irroutable dont l'échec n'apparaîtrait qu'au
    // premier mandat — bien trop tard pour être rattaché à sa cause.
    demarrer();
    const { statut, corps } = await ecrire('/orchestrator/conversations', { machine: 'machine-inventee' });
    expect(statut).toBe(400);
    // Le message porte la liste : l'appelant se corrige dessus.
    expect(String(corps['error'] ?? '')).toContain('trinityarch');
    expect(creees).toEqual([]);
  });

  test('machine absente ⇒ `null`, le routage tranchera sans ambiguïté', async () => {
    demarrer();
    await ecrire('/orchestrator/conversations', {});
    expect(creees).toEqual([{ titre: undefined, machine: null }]);
  });
});


describe('POST /orchestrator/propositions/:id/approve — les refus de routage', () => {
  test('☠ projet absent de la machine ⇒ 409 PORTANT le message, jamais 500 « erreur interne »', async () => {
    // `☠ MESURÉ EN PRODUCTION LE 01/08.` Le refus fonctionnait parfaitement —
    // levé avant la première écriture, message actionnable, projet libéré — et
    // il sortait en `500 erreur interne du control plane`. Donc : on envoyait
    // chercher une panne du harness là où il n'y avait qu'un mandat mal adressé,
    // pendant que le message écrit pour être lu restait dans le journal du Pi.
    // Troisième fois que cette famille de refus se perd sur la même frontière
    // (après H-56 le 23/07 et le mandat déjà tranché le 01/08).
    refusApprobation = new ErreurProjetAbsentDeLaMachine('/mnt/projects/lumen', 'vps-e411b5c7', '/mnt/projects/lumen');
    demarrer();
    const { statut, corps } = await ecrire('/orchestrator/propositions/p-1/approve', {});
    expect(statut).toBe(409);
    expect(String(corps['error'])).toContain('lumen');
    expect(String(corps['error'])).toContain('vps-e411b5c7');
  });

  test('☠ machine hors ligne ⇒ 409 nommant les machines, jamais 500', async () => {
    refusApprobation = new ErreurRoutageMachine('mandat p-1 : la machine « vps » est hors ligne. En ligne actuellement : trinityarch');
    demarrer();
    const { statut, corps } = await ecrire('/orchestrator/propositions/p-1/approve', {});
    expect(statut).toBe(409);
    expect(String(corps['error'])).toContain('hors ligne');
  });

  test('une VRAIE panne reste un 500 — la distinction est le tout de ce test', async () => {
    refusApprobation = new Error('base de données corrompue');
    demarrer();
    const { statut } = await ecrire('/orchestrator/propositions/p-1/approve', {});
    expect(statut).toBe(500);
  });
});
