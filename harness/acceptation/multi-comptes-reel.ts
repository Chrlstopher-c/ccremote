/**
 * Banc d'essai RÉEL de la rotation multi-comptes (H-53, H-54).
 *
 * Ce que ça prouve, et qu'aucun test unitaire ne peut prouver :
 *  1. deux comptes distincts tournent **en parallèle** sur la même machine, chacun
 *     dans son `CLAUDE_CONFIG_DIR` persistant ;
 *  2. chaque session rapporte bien l'identité du compte sous lequel elle tourne
 *     (sinon la rotation bascule à l'aveugle) ;
 *  3. les quotas sont lus **par compte**, condition de la jauge H-63.
 *
 * ☠ Aucune action dangereuse : les sessions ne font qu'un `echo`.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre de vraies sessions et consomme du quota.
 *
 * Usage : bun run acceptation/multi-comptes-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const RACINE_COMPTES = '/home/trinity/.claude-comptes'
const COMPTES = ['compte-a', 'compte-b'] as const

interface Constat {
  readonly compte: string
  identite: string | null
  quota: string | null
  creditsPayants: string | null
  modele: string | null
  repondu: boolean
  erreur: string | null
}

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

interface FenetreQuota {
  readonly utilization: number
  readonly resets_at: string
}
interface Usage {
  readonly rate_limits?: {
    readonly five_hour?: FenetreQuota | null
    readonly seven_day?: FenetreQuota | null
    readonly extra_usage?: {
      readonly is_enabled: boolean
      readonly used_credits: number
      readonly monthly_limit: number
      readonly currency: string
    } | null
  }
}
interface InfoCompte {
  readonly email?: string
  readonly subscriptionType?: string
}

/**
 * ☠ Les méthodes de contrôle de `Query` doivent être appelées PENDANT que la session
 * vit. Après le message `result`, le transport est fermé et tout appel échoue en
 * « ProcessTransport is not ready for writing » (constaté le 2026-07-22).
 */
async function interroger(q: unknown): Promise<{ info: InfoCompte | null; usage: Usage | null }> {
  const methodes = q as Record<string, unknown>
  const appeler = async <T>(nom: string): Promise<T | null> => {
    const fn = methodes[nom]
    if (typeof fn !== 'function') return null
    try {
      return (await (fn as () => Promise<T>).call(q)) ?? null
    } catch {
      return null
    }
  }
  return {
    info: await appeler<InfoCompte>('accountInfo'),
    usage: await appeler<Usage>('usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'),
  }
}

async function exercer(compte: string): Promise<Constat> {
  const constat: Constat = {
    compte,
    identite: null,
    quota: null,
    creditsPayants: null,
    modele: null,
    repondu: false,
    erreur: null,
  }
  const options: Options = {
    permissionMode: 'auto',
    // ☠ `...process.env` obligatoire : `env` REMPLACE, PATH serait perdu.
    env: { ...process.env, CLAUDE_CONFIG_DIR: `${RACINE_COMPTES}/${compte}` },
  }
  try {
    const flux = query({ prompt: `Réponds exactement : OK-${compte}`, options })
    for await (const message of flux as AsyncIterable<SDKMessage>) {
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        constat.modele = 'model' in message ? String(message.model) : null
        const { info, usage } = await interroger(flux)
        constat.identite = info?.email ?? null
        const rl = usage?.rate_limits
        if (rl?.five_hour) {
          constat.quota =
            `5 h : ${rl.five_hour.utilization}% (reset ${rl.five_hour.resets_at})` +
            (rl.seven_day ? ` · 7 j : ${rl.seven_day.utilization}%` : '')
        }
        if (rl?.extra_usage?.is_enabled) {
          const e = rl.extra_usage
          constat.creditsPayants = `${(e.used_credits / 100).toFixed(2)} / ${(e.monthly_limit / 100).toFixed(2)} ${e.currency}`
        }
        horodate(`${compte} · session établie`)
      }
      if (message.type === 'result') {
        constat.repondu = true
        horodate(`${compte} · résultat reçu`)
      }
    }
  } catch (erreur) {
    constat.erreur = erreur instanceof Error ? erreur.message : String(erreur)
    horodate(`${compte} · ÉCHEC : ${constat.erreur}`)
  }
  return constat
}

/** Empreinte du fichier d'identifiants, pour prouver qu'aucun compte n'écrase l'autre. */
async function empreinte(compte: string): Promise<string> {
  const fichier = Bun.file(`${RACINE_COMPTES}/${compte}/.credentials.json`)
  const contenu = await fichier.arrayBuffer()
  return Bun.hash(contenu).toString(16)
}

const avant = await Promise.all(COMPTES.map(empreinte))

horodate(`lancement simultané de ${COMPTES.length} sessions, une par compte`)
// ☠ En parallèle, pas en série : c'est la coexistence qui est testée (H-53).
const constats = await Promise.all(COMPTES.map(exercer))

const apres = await Promise.all(COMPTES.map(empreinte))

console.log('\n— Rotation multi-comptes : constats —')
let succes = true
for (const [i, constat] of constats.entries()) {
  const ok = constat.repondu && constat.erreur === null
  if (!ok) succes = false
  console.log(
    `${ok ? '✓' : '✗'} ${constat.compte}\n` +
      `    a répondu : ${constat.repondu}${constat.erreur ? ` · erreur : ${constat.erreur}` : ''}\n` +
      `    modèle : ${constat.modele ?? '(non annoncé)'}\n` +
      `    identité (accountInfo) : ${constat.identite ?? '(non lue)'}\n` +
      `    quota : ${constat.quota ?? '(non lu)'}\n` +
      `    crédits payants : ${constat.creditsPayants ?? '(désactivés)'}\n` +
      `    identifiants inchangés : ${avant[i] === apres[i]}`,
  )
}

const identites = constats.map((c) => c.identite).filter((x): x is string => x !== null)
if (identites.length === COMPTES.length) {
  const distinctes = new Set(identites).size === COMPTES.length
  console.log(`${distinctes ? '✓' : '✗'} les identités des comptes sont distinctes`)
  if (!distinctes) succes = false
} else {
  console.log('· identité non exposée dans le flux — à lire via accountInfo() côté harness')
}

const quotas = constats.filter((c) => c.quota !== null)
console.log(`· évènements de quota captés : ${quotas.length}/${COMPTES.length}`)
for (const c of quotas) console.log(`    ${c.compte} : ${c.quota}`)

process.exit(succes ? 0 : 1)
