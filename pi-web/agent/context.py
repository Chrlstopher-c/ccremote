from agent.client import context_tokens, create_completion, resolve_model

COMPACT_TRIGGER_RATIO = 0.75
KEEP_RECENT_MESSAGES = 12

SUMMARY_PROMPT = """Résume la conversation suivante entre un utilisateur et l'agent ccremote, en français, \
de façon concise (10 lignes maximum). Conserve les faits importants : décisions prises, sessions \
lancées/tuées, états du PC observés, résultats d'outils significatifs. N'invente rien."""


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def estimate_messages_tokens(messages: list[dict]) -> int:
    total = 0
    for m in messages:
        total += estimate_tokens(m.get("content") or "")
        for tc in m.get("tool_calls", []) or []:
            total += estimate_tokens(tc["function"]["arguments"])
    return total


def _flatten(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m.get("role")
        if role == "user":
            lines.append(f"Utilisateur : {m.get('content', '')}")
        elif role == "assistant":
            content = m.get("content") or ""
            if content:
                lines.append(f"Agent : {content}")
            for tc in m.get("tool_calls", []) or []:
                lines.append(f"Agent a appelé {tc['function']['name']}({tc['function']['arguments']})")
        elif role == "tool":
            lines.append(f"Résultat outil : {m.get('content', '')}")
    return "\n".join(lines)


async def summarize(messages: list[dict], model: str) -> str:
    flat = _flatten(messages)
    completion = await create_completion(
        [
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": flat},
        ],
        model=model,
    )
    return completion.choices[0].message.content or ""


async def maybe_compact(history: list[dict], model: str) -> tuple[list[dict], str | None]:
    limit = context_tokens(resolve_model(model))
    if len(history) <= KEEP_RECENT_MESSAGES or estimate_messages_tokens(history) < limit * COMPACT_TRIGGER_RATIO:
        return history, None

    to_summarize = history[:-KEEP_RECENT_MESSAGES]
    recent = history[-KEEP_RECENT_MESSAGES:]
    summary = await summarize(to_summarize, model)
    compacted = [
        {"role": "system", "content": f"[Résumé de la conversation précédente]\n{summary}"},
        *recent,
    ]
    return compacted, summary
