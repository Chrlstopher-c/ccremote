#!/usr/bin/env python3
import asyncio
import json
import socket
import struct
import subprocess
import sys
import websockets
from config import PC_HOST, PC_PORT, PC_MAC, PC_USER, PC_SSH_PORT, TMUX_SESSION, WS_TIMEOUT


def send_magic_packet(mac: str) -> None:
    mac_bytes = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(packet, ("<broadcast>", 9))
    print("Magic packet envoyé.")


async def ws_cmd(cmd: str) -> dict:
    uri = f"ws://{PC_HOST}:{PC_PORT}"
    async with websockets.connect(uri, open_timeout=WS_TIMEOUT) as ws:
        await ws.send(json.dumps({"cmd": cmd}))
        resp = await ws.recv()
        return json.loads(resp)


def cmd_wake(_args: list[str]) -> None:
    send_magic_packet(PC_MAC)


def cmd_status(_args: list[str]) -> None:
    resp = asyncio.run(ws_cmd("status"))
    running = resp.get("claude_running", False)
    print(f"PC: online | Claude tmux: {'running' if running else 'stopped'}")


def cmd_launch(_args: list[str]) -> None:
    resp = asyncio.run(ws_cmd("launch"))
    print(f"[{resp.get('status')}] session={resp.get('session', '')}")


def cmd_kill(_args: list[str]) -> None:
    resp = asyncio.run(ws_cmd("kill"))
    print(f"[{resp.get('status')}]")


def cmd_attach(_args: list[str]) -> None:
    subprocess.run([
        "ssh", "-t",
        "-p", str(PC_SSH_PORT),
        f"{PC_USER}@{PC_HOST}",
        f"tmux new-session -t {TMUX_SESSION}"
    ])


COMMANDS: dict = {
    "wake":   cmd_wake,
    "status": cmd_status,
    "launch": cmd_launch,
    "attach": cmd_attach,
    "kill":   cmd_kill,
}

USAGE = """ccremote <command>

  wake    Réveille le PC (Wake-on-LAN)
  status  Vérifie si le PC est joignable et si Claude tourne
  launch  Lance Claude Code dans une session tmux sur le PC
  attach  SSH → PC → tmux attach (reprend la session interactive)
  kill    Tue la session tmux Claude sur le PC
"""

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(USAGE)
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
