"""Client du modèle de l'agent — OpenAI-compatible, distant ou local.

L'agent parlait déjà OpenAI (SDK AsyncOpenAI) : passer aux modèles locaux ne change que
l'adresse visée. Deux différences de comportement, en revanche, distinguent un serveur local
d'un fournisseur distant, et ce module les absorbe :

  - La liste des modèles n'est plus connue à l'avance. En local, elle dépend de ce qui est
    chargé sur le PC à cet instant — elle est donc découverte via /v1/models, jamais figée.
  - Il n'y a ni quota ni limite de débit. Les en-têtes d'usage propres au fournisseur distant
    sont absents, la rotation de clés n'a plus d'objet : les deux dégradent proprement au lieu
    d'échouer.
"""

import time

from loguru import logger
from openai import AsyncOpenAI, RateLimitError

from agent import usage as agent_usage
from config import (
    AGENT_API_KEY,
    AGENT_API_KEY_2,
    AGENT_BASE_URL,
    AGENT_CONTEXT_FALLBACK,
    AGENT_MODEL,
)

# Durée de validité du catalogue découvert. Un modèle peut être chargé ou éjecté sur le PC
# pendant que l'agent tourne : on ne fige pas la liste pour la session entière.
_CATALOGUE_TTL_S = 30

_clients: list[tuple[str, AsyncOpenAI]] = [
    (label, AsyncOpenAI(api_key=key, base_url=AGENT_BASE_URL))
    for label, key in (("key1", AGENT_API_KEY), ("key2", AGENT_API_KEY_2))
    if key
]
_active = 0

_catalogue: list[str] = []
_contextes: dict[str, int] = {}
_catalogue_expire_a: float = 0.0

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


def configured_key_labels() -> list[str]:
    return [label for label, _ in _clients]


def _rotate() -> None:
    """Passe à la clé suivante. Sans objet en local (une seule clé factice), conservé pour
    rester utilisable avec un fournisseur distant soumis à des quotas."""
    global _active
    if len(_clients) > 1:
        _active = (_active + 1) % len(_clients)


async def refresh_catalogue(force: bool = False) -> list[str]:
    """Interroge /v1/models et met à jour la liste des modèles servis.

    Remplace la liste codée en dur : en local, le catalogue est exactement ce que le serveur
    a chargé maintenant. Un échec ne fait jamais tomber l'agent — on conserve le dernier
    catalogue connu, quitte à ce qu'il soit vide.
    """
    global _catalogue, _contextes, _catalogue_expire_a

    if not force and _catalogue and time.monotonic() < _catalogue_expire_a:
        return _catalogue
    if not _clients:
        return _catalogue

    _, client = _clients[_active]
    try:
        reponse = await client.models.list()
    except Exception as e:
        logger.warning(f"Catalogue de modèles indisponible ({AGENT_BASE_URL}) : {e}")
        return _catalogue

    noms: list[str] = []
    contextes: dict[str, int] = {}
    for modele in reponse.data:
        noms.append(modele.id)
        # Les serveurs locaux annoncent parfois la fenêtre de contexte ; sinon on retombe
        # sur le garde-fou de configuration plutôt que de supposer une valeur généreuse.
        taille = getattr(modele, "context_window", None) or getattr(modele, "max_model_len", None)
        contextes[modele.id] = int(taille) if taille else AGENT_CONTEXT_FALLBACK

    _catalogue = noms
    _contextes = contextes
    _catalogue_expire_a = time.monotonic() + _CATALOGUE_TTL_S
    logger.info(f"Catalogue rafraîchi depuis {AGENT_BASE_URL} : {noms or 'aucun modèle chargé'}")
    return _catalogue


def available_models() -> list[str]:
    """Dernier catalogue connu, sans appel réseau."""
    return list(_catalogue)


def context_tokens(model: str) -> int:
    return _contextes.get(model, AGENT_CONTEXT_FALLBACK)


def resolve_model(model: str | None) -> str:
    """Modèle à utiliser réellement.

    Priorité : celui demandé s'il est servi, sinon celui configuré, sinon le premier annoncé
    par le serveur. Ce dernier cas est le mode nominal en local, où le modèle disponible est
    simplement celui qui est chargé.
    """
    if model and model in _catalogue:
        return model
    if AGENT_MODEL and (not _catalogue or AGENT_MODEL in _catalogue):
        return AGENT_MODEL
    if _catalogue:
        return _catalogue[0]
    if model:
        return model
    raise RuntimeError(
        f"Aucun modèle disponible sur {AGENT_BASE_URL} — vérifie qu'un modèle est chargé "
        f"sur le PC, ou fixe AGENT_MODEL."
    )


async def warm_up_usage() -> None:
    """Relève les quotas au démarrage, quand le fournisseur en expose.

    Un serveur local n'a ni quota ni en-tête d'usage : l'appel est alors inutile et on le
    saute, plutôt que de dépenser une requête pour rien. On en profite pour amorcer le
    catalogue, qui lui est indispensable.
    """
    await refresh_catalogue(force=True)

    if _est_local():
        logger.info("Fournisseur local — pas de quota à relever.")
        return

    for label, client in _clients:
        try:
            modele = resolve_model(None)
            raw = await client.chat.completions.with_raw_response.create(
                model=modele, messages=[{"role": "user", "content": "hi"}], max_tokens=1
            )
            agent_usage.record_headers(label, raw.headers)
        except RateLimitError as e:
            if e.response is not None:
                agent_usage.record_headers(label, e.response.headers)
        except Exception as e:
            logger.warning(f"warm-up usage échoué pour {label}: {e}")


def _est_local() -> bool:
    hote = AGENT_BASE_URL.lower()
    return any(m in hote for m in ("localhost", "127.0.0.1", "host.docker.internal", "192.168."))


async def _appeler(**kwargs) -> object:
    """Appel avec rotation de clé sur quota dépassé.

    Enregistre les en-têtes d'usage quand ils existent ; leur absence (cas local) n'est pas
    une erreur.
    """
    if not _clients:
        raise RuntimeError(f"Aucun client configuré — AGENT_BASE_URL={AGENT_BASE_URL}")

    derniere_erreur: Exception | None = None
    for _ in range(max(1, len(_clients))):
        label, client = _clients[_active]
        try:
            raw = await client.chat.completions.with_raw_response.create(**kwargs)
            agent_usage.record_headers(label, raw.headers)
            return raw.parse()
        except RateLimitError as e:
            derniere_erreur = e
            if e.response is not None:
                agent_usage.record_headers(label, e.response.headers)
            if len(_clients) > 1:
                _rotate()
                continue
            raise
    if derniere_erreur:
        raise derniere_erreur
    raise RuntimeError("Appel au modèle impossible")


async def create_completion(
    messages: list[dict], tools: list[dict] | None = None, model: str | None = None
) -> object:
    await refresh_catalogue()
    kwargs: dict = {"model": resolve_model(model), "messages": messages, "temperature": 0.3}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    return await _appeler(**kwargs)


async def create_completion_stream(
    messages: list[dict], tools: list[dict], model: str | None = None
) -> object:
    await refresh_catalogue()
    return await _appeler(
        model=resolve_model(model),
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.3,
        stream=True,
    )
