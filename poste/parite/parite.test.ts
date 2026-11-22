// Responsabilité : tests de la lecture du transcript de parité — contexte, résultats, tâches, lecture incrémentale,
// lignes illisibles, détail d'une tâche, refus de résultat. Transcripts fabriqués, fichiers dans un dossier temporaire.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { MAX_OCTETS_RESULTAT, PARITE_VIDE } from '../../commun/parite.ts';
import { executerParite, type CommandeParite } from './executer.ts';
import { oublierEtats, lireEtat } from './lecture.ts';
import { lireResultat } from './resultat.ts';
import { resumeParite } from './resume.ts';
import { detailTache, actionsDe } from './taches-resume.ts';
import {
  assistant,
  horodatage,
  ligneIgnoree,
  notification,
  outil,
  prLink,
  resultatOutil,
  utilisateur,
} from './fabrique-transcript.ts';

const JOURNAL = { warn: () => undefined, debug: () => undefined, error: () => undefined } as unknown as Logger;
let dossier = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'parite-'));
});
afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
});
beforeEach(() => oublierEtats());

function ecrireTranscript(nom: string, lignes: string[]): string {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, lignes.join('\n') + '\n');
  return chemin;
}

function transcriptDeBase(): string[] {
  const sortie = join(dossier, 'base-bg.output');
  writeFileSync(sortie, 'sortie en cours\n');
  return [
    ligneIgnoree(),
    assistant(horodatage(1), [outil('u-envoi', 'SendUserFile', { files: ['/tmp/x/rapport.png'] })], {
      usage: { input_tokens: 10, cache_read_input_tokens: 990, cache_creation_input_tokens: 0, output_tokens: 3 },
    }),
    utilisateur(horodatage(2), [resultatOutil('u-envoi', 'ok')]),
    assistant(horodatage(3), [outil('u-ecrit', 'Write', { file_path: '/tmp/x/page.html' })]),
    utilisateur(horodatage(4), [resultatOutil('u-ecrit', 'ok')]),
    assistant(horodatage(5), [
      outil('u-agent', 'Agent', { description: 'Audit', prompt: 'Lis le code', run_in_background: true }),
    ]),
    utilisateur(horodatage(6), [resultatOutil('u-agent', 'lancé')], {
      isAsync: true,
      status: 'async_launched',
      agentId: 'ag-1',
      resolvedModel: 'claude-haiku-5-5',
    }),
    assistant(horodatage(7), [
      outil('u-bash', 'Bash', { command: 'sleep 999', description: 'Attendre', run_in_background: true }),
    ]),
    ...finDeTranscript(sortie),
  ];
}

function finDeTranscript(sortie: string): string[] {
  return [
    utilisateur(
      horodatage(8),
      [
        resultatOutil(
          'u-bash',
          `Command running in background with ID: bg-1. Output is being written to: ${sortie}. You will be notified.`,
        ),
      ],
      { backgroundTaskId: 'bg-1' },
    ),
    notification(horodatage(9), { taskId: 'ag-1', toolUseId: 'u-agent', statut: 'completed' }),
    prLink(horodatage(10), 7, 'acme/outil'),
    assistant(horodatage(11), [outil('u-git', 'Bash', { command: 'git -C /tmp/depot-inconnu status' })], {
      usage: { input_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, output_tokens: 9 },
    }),
  ];
}

describe('contexte, résultats et tâches du transcript', () => {
  test('contexte du dernier tour du fil principal, pourcentage sur la fenêtre', async () => {
    const chemin = ecrireTranscript('base.jsonl', transcriptDeBase());
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const p = await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat);
    expect(p.contexte).toMatchObject({
      modele: 'claude-opus-5-5',
      utilises: 620,
      sortie: 9,
      fenetre: 1000,
      pourcentage: 62,
    });
  });

  test('un message de sous-agent ne compte pas pour le contexte', () => {
    const chemin = ecrireTranscript('side.jsonl', [
      assistant(horodatage(1), [], { usage: { input_tokens: 5 } }),
      assistant(horodatage(2), [], { usage: { input_tokens: 999 }, sidechain: true }),
    ]);
    expect(lireEtat(chemin, JOURNAL)?.contexte?.utilises).toBe(5);
  });

  test("résultats : envoyés ou créés, image ou page, un chemin une fois, plus récent d'abord", async () => {
    const chemin = ecrireTranscript('res.jsonl', [
      ...transcriptDeBase(),
      assistant(horodatage(12), [outil('u-ecrit2', 'Write', { file_path: '/tmp/x/rapport.png' })]),
    ]);
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const p = await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat);
    expect(p.resultats.map((r) => r.chemin)).toEqual(['/tmp/x/rapport.png', '/tmp/x/page.html']);
    expect(p.resultats[0]).toMatchObject({ genre: 'image', origine: 'cree', nom: 'rapport.png', existe: false });
    expect(p.resultats[1]).toMatchObject({ genre: 'page', origine: 'cree' });
  });

  test('tâches : agent terminé par notification, commande en cours, dépôt et PR', async () => {
    const chemin = ecrireTranscript('taches.jsonl', transcriptDeBase());
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const p = await resumeParite(
      { cwd: '/inexistant-parite', transcript: chemin, fenetre: 1000, journal: JOURNAL },
      etat,
    );
    const agent = p.taches.find((t) => t.genre === 'agent');
    const commande = p.taches.find((t) => t.genre === 'commande');
    expect(agent).toMatchObject({
      statut: 'terminee',
      modele: 'claude-haiku-5-5',
      tacheId: 'ag-1',
      description: 'Audit',
    });
    expect(agent?.finLe).toBe(horodatage(9));
    expect(commande).toMatchObject({ statut: 'en_cours', tacheId: 'bg-1', description: 'Attendre' });
    expect(p.depot).toBeNull();
  });

  test('transcript sans poste ni dépôt : parité vide reconnue', () => {
    expect(PARITE_VIDE).toEqual({ transcript: false, contexte: null, resultats: [], taches: [], depot: null });
  });
});

describe('lecture incrémentale', () => {
  test("n'applique que les lignes ajoutées, une ligne incomplète attend sa fin", () => {
    const chemin = ecrireTranscript('inc.jsonl', [
      assistant(horodatage(1), [outil('a', 'SendUserFile', { files: ['/t/a.png'] })]),
    ]);
    expect(lireEtat(chemin, JOURNAL)?.resultats.size).toBe(1);
    const suite = assistant(horodatage(2), [outil('b', 'Write', { file_path: '/t/b.pdf' })]);
    appendFileSync(chemin, suite.slice(0, 40));
    expect(lireEtat(chemin, JOURNAL)?.resultats.size).toBe(1);
    appendFileSync(chemin, suite.slice(40) + '\n');
    expect(lireEtat(chemin, JOURNAL)?.resultats.size).toBe(2);
  });

  test("fichier plus petit qu'avant : repart de zéro ; ligne illisible ignorée", () => {
    const chemin = ecrireTranscript('reset.jsonl', [
      assistant(horodatage(1), [outil('a', 'SendUserFile', { files: ['/t/a.png'] })]),
      assistant(horodatage(2), [{ type: 'text', text: 'x'.repeat(3000) }]),
      "{ceci n'est pas du json",
    ]);
    expect(lireEtat(chemin, JOURNAL)?.resultats.size).toBe(1);
    writeFileSync(chemin, assistant(horodatage(5), [outil('c', 'Write', { file_path: '/t/c.html' })]) + '\n');
    const etat = lireEtat(chemin, JOURNAL);
    expect([...(etat?.resultats.keys() ?? [])]).toEqual(['/t/c.html']);
  });

  test('transcript absent : null, sans exception', () => {
    expect(lireEtat(join(dossier, 'absent.jsonl'), JOURNAL)).toBeNull();
  });
});

describe("détail d'une tâche", () => {
  test('commande : consigne et fin de la sortie', () => {
    const sortie = join(dossier, 'sortie-bg.output');
    writeFileSync(sortie, 'première ligne\nligne finale\n');
    const chemin = ecrireTranscript('detail.jsonl', [
      assistant(horodatage(1), [outil('u-cmd', 'Bash', { command: 'make test', run_in_background: true })]),
      utilisateur(
        horodatage(2),
        [resultatOutil('u-cmd', `Output is being written to: ${sortie}. You will be notified.`)],
        {
          backgroundTaskId: 'bg-9',
        },
      ),
    ]);
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const d = detailTache(etat, 'u-cmd', chemin, JOURNAL);
    expect(d?.prompt).toBe('make test');
    expect(d?.activite).toContain('ligne finale');
  });

  test("agent : actions récentes du sous-agent, et terminé d'après son méta-fichier", () => {
    const chemin = ecrireTranscript('avec-sous.jsonl', [
      assistant(horodatage(1), [
        outil('u-ag', 'Agent', { description: 'Revue', prompt: 'Revois', run_in_background: true }),
      ]),
      utilisateur(horodatage(2), [resultatOutil('u-ag', 'ok')], {
        isAsync: true,
        agentId: 'ag-fin',
        resolvedModel: 'claude-haiku-5-5',
      }),
    ]);
    const sousAgents = join(dossier, 'avec-sous', 'subagents');
    mkdirSync(sousAgents, { recursive: true });
    writeFileSync(
      join(sousAgents, 'agent-ag-fin.jsonl'),
      [
        assistant(horodatage(3), [{ type: 'text', text: 'Je lis le fichier.\nDeuxième ligne' }]),
        assistant(horodatage(4), [outil('x', 'Edit', { file_path: '/t/fichier.ts' })]),
      ].join('\n') + '\n',
    );
    writeFileSync(join(sousAgents, 'agent-ag-fin.meta.json'), JSON.stringify({ finished: true }));
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const d = detailTache(etat, 'u-ag', chemin, JOURNAL);
    expect(d?.statut).toBe('terminee');
    expect(d?.finLe).not.toBeNull();
    expect(d?.activite).toBe('Je lis le fichier.\nEdit : /t/fichier.ts');
    expect(actionsDe('')).toBeNull();
  });

  test('agent fini puis relancé par SendMessage : de nouveau en cours, puis terminé à sa nouvelle notification', () => {
    const debut = [
      assistant(horodatage(1), [
        outil('u-rel', 'Agent', { description: 'Relance', prompt: 'Fais', run_in_background: true }),
      ]),
      utilisateur(horodatage(2), [resultatOutil('u-rel', 'ok')], { isAsync: true, agentId: 'ag-rel' }),
      utilisateur(horodatage(3), [
        { type: 'text', text: '<task-notification><task-id>ag-rel</task-id><status>completed</status></task-notification>' },
      ]),
      assistant(horodatage(4), [outil('u-msg', 'SendMessage', { to: 'ag-rel', message: 'Continue' })]),
    ];
    const sousAgents = join(dossier, 'relance', 'subagents');
    mkdirSync(sousAgents, { recursive: true });
    writeFileSync(join(sousAgents, 'agent-ag-rel.meta.json'), JSON.stringify({ finished: true }));
    writeFileSync(join(sousAgents, 'agent-ag-rel.jsonl'), assistant(horodatage(5), [{ type: 'text', text: 'Je reprends' }]) + '\n');
    const relance = ecrireTranscript('relance.jsonl', debut);
    const etat = lireEtat(relance, JOURNAL);
    if (!etat) throw new Error('état attendu');
    expect(detailTache(etat, 'u-rel', relance, JOURNAL)?.statut).toBe('en_cours');
    oublierEtats();
    const fini = ecrireTranscript('relance.jsonl', [
      ...debut,
      utilisateur(horodatage(6), [
        { type: 'text', text: '<task-notification><task-id>ag-rel</task-id><status>completed</status></task-notification>' },
      ]),
    ]);
    const etatFin = lireEtat(fini, JOURNAL);
    if (!etatFin) throw new Error('état attendu');
    expect(detailTache(etatFin, 'u-rel', fini, JOURNAL)?.statut).toBe('terminee');
  });

  test("commande sans fin dont la sortie n'a pas bougé depuis 10 min : arrêtée", async () => {
    const sortie = join(dossier, 'vieille-sortie.output');
    writeFileSync(sortie, 'figé\n');
    const ancien = new Date(Date.now() - 60 * 60_000);
    utimesSync(sortie, ancien, ancien);
    const chemin = ecrireTranscript('figee.jsonl', [
      assistant(horodatage(1), [outil('u-f', 'Bash', { command: 'tail -f x', run_in_background: true })]),
      utilisateur(horodatage(2), [resultatOutil('u-f', `Output is being written to: ${sortie}. Notified later.`)], {
        backgroundTaskId: 'bg-f',
      }),
    ]);
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const p = await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat);
    expect(p.taches[0]?.statut).toBe('arretee');
  });
});

describe('résultats servis et commandes de la parité', () => {
  test('refus : chemin hors de la liste, fichier trop gros', () => {
    writeFileSync(join(dossier, 'petit.png'), Buffer.from([1, 2, 3]));
    const gros = join(dossier, 'gros.png');
    writeFileSync(gros, Buffer.alloc(MAX_OCTETS_RESULTAT + 1));
    expect(lireResultat(join(dossier, 'petit.png'), JOURNAL)).toEqual({
      etat: 'ok',
      mime: 'image/png',
      base64: 'AQID',
    });
    expect(lireResultat(gros, JOURNAL)).toMatchObject({ etat: 'refus', statut: 413 });
    expect(lireResultat(join(dossier, 'nexiste-pas.png'), JOURNAL)).toMatchObject({ etat: 'refus', statut: 404 });
  });

  test('executerParite : hors liste → refus 404 ; transcript inconnu → parité vide', async () => {
    const chemin = ecrireTranscript('exec.jsonl', [
      assistant(horodatage(1), [outil('a', 'SendUserFile', { files: [join(dossier, 'petit.png')] })]),
    ]);
    const x = {
      transcript: (c: CommandeParite) => (c.sessionId === 'connue' ? chemin : null),
      fenetre: 1000,
      journal: JOURNAL,
    };
    const base = { id: '1', sessionId: 'connue', claudeSessionId: 'c', cwd: dossier };
    const hors = await executerParite({ kind: 'parite_resultat', ...base, chemin: '/etc/passwd' }, x);
    expect(hors.donnees).toMatchObject({ etat: 'refus', statut: 404 });
    const sans = await executerParite({ kind: 'parite', ...base, sessionId: 'inconnue' }, x);
    expect(sans.donnees).toEqual(PARITE_VIDE);
    const tache = await executerParite({ kind: 'parite_tache', ...base, tache: 'inconnue' }, x);
    expect(tache.donnees).toEqual({ tache: null });
  });
});

describe('agent sans notification de fin', () => {
  const MINUTE = 60_000;
  const iso = (ms: number): string => new Date(ms).toISOString();

  // Transcript d'un agent lancé à `debut`, avec son identifiant d'exécution ; dossier sous-agents à part.
  function agentSansFin(nom: string, debut: number): { chemin: string; sousAgents: string } {
    const chemin = ecrireTranscript(`${nom}.jsonl`, [
      assistant(iso(debut), [
        outil(`u-${nom}`, 'Agent', { description: 'Test', prompt: 'p', run_in_background: true }),
      ]),
      utilisateur(iso(debut + 1000), [resultatOutil(`u-${nom}`, 'lancé')], {
        isAsync: true,
        agentId: `ag-${nom}`,
      }),
    ]);
    const sousAgents = join(dossier, nom, 'subagents');
    mkdirSync(sousAgents, { recursive: true });
    return { chemin, sousAgents };
  }

  async function statutDe(chemin: string): Promise<{ statut: string; finLe: string | null }> {
    const etat = lireEtat(chemin, JOURNAL);
    if (!etat) throw new Error('état attendu');
    const p = await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat);
    const t = p.taches[0];
    if (!t) throw new Error('tâche attendue');
    return { statut: t.statut, finLe: t.finLe };
  }

  test('lancé il y a moins de 10 min, rien sur disque : en cours', async () => {
    const { chemin } = agentSansFin('recent', Date.now() - MINUTE);
    expect(await statutDe(chemin)).toEqual({ statut: 'en_cours', finLe: null });
  });

  test('lancé il y a 1 h, aucun journal ni méta : arrêté, fin = début', async () => {
    const debut = Date.now() - 60 * MINUTE;
    const { chemin } = agentSansFin('ancien', debut);
    expect(await statutDe(chemin)).toEqual({ statut: 'arretee', finLe: iso(debut) });
  });

  test('journal écrit il y a moins de 10 min : en cours malgré un lancement ancien', async () => {
    const { chemin, sousAgents } = agentSansFin('vivant', Date.now() - 60 * MINUTE);
    writeFileSync(join(sousAgents, 'agent-ag-vivant.jsonl'), '{}\n');
    expect((await statutDe(chemin)).statut).toBe('en_cours');
  });

  test('journal immobile depuis 20 min, méta non terminé : arrêté, fin = mtime du journal', async () => {
    const { chemin, sousAgents } = agentSansFin('fige', Date.now() - 60 * MINUTE);
    const journal = join(sousAgents, 'agent-ag-fige.jsonl');
    writeFileSync(journal, '{}\n');
    writeFileSync(join(sousAgents, 'agent-ag-fige.meta.json'), JSON.stringify({ finished: false }));
    const ancien = new Date(Date.now() - 20 * MINUTE);
    utimesSync(journal, ancien, ancien);
    expect(await statutDe(chemin)).toEqual({ statut: 'arretee', finLe: iso(ancien.getTime()) });
  });

  test('méta « finished » : terminé, fin = début faute de journal', async () => {
    const debut = Date.now() - 60 * MINUTE;
    const { chemin, sousAgents } = agentSansFin('fini', debut);
    writeFileSync(join(sousAgents, 'agent-ag-fini.meta.json'), JSON.stringify({ finished: true }));
    expect(await statutDe(chemin)).toEqual({ statut: 'terminee', finLe: iso(debut) });
  });
});
