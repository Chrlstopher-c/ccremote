// Instantané au-delà d'une trame : toutes les sessions d'un nœud passent, en pages qui tiennent ; la tête (les 150
// plus récentes) arrive la dernière ; le récepteur remplace sa liste d'un coup, ou garde la tête si un lot manque.
import { describe, expect, test } from 'bun:test';
import { type MessageChiffre, NOMBRE_MAX_SESSIONS_FEDEREES, TAILLE_MAX_CLAIR_OCTETS } from '../../commun/federation.ts';
import type { ResumeSession } from '../../commun/session.ts';
import { ficheDe } from './banc-federation.ts';
import { AssemblageInstantane, messagesInstantane } from './instantane.ts';

type Suite = Extract<MessageChiffre, { t: 'instantane_suite' }>;
type Tete = Extract<MessageChiffre, { t: 'instantane' }>;

const MACHINE = 'tour';

function sessions(n: number): ResumeSession[] {
  return Array.from({ length: n }, (_, i) => ficheDe(`s-${i}`, MACHINE, `Titre ${i}`));
}

function tete(liste: readonly ResumeSession[]): MessageChiffre {
  return { t: 'instantane', machine: MACHINE, nom: 'tour', sessions: [...liste] };
}

function suitesDe(messages: readonly MessageChiffre[]): Suite[] {
  return messages.filter((m): m is Suite => m.t === 'instantane_suite');
}

describe('messagesInstantane', () => {
  test('240 sessions : la tête porte les 150 plus récentes, les pages le reste, dans l’ordre, sans doublon', () => {
    const liste = sessions(240);
    const messages = messagesInstantane(liste, tete);
    const fin = messages.at(-1) as Tete;
    const pages = suitesDe(messages);
    expect(messages.at(-1)?.t).toBe('instantane');
    expect(fin.sessions).toHaveLength(NOMBRE_MAX_SESSIONS_FEDEREES);
    expect(pages.map((p) => p.rang)).toEqual([1]);
    expect(pages.every((p) => p.total === pages.length)).toBe(true);
    const recues = [...fin.sessions, ...pages.flatMap((p) => p.sessions)].map((s) => s.id);
    expect(recues).toEqual(liste.map((s) => s.id));
  });

  test('chaque message tient dans une trame et porte au plus 150 sessions', () => {
    const grosses = Array.from({ length: 600 }, (_, i) => ({
      ...ficheDe(`g-${i}`, MACHINE, 'x'.repeat(4000)),
    }));
    const messages = messagesInstantane(grosses, tete);
    for (const m of messages) {
      expect(new TextEncoder().encode(JSON.stringify(m)).byteLength).toBeLessThanOrEqual(TAILLE_MAX_CLAIR_OCTETS);
    }
    for (const p of suitesDe(messages)) expect(p.sessions.length).toBeLessThanOrEqual(NOMBRE_MAX_SESSIONS_FEDEREES);
    const recues = messages.flatMap((m) => (m.t === 'instantane' || m.t === 'instantane_suite' ? m.sessions : []));
    expect(recues).toHaveLength(600);
  });

  test('peu de sessions : pas de page, la tête seule (comme avant)', () => {
    const messages = messagesInstantane(sessions(3), tete);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.t).toBe('instantane');
  });
});

describe('AssemblageInstantane', () => {
  test('pages reçues puis tête : la liste complète est rendue à l’arrivée de la tête', () => {
    const messages = messagesInstantane(sessions(240), tete);
    const assemblage = new AssemblageInstantane();
    for (const p of suitesDe(messages)) assemblage.recevoirSuite('m1', p);
    expect(assemblage.terminer('m1')).toHaveLength(90);
    expect(assemblage.terminer('m1')).toHaveLength(0);
  });

  test('lot incomplet (page manquante) : rien n’est ajouté, la tête seule reste', () => {
    const messages = messagesInstantane(sessions(400), tete);
    const pages = suitesDe(messages);
    expect(pages.length).toBeGreaterThan(1);
    const assemblage = new AssemblageInstantane();
    assemblage.recevoirSuite('m1', pages[0] as Suite);
    expect(assemblage.terminer('m1')).toEqual([]);
  });

  test('page hors d’ordre : le lot est abandonné ; oublier vide le lot d’un pair', () => {
    const messages = messagesInstantane(sessions(400), tete);
    const pages = suitesDe(messages);
    const assemblage = new AssemblageInstantane();
    assemblage.recevoirSuite('m1', pages[0] as Suite);
    assemblage.recevoirSuite('m1', { ...(pages[0] as Suite), rang: 3, total: 3 });
    assemblage.recevoirSuite('m2', pages[0] as Suite);
    assemblage.oublier('m2');
    expect(assemblage.terminer('m1')).toEqual([]);
    expect(assemblage.terminer('m2')).toEqual([]);
  });
});
