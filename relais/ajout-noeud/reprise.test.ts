// Reprise d'attribution : mêmes identifiants retrouvés, épinglages reportés une fois, archivées gardées ici.
import { expect, test } from 'bun:test';
import { ficheDe } from '../federation/banc-federation.ts';
import { appliquerReprise, planReprise } from './reprise.ts';

const locales = [
  { ...ficheDe('s-1', 'tour', 'Épinglée'), epinglee: true },
  ficheDe('s-2', 'tour', 'Simple'),
  { ...ficheDe('s-3', 'tour', 'Rangée'), archivee: true },
  ficheDe('s-4', 'tour', 'Perdue'),
  { ...ficheDe('p-1', 'portable', 'Autre machine'), epinglee: true },
];
const distantes = [ficheDe('s-1', 'tour', 'Épinglée'), ficheDe('s-2', 'tour', 'Simple')];

test('plan : retrouvées, absentes, archivées, épinglages à reporter (cette machine seulement)', () => {
  const plan = planReprise(locales, distantes, 'tour');
  expect(plan.aEpingler).toEqual(['s-1']);
  expect(plan.bilan).toEqual({ retrouvees: 2, absentes: 1, epinglees: 1, archivees: 1 });
});

test('déjà épinglée sur le nœud : rien à reporter (relance idempotente)', () => {
  const plan = planReprise(locales, [{ ...distantes[0]!, epinglee: true }, distantes[1]!], 'tour');
  expect(plan.aEpingler).toEqual([]);
});

test('application : seuls les gestes réussis comptent', async () => {
  const appels: string[] = [];
  const bilan = await appliquerReprise(planReprise(locales, distantes, 'tour'), async (id) => {
    appels.push(id);
    return false;
  });
  expect(appels).toEqual(['s-1']);
  expect(bilan.epinglees).toBe(0);
});
