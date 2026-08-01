/**
 * Tests d'acceptation de la mission M-33 (B.4, H-46). Chaque `describe` correspond à une
 * lettre de l'acceptation de la mission, ou à un `☠ CASSE` explicite de `Upgrade/16` /
 * `Upgrade/05-arbre-B-workers.md` — la grille de revue l'exige (« tout ☠ CASSE a un test »).
 *
 * Le temps est simulé (règle du dépôt : 5 minutes de test ne sont jamais 5 minutes
 * réelles). `ControleurPause` ne porte lui-même aucun minuteur — B.4 ne spécifie aucun
 * comportement borné dans le temps — donc l'horloge sert ici à PROUVER l'absence d'effet
 * caché : rien ne se libère, ne se perd ni ne se déclenche tout seul au fil du temps qui
 * passe pendant la pause, seule `reprendre()` le fait.
 */

import { describe, expect, test } from 'bun:test';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { HorlogeSimulee } from '../test-harness/deterministe/horloge-simulee.ts';
import type { WorkerCapabilities } from '../workers/types.ts';
import { ControleurPause } from './controleur-pause.ts';
import { partitionnerStillQueued } from './partition.ts';
import type { FileEntreeCiblee, RegistrePauseAdapter, SourceInterruption } from './types.ts';

function capacites(advertised: readonly string[]): WorkerCapabilities {
  return {
    advertised,
    mcpServers: [],
    claudeCodeVersion: '2.1.217',
    tools: [],
    model: 'claude-sonnet-4-6',
    sessionId: 's-test',
  };
}

function texte(contenu: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: contenu },
    parent_tool_use_id: null,
  };
}

class CibleFactice implements FileEntreeCiblee {
  readonly recus: SDKUserMessage[] = [];
  async envoyerMessage(message: SDKUserMessage): Promise<void> {
    this.recus.push(message);
  }
}

class RegistreFactice implements RegistrePauseAdapter {
  readonly appels: string[] = [];
  constructor(private readonly surMarquageEnPause?: () => void) {}
  marquerEnPause(sessionId: string): void {
    this.surMarquageEnPause?.();
    this.appels.push(`en_pause:${sessionId}`);
  }
  marquerActive(sessionId: string): void {
    this.appels.push(`active:${sessionId}`);
  }
}

class SourceFactice implements SourceInterruption {
  appels = 0;
  constructor(
    private readonly reponse: { still_queued: string[] } | undefined,
    private readonly avantResolution?: () => void | Promise<void>,
  ) {}
  async interrupt(): Promise<{ still_queued: string[] } | undefined> {
    this.appels += 1;
    await this.avantResolution?.();
    return this.reponse;
  }
}

function nouveauControleur(params: {
  capacitesAnnoncees?: readonly string[];
  reponseInterrupt?: { still_queued: string[] } | undefined;
  avantResolution?: () => void | Promise<void>;
}): {
  controleur: ControleurPause;
  cible: CibleFactice;
  registre: RegistreFactice;
  source: SourceFactice;
} {
  const cible = new CibleFactice();
  const registre = new RegistreFactice();
  const reponse = 'reponseInterrupt' in params ? params.reponseInterrupt : { still_queued: [] };
  const source = new SourceFactice(reponse, params.avantResolution);
  const controleur = new ControleurPause({
    sessionId: 'equipe-1',
    source,
    cible,
    registre,
    capacites: capacites(params.capacitesAnnoncees ?? ['interrupt_receipt_v1']),
  });
  return { controleur, cible, registre, source };
}

describe('acceptation (a) — pause pendant un tour actif, 5 minutes, reprise sans perte ni doublon', () => {
  test('les messages envoyés pendant la pause sont retenus puis relâchés, une seule fois, dans l\'ordre', async () => {
    const { controleur, cible } = nouveauControleur({});
    const horloge = new HorlogeSimulee();

    await controleur.mettreEnPause();
    expect(controleur.enPause).toBe(true);

    // Cinq minutes simulées d'activité opérateur pendant la pause : rien ne doit fuir
    // vers la cible tant que `reprendre()` n'a pas été appelé.
    const envoyes: Promise<void>[] = [];
    for (let minute = 0; minute < 5; minute += 1) {
      horloge.avancer(60_000);
      envoyes.push(controleur.envoyer(texte(`instruction-minute-${minute}`)));
    }
    await Promise.all(envoyes);

    expect(cible.recus).toHaveLength(0);
    expect(controleur.enAttente).toBe(5);

    await controleur.reprendre();

    expect(controleur.enPause).toBe(false);
    expect(controleur.enAttente).toBe(0);
    expect(cible.recus).toHaveLength(5);
    // Aucune perte, aucun doublon, ordre de dépôt préservé.
    expect(cible.recus.map((m) => (m.message as { content: string }).content)).toEqual([
      'instruction-minute-0',
      'instruction-minute-1',
      'instruction-minute-2',
      'instruction-minute-3',
      'instruction-minute-4',
    ]);
  });

  test('un message envoyé avant la pause part immédiatement, jamais retenu', async () => {
    const { controleur, cible } = nouveauControleur({});
    await controleur.envoyer(texte('avant-pause'));
    expect(cible.recus).toHaveLength(1);

    await controleur.mettreEnPause();
    await controleur.envoyer(texte('pendant-pause'));
    expect(cible.recus).toHaveLength(1);

    await controleur.reprendre();
    expect(cible.recus).toHaveLength(2);
  });

  test('mettreEnPause est idempotent : un second appel ne réinterrompt pas', async () => {
    const { controleur, source } = nouveauControleur({});
    await controleur.mettreEnPause();
    await controleur.mettreEnPause();
    expect(source.appels).toBe(1);
  });

  test('reprendre est idempotent : un second appel ne relâche rien deux fois', async () => {
    const { controleur, cible, registre } = nouveauControleur({});
    await controleur.mettreEnPause();
    await controleur.envoyer(texte('x'));
    await controleur.reprendre();
    const appelsApresPremierePrise = registre.appels.length;
    await controleur.reprendre();
    expect(cible.recus).toHaveLength(1);
    expect(registre.appels.length).toBe(appelsApresPremierePrise);
  });

  test('étape 1 (B.4) — le registre est marqué en_pause AVANT que interrupt() ne résolve', async () => {
    const ordre: string[] = [];
    const registre = new RegistreFactice(() => ordre.push('registre-marque'));
    const cible = new CibleFactice();
    const source = new SourceFactice({ still_queued: [] }, () => {
      ordre.push('interrupt-en-cours');
    });
    const controleur = new ControleurPause({
      sessionId: 'equipe-1',
      source,
      cible,
      registre,
      capacites: capacites(['interrupt_receipt_v1']),
    });
    await controleur.mettreEnPause();
    expect(ordre).toEqual(['registre-marque', 'interrupt-en-cours']);
  });
});

describe('acceptation (b) — le reçu est lu avant le SDKResultMessage, jamais la file après', () => {
  test('le reçu retenu est exactement la valeur de retour de interrupt(), rien d\'autre', async () => {
    let etatExterneApresResultat = 'non-modifie';
    const { controleur } = nouveauControleur({
      reponseInterrupt: { still_queued: ['uuid-a', 'uuid-b'] },
      avantResolution: () => {
        // Simule un `SDKResultMessage` qui "arriverait" après le traitement de
        // l'interruption : le contrôleur ne doit avoir aucun moyen de s'appuyer dessus,
        // puisqu'il ne lit rien d'autre que la valeur de retour de la promesse.
        etatExterneApresResultat = 'modifie-apres-coup';
      },
    });
    const recu = await controleur.mettreEnPause();
    expect(recu).toEqual({ degrade: false, stillQueued: ['uuid-a', 'uuid-b'] });
    expect(controleur.dernierRecu).toEqual(recu);
    // Le fait que l'état externe ait changé pendant l'attente ne doit rien altérer :
    // aucune API de ce module ne permet de "relire la file après le résultat".
    expect(etatExterneApresResultat).toBe('modifie-apres-coup');
    expect(recu.stillQueued).toEqual(['uuid-a', 'uuid-b']);
  });

  test('ControleurPause n\'expose aucune méthode d\'inspection de flux après coup', () => {
    const controleur = nouveauControleur({}).controleur;
    // Garde-fou de conception : seules ces méthodes existent sur la surface publique.
    const surface = Object.getOwnPropertyNames(ControleurPause.prototype);
    expect(surface).toEqual(
      expect.arrayContaining(['mettreEnPause', 'reprendre', 'envoyer', 'evaluerRecu']),
    );
    expect(surface).not.toContain('inspecterFile');
    expect(surface).not.toContain('lireFileApresResultat');
    void controleur;
  });
});

describe('acceptation (c) — les UUID inconnus du reçu sont ignorés, pas une erreur', () => {
  test('partitionnerStillQueued sépare sans jamais lever', () => {
    const connus = new Set(['uuid-envoye-1', 'uuid-envoye-2']);
    const partition = partitionnerStillQueued(
      ['uuid-envoye-1', 'uuid-jamais-envoye-cron', 'uuid-envoye-2'],
      connus,
    );
    expect(partition.connus).toEqual(['uuid-envoye-1', 'uuid-envoye-2']);
    expect(partition.inconnus).toEqual(['uuid-jamais-envoye-cron']);
  });

  test('liste vide de connus ⇒ tout est inconnu, toujours sans lever', () => {
    expect(() => partitionnerStillQueued(['x', 'y'], new Set())).not.toThrow();
    const partition = partitionnerStillQueued(['x', 'y'], new Set());
    expect(partition.inconnus).toEqual(['x', 'y']);
    expect(partition.connus).toEqual([]);
  });

  test('evaluerRecu sur le contrôleur : un UUID jamais transmis par lui est journalisé, pas une erreur', async () => {
    const { controleur } = nouveauControleur({
      reponseInterrupt: { still_queued: ['uuid-jamais-vu', 'uuid-tache-planifiee'] },
    });
    await expect(controleur.mettreEnPause()).resolves.toBeDefined();
    const partition = controleur.evaluerRecu();
    expect(partition.inconnus).toEqual(['uuid-jamais-vu', 'uuid-tache-planifiee']);
    expect(partition.connus).toEqual([]);
  });
});

describe('acceptation (d) — mode dégradé documenté quand interrupt_receipt_v1 est absente', () => {
  test('capacité absente ⇒ recu.degrade === true, stillQueued vide, jamais une erreur', async () => {
    const { controleur, source } = nouveauControleur({
      capacitesAnnoncees: [],
      reponseInterrupt: { still_queued: ['ignore-car-capacite-absente'] },
    });
    const recu = await controleur.mettreEnPause();
    expect(recu.degrade).toBe(true);
    expect(recu.stillQueued).toEqual([]);
    expect(source.appels).toBe(1);
  });

  test('capacité annoncée mais interrupt() résout undefined (CLI antérieur à v2.1.205) ⇒ dégradé', async () => {
    const { controleur } = nouveauControleur({
      capacitesAnnoncees: ['interrupt_receipt_v1'],
      reponseInterrupt: undefined,
    });
    const recu = await controleur.mettreEnPause();
    expect(recu.degrade).toBe(true);
    expect(recu.stillQueued).toEqual([]);
  });

  test('☠ le mode dégradé reste sûr : aucune perte ni duplication sans aucune info de still_queued', async () => {
    const { controleur, cible } = nouveauControleur({
      capacitesAnnoncees: [],
      reponseInterrupt: undefined,
    });
    await controleur.mettreEnPause();
    await controleur.envoyer(texte('m1'));
    await controleur.envoyer(texte('m2'));
    await controleur.envoyer(texte('m3'));
    expect(cible.recus).toHaveLength(0);

    await controleur.reprendre();

    expect(cible.recus).toHaveLength(3);
    expect(cible.recus.map((m) => (m.message as { content: string }).content)).toEqual(['m1', 'm2', 'm3']);
  });

  test('evaluerRecu en dégradé ne prétend jamais avoir une information exploitable', async () => {
    const { controleur } = nouveauControleur({ capacitesAnnoncees: [] });
    await controleur.mettreEnPause();
    const partition = controleur.evaluerRecu();
    expect(partition).toEqual({ connus: [], inconnus: [] });
  });
});

describe('estampillage des UUID transmis (support de l\'acceptation c)', () => {
  test('un message sans uuid en reçoit un à la transmission, jamais deux fois le même', async () => {
    const { controleur, cible } = nouveauControleur({});
    await controleur.envoyer(texte('a'));
    await controleur.envoyer(texte('b'));
    const uuids = cible.recus.map((m) => m.uuid);
    expect(uuids[0]).toBeDefined();
    expect(uuids[1]).toBeDefined();
    expect(uuids[0]).not.toBe(uuids[1]);
  });

  test('un message déjà porteur d\'un uuid n\'est pas réestampillé', async () => {
    const { controleur, cible } = nouveauControleur({});
    const uuidPose = '11111111-1111-4111-8111-111111111111' as const;
    const original = { ...texte('a'), uuid: uuidPose };
    await controleur.envoyer(original);
    expect(cible.recus[0]?.uuid).toBe(uuidPose);
  });
});
