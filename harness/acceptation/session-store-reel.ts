/**
 * Banc d'essai RÉEL de l'adaptateur `SessionStore` (M-31, branche E.3).
 *
 * Ce que M-31 n'a pas pu prouver, et que seul le vrai SDK peut montrer : que le SDK
 * **appelle réellement** l'adaptateur, à quelle cadence, et avec quelles clés. Un
 * adaptateur parfaitement conforme au type mais jamais sollicité produirait exactement
 * la panne que ce module existe pour éviter — une UI convaincante et vide.
 *
 * ☠ Aucune action dangereuse demandée au modèle : la session ne fait qu'un `echo`.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session et consomme du quota.
 *
 * Usage : bun run acceptation/session-store-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ouvrirSessionStore } from '../control-plane/session-store/index.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = join(tmpdir(), `ccremote-store-reel-${Date.now()}.sqlite`)
const COMPTE = process.env['COMPTE'] ?? 'compte-a'

interface Appel {
  readonly methode: string
  readonly cle: string
  readonly detail: string
  readonly a: number
}

const appels: Appel[] = []

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

const { store, fermer, version } = ouvrirSessionStore({ chemin: BASE })

/**
 * Enveloppe l'adaptateur pour compter ce que le SDK sollicite réellement, sans
 * modifier son comportement — le vrai store fait le travail, on ne fait qu'observer.
 */
function observer<T extends object>(cible: T): T {
  return new Proxy(cible, {
    get(objet, propriete, recepteur): unknown {
      const valeur = Reflect.get(objet, propriete, recepteur) as unknown
      if (typeof valeur !== 'function' || typeof propriete !== 'string') return valeur
      return (...args: unknown[]): unknown => {
        const premier = args[0]
        const cle = typeof premier === 'string' ? premier : JSON.stringify(premier ?? null)
        const detail = Array.isArray(args[1]) ? `${args[1].length} entrée(s)` : ''
        // ☠ Ne PAS tronquer ici : la clé est reparsée plus bas pour lire la
        // `projectKey` réelle. Tronquer casse le JSON et fait croire à une clé vide.
        appels.push({ methode: propriete, cle: String(cle), detail, a: Date.now() })
        return (valeur as (...a: unknown[]) => unknown).apply(objet, args)
      }
    },
  })
}

const options: Options = {
  permissionMode: 'auto',
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
  // Le point du banc : le SDK reçoit notre adaptateur, pas son store en mémoire.
  sessionStore: observer(store) as Options['sessionStore'],
}

horodate(`base : ${BASE} (schéma v${version()})`)
horodate(`session sur ${COMPTE}`)

let sessionId: string | null = null
for await (const message of query({
  prompt: 'Réponds exactement : STORE-OK',
  options,
}) as AsyncIterable<SDKMessage>) {
  if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
    sessionId = 'session_id' in message ? String(message.session_id) : null
    horodate(`session établie · id ${sessionId}`)
  }
  // E.3.3 : le SDK signale un échec de miroir dans le flux. On veut savoir s'il apparaît.
  if (JSON.stringify(message).includes('mirror_error')) {
    horodate('☠ mirror_error observé dans le flux')
  }
}

const parMethode = new Map<string, number>()
for (const appel of appels) parMethode.set(appel.methode, (parMethode.get(appel.methode) ?? 0) + 1)

console.log('\n— Clés brutes reçues par l\'adaptateur —')
for (const appel of appels.slice(0, 6)) {
  console.log(`  ${appel.methode}(${appel.cle.slice(0, 90)}) ${appel.detail}`)
}

console.log('\n— Ce que le SDK a réellement sollicité —')
if (parMethode.size === 0) {
  console.log('✗ AUCUN appel : le SDK n\'a pas utilisé l\'adaptateur du tout')
} else {
  for (const [methode, n] of [...parMethode].sort()) console.log(`  ${methode} : ${n} appel(s)`)
}

const cadences = appels
  .filter((a) => a.methode === 'append')
  .map((a, i, tous) => (i === 0 ? 0 : a.a - (tous[i - 1]?.a ?? a.a)))
  .filter((d) => d > 0)
if (cadences.length > 0) {
  const moyenne = Math.round(cadences.reduce((s, d) => s + d, 0) / cadences.length)
  console.log(`  cadence moyenne entre append : ${moyenne} ms (min ${Math.min(...cadences)}, max ${Math.max(...cadences)})`)
}

// La `projectKey` réellement employée par le SDK se lit dans les appels observés :
// on ne la devine pas, on la relit — c'est tout l'intérêt du banc.
const clesVues = appels
  .map((a) => {
    try {
      return JSON.parse(a.cle) as { projectKey?: string; sessionId?: string }
    } catch {
      return null
    }
  })
  .filter((k): k is { projectKey: string; sessionId: string } => typeof k?.projectKey === 'string')

const projectKey = clesVues[0]?.projectKey ?? ''
console.log(`\n— Contenu réellement persisté —\n  projectKey observée : « ${projectKey} »`)

const sessions = await store.listSessions(projectKey)
console.log(`  sessions listées : ${JSON.stringify(sessions).slice(0, 200)}`)

if (sessionId !== null && projectKey !== '') {
  const cle = { projectKey, sessionId }
  const entrees = await store.load(cle)
  console.log(`  transcript principal → ${Array.isArray(entrees) ? entrees.length : 0} entrée(s)`)
  console.log(`\n— État du miroir —\n  ${JSON.stringify(store.etatMiroir(cle))}`)
}

const succes = parMethode.size > 0 && (parMethode.get('append') ?? 0) > 0
console.log(`\n${succes ? '✓' : '✗'} le SDK sollicite réellement l'adaptateur`)
fermer()
process.exit(succes ? 0 : 1)
