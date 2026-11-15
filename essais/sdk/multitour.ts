import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, record, typeLabel } from "./lib.ts";

const TURNS = [
  "Retiens ce mot de code : ORCHIDEE. Réponds seulement OK.",
  "Lance la commande `echo SDKOK` avec l'outil Bash, puis dis-moi le mot de code en un mot.",
];
const FILE = "multitour.jsonl";
const toolCalls: string[] = [];
let resolveTurn: (() => void) | null = null;

function userMsg(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

async function* inputs(): AsyncGenerator<SDKUserMessage> {
  for (const text of TURNS) {
    yield userMsg(text);
    await new Promise<void>((resolve) => { resolveTurn = resolve; });
  }
}

const q = query({
  prompt: inputs(),
  options: {
    ...baseOptions(),
    includePartialMessages: true,
    canUseTool: async (toolName, input) => {
      toolCalls.push(`canUseTool:${toolName}`);
      return { behavior: "allow", updatedInput: input };
    },
  },
});

let turn = 0;
const seq: string[][] = [[], []];
for await (const m of q as AsyncIterable<SDKMessage>) {
  record(FILE, m);
  seq[Math.min(turn, 1)]?.push(typeLabel(m));
  if (m.type === "system" && m.subtype === "init") console.log("SESSION_ID", m.session_id);
  if (m.type === "assistant") {
    for (const b of m.message.content) {
      if (b.type === "tool_use") toolCalls.push(`tool_use:${b.name}`);
      if (b.type === "text") console.log(`TURN${turn + 1} TEXT`, b.text.slice(0, 200));
    }
  }
  if (m.type === "result") {
    console.log(`RESULT turn${turn + 1}`, m.subtype, m.num_turns, m.is_error);
    turn += 1;
    if (turn === 1) await q.setPermissionMode("default");
    resolveTurn?.();
  }
}
console.log("SEQ_TURN1", seq[0]?.join(" "));
console.log("SEQ_TURN2", seq[1]?.join(" "));
console.log("TOOLS", toolCalls.join(" "));
