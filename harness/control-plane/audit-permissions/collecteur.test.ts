// Tests du collecteur d'audit (M-22). Chaque cas répond à un des trois
// critères d'acceptation de la mission :
//  (a) auteur tracé sur chaque décision
//  (b) l'exhaustivité vient de PreToolUse, jamais de canUseTool
//  (c) la trace répond à « le classifieur a-t-il autorisé ce que je n'aurais
//      pas autorisé ? » sans rejouer la session
//
// Panne #23 de la grille : « canUseTool utilisé pour l'audit exhaustif ⇒ angle
// mort ». Le test « exhaustivité » ci-dessous est celui qui échoue si ce
// module régresse vers `canUseTool` comme source primaire.

import { describe, expect, test } from 'bun:test';
import { CollecteurAuditPermissions } from './collecteur.ts';
import type { HorlogeAudit } from './types.ts';

class HorlogeManuelle implements HorlogeAudit {
  #t = 0;
  maintenant(): number {
    return this.#t;
  }
  avancer(ms: number): void {
    this.#t += ms;
  }
}

const TENTATIVE_AUTO = {
  toolUseId: 'tu-1',
  outil: 'Bash',
  entree: { command: 'ls' },
  sessionId: 'sess-1',
  cwd: '/mnt/projects/x',
  agentId: null,
  permissionMode: 'auto',
};

describe('C.1.1 — exhaustivité par PreToolUse', () => {
  test('une tentative auto-approuvée (jamais vue par canUseTool) est quand même tracée', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative(TENTATIVE_AUTO);
    collecteur.enregistrerExecution({ toolUseId: 'tu-1', outil: 'Bash' });
    const registre = collecteur.registre();
    expect(registre).toHaveLength(1);
    expect(registre[0]?.verdict).toBe('autorise');
  });

  test('une tentative redélivrée (même toolUseId) ne duplique pas l\'entrée', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative(TENTATIVE_AUTO);
    collecteur.enregistrerTentative(TENTATIVE_AUTO);
    expect(collecteur.registre()).toHaveLength(1);
  });

  test('couverture — angle mort détecté si une tentative reste indéterminée', () => {
    const horloge = new HorlogeManuelle();
    const collecteur = new CollecteurAuditPermissions(horloge);
    collecteur.enregistrerTentative(TENTATIVE_AUTO);
    horloge.avancer(60_000);
    const nonResolues = collecteur.tentativesNonResolues(30_000);
    expect(nonResolues).toHaveLength(1);
    expect(collecteur.couverture()).toEqual({
      tentativesVues: 1,
      autorisees: 0,
      refusees: 0,
      nonResolues: 1,
    });
  });
});

describe('(a) auteur tracé sur chaque décision', () => {
  test('refus classifieur (message structuré) : auteur certain, pas inféré', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'tu-2' });
    collecteur.enregistrerRefusMessage({
      toolUseId: 'tu-2',
      outil: 'Bash',
      motif: 'rm -rf refusé',
      discriminantAuteur: 'classifier',
      agentId: null,
    });
    const entree = collecteur.demandeParId('tu-2');
    expect(entree?.verdict).toBe('refuse');
    expect(entree?.auteur).toBe('classifieur');
  });

  test('refus par règle scopée (plancher de déni) : auteur "regle_scopee"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerRefusMessage({
      toolUseId: 'tu-3',
      outil: 'Bash',
      motif: 'motif de plancher',
      discriminantAuteur: 'rule',
      agentId: null,
    });
    expect(collecteur.demandeParId('tu-3')?.auteur).toBe('regle_scopee');
  });

  test('discriminant inconnu : classé "inconnu", jamais surclassé en "classifieur"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerRefusMessage({
      toolUseId: 'tu-4',
      outil: 'Bash',
      motif: null,
      discriminantAuteur: 'un_futur_discriminant_jamais_vu',
      agentId: null,
    });
    expect(collecteur.demandeParId('tu-4')?.auteur).toBe('inconnu');
  });

  test('autorisation sans signal de refus : "classifieur_probable", jamais "classifieur"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'tu-5' });
    collecteur.enregistrerExecution({ toolUseId: 'tu-5', outil: 'Bash' });
    // ⚠ HYP documentée : le SDK n'affirme jamais une autorisation classifieur,
    // seule une inférence est possible — le type le distingue explicitement.
    expect(collecteur.demandeParId('tu-5')?.auteur).toBe('classifieur_probable');
  });

  test('escalade humaine (canal C.1.2 / mode default) : auteur "humain"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'tu-6', permissionMode: 'default' });
    collecteur.enregistrerEscaladeHumaine({
      toolUseId: 'tu-6',
      outil: 'AskUserQuestion',
      autorise: true,
      motif: 'validé par Chris',
    });
    const entree = collecteur.demandeParId('tu-6');
    expect(entree?.auteur).toBe('humain');
    expect(entree?.verdict).toBe('autorise');
  });

  test('exécution après un refus déjà tracé est une contradiction, jamais écrasée en silence', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerRefusMessage({
      toolUseId: 'tu-7',
      outil: 'Bash',
      motif: 'refusé',
      discriminantAuteur: 'classifier',
      agentId: null,
    });
    collecteur.enregistrerExecution({ toolUseId: 'tu-7', outil: 'Bash' });
    // Le verdict de refus, déjà émis, n'est pas écrasé par une exécution incohérente.
    expect(collecteur.demandeParId('tu-7')?.verdict).toBe('refuse');
  });
});

describe('(c) répondre à « le classifieur a-t-il autorisé ce que je n\'aurais pas autorisé ? »', () => {
  test('la liste des autorisations classifieur est directement consultable, sans rejouer la session', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'ok-1', outil: 'Read' });
    collecteur.enregistrerExecution({ toolUseId: 'ok-1', outil: 'Read' });
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'douteux-1', outil: 'Bash' });
    collecteur.enregistrerExecution({ toolUseId: 'douteux-1', outil: 'Bash' });
    collecteur.enregistrerRefusMessage({
      toolUseId: 'refuse-1',
      outil: 'Bash',
      motif: 'rm -rf',
      discriminantAuteur: 'classifier',
      agentId: null,
    });

    const autorisations = collecteur.autorisationsClassifieur();
    expect(autorisations.map((e) => e.toolUseId).sort()).toEqual(['douteux-1', 'ok-1']);

    const refus = collecteur.refusParClassifieur();
    expect(refus).toHaveLength(1);
    expect(refus[0]?.toolUseId).toBe('refuse-1');
  });

  test('demandes récurrentes — signal pour une règle permanente', () => {
    const collecteur = new CollecteurAuditPermissions();
    for (const id of ['r1', 'r2', 'r3']) {
      collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: id, entree: { command: 'git status' } });
      collecteur.enregistrerExecution({ toolUseId: id, outil: 'Bash' });
    }
    const recurrentes = collecteur.demandesRecurrentes(3);
    expect(recurrentes).toHaveLength(1);
    expect(recurrentes[0]?.occurrences).toBe(3);
  });
});

describe('correctif 2026-07-22 — refus par tool_result, sans message system', () => {
  // Chronologie mesurée en réel (acceptation/audit-permissions-reel.ts) :
  // aucun hook PermissionDenied, aucun SDKPermissionDeniedMessage. Le SEUL
  // signal est le tool_result. Ce test échoue si l'audit revient à dépendre
  // du message `system` comme unique source de refus.
  test('un refus par plancher de déni est compté dans "refusees", pas dans "nonResolues"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'tu-plancher-1', outil: 'Bash' });
    // Aucun enregistrerRefusMessage ni enregistrerRefusHook n'est appelé ici —
    // exactement la situation mesurée en réel.
    collecteur.enregistrerRefusToolResult({
      toolUseId: 'tu-plancher-1',
      texte: 'Error: permission denied for Bash(echo SONDE-REFUS*)',
    });
    const entree = collecteur.demandeParId('tu-plancher-1');
    expect(entree?.verdict).toBe('refuse');
    // Aucun discriminant d'auteur n'existe sur ce chemin — honnête, pas inventé.
    expect(entree?.auteur).toBe('inconnu');
    expect(collecteur.couverture()).toEqual({
      tentativesVues: 1,
      autorisees: 0,
      refusees: 1,
      nonResolues: 0,
    });
  });

  test('une tentative sans PostToolUse ni tool_result de refus reste indéterminée, jamais refusée par défaut', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'tu-silence-1', outil: 'Bash' });
    // Rien d'autre n'arrive : ni exécution, ni refus. L'ambiguïté doit rester visible.
    const entree = collecteur.demandeParId('tu-silence-1');
    expect(entree?.verdict).toBe('indetermine');
  });

  test('reproduit la scène mesurée : 3 tentatives, 2 autorisées, 1 refusée — jamais "nonResolues"', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'c1', entree: { command: 'echo SONDE-AUTORISE-un' } });
    collecteur.enregistrerExecution({ toolUseId: 'c1', outil: 'Bash' });
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'c2', entree: { command: 'echo SONDE-REFUS-deux' } });
    collecteur.enregistrerRefusToolResult({ toolUseId: 'c2', texte: 'permission denied' });
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'c3', entree: { command: 'echo SONDE-AUTORISE-trois' } });
    collecteur.enregistrerExecution({ toolUseId: 'c3', outil: 'Bash' });

    expect(collecteur.couverture()).toEqual({
      tentativesVues: 3,
      autorisees: 2,
      refusees: 1,
      nonResolues: 0,
    });
    expect(collecteur.tousLesRefus().map((e) => e.toolUseId)).toEqual(['c2']);
  });

  test('un message system arrivant après le tool_result peut toujours enrichir l\'auteur (upgrade, pas dégradation)', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'c4' });
    collecteur.enregistrerRefusToolResult({ toolUseId: 'c4', texte: 'permission denied' });
    expect(collecteur.demandeParId('c4')?.auteur).toBe('inconnu');
    // Si un chemin futur produit malgré tout un message structuré, il doit
    // pouvoir préciser l'auteur sans que ce module s'y oppose.
    collecteur.enregistrerRefusMessage({
      toolUseId: 'c4',
      outil: 'Bash',
      motif: null,
      discriminantAuteur: 'rule',
      agentId: null,
    });
    expect(collecteur.demandeParId('c4')?.auteur).toBe('regle_scopee');
  });

  test('une exécution déjà confirmée n\'est jamais rétrogradée en refus par un tool_result tardif', () => {
    const collecteur = new CollecteurAuditPermissions();
    collecteur.enregistrerTentative({ ...TENTATIVE_AUTO, toolUseId: 'c5' });
    collecteur.enregistrerExecution({ toolUseId: 'c5', outil: 'Bash' });
    collecteur.enregistrerRefusToolResult({ toolUseId: 'c5', texte: 'permission denied' });
    expect(collecteur.demandeParId('c5')?.verdict).toBe('autorise');
  });
});
