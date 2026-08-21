/**
 * Tests de la réconciliation (E.1.4, A.4.2, D.2.4, mission M-30).
 * Chaque `☠ CASSE` de la mission a son test : panne #3 (reinitialize absent du
 * rattachement) et panne #11 (orphelin ignoré) — les deux pannes attribuées à M-30 par
 * `Upgrade/15-grille-revue.md`.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { reconcilier } from './reconciliation.ts';
import type {
  DependancesReconciliation,
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from './types.ts';

// -------------------------------------------------------------- doublures locales

class InventairePcFactice implements InventairePc {
  #workers: DescripteurWorkerPc[] = [];
  readonly tues: string[] = [];
  echecKill = false;

  definir(workers: readonly DescripteurWorkerPc[]): void {
    this.#workers = [...workers];
  }

  inventaire(): readonly DescripteurWorkerPc[] {
    return this.#workers;
  }

  tuerSansPreavis(sessionId: string): void {
    if (this.echecKill) throw new Error('échec de mise à mort simulé');
    this.tues.push(sessionId);
    this.#workers = this.#workers.filter((w) => w.sessionId !== sessionId);
  }
}

class ReinitialisateurFactice implements ReinitialisateurSession {
  readonly appels: string[] = [];
  echoue = false;
  reponse: ResultatReinitialisation = { demandesEnAttente: [] };

  async reinitialiser(sessionId: string): Promise<ResultatReinitialisation> {
    this.appels.push(sessionId);
    if (this.echoue) throw new Error('reinitialize() a échoué');
    return this.reponse;
  }
}

class BusPermissionsFactice {
  readonly redelivrees: string[] = [];
  redelivrer(entree: { readonly requestId: string }): void {
    this.redelivrees.push(entree.requestId);
  }
}

class CompteurRelancesFactice {
  readonly reinitialises: string[] = [];
  reinitialiser(sessionId: string): void {
    this.reinitialises.push(sessionId);
  }
}

class JournalFactice {
  readonly faits: { type: string; details: Record<string, unknown> }[] = [];
  enregistrer(type: string, details: Record<string, unknown> = {}): void {
    this.faits.push({ type, details });
  }
  contient(type: string): boolean {
    return this.faits.some((f) => f.type === type);
  }
}

// -------------------------------------------------------------------- montage

let registre: Registre;
let inventairePc: InventairePcFactice;
let reinitialisateur: ReinitialisateurFactice;
let bus: BusPermissionsFactice;
let compteurRelances: CompteurRelancesFactice;
let journal: JournalFactice;

function deps(overrides: Partial<DependancesReconciliation> = {}): DependancesReconciliation {
  return {
    inventairePc,
    reinitialisateur,
    busPermissions: bus,
    compteurRelances,
    ...overrides,
  };
}

function creerMission(id: string, projet: string, sessionId: string | null = null, machine: string | null = null): void {
  registre.missions.creer({ id, lotId: 'lot-1', nom: id, projet, compteId: 'compte1', machine });
  if (sessionId) registre.missions.attacherSession(id, sessionId);
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'test réconciliation' });
  inventairePc = new InventairePcFactice();
  reinitialisateur = new ReinitialisateurFactice();
  bus = new BusPermissionsFactice();
  compteurRelances = new CompteurRelancesFactice();
  journal = new JournalFactice();
});

// ------------------------------------------------------------------- fantômes

describe('fantômes (acceptation a)', () => {
  test('mission active au registre, absente du PC, AVEC un rapport ⇒ marquée terminée', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.missions.ajouterActivite('m-1', 'Rapport final : tout est vert.', 1_000);
    inventairePc.definir([]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.fantomes).toEqual(['m-1']);
    expect(registre.missions.exiger('m-1').etatHarness).toBe('terminee');
    expect(registre.missions.exiger('m-1').derniereRaisonTerminale).toBe('fantome_reconciliation');
    expect(journal.contient('fantome_marque')).toBe(true);
  });

  /**
   * `☠` CHANTIER 2 (21/08) — LE défaut mesuré sur le parc réel : 133/393 missions
   * (34 %, 414 $) marquées `terminee` alors que leur dernier acte est un appel
   * d'outil, jamais suivi d'un texte. `terminee` est le cas NOMINAL (F2.0.1) —
   * une mission dont personne ne peut confirmer qu'elle a rendu quelque chose
   * n'est plus lue comme un succès silencieux.
   */
  test('☠ mission active au registre, absente du PC, SANS rapport ⇒ echec_definitif, pas terminee', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.fantomes).toEqual(['m-1']); // toujours détectée comme fantôme : seul l'état d'arrivée change
    expect(registre.missions.exiger('m-1').etatHarness).toBe('echec_definitif');
    expect(registre.missions.exiger('m-1').derniereRaisonTerminale).toBe('cloture_sans_rapport');
  });

  test('☠ chantier 3 (21/08) — un dernier texte de saturation de quota est reconnu et écrit', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.missions.ajouterActivite('m-1', "You've hit your session limit · resets 8:10am (Europe/Paris)", 1_000);
    inventairePc.definir([]);

    await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(registre.missions.exiger('m-1').etatHarness).toBe('echec_definitif');
    expect(registre.missions.exiger('m-1').derniereRaisonTerminale).toBe('plafond_quota');
  });

  test('☠ un long rapport qui CITE « session limit » en exemple n’est jamais pris pour une coupure', async () => {
    // Faux positif réellement observé sur le parc : un rapport d'audit de 20 630
    // caractères mentionnant « session limit » comme exemple dans son analyse.
    creerMission('m-1', 'projet-alpha', 'sess-1');
    const rapportLong = `# Analyse\n${'Le parc a mesuré des cas de session limit. '.repeat(20)}\nFin.`;
    registre.missions.ajouterActivite('m-1', rapportLong, 1_000);
    inventairePc.definir([]);

    await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(registre.missions.exiger('m-1').etatHarness).toBe('terminee');
    expect(registre.missions.exiger('m-1').derniereRaisonTerminale).toBe('fantome_reconciliation');
  });

  test('mission active au registre, worker mort sur le PC ⇒ fantôme aussi', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: false }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.fantomes).toEqual(['m-1']);
  });

  test('libererWorktree est appelé pour un fantôme qui en a un', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.missions.definirWorktree('m-1', '/wt/alpha', 'branche-a');
    inventairePc.definir([]);
    const liberes: string[] = [];

    await reconcilier(
      registre,
      deps({ libererWorktree: { liberer: (_id, worktree) => void liberes.push(worktree) } }),
      'demarrage',
      { journal },
    );

    expect(liberes).toEqual(['/wt/alpha']);
  });

  test('mission sans sessionId (jamais spawnée) n est jamais un fantôme', async () => {
    creerMission('m-1', 'projet-alpha', null);
    inventairePc.definir([]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.fantomes).toEqual([]);
    expect(registre.missions.exiger('m-1').etatHarness).toBe('planifiee');
  });
});

// ------------------------------------------------------------------ orphelins

describe('orphelins (acceptation b)', () => {
  test('☠ worker survivant sur une mission ANNULÉE ⇒ tué, JAMAIS réadopté (la décision tient)', async () => {
    // Vécu en prod le 23/07 : l'opérateur arrête une équipe, la réconciliation
    // la rouvrait (`orphelin_adopte`) et le projet restait bloqué par une équipe
    // qu'il croyait soldée. Une transition terminale est une DÉCISION, pas une
    // croyance périmée — « le PC gagne » n'arbitre qu'une divergence d'observation.
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.etats.appliquerEtatHarness('m-1', 'annulee');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.orphelinsAdoptes).toEqual([]);
    expect(rapport.orphelinsTues).toEqual(['sess-1']);
    expect(inventairePc.tues).toEqual(['sess-1']);
    // ☠ L'état ne repasse PAS à `en_cours` : c'est tout l'enjeu.
    expect(registre.missions.exiger('m-1').etatHarness).toBe('annulee');
  });

  test('☠ même chose pour une mission TERMINÉE — un worker résiduel ne la ressuscite pas', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.etats.appliquerEtatHarness('m-1', 'terminee');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(inventairePc.tues).toEqual(['sess-1']);
    expect(registre.missions.exiger('m-1').etatHarness).toBe('terminee');
  });

  test('worker vivant sans AUCUNE trace ⇒ tué, jamais ignoré par défaut', async () => {
    inventairePc.definir([{ sessionId: 'sess-inconnue', worktree: null, epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.orphelinsTues).toEqual(['sess-inconnue']);
    expect(inventairePc.tues).toEqual(['sess-inconnue']);
    expect(journal.contient('orphelin_tue')).toBe(true);
  });

  test('☠ panne #11 — un orphelin n est JAMAIS ignoré : il est adopté ou tué', async () => {
    // L invariant se teste sur le chemin de production, pas sur un mode de panne
    // simulé : un interrupteur capable de produire la panne serait lui-même le
    // risque. Ici, le seul chemin qui existe traite l orphelin.
    inventairePc.definir([{ sessionId: 'sess-inconnue', worktree: null, epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.orphelinsIgnores).toEqual([]);
    // Sans historique de mission ⇒ tué, et la mise à mort est journalisée.
    expect(rapport.orphelinsTues).toEqual(['sess-inconnue']);
    expect(journal.contient('orphelin_tue')).toBe(true);
    expect(journal.contient('orphelin_ignore')).toBe(false);
  });

  test('échec de la mise à mort n est jamais avalé', async () => {
    inventairePc.definir([{ sessionId: 'sess-x', worktree: null, epoch: 0, vivant: true }]);
    inventairePc.echecKill = true;

    await expect(reconcilier(registre, deps(), 'demarrage', { journal })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- divergence

describe('divergence d état — le PC gagne (acceptation c)', () => {
  test('mission attente_machine + PC vivant ⇒ corrigée en en_cours', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.etats.appliquerEtatHarness('m-1', 'attente_machine');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.divergencesCorrigees).toEqual(['m-1']);
    expect(registre.missions.exiger('m-1').etatHarness).toBe('en_cours');
    expect(journal.contient('divergence_pc_gagne')).toBe(true);
  });

  test('mission en_pause + PC vivant ⇒ PAS une divergence (H-57 : pause = session vivante voulue)', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.etats.appliquerEtatHarness('m-1', 'en_pause');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.divergencesCorrigees).toEqual([]);
    expect(registre.missions.exiger('m-1').etatHarness).toBe('en_pause');
  });
});

// ------------------------------------------------------------- reinitialize()

describe('reinitialize() au rattachement (acceptation d, panne #3)', () => {
  test('appelé pour une mission active toujours vivante, au démarrage', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(reinitialisateur.appels).toEqual(['sess-1']);
    expect(rapport.reinitialisationsReussies).toEqual(['sess-1']);
    expect(journal.contient('reinitialize_appele')).toBe(true);
  });

  test('☠ JAMAIS réinitialisé sur une mission terminale — le worker est tué, pas relancé', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.etats.appliquerEtatHarness('m-1', 'annulee');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    await reconcilier(registre, deps(), 'demarrage', { journal });

    // Réinitialiser un worker qu'on s'apprête à tuer serait doublement absurde.
    expect(reinitialisateur.appels).toEqual([]);
    expect(inventairePc.tues).toEqual(['sess-1']);
  });

  test('jamais appelé sur un déclencheur périodique — pas de rituel de rattachement à chaque tic', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    await reconcilier(registre, deps(), 'periodique', { journal });

    expect(reinitialisateur.appels).toEqual([]);
  });

  test('demandes en attente redélivrées via le bus de permissions', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);
    reinitialisateur.reponse = {
      demandesEnAttente: [{ requestId: 'req-1', outil: 'Bash' }],
    };

    await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(bus.redelivrees).toEqual(['req-1']);
  });

  test('☠ CASSE — sans bus câblé, une demande en attente est journalisée orpheline, jamais perdue en silence', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);
    reinitialisateur.reponse = { demandesEnAttente: [{ requestId: 'req-1', outil: 'Bash' }] };

    const rapport = await reconcilier(registre, deps({ busPermissions: undefined }), 'demarrage', { journal });

    expect(rapport.permissionsOrphelines).toEqual(['req-1']);
    expect(journal.contient('permission_orpheline')).toBe(true);
  });

  test('capacité reinitialize connue absente ⇒ pas de tentative, échec journalisé bruyamment', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    registre.capacites.enregistrer('m-1', { reinitialize: false });
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(reinitialisateur.appels).toEqual([]);
    expect(rapport.reinitialisationsEchouees).toEqual(['sess-1']);
    expect(journal.contient('permission_orpheline')).toBe(true);
  });

  test('reinitialize() qui échoue est capturé, journalisé, jamais silencieux', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);
    reinitialisateur.echoue = true;

    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(rapport.reinitialisationsEchouees).toEqual(['sess-1']);
    expect(journal.contient('permission_orpheline')).toBe(true);
  });

  test('un rattachement réussi remet à zéro le compteur de relances', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    await reconcilier(registre, deps(), 'demarrage', { journal });

    expect(compteurRelances.reinitialises).toEqual(['sess-1']);
  });
});

// -------------------------------------------------------------- déclencheurs

describe('déclencheurs', () => {
  test('« demarrage » journalise pi_redemarre, « reconnexion » et « periodique » non', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1');
    inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 0, vivant: true }]);

    await reconcilier(registre, deps(), 'demarrage', { journal });
    expect(journal.contient('pi_redemarre')).toBe(true);

    const journal2 = new JournalFactice();
    await reconcilier(registre, deps(), 'reconnexion', { journal: journal2 });
    expect(journal2.contient('pi_redemarre')).toBe(false);

    const journal3 = new JournalFactice();
    await reconcilier(registre, deps(), 'periodique', { journal: journal3 });
    expect(journal3.contient('pi_redemarre')).toBe(false);
  });
});


// ------------------------------------------------------- périmètre (migration 22)

describe('périmètre par machine de travail — le garde-fou du multi-machines', () => {
  test('☠ une équipe VIVANTE sur une autre machine n’est PAS marquée fantôme', async () => {
    // Le défaut que ce test interdit est le plus grave de tout le chantier
    // multi-machines : l'inventaire d'une machine ne rapporte QUE ses workers.
    // Sans périmètre, l'équipe du VPS est « absente du PC » — donc terminée —
    // au premier rattachement du PC, en plein travail, sans un mot.
    creerMission('m-pc', 'projet-pc', 'sess-pc', 'trinityarch');
    creerMission('m-vps', 'projet-vps', 'sess-vps', 'vps');
    // Le PC se rattache : il ne voit que SON worker.
    inventairePc.definir([{ sessionId: 'sess-pc', worktree: '/wt/pc', epoch: 0, vivant: true }]);

    const rapport = await reconcilier(
      registre,
      deps({ concerne: (m) => m.machine === 'trinityarch' }),
      'reconnexion',
      { journal },
    );

    expect(rapport.fantomes).toEqual([]);
    expect(registre.missions.exiger('m-vps').etatHarness).not.toBe('terminee');
  });

  test('dans son périmètre, un fantôme reste un fantôme', async () => {
    // La contre-épreuve du test précédent : le périmètre ne doit pas devenir une
    // amnistie générale. Une mission de CETTE machine, absente de SON inventaire,
    // est morte — et le reste.
    creerMission('m-pc', 'projet-pc', 'sess-pc', 'trinityarch');
    inventairePc.definir([]);

    const rapport = await reconcilier(
      registre,
      deps({ concerne: (m) => m.machine === 'trinityarch' }),
      'reconnexion',
      { journal },
    );

    expect(rapport.fantomes).toEqual(['m-pc']);
  });

  test('☠ une mission SANS machine connue est rapportée hors périmètre, jamais tue', async () => {
    // Personne ne la réconciliera : elle occupe son projet (H-56) jusqu'à un
    // arrêt explicite. Le taire ferait chercher longtemps pourquoi le dispatch
    // suivant est refusé devant un parc qui paraît vide.
    creerMission('m-ancienne', 'projet-x', 'sess-x', null);
    inventairePc.definir([]);

    const rapport = await reconcilier(registre, deps({ concerne: (m) => m.machine === 'vps' }), 'reconnexion', {
      journal,
    });

    expect(rapport.horsPerimetre).toEqual(['m-ancienne']);
    expect(rapport.fantomes).toEqual([]);
    expect(registre.missions.exiger('m-ancienne').etatHarness).not.toBe('terminee');
  });

  test('sans périmètre (mono-machine, bancs), le comportement d’origine est intact', async () => {
    creerMission('m-1', 'projet-alpha', 'sess-1', null);
    inventairePc.definir([]);
    const rapport = await reconcilier(registre, deps(), 'demarrage', { journal });
    expect(rapport.fantomes).toEqual(['m-1']);
    expect(rapport.horsPerimetre).toEqual([]);
  });
});
