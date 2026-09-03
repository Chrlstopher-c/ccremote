import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Proposition, type Registre } from '../registre/index.ts';
import { traiterFinActivationTeam, type DependancesFinActivation } from './fin-activation-team.ts';
import type { ResultatDispatch } from './dispatch-mandat.ts';

let registre: Registre;

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
  registre.lots.creer({ id: 'lot-1', intention: 'activation' });
});

afterEach(() => registre.fermer());

/** Sème une team ACTIVE et sa mission (l'activation), et rend leurs ids. */
function semerActivation(opts: { conversationId?: string | null } = {}): { teamId: string; missionId: string } {
  registre.teams.creer({ id: 'team-1', projet: 'vela', domaine: 'frontend' }, 100);
  registre.teams.activer('team-1', { worktree: '/wt/team-1', branche: 'equipe/team-1' }, 100);
  const mission = registre.missions.creer({
    id: 'm-1',
    lotId: 'lot-1',
    nom: 'activation',
    projet: 'vela',
    compteId: 'compte-a',
    teamId: 'team-1',
    conversationId: opts.conversationId ?? null,
  });
  registre.etats.appliquerEtatHarness(mission.id, 'en_cours');
  return { teamId: 'team-1', missionId: mission.id };
}

/** Une proposition dépilable (mandat déjà rédigé), reliée à une feature en file. */
function semerFeatureEnFile(): { featureId: string; propositionId: string } {
  const p = registre.propositions.creer({
    id: 'prop-file',
    conversationId: null,
    projet: 'vela',
    objectif: 'brancher le bouton',
    critereArret: 'critère `bun test` vert',
    perimetre: 'src/**',
    budgetMaxUsd: 5,
    domaine: 'frontend',
  });
  const feature = registre.featureQueue.enfiler({
    id: 'feat-1',
    projet: 'vela',
    domaine: 'frontend',
    objectif: p.objectif,
    propositionId: p.id,
  });
  return { featureId: feature.id, propositionId: p.id };
}

function deps(over: Partial<DependancesFinActivation> = {}): DependancesFinActivation {
  return {
    registre,
    conserverWorktreeTeam: async () => {},
    fenetreAutonomieActive: () => false,
    redispatcher: async () => ({ missionId: 'm-redispatch', detail: 'ok' }),
    ...over,
  };
}

describe('traiterFinActivationTeam — fin d’activation d’une team vivante (axe B, B-b)', () => {
  test('☠ team vivante → ENDORMIE et worktree CONSERVÉ (arreter conserverWorktree)', async () => {
    const { missionId, teamId } = semerActivation();
    const conserves: string[] = [];
    const issue = await traiterFinActivationTeam(
      deps({ conserverWorktreeTeam: async (m) => { conserves.push(m); } }),
      missionId,
      2000,
    );
    // La team survit à son activation : active → dormante.
    expect(registre.teams.lire(teamId)?.etat).toBe('dormante');
    // Le worktree a été conservé en veille, pour CETTE mission.
    expect(conserves).toEqual([missionId]);
    // File vide → simplement endormie.
    expect(issue.type).toBe('endormie');
  });

  test('mission hors team ⇒ hors_team, aucune action', async () => {
    const mission = registre.missions.creer({
      id: 'm-solo',
      lotId: 'lot-1',
      nom: 'solo',
      projet: 'vela',
      compteId: 'compte-a',
    });
    let conserveAppele = false;
    const issue = await traiterFinActivationTeam(
      deps({ conserverWorktreeTeam: async () => { conserveAppele = true; } }),
      mission.id,
    );
    expect(issue.type).toBe('hors_team');
    expect(conserveAppele).toBe(false);
  });
});

describe('traiterFinActivationTeam — dépilage de la file (B2, D4)', () => {
  test('☠ SOUS fenêtre d’autonomie → la 1re feature est DÉPILÉE et re-dispatchée', async () => {
    const { missionId } = semerActivation({ conversationId: 'conv-a' });
    const { featureId, propositionId } = semerFeatureEnFile();
    let redispatchee: Proposition | null = null;

    const issue = await traiterFinActivationTeam(
      deps({
        fenetreAutonomieActive: () => true,
        redispatcher: async (p): Promise<ResultatDispatch> => {
          redispatchee = p;
          return { missionId: 'm-2', detail: 'redispatch parti' };
        },
      }),
      missionId,
      3000,
    );

    expect(issue.type).toBe('depilee');
    // Le re-dispatch a bien reçu LA proposition dépilée (même chemin H-61).
    expect(redispatchee!.id).toBe(propositionId);
    // La feature a avancé : en_cours, plus en attente.
    expect(registre.featureQueue.lire(featureId)?.etat).toBe('en_cours');
    expect(registre.featureQueue.premiereEnAttente('vela', 'frontend')).toBeNull();
  });

  test('☠ HORS fenêtre d’autonomie → la feature ATTEND un clic, aucun re-dispatch', async () => {
    const { missionId } = semerActivation({ conversationId: 'conv-a' });
    const { featureId } = semerFeatureEnFile();
    let redispatchAppele = false;

    const issue = await traiterFinActivationTeam(
      deps({
        fenetreAutonomieActive: () => false,
        redispatcher: async () => {
          redispatchAppele = true;
          return { missionId: 'x', detail: '' };
        },
      }),
      missionId,
    );

    expect(issue.type).toBe('file_attente');
    expect(redispatchAppele).toBe(false);
    // La feature est toujours en attente, dépilable au prochain clic.
    expect(registre.featureQueue.lire(featureId)?.etat).toBe('en_attente');
    expect(registre.featureQueue.premiereEnAttente('vela', 'frontend')?.id).toBe(featureId);
  });

  test('re-dispatch en échec → la feature est REMISE en file, jamais perdue', async () => {
    const { missionId } = semerActivation({ conversationId: 'conv-a' });
    const { featureId } = semerFeatureEnFile();

    const issue = await traiterFinActivationTeam(
      deps({
        fenetreAutonomieActive: () => true,
        redispatcher: async () => {
          throw new Error('PC injoignable');
        },
      }),
      missionId,
    );

    expect(issue.type).toBe('file_attente');
    // Remise à disposition : ni assignée fantôme, ni perdue.
    expect(registre.featureQueue.lire(featureId)?.etat).toBe('en_attente');
  });
});
