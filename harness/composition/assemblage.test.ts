/**
 * Test d'assemblage — H-74 / M-53 (prolongement).
 *
 * `☠` Un test unitaire ne peut pas fermer ce défaut : par construction, il
 * injecte la dépendance qu'il teste. Chaque bloc ci-dessous construit LE
 * PRODUIT tel qu'il tourne réellement (via `composition/assembler-*.ts`,
 * jamais une doublure du garde-fou sous test lui-même) et prouve, par un
 * comportement observable, que le garde-fou est effectivement atteint depuis
 * l'assemblage — pas seulement présent quelque part dans le dépôt.
 *
 * Ce que ce fichier NE couvre PAS (voir rapport de mission) :
 *  - aucune session Claude Code réelle, aucun worker réel (interdit par le mandat) ;
 *  - le canal de contrôle réseau (D.3) réel — testé sans ouvrir de vrai socket
 *    (WS mocké au niveau du port `PortSuperviseurControle`, jamais au niveau du
 *    garde-fou métier lui-même) ;
 *  - le juge anti-boucle réel (`creerJugeHaiku`) n'est vérifié que dans sa
 *    FORME (port valide) — son verdict réel exige un vrai appel SDK, hors mandat.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre } from '../control-plane/registre/index.ts';
import { proposerCreationEquipe } from '../control-plane/orchestrateur/mcp-controle/outils-cycle-vie.ts';
import { CanalControle, PersistanceRegistreSqlite, SuperviseurWorkers } from '../superviseur/index.ts';
import { CompteurRelances } from '../relance/compteur-relances.ts';
import { creerJugeHaiku } from '../anti-boucle/index.ts';
import { creerLecteurUtilisationParc } from './pi/port-utilisation-parc.ts';
import { construireWorkerSpec } from './pc/construire-worker-spec.ts';
import { assemblerSuperviseurPc } from './pc/assembler-superviseur.ts';
import { demarrerServeurLienPc } from './pi/serveur-lien-pc.ts';
import { demarrerServeurApiWeb } from '../control-plane/api-web/index.ts';
import { entetesMachine } from './lien-pc-pi/identite-machine.ts';
import { entetesAuth } from './lien-pc-pi/secret.ts';

function dossierTemporaire(prefixe: string): string {
  return mkdtempSync(join(tmpdir(), prefixe));
}

describe('assemblage — plafond de parc (G.1.3, H-74 occurrence n°2)', () => {
  test('proposerCreationEquipe REFUSE quand le vrai registre porte un compte au-dessus du seuil', async () => {
    const registre = ouvrirRegistre({ chemin: ':memory:' });
    registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/x' });
    registre.comptes.releverQuota({ compteId: 'compte-a', typeFenetre: 'five_hour', statut: 'allowed', utilisation: 95 });

    const lecteur = creerLecteurUtilisationParc(registre);
    const retour = await proposerCreationEquipe('projet-x', 'objectif', null, 'perimetre', 'ecriture', lecteur, { seuilUtilisationPct: 90 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });

    expect(retour.effet).toBe('refuse');
    expect(retour.raison).toContain('90');
  });

  test('proposerCreationEquipe AUTORISE quand tous les comptes réels sont sous le seuil', async () => {
    const registre = ouvrirRegistre({ chemin: ':memory:' });
    registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/x' });
    registre.comptes.releverQuota({ compteId: 'compte-a', typeFenetre: 'five_hour', statut: 'allowed', utilisation: 10 });

    const lecteur = creerLecteurUtilisationParc(registre);
    const retour = await proposerCreationEquipe('projet-x', 'objectif', null, 'perimetre', 'ecriture', lecteur, { seuilUtilisationPct: 90 }, { enregistrer: async () => ({ ref: 'prop-test', autoApprouve: false, detail: 'en attente' }) });

    expect(retour.effet).toBe('differe');
  });
});

describe('assemblage — persistance et restauration du registre PC (dette n°1, H-74)', () => {
  test("un worker écrit par une instance précédente survit à un redémarrage du superviseur (composition réelle)", () => {
    const cheminRegistrePersistance = join(dossierTemporaire('ccremote-assemblage-'), 'registre-pc.sqlite');
    // H-75 : le PC dial-out vers le Pi, plus de port d'écoute local à réserver.
    // Aucune vraie connexion n'est requise par ce test (seule la restauration
    // du registre est exercée) — port injoignable volontaire, `arreter()` coupe
    // toute tentative de reconnexion avant qu'elle n'aboutisse.
    const urlPi = 'ws://127.0.0.1:1';
    const secretLienPi = 'secret-test';

    // « Instance précédente » : démarre, puis s'arrête (le process meurt sans se désenregistrer).
    const premiere = assemblerSuperviseurPc({ cheminRegistrePersistance, urlPi, secretLienPi, machineId: 'banc-assemblage' });
    premiere.arreter();

    // Simule un enregistrement laissé vivant par le process précédent, disparu du process courant.
    const persistance = new PersistanceRegistreSqlite({ chemin: cheminRegistrePersistance });
    persistance.sauvegarder({
      sessionId: 'session-fantome',
      missionId: 'mission-fantome',
      worktree: '/tmp/worktree-fantome',
      epoch: 1,
      pid: 999_999_999,
      pidStarttime: null,
      vivant: true,
      spec: {
        sessionId: 'session-fantome', cwd: '/tmp/worktree-fantome', mandate: '',
        deniedToolPatterns: [], maxBudgetUsd: 1, mcpServers: {}, portAuditPermissions: () => ({}),
      },
    });
    persistance.fermer();

    // « Nouvelle instance » : SANS ce câblage de composition (avant cette mission), ce
    // fantôme aurait été invisible — le registre en mémoire serait reparti vide.
    const deuxieme = assemblerSuperviseurPc({ cheminRegistrePersistance, urlPi, secretLienPi, machineId: 'banc-assemblage' });
    try {
      const inventaire = deuxieme.superviseur.inventaire();
      expect(inventaire.some((w) => w.sessionId === 'session-fantome' && w.vivant)).toBe(true);
    } finally {
      deuxieme.arreter();
    }
  });
});

describe("assemblage — arrêt d'urgence via le canal de contrôle réel (D.3, G.4)", () => {
  test("arret_urgence traverse réellement CanalControle → SuperviseurWorkers.arretUrgence()", async () => {
    const cheminRegistrePersistance = join(dossierTemporaire('ccremote-assemblage-'), 'registre-au.sqlite');
    const superviseur = new SuperviseurWorkers({ compteurRelances: new CompteurRelances() });
    const canal = new CanalControle(superviseur);

    const reponse = await canal.traiter({ opId: 'op-au-1', operation: { type: 'arret_urgence' } });

    expect(reponse.ok).toBe(true);
    expect(reponse.rapportArretUrgence).toBeDefined();
    // Absence de workers vivants ⇒ liste vide, mais le CHEMIN a été réellement
    // exécuté — pas une branche « non câblé » qui rendrait un rapport de complaisance.
    // (`ports-non-cables.ts` a disparu le 02/08 : ses deux ports fantômes sont câblés.)
    expect(reponse.rapportArretUrgence?.missions).toEqual([]);
    void cheminRegistrePersistance;
  });
});

describe('assemblage — juge anti-boucle (H-68) : forme du port réellement fournie', () => {
  test('creerJugeHaiku() produit un JugeBoucle réel (pas une doublure), utilisable par assemblerSuperviseurPc', () => {
    const juge = creerJugeHaiku();
    expect(typeof juge.juger).toBe('function');
    // `assemblerSuperviseurPc` (composition/pc/assembler-superviseur.ts) passe CE
    // port à `SuperviseurWorkers` — vérifié par lecture de code (première mention
    // en production du port, TODO.md). Le VERDICT réel du juge (appel Haiku)
    // exige un vrai réseau : hors mandat de ce test, voir le rapport de mission.
  });
});

describe('assemblage — l’interface sait que le PC est éteint (H-75)', () => {
  /**
   * `☠` Le défaut que ce bloc ferme : `pcOnline` branché sur un drapeau tenu à
   * la main plutôt que sur le lien réel. Ce serait invisible en test unitaire
   * (le drapeau y est injecté) et se manifesterait comme une interface affirmant
   * « PC en ligne » toute la nuit, avec des données figées présentées comme
   * fraîches — pire qu'une erreur, parce qu'on la croit.
   *
   * On assemble ici les DEUX serveurs exactement comme `assembler-control-plane.ts`
   * les assemble, et on fait varier la seule chose qui doit compter : la présence
   * d'un vrai client connecté.
   */
  test('pcOnline suit l’état RÉEL du lien, pas un drapeau — vérifié en connectant un vrai client', async () => {
    const registre = ouvrirRegistre({ chemin: ':memory:' });
    const secret = 'secret-assemblage-suffisamment-long';

    const serveurLien = demarrerServeurLienPc({ port: 0, hostname: '127.0.0.1', secret });
    // Exactement l'expression de `assembler-control-plane.ts` — si elle change
    // là-bas sans changer ici, ce test cesse de prouver quoi que ce soit :
    // c'est pourquoi il construit les deux serveurs plutôt que d'en simuler un.
    // `☠ V2` — « au moins une machine en ligne », la sémantique qu'a désormais
    // `pcOnline` : un lien nommé ne dit plus rien à lui seul.
    const api = demarrerServeurApiWeb({
      port: 0,
      registre,
      pcEnLigne: () => serveurLien.machinesEnLigne().length > 0,
      machines: () => serveurLien.machines().map((m) => ({ id: m.machineId, enLigne: m.enLigne, supersedes: m.supersedes })),
    });

    const etat = async (): Promise<boolean> => {
      const rep = await fetch(`http://127.0.0.1:${api.port}/api/harness/health`);
      return ((await rep.json()) as { pcOnline: boolean }).pcOnline;
    };

    expect(await etat()).toBe(false); // PC éteint : le régime nominal de la nuit

    const pc = new WebSocket(`ws://127.0.0.1:${serveurLien.port}/`, {
      headers: { ...entetesAuth(secret), ...entetesMachine('banc-assemblage') },
    } as never);
    await new Promise<void>((r) => pc.addEventListener('open', () => r()));
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(await etat()).toBe(true); // le PC est revenu, sans qu'on ait rien déclaré

    pc.close();
    api.arreter();
    serveurLien.arreter();
    registre.fermer();
  });
});
