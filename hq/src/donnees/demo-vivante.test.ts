// Responsabilité : tests de la démo vivante — réactions aux actions de Chris, sur horloge et planificateur injectés.
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { Evenement, MessageClient, ResumeSession } from './contrat';
import { creerSourceDemo } from './demo';
import { CYCLE_DEMO_MS } from './demo-scenario';
import { sessionDuMessage } from './demo-vivante';
import type { SourceMonde } from './source-monde';

const T0 = Date.parse('2026-11-15T10:00:00.000Z');

interface Tache {
  readonly echeance: number;
  readonly fn: () => void;
  annulee: boolean;
}

interface Banc {
  readonly source: SourceMonde;
  readonly recus: MessageClient[];
  readonly horloge: { t: number };
  readonly taches: Tache[];
  readonly tick: () => void;
}

function prochaineTache(taches: readonly Tache[], fin: number): Tache | undefined {
  return taches.filter((x) => !x.annulee && x.echeance <= fin).sort((a, b) => a.echeance - b.echeance)[0];
}

function avancer(banc: Banc, ms: number): void {
  const fin = banc.horloge.t + ms;
  for (let prochaine = prochaineTache(banc.taches, fin); prochaine; prochaine = prochaineTache(banc.taches, fin)) {
    banc.taches.splice(banc.taches.indexOf(prochaine), 1);
    banc.horloge.t = prochaine.echeance;
    prochaine.fn();
  }
  banc.horloge.t = fin;
}

function banc(): Banc {
  const horloge = { t: T0 };
  const taches: Tache[] = [];
  let tick: () => void = () => undefined;
  const source = creerSourceDemo({
    horloge: () => horloge.t,
    planifier: (fn) => {
      tick = fn;
      return () => undefined;
    },
    planifierUnique: (fn, ms) => {
      const tache: Tache = { echeance: horloge.t + ms, fn, annulee: false };
      taches.push(tache);
      return () => {
        tache.annulee = true;
      };
    },
  });
  const recus: MessageClient[] = [];
  source.demarrer({ surLien: () => undefined, surMessage: (m) => recus.push(m) });
  return { source, recus, horloge, taches, tick: () => tick() };
}

function evenementsDe(recus: readonly MessageClient[], id: string): Evenement[] {
  return recus.flatMap((m) => (m.type === 'evenement' && m.evenement.sessionId === id ? [m.evenement.evt] : []));
}

function sessionsDe(recus: readonly MessageClient[], id: string): ResumeSession[] {
  return recus.flatMap((m) => (m.type === 'session' && m.session.id === id ? [m.session] : []));
}

function derniereSession(recus: readonly MessageClient[], id: string): ResumeSession {
  const liste = sessionsDe(recus, id);
  const derniere = liste[liste.length - 1];
  if (!derniere) throw new Error(`aucune session émise pour ${id}`);
  return derniere;
}

describe('demo vivante : au démarrage', () => {
  test('demo-3 attend une réponse à choix', async () => {
    const { source } = banc();
    const etat = await source.etatInitial();
    const session = etat.sessions.find((s) => s.id === 'demo-3');
    expect(session?.statut).toBe('question');
    expect(session?.dialogue?.id).toBe('q-format');
    expect(session?.dialogue?.options.length).toBe(2);
  });
});

describe('demo vivante : envoyer', () => {
  test('le message de Chris part tout de suite et la session passe en travail', async () => {
    const b = banc();
    await b.source.api.envoyerMessage('demo-1', 'salut');
    expect(evenementsDe(b.recus, 'demo-1')[0]).toEqual({ type: 'message', texte: 'salut' });
    expect(derniereSession(b.recus, 'demo-1').statut).toBe('travail');
  });

  test('la réponse simulée suit l ordre outils, flux, texte, fin de tour', async () => {
    const b = banc();
    await b.source.api.envoyerMessage('demo-1', 'salut');
    avancer(b, 2000);
    const evts = evenementsDe(b.recus, 'demo-1');
    expect(evts.map((e) => e.type)).toEqual([
      'message',
      'outil',
      'resultat_outil',
      'outil',
      'resultat_outil',
      'flux',
      'flux',
      'flux',
      'flux',
      'flux',
      'flux',
      'texte',
      'tour_fini',
    ]);
    expect(derniereSession(b.recus, 'demo-1').statut).toBe('attente');
  });

  test('les numéros d événements sont strictement croissants', async () => {
    const b = banc();
    await b.source.api.envoyerMessage('demo-1', 'salut');
    avancer(b, 2000);
    const seqs = b.recus.flatMap((m) =>
      m.type === 'evenement' && m.evenement.sessionId === 'demo-1' ? [m.evenement.seq] : [],
    );
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('demo vivante : répondre', () => {
  test('repondre retire la question, résume le choix puis reprend le travail', async () => {
    const b = banc();
    await b.source.api.repondre('demo-3', { id: 'q-format', index: 0 });
    expect(derniereSession(b.recus, 'demo-3').dialogue).toBeNull();
    expect(evenementsDe(b.recus, 'demo-3')).toContainEqual({ type: 'message', texte: 'Choix retenu : Court' });
    avancer(b, 2000);
    expect(derniereSession(b.recus, 'demo-3').statut).toBe('attente');
  });

  test('repondre sans question en attente est refusé', async () => {
    const b = banc();
    await expect(b.source.api.repondre('demo-1', { id: 'x', index: 0 })).rejects.toThrow();
  });
});

describe('demo vivante : agir', () => {
  test('interrompre coupe la réponse en cours et le signale', async () => {
    const b = banc();
    await b.source.api.envoyerMessage('demo-1', 'salut');
    avancer(b, 300);
    await b.source.api.agir('demo-1', 'interrompre');
    avancer(b, 3000);
    const evts = evenementsDe(b.recus, 'demo-1');
    expect(evts).toContainEqual({ type: 'relance', raison: 'Interrompu par Chris' });
    expect(evts.some((e) => e.type === 'texte')).toBe(false);
    expect(derniereSession(b.recus, 'demo-1').statut).toBe('attente');
  });

  test('fermer puis reprendre rebascule le statut et le terminal', async () => {
    const b = banc();
    await b.source.api.agir('demo-1', 'fermer');
    expect(derniereSession(b.recus, 'demo-1').statut).toBe('fermee');
    expect(derniereSession(b.recus, 'demo-1').tmux).toBeNull();
    await b.source.api.agir('demo-1', 'reprendre');
    expect(derniereSession(b.recus, 'demo-1').statut).toBe('attente');
    expect(derniereSession(b.recus, 'demo-1').tmux).toBe('demo-demo-1');
  });

  test('compacter émet une compaction et réduit le contexte', async () => {
    const b = banc();
    await b.source.api.agir('demo-1', 'compacter');
    expect(evenementsDe(b.recus, 'demo-1').some((e) => e.type === 'compaction')).toBe(true);
    expect(derniereSession(b.recus, 'demo-1').compactions).toBe(1);
  });

  test('archiver puis désarchiver pose et retire le drapeau', async () => {
    const b = banc();
    await b.source.api.agir('demo-1', 'archiver');
    expect(derniereSession(b.recus, 'demo-1').archivee).toBe(true);
    await b.source.api.agir('demo-1', 'desarchiver');
    expect(derniereSession(b.recus, 'demo-1').archivee).toBe(false);
  });

  test('une session action inconnue est refusée', async () => {
    const b = banc();
    await expect(b.source.api.envoyerMessage('inconnu', 'x')).rejects.toThrow();
  });
});

describe('demo vivante : sortie du scénario', () => {
  test('une session prise en main ne reçoit plus les messages du scénario', async () => {
    const b = banc();
    await b.source.api.agir('demo-1', 'archiver');
    b.recus.splice(0);
    b.horloge.t = T0 + CYCLE_DEMO_MS;
    b.tick();
    expect(b.recus.some((m) => sessionDuMessage(m) === 'demo-1')).toBe(false);
    expect(b.recus.some((m) => sessionDuMessage(m) === 'demo-2')).toBe(true);
  });
});
