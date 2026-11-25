// Responsabilité : tests de la règle d'extinction automatique (pure, critère par critère) et du balayage
// (postes et registre factices, journal silencieux).
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import {
  balayerExtinctionAuto,
  type SessionExtinguible,
  sessionsAEteindre,
  type SourcesExtinction,
} from './extinction-auto.ts';
import type { ReponsePoste } from '../parc/postes.ts';

const MINUTE = 60_000;
const MAINTENANT = Date.parse('2026-11-25T12:00:00.000Z');
const VIEILLE = new Date(MAINTENANT - 90 * MINUTE).toISOString();
const RECENTE = new Date(MAINTENANT - 5 * MINUTE).toISOString();
const TOUTES_LOCALES = (): boolean => true;

function session(surcharge: Partial<SessionExtinguible> = {}): SessionExtinguible {
  return { id: 's1', machine: 'tour', moteur: 'sdk', statut: 'attente', majLe: VIEILLE, ...surcharge };
}

describe('sessionsAEteindre : règle pure', () => {
  test('une session sdk en attente, inactive depuis plus que le délai, est retenue', () => {
    expect(sessionsAEteindre([session()], 30, MAINTENANT, TOUTES_LOCALES)).toEqual(['s1']);
  });

  test('délai null (jamais) : aucune session', () => {
    expect(sessionsAEteindre([session()], null, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
  });

  test('une activité exactement au seuil n’est pas plus vieille que le délai', () => {
    const pile = new Date(MAINTENANT - 30 * MINUTE).toISOString();
    expect(sessionsAEteindre([session({ majLe: pile })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
    const passe = new Date(MAINTENANT - 30 * MINUTE - 1).toISOString();
    expect(sessionsAEteindre([session({ majLe: passe })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual(['s1']);
  });

  test('une activité récente n’est pas éteinte', () => {
    expect(sessionsAEteindre([session({ majLe: RECENTE })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
  });

  test('une date illisible n’est pas éteinte', () => {
    expect(sessionsAEteindre([session({ majLe: 'pas une date' })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
  });

  test('moteur tmux, claude_ai ou absent : jamais éteinte (le nœud ne tient que les sessions sdk)', () => {
    for (const moteur of ['tmux', 'claude_ai', undefined] as const) {
      expect(sessionsAEteindre([session({ moteur })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
    }
  });

  test('statut question ou travail (ou tout autre) : jamais éteinte', () => {
    for (const statut of ['question', 'travail', 'terminee', 'fermee', 'erreur'] as const) {
      expect(sessionsAEteindre([session({ statut })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
    }
  });

  test('une session archivée n’est jamais éteinte', () => {
    expect(sessionsAEteindre([session({ archivee: true })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
  });

  test('une session reçue d’un pair (duo) n’est jamais éteinte ici', () => {
    const duo = { pair: 'autre', niveau: 'lecture' as const };
    expect(sessionsAEteindre([session({ duo })], 30, MAINTENANT, TOUTES_LOCALES)).toEqual([]);
  });

  test('une machine dont le poste n’est pas relié à ce relais : pas touchée', () => {
    const seule = (machine: string): boolean => machine === 'tour';
    const sessions = [session({ id: 'a', machine: 'tour' }), session({ id: 'b', machine: 'pi' })];
    expect(sessionsAEteindre(sessions, 30, MAINTENANT, seule)).toEqual(['a']);
  });

  test('seules les sessions qui remplissent tous les critères sont rendues, dans l’ordre', () => {
    const sessions = [
      session({ id: 'x', statut: 'travail' }),
      session({ id: 'y' }),
      session({ id: 'z', majLe: RECENTE }),
      session({ id: 'w', moteur: 'tmux' }),
      session({ id: 'v' }),
    ];
    expect(sessionsAEteindre(sessions, 30, MAINTENANT, TOUTES_LOCALES)).toEqual(['y', 'v']);
  });
});

interface Appel {
  readonly machine: string;
  readonly commande: { readonly kind: 'fermer'; readonly sessionId: string; readonly siInactive: true };
}

interface Montage {
  readonly sources: SourcesExtinction;
  readonly appels: Appel[];
}

function montage(opts: { delai: number | null; sessions: SessionExtinguible[]; refus?: string[] }): Montage {
  const appels: Appel[] = [];
  const sources: SourcesExtinction = {
    reglage: { delai: () => opts.delai },
    registre: { sessions: () => opts.sessions },
    postes: {
      enLigne: (machine: string) => machine === 'tour',
      commander: async (machine, commande): Promise<ReponsePoste> => {
        appels.push({ machine, commande });
        if (opts.refus?.includes(commande.sessionId)) return { ok: false, erreur: 'session occupée' };
        return { ok: true };
      },
    },
    journal: pino({ level: 'silent' }),
  };
  return { sources, appels };
}

describe('balayerExtinctionAuto', () => {
  test('ferme chaque session retenue sur sa machine, et rend les ids éteints', async () => {
    const m = montage({ delai: 30, sessions: [session({ id: 'a' }), session({ id: 'b', statut: 'travail' })] });
    const eteintes = await balayerExtinctionAuto(m.sources, MAINTENANT);
    expect(eteintes).toEqual(['a']);
    expect(m.appels).toEqual([{ machine: 'tour', commande: { kind: 'fermer', sessionId: 'a', siInactive: true } }]);
  });

  test('délai jamais : aucun appel au poste', async () => {
    const m = montage({ delai: null, sessions: [session()] });
    expect(await balayerExtinctionAuto(m.sources, MAINTENANT)).toEqual([]);
    expect(m.appels).toEqual([]);
  });

  test('un refus du poste est journalisé sans être levé, et les suivantes sont tentées', async () => {
    const m = montage({ delai: 30, sessions: [session({ id: 'a' }), session({ id: 'b' })], refus: ['a'] });
    expect(await balayerExtinctionAuto(m.sources, MAINTENANT)).toEqual(['b']);
    expect(m.appels.map((a) => a.commande.sessionId)).toEqual(['a', 'b']);
  });

  test('une exception du poste est avalée et n’empêche pas les suivantes', async () => {
    const m = montage({ delai: 30, sessions: [session({ id: 'a' }), session({ id: 'b' })] });
    const commander = m.sources.postes.commander;
    m.sources.postes.commander = async (machine, commande) => {
      if (commande.sessionId === 'a') throw new Error('poste coupé');
      return commander(machine, commande);
    };
    expect(await balayerExtinctionAuto(m.sources, MAINTENANT)).toEqual(['b']);
  });
});
