from collections.abc import Awaitable, Callable

from pc_client import send_magic_packet, ws_cmd

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_status",
            "description": "Vérifie si le PC est joignable et si une session Claude Code tourne.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_metrics",
            "description": "Performances live du PC : usage CPU/RAM/GPU, température CPU/GPU, débit réseau.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_sessions",
            "description": "Liste les sessions tmux actives sur le PC (Claude Code ou autres).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "launch_session",
            "description": "Lance Claude Code dans une nouvelle session tmux sur le PC.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session": {"type": "string", "description": "Nom de session, défaut 'claude'."}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kill_session",
            "description": "Tue une session tmux sur le PC.",
            "parameters": {
                "type": "object",
                "properties": {"session": {"type": "string", "description": "Nom de la session à tuer."}},
                "required": ["session"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_pane",
            "description": "Lit l'output terminal récent d'une session tmux (ce que Claude Code affiche).",
            "parameters": {
                "type": "object",
                "properties": {
                    "session": {"type": "string", "description": "Nom de la session."},
                    "lines": {"type": "integer", "description": "Nombre de lignes à lire, défaut 60."},
                },
                "required": ["session"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_keys",
            "description": "Envoie du texte + Enter dans une session tmux, comme si on tapait au clavier.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session": {"type": "string", "description": "Nom de la session."},
                    "keys": {"type": "string", "description": "Texte à envoyer."},
                },
                "required": ["session", "keys"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wake_pc",
            "description": "Réveille le PC via Wake-on-LAN s'il est éteint.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "shutdown_pc",
            "description": "Éteint le PC distant proprement (systemctl poweroff). Irréversible sans accès physique ou Wake-on-LAN.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_claude_accounts",
            "description": "Liste les comptes Claude Code disponibles sur le PC et indique lequel est actif.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "switch_claude_account",
            "description": "Change le compte Claude Code actif sur le PC (redémarre les sessions tmux en cours).",
            "parameters": {
                "type": "object",
                "properties": {
                    "account": {"type": "string", "description": "Identifiant du compte, ex 'account1' ou 'account2'."}
                },
                "required": ["account"],
            },
        },
    },
]


async def _get_status(**_: object) -> dict:
    return await ws_cmd({"cmd": "status"})


async def _get_metrics(**_: object) -> dict:
    return await ws_cmd({"cmd": "metrics"})


async def _list_sessions(**_: object) -> dict:
    return await ws_cmd({"cmd": "list_sessions"})


async def _launch_session(session: str = "claude", **_: object) -> dict:
    return await ws_cmd({"cmd": "launch", "session": session})


async def _kill_session(session: str, **_: object) -> dict:
    return await ws_cmd({"cmd": "kill", "session": session})


async def _capture_pane(session: str, lines: int = 60, **_: object) -> dict:
    return await ws_cmd({"cmd": "capture_pane", "session": session, "lines": lines})


async def _send_keys(session: str, keys: str, **_: object) -> dict:
    return await ws_cmd({"cmd": "send_keys", "session": session, "keys": keys})


async def _wake_pc(**_: object) -> dict:
    send_magic_packet()
    return {"status": "sent"}


async def _shutdown_pc(**_: object) -> dict:
    return await ws_cmd({"cmd": "shutdown"})


async def _list_claude_accounts(**_: object) -> dict:
    return await ws_cmd({"cmd": "list_claude_accounts"})


async def _switch_claude_account(account: str, **_: object) -> dict:
    return await ws_cmd({"cmd": "switch_claude_account", "account": account}, timeout=20)


TOOL_EXECUTORS: dict[str, Callable[..., Awaitable[dict]]] = {
    "get_status": _get_status,
    "get_metrics": _get_metrics,
    "list_sessions": _list_sessions,
    "launch_session": _launch_session,
    "kill_session": _kill_session,
    "capture_pane": _capture_pane,
    "send_keys": _send_keys,
    "wake_pc": _wake_pc,
    "shutdown_pc": _shutdown_pc,
    "list_claude_accounts": _list_claude_accounts,
    "switch_claude_account": _switch_claude_account,
}
