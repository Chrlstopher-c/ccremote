/**
 * `☠` Un rappel est la seule chose de ce harness qui consomme du quota sans que
 * personne ne l'ait demandé sur le moment : il réveille une session Opus, seul,
 * en boucle, potentiellement pendant des jours. Chaque test ci-dessous garde une
 * borne dont l'absence se paierait en quota brûlé pendant la nuit.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { ServiceRappels, type PortReveilFil } from './service-rappels.ts';
import { PERIODE_MIN_MS, RAPPELS_ACTIFS_MAX, REPORT_MS, validerRappel } from './politique-rappels.ts';

let repertoire: string;
let registre: Registre;
const T = 1_785_000_000_000;

class ReveilFactice implements PortReveilFil {
  public readonly recus: { conversationId: string; texte: string }[] = [];
  public echoue: string | null = null;
  async remettre(conversationId: string, texte: string): Promise<void> {
    if (this.echoue !== null) throw new Error(this.echoue);
    this.recus.push({ conversationId, texte });
  }
}

function poser(conversationId: string, prochaineA: number, periodeMs: number | null = 10 * 60_000): string {
  const id = `r-${Math.random().toString(36).slice(2, 9)}`;
  registre.rappels.creer(
    { id, conversationId, libelle: 'veille', consigne: 'résume les nouveautés', prochaineA, periodeMs },
    T,
  );
  return id;
}

function service(reveil: ReveilFactice, util: number | null = 20, aucun = false): ServiceRappels {
  return new ServiceRappels(registre, reveil, () => ({
    pireUtilisation: util,
    aucunCompteDisponible: aucun,
  }));
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'rappels-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('bornes à la création — ce qui protège le quota', () => {
  test('une période sous le minimum est refusée, avec la borne nommée', () => {
    const v = validerRappel({ libelle: 'x', consigne: 'y', periodeMinutes: 1 }, 0, T);
    expect(v.ok).toBe(false);
    // `☠` Le refus est lu par un MODÈLE : sans la valeur acceptable, il
    // réessaie la même au tour suivant. Mesuré sur ce dépôt avec les modèles.
    if (!v.ok) expect(v.raison).toContain(`minimum ${PERIODE_MIN_MS / 60_000} min`);
  });

  test('le plafond de rappels actifs par conversation est appliqué', () => {
    const v = validerRappel({ libelle: 'x', consigne: 'y', periodeMinutes: 10 }, RAPPELS_ACTIFS_MAX, T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.raison).toContain('annuler_rappel');
  });

  test('une consigne vide est refusée : elle serait injectée telle quelle', () => {
    const v = validerRappel({ libelle: 'x', consigne: '   ', periodeMinutes: 10 }, 0, T);
    expect(v.ok).toBe(false);
  });

  test('un premier tir immédiat est refusé — un rappel n’est pas un message', () => {
    const v = validerRappel({ libelle: 'x', consigne: 'y', periodeMinutes: 10, premierTirDansMinutes: 0.1 }, 0, T);
    expect(v.ok).toBe(false);
  });

  test('un rappel valide rend une échéance ABSOLUE', () => {
    const v = validerRappel({ libelle: 'x', consigne: 'y', periodeMinutes: 10 }, 0, T);
    expect(v.ok).toBe(true);
    // Un délai relatif repartirait de zéro à chaque redémarrage du Pi.
    if (v.ok) expect(v.prochaineA).toBe(T + 10 * 60_000);
  });
});

describe('isolation par conversation', () => {
  test('un fil ne voit que SES rappels', () => {
    poser('conv-a', T + 1000);
    poser('conv-b', T + 1000);
    expect(registre.rappels.duFil('conv-a')).toHaveLength(1);
  });

  test('on ne peut pas mettre en pause le rappel d’un autre fil, même avec son id', () => {
    const id = poser('conv-a', T + 1000);
    // `☠` L'isolation est dans le WHERE, pas dans une vérification préalable
    // qu'on pourrait oublier d'appeler sur un nouveau chemin.
    expect(registre.rappels.mettreEnPause(id, 'conv-b')).toBe(false);
    expect(registre.rappels.lire(id)?.etat).toBe('actif');
  });

  test('ni le supprimer', () => {
    const id = poser('conv-a', T + 1000);
    expect(registre.rappels.supprimer(id, 'conv-b')).toBe(false);
    expect(registre.rappels.lire(id)).not.toBeNull();
  });

  test('plusieurs rappels indépendants sur un même fil', () => {
    poser('conv-a', T + 1000);
    poser('conv-a', T + 2000);
    const id3 = poser('conv-a', T + 3000);
    registre.rappels.mettreEnPause(id3, 'conv-a');
    expect(registre.rappels.compterActifs('conv-a')).toBe(2);
    expect(registre.rappels.duFil('conv-a')).toHaveLength(3);
  });
});

describe('pause, reprise, modification, suppression', () => {
  test('la pause conserve consigne, cadence et compteur', () => {
    const id = poser('conv-a', T + 1000);
    registre.rappels.mettreEnPause(id, 'conv-a');
    const r = registre.rappels.lire(id);
    expect(r?.etat).toBe('en_pause');
    expect(r?.consigne).toBe('résume les nouveautés');
    expect(r?.periodeMs).toBe(10 * 60_000);
  });

  test('un rappel en pause ne tire pas', async () => {
    const id = poser('conv-a', T - 1000);
    registre.rappels.mettreEnPause(id, 'conv-a');
    const reveil = new ReveilFactice();
    expect(await service(reveil).passer(T)).toBe(0);
  });

  test('la reprise repart de MAINTENANT, sans rattraper les tirs manqués', () => {
    const id = poser('conv-a', T - 5 * 3_600_000);
    registre.rappels.mettreEnPause(id, 'conv-a');
    registre.rappels.reprendre(id, 'conv-a', T);
    // `☠` Sans recalcul, un rappel repris après des heures a une échéance
    // largement dépassée : il tirerait à chaque passage du balayage.
    expect(registre.rappels.lire(id)?.prochaineA).toBe(T + 10 * 60_000);
  });

  test('un rappel TERMINÉ ne se reprend jamais', () => {
    const id = poser('conv-a', T - 1000, null); // one-shot
    registre.rappels.marquerDeclenche(id, T);
    expect(registre.rappels.lire(id)?.etat).toBe('termine');
    // `☠` Toute la raison d'être de l'énuméré : avec un booléen `actif`,
    // reprendre ressusciterait un one-shot déjà tiré.
    expect(registre.rappels.reprendre(id, 'conv-a', T)).toBe(false);
  });

  test('modifier ne relance pas le cycle ni le compteur', () => {
    const id = poser('conv-a', T + 60_000);
    registre.rappels.marquerDeclenche(id, T);
    const avant = registre.rappels.lire(id);
    registre.rappels.modifier(id, 'conv-a', { consigne: 'nouvelle consigne' });
    const apres = registre.rappels.lire(id);
    expect(apres?.consigne).toBe('nouvelle consigne');
    expect(apres?.declenchements).toBe(avant?.declenchements);
    expect(apres?.prochaineA).toBe(avant?.prochaineA);
  });

  test('supprimer efface réellement', () => {
    const id = poser('conv-a', T + 1000);
    expect(registre.rappels.supprimer(id, 'conv-a')).toBe(true);
    expect(registre.rappels.lire(id)).toBeNull();
  });
});

describe('déclenchement', () => {
  test('un rappel échu tire et réinjecte sa consigne', async () => {
    poser('conv-a', T - 1000);
    const reveil = new ReveilFactice();
    expect(await service(reveil).passer(T)).toBe(1);
    expect(reveil.recus[0]?.conversationId).toBe('conv-a');
    expect(reveil.recus[0]?.texte).toContain('résume les nouveautés');
  });

  test('le texte s’annonce comme venant du harness, pas de Chris', async () => {
    poser('conv-a', T - 1000);
    const reveil = new ReveilFactice();
    await service(reveil).passer(T);
    expect(reveil.recus[0]?.texte).toContain('[RAPPEL PROGRAMMÉ');
    expect(reveil.recus[0]?.texte).toContain("Chris ne t'a rien demandé");
  });

  test('la prochaine échéance part de MAINTENANT — pas de rattrapage en rafale', () => {
    const id = poser('conv-a', T - 3_600_000);
    registre.rappels.marquerDeclenche(id, T);
    // `☠` Un `prochaine_a += periode` aurait six échéances en retard après une
    // heure de coupure du Pi, et tirerait six fois d'affilée.
    expect(registre.rappels.lire(id)?.prochaineA).toBe(T + 10 * 60_000);
  });

  test('un one-shot se termine après son tir', () => {
    const id = poser('conv-a', T - 1000, null);
    registre.rappels.marquerDeclenche(id, T);
    expect(registre.rappels.lire(id)?.etat).toBe('termine');
  });

  test('le plafond de tirs termine le rappel', () => {
    const id = `r-max`;
    registre.rappels.creer(
      { id, conversationId: 'conv-a', libelle: 'x', consigne: 'y', prochaineA: T, periodeMs: 600_000, maxDeclenchements: 2 },
      T,
    );
    registre.rappels.marquerDeclenche(id, T);
    expect(registre.rappels.lire(id)?.etat).toBe('actif');
    registre.rappels.marquerDeclenche(id, T);
    expect(registre.rappels.lire(id)?.etat).toBe('termine');
  });
});

describe('le carburant commande — LA borne de la nuit', () => {
  test('carburant tendu : le tir est REPORTÉ, pas perdu ni retenté en boucle', async () => {
    const id = poser('conv-a', T - 1000);
    const reveil = new ReveilFactice();
    expect(await service(reveil, 85).passer(T)).toBe(0);
    expect(reveil.recus).toHaveLength(0);
    // `☠` Sans le report, chaque passage du balayage retrouverait le même
    // rappel échu : une tempête de tentatives sur un parc déjà saturé.
    const r = registre.rappels.lire(id);
    expect(r?.prochaineA).toBe(T + REPORT_MS);
    expect(r?.declenchements).toBe(0);
    expect(r?.derniereErreur).toContain('carburant');
  });

  test('tous les comptes saturés : reporté aussi', async () => {
    poser('conv-a', T - 1000);
    const reveil = new ReveilFactice();
    expect(await service(reveil, null, true).passer(T)).toBe(0);
  });

  test('un réveil qui échoue reporte sans compter le tir', async () => {
    const id = poser('conv-a', T - 1000);
    const reveil = new ReveilFactice();
    reveil.echoue = 'fil mort';
    expect(await service(reveil).passer(T)).toBe(0);
    const r = registre.rappels.lire(id);
    expect(r?.declenchements).toBe(0);
    expect(r?.prochaineA).toBe(T + REPORT_MS);
  });

  test('un rappel dont l’échéance est future ne tire pas', async () => {
    poser('conv-a', T + 600_000);
    const reveil = new ReveilFactice();
    expect(await service(reveil).passer(T)).toBe(0);
  });
});
