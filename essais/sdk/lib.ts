import { appendFileSync } from "node:fs";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const MODEL = "claude-haiku-5-5";
export const CWD = import.meta.dir;
export const SCRATCH = process.env.SCRATCH ?? "/tmp";

const STRIP_RE = /^(CLAUDE_CODE_MESSAGING_|CLAUDE_CODE_(SESSION_ID|HOST_SESSION_ID|CHILD_SESSION|PID|EXECPATH|SESSION_ATTENDED|ENTRYPOINT)$|CLAUDE_PID$|CLAUDE_AGENT_SDK_VERSION$)/;

export function cleanEnv(): { env: Record<string, string>; stripped: string[] } {
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "ANTHROPIC_API_KEY") continue;
    if (STRIP_RE.test(k)) {
      stripped.push(k);
      continue;
    }
    env[k] = v;
  }
  return { env, stripped };
}

export function baseOptions(exe?: string): Options {
  return {
    cwd: CWD,
    env: cleanEnv().env,
    model: MODEL,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
  };
}

export function neverEndingPrompt(): AsyncIterable<never> {
  return (async function* () {
    await new Promise<void>(() => {});
  })();
}

export function record(file: string, m: SDKMessage): void {
  appendFileSync(`${SCRATCH}/${file}`, `${JSON.stringify(m)}\n`);
}

export function typeLabel(m: SDKMessage): string {
  const sub = "subtype" in m && typeof m.subtype === "string" ? `:${m.subtype}` : "";
  return `${m.type}${sub}`;
}
