import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, neverEndingPrompt } from "./lib.ts";

const exe = process.argv[2];
const q = query({ prompt: neverEndingPrompt(), options: baseOptions(exe) });
const timer = setTimeout(() => q.close(), 60_000);
for await (const m of q as AsyncIterable<SDKMessage>) {
  if (m.type === "system" && m.subtype === "init") {
    console.log(JSON.stringify(m, null, 2));
    break;
  }
  console.log("OTHER", m.type, (m as { subtype?: string }).subtype ?? "");
}
clearTimeout(timer);
q.close();
