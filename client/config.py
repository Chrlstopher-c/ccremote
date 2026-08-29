"""Coordonnées réseau du parc — aucune valeur réelle dans le dépôt.

Les hôtes, la MAC et les ports viennent de l'environnement : un déploiement
renseigne son propre `.env` / ses propres variables, le dépôt ne connaît que
des placeholders inertes.
"""

import os

PC_HOST = os.environ.get("CCREMOTE_PC_HOST", "pc.exemple")
PC_PORT = int(os.environ.get("CCREMOTE_PC_PORT", "8765"))
PC_MAC = os.environ.get("CCREMOTE_PC_MAC", "aa:bb:cc:dd:ee:ff")
PC_USER = os.environ.get("CCREMOTE_PC_USER", "trinity")
PI_USER = os.environ.get("CCREMOTE_PI_USER", "pi")
PI_HOST = os.environ.get("CCREMOTE_PI_HOST", "pi.exemple")
PC_SSH_PORT = int(os.environ.get("CCREMOTE_PC_SSH_PORT", "22"))

TMUX_SESSION = "claude"
WS_TIMEOUT = 10
