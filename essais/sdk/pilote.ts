import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, cleanEnv, record, typeLabel } from "./lib.ts";

const PROMPT = "Recopie la première ligne qui suit « CONSIGNES PERMANENTES DE CHRIS » dans ton contexte. Si absente, réponds NONE. Rien d'autre.";

console.log("STRIPPED_ENV_KEYS", cleanEnv().stripped.join(" "));
const q = query({ prompt: PROMPT, options: baseOptions() });
const seq: string[] = [];
for await (const m of q as AsyncIterable<SDKMessage>) {
  record("pilote.jsonl", m);
  seq.push(typeLabel(m));
  if (m.type === "system" && m.subtype === "init") {
    console.log("INIT", JSON.stringify({
      cwd: m.cwd, model: m.model, permissionMode: m.permissionMode, apiKeySource: m.apiKeySource,
      version: m.claude_code_version, output_style: m.output_style,
      mcp_servers: m.mcp_servers, plugins: m.plugins.map((p) => p.name),
      skills: m.skills, slash_commands_count: m.slash_commands.length,
      tools_count: m.tools.length, tools: m.tools,
    }));
  }
  if (m.type === "assistant") {
    const text = m.message.content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join(" | ");
    console.log("ASSISTANT", text.slice(0, 400));
  }
  if (m.type === "result") {
    console.log("RESULT", JSON.stringify({ subtype: m.subtype, session_id: m.session_id, num_turns: m.num_turns, is_error: m.is_error }));
  }
}
console.log("SEQ", seq.join(" "));
