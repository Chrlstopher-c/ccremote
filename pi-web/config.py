import os

from dotenv import load_dotenv

load_dotenv()

PC_HOST     = os.environ.get("CCREMOTE_PC_HOST", "pc.exemple")
PC_PORT     = int(os.environ.get("CCREMOTE_PC_PORT", "8765"))
PC_MAC      = os.environ.get("CCREMOTE_PC_MAC", "aa:bb:cc:dd:ee:ff")
WS_TIMEOUT  = 5

UI_USER     = os.environ.get("UI_USER", "operateur")
UI_PASSWORD = os.environ.get("UI_PASSWORD", "changeme")

CEREBRAS_API_KEY   = os.environ.get("CEREBRAS_API_KEY", "")
CEREBRAS_API_KEY_2 = os.environ.get("CEREBRAS_API_KEY_2", "")
CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
AGENT_MODEL       = "gpt-oss-120b"

# API web du harness (Bun), sur le Pi lui-même. Boucle locale obligatoire :
# cette API n'a pas d'authentification propre, `pi-web` la lui apporte.
HARNESS_API_URL = os.environ.get("HARNESS_API_URL", "http://127.0.0.1:8722")
