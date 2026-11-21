// Responsabilité : tests du recalage au démarrage du poste — marque d'un transcript, statut d'une session tenue hors
// Lanterne, recalage d'une fiche au chargement (transcript + fiche Desktop), marques persistées, file des fils relus
// une fois par changement de transcript (ordre recalage puis historique).
import { describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { EvenementHorodate } from './historique.ts';
import type { SessionPersistee } from './persistance.ts';
import {
  MarquesRecalage,
  RecalageFils,
  VERSION_RECALAGE,
  lignesRelues,
  marqueRecalage,
  piloteeEnCours,
  recalerAuChargement,
  statutExterne,
  transcriptDe,
} from './recalage-demarrage.ts';
import { cheminTranscript } from './transcript.ts';

const journal = pino({ enabled: false });
const CONV = 'c0000000-0000-4000-8000-00000000000a';
const CWD = '/home/x/projet';
const MAJ = '2026-11-01T09:00:00.000Z';

const LIGNES_TRANSCRIPT: readonly object[] = [
  {
    type: 'user',
    timestamp: '2026-11-19T10:00:00.000Z',
    permissionMode: 'auto',
    message: { role: 'user', content: 'Salut' },
  },
  {
    type: 'assistant',
    timestamp: '2026-11-19T10:00:05.000Z',
    message: {
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Bonjour' }],
      usage: {
        input_tokens: 4,
        cache_read_input_tokens: 100_000,
        cache_creation_input_tokens: 2_000,
        output_tokens: 9,
      },
    },
  },
  { type: 'ai-title', timestamp: '2026-11-19T10:00:06.000Z', aiTitle: 'Titre généré' },
];

const LIGNE_SUITE = {
  type: 'user',
  timestamp: '2026-11-19T10:05:00.000Z',
  permissionMode: 'auto',
  message: { role: 'user', content: 'Suite' },
};

function fiche(): ResumeSession {
  return {
    id: CONV,
    machine: 'tour',
    projet: { machine: 'tour', chemin: CWD, nom: 'projet' },
    cwd: CWD,
    titre: 'provisoire',
    objectif: null,
    modele: 'défaut',
    compte: 'principal',
    autonomie: false,
    statut: 'fermee',
    contexte: { tokens: 0, max: 200_000 },
    etapes: 0,
    compactions: 0,
    claudeSessionId: CONV,
    tmux: null,
    attachee: false,
    pilotee: false,
    creeLe: MAJ,
    majLe: MAJ,
  };
}

function persistee(resume: ResumeSession, configDir: string, aReprendre = false): SessionPersistee {
  return { resume, consignes: null, configDir, transcript: null, position: 0, aReprendre };
}

interface Environnement {
  readonly configDir: string;
  readonly racine: string;
  readonly chemin: string;
  readonly nettoyer: () => void;
}

// Un transcript écrit dans le dossier projects de la configuration, et une racine Desktop (vide ou avec une fiche).
function environnement(fichesDesktop: readonly object[] = []): Environnement {
  const base = mkdtempSync(join(tmpdir(), 'recalage-demarrage-'));
  const configDir = join(base, 'config');
  const racine = join(base, 'desktop');
  const chemin = cheminTranscript(CWD, CONV, configDir);
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, LIGNES_TRANSCRIPT.map((l) => JSON.stringify(l)).join('\n') + '\n');
  mkdirSync(join(racine, 'org', 'acct'), { recursive: true });
  fichesDesktop.forEach((f, i) => writeFileSync(join(racine, 'org', 'acct', `local_${i}.json`), JSON.stringify(f)));
  return { configDir, racine, chemin, nettoyer: () => rmSync(base, { recursive: true, force: true }) };
}

const FICHE_DESKTOP = {
  cliSessionId: CONV,
  permissionMode: 'plan',
  remoteControlUserEnabled: true,
  title: 'Titre Desktop',
  isArchived: true,
};

describe('marqueRecalage', () => {
  test('un transcript absent n’a pas de marque', () => {
    const env = environnement();
    try {
      expect(marqueRecalage(join(env.configDir, 'absent.jsonl'))).toBeNull();
    } finally {
      env.nettoyer();
    }
  });

  test('la marque commence par la version du recalage et change quand le transcript grossit', () => {
    const env = environnement();
    try {
      const avant = marqueRecalage(env.chemin);
      expect(avant?.startsWith(`${VERSION_RECALAGE}:`)).toBe(true);
      appendFileSync(env.chemin, JSON.stringify(LIGNE_SUITE) + '\n');
      expect(marqueRecalage(env.chemin)).not.toBe(avant);
    } finally {
      env.nettoyer();
    }
  });
});

describe('statutExterne', () => {
  test('une session tenue par un processus externe est au travail ou en attente selon son tour', () => {
    expect(statutExterne('fermee', true, true)).toBe('travail');
    expect(statutExterne('fermee', true, false)).toBe('attente');
    expect(statutExterne('travail', true, false)).toBe('attente');
  });

  test('une session non tenue n’est ni au travail, ni en attente, ni en démarrage ; une erreur reste une erreur', () => {
    expect(statutExterne('travail', false, false)).toBe('fermee');
    expect(statutExterne('attente', false, false)).toBe('fermee');
    expect(statutExterne('demarrage', false, false)).toBe('fermee');
    expect(statutExterne('erreur', false, false)).toBe('erreur');
  });
});

describe('recalerAuChargement', () => {
  test('la fiche Desktop donne le titre et le Remote Control ; l’activité vient du transcript', () => {
    const env = environnement([FICHE_DESKTOP]);
    try {
      const p = persistee(fiche(), env.configDir);
      const marques = new MarquesRecalage(null, journal);
      const r = recalerAuChargement(p, marques, { journal, racineDesktop: env.racine }).resume;
      expect(r).toMatchObject({
        majLe: '2026-11-19T10:00:06.000Z',
        modele: 'claude-opus-5-5',
        contexte: { tokens: 102_004, max: 200_000 },
        titre: 'Titre Desktop',
        remoteControl: { actif: true, url: null },
      });
      expect('archivee' in r).toBe(false);
    } finally {
      env.nettoyer();
    }
  });

  // Le code lit le mode du transcript avant celui de la fiche Desktop (recalage-fiche.ts) : à arbitrer.
  test('le mode de la fiche Desktop (plan) prime sur celui du transcript (auto)', () => {
    const env = environnement([FICHE_DESKTOP]);
    try {
      const r = recalerAuChargement(persistee(fiche(), env.configDir), new MarquesRecalage(null, journal), {
        journal,
        racineDesktop: env.racine,
      });
      expect(r.resume.mode).toBe('plan');
    } finally {
      env.nettoyer();
    }
  });

  test('sans fiche Desktop, le titre vient du transcript (titre généré) et le mode reste celui du transcript', () => {
    const env = environnement();
    try {
      const p = persistee(fiche(), env.configDir);
      const r = recalerAuChargement(p, new MarquesRecalage(null, journal), {
        journal,
        racineDesktop: env.racine,
      }).resume;
      expect(r).toMatchObject({ titre: 'Titre généré', mode: 'auto' });
      expect(r.remoteControl).toBeUndefined();
    } finally {
      env.nettoyer();
    }
  });

  test('une session pilotée (aReprendre) est rendue telle quelle', () => {
    const env = environnement();
    try {
      const p = persistee(fiche(), env.configDir, true);
      expect(recalerAuChargement(p, new MarquesRecalage(null, journal), { journal })).toBe(p);
    } finally {
      env.nettoyer();
    }
  });

  test('une marque déjà à jour rend la fiche telle quelle', () => {
    const env = environnement();
    try {
      const p = persistee(fiche(), env.configDir);
      const marques = new MarquesRecalage(null, journal);
      marques.ecrire(CONV, marqueRecalage(env.chemin) ?? '');
      expect(recalerAuChargement(p, marques, { journal })).toBe(p);
    } finally {
      env.nettoyer();
    }
  });
});

describe('MarquesRecalage', () => {
  test('les marques écrites sont relues depuis le même fichier par une nouvelle instance', () => {
    const env = environnement();
    try {
      const fichier = join(env.configDir, 'recalage.json');
      new MarquesRecalage(fichier, journal).ecrire('s1', '1:10:20');
      expect(new MarquesRecalage(fichier, journal).lire('s1')).toBe('1:10:20');
    } finally {
      env.nettoyer();
    }
  });

  test('sans fichier, les marques restent en mémoire seulement', () => {
    const marques = new MarquesRecalage(null, journal);
    marques.ecrire('s1', 'x');
    expect(marques.lire('s1')).toBe('x');
    expect(new MarquesRecalage(null, journal).lire('s1')).toBeUndefined();
  });
});

describe('RecalageFils', () => {
  function montage(): {
    file: RecalageFils;
    marques: MarquesRecalage;
    trace: string[];
    applications: ResumeSession[];
    recalages: [string, boolean][];
    historiques: [string, readonly EvenementHorodate[]][];
    env: Environnement;
  } {
    const env = environnement([FICHE_DESKTOP]);
    const vivante = persistee({ ...fiche(), id: 'vivante-1', claudeSessionId: null }, env.configDir);
    const persistance = persistee(fiche(), env.configDir);
    const marques = new MarquesRecalage(null, journal);
    const trace: string[] = [];
    const recalages: [string, boolean][] = [];
    const historiques: [string, readonly EvenementHorodate[]][] = [];
    const applications: ResumeSession[] = [];
    const file = new RecalageFils({
      journal,
      racineDesktop: env.racine,
      fiches: () => [
        { persistee: vivante, vivante: true },
        { persistee: persistance, vivante: false },
      ],
      stockeur: () => undefined,
      appliquer: (_id, recalee) => {
        trace.push('appliquer');
        applications.push(recalee);
      },
      recalage: (id, archiver) => {
        trace.push('recalage');
        recalages.push([id, archiver]);
      },
      historique: (id, evenements) => {
        trace.push('historique');
        historiques.push([id, evenements]);
      },
      marques,
      relaisOuvert: () => true,
      pauseMs: 0,
    });
    return { file, marques, trace, recalages, historiques, applications, env };
  }

  test('un pas ne traite que la fiche non vivante, recalage (archivé) avant historique, puis marque posée', () => {
    const m = montage();
    try {
      expect(m.file.pas()).toBe(true);
      expect(m.recalages).toEqual([[CONV, true]]);
      expect(m.trace).toEqual(['appliquer', 'recalage', 'historique']);
      expect(m.applications[0]?.modele).toBe('claude-opus-5-5');
      expect(m.historiques[0]?.[0]).toBe(CONV);
      expect(m.historiques[0]?.[1].length).toBeGreaterThan(0);
      expect(m.marques.lire(CONV)).toBe(marqueRecalage(m.env.chemin) ?? '');
    } finally {
      m.env.nettoyer();
    }
  });

  test('un second pas ne relit rien tant que le transcript n’a pas changé', () => {
    const m = montage();
    try {
      m.file.pas();
      expect(m.file.pas()).toBe(false);
      expect(m.recalages).toHaveLength(1);
    } finally {
      m.env.nettoyer();
    }
  });

  test('une ligne ajoutée au transcript fait relire la fiche au pas suivant', () => {
    const m = montage();
    try {
      m.file.pas();
      appendFileSync(m.env.chemin, JSON.stringify(LIGNE_SUITE) + '\n');
      expect(m.file.pas()).toBe(true);
      expect(m.recalages).toHaveLength(2);
    } finally {
      m.env.nettoyer();
    }
  });
});

const H1 = '2026-11-19T10:00:00.000Z';
const H2 = '2026-11-19T10:01:00.000Z';
const H3 = '2026-11-19T10:02:00.000Z';
const FIN_DES_TEMPS = '9999-12-31T23:59:59.999Z';

describe('lignesRelues', () => {
  const relues: EvenementHorodate[] = [
    { ts: H1, evt: { type: 'message', texte: 'un', uuid: 'a' } },
    { ts: H1, evt: { type: 'message', texte: 'sans uuid' } },
    { ts: H2, evt: { type: 'outil', id: 'o1', nom: 'Bash', resume: 'ls', detail: '' } },
    { ts: H2, evt: { type: 'outil', id: 'o-sa', nom: 'Read', resume: '', detail: '', agent: 'ag-1' } },
    { ts: H3, evt: { type: 'texte', texte: 'réponse', uuid: 'r' } },
    { ts: H3, evt: { type: 'resultat_outil', outilId: 'o1', extrait: '', erreur: false } },
  ];
  const ouverte = persistee(fiche(), '/cfg');

  test('null quand la fiche a tenu une autre conversation ; une fiche d’une seule conversation est relue', () => {
    expect(lignesRelues({ ...ouverte, identifiants: ['ancienne'] }, relues, Date.now())).toBeNull();
    expect(lignesRelues({ ...ouverte, identifiants: [CONV] }, relues, Date.now())).not.toBeNull();
  });

  test('null sans événement, ou sans date d’écriture', () => {
    expect(lignesRelues(ouverte, [], Date.now())).toBeNull();
    expect(lignesRelues(ouverte, relues, 0)).toBeNull();
  });

  test('les clés sont celles des lignes du transcript, sans sous-agent ni doublon ; les textes de Chris à part', () => {
    expect(lignesRelues(ouverte, relues, Date.now())).toMatchObject({
      cles: ['a', 'o1', 'r'],
      messages: ['un', 'sans uuid'],
    });
  });

  test('transcript au repos depuis plus de 10 min : jusqua est la fin des temps', () => {
    const ecrit = Date.now() - 11 * 60_000;
    expect(lignesRelues(ouverte, relues, ecrit)?.jusqua).toBe(FIN_DES_TEMPS);
  });

  test('transcript récent : jusqua est une minute avant sa dernière écriture', () => {
    const ecrit = Date.now() - 2 * 60_000;
    expect(lignesRelues(ouverte, relues, ecrit)?.jusqua).toBe(new Date(ecrit - 60_000).toISOString());
  });
});

describe('piloteeEnCours', () => {
  test('une reprise prévue en plein tour est pilotée ; une reprise en attente ne l’est pas', () => {
    expect(piloteeEnCours(persistee({ ...fiche(), statut: 'travail' }, '/cfg', true))).toBe(true);
    expect(piloteeEnCours(persistee({ ...fiche(), statut: 'attente' }, '/cfg', true))).toBe(false);
  });

  test('sans reprise prévue, rien n’est piloté', () => {
    expect(piloteeEnCours(persistee({ ...fiche(), statut: 'travail' }, '/cfg'))).toBe(false);
  });
});

describe('recalerAuChargement — fiche en attente à reprendre', () => {
  test('recalée sur son transcript et sa fiche Desktop, son statut d’attente est gardé', () => {
    const env = environnement([FICHE_DESKTOP]);
    try {
      const p = persistee({ ...fiche(), statut: 'attente' }, env.configDir, true);
      const r = recalerAuChargement(p, new MarquesRecalage(null, journal), { journal, racineDesktop: env.racine });
      expect(r.resume).toMatchObject({ statut: 'attente', titre: 'Titre Desktop', modele: 'claude-opus-5-5' });
    } finally {
      env.nettoyer();
    }
  });
});

describe('transcriptDe', () => {
  // Transcript de la conversation rangé dans chacun des dossiers donnés (sous projects de la configuration).
  function rangés(dossiers: readonly string[]): { configDir: string; nettoyer: () => void } {
    const base = mkdtempSync(join(tmpdir(), 'transcript-de-'));
    const configDir = join(base, 'config');
    for (const d of dossiers) {
      mkdirSync(join(configDir, 'projects', d), { recursive: true });
      writeFileSync(join(configDir, 'projects', d, `${CONV}.jsonl`), '');
    }
    return { configDir, nettoyer: () => rmSync(base, { recursive: true, force: true }) };
  }
  const fichePour = (configDir: string): SessionPersistee => persistee(fiche(), configDir);

  test('sans transcript dans le dossier du cwd, il est cherché dans les autres dossiers du projet', () => {
    const env = rangés(['-ailleurs']);
    try {
      const attendu = join(env.configDir, 'projects', '-ailleurs', `${CONV}.jsonl`);
      expect(transcriptDe(fichePour(env.configDir))).toBe(attendu);
    } finally {
      env.nettoyer();
    }
  });

  test('une copie ssh- n’est retenue qu’à défaut d’un transcript original', () => {
    const avec = rangés(['ssh-tour', '-ailleurs']);
    const seule = rangés(['ssh-tour']);
    try {
      const original = join(avec.configDir, 'projects', '-ailleurs', `${CONV}.jsonl`);
      const copie = join(seule.configDir, 'projects', 'ssh-tour', `${CONV}.jsonl`);
      expect(transcriptDe(fichePour(avec.configDir))).toBe(original);
      expect(transcriptDe(fichePour(seule.configDir))).toBe(copie);
    } finally {
      avec.nettoyer();
      seule.nettoyer();
    }
  });
});
