import json

from loguru import logger

from agent.client import SYSTEM_PROMPT, create_completion, is_configured
from agent.tools import TOOL_EXECUTORS, TOOL_SCHEMAS

MAX_TOOL_ROUNDS = 6


async def _execute_tool_call(call: object) -> dict:
    name = call.function.name
    try:
        args = json.loads(call.function.arguments or "{}")
    except json.JSONDecodeError:
        args = {}

    executor = TOOL_EXECUTORS.get(name)
    if executor is None:
        result = {"status": "error", "message": f"tool inconnu: {name}"}
    else:
        try:
            result = await executor(**args)
        except Exception as e:
            logger.warning(f"tool {name} a échoué: {e}")
            result = {"status": "error", "message": str(e)}

    return {"name": name, "args": args, "result": result}


async def run_agent(history: list[dict], message: str, model: str | None = None) -> dict:
    if not is_configured():
        return {
            "reply": "L'agent n'est pas configuré — CEREBRAS_API_KEY manquante côté serveur.",
            "tool_calls": [],
            "reasoning": [],
            "history": history,
        }

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history, {"role": "user", "content": message}]
    tool_calls_trace: list[dict] = []
    reasoning_trace: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        completion = await create_completion(messages, TOOL_SCHEMAS, model)
        choice = completion.choices[0].message
        reasoning = getattr(choice, "reasoning", None)
        if reasoning:
            reasoning_trace.append(reasoning)

        if not choice.tool_calls:
            messages.append({"role": "assistant", "content": choice.content or ""})
            return {
                "reply": choice.content or "",
                "tool_calls": tool_calls_trace,
                "reasoning": reasoning_trace,
                "history": messages[1:],
            }

        messages.append({
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [
                {"id": c.id, "type": "function",
                 "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in choice.tool_calls
            ],
        })

        for call in choice.tool_calls:
            trace = await _execute_tool_call(call)
            tool_calls_trace.append(trace)
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(trace["result"]),
            })

    return {
        "reply": "Trop d'appels d'outils enchaînés, je m'arrête là.",
        "tool_calls": tool_calls_trace,
        "reasoning": reasoning_trace,
        "history": messages[1:],
    }
