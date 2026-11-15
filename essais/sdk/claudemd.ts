import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, record } from "./lib.ts";

const PROMPT = "Ton contexte contient-il la phrase « Senior technical collaborator » ? Réponds seulement OUI ou NON.";
const q = query({ prompt: PROMPT, options: baseOptions() });
for await (const m of q as AsyncIterable<SDKMessage>) {
  record("claudemd.jsonl", m);
  if (m.type === "assistant") {
    for (const b of m.message.content) if (b.type === "text") console.log("TEXT", b.text.slice(0, 120));
  }
  if (m.type === "result") console.log("RESULT", m.subtype, m.num_turns, m.is_error);
}
