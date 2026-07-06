from openai import AsyncOpenAI

from config import AGENT_MODEL, CEREBRAS_API_KEY, CEREBRAS_BASE_URL

AVAILABLE_MODELS = ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"]

# Cerebras ne renvoie pas la taille de contexte via /v1/models — valeurs documentées,
# gemma-4-31b non confirmée publiquement donc estimation prudente.
MODEL_CONTEXT_TOKENS = {
    "gpt-oss-120b": 128_000,
    "zai-glm-4.7": 128_000,
    "gemma-4-31b": 32_000,
}

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
jamais un état ou une métrique. Réponds en français, de façon courte et factuelle. Structure tes \
réponses en markdown (titres, listes, code) quand c'est utile à la lisibilité.

Important : après launch_session, Claude Code met quelques secondes à démarrer avant d'accepter \
des touches. Vérifie toujours avec capture_pane que le prompt est prêt avant d'utiliser send_keys \
— si l'output est vide ou montre encore un écran de chargement, relance capture_pane après un court \
instant plutôt que d'envoyer les touches à l'aveugle."""


def is_configured() -> bool:
    return _client is not None


def resolve_model(model: str | None) -> str:
    return model if model in AVAILABLE_MODELS else AGENT_MODEL


async def create_completion(
    messages: list[dict], tools: list[dict] | None = None, model: str | None = None
) -> object:
    if _client is None:
        raise RuntimeError("CEREBRAS_API_KEY non configurée")
    kwargs: dict = {"model": resolve_model(model), "messages": messages, "temperature": 0.3}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    return await _client.chat.completions.create(**kwargs)


async def create_completion_stream(messages: list[dict], tools: list[dict], model: str | None = None) -> object:
    if _client is None:
        raise RuntimeError("CEREBRAS_API_KEY non configurée")
    return await _client.chat.completions.create(
        model=resolve_model(model),
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.3,
        stream=True,
    )
