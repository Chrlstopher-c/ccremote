import json
from collections.abc import AsyncIterator

from loguru import logger

from agent.client import SYSTEM_PROMPT, create_completion_stream, is_configured
from agent.context import maybe_compact
from agent.tools import TOOL_EXECUTORS, TOOL_SCHEMAS

MAX_TOOL_ROUNDS = 6


async def _execute_tool_call(call: dict) -> dict:
    name = call["function"]["name"]
    try:
        args = json.loads(call["function"]["arguments"] or "{}")
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


def _accumulate_tool_call_deltas(acc: dict[int, dict], deltas: list) -> None:
    for d in deltas:
        slot = acc.setdefault(d.index, {"id": "", "function": {"name": "", "arguments": ""}})
        if d.id:
            slot["id"] = d.id
        if d.function:
            if d.function.name:
                slot["function"]["name"] += d.function.name
            if d.function.arguments:
                slot["function"]["arguments"] += d.function.arguments


async def run_agent_stream(history: list[dict], message: str, model: str | None = None) -> AsyncIterator[dict]:
    if not is_configured():
        yield {
            "type": "done",
            "reply": "L'agent n'est pas configuré — CEREBRAS_API_KEY manquante côté serveur.",
            "tool_calls": [],
            "reasoning": [],
            "history": history,
        }
        return

    history, summary = await maybe_compact(history, model)
    if summary:
        yield {"type": "compacted", "summary": summary}

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history, {"role": "user", "content": message}]
    tool_calls_trace: list[dict] = []
    reasoning_trace: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        content = ""
        reasoning = ""
        tool_call_acc: dict[int, dict] = {}

        try:
            stream = await create_completion_stream(messages, TOOL_SCHEMAS, model)
            async for chunk in stream:
                delta = chunk.choices[0].delta
                if delta.content:
                    content += delta.content
                    yield {"type": "content_delta", "text": delta.content}
                r = getattr(delta, "reasoning", None)
                if r:
                    reasoning += r
                    yield {"type": "reasoning_delta", "text": r}
                if delta.tool_calls:
                    _accumulate_tool_call_deltas(tool_call_acc, delta.tool_calls)
        except Exception as e:
            logger.warning(f"appel au modèle IA échoué: {e}")
            yield {
                "type": "done",
                "reply": f"Erreur du modèle IA ({e}). La session distante n'est pas affectée.",
                "tool_calls": tool_calls_trace,
                "reasoning": reasoning_trace,
                "history": messages[1:],
            }
            return

        if reasoning:
            reasoning_trace.append(reasoning)

        if not tool_call_acc:
            messages.append({"role": "assistant", "content": content})
            yield {
                "type": "done",
                "reply": content,
                "tool_calls": tool_calls_trace,
                "reasoning": reasoning_trace,
                "history": messages[1:],
            }
            return

        ordered_calls = [tool_call_acc[i] for i in sorted(tool_call_acc)]
        messages.append({
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {"id": c["id"], "type": "function", "function": c["function"]} for c in ordered_calls
            ],
        })

        for call in ordered_calls:
            trace = await _execute_tool_call(call)
            tool_calls_trace.append(trace)
            yield {"type": "tool_call", **trace}
            messages.append({
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(trace["result"]),
            })

    yield {
        "type": "done",
        "reply": "Trop d'appels d'outils enchaînés, je m'arrête là.",
        "tool_calls": tool_calls_trace,
        "reasoning": reasoning_trace,
        "history": messages[1:],
    }
