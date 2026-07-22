// Tests de la machine à états des demandes de permission (M-21).
// Chaque `☠ CASSE` de la grille de revue attaché à ce module a un test dédié :
// #25 (redélivrance non dédupliquée) et les invariants I-1 à I-5 de C.2.2.

import { describe, expect, test } from 'bun:test';
import { MachineEtatsDemandes } from './machine-etats.ts';
import type { EntreeDemande, HorlogeBus, Verdict } from './types.ts';

/** Horloge factice locale — pas de dépendance à `test-harness` (règle 1 de son README). */
class HorlogeManuelle implements HorlogeBus {
  #t = 0;
  maintenant(): number {
    return this.#t;
  }
  avancer(ms: number): void {
    this.#t += ms;
  }
}

const DEMANDE: EntreeDemande = {
  requestId: 'req-1',
  idWorker: 'w1',
  outil: 'Bash',
  decisionReason: 'commande hors plancher',
};

const ALLOW: Verdict = { behavior: 'allow' };
const DENY: Verdict = { behavior: 'deny', message: 'motif' };

describe('cycle de vie C.2.1 — chemin résolu par le lead', () => {
  test('reçue puis résolue automatiquement : terminal, silencieux', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    expect(machine.demande('req-1')?.etat).toBe('recue');
    expect(machine.resoudreAuto('req-1', ALLOW)).toBe(true);
    const demande = machine.demande('req-1');
    expect(demande?.etat).toBe('resolue_auto');
    expect(demande?.verdict).toEqual(ALLOW);
    // H-40/C.4.4 : ce que le lead résout seul ne notifie jamais l'humain.
    expect(machine.notificationsEmises()).toBe(0);
  });

  test('une demande déjà résolue ne peut pas être résolue une seconde fois', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.resoudreAuto('req-1', ALLOW);
    expect(machine.resoudreAuto('req-1', DENY)).toBe(false);
    expect(machine.demande('req-1')?.verdict).toEqual(ALLOW);
  });
});

describe('cycle de vie C.2.1 — chemin escaladé', () => {
  test('escalade notifie une fois et attend', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    expect(machine.escalader('req-1')).toBe(true);
    expect(machine.demande('req-1')?.etat).toBe('en_attente');
    expect(machine.enAttente()).toHaveLength(1);
    expect(machine.notificationsEmises()).toBe(1);
  });

  test('répondre puis confirmer traverse repondue → confirmee', () => {
    const horloge = new HorlogeManuelle();
    const machine = new MachineEtatsDemandes(horloge);
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    horloge.avancer(1_000);
    expect(machine.repondre('req-1', ALLOW)).toBe(true);
    expect(machine.demande('req-1')?.repondueA).toBe(1_000);
    horloge.avancer(500);
    expect(machine.confirmer('req-1')).toBe(true);
    const demande = machine.demande('req-1');
    expect(demande?.etat).toBe('confirmee');
    expect(demande?.confirmeeA).toBe(1_500);
  });

  test('un tour avorté rend une demande en_attente caduque ; une confirmée résiste', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    expect(machine.rendreCaduque('req-1')).toBe(true);
    expect(machine.demande('req-1')?.etat).toBe('caduque');

    machine.recevoir({ ...DEMANDE, requestId: 'req-2' });
    machine.escalader('req-2');
    machine.repondre('req-2', ALLOW);
    machine.confirmer('req-2');
    expect(machine.rendreCaduque('req-2')).toBe(false);
    expect(machine.demande('req-2')?.etat).toBe('confirmee');
  });
});

describe('invariant I-4 — une demande caduque ne reçoit jamais de verdict', () => {
  test('répondre à une demande caduque échoue et ne change rien', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.rendreCaduque('req-1');
    expect(machine.repondre('req-1', ALLOW)).toBe(false);
    expect(machine.demande('req-1')?.verdict).toBeNull();
    expect(machine.verdictsSurCaduques()).toBe(1);
  });
});

describe('invariant I-2 — exactement un verdict par requestId', () => {
  test('un second verdict sur une demande déjà répondue est détecté, jamais appliqué', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    expect(machine.repondre('req-1', ALLOW)).toBe(true);
    expect(machine.repondre('req-1', DENY)).toBe(false);
    expect(machine.demande('req-1')?.verdict).toEqual(ALLOW);
    expect(machine.reponsesDupliquees()).toBe(1);
  });

  test('un second verdict après confirmation est détecté aussi', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);
    machine.confirmer('req-1');
    expect(machine.repondre('req-1', DENY)).toBe(false);
    expect(machine.reponsesDupliquees()).toBe(1);
  });
});

describe('☠ panne #25 — redélivrance non dédupliquée', () => {
  test('acceptation (a) : une redélivrance après coupure ne double pas la notification', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    expect(machine.notificationsEmises()).toBe(1);

    machine.redelivrer(DEMANDE);
    machine.redelivrer(DEMANDE);
    expect(machine.notificationsEmises()).toBe(1);
  });

  test('redélivrance d\'une demande inconnue après redémarrage du Pi : escalade fraîche, une notification', () => {
    const machine = new MachineEtatsDemandes();
    const resultat = machine.redelivrer(DEMANDE);
    expect(resultat).toEqual({ action: 'nouvelle_escalade' });
    expect(machine.demande('req-1')?.etat).toBe('en_attente');
    expect(machine.notificationsEmises()).toBe(1);

    machine.redelivrer(DEMANDE);
    expect(machine.notificationsEmises()).toBe(1);
  });

  test('acceptation (b) : une demande déjà répondue voit son verdict réémis, pas une nouvelle sollicitation', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);

    const resultat = machine.redelivrer(DEMANDE);
    expect(resultat).toEqual({ action: 'verdict_a_reemettre', verdict: ALLOW });
    expect(machine.notificationsEmises()).toBe(1);
  });

  test('une demande déjà confirmée voit aussi son verdict réémis, sans notification', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);
    machine.confirmer('req-1');

    const resultat = machine.redelivrer(DEMANDE);
    expect(resultat).toEqual({ action: 'verdict_a_reemettre', verdict: ALLOW });
    expect(machine.notificationsEmises()).toBe(1);
  });

  test('une demande caduque redélivrée est refusée proprement', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.rendreCaduque('req-1');
    const notificationsAvant = machine.notificationsEmises();

    expect(machine.redelivrer(DEMANDE)).toEqual({ action: 'refusee' });
    expect(machine.notificationsEmises()).toBe(notificationsAvant);
  });

  test('une demande déjà en_attente redélivrée reste en file, sans nouvelle notification', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    expect(machine.redelivrer(DEMANDE)).toEqual({ action: 'deja_en_file' });
    expect(machine.notificationsEmises()).toBe(1);
  });
});

describe('C.3.3 — rejet d\'une réponse', () => {
  test('une réponse rejetée ne transitionne rien : la demande reste éligible à la redélivrance', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    expect(machine.rejeterReponse('req-1', 'signature invalide')).toBe(true);
    expect(machine.demande('req-1')?.etat).toBe('en_attente');
    expect(machine.demande('req-1')?.verdict).toBeNull();

    // Conséquence de C.3.3 : la demande rejetée doit encore réagir normalement
    // à une redélivrance ultérieure, comme si rien ne s'était passé.
    expect(machine.redelivrer(DEMANDE)).toEqual({ action: 'deja_en_file' });
  });

  test('rejeter une réponse sur une demande déjà tranchée est un no-op signalé', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);
    expect(machine.rejeterReponse('req-1', 'signature invalide')).toBe(false);
    expect(machine.demande('req-1')?.verdict).toEqual(ALLOW);
  });
});

describe('invariant I-1 — toute escalade non traitée est détectée', () => {
  test('une demande en_attente au-delà du seuil est signalée', () => {
    const horloge = new HorlogeManuelle();
    const machine = new MachineEtatsDemandes(horloge);
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');

    horloge.avancer(30_000);
    expect(machine.balayerNonTraitees(60_000)).toEqual([]);
    horloge.avancer(30_000);
    expect(machine.balayerNonTraitees(60_000)).toEqual(['req-1']);
  });

  test('une demande traitée avant le seuil ne déclenche rien', () => {
    const horloge = new HorlogeManuelle();
    const machine = new MachineEtatsDemandes(horloge);
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);
    horloge.avancer(10 * 60_000);
    expect(machine.balayerNonTraitees(60_000)).toEqual([]);
  });
});

describe('acceptation (c) — invariant I-5 : répondue sans confirmée au-delà du seuil ⇒ alerte', () => {
  test('un verdict jamais confirmé déclenche une alerte après le seuil', () => {
    const horloge = new HorlogeManuelle();
    const machine = new MachineEtatsDemandes(horloge);
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);

    horloge.avancer(30_000);
    expect(machine.balayerAgentBloque(60_000)).toEqual([]);
    horloge.avancer(30_000);
    expect(machine.balayerAgentBloque(60_000)).toEqual(['req-1']);
  });

  test('une demande confirmée n\'alerte jamais, même longtemps après', () => {
    const horloge = new HorlogeManuelle();
    const machine = new MachineEtatsDemandes(horloge);
    machine.recevoir(DEMANDE);
    machine.escalader('req-1');
    machine.repondre('req-1', ALLOW);
    machine.confirmer('req-1');
    horloge.avancer(10 * 60_000);
    expect(machine.balayerAgentBloque(60_000)).toEqual([]);
  });
});

describe('invariant I-3 — une demande redélivrée n\'en crée jamais une seconde', () => {
  test('recevoir un requestId déjà connu est traité comme une redélivrance, pas une création', () => {
    const machine = new MachineEtatsDemandes();
    machine.recevoir(DEMANDE);
    machine.recevoir(DEMANDE);
    expect(machine.enAttente()).toHaveLength(0);
    // Un seul enregistrement existe toujours pour ce requestId.
    expect(machine.demande('req-1')?.etat).toBe('recue');
  });
});

describe('reproductibilité — même scénario, même trace observable', () => {
  test('le scénario coupure + redélivrance + blocage produit toujours le même verdict de sortie', () => {
    const executer = (): readonly [number, number, readonly string[]] => {
      const horloge = new HorlogeManuelle();
      const machine = new MachineEtatsDemandes(horloge);
      machine.recevoir(DEMANDE);
      machine.escalader('req-1');
      horloge.avancer(1_000);
      machine.redelivrer(DEMANDE);
      machine.repondre('req-1', ALLOW);
      horloge.avancer(120_000);
      const bloquees = machine.balayerAgentBloque(60_000);
      return [machine.notificationsEmises(), machine.reponsesDupliquees(), bloquees];
    };
    expect(executer()).toEqual(executer());
  });
});
