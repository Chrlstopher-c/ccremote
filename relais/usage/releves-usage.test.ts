import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { EtatCompte } from '../../commun/comptes.ts';
import {
  CADENCE_MS,
  apresRemise,
  type MachinesReleve,
  type PosteReleve,
  ReleveUsage,
  problemeAffiche,
} from './releves-usage.ts';

const journal = pino({ enabled: false });
const MAINTENANT = Date.UTC(2026, 10, 20, 10, 0, 0);
const CLE = 'courriel:chris@example.com';

const FENETRES = {
  session: { libelle: 'Session (5 h)', pourcent: 42, reinitialiseLe: null },
  semaine: null,
  autres: [],
};
const SUCCES = {
  fenetres: FENETRES,
  usage: { limits: [] },
  cedar: { ok: true },
  statut: null,
  retryApresMs: null,
  erreur: null,
};
const LIMITE = { fenetres: null, usage: null, cedar: null, statut: 429, retryApresMs: null, erreur: 'usage HTTP 429' };

function compte(id: string, cle: string | null = CLE, connecte = true): EtatCompte {
  return {
    id,
    defaut: false,
    connecte,
    email: cle ? 'chris@example.com' : null,
    organisation: null,
    abonnement: 'max',
    session: null,
    semaine: null,
    autres: [],
    probleme: null,
    releveLe: '',
    connexion: null,
    distant: false,
    cle,
    usageLe: null,
    prochainReleve: null,
  };
}

interface Monde {
  readonly usage: ReleveUsage;
  readonly appels: { machine: string; nom: string }[];
  horloge: { t: number };
  reponses: unknown[];
  machines: Record<string, EtatCompte[]>;
  base: Database;
}

/** Base comme celle du relais (mode strict). */
const nouvelleBase = (): Database => new Database(':memory:', { strict: true });

/** Relais simulé : postes en ligne (clés = machines), réponses de relevé en file, horloge à la main. */
function monde(machines: Record<string, EtatCompte[]>, base = nouvelleBase()): Monde {
  const horloge = { t: MAINTENANT };
  const appels: { machine: string; nom: string }[] = [];
  const reponses: unknown[] = [];
  const registre: MachinesReleve = {
    machines: () => Object.entries(machines).map(([id, etatComptes]) => ({ id, etatComptes })),
  };
  const postes: PosteReleve = {
    enLigne: (m) => m in machines,
    commander: (machine, c) => {
      appels.push({ machine, nom: c.nom });
      const suivante = reponses.shift() ?? SUCCES;
      return Promise.resolve({ ok: true, donnees: suivante });
    },
  };
  const usage = new ReleveUsage(
    base,
    registre,
    postes,
    journal,
    () => {},
    () => horloge.t,
  );
  return { usage, appels, horloge, reponses, machines, base };
}

describe('relevé unique par compte réel', () => {
  test('deux postes qui ont le même compte : un seul appel, sur un seul poste', async () => {
    const m = monde({ tour: [compte('principal')], portable: [compte('principal')] });
    await m.usage.tick();
    expect(m.appels).toEqual([{ machine: 'portable', nom: 'principal' }]);
  });

  test('le poste choisi reste le releveur tant qu’il est en ligne', async () => {
    const m = monde({ tour: [compte('principal')], portable: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    m.horloge.t += CADENCE_MS;
    await m.usage.releverSiDu(CLE);
    expect(m.appels.map((a) => a.machine)).toEqual(['portable', 'portable']);
  });

  test('un compte sans identité (jeton seul) n’est jamais relevé', async () => {
    const m = monde({ tour: [compte('longue-duree', null)] });
    await m.usage.tick();
    expect(m.appels).toHaveLength(0);
  });

  test('un compte déconnecté n’est pas relevé', async () => {
    const m = monde({ tour: [compte('principal', CLE, false)] });
    await m.usage.tick();
    expect(m.appels).toHaveLength(0);
  });
});

describe('cadence et recul', () => {
  test('au plus un appel par délai : rien avant 5 min, un appel après', async () => {
    const m = monde({ tour: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    m.horloge.t += CADENCE_MS - 1000;
    await m.usage.releverSiDu(CLE);
    expect(m.appels).toHaveLength(1);
    m.horloge.t += 1000;
    await m.usage.releverSiDu(CLE);
    expect(m.appels).toHaveLength(2);
  });

  test('429 sans Retry-After : recul 5 → 10 → 20 → 40 → 60 min, plafonné à 60', async () => {
    const m = monde({ tour: [compte('principal')] });
    const attentes: number[] = [];
    for (let i = 0; i < 6; i++) {
      m.reponses.push(LIMITE);
      await m.usage.releverSiDu(CLE);
      const ligne = m.base.query('SELECT prochain_le FROM usage_comptes').get() as { prochain_le: string };
      const prochain = Date.parse(ligne.prochain_le);
      attentes.push(Math.round((prochain - m.horloge.t) / 60_000));
      m.horloge.t = prochain;
    }
    expect(attentes).toEqual([5, 10, 20, 40, 60, 60]);
  });

  test('429 avec Retry-After : le délai du serveur est respecté', async () => {
    const m = monde({ tour: [compte('principal')] });
    m.reponses.push({ ...LIMITE, retryApresMs: 17 * 60_000 });
    await m.usage.releverSiDu(CLE);
    const ligne = m.base.query('SELECT prochain_le FROM usage_comptes').get() as { prochain_le: string };
    expect(Date.parse(ligne.prochain_le) - m.horloge.t).toBe(17 * 60_000);
  });

  test('premier succès après des 429 : le recul repart de 5 min', async () => {
    const m = monde({ tour: [compte('principal')] });
    m.reponses.push(LIMITE, LIMITE, SUCCES);
    await m.usage.releverSiDu(CLE);
    m.horloge.t += 5 * 60_000;
    await m.usage.releverSiDu(CLE);
    m.horloge.t += 10 * 60_000;
    await m.usage.releverSiDu(CLE);
    m.reponses.push(LIMITE);
    m.horloge.t += CADENCE_MS;
    await m.usage.releverSiDu(CLE);
    const ligne = m.base.query('SELECT prochain_le FROM usage_comptes').get() as { prochain_le: string };
    expect(Date.parse(ligne.prochain_le) - m.horloge.t).toBe(5 * 60_000);
  });
});

describe('dernière valeur bonne', () => {
  test('après un 429 sur donnée de plus de 30 min : barres gardées, prochain relevé annoncé', async () => {
    const m = monde({ tour: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    m.horloge.t += 40 * 60_000;
    m.reponses.push(LIMITE);
    await m.usage.releverSiDu(CLE);
    const [vu] = m.usage.appliquer(m.machines['tour'] ?? []);
    expect(vu?.session?.pourcent).toBe(42);
    expect(vu?.usageLe).toBe(new Date(MAINTENANT).toISOString());
    expect(vu?.prochainReleve).not.toBeNull();
    expect(vu?.probleme).toContain('prochain relevé vers');
  });

  test('après un 429 sur une donnée de moins de 30 min, aucun problème affiché', async () => {
    const m = monde({ tour: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    m.horloge.t += CADENCE_MS;
    m.reponses.push(LIMITE);
    await m.usage.releverSiDu(CLE);
    const [vu] = m.usage.appliquer(m.machines['tour'] ?? []);
    expect(vu?.session?.pourcent).toBe(42);
    expect(vu?.probleme).toBeNull();
  });

  test('sans aucune valeur : « pas encore relevé », pas « indisponible » sans raison', async () => {
    const m = monde({ tour: [compte('principal')] });
    const [vu] = m.usage.appliquer([compte('principal')]);
    expect(vu?.session).toBeNull();
    expect(vu?.probleme).toBe('pas encore relevé');
  });

  test('redémarrage : la base relue donne la dernière valeur, sans nouvel appel', async () => {
    const base = nouvelleBase();
    const avant = monde({ tour: [compte('principal')] }, base);
    await avant.usage.releverSiDu(CLE);
    const apres = monde({ tour: [compte('principal')] }, base);
    apres.horloge.t = avant.horloge.t + 60_000;
    const [vu] = apres.usage.appliquer([compte('principal')]);
    expect(vu?.session?.pourcent).toBe(42);
    await apres.usage.releverSiDu(CLE);
    expect(apres.appels).toHaveLength(0);
  });

  test('détail : l’usage brut relevé est servi, rien tant qu’aucun relevé', async () => {
    const m = monde({ tour: [compte('principal')] });
    expect(m.usage.brutPour(CLE)).toBeNull();
    await m.usage.releverSiDu(CLE);
    expect(m.usage.brutPour(CLE)).toEqual({ usage: { limits: [] }, cedar: { ok: true } });
  });
});

describe('quota vu dans le flux SDK', () => {
  test('la fenêtre reçue devient la dernière valeur, sans appel au poste, relevé repoussé à 5 min', async () => {
    const m = monde({ tour: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    const appelsAvant = m.appels.length;
    m.horloge.t += 60_000;
    m.usage.recevoirLimite(CLE, {
      genre: 'session',
      fenetre: { libelle: 'Session (5 h)', pourcent: 77, reinitialiseLe: null },
    });
    const [vu] = m.usage.appliquer(m.machines['tour'] ?? []);
    expect(vu?.session?.pourcent).toBe(77);
    expect(vu?.usageLe).toBe(new Date(m.horloge.t).toISOString());
    expect(vu?.prochainReleve).toBe(new Date(m.horloge.t + CADENCE_MS).toISOString());
    await m.usage.releverSiDu(CLE);
    expect(m.appels).toHaveLength(appelsAvant);
  });

  test('la fenêtre reçue efface l’erreur précédente', async () => {
    const m = monde({ tour: [compte('principal')] });
    m.reponses.push(LIMITE);
    await m.usage.releverSiDu(CLE);
    m.horloge.t += 40 * 60_000;
    m.usage.recevoirLimite(CLE, {
      genre: 'session',
      fenetre: { libelle: 'Session (5 h)', pourcent: 77, reinitialiseLe: null },
    });
    const erreur = m.base.query('SELECT erreur FROM usage_comptes').get() as { erreur: string | null };
    expect(erreur.erreur).toBeNull();
    const [vu] = m.usage.appliquer(m.machines['tour'] ?? []);
    expect(vu?.probleme).toBeNull();
  });

  test('un relevé prévu dans moins de 5 min est repoussé à maintenant + 5 min', async () => {
    const m = monde({ tour: [compte('principal')] });
    await m.usage.releverSiDu(CLE);
    m.horloge.t += 4 * 60_000;
    m.usage.recevoirLimite(CLE, {
      genre: 'session',
      fenetre: { libelle: 'Session (5 h)', pourcent: 77, reinitialiseLe: null },
    });
    const ligne = m.base.query('SELECT prochain_le FROM usage_comptes').get() as { prochain_le: string };
    expect(Date.parse(ligne.prochain_le)).toBe(m.horloge.t + CADENCE_MS);
  });

  test('un relevé prévu plus tard (recul 429) n’est pas avancé', async () => {
    const m = monde({ tour: [compte('principal')] });
    m.reponses.push({ ...LIMITE, retryApresMs: 60 * 60_000 });
    await m.usage.releverSiDu(CLE);
    const prevu = MAINTENANT + 60 * 60_000;
    m.horloge.t += 60_000;
    m.usage.recevoirLimite(CLE, {
      genre: 'session',
      fenetre: { libelle: 'Session (5 h)', pourcent: 78, reinitialiseLe: null },
    });
    const ligne = m.base.query('SELECT prochain_le FROM usage_comptes').get() as { prochain_le: string };
    expect(Date.parse(ligne.prochain_le)).toBe(prevu);
  });

  test('première fenêtre sans relevé : ligne créée, compte non relevé avant 5 min', async () => {
    const m = monde({ tour: [compte('principal')] });
    m.usage.recevoirLimite(CLE, {
      genre: 'semaine',
      fenetre: { libelle: 'Semaine', pourcent: 10, reinitialiseLe: null },
    });
    const [vu] = m.usage.appliquer([compte('principal')]);
    expect(vu?.semaine?.pourcent).toBe(10);
    expect(vu?.session).toBeNull();
    await m.usage.releverSiDu(CLE);
    expect(m.appels).toHaveLength(0);
  });
});

describe('problème affiché selon la fraîcheur', () => {
  const T = Date.UTC(2026, 10, 20, 10, 0, 0);
  const MIN = 60_000;

  test('aucune erreur : rien à afficher', () => {
    expect(problemeAffiche(null, null, null, T)).toBeNull();
  });

  test('donnée de moins de 30 min : rien à afficher, même avec une erreur 429', () => {
    const releve = new Date(T - 29 * MIN).toISOString();
    expect(problemeAffiche('usage HTTP 429', releve, null, T)).toBeNull();
  });

  test('donnée de plus de 30 min : la limite 429 est annoncée avec l’heure du prochain relevé', () => {
    const releve = new Date(T - 31 * MIN).toISOString();
    const prochain = new Date(T + 5 * MIN).toISOString();
    expect(problemeAffiche('usage HTTP 429', releve, prochain, T)).toContain('limite de l’API d’usage atteinte');
  });

  test('aucune valeur jamais lue : le problème d’erreur est affiché', () => {
    const texte = problemeAffiche('poste injoignable', null, null, T);
    expect(texte).toContain('relevé d’usage impossible (poste injoignable)');
  });
});

describe('fenêtre dont la remise à zéro est passée', () => {
  const f = { libelle: 'Session (5 h)', pourcent: 81, reinitialiseLe: '2026-11-25T03:30:00Z' };
  test('passée : 0 %, prochaine remise inconnue', () => {
    expect(apresRemise(f, Date.parse('2026-11-25T04:00:00Z'))).toEqual({ ...f, pourcent: 0, reinitialiseLe: null });
  });
  test('à venir : inchangée', () => {
    expect(apresRemise(f, Date.parse('2026-11-25T03:00:00Z'))).toEqual(f);
  });
});
