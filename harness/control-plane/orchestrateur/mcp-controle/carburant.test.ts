/**
 * `☠` Ce que ces tests protègent : un orchestrateur autonome qui lance une
 * équipe à 95 % de sa fenêtre 5 h. Elle sera coupée en route, et une équipe
 * coupée a coûté tout ce qu'elle a consommé pour rien. La mesure existait déjà —
 * ce qui manquait, c'est qu'elle atteigne la décision.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../../registre/index.ts';
import { carburantParc } from './outils-inspection.ts';

let repertoire: string;
let registre: Registre;
const T = 1_785_000_000_000;

function texte(retour: ReturnType<typeof carburantParc>): string {
  return 'etat' in retour && typeof retour.etat === 'string' ? retour.etat : JSON.stringify(retour);
}

function poserQuota(compteId: string, utilisation: number, options: { overage?: boolean } = {}): void {
  registre.comptes.releverQuota({
    compteId,
    typeFenetre: 'five_hour',
    statut: 'allowed',
    utilisation,
    resetA: T + 2 * 3_600_000,
    utiliseOverage: options.overage ?? false,
    observeA: T,
  });
}

beforeEach(() => {
  repertoire = mkdtempSync(join(tmpdir(), 'carburant-'));
  registre = ouvrirRegistre({ chemin: join(repertoire, 'registre.sqlite') });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/a' });
});

afterEach(() => {
  registre.fermer();
  rmSync(repertoire, { recursive: true, force: true });
});

describe('le conseil suit le carburant', () => {
  test('confortable en dessous des seuils', () => {
    poserQuota('compte-a', 30);
    expect(texte(carburantParc(registre, T))).toContain('CONFORTABLE');
  });

  test('tendu à partir de 75 %', () => {
    poserQuota('compte-a', 80);
    const t = texte(carburantParc(registre, T));
    expect(t).toContain('TENDU');
    // `☠` Le conseil doit être ACTIONNABLE, pas un constat : sans l'alternative
    // formulée, un modèle lit « 80 % » et lance quand même.
    expect(t).toContain('mandat court');
  });

  test('critique à partir de 90 % — et dit d’arrêter de lancer', () => {
    poserQuota('compte-a', 95);
    const t = texte(carburantParc(registre, T));
    expect(t).toContain('CRITIQUE');
    expect(t).toContain('Ne lance plus');
    // La raison, pas seulement l'ordre : un modèle obéit mieux à un pourquoi.
    expect(t).toContain('pour rien');
  });
});

describe('ce qui ne doit jamais être tu', () => {
  test('le surcoût payant est signalé — `rejected` ne coupe pas la session (H-63.1)', () => {
    poserQuota('compte-a', 99, { overage: true });
    // `☠` Taire ce cas ferait dépenser de l'argent réel sans que personne
    // ne le sache : la session continue, mais elle est facturée.
    expect(texte(carburantParc(registre, T))).toContain('SURCOÛT PAYANT');
  });

  test('un compte saturé est annoncé comme écarté', () => {
    registre.comptes.releverQuota({
      compteId: 'compte-a',
      typeFenetre: 'five_hour',
      statut: 'rejected',
      seuilDepasse: 'limite atteinte',
      resetA: T + 3_600_000,
      observeA: T,
    });
    const t = texte(carburantParc(registre, T));
    expect(t).toContain('ÉCARTÉ');
    expect(t).toContain('AUCUN compte disponible');
    // Sans issue formulée, le modèle réessaie en boucle sur un compte mort.
    expect(t).toContain('Attends le reset');
  });

  test('une utilisation non mesurée ne se lit pas comme 0 %', () => {
    // `☠` H-70 : sur abonnement les champs dollars sont `null`. Traiter
    // « non mesuré » comme « 0 % » ferait afficher plein régime sur une
    // fenêtre peut-être saturée — l'exact inverse d'un garde-fou.
    const t = texte(carburantParc(registre, T));
    expect(t).toContain('non mesuré');
  });
});

describe('le pire compte commande', () => {
  test('un second compte sain ne masque pas celui qui sature', () => {
    registre.comptes.enregistrer({ id: 'compte-b', configDir: '/tmp/b' });
    poserQuota('compte-a', 20);
    poserQuota('compte-b', 96);
    // Le conseil se cale sur le plus contraint des comptes DISPONIBLES : c'est
    // celui-là qui décidera du sort d'une équipe lancée maintenant.
    expect(texte(carburantParc(registre, T))).toContain('CRITIQUE');
  });
});
