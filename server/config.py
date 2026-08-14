import os

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8765"))

CLAUDE_CMD = os.environ.get(
    "CLAUDE_CMD",
    "env -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_SUBAGENT_MODEL claude "
    "--dangerously-skip-permissions --remote-control",
)
TMUX_SESSION = os.environ.get("TMUX_SESSION", "claude")

# Script lancé dans la session tmux. Le chemin était absolu et propre à une seule machine
# (/mnt/projects/ccremote/server/...) : il est désormais résolu par rapport à ce fichier, ce
# qui fonctionne aussi bien en conteneur qu'en natif, quel que soit le point de montage.
LAUNCH_SCRIPT = os.environ.get(
    "LAUNCH_SCRIPT",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "launch-claude.sh"),
)

# Répertoire de travail des sessions. En conteneur, c'est un volume persistant.
WORKSPACE = os.environ.get("WORKSPACE", os.path.expanduser("~"))
