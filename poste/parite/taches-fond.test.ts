// Responsabilité : tests des tâches de fond d'un transcript Claude Desktop (2.1.325) — fin de commande livrée en pièce
// jointe `queued_command`, Monitor (surveillance qui ne se termine que par TaskStop ou à son échéance). Transcripts
// fabriqués dans un dossier temporaire ; aucun chemin ni identifiant réel.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { oublierEtats, lireEtat } from './lecture.ts';
import { resumeParite } from './resume.ts';
import { assistant, outil, resultatOutil, utilisateur } from './fabrique-transcript.ts';

const JOURNAL = { warn: () => undefined, debug: () => undefined, error: () => undefined } as unknown as Logger;
const MINUTE = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();
let dossier = '';

beforeAll(() => {
  dossier = mkdtempSync(join(tmpdir(), 'parite-fond-'));
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true });
  oublierEtats();
});

function ecrire(nom: string, lignes: string[]): string {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, `${lignes.join('\n')}\n`);
  oublierEtats();
  return chemin;
}

// Pièce jointe que Claude Desktop 2.1.325 écrit pour livrer une notification de fond au tour suivant.
function piecesJointeNotification(le: string, corps: string): string {
  return JSON.stringify({ type: 'attachment', timestamp: le, attachment: { type: 'queued_command', prompt: corps } });
}

function commandeDeFond(id: string, description: string): Record<string, unknown> {
  return outil(id, 'Bash', { command: 'make', description, run_in_background: true });
}

function notificationTexte(tache: string, outilId: string, statut: string | null): string {
  const etat = statut === null ? '' : `<status>${statut}</status>\n`;
  const id = `<task-id>${tache}</task-id>\n<tool-use-id>${outilId}</tool-use-id>`;
  return `<task-notification>\n${id}\n${etat}</task-notification>`;
}

async function taches(chemin: string): Promise<Awaited<ReturnType<typeof resumeParite>>['taches']> {
  const etat = lireEtat(chemin, JOURNAL);
  if (!etat) throw new Error('état attendu');
  return (await resumeParite({ cwd: dossier, transcript: chemin, fenetre: 1000, journal: JOURNAL }, etat)).taches;
}

describe('fin de commande livrée en pièce jointe queued_command', () => {
  test('la notification de fin clôt la commande en arrière-plan', async () => {
    const debut = Date.now() - 2 * MINUTE;
    const chemin = ecrire('fin-pj.jsonl', [
      assistant(iso(debut), [commandeDeFond('u-b', 'Construire')]),
      utilisateur(iso(debut + 1000), [resultatOutil('u-b', 'Command running in background with ID: bg-q1.')], {
        backgroundTaskId: 'bg-q1',
      }),
      piecesJointeNotification(iso(debut + 60_000), notificationTexte('bg-q1', 'u-b', 'completed')),
    ]);
    const [commande] = await taches(chemin);
    expect(commande).toMatchObject({
      genre: 'commande',
      statut: 'terminee',
      tacheId: 'bg-q1',
      description: 'Construire',
    });
    expect(commande?.finLe).toBe(iso(debut + 60_000));
  });

  test('une fin en échec est reconnue de la même façon', async () => {
    const debut = Date.now() - 2 * MINUTE;
    const chemin = ecrire('echec-pj.jsonl', [
      assistant(iso(debut), [commandeDeFond('u-e', 'Tester')]),
      utilisateur(iso(debut + 1000), [resultatOutil('u-e', 'Command running in background with ID: bg-e1.')], {
        backgroundTaskId: 'bg-e1',
      }),
      piecesJointeNotification(iso(debut + 30_000), notificationTexte('bg-e1', 'u-e', 'failed')),
    ]);
    expect((await taches(chemin))[0]?.statut).toBe('echouee');
  });
});

describe('Monitor : surveillance de fond', () => {
  const debutMonitor = (): number => Date.now() - 2 * MINUTE;

  function transcriptMonitor(nom: string, debut: number, lignesSuite: string[]): string {
    return ecrire(nom, [
      assistant(iso(debut), [
        outil('u-m', 'Monitor', { description: 'Surveiller', command: 'inotifywait', timeout_ms: 1_800_000 }),
      ]),
      utilisateur(iso(debut + 1000), [resultatOutil('u-m', 'Monitor started (task mon-1, expires in 30m).')], {
        taskId: 'mon-1',
        timeoutMs: 1_800_000,
        persistent: false,
      }),
      ...lignesSuite,
    ]);
  }

  test('un Monitor apparaît comme commande en cours, et un événement ne le termine pas', async () => {
    const debut = debutMonitor();
    const evenement = piecesJointeNotification(
      iso(debut + 30_000),
      '<task-notification>\n<task-id>mon-1</task-id>\n<event>capture.png</event>\n</task-notification>',
    );
    const [moniteur] = await taches(transcriptMonitor('monitor-evt.jsonl', debut, [evenement]));
    expect(moniteur).toMatchObject({
      genre: 'commande',
      statut: 'en_cours',
      tacheId: 'mon-1',
      description: 'Surveiller',
      finLe: null,
    });
  });

  test('TaskStop arrête le Monitor', async () => {
    const debut = debutMonitor();
    const arret = utilisateur(iso(debut + 60_000), [resultatOutil('u-s', 'Successfully stopped task: mon-1')]);
    const stop = assistant(iso(debut + 59_000), [outil('u-s', 'TaskStop', { task_id: 'mon-1' })]);
    const [moniteur] = await taches(transcriptMonitor('monitor-stop.jsonl', debut, [stop, arret]));
    expect(moniteur).toMatchObject({ statut: 'arretee', finLe: iso(debut + 59_000) });
  });

  test("sans arrêt, il expire à sa durée (timeout_ms) : arrêté à l'échéance", async () => {
    const debut = Date.now() - 40 * MINUTE;
    const [moniteur] = await taches(transcriptMonitor('monitor-echu.jsonl', debut, []));
    expect(moniteur).toMatchObject({ statut: 'arretee', finLe: iso(debut + 30 * MINUTE) });
  });
});
