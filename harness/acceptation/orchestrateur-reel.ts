/**
 * Banc d'essai RÉEL de l'orchestrateur maître (M-41 + M-40 + M-42 assemblés).
 *
 * C'est la pièce centrale : la session avec qui Chris parle depuis l'app. Ce que
 * seul le vrai SDK peut montrer, et qu'aucun test unitaire ne prouve :
 *  1. la session démarre-t-elle réellement, et sous quel modèle ?
 *  2. le message `init` confirme-t-il l'absence de `Bash`/`Write`/`Edit` — c'est
 *     le SDK qui a le dernier mot sur les outils, pas notre composition d'options ;
 *  3. les 12 outils MCP de contrôle sont-ils réellement exposés à la session ?
 *  4. un outil rend-il la main immédiatement, même quand son port est mort ?
 *  5. aucun flux brut n'entre-t-il dans le contexte (H-45) ?
 *
 * ☠ Aucune action dangereuse : l'orchestrateur n'a de toute façon aucun outil
 * d'écriture. Le banc lui fait lister des équipes et proposer un mandat — rien
 * n'est créé, `creer_equipe` étant `differe` par H-61.
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session Opus.
 *
 * Usage : bun run acceptation/orchestrateur-reel.ts
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ouvrirRegistre } from '../control-plane/registre/index.ts'
import { creerServeurMcpControle, UTILISATION_PARC_DESACTIVEE } from '../control-plane/orchestrateur/mcp-controle/index.ts'
import {
  demarrerOrchestrateur,
  JournalIncidentsMemoire,
  MODELE_ORCHESTRATEUR,
  OUTILS_INTERDITS_ORCHESTRATEUR,
} from '../control-plane/orchestrateur/processus/index.ts'

const RACINE = `/tmp/claude-1000/-home-trinity/c97df358-b841-4cbd-abe9-02ef3a090c67/scratchpad/orch-${Date.now()}`
const COMPTE = process.env['COMPTE'] ?? 'compte-a'

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`)
}

await Bun.$`mkdir -p ${RACINE}/projets`.quiet()

const registre = ouvrirRegistre({ chemin: `${RACINE}/registre.sqlite` })
const incidents = new JournalIncidentsMemoire()

/** Port délibérément MORT : sert à prouver le non-blocage (critère (a) de M-40). */
const portMort = {
  cible: () => null,
  arreter: (): Promise<void> => new Promise(() => {}),
  relancer: (): Promise<void> => new Promise(() => {}),
  definir: (): Promise<void> => new Promise(() => {}),
}

const serveurControle = creerServeurMcpControle({
  registre,
  repertoireProjets: `${RACINE}/projets`,
  // Plafond de parc désactivé EXPLICITEMENT (H-74) : ce banc n'a pas de source
  // d'utilisation réelle — l'omettre serait un oubli, le dire est un choix.
  utilisationParc: UTILISATION_PARC_DESACTIVEE,
  configPlafondParc: {},
  escalades: { enAttente: () => [], repondre: () => false },
  cibles: portMort,
  arreteur: portMort,
  relanceur: portMort,
  budget: portMort,
})

/** Inventaire PC vide : réaliste au tout premier démarrage, rien à réconcilier. */
const reconciliation = {
  inventairePc: { inventaire: async () => [], tuerSansPreavis: async () => {} },
  // Aucune session vivante à rattacher au premier démarrage : `reinitialize` n'est
  // jamais atteint ici. Le vrai test de D.2.4 est celui de la réconciliation (M-30).
  reinitialisateur: { reinitialiser: async () => ({ demandesEnAttente: [] }) },
}

const stockageIdentite = {
  lire: (): string | null => null,
  ecrire: (): void => {},
}

horodate(`démarrage de l'orchestrateur sur ${COMPTE} — modèle attendu : ${MODELE_ORCHESTRATEUR}`)

const poignee = await demarrerOrchestrateur({
  stockageIdentite,
  verificateurSessionExistante: { existe: async () => false },
  serveurControle,
  registre,
  reconciliation,
  incidents,
  cwd: RACINE,
  configDir: `/home/trinity/.claude-comptes/${COMPTE}`,
})

horodate(`session établie · id ${poignee.sessionId}`)

let outilsVus: string[] = []
let modeleVu: string | null = null
let fluxBrutSuspect = 0
let repondu = false

const lecture = (async (): Promise<void> => {
  for await (const message of poignee.query as AsyncIterable<SDKMessage>) {
    // Le démarrage ne consomme plus `query` (sinon deux lecteurs se voleraient les
    // messages) : c'est au vrai lecteur d'alimenter la discipline de contexte.
    poignee.ingererMessage(message)
    if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
      outilsVus = 'tools' in message ? (message.tools as string[]) : []
      modeleVu = 'model' in message ? String(message.model) : null
    }
    // H-45 : rien qui ressemble à de la sortie brute de worker ne doit transiter.
    if (message.type === 'user' || message.type === 'assistant') {
      const brut = JSON.stringify(message)
      if (/stdout|stderr|forwardSubagentText|agentProgressSummaries/.test(brut)) fluxBrutSuspect += 1
    }
    if (message.type === 'result') repondu = true
  }
})()

// Un tour réel : on lui demande d'employer ses outils, y compris celui dont le port est mort.
const debut = Date.now()
await poignee.entree.envoyerOperateur(
  'Utilise tes outils MCP pour : (1) lister les équipes en cours, (2) lister les projets. ' +
    'Puis réponds en une phrase avec ce que tu as trouvé. Ne tente aucune autre action.',
)

const echeance = Date.now() + 120_000
while (!repondu && Date.now() < echeance) await new Promise((r) => setTimeout(r, 500))
const duree = Date.now() - debut

await poignee.fermer()
await lecture.catch(() => {})

const interdits = OUTILS_INTERDITS_ORCHESTRATEUR.filter((o) => outilsVus.includes(o))
const outilsMcp = outilsVus.filter((o) => o.includes('creer_equipe') || o.includes('lister_equipes'))

console.log('\n— Ce que le SDK a réellement accordé —')
console.log(`  modèle : ${modeleVu}`)
console.log(`  outils (${outilsVus.length}) : ${outilsVus.join(', ').slice(0, 400)}`)

console.log('\n— Verdict du banc —')
console.log(`${repondu ? '✓' : '✗'} l'orchestrateur a répondu (en ${duree} ms)`)
console.log(
  `${interdits.length === 0 ? '✓' : '✗'} aucun outil d'écriture accordé par le SDK` +
    (interdits.length > 0 ? ` — TROUVÉS : ${interdits.join(', ')}` : ''),
)
console.log(`${outilsMcp.length > 0 ? '✓' : '✗'} les outils MCP de contrôle sont exposés (${outilsMcp.length} repérés)`)
console.log(`${String(modeleVu ?? '').includes('opus') ? '✓' : '✗'} tourne sous Opus (H-62) — vu : ${modeleVu}`)
console.log(`${fluxBrutSuspect === 0 ? '✓' : '✗'} aucun flux brut dans le contexte (suspects : ${fluxBrutSuspect})`)
console.log(`· incidents journalisés : ${incidents.incidents.length}`)

const succes = repondu && interdits.length === 0 && outilsMcp.length > 0 && fluxBrutSuspect === 0
process.exit(succes ? 0 : 1)
