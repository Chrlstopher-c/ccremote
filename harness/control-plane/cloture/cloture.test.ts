/**
 * `☠` Ces tests gardent les deux bords d'un même arbitrage : clore une équipe au
 * repos libère son projet (le défaut du 01/08), mais clore la mauvaise tue un
 * travail vivant. Le second risque est le plus cher — d'où le nombre de cas de
 * NON-clôture ci-dessous.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type EtatSdk, type Mission, type Registre } from '../registre/index.ts';
import type { ArreteurMission } from '../orchestrateur/mcp-controle/types.ts';
import { DELAI_CLOTURE_IDLE_MS, missionsAClore } from './politique-cloture.ts';
import { ServiceCloture } from './service-cloture.ts';

const T = 1_785_000_000_000;

class ArreteurFactice implements ArreteurMission {
  public readonly arretes: string[] = [];
  public echoue = false;
  async arreter(missionId: string): Promise<void> {
    if (this.echoue) throw new Error('PC injoignable');
    this.arretes.push(missionId);
  }
}

let repertoire: string;
let registre: Registre;

/** Sème une mission dispatchée, dans l'état SDK demandé, datée. */
function semer(id: string, etatSdk: EtatSdk | null, sdkMajA: number | null): Mission {
  registre.lots.creer({ id: `lot-${id}`, intention: 'objectif' });
  registre.missions.creer(
    { id, lotId: `lot-${id}`, nom: `équipe ${id}`, projet: `/mnt/projects/${id}`, compteId: 'compte-a' },
    T - 3_600_000,
  );
  registre.etats.appliquerEtatHarness(id, 'en_cours', { maintenant: T - 3_600_000 });
  if (etatSdk !== null && sdkMajA !== null) {
    registre.etats.appliquerEtatSdk(id, etatSdk, sdkMajA);
  }
  return registre.missions.exiger(id);
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'cloture-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/cc-a' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('ce qui doit être clos', () => {
  test('une équipe idle depuis plus que le délai est close', () => {
    const m = semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    expect(missionsAClore([m], T)).toHaveLength(1);
  });

  test('pile au délai, elle est close — la borne est inclusive', () => {
    const m = semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS);
    expect(missionsAClore([m], T)).toHaveLength(1);
  });
});

describe('ce qui ne doit SURTOUT pas être clos', () => {
  test('une équipe qui travaille (running) n’est jamais close, même très ancienne', () => {
    const m = semer('a', 'running', T - 12 * 3_600_000);
    // Un lead peut travailler des heures sans rendre la main : c'est le régime
    // normal d'un mandat long, pas un symptôme.
    expect(missionsAClore([m], T)).toHaveLength(0);
  });

  test('une équipe BLOQUÉE sur une autorisation n’est jamais close', () => {
    const m = semer('a', 'requires_action', T - 12 * 3_600_000);
    // `☠` Le cas le plus cher : elle n'attend qu'un clic de Chris. La clore
    // reviendrait à tuer un travail vivant faute d'avoir été regardé à temps.
    expect(missionsAClore([m], T)).toHaveLength(0);
  });

  test('une équipe idle depuis moins que le délai est laissée tranquille', () => {
    const m = semer('a', 'idle', T - 60_000);
    // C'est la fenêtre de réinjection : `envoyer_message_equipe` a besoin d'un
    // worker vivant, et l'orchestrateur vient à peine d'être notifié.
    expect(missionsAClore([m], T)).toHaveLength(0);
  });

  test('sans repère de transition SDK, on ne clôt pas', () => {
    const m = semer('a', null, null);
    // On ne sait pas depuis quand : décider sur une durée inconnue, c'est
    // décider au hasard.
    expect(missionsAClore([m], T)).toHaveLength(0);
  });

  test('une mission déjà terminée n’est pas reprise', () => {
    semer('a', 'idle', T - 3_600_000);
    registre.etats.appliquerEtatHarness('a', 'terminee', { maintenant: T - 1000 });
    expect(missionsAClore(registre.missions.listerActives(), T)).toHaveLength(0);
  });

  test('une mission en pause n’est pas close par ce chemin', () => {
    semer('a', 'idle', T - 3_600_000);
    registre.etats.appliquerEtatHarness('a', 'en_pause', { maintenant: T - 1000 });
    // La pause est une décision explicite ; la respecter est tout l'objet du champ.
    expect(missionsAClore(registre.missions.listerActives(), T)).toHaveLength(0);
  });
});

describe('effets de la clôture — ce que Chris et H-56 constatent', () => {
  test('le projet est LIBÉRÉ : c’est le défaut du 01/08 qui est corrigé', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    const projet = registre.missions.exiger('a').projet;
    expect(registre.missions.lireActiveDuProjet(projet)).not.toBeNull();

    const arreteur = new ArreteurFactice();
    expect(await new ServiceCloture(registre, arreteur).passer(T)).toBe(1);

    // `☠` LA vérification qui compte : sans elle, on prouverait qu'un champ a
    // changé sans prouver qu'un nouveau dispatch est possible.
    expect(registre.missions.lireActiveDuProjet(projet)).toBeNull();
  });

  test('l’état est « terminee », pas « annulee » — le lead avait fini son travail', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    await new ServiceCloture(registre, new ArreteurFactice()).passer(T);
    expect(registre.missions.exiger('a').etatHarness).toBe('terminee');
  });

  test('la session est CONSERVÉE : la clôture ne perd pas le contexte', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    registre.missions.attacherSession('a', 'session-sdk-42');
    await new ServiceCloture(registre, new ArreteurFactice()).passer(T);
    // `☠` C'est ce qui rend le délai court acceptable : `relancer_equipe` exige
    // un `sessionId` non nul. S'il disparaissait, clore serait irréversible et
    // 15 min deviendraient un pari.
    expect(registre.missions.exiger('a').sessionId).toBe('session-sdk-42');
  });

  test('le fil de la mission explique la clôture et rend le geste de reprise', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    await new ServiceCloture(registre, new ArreteurFactice()).passer(T);
    const dernier = registre.missions.activites('a').at(-1);
    expect(dernier?.texte).toContain('relancer_equipe');
    expect(dernier?.texte).toContain('projet est libéré');
  });

  test('le worker est libéré côté PC', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    const arreteur = new ArreteurFactice();
    await new ServiceCloture(registre, arreteur).passer(T);
    expect(arreteur.arretes).toEqual(['a']);
  });

  test('un PC injoignable libère quand même le projet', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    const projet = registre.missions.exiger('a').projet;
    const arreteur = new ArreteurFactice();
    arreteur.echoue = true;
    // `☠` L'état harness fait autorité (E.1.1). Si l'échec de l'arrêteur
    // annulait la clôture, un PC éteint rendrait le verrou H-56 définitif —
    // exactement le cas où personne ne peut plus le lever à la main.
    await new ServiceCloture(registre, arreteur).passer(T);
    expect(registre.missions.lireActiveDuProjet(projet)).toBeNull();
  });

  test('une clôture en échec n’empêche pas les autres', async () => {
    semer('a', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    semer('b', 'idle', T - DELAI_CLOTURE_IDLE_MS - 1000);
    const arreteur = new ArreteurFactice();
    arreteur.echoue = true;
    await new ServiceCloture(registre, arreteur).passer(T);
    expect(registre.missions.exiger('a').etatHarness).toBe('terminee');
    expect(registre.missions.exiger('b').etatHarness).toBe('terminee');
  });

  test('rien à clore : aucun effet, aucun appel', async () => {
    semer('a', 'running', T - 60_000);
    const arreteur = new ArreteurFactice();
    expect(await new ServiceCloture(registre, arreteur).passer(T)).toBe(0);
    expect(arreteur.arretes).toHaveLength(0);
  });
});
