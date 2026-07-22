/**
 * M-53 — Propriété 3/5 : REPRISE (03-couche-1.md, critère de réussite).
 *
 * « Perdre le lien réseau puis le retrouver ne perd ni ne duplique aucune demande de
 *   permission. »
 *
 * Assemble DEUX modules réels de production ensemble — c'est le point de la mission,
 * une propriété de couche 1 ne se prouve pas en unité :
 *  - `reconcilier()` (E.1.4/D.2.4, M-30, `control-plane/reconciliation/reconciliation.ts`) —
 *    le point d'entrée réel appelé au rattachement (`demarrage`/`reconnexion`) ;
 *  - `MachineEtatsDemandes` (C.2/C.3, M-21, `control-plane/bus-permissions/`) — le VRAI
 *    bus, jamais une doublure de bus, câblé comme `deps.busPermissions` exactement comme
 *    le fait la production (voir `superviseur/superviseur-workers.ts`).
 *
 * `☠ CONDITION SOUS LAQUELLE CETTE PROPRIÉTÉ CESSE DE TENIR` (à croiser avec `TODO.md`,
 * dette n°3) :
 *  1. `pending_permission_requests` n'est PAS un champ des types PUBLICS du SDK
 *     (`SDKControlInitializeResponse`) — sa présence réelle sur `reinitialize()` est une
 *     `⚠ HYP` non vérifiée par banc réel (« à trancher au premier banc réel de
 *     reconnexion », TODO.md). Ce test suppose que `ReinitialisateurSession.reinitialiser()`
 *     RETOURNE bien les demandes en attente — si le SDK réel ne les fournit jamais, la
 *     chaîne testée ici ne reçoit jamais rien à redélivrer, et la propriété ne tient que
 *     par vide (rien à perdre, mais rien n'est prouvé non plus).
 *  2. La reprise dépend de `registre.capacites.estPresente(missionId, 'reinitialize')` —
 *     si cette capacité n'a jamais été enregistrée (worker jamais démarré avec succès),
 *     `tenterReinitialiser` refuse structurellement d'appeler `reinitialize()` (voir
 *     `reconciliation.ts`, branche `capacitePresente === false`) : reprise dégradée par
 *     construction, pas un bug — mais à ne pas confondre avec « la propriété tient ».
 *  3. Cette propriété est démontrée au niveau Pi (registre + bus). Elle ne couvre PAS le
 *     transport D lui-même (perte d'octets bruts, D.1.3) — cette moitié appartient à
 *     M-10/M-12, hors périmètre C/E testé ici.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../control-plane/registre/index.ts';
import { MachineEtatsDemandes } from '../control-plane/bus-permissions/index.ts';
import { reconcilier } from '../control-plane/reconciliation/reconciliation.ts';
import type {
  DependancesReconciliation,
  DescripteurWorkerPc,
  InventairePc,
  ReinitialisateurSession,
  ResultatReinitialisation,
} from '../control-plane/reconciliation/types.ts';

class InventairePcFactice implements InventairePc {
  #workers: DescripteurWorkerPc[] = [];
  definir(workers: readonly DescripteurWorkerPc[]): void {
    this.#workers = [...workers];
  }
  inventaire(): readonly DescripteurWorkerPc[] {
    return this.#workers;
  }
  tuerSansPreavis(): void {
    throw new Error('non exercé dans ce test — aucun orphelin attendu');
  }
}

/** Rejoue, à chaque appel, EXACTEMENT ce que le SDK aurait redélivré (⚠ HYP, voir en-tête). */
class ReinitialisateurRejouantLaCoupure implements ReinitialisateurSession {
  reponse: ResultatReinitialisation = { demandesEnAttente: [] };
  async reinitialiser(): Promise<ResultatReinitialisation> {
    return this.reponse;
  }
}

let registre: Registre;
let inventairePc: InventairePcFactice;
let reinitialisateur: ReinitialisateurRejouantLaCoupure;
let bus: MachineEtatsDemandes;

function deps(): DependancesReconciliation {
  return { inventairePc, reinitialisateur, busPermissions: bus };
}

beforeEach(() => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte1', configDir: '/tmp/cc-compte1' });
  registre.lots.creer({ id: 'lot-1', intention: 'reprise' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'm-1', projet: 'projet-alpha', compteId: 'compte1' });
  registre.missions.attacherSession('m-1', 'sess-1');
  registre.capacites.enregistrer('m-1', { reinitialize: true });

  inventairePc = new InventairePcFactice();
  inventairePc.definir([{ sessionId: 'sess-1', worktree: '/wt/alpha', epoch: 1, vivant: true }]);
  reinitialisateur = new ReinitialisateurRejouantLaCoupure();
  bus = new MachineEtatsDemandes();
});

describe('reprise — une demande escaladée survit à UNE coupure sans duplication', () => {
  test('req-1 en attente avant coupure ; redélivrée à la reconnexion : même demande, aucune notification en plus', async () => {
    bus.recevoir({ requestId: 'req-1', idWorker: 'sess-1', outil: 'Bash' });
    bus.escalader('req-1');
    expect(bus.notificationsEmises()).toBe(1);

    // Le lien tombe, puis revient : le Pi rattache la session (D.2.4).
    reinitialisateur.reponse = { demandesEnAttente: [{ requestId: 'req-1', outil: 'Bash' }] };
    const rapport = await reconcilier(registre, deps(), 'reconnexion');

    expect(rapport.reinitialisationsReussies).toEqual(['sess-1']);
    expect(bus.demande('req-1')?.etat).toBe('en_attente'); // toujours là, jamais perdue
    expect(bus.notificationsEmises()).toBe(1); // ☠ pas de deuxième notification (panne #25)
  });
});

describe('reprise — DEUX coupures successives sur la même demande : toujours pas de duplication', () => {
  test('deux redélivrances d’affilée de req-1 laissent le bus dans le même état', async () => {
    bus.recevoir({ requestId: 'req-1', idWorker: 'sess-1', outil: 'Bash' });
    bus.escalader('req-1');
    reinitialisateur.reponse = { demandesEnAttente: [{ requestId: 'req-1', outil: 'Bash' }] };

    await reconcilier(registre, deps(), 'reconnexion');
    await reconcilier(registre, deps(), 'reconnexion'); // deuxième coupure/reconnexion

    expect(bus.notificationsEmises()).toBe(1);
    expect(bus.demande('req-1')?.etat).toBe('en_attente');
  });
});

describe('reprise — un verdict déjà rendu n’est jamais reperdu ni redemandé à l’humain', () => {
  test('req-1 répondue AVANT une coupure : la redélivrance réémet le verdict, ne réescalade pas', async () => {
    bus.recevoir({ requestId: 'req-1', idWorker: 'sess-1', outil: 'Bash' });
    bus.escalader('req-1');
    bus.repondre('req-1', { behavior: 'allow' });
    expect(bus.notificationsEmises()).toBe(1);

    reinitialisateur.reponse = { demandesEnAttente: [{ requestId: 'req-1', outil: 'Bash' }] };
    await reconcilier(registre, deps(), 'reconnexion');

    // Le verdict existe toujours, intact — ni reperdu, ni une deuxième demande humaine.
    expect(bus.demande('req-1')?.etat).toBe('repondue');
    expect(bus.demande('req-1')?.verdict).toEqual({ behavior: 'allow' });
    expect(bus.notificationsEmises()).toBe(1);
  });
});

describe('reprise — panne #3 réintroduite : sans reconcilier(), la demande reste sourde', () => {
  test('témoin négatif : escalader une demande SANS jamais appeler reconcilier() ne la fait jamais progresser', () => {
    bus.recevoir({ requestId: 'req-1', idWorker: 'sess-1', outil: 'Bash' });
    bus.escalader('req-1');
    // Aucun appel à reconcilier ici — modélise D.2.4 absent (panne #3).
    expect(bus.demande('req-1')?.etat).toBe('en_attente');
    expect(bus.balayerNonTraitees(0)).toEqual(['req-1']); // I-1 : détectable, mais pas résolu tout seul
  });
});
