from loguru import logger
from openai import AsyncOpenAI, RateLimitError

from agent import usage as agent_usage
from config import AGENT_MODEL, CEREBRAS_API_KEY, CEREBRAS_API_KEY_2, CEREBRAS_BASE_URL

AVAILABLE_MODELS = ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"]

# Cerebras ne renvoie pas la taille de contexte via /v1/models — valeurs documentées,
# gemma-4-31b (utilisé et confirmé par Chris) sur estimation prudente faute de doc publique.
MODEL_CONTEXT_TOKENS = {
    "gpt-oss-120b": 128_000,
    "zai-glm-4.7": 128_000,
    "gemma-4-31b": 32_000,
}

# Plusieurs clés Cerebras possibles : rotation automatique vers la suivante sur 429 (rate limit).
_clients: list[tuple[str, AsyncOpenAI]] = [
    (label, AsyncOpenAI(api_key=key, base_url=CEREBRAS_BASE_URL))
    for label, key in (("key1", CEREBRAS_API_KEY), ("key2", CEREBRAS_API_KEY_2))
    if key
]
_active = 0

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
    return len(_clients) > 0


def active_key_label() -> str | None:
    return _clients[_active][0] if _clients else None


def _rotate() -> None:
    global _active
    _active = (_active + 1) % len(_clients)


def resolve_model(model: str | None) -> str:
    return model if model in AVAILABLE_MODELS else AGENT_MODEL


async def warm_up_usage() -> None:
    """Récupère les vrais quotas de chaque clé au démarrage du serveur — le snapshot en mémoire
    (agent/usage.py) est vide après un restart alors que le quota réel côté Cerebras, lui, n'a
    pas bougé. Sans ça l'UI afficherait "aucun appel" juste après un déploiement, ce qui est
    trompeur. Coût : 1 requête minimale (max_tokens=1) par clé configurée."""
    for label, client in _clients:
        try:
            raw = await client.chat.completions.with_raw_response.create(
                model=AGENT_MODEL, messages=[{"role": "user", "content": "hi"}], max_tokens=1
            )
            agent_usage.record_headers(label, raw.headers)
        except RateLimitError as e:
            if e.response is not None:
                agent_usage.record_headers(label, e.response.headers)
        except Exception as e:
            logger.warning(f"warm-up usage échoué pour {label}: {e}")


async def create_completion(
    messages: list[dict], tools: list[dict] | None = None, model: str | None = None
) -> object:
    if not _clients:
        raise RuntimeError("CEREBRAS_API_KEY non configurée")
    kwargs: dict = {"model": resolve_model(model), "messages": messages, "temperature": 0.3}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    for attempt in range(len(_clients)):
        label, client = _clients[_active]
        try:
            raw = await client.chat.completions.with_raw_response.create(**kwargs)
            agent_usage.record_headers(label, raw.headers)
            return raw.parse()
        except RateLimitError as e:
            if e.response is not None:
                agent_usage.record_headers(label, e.response.headers)
            if attempt < len(_clients) - 1:
                _rotate()
                continue
            raise


async def create_completion_stream(messages: list[dict], tools: list[dict], model: str | None = None) -> object:
    if not _clients:
        raise RuntimeError("CEREBRAS_API_KEY non configurée")

    for attempt in range(len(_clients)):
        label, client = _clients[_active]
        try:
            raw = await client.chat.completions.with_raw_response.create(
                model=resolve_model(model),
                messages=messages,
                tools=tools,
                tool_choice="auto",
                temperature=0.3,
                stream=True,
            )
            agent_usage.record_headers(label, raw.headers)
            return raw.parse()
        except RateLimitError as e:
            if e.response is not None:
                agent_usage.record_headers(label, e.response.headers)
            if attempt < len(_clients) - 1:
                _rotate()
                continue
            raise
