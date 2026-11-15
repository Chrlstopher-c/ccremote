import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, record, typeLabel } from "./lib.ts";

const SID = process.argv[2] ?? "";
const PROMPT = "Quel est le mot de code ? Un seul mot. Puis lance avec l'outil Bash `python3 -c \"print(42)\"` et dis le résultat.";
const toolCalls: string[] = [];
const seq: string[] = [];

const q = query({
  prompt: PROMPT,
  options: {
    ...baseOptions(),
    resume: SID,
    permissionMode: "default",
    allowDangerouslySkipPermissions: false,
    canUseTool: async (toolName, input) => {
      toolCalls.push(`canUseTool:${toolName}`);
      return { behavior: "allow", updatedInput: input };
    },
  },
});

for await (const m of q as AsyncIterable<SDKMessage>) {
  record("resume.jsonl", m);
  seq.push(typeLabel(m));
  if (m.type === "system" && m.subtype === "init") console.log("INIT_SESSION", m.session_id, "permissionMode", m.permissionMode);
  if (m.type === "assistant") {
    for (const b of m.message.content) {
      if (b.type === "tool_use") toolCalls.push(`tool_use:${b.name}`);
      if (b.type === "text") console.log("TEXT", b.text.slice(0, 300));
    }
  }
  if (m.type === "result") console.log("RESULT", m.subtype, m.num_turns, m.is_error);
}
console.log("SEQ", seq.filter((s) => s !== "stream_event").join(" "));
console.log("TOOLS", toolCalls.join(" "));
