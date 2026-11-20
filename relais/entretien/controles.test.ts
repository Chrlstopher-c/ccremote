// Responsabilité : tests des contrôles de machine (phrases, actions, ids) — une règle par cas, sans hôte ni port.
import { describe, expect, test } from 'bun:test';
import { controlesMachine, type Controle, type EntreeControles } from './controles.ts';

const BASE: EntreeControles = {
  locale: false,
  enLigne: true,
  installee: true,
  acces: { etat: 'connecte', detail: null },
  reveilPossible: false,
  aJour: true,
  comptesConnectes: 1,
};

const par = (liste: Controle[], id: string): Controle => {
  const c = liste.find((x) => x.id === id);
  if (!c) throw new Error(`pas de contrôle ${id}`);
  return c;
};

describe('contrôles d’une machine', () => {
  test('quatre contrôles, ids stables, tout va bien', () => {
    const liste = controlesMachine(BASE);
    expect(liste.map((c) => c.id)).toEqual(['liaison', 'poste', 'version', 'compte']);
    expect(liste.every((c) => c.ok && c.action === null)).toBe(true);
  });

  test('liaison : port distant déjà pris → action réparer, phrase sans détail technique', () => {
    const c = par(
      controlesMachine({
        ...BASE,
        acces: { etat: 'injoignable', detail: 'port distant déjà pris — relance dans 4 s' },
      }),
      'liaison',
    );
    expect(c).toEqual({
      id: 'liaison',
      ok: false,
      phrase: 'Le port de la liaison est déjà pris sur la machine.',
      action: 'reparer_liaison',
    });
  });

  test('liaison : autre cause → phrase avec la cause déjà réduite, pas d’action', () => {
    const c = par(controlesMachine({ ...BASE, acces: { etat: 'injoignable', detail: 'délai dépassé' } }), 'liaison');
    expect(c.ok).toBe(false);
    expect(c.phrase).toBe('La liaison ne passe pas : délai dépassé.');
    expect(c.action).toBeNull();
  });

  test('poste hors ligne avec réveil possible → action réveiller ; sans réveil → aucune action', () => {
    const eteint = { ...BASE, enLigne: false };
    expect(par(controlesMachine({ ...eteint, reveilPossible: true }), 'poste')).toMatchObject({
      ok: false,
      action: 'reveiller',
    });
    expect(par(controlesMachine(eteint), 'poste')).toMatchObject({
      ok: false,
      action: null,
      phrase: 'Poste hors ligne.',
    });
  });

  test('version pas à jour → mettre à jour ; non comparée → ok', () => {
    expect(par(controlesMachine({ ...BASE, aJour: false }), 'version')).toMatchObject({
      ok: false,
      action: 'mettre_a_jour',
    });
    expect(par(controlesMachine({ ...BASE, aJour: null }), 'version').ok).toBe(true);
  });

  test('aucun compte connecté sur un poste en ligne → reconnecter ; poste hors ligne → non relevé, ok', () => {
    expect(par(controlesMachine({ ...BASE, comptesConnectes: 0 }), 'compte')).toMatchObject({
      ok: false,
      action: 'reconnecter_compte',
    });
    expect(par(controlesMachine({ ...BASE, enLigne: false, comptesConnectes: 0 }), 'compte').ok).toBe(true);
  });

  test('machine locale : pas de liaison ni de version à comparer, poste local', () => {
    const liste = controlesMachine({ ...BASE, locale: true, acces: null, aJour: null });
    expect(liste.every((c) => c.ok)).toBe(true);
    expect(par(liste, 'poste').phrase).toBe('Poste local.');
  });

  test('poste jamais installé : signalé sans action', () => {
    expect(
      par(
        controlesMachine({ ...BASE, installee: false, acces: { etat: 'non_installe', detail: null }, enLigne: false }),
        'poste',
      ),
    ).toMatchObject({
      ok: false,
      action: null,
    });
  });
});
