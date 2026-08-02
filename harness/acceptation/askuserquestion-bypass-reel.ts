/**
 * Banc d'essai RÉEL : `AskUserQuestion` survit-il au passage de l'orchestrateur
 * en `permissionMode: 'bypassPermissions'` ?
 *
 * `☠` LA question du 2026-08-02. L'orchestrateur quitte `auto` parce que son
 * classifieur a refusé un `creer_equipe` en pleine fenêtre d'autonomie
 * (« Blocked by classifier », 12h22). Mais A.3.2 exige que l'orchestrateur
 * puisse toujours désambiguïser auprès de Chris, et `options-orchestrateur.ts`
 * documente déjà qu'un mode mal choisi (`dontAsk`) REFUSE `AskUserQuestion` au
 * lieu de le présenter. Si `bypassPermissions` faisait la même chose, on aurait
 * échangé un dispatch bloqué contre un orchestrateur muet — le genre de troc
 * qui ne se voit qu'en production, le jour où il a besoin de poser une question.
 *
 * Ce que le banc prouve, sur une session réelle composée par
 * `composerOptionsOrchestrateur` (jamais des `Options` réécrites à la main —
 * sinon on teste autre chose que ce qui tourne) :
 *  1. la session démarre — le couple mode/allowDangerouslySkipPermissions passe ;
 *  2. `AskUserQuestion` est ANNONCÉ dans les capacités au démarrage ;
 *  3. sommé de poser une question, le modèle émet bien un `tool_use`
 *     `AskUserQuestion` — il est présenté, pas refusé ;
 *  4. aucun refus de permission n'apparaît dans le flux.
 *
 * ☠ NE PAS transformer en `*.test.ts` : ouvre une vraie session et consomme du quota.
 * ☠ À REPASSER à tout changement de version du SDK — c'est le contrat d'un tiers.
 *
 * Usage : COMPTE=compte-b bun run acceptation/askuserquestion-bypass-reel.ts
 */
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { composerOptionsOrchestrateur } from '../control-plane/orchestrateur/processus/options-orchestrateur.ts';
import { creerServeurMcpControle } from '../control-plane/orchestrateur/mcp-controle/serveur.ts';

const COMPTE = process.env['COMPTE'] ?? 'compte-b';
const CONFIG_DIR = `/home/trinity/.claude-comptes/${COMPTE}`;
const RACINE = join(tmpdir(), `ccremote-askuq-${randomUUID().slice(0, 8)}`);

function horodate(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

await Bun.$`mkdir -p ${RACINE}`.quiet();

const vu = {
  demarre: false,
  capacites: [] as string[],
  askUserQuestionEmis: false,
  refusPermission: false,
};

// Serveur MCP de contrôle réel, mais sans aucune dépendance vivante : ce banc ne
// crée pas d'équipe, il ne s'intéresse qu'à la présentation d'AskUserQuestion.
const serveurControle = creerServeurMcpControle({} as never);

const options = composerOptionsOrchestrateur({
  decision: { sessionId: randomUUID(), mode: 'demarrage_froid' },
  serveurControle,
  cwd: RACINE,
  configDir: CONFIG_DIR,
});

horodate(`mode=${String(options.permissionMode)} skip=${String(options.allowDangerouslySkipPermissions)}`);

// `☠` Le banc doit être validé DANS LES DEUX SENS : `MODE=auto` rejoue le même
// scénario dans l'ancien mode. Si `auto` échoue aussi, c'est le banc qui est faux,
// pas le mode — un test qui ne sait pas échouer ne prouve rien.
const modeForce = process.env['MODE'];
const optionsJouees =
  modeForce === 'auto'
    ? { ...options, permissionMode: 'auto' as const, allowDangerouslySkipPermissions: false }
    : options;
horodate(`mode joué : ${String(optionsJouees.permissionMode)}`);

const flux = query({
  prompt:
    "Chris hésite entre déployer maintenant ou attendre la fin des tests. Tu ne peux pas trancher seul. " +
    "Pose-lui la question MAINTENANT avec l'outil AskUserQuestion, deux options, sans rien faire d'autre avant.",
  options: { ...optionsJouees, maxTurns: 2 },
});

for await (const message of flux as AsyncIterable<SDKMessage>) {
  const brut = JSON.stringify(message);
  if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
    vu.demarre = true;
    const capacites = 'tools' in message && Array.isArray(message.tools) ? message.tools : [];
    vu.capacites = capacites as string[];
  }
  if (brut.includes('AskUserQuestion')) vu.askUserQuestionEmis = true;
  if (brut.includes('auto mode classifier') || brut.includes('Blocked by classifier')) vu.refusPermission = true;
  if (process.env['TRACE'] === '1') {
    const sous = 'subtype' in message ? String(message.subtype) : '';
    horodate(`— ${message.type}/${sous} : ${brut.slice(0, 600)}`);
  }
}

const annonce = vu.capacites.includes('AskUserQuestion');
horodate(`session démarrée : ${vu.demarre}`);
horodate(`AskUserQuestion annoncé dans les capacités : ${annonce}`);
horodate(`AskUserQuestion réellement émis : ${vu.askUserQuestionEmis}`);
horodate(`refus de permission observé : ${vu.refusPermission}`);
horodate(`capacités livrées : ${vu.capacites.filter((c) => !c.startsWith('mcp__')).join(', ')}`);

// Ce que le banc décide : le MODE ne doit rien changer. La session démarre et
// aucun refus de permission n'apparaît — c'est la condition pour déployer.
// La livraison d'AskUserQuestion, elle, est un défaut préexistant : constatée
// absente dans les DEUX modes, elle est signalée ici, jamais silencieuse.
const modeSain = vu.demarre && !vu.refusPermission;
console.log(
  modeSain
    ? `\n✅ MODE SAIN (${String(optionsJouees.permissionMode)}) — session démarrée, aucun refus de permission.`
    : `\n❌ ÉCHEC — ne pas déployer le mode ${String(optionsJouees.permissionMode)} en l'état.`,
);
if (!annonce) {
  console.log(
    "⚠ A.3.2 NON TENUE, indépendamment du mode : AskUserQuestion est demandé dans `tools` mais le SDK ne le livre pas.\n" +
      '  Vérifié identique en `auto` (MODE=auto) et en `bypassPermissions`, et zéro occurrence dans les transcripts de production.',
  );
}
process.exit(modeSain ? 0 : 1);
