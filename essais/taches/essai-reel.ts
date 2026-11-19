// Essai réel (un appel modèle, coût minimal) : la traduction produit-elle la liste de tâches du SDK ?
// Usage : bun run essais/taches/essai-reel.ts  (lance query() avec haiku dans lanterne-essai-reel).
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { envSdk } from '../../poste/session/options-sdk.ts';
import { nouvelEtatTraduction, traduireSdk } from '../../poste/session/traduction-sdk.ts';

const CWD = '/mnt/projects/lanterne-essai-reel';
const PROMPT = 'Crée une liste de 3 tâches avec TaskCreate pour écrire un fichier note.txt, puis fais-les et coche-les.';

const env = { ...envSdk(process.env, null), CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' };
const etat = nouvelEtatTraduction();
const flux = query({
  prompt: PROMPT,
  options: {
    cwd: CWD,
    env,
    model: 'haiku',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    persistSession: false,
    maxTurns: 12,
  },
});

const outils: string[] = [];
const tachesVues: { contenu: string; etat: string }[][] = [];
let fin = '';
for await (const msg of flux as AsyncIterable<SDKMessage>) {
  if (msg.type === 'system' && msg.subtype === 'init') console.log('outils init:', msg.tools.filter((t) => t.startsWith('Task')).join(','));
  if (msg.type === 'assistant') {
    for (const b of msg.message.content) if (b.type === 'tool_use') outils.push(b.name);
  }
  for (const evt of traduireSdk(msg, etat).evenements) {
    if (evt.type === 'taches') tachesVues.push(evt.taches);
    if (evt.type === 'erreur') console.log('ERREUR', evt.message);
  }
  if (msg.type === 'result') fin = msg.subtype;
}

const derniere = tachesVues.at(-1) ?? [];
console.log('outils appelés:', outils.join(' '));
console.log('fin:', fin, '| evenements taches:', tachesVues.length);
console.log('derniere liste:', JSON.stringify(derniere));
const ok = derniere.length === 3 && derniere.every((t) => t.etat === 'fait');
console.log(ok ? 'VERDICT: OK (3 tâches, toutes fait)' : 'VERDICT: ECHEC');
process.exit(ok ? 0 : 1);
