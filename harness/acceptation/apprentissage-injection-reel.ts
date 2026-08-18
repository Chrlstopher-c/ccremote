/**
 * Preuve E7 (3/3, la seule qui compte — PLAN-PORTAGE.md) : sème une leçon `active` en base,
 * construit un `WorkerSpec` via `construireWorkerSpec` (le vrai point de branchement, F-4),
 * lance une VRAIE équipe avec ce spec, puis relit son transcript JSONL réel pour y retrouver
 * la leçon. Sens positif ici (leçon présente ⇒ retrouvée) ; le sens négatif (leçon retirée
 * ⇒ absente) est décrit dans le commentaire de fin.
 *
 * Usage : bun run acceptation/apprentissage-injection-reel.ts
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { startWorker } from '../workers/index.ts';
import { PLANCHER_DENI_SDK } from '../plancher-deni/index.ts';
import { construireWorkerSpec } from '../composition/pc/construire-worker-spec.ts';
import { ouvrirBaseApprentissage, fermerBaseApprentissage, creerLecon } from '../apprentissage/index.ts';

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`);
}

const RACINE = mkdtempSync(join(tmpdir(), 'ccremote-injection-e7-'));
const COMPTE = process.env['COMPTE'] ?? 'compte-a';
const CONFIG_DIR = `/home/trinity/.claude-comptes/${COMPTE}`;
const SESSION_ID = crypto.randomUUID();
const DB_APPRENTISSAGE = join(RACINE, 'apprentissage.db');
process.env['CCREMOTE_APPRENTISSAGE_DB'] = DB_APPRENTISSAGE;

const MARQUEUR = `MARQUEUR-E7-${Date.now()}`;
const ENONCE = `Toujours vérifier le marqueur ${MARQUEUR} avant de conclure une passe d'apprentissage.`;

await Bun.$`mkdir -p ${RACINE}`.quiet();
await Bun.$`git -C ${RACINE} init -q -b main`.quiet();
await Bun.$`git -C ${RACINE} config user.email banc@local`.quiet();
await Bun.$`git -C ${RACINE} config user.name Banc`.quiet();
await Bun.write(`${RACINE}/README.md`, '# worktree jetable — preuve E7\n');

horodate(`base d'apprentissage : ${DB_APPRENTISSAGE}`);
const db = ouvrirBaseApprentissage();
creerLecon(db, { id: 'lecon-e7-preuve', projet: RACINE, enonce: ENONCE, categorie: 'methode', portee: 'projet', etat: 'active' });
fermerBaseApprentissage(db);
horodate(`leçon active semée pour le projet ${RACINE}`);

const spec = construireWorkerSpec(
  {
    sessionId: SESSION_ID,
    cwd: RACINE,
    mandate: "Tu es responsable de cette mission. Crée un fichier RESULTAT.md contenant TERMINE, puis arrête-toi.",
    deniedToolPatterns: [...PLANCHER_DENI_SDK],
    maxBudgetUsd: 3,
    model: 'sonnet',
    configDir: CONFIG_DIR,
  },
  () => ({}),
  () => null,
);

horodate('mandat composé (extrait autour du bloc de leçons) :');
const indexBloc = spec.mandate.indexOf('CE QUE LES ÉQUIPES PRÉCÉDENTES');
console.log(indexBloc === -1 ? '☠ BLOC ABSENT DU MANDAT' : spec.mandate.slice(indexBloc, indexBloc + 300));

const poignee = await startWorker(spec, 'Crée RESULTAT.md contenant TERMINE, puis arrête-toi.');
horodate(`worker démarré, session ${poignee.sessionId}`);

for await (const message of poignee.query as AsyncIterable<SDKMessage>) {
  if (message.type === 'result') {
    horodate(`mission terminée : ${JSON.stringify({ subtype: message.subtype })}`);
    break;
  }
}

const cheminTranscript = join(CONFIG_DIR, 'projects', RACINE.replace(/[/\\]/g, '-'), `${SESSION_ID}.jsonl`);
horodate(`lecture du transcript réel : ${cheminTranscript}`);
if (!existsSync(cheminTranscript)) {
  console.error('☠ TRANSCRIPT INTROUVABLE — preuve impossible à produire.');
  process.exitCode = 1;
} else {
  const brut = readFileSync(cheminTranscript, 'utf8');
  const trouve = brut.includes(MARQUEUR);
  horodate(`marqueur « ${MARQUEUR} » ${trouve ? 'TROUVÉ' : 'ABSENT'} dans le transcript réel`);
  if (trouve) {
    const idx = brut.indexOf(MARQUEUR);
    console.log('--- extrait du JSONL contenant le marqueur ---');
    console.log(brut.slice(Math.max(0, idx - 200), idx + 200));
  } else {
    console.error('☠ ÉCHEC DE LA PREUVE : le marqueur n’apparaît nulle part dans le transcript.');
    process.exitCode = 1;
  }
}

horodate(
  'Sens inverse (à produire séparément si besoin) : supprimer/rétrograder « lecon-e7-preuve » ' +
    '(UPDATE lecon SET etat=\'obsolete\' WHERE id=\'lecon-e7-preuve\'), relancer ce script avec un ' +
    'nouveau SESSION_ID sur le même projet, et vérifier que le marqueur est ABSENT du nouveau transcript.',
);
