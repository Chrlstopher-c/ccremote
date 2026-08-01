/**
 * Banc d'essai RÉEL : une équipe voit-elle vraiment ses serveurs MCP ?
 *
 * `☠` Ce banc existe parce qu'un test unitaire ne peut PAS répondre à cette
 * question. `composeWorkerOptions` peut poser `mcpServers` parfaitement et le
 * CLI peut refuser de s'y connecter — c'est exactement la forme du défaut qu'on
 * corrige : une intention juste, jamais transportée jusqu'au point de
 * consommation. La seule preuve recevable est la liste d'outils que le processus
 * Claude Code annonce lui-même dans son message `init`.
 *
 * `☠` PIÈGE DE MESURE PAYÉ ICI, le 01/08 — la première version de ce banc a
 * déclaré ROUGE une correction qui marchait. Elle lisait les outils MCP dans
 * `capabilities.tools`, c'est-à-dire dans le message `init`. Or `init` porte
 * aussi `mcp_servers`, et à cet instant précis les cinq serveurs y figurent avec
 * `status: "pending"` : la connexion stdio (un processus Python à lancer par
 * serveur) n'est pas terminée quand l'init part. Les outils NE PEUVENT PAS y
 * être. Le banc mesurait un fait avant qu'il existe.
 *
 * La leçon vaut au-delà d'ici : quand une contre-épreuve et le cas nominal
 * donnent le MÊME résultat (31 outils, 0 MCP des deux côtés), le premier suspect
 * est l'instrument, pas le correctif.
 *
 * Ce qu'il vérifie donc, dans l'ordre :
 *   1. les serveurs résolus apparaissent dans `init.mcp_servers` — la preuve que
 *      la transmission atteint le CLI, indépendamment de leur état ;
 *   2. le worker APPELLE réellement un outil MCP et en reçoit un résultat —
 *      seule preuve que la connexion aboutit et que l'outil est utilisable ;
 *   3. contre-épreuve — le MÊME worker démarré avec `mcpServers: {}` n'y arrive
 *      pas. Sans elle, on ne saurait pas si l'outil vient de notre transmission
 *      ou d'un héritage qu'on n'a pas identifié.
 *
 * `☠` NE PAS transformer en `*.test.ts` : ouvre deux vraies sessions et consomme
 * du quota. Modèle Sonnet (plancher H-43) et mandat trivial pour que ça coûte quelques centimes.
 *
 * Usage : bun run acceptation/mcp-equipe-reel.ts
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorker } from '../workers/index.ts';
import { PLANCHER_DENI_SDK } from '../plancher-deni/index.ts';
import { MCP_EQUIPE, resoudreMcpEquipe } from '../workers/mcp-du-poste.ts';

const COMPTE = process.env['COMPTE'] ?? 'compte-a';

function horodate(m: string): void {
  console.log(`[${new Date().toISOString()}] ${m}`);
}

interface Releve {
  /** Serveurs annoncés dans `init.mcp_servers` — transmission atteinte. */
  readonly annonces: readonly string[];
  /** Outils MCP réellement APPELÉS par le worker, avec un résultat. */
  readonly appeles: readonly string[];
  /** Le texte final du worker, pour diagnostic quand rien n'aboutit. */
  readonly dernierTexte: string;
}

/**
 * `☠` L'outil sondé doit être en LECTURE PURE et rapide.
 * `list_indexed_projects` n'écrit rien, ne dépend d'aucun état préalable et
 * répond en une passe. Sonder Playwright ouvrirait un navigateur, sonder la
 * mémoire sémantique écrirait dans celle de Chris.
 */
const OUTIL_SONDE = 'mcp__codeindex__list_indexed_projects';

async function releverUnWorker(mcpServers: Record<string, unknown>, etiquette: string): Promise<Releve> {
  const racine = join(tmpdir(), `ccremote-mcp-${etiquette}-${Date.now()}`);
  await Bun.$`mkdir -p ${racine}`.quiet();
  const poignee = await startWorker(
    {
      sessionId: crypto.randomUUID(),
      cwd: racine,
      mandate: 'Banc de vérification des outils MCP. N’écris aucun fichier.',
      mcpServers: mcpServers as never,
      portAuditPermissions: () => ({}),
      deniedToolPatterns: [...PLANCHER_DENI_SDK],
      maxBudgetUsd: 1,
      model: 'sonnet',
      configDir: `/home/trinity/.claude-comptes/${COMPTE}`,
    },
    `Appelle une seule fois l'outil \`${OUTIL_SONDE}\` (sans argument) et dis-moi en une ligne ` +
      "s'il a répondu. Si cet outil n'existe pas dans ta liste, réponds exactement : OUTIL ABSENT.",
  );

  const annonces = poignee.capabilities.mcpServers.map((s) => `${s.name}:${s.status}`);
  const appeles: string[] = [];
  let dernierTexte = '';
  // ☠ Boucle BORNÉE : on lit jusqu'au `result` du tour, jamais indéfiniment.
  for await (const message of poignee.query) {
    if (message.type === 'assistant') {
      for (const bloc of message.message.content) {
        if (bloc.type === 'tool_use' && bloc.name.startsWith('mcp__')) appeles.push(bloc.name);
        if (bloc.type === 'text') dernierTexte = bloc.text;
      }
    }
    if (message.type === 'result') break;
  }
  poignee.abortController.abort();
  return { annonces, appeles, dernierTexte };
}

horodate(`compte ${COMPTE}`);
const resolution = resoudreMcpEquipe();
horodate(`poste : ${resolution.source}`);
horodate(`serveurs résolus : ${Object.keys(resolution.serveurs).join(', ') || 'AUCUN'}`);
if (resolution.manquants.length > 0) horodate(`⚠ manquants sur le poste : ${resolution.manquants.join(', ')}`);

horodate('— worker AVEC les serveurs MCP du poste');
const avec = await releverUnWorker(resolution.serveurs, 'avec');
horodate(`annoncés à l’init : ${avec.annonces.join(', ') || 'AUCUN'}`);
horodate(`outils MCP appelés : ${avec.appeles.join(', ') || 'AUCUN'}`);
horodate(`dit : ${avec.dernierTexte.replace(/\s+/g, ' ').slice(0, 160)}`);

horodate('— contre-épreuve : worker SANS aucun serveur');
const sans = await releverUnWorker({}, 'sans');
horodate(`annoncés à l’init : ${sans.annonces.join(', ') || 'AUCUN'}`);
horodate(`outils MCP appelés : ${sans.appeles.join(', ') || 'AUCUN'}`);
horodate(`dit : ${sans.dernierTexte.replace(/\s+/g, ' ').slice(0, 160)}`);

// ── Verdict ────────────────────────────────────────────────────────────────
const echecs: string[] = [];

// 1. La transmission atteint-elle le CLI ? Se lit sur `init.mcp_servers`, quel
//    que soit l'état des serveurs — c'est un fait de transport, pas d'usage.
for (const attendu of MCP_EQUIPE) {
  if (resolution.serveurs[attendu] === undefined) continue; // absent du poste : déjà signalé
  if (!avec.annonces.some((a) => a.startsWith(`${attendu}:`))) {
    echecs.push(`serveur « ${attendu} » transmis mais absent de init.mcp_servers — le CLI ne l’a pas reçu`);
  }
}

// 2. L'outil est-il RÉELLEMENT utilisable ? Seul un appel abouti le prouve.
if (avec.appeles.length === 0) {
  echecs.push(`le worker équipé n’a appelé aucun outil MCP — il a dit : « ${avec.dernierTexte.slice(0, 120)} »`);
}

// 3. Contre-épreuve : sans transmission, l'outil ne doit PAS être joignable.
//    `☠` Sans elle, un héritage non identifié se lirait comme un succès.
if (sans.appeles.length > 0) {
  echecs.push(`la contre-épreuve a appelé ${sans.appeles.join(', ')} : ces outils ne viennent pas de notre transmission`);
}

console.log('');
if (echecs.length === 0) {
  horodate(`✓ BANC VERT — équipe : ${avec.appeles.length} appel(s) MCP abouti(s) · témoin : 0`);
  process.exit(0);
}
horodate('✗ BANC ROUGE');
for (const e of echecs) console.log(`   · ${e}`);
process.exit(1);
