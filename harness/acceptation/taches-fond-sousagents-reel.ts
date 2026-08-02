/**
 * Banc d'essai RÉEL — pourquoi la garde « des tâches de fond vivent » lâche.
 *
 * `☠ CE QUE CE BANC MESURE` : le harness refuse de conclure la fin d'une équipe
 * tant que `background_tasks_changed` porte des tâches (`collecteur-telemetrie.ts`).
 * Mesuré en prod le 02/08 sur la mission ab7183f0 (7,72 $ perdus) : la garde a
 * TENU au premier `result` (16:34:14, quatre agents en fond), puis a LÂCHÉ au
 * second (16:37:51) alors que trois agents tournaient encore — leurs trois
 * notifications sont arrivées 2 s plus tard dans une session déjà fermée.
 *
 * Question à trancher, et une seule : entre la notification d'UNE tâche et le
 * `result` du tour qui la lit, que porte `background_tasks_changed` ? S'il tombe
 * à zéro alors que d'autres tâches vivent, la garde est bâtie sur un signal qui
 * ment, et aucune correction du côté harness ne tient sans un second témoin.
 *
 * Scénario, calqué sur la panne : deux sous-agents en arrière-plan, l'un court
 * (~5 s), l'autre long (~90 s), et l'ordre explicite de rendre la main dès le
 * premier arrivé — c'est mot pour mot ce que le lead a fait en prod.
 *
 * ☠ Aucune action dangereuse : les sous-agents dorment et comptent.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session facturée.
 *
 * Usage : bun run acceptation/taches-fond-sousagents-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CollecteurTelemetrie } from '../superviseur/collecteur-telemetrie.ts'

const COMPTE = process.env['COMPTE'] ?? 'compte-a'
const PLAFOND_MS = 5 * 60_000

const debut = Date.now()
const horodatage = (): string => `+${((Date.now() - debut) / 1000).toFixed(1)}s`

interface Trace {
  readonly a: string
  readonly quoi: string
  readonly detail: string
}
const journal: Trace[] = []
function tracer(quoi: string, detail: string): void {
  const t = { a: horodatage(), quoi, detail }
  journal.push(t)
  console.log(`[${t.a}] ${quoi} — ${detail}`)
}

let resultats = 0
let dernierNiveauTaches: number | null = null
/** Ce qu'il faut prouver : un `result` émis alors que le niveau annoncé est 0 mais qu'une tâche vit encore. */
let resultAvecNiveauZero = 0

/**
 * Le VRAI collecteur du harness, alimenté par le VRAI flux : c'est lui qui
 * répond « garder la session ouverte ou non » en production.
 */
const collecteur = new CollecteurTelemetrie()
collecteur.ouvrir('banc', 'session-banc')

/**
 * Réplique de la règle D'AVANT le correctif — vidage des tâches de fond sur
 * chaque `init`. Tenue en parallèle pour que le même run montre les deux
 * verdicts : sans elle, on mesurerait le correctif sans jamais voir la panne.
 */
let ancienNiveau = 0
/** Les `result` où l'ancienne règle tuait l'équipe et où la nouvelle la garde. */
let equipesSauvees = 0

const options: Options = {
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  model: 'sonnet',
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
  forwardSubagentText: true,
  abortController: new AbortController(),
}

const PROMPT =
  'Lance MAINTENANT deux outils Agent EN ARRIÈRE-PLAN (run_in_background: true, ' +
  'subagent_type: general-purpose), dans un seul message. ' +
  'Agent COURT : « Exécute la commande shell `sleep 5` puis réponds seulement COURT-FINI. » ' +
  'Agent LONG : « Exécute la commande shell `sleep 90` puis réponds seulement LONG-FINI. » ' +
  'Ensuite, réponds une seule phrase disant que les deux tournent, et RENDS LA MAIN. ' +
  "Dès qu'un des deux te notifie sa fin, réponds une seule phrase disant lequel a fini " +
  "et que tu attends l'autre, puis RENDS LA MAIN à nouveau. N'attends jamais dans un même tour."

console.log(`[banc] compte ${COMPTE} · 2 sous-agents en arrière-plan (5 s / 90 s) · plafond ${PLAFOND_MS / 1000}s`)

const q = query({ prompt: PROMPT, options })
const minuterie = setTimeout(() => {
  tracer('PLAFOND', 'temps de banc écoulé — abandon du flux')
  options.abortController?.abort()
}, PLAFOND_MS)

try {
  for await (const message of q as AsyncIterable<SDKMessage>) {
    const sonde = message as unknown as {
      type: string
      subtype?: string
      tasks?: { task_id?: string; task_type?: string; description?: string }[]
      terminal_reason?: unknown
      total_cost_usd?: number
      message?: { content?: unknown }
    }

    collecteur.ingerer('banc', message)
    if (sonde.type === 'system' && sonde.subtype === 'init') ancienNiveau = 0

    if (sonde.type === 'system' && sonde.subtype === 'background_tasks_changed') {
      const taches = Array.isArray(sonde.tasks) ? sonde.tasks : []
      dernierNiveauTaches = taches.length
      ancienNiveau = taches.length
      tracer('TACHES', `niveau annoncé = ${taches.length} · ${taches.map((t) => t.description ?? t.task_id).join(' | ')}`)
      continue
    }

    if (sonde.type === 'system') {
      tracer('SYSTEM', String(sonde.subtype))
      continue
    }

    if (sonde.type === 'assistant') {
      const contenu = sonde.message?.content
      if (Array.isArray(contenu)) {
        for (const bloc of contenu as { type?: string; text?: string; name?: string; input?: unknown }[]) {
          if (bloc.type === 'tool_use') {
            const entree = (bloc.input ?? {}) as { run_in_background?: unknown; description?: unknown }
            tracer('OUTIL', `${bloc.name} bg=${String(entree.run_in_background)} ${String(entree.description ?? '')}`)
          } else if (bloc.type === 'text' && bloc.text?.trim()) {
            tracer('TEXTE', bloc.text.trim().slice(0, 140))
          }
        }
      }
      continue
    }

    if (sonde.type === 'user') {
      const contenu = sonde.message?.content
      const brut = typeof contenu === 'string' ? contenu : JSON.stringify(contenu)
      if (brut.includes('task-notification')) tracer('NOTIF', brut.slice(0, 160))
      continue
    }

    if (sonde.type === 'result') {
      resultats += 1
      const niveau = dernierNiveauTaches
      // C'est LA mesure : un `result` pendant que l'agent long dort encore.
      const longEncoreEnVol = Date.now() - debut < 90_000
      if (niveau === 0 && longEncoreEnVol) resultAvecNiveauZero += 1
      // Les deux verdicts, côte à côte, sur le même instant du même flux réel.
      const gardeCorrigee = collecteur.aDesTachesFond('banc')
      const gardeAncienne = ancienNiveau > 0
      if (gardeCorrigee && !gardeAncienne) equipesSauvees += 1
      tracer(
        'RESULT',
        `n°${resultats} · niveau annoncé = ${String(niveau)} · long en vol = ${longEncoreEnVol} · ` +
          `GARDE corrigée = ${gardeCorrigee ? 'session gardée' : 'ÉQUIPE TUÉE'} · ` +
          `garde d'avant = ${gardeAncienne ? 'session gardée' : 'ÉQUIPE TUÉE'} · ` +
          `terminal_reason = ${JSON.stringify(sonde.terminal_reason)} · coût = ${sonde.total_cost_usd ?? 0}`,
      )
      // Le harness ne raccroche pas sur un `result` : on continue d'écouter, exactement comme lui.
    }
  }
  tracer('FLUX', 'fin naturelle du flux')
} catch (erreur) {
  tracer('ERREUR', erreur instanceof Error ? erreur.message : String(erreur))
} finally {
  clearTimeout(minuterie)
}

console.log('\n===== VERDICT =====')
console.log(`results observés               : ${resultats}`)
console.log(`dernier niveau annoncé         : ${String(dernierNiveauTaches)}`)
console.log(`results à niveau 0 en vol      : ${resultAvecNiveauZero}`)
console.log(`équipes sauvées par le correctif : ${equipesSauvees}`)
console.log(
  equipesSauvees > 0
    ? '⇒ CONFIRMÉ sur flux réel : au moins un `result` où la règle d’avant tuait l’équipe\n' +
        '  (un `init` de reprise avait effacé ses tâches de fond) et où la règle corrigée la garde.'
    : '⇒ Aucun écart mesuré sur ce run : le flux n’a pas produit d’`init` entre une tâche\n' +
        '  vivante et un `result`. Relancer — la fenêtre dépend du minutage des sous-agents.',
)
