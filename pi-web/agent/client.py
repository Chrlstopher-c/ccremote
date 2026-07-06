from openai import AsyncOpenAI

from config import AGENT_MODEL, CEREBRAS_API_KEY, CEREBRAS_BASE_URL

AVAILABLE_MODELS = ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"]

_client = (
    AsyncOpenAI(api_key=CEREBRAS_API_KEY, base_url=CEREBRAS_BASE_URL)
    if CEREBRAS_API_KEY
    else None
)

SYSTEM_PROMPT = """Tu es l'agent de contrôle de ccremote, un panneau de gestion pour un PC distant \
qui héberge des sessions Claude Code dans tmux.

Tu peux : vérifier si le PC est en ligne et si Claude Code tourne, lire les performances \
(CPU, RAM, GPU, températures, disque, réseau), lister/lancer/tuer des sessions tmux, lire l'output \
d'une session et lui envoyer des touches, réveiller le PC en Wake-on-LAN s'il est éteint.

Utilise toujours les tools pour obtenir des informations réelles avant de répondre — ne devine \
jamais un état ou une métrique. Réponds en français, de façon courte et factuelle."""


def is_configured() -> bool:
    return _client is not None


async def create_completion(messages: list[dict], tools: list[dict], model: str | None = None) -> object:
    if _client is None:
        raise RuntimeError("CEREBRAS_API_KEY non configurée")
    return await _client.chat.completions.create(
        model=model if model in AVAILABLE_MODELS else AGENT_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.3,
    )
