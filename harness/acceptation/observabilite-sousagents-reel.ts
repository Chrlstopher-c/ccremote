/**
 * Banc d'essai RÉEL — la mesure dont dépend TOUTE l'architecture de M-50 (H-72.1).
 *
 * Question, posée par Chris : on veut voir en temps réel le travail de chaque sous-agent
 * dans l'UI, SANS que ce flux entre dans le contexte d'un modèle. Le SDK expose
 * `forwardSubagentText` — mais alimente-t-elle :
 *   (a) seulement le FLUX lu par notre programme  ⇒ outil idéal pour l'UI, gratuit ;
 *   (b) aussi le CONTEXTE du modèle parent        ⇒ viole H-45/H-72.1, il faudra lire
 *       les transcripts à la source (JSONL / SessionStore).
 *
 * Méthode : une même tâche déléguée à un sous-agent, jouée deux fois — sans puis avec
 * `forwardSubagentText`. On compare (1) ce qui arrive dans le flux, (2) le contexte
 * consommé par le parent, mesuré via `getContextUsage()` PENDANT la session.
 *
 * Si le contexte du parent est identique dans les deux cas, l'option ne touche que le
 * flux : réponse (a).
 *
 * ☠ Aucune action dangereuse : le sous-agent ne fait que lire et résumer.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre de vraies sessions.
 *
 * Usage : bun run acceptation/observabilite-sousagents-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const COMPTE = process.env['COMPTE'] ?? 'compte-a'

interface Mesure {
  readonly libelle: string
  messagesTotal: number
  messagesAvecParent: number
  blocsTexteSousAgent: number
  contexteMessagesTokens: number | null
  contexteTotalTokens: number | null
}

/** Lit la catégorie « Messages » du contexte — la seule qui grossit avec la conversation. */
function lireContexte(usage: unknown): { messages: number | null; total: number | null } {
  if (usage === null || typeof usage !== 'object') return { messages: null, total: null }
  const u = usage as { categories?: { name?: string; tokens?: number }[]; totalTokens?: number }
  const cat = u.categories?.find((c) => c.name === 'Messages')
  return { messages: cat?.tokens ?? null, total: u.totalTokens ?? null }
}

async function jouer(libelle: string, forward: boolean): Promise<Mesure> {
  const mesure: Mesure = {
    libelle,
    messagesTotal: 0,
    messagesAvecParent: 0,
    blocsTexteSousAgent: 0,
    contexteMessagesTokens: null,
    contexteTotalTokens: null,
  }

  const options: Options = {
    permissionMode: 'auto',
    model: 'sonnet',
    env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
    forwardSubagentText: forward,
  }

  const q = query({
    prompt:
      'Utilise l\'outil Task pour déléguer à un sous-agent general-purpose la tâche suivante : ' +
      '« compte de 1 à 20 en expliquant brièvement chaque nombre ». ' +
      'Quand il a fini, réponds simplement : FAIT.',
    options,
  })
  const m = q as unknown as Record<string, unknown>

  for await (const message of q as AsyncIterable<SDKMessage>) {
    mesure.messagesTotal += 1

    // Un message issu d'un sous-agent porte `parent_tool_use_id` (chaînage H-72).
    const brut = message as unknown as { parent_tool_use_id?: unknown; message?: { content?: unknown } }
    if (brut.parent_tool_use_id != null) {
      mesure.messagesAvecParent += 1
      const contenu = brut.message?.content
      if (Array.isArray(contenu)) {
        for (const bloc of contenu as { type?: string }[]) {
          if (bloc.type === 'text' || bloc.type === 'thinking') mesure.blocsTexteSousAgent += 1
        }
      }
    }

    // ☠ Mesuré PENDANT que la session vit : après le `result`, le transport est fermé.
    if (message.type === 'result') {
      const fn = m['getContextUsage']
      if (typeof fn === 'function') {
        try {
          const lu = lireContexte(await (fn as () => Promise<unknown>).call(q))
          mesure.contexteMessagesTokens = lu.messages
          mesure.contexteTotalTokens = lu.total
        } catch {
          /* transport déjà fermé — laissé à null, visible dans le rapport */
        }
      }
      break
    }
  }
  return mesure
}

// ⚠ Le contexte se lit mal après `result`. On échantillonne aussi en cours de route.
const sans = await jouer('forwardSubagentText: false', false)
console.log(`[banc] ${sans.libelle} terminé`)
const avec = await jouer('forwardSubagentText: true', true)
console.log(`[banc] ${avec.libelle} terminé`)

console.log('\n— Ce qui arrive dans le FLUX (lu par notre programme) —')
for (const mes of [sans, avec]) {
  console.log(
    `  ${mes.libelle.padEnd(32)} messages=${mes.messagesTotal} · ` +
      `avec parent_tool_use_id=${mes.messagesAvecParent} · blocs texte/thinking de sous-agent=${mes.blocsTexteSousAgent}`,
  )
}

console.log('\n— CONTEXTE du modèle parent (catégorie « Messages ») —')
for (const mes of [sans, avec]) {
  console.log(
    `  ${mes.libelle.padEnd(32)} messages=${mes.contexteMessagesTokens ?? 'non lu'} tokens · ` +
      `total=${mes.contexteTotalTokens ?? 'non lu'} tokens`,
  )
}

const fluxAugmente = avec.blocsTexteSousAgent > sans.blocsTexteSousAgent
console.log('\n— Verdict —')
console.log(`${fluxAugmente ? '✓' : '✗'} l'option enrichit bien le flux du programme`)
if (sans.contexteMessagesTokens !== null && avec.contexteMessagesTokens !== null) {
  const ecart = avec.contexteMessagesTokens - sans.contexteMessagesTokens
  console.log(`· écart de contexte parent : ${ecart > 0 ? '+' : ''}${ecart} tokens`)
  console.log(
    ecart <= 0
      ? '✓ le contexte du parent n\'augmente PAS ⇒ option sûre pour l\'UI (H-72.1 respecté)'
      : '☠ le contexte du parent AUGMENTE ⇒ option interdite, lire les transcripts à la source',
  )
} else {
  console.log('· contexte non lisible sur ce run — voir la doc : « so consumers can render a nested transcript »')
}
process.exit(0)
