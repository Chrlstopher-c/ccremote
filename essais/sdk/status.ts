import { query } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, neverEndingPrompt } from "./lib.ts";

const q = query({ prompt: neverEndingPrompt(), options: baseOptions() });
const started = Date.now();
const timer = setTimeout(() => q.close(), 90_000);
try {
  for (let i = 0; i < 12; i += 1) {
    const st = await q.mcpServerStatus();
    const counts: Record<string, number> = {};
    for (const s of st) counts[s.status] = (counts[s.status] ?? 0) + 1;
    console.log(`t=${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(counts));
    if (!st.some((s) => s.status === "pending")) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
} catch (err) {
  console.log("ERR", err instanceof Error ? err.message.slice(0, 200) : String(err));
}
clearTimeout(timer);
q.close();
