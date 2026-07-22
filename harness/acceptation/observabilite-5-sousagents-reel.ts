/**
 * Banc d'essai RÉEL — le cas d'usage exact de Chris (H-72.1) : **cinq sous-agents en
 * parallèle**. C'est le moment où le feed du lead est vide et où l'opérateur est aveugle.
 *
 * H-72.2 a déjà mesuré, sur UN sous-agent, que `forwardSubagentText` enrichit le flux
 * sans charger le contexte du parent. Restait à vérifier ce que ça donne à cinq :
 *  1. le contexte du parent tient-il toujours ? (si non, H-72.1 est menacé)
 *  2. les `parent_tool_use_id` permettent-ils de **démêler** les cinq lignes de travail ?
 *     — c'est la condition pour que l'UI puisse afficher un onglet par sous-agent ;
 *  3. quel volume réel l'UI devra-t-elle encaisser ?
 *
 * ☠ Aucune action dangereuse : les sous-agents ne font qu'écrire du texte.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session avec 5 sous-agents.
 *
 * Usage : bun run acceptation/observabilite-5-sousagents-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const COMPTE = process.env['COMPTE'] ?? 'compte-a'

const SUJETS = ['la mer', 'la montagne', 'le désert', 'la forêt', 'la ville'] as const

interface LigneSousAgent {
  blocs: number
  caracteres: number
  premierVuA: number
  dernierVuA: number
}

/** Une ligne de travail par `parent_tool_use_id` — c'est ce que l'UI devra reconstituer. */
const lignes = new Map<string, LigneSousAgent>()
let tachesLancees = 0
let contexteMessages: number | null = null
let contexteFinal: number | null = null
const typesVus = new Map<string, number>()
const messagesHorsTronc: string[] = []
let resultat: { isError: boolean | null; terminalReason: unknown; tours: number | null; apiErrorStatus: unknown } | null =
  null
const debut = Date.now()

const options: Options = {
  permissionMode: 'auto',
  model: 'sonnet',
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
  // Le réglage validé par H-72.2 : enrichit le flux, pas le contexte du parent.
  forwardSubagentText: true,
}

const PROMPT =
  'Lance MAINTENANT cinq outils Agent EN PARALLÈLE, dans un seul et même message ' +
  '(subagent_type: general-purpose pour chacun). Prompt de chaque sous-agent : ' +
  SUJETS.map((s, i) => `(${i + 1}) « Écris un paragraphe de 100 mots sur ${s}, puis réponds seulement ce paragraphe. »`).join(' ') +
  ' N\'attends pas l\'un pour lancer l\'autre : les cinq doivent partir ensemble. ' +
  'Quand les cinq ont répondu, réponds uniquement : FAIT.'

console.log(`[banc] session sur ${COMPTE} · forwardSubagentText: true · 5 sous-agents attendus`)

const q = query({ prompt: PROMPT, options })
const m = q as unknown as Record<string, unknown>

async function lireContexteMessages(): Promise<number | null> {
  const fn = m['getContextUsage']
  if (typeof fn !== 'function') return null
  try {
    const u = (await (fn as () => Promise<unknown>).call(q)) as {
      categories?: { name?: string; tokens?: number }[]
    }
    return u.categories?.find((c) => c.name === 'Messages')?.tokens ?? null
  } catch {
    return null
  }
}

for await (const message of q as AsyncIterable<SDKMessage>) {
  const brut = message as unknown as {
    parent_tool_use_id?: unknown
    message?: { content?: unknown }
  }
  const contenu = brut.message?.content

  // Compter les Task réellement lancés — ☠ piège de H-72.2 : le modèle ne délègue pas
  // toujours ce qu'on lui demande. Sans cette vérification, la mesure ne vaut rien.
  if (Array.isArray(contenu) && brut.parent_tool_use_id == null) {
    for (const bloc of contenu as { type?: string; name?: string }[]) {
      // ☠ L'outil de délégation s'appelle `Agent`, PAS `Task` (mesuré 2026-07-22).
      if (bloc.type === 'tool_use' && bloc.name === 'Agent') tachesLancees += 1
    }
  }

  // Chaîner chaque fragment à SA ligne de travail (H-72 : `parent_tool_use_id`).
  if (typeof brut.parent_tool_use_id === 'string') {
    const cle = brut.parent_tool_use_id
    const ligne = lignes.get(cle) ?? {
      blocs: 0,
      caracteres: 0,
      premierVuA: Date.now() - debut,
      dernierVuA: Date.now() - debut,
    }
    if (Array.isArray(contenu)) {
      for (const bloc of contenu as { type?: string; text?: string; thinking?: string }[]) {
        if (bloc.type === 'text' || bloc.type === 'thinking') {
          ligne.blocs += 1
          ligne.caracteres += (bloc.text ?? bloc.thinking ?? '').length
        }
      }
    }
    ligne.dernierVuA = Date.now() - debut
    lignes.set(cle, ligne)
  }

  // ☠ NE PAS appeler `getContextUsage()` dans cette boucle : un appel de contrôle
  // pendant la lecture fait perdre les messages des sous-agents (mesuré 2026-07-22 —
  // 0 ligne reçue avec l'appel, 4 lignes sans). Le contexte se lit avant la boucle.

  typesVus.set(message.type, (typesVus.get(message.type) ?? 0) + 1)

  // Dette n°3 : les messages d'usage n'avaient jamais été vus en vrai. On capture
  // la forme exacte de tout message hors du tronc commun, pour que la
  // classification (M-51) s'appuie sur du mesuré et non sur les constantes seules.
  if (message.type !== 'assistant' && message.type !== 'user' && message.type !== 'result' && message.type !== 'system') {
    messagesHorsTronc.push(JSON.stringify(message).slice(0, 600))
  }

  if (message.type === 'result') {
    // ☠ Le résultat DOIT être inspecté : une session qui a échoué produit elle
    // aussi 0 ligne de sous-agent, et se lirait à tort comme « le flux ne
    // transmet rien ». Distinguer les deux est tout l'objet de ce banc.
    const r = message as unknown as {
      is_error?: boolean
      terminal_reason?: unknown
      num_turns?: number
      api_error_status?: unknown
    }
    resultat = {
      isError: r.is_error ?? null,
      terminalReason: r.terminal_reason ?? null,
      tours: r.num_turns ?? null,
      apiErrorStatus: r.api_error_status ?? null,
    }
    contexteFinal = await lireContexteMessages()
    break
  }
}

const duree = Date.now() - debut

console.log('\n— Lignes de travail démêlées par parent_tool_use_id —')
let i = 0
for (const [cle, l] of lignes) {
  i += 1
  console.log(
    `  ${i}. ${cle.slice(0, 24).padEnd(26)} blocs=${String(l.blocs).padStart(3)} · ` +
      `${String(l.caracteres).padStart(5)} car. · actif de +${(l.premierVuA / 1000).toFixed(1)}s à +${(l.dernierVuA / 1000).toFixed(1)}s`,
  )
}

const total = [...lignes.values()].reduce((s, l) => s + l.caracteres, 0)

// Recouvrement temporel = preuve que les lignes ont réellement tourné EN MÊME TEMPS,
// donc que le feed du lead était bien vide pendant ce temps (le problème de Chris).
const vals = [...lignes.values()]
const enParallele = vals.filter((a) => vals.some((b) => a !== b && a.premierVuA < b.dernierVuA && b.premierVuA < a.dernierVuA)).length

console.log('\n— Ce que la session a réellement fait —')
console.log(`  types de messages vus : ${[...typesVus].map(([t, n]) => `${t}×${n}`).join(' · ')}`)
console.log(
  `  résultat : is_error=${resultat?.isError ?? 'n/a'} · terminal_reason=${String(resultat?.terminalReason ?? 'n/a')} ` +
    `· tours=${resultat?.tours ?? 'n/a'} · api_error_status=${String(resultat?.apiErrorStatus ?? 'n/a')}`,
)

for (const brut of messagesHorsTronc) console.log(`\n— message hors tronc commun (forme réelle) —\n  ${brut}`)

console.log('\n— Verdict du banc —')
console.log(`${tachesLancees >= 5 ? '✓' : '✗'} cinq sous-agents réellement lancés (vu : ${tachesLancees})`)
console.log(`${lignes.size >= 5 ? '✓' : '✗'} cinq lignes de travail distinctes et démêlables (vu : ${lignes.size})`)
console.log(`${enParallele >= 2 ? '✓' : '✗'} lignes réellement concurrentes dans le temps (vu : ${enParallele})`)
console.log(`· volume total de contenu de sous-agents dans le flux : ${total} caractères en ${(duree / 1000).toFixed(1)} s`)
console.log(`· contexte du parent — 1er assistant : ${contexteMessages ?? 'non lu'} tokens · fin : ${contexteFinal ?? 'non lu'} tokens`)

const succes = tachesLancees >= 5 && lignes.size >= 5
process.exit(succes ? 0 : 1)
