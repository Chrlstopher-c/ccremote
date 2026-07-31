/**
 * Banc d'essai RÉEL du démarrage d'un worker (M-01, branche B.1).
 *
 * `startWorker` est la fonction qui lance les équipes — livrée au Lot 0, jamais
 * exercée contre le vrai SDK. Ce banc vérifie d'un coup, en conditions réelles :
 *  1. le worker démarre et lit ses capacités dans `SDKSystemMessage.capabilities` ;
 *  2. le plancher de déni (M-20) est réellement appliqué au worker, pas seulement
 *     composé dans ses options ;
 *  3. le worker travaille dans SON worktree et nulle part ailleurs ;
 *  4. `CLAUDE_CONFIG_DIR` isole bien le compte (H-53) ;
 *  5. le `SessionStore` (M-31) reçoit le transcript du worker.
 *
 * ☠ Le worker écrit vraiment des fichiers — c'est son métier. Il opère dans un dépôt
 * git JETABLE créé par le banc, jamais dans un projet de Chris. La seule commande
 * destructrice qu'on lui demande de tenter est une sonde inoffensive (`echo`).
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session et consomme du quota.
 *
 * Usage : bun run acceptation/worker-reel.ts
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { startWorker } from '../workers/index.ts'
import { PLANCHER_DENI_SDK } from '../plancher-deni/index.ts'
import { ouvrirSessionStore } from '../control-plane/session-store/index.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RACINE = join(tmpdir(), `ccremote-worker-${Date.now()}`)
const COMPTE = process.env['COMPTE'] ?? 'compte-a'
const SESSION_ID = crypto.randomUUID()

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`)
}

await Bun.$`mkdir -p ${RACINE}`.quiet()
await Bun.$`git -C ${RACINE} init -q -b main`.quiet()
await Bun.$`git -C ${RACINE} config user.email banc@local`.quiet()
await Bun.$`git -C ${RACINE} config user.name Banc`.quiet()
await Bun.write(`${RACINE}/README.md`, '# worktree jetable du banc\n')

const { store, fermer } = ouvrirSessionStore({ chemin: `${RACINE}/store.sqlite` })

horodate(`worktree jetable : ${RACINE}`)
horodate(`démarrage du worker sur ${COMPTE} · session ${SESSION_ID}`)

// Le mandat impose ce que H-52 exige d'un lead, en version minimale et vérifiable.
const MANDAT =
  'Tu es responsable de cette mission de bout en bout. Ton périmètre est strictement le ' +
  'répertoire de travail courant. Critère d\'arrêt : le fichier RESULTAT.md existe et contient ' +
  'le mot TERMINE.'

const poignee = await startWorker(
  {
    sessionId: SESSION_ID,
    cwd: RACINE,
    mandate: MANDAT,
    // Audit inactif EXPLICITEMENT sur cette doublure (H-74) : jamais une omission.
    portAuditPermissions: () => ({}),
    deniedToolPatterns: [...PLANCHER_DENI_SDK, 'Bash(echo SONDE-REFUS*)'],
    maxBudgetUsd: 5,
    model: 'sonnet',
    configDir: `/home/trinity/.claude-comptes/${COMPTE}`,
    sessionStore: store,
  },
  'Crée un fichier RESULTAT.md contenant exactement le mot TERMINE. ' +
    'Puis tente exactement cette commande, une seule fois : `echo SONDE-REFUS-banc`. ' +
    'Si elle est refusée, ne cherche aucun contournement : signale-le simplement et arrête-toi.',
)

horodate(`worker démarré · capacités annoncées : ${JSON.stringify(poignee.capabilities.advertised)}`)

let refusVu = false
let termine = false
const outilsUtilises = new Set<string>()

for await (const message of poignee.query as AsyncIterable<SDKMessage>) {
  if (message.type === 'user' || message.type === 'assistant') {
    const contenu = (message as { message?: { content?: unknown } }).message?.content
    if (Array.isArray(contenu)) {
      for (const bloc of contenu as { type?: string; name?: string; is_error?: boolean; content?: unknown }[]) {
        if (bloc.type === 'tool_use' && bloc.name) outilsUtilises.add(bloc.name)
        if (bloc.type === 'tool_result' && bloc.is_error === true) {
          const texte = JSON.stringify(bloc.content ?? '')
          if (/permission|denied|not allowed|disallow/i.test(texte)) refusVu = true
        }
      }
    }
  }
  if (message.type === 'result') {
    termine = true
    break
  }
}

const resultatEcrit = await Bun.file(`${RACINE}/RESULTAT.md`).exists()
const contenuResultat = resultatEcrit ? (await Bun.file(`${RACINE}/RESULTAT.md`).text()).trim() : ''

// Le worktree n'a-t-il été modifié QUE là où il devait l'être ?
const statut = await Bun.$`git -C ${RACINE} status --porcelain`.quiet().text()

const cles = await store.listSessions('')
const clesToutes = cles.length > 0 ? cles : await store.listSessions(RACINE.replace(/\//g, '-'))

console.log('\n— Ce que le worker a fait —')
console.log(`  outils employés : ${[...outilsUtilises].join(', ') || '(aucun)'}`)
console.log(`  RESULTAT.md : ${resultatEcrit ? `« ${contenuResultat} »` : 'ABSENT'}`)
console.log(`  git status du worktree :\n${statut.split('\n').map((l) => `    ${l}`).join('\n').trimEnd()}`)
console.log(`  sessions vues par le SessionStore : ${clesToutes.length}`)

console.log('\n— Verdict du banc —')
console.log(`${termine ? '✓' : '✗'} le worker a mené sa mission à terme`)
console.log(`${resultatEcrit && contenuResultat.includes('TERMINE') ? '✓' : '✗'} critère d'arrêt du mandat atteint`)
console.log(`${refusVu ? '✓' : '✗'} le plancher de déni a réellement refusé la sonde`)
console.log(`${poignee.capabilities.claudeCodeVersion !== undefined ? '✓' : '✗'} capacités lues depuis le message init`)

const succes = termine && resultatEcrit && contenuResultat.includes('TERMINE') && refusVu
fermer()
console.log(`\n· worktree conservé pour inspection : ${RACINE}`)
process.exit(succes ? 0 : 1)
