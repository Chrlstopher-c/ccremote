/**
 * Banc d'essai RÉEL — dette n°3, dernier point : les niveaux d'effort réellement
 * disponibles par modèle (H-71, maquette v3).
 *
 * La maquette v3 prête cinq niveaux d'effort à `opus-4-7` et `sonnet-4-6` sur la
 * seule foi qu'ils répondent. C'est une hypothèse optimiste, et elle est
 * dangereuse dans ce sens précis :
 *
 * `☠` Un niveau d'effort invalide est **silencieusement ignoré** par le SDK,
 * jamais rejeté — la doc du champ `effort` le dit : « after any silent downgrade
 * for the selected model ». Rien ne signalerait donc l'erreur : l'UI afficherait
 * « max », le modèle tournerait à autre chose, et personne ne le saurait.
 *
 * `supportedModels()` expose `supportsEffort`, `supportedEffortLevels` et
 * `supportsAdaptiveThinking` — c'est la source d'autorité. On la lit au lieu de
 * la deviner.
 *
 * ☠ Aucune action dangereuse : une seule question triviale, aucun outil.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session.
 *
 * Usage : bun run acceptation/modeles-effort-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const COMPTE = process.env['COMPTE'] ?? 'compte-a'

/** Ceux que H-71 déclare éligibles au choix dans le fil de l'orchestrateur. */
const ELIGIBLES_H71 = new Set(['claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-7'])

const options: Options = {
  permissionMode: 'auto',
  model: 'sonnet',
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
}

const q = query({ prompt: 'Réponds uniquement : OK', options })
const m = q as unknown as Record<string, unknown>

interface ModeleLu {
  readonly value?: string
  readonly resolvedModel?: string
  readonly displayName?: string
  readonly supportsEffort?: boolean
  readonly supportedEffortLevels?: readonly string[]
  readonly supportsAdaptiveThinking?: boolean
  readonly supportsFastMode?: boolean
}

let modeles: readonly ModeleLu[] = []

for await (const message of q as AsyncIterable<SDKMessage>) {
  // ☠ Lu PENDANT que la session vit : après `result`, le transport est fermé.
  if (message.type === 'assistant' && modeles.length === 0) {
    const fn = m['supportedModels']
    if (typeof fn === 'function') {
      try {
        modeles = (await (fn as () => Promise<unknown>).call(q)) as readonly ModeleLu[]
      } catch (erreur) {
        console.error('[banc] supportedModels() a levé :', erreur)
      }
    }
  }
  if (message.type === 'result') break
}

console.log(`[banc] ${modeles.length} modèles exposés par supportedModels() sur ${COMPTE}\n`)

for (const mod of modeles) {
  const id = mod.resolvedModel ?? mod.value ?? '(sans id)'
  const marque = ELIGIBLES_H71.has(id) ? '★' : ' '
  const niveaux = mod.supportedEffortLevels
  console.log(
    `${marque} ${id.padEnd(30)} effort=${String(mod.supportsEffort ?? false).padEnd(5)} ` +
      `niveaux=${niveaux === undefined ? '(absent)' : `[${niveaux.join(',')}]`} ` +
      `adaptatif=${String(mod.supportsAdaptiveThinking ?? false).padEnd(5)} rapide=${String(mod.supportsFastMode ?? false)}`,
  )
}

console.log('\n— Ce que H-71 tient pour acquis, confronté à la mesure —')
for (const id of ELIGIBLES_H71) {
  const trouve = modeles.find((mod) => mod.resolvedModel === id || mod.value === id)
  if (trouve === undefined) {
    console.log(`☠ ${id.padEnd(30)} ABSENT de supportedModels() — l'UI ne doit pas lui prêter de niveaux d'effort`)
    continue
  }
  const n = trouve.supportedEffortLevels?.length ?? 0
  console.log(`${n > 0 ? '✓' : '☠'} ${id.padEnd(30)} ${n} niveau(x) réellement déclaré(s)`)
}

// `ultracode` (Settings) : xhigh + orchestration de workflows dynamiques, portée
// session. Documenté comme exigeant workflows activés ET un modèle xhigh-capable
// ⇒ il ne peut être proposé dans l'UI que pour les modèles listant `xhigh`.
const xhighCapables = modeles.filter((mod) => mod.supportedEffortLevels?.includes('xhigh')).map((mod) => mod.resolvedModel ?? mod.value)
console.log(`\n· modèles capables de 'xhigh' (donc éligibles à ultracode) : ${xhighCapables.join(', ') || 'aucun'}`)

process.exit(modeles.length > 0 ? 0 : 1)
