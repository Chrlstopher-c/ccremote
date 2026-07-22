/**
 * Test d'acceptation RÉEL de M-02 — le seul point de la vague 1 qu'aucun subagent n'a le
 * droit de valider : il exige une vraie session Claude Code, donc du quota et un vrai SDK.
 *
 * Ce que le test prouve, et qu'aucun test unitaire ne peut prouver : le flux d'entrée
 * survit à une longue inactivité **côté SDK**. Les tests de `generateur-entree.test.ts`
 * exercent notre générateur avec une horloge simulée ; ils ne disent rien de ce que le
 * transport du SDK fait d'un itérateur silencieux pendant dix minutes. Si le SDK ferme
 * l'itérateur (ou si un timeout de transport le fait à sa place), `canUseTool` et les
 * hooks meurent sans autre trace qu'un `Error: Stream closed` sur stderr — panne #1.
 *
 * ☠ NE PAS transformer en `*.test.ts` : `bun test` le ramasserait et ouvrirait une vraie
 * session à chaque exécution de la suite.
 *
 * Usage :
 *   bun run acceptation/m02-flux-entree.ts            # silence réel de 10 min
 *   SILENCE_S=20 bun run acceptation/m02-flux-entree.ts  # répétition à blanc du protocole
 */
import { query, type Options, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { GenerateurEntree } from '../control-plane/orchestrateur/entree/index.ts'

const SILENCE_MS = Number(process.env['SILENCE_S'] ?? 600) * 1000

/** Ce que le protocole exige d'observer. Tout doit être vrai à la fin. */
interface Observations {
  canUseToolAppele: boolean
  hookPreToolUseAppele: boolean
  fermetureImprevue: boolean
  streamClosedSurStderr: boolean
  premierTourRepondu: boolean
  secondTourRepondu: boolean
}

const vu: Observations = {
  canUseToolAppele: false,
  hookPreToolUseAppele: false,
  fermetureImprevue: false,
  streamClosedSurStderr: false,
  premierTourRepondu: false,
  secondTourRepondu: false,
}

const lignesStderr: string[] = []

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

const generateur = new GenerateurEntree({
  // Le protocole impose que cette alarme soit bruyante : c'est elle qui distingue
  // « le flux tient » de « le flux est mort mais personne ne l'a remarqué ».
  surFermetureImprevue: (contexte): void => {
    vu.fermetureImprevue = true
    console.error('☠ FERMETURE IMPRÉVUE DU FLUX D\'ENTRÉE', contexte)
  },
})

const options: Options = {
  // ☠ Surtout pas `bypassPermissions` : `canUseTool` ne serait jamais appelé et le test
  // serait vert pour la mauvaise raison.
  // `auto` est le mode de production ; `default` sert à prouver que le câblage de
  // `canUseTool` fonctionne, quand `auto` ne le sollicite pas (voir MODE plus bas).
  permissionMode: (process.env['MODE'] ?? 'auto') as Options['permissionMode'],
  canUseTool: async (nomOutil, entree): Promise<PermissionResult> => {
    vu.canUseToolAppele = true
    horodate(`canUseTool appelé pour « ${nomOutil} »`)
    return { behavior: 'deny', message: 'test d\'acceptation : refus systématique', interrupt: false }
  },
  hooks: {
    PreToolUse: [
      {
        hooks: [
          async (entree): Promise<Record<string, never>> => {
            vu.hookPreToolUseAppele = true
            horodate(`hook PreToolUse appelé (${JSON.stringify(entree).slice(0, 120)})`)
            return {}
          },
        ],
      },
    ],
  },
  stderr: (donnees: string): void => {
    lignesStderr.push(donnees)
    if (donnees.includes('Stream closed')) {
      vu.streamClosedSurStderr = true
      console.error('☠ « Stream closed » observé sur stderr')
    }
  },
}

async function attendre(ms: number): Promise<void> {
  return new Promise((resoudre) => setTimeout(resoudre, ms))
}

async function executer(): Promise<void> {
  const session = query({ prompt: generateur.flux, options })

  // Étape 1 — un tour trivial, pour prouver que la session est réellement établie
  // avant de mesurer quoi que ce soit sur le silence.
  horodate('tour 1 : envoi d\'un message trivial')
  await generateur.envoyer('Réponds exactement : PRET')

  const lecture = (async (): Promise<void> => {
    for await (const message of session as AsyncIterable<SDKMessage>) {
      if (message.type === 'result') {
        if (!vu.premierTourRepondu) {
          vu.premierTourRepondu = true
          horodate('tour 1 : résultat reçu')
        } else {
          vu.secondTourRepondu = true
          horodate('tour 2 : résultat reçu')
        }
      }
    }
  })()

  while (!vu.premierTourRepondu) await attendre(500)

  // Étape 2 — le cœur du test : du temps RÉEL, pas simulé. Le but est d'exercer le
  // transport du SDK, qu'une horloge simulée ne touche pas.
  horodate(`silence réel de ${SILENCE_MS / 1000} s — ne rien envoyer`)
  await attendre(SILENCE_MS)
  horodate(`état du générateur après le silence : « ${generateur.etat} »`)

  // Étape 3 — une instruction qui déclenche une demande de permission. Si le flux
  // avait été coupé pendant le silence, cet envoi n'atteindrait jamais le modèle.
  // ☠ L'instruction doit être escaladée par le CLASSIFIEUR, sinon `canUseTool` n'est
  // jamais appelé (il ne l'est qu'à l'étape de l'invite) et le test est vert pour la
  // mauvaise raison. Constaté en réel : `echo bonjour` est autorisé d'office.
  // La cible est un chemin temporaire INEXISTANT : même si le classifieur autorisait,
  // l'effet resterait nul — et de toute façon `canUseTool` refuse.
  horodate('tour 2 : envoi d\'une instruction nécessitant une permission')
  await generateur.envoyer(
    'Exécute exactement cette commande shell, sans la modifier : `rm -rf /tmp/m02-cible-inexistante-ne-pas-creer`',
  )

  const echeance = Date.now() + 120_000
  while (!vu.secondTourRepondu && Date.now() < echeance) await attendre(500)

  generateur.fermer()
  await lecture
}

function rapporter(): boolean {
  // Constaté en réel le 2026-07-22 : en `auto`, le classifieur tranche seul et ne remonte
  // pas l'invite — `canUseTool` n'est alors JAMAIS appelé, même sur un `rm -rf`. Ce n'est
  // pas un défaut de câblage (prouvé en `default`, où il est appelé, après le hook).
  // ⇒ l'audit exhaustif doit passer par `PreToolUse`, jamais par `canUseTool`.
  const modeInvite = (process.env['MODE'] ?? 'auto') === 'default'
  const attendus: readonly (readonly [string, boolean])[] = [
    ['tour 1 répondu', vu.premierTourRepondu],
    ['tour 2 répondu après le silence', vu.secondTourRepondu],
    [
      modeInvite ? 'canUseTool appelé' : 'canUseTool (non requis en mode « auto »)',
      modeInvite ? vu.canUseToolAppele : true,
    ],
    ['hook PreToolUse appelé', vu.hookPreToolUseAppele],
    ['générateur resté « ouvert »', generateur.etat === 'ouvert' || generateur.etat === 'ferme'],
    ['aucune fermeture imprévue', !vu.fermetureImprevue],
    ['aucun « Stream closed » sur stderr', !vu.streamClosedSurStderr],
  ]

  console.log('\n— Résultat du test d\'acceptation M-02 —')
  let succes = true
  for (const [libelle, ok] of attendus) {
    console.log(`${ok ? '✓' : '✗'} ${libelle}`)
    if (!ok) succes = false
  }
  if (lignesStderr.length > 0) {
    console.log('\n— stderr rapatrié —')
    console.log(lignesStderr.join('').slice(0, 4000))
  }
  return succes
}

try {
  await executer()
} catch (erreur) {
  console.error('☠ le test d\'acceptation a levé une exception', erreur)
} finally {
  process.exit(rapporter() ? 0 : 1)
}
