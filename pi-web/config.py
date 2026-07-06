import os

from dotenv import load_dotenv

load_dotenv()

PC_HOST     = "pc.exemple"
PC_PORT     = 8765
PC_MAC      = "aa:bb:cc:dd:ee:ff"
WS_TIMEOUT  = 5

UI_USER     = "chris"
UI_PASSWORD = os.environ.get("UI_PASSWORD", "changeme")

CEREBRAS_API_KEY = os.environ.get("CEREBRAS_API_KEY", "")
CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
AGENT_MODEL       = "gpt-oss-120b"
