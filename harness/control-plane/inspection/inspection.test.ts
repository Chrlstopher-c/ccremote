/**
 * `☠` Le bouton « Lancer une inspection » a passé des mois branché sur rien : il
 * appelait une maquette qui tirait son verdict avec `Math.random()` sur des
 * données de démonstration. Rien n'échouait — il ne se passait simplement rien.
 *
 * Ces tests portent donc sur ce qui distingue une inspection RÉELLE : le verdict
 * survit à un rafraîchissement, il ne coupe jamais tout seul, et « j'ai vu et je
 * poursuis » s'écrit autrement que « je n'ai pas regardé ».
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { attendArbitrage, decisionInitiale, libelleInspection, verdictArbitrable } from './etat-inspection.ts';
import { ErreurInspection, ServiceInspection } from './service-inspection.ts';

let registre: Registre;
let arrets: string[] = [];

function service(verdict: string, motif = 'motif du juge'): ServiceInspection {
  return new ServiceInspection(
    registre,
    { inspecter: async () => ({ verdict, motif }) },
    { arreter: async (id) => { arrets.push(id); } },
  );
}

beforeEach(() => {
  arrets = [];
  registre = ouvrirRegistre({ chemin: ':memory:' });
  registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/cc-a' });
  registre.lots.creer({ id: 'lot-1', intention: 'inspection' });
  registre.missions.creer({ id: 'm-1', lotId: 'lot-1', nom: 'équipe', projet: '/p/1', compteId: 'compte-a' });
});

afterEach(() => registre.fermer());

describe('cycle de vie d’un verdict', () => {
  test('seul « boucle » ouvre une décision', () => {
    expect(decisionInitiale('boucle')).toBe('en_attente');
    expect(decisionInitiale('progres')).toBeNull();
    expect(decisionInitiale('incertain')).toBeNull();
  });

  test('☠ « j’ai vu et je poursuis » ne se lit pas comme « je n’ai pas regardé »', () => {
    expect(libelleInspection({ verdict: 'boucle', motif: null, a: 1, decision: 'en_attente' })).toContain('décision attendue');
    expect(libelleInspection({ verdict: 'boucle', motif: null, a: 1, decision: 'decline' })).toContain('poursuite assumée');
    expect(libelleInspection({ verdict: 'boucle', motif: null, a: 1, decision: 'confirme' })).toContain('arrêtée');
  });

  test('rien à arbitrer sur un verdict qui n’est pas une boucle', () => {
    expect(verdictArbitrable({ verdict: 'progres', motif: null, a: 1, decision: null }).ok).toBe(false);
    expect(verdictArbitrable({ verdict: null, motif: null, a: null, decision: null }).ok).toBe(false);
  });

  test('☠ une inspection déjà tranchée ne se retranche pas', () => {
    // Sinon un second clic arrêterait une équipe qu'on venait de décider de
    // laisser tourner.
    const v = verdictArbitrable({ verdict: 'boucle', motif: null, a: 1, decision: 'decline' });
    expect(v.ok).toBe(false);
    expect(v.raison).toContain('déjà');
  });
});

describe('ServiceInspection — lancer', () => {
  test('le verdict est PERSISTÉ, donc survit à un rafraîchissement', async () => {
    await service('progres').inspecter('m-1');
    // Relu depuis la base, pas depuis la valeur rendue : c'est tout l'objet.
    expect(registre.missions.exiger('m-1').inspection.verdict).toBe('progres');
  });

  test('☠ un verdict « boucle » n’arrête RIEN — il ouvre une décision', async () => {
    const etat = await service('boucle').inspecter('m-1');
    expect(arrets).toEqual([]);
    expect(etat.decision).toBe('en_attente');
    expect(attendArbitrage(etat)).toBe(true);
  });

  test('☠ un verdict inconnu est refusé AVANT d’atteindre la base', async () => {
    // Le verdict vient d'un modèle : entrée non fiable. Écrit tel quel, il
    // rendrait l'état illisible — et `attendArbitrage` ne le verrait pas comme
    // une boucle, donc personne ne serait prévenu.
    await expect(service('peut-être').inspecter('m-1')).rejects.toThrow(ErreurInspection);
    expect(registre.missions.exiger('m-1').inspection.verdict).toBeNull();
  });

  test('une équipe inconnue est refusée proprement', async () => {
    await expect(service('progres').inspecter('m-inconnue')).rejects.toThrow(ErreurInspection);
  });
});

describe('ServiceInspection — arbitrer', () => {
  test('confirmer arrête l’équipe et l’écrit', async () => {
    const s = service('boucle');
    await s.inspecter('m-1');
    const etat = await s.trancher('m-1', 'confirme');
    expect(arrets).toEqual(['m-1']);
    expect(etat.decision).toBe('confirme');
  });

  test('☠ décliner laisse tourner l’équipe — et l’écrit quand même', async () => {
    const s = service('boucle');
    await s.inspecter('m-1');
    const etat = await s.trancher('m-1', 'decline');
    expect(arrets).toEqual([]);
    expect(etat.decision).toBe('decline');
    // Le verdict reste : c'est la trace de ce qu'on savait en décidant.
    expect(etat.verdict).toBe('boucle');
  });

  test('☠ un arrêt qui échoue n’écrit PAS « confirme »', async () => {
    // Sinon l'écran afficherait une équipe arrêtée qui travaille encore.
    const s = new ServiceInspection(
      registre,
      { inspecter: async () => ({ verdict: 'boucle', motif: 'x' }) },
      { arreter: async () => { throw new Error('PC injoignable'); } },
    );
    await s.inspecter('m-1');
    await expect(s.trancher('m-1', 'confirme')).rejects.toThrow('PC injoignable');
    expect(registre.missions.exiger('m-1').inspection.decision).toBe('en_attente');
  });

  test('arbitrer sans inspection préalable est refusé', async () => {
    await expect(service('progres').trancher('m-1', 'confirme')).rejects.toThrow(ErreurInspection);
  });

  test('☠ arbitrer deux fois est refusé, et n’arrête rien la seconde fois', async () => {
    const s = service('boucle');
    await s.inspecter('m-1');
    await s.trancher('m-1', 'decline');
    await expect(s.trancher('m-1', 'confirme')).rejects.toThrow(ErreurInspection);
    expect(arrets).toEqual([]);
  });
});

describe('quand le juge est injoignable', () => {
  test('☠ c’est une erreur MÉTIER, pas une panne du control plane', async () => {
    // Mesuré en prod le 01/08 : le PC ne répondait pas dans les 10 s du
    // corrélateur, et la route rendait « erreur interne du control plane ».
    // L'opérateur ne savait ni ce qui s'était passé, ni s'il pouvait réessayer.
    const s = new ServiceInspection(
      registre,
      { inspecter: async () => { throw new Error('aucune réponse corrélée reçue dans le délai imparti'); } },
      { arreter: async () => {} },
    );
    const promesse = s.inspecter('m-1');
    await expect(promesse).rejects.toThrow(ErreurInspection);
    await expect(promesse).rejects.toThrow('délai imparti');
    // Et surtout : rien n'est écrit. Un verdict fabriqué sur une panne de lien
    // ferait laisser tourner l'équipe précisément quand on doutait d'elle.
    expect(registre.missions.exiger('m-1').inspection.verdict).toBeNull();
  });
});
