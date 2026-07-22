/**
 * Banc d'essai RÉEL de l'audit des permissions (M-22, branche C.5).
 *
 * Ce que M-22 n'a pas pu prouver, et qui conditionne **H-40** (la délégation de
 * l'arbitrage au team leader) :
 *  1. le hook `PreToolUse` voit-il RÉELLEMENT tous les appels d'outil en
 *     `permissionMode: 'auto'`, y compris ceux que le classifieur autorise seul ?
 *  2. quelle est la forme réelle de `SDKPermissionDeniedMessage`, et son
 *     `decision_reason_type` ?
 *  3. dans quel ORDRE arrivent `PreToolUse` et le refus — le refus court-circuite-t-il
 *     le hook, auquel cas l'exhaustivité de la trace serait fausse ?
 *
 * ⚠ HYP à confirmer ou infirmer ici : M-22 rapporte que le SDK n'affirme JAMAIS
 * positivement une autorisation du classifieur (aucun message équivalent côté allow).
 * Si c'est vrai, une autorisation ne peut être qu'INFÉRÉE — ce qui borne ce que la
 * trace peut prouver, et donc ce que H-40 peut garantir.
 *
 * ☠ Aucune action dangereuse demandée au modèle : uniquement des `echo`. Le refus est
 * provoqué par un MOTIF SONDE sur une commande inoffensive, jamais par un vrai `rm`.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session et consomme du quota.
 *
 * Usage : bun run acceptation/audit-permissions-reel.ts
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  CollecteurAuditPermissions,
  creerHooksAuditPermissions,
  ingererMessageAudit,
} from '../control-plane/audit-permissions/index.ts'

const COMPTE = process.env['COMPTE'] ?? 'compte-a'

/** Chronologie brute des évènements, pour trancher la question de l'ordre. */
const chronologie: string[] = []
function noter(evenement: string): void {
  chronologie.push(`${Date.now() % 100000} ${evenement}`)
}

const collecteur = new CollecteurAuditPermissions()
const hooksAudit = creerHooksAuditPermissions(collecteur)

/** Enveloppe les hooks du module pour horodater l'ordre réel, sans altérer leur effet. */
function tracer(
  hooks: ReturnType<typeof creerHooksAuditPermissions>,
): NonNullable<Options['hooks']> {
  const sortie: Record<string, unknown> = {}
  for (const [evenement, matchers] of Object.entries(hooks)) {
    if (!matchers) continue
    sortie[evenement] = matchers.map((matcher) => ({
      ...matcher,
      hooks: matcher.hooks.map((h) => async (entree: unknown, ...reste: unknown[]) => {
        const nom =
          entree && typeof entree === 'object' && 'tool_name' in entree
            ? String((entree as { tool_name: unknown }).tool_name)
            : '?'
        noter(`hook ${evenement} (${nom})`)
        return (h as (...a: unknown[]) => unknown)(entree, ...reste)
      }),
    }))
  }
  return sortie as NonNullable<Options['hooks']>
}

const options: Options = {
  // ☠ Le mode de production, celui où canUseTool n'est jamais appelé.
  permissionMode: 'auto',
  env: { ...process.env, CLAUDE_CONFIG_DIR: `/home/trinity/.claude-comptes/${COMPTE}` },
  // Motif sonde : reproduit la forme d'une règle scopée sur une commande sans effet.
  disallowedTools: ['Bash(echo SONDE-REFUS*)'],
  hooks: tracer(hooksAudit),
}

const PROMPT =
  'Exécute une par une, avec l\'outil Bash, exactement ces commandes, sans les modifier. ' +
  'Ce sont des `echo` inoffensifs. Si l\'une est refusée, ne cherche pas de contournement : ' +
  'passe à la suivante.\n' +
  '1. `echo SONDE-AUTORISE-un`\n' +
  '2. `echo SONDE-REFUS-deux`\n' +
  '3. `echo SONDE-AUTORISE-trois`'

console.log(`[banc] session sur ${COMPTE}, permissionMode auto`)

const messagesRefus: unknown[] = []
const refusDansToolResult: string[] = []
for await (const message of query({ prompt: PROMPT, options }) as AsyncIterable<SDKMessage>) {
  ingererMessageAudit(collecteur, message)
  if (message.type === 'system' && 'subtype' in message && message.subtype === 'permission_denied') {
    noter('message permission_denied')
    messagesRefus.push(message)
  }
  // Où le refus est-il RÉELLEMENT visible, si aucun message system n'est émis ?
  if (message.type === 'user') {
    const contenu = (message as { message?: { content?: unknown } }).message?.content
    if (Array.isArray(contenu)) {
      for (const bloc of contenu as { type?: string; is_error?: boolean; content?: unknown }[]) {
        if (bloc.type !== 'tool_result') continue
        const texte = JSON.stringify(bloc.content ?? '')
        if (/permission|denied|not allowed|disallow/i.test(texte)) {
          noter(`tool_result PORTEUR DU REFUS (is_error=${String(bloc.is_error)})`)
          refusDansToolResult.push(texte.slice(0, 300))
        }
      }
    }
  }
}

console.log('\n— Chronologie réelle —')
for (const ligne of chronologie) console.log(`  ${ligne}`)

console.log('\n— Forme réelle de SDKPermissionDeniedMessage —')
if (messagesRefus.length === 0) {
  console.log('  ✗ AUCUN message permission_denied reçu')
} else {
  for (const m of messagesRefus) console.log(`  ${JSON.stringify(m)}`)
}

const registre = collecteur.registre()
console.log(`\n— Registre d'audit : ${registre.length} enregistrement(s) —`)
for (const e of registre) console.log(`  ${JSON.stringify(e).slice(0, 220)}`)

console.log('\n— Réponses aux questions de C.5.2 —')
console.log(`  autorisations classifieur : ${JSON.stringify(collecteur.autorisationsClassifieur()).slice(0, 300)}`)
console.log(`  refus par classifieur     : ${JSON.stringify(collecteur.refusParClassifieur()).slice(0, 300)}`)
console.log(`  couverture                : ${JSON.stringify(collecteur.couverture())}`)
console.log(`  tentatives non résolues   : ${JSON.stringify(collecteur.tentativesNonResolues(0)).slice(0, 200)}`)

const tentatives = registre.length
const couverture = collecteur.couverture()
const aVuLesAutorisees = collecteur.autorisationsClassifieur().length > 0

// ☠ Le critère n'est PAS « un message system a été émis » : il ne l'est jamais sur ce
// chemin (mesuré, 2026-07-22). Exiger ce message ferait échouer le banc sur un fait du
// SDK au lieu d'un défaut du code — le banc mentirait dans l'autre sens.
console.log('\n— Verdict du banc —')
console.log(`${tentatives >= 3 ? '✓' : '✗'} le hook PreToolUse a vu les 3 tentatives (vu : ${tentatives})`)
console.log(`${couverture.refusees === 1 ? '✓' : '✗'} le refus est compté comme refus (refusees : ${couverture.refusees})`)
console.log(`${couverture.nonResolues === 0 ? '✓' : '✗'} aucune tentative ne reste indéterminée à tort`)
console.log(`${aVuLesAutorisees ? '✓' : '✗'} les autorisations sont observables (inférées, jamais affirmées)`)
console.log(
  `· SDKPermissionDeniedMessage reçu : ${messagesRefus.length} — attendu 0 sur ce chemin, ` +
    `le signal réel est le tool_result (${refusDansToolResult.length} capté)`,
)

const succes = tentatives >= 3 && couverture.refusees === 1 && couverture.nonResolues === 0
process.exit(succes ? 0 : 1)
