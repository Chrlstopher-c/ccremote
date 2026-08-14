import os

from dotenv import load_dotenv

load_dotenv()

# ── PC principal (celui qui héberge tmux et les modèles) ──────────────────────
# Ces valeurs étaient codées en dur : le déploiement ne visait qu'une machine. Elles sont
# désormais lues depuis l'environnement — le serveur tourne en conteneur et doit pouvoir
# viser un hôte différent selon le déploiement (PC local, autre machine du réseau, Mac).
PC_HOST     = os.environ.get("PC_HOST", "host.docker.internal")
PC_PORT     = int(os.environ.get("PC_PORT", "8765"))
PC_MAC      = os.environ.get("PC_MAC", "")
WS_TIMEOUT  = int(os.environ.get("WS_TIMEOUT", "5"))

UI_USER     = os.environ.get("UI_USER", "chris")
UI_PASSWORD = os.environ.get("UI_PASSWORD", "changeme")

# ── Fournisseur du modèle de l'agent ──────────────────────────────────────────
# L'agent parle OpenAI depuis toujours (SDK AsyncOpenAI) : seule l'adresse change pour
# passer d'un fournisseur distant aux modèles locaux. Par défaut il vise EchoHub sur le
# PC, qui expose /v1/models et /v1/chat/completions et sert les modèles locaux
# (GGUF via llama.cpp, AWQ via vLLM).
#
# Une clé reste acceptée pour rester compatible d'un fournisseur distant, mais les serveurs
# locaux l'ignorent — d'où la valeur factice par défaut, le SDK OpenAI refusant de démarrer
# sans clé.
AGENT_BASE_URL  = os.environ.get("AGENT_BASE_URL", "http://host.docker.internal:37821/v1")
AGENT_API_KEY   = os.environ.get("AGENT_API_KEY", "local")
AGENT_API_KEY_2 = os.environ.get("AGENT_API_KEY_2", "")

# Modèle par défaut. Vide = le premier modèle annoncé par /v1/models est retenu, ce qui est
# le comportement souhaitable en local : le modèle disponible dépend de ce qui est chargé
# sur le PC à cet instant, pas d'une liste figée dans le code.
AGENT_MODEL = os.environ.get("AGENT_MODEL", "")

# Contexte supposé quand le serveur ne l'annonce pas. Garde-fou pour le rognage de
# l'historique uniquement — la vraie valeur vient de /v1/models quand elle est fournie.
AGENT_CONTEXT_FALLBACK = int(os.environ.get("AGENT_CONTEXT_FALLBACK", "32000"))

# ── Harness (Bun) ─────────────────────────────────────────────────────────────
# API sans authentification propre : `pi-web` la lui apporte, d'où la boucle locale.
HARNESS_API_URL = os.environ.get("HARNESS_API_URL", "http://127.0.0.1:8722")
