#!/usr/bin/env python3
import asyncio
import json
import re
import socket
import struct
import subprocess
import time

import psutil
import websockets
from loguru import logger
from config import HOST, PORT, TMUX_SESSION

_net_prev: dict = {}


def tmux_session_exists(name: str = TMUX_SESSION) -> bool:
    r = subprocess.run(["tmux", "has-session", "-t", name], capture_output=True)
    return r.returncode == 0


def list_tmux_sessions() -> list[dict]:
    r = subprocess.run(
        ["tmux", "list-sessions", "-F", "#{session_name}|#{session_created}|#{session_attached}"],
        capture_output=True, text=True
    )
    sessions = []
    for line in r.stdout.strip().splitlines():
        if not line:
            continue
        parts = line.split("|")
        sessions.append({
            "name": parts[0],
            "created": int(parts[1]) if parts[1].isdigit() else 0,
            "attached": parts[2] == "1",
        })
    return sessions


def launch_claude(name: str = TMUX_SESSION) -> dict:
    if tmux_session_exists(name):
        return {"status": "already_running", "session": name}
    try:
        subprocess.Popen(
            ["tmux", "new-session", "-d", "-s", name,
             "bash -l /mnt/projects/ccremote/server/launch-claude.sh"],
        )
        return {"status": "launched", "session": name}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def capture_pane(name: str, lines: int = 60) -> str:
    r = subprocess.run(
        ["tmux", "capture-pane", "-p", "-t", name, "-S", f"-{lines}"],
        capture_output=True, text=True
    )
    return r.stdout


def get_metrics() -> dict:
    global _net_prev
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    net = psutil.net_io_counters()

    now = time.time()
    delta = now - _net_prev.get("ts", now - 1)
    sent_rate = (net.bytes_sent - _net_prev.get("sent", net.bytes_sent)) / delta
    recv_rate = (net.bytes_recv - _net_prev.get("recv", net.bytes_recv)) / delta
    _net_prev = {"ts": now, "sent": net.bytes_sent, "recv": net.bytes_recv}

    gpu_util, gpu_mem_used, gpu_mem_total = 0, 0, 0
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=2
        ).stdout.strip()
        if out:
            parts = [p.strip() for p in out.split(",")]
            gpu_util = int(parts[0])
            gpu_mem_used = int(parts[1])
            gpu_mem_total = int(parts[2])
    except Exception:
        pass

    return {
        "cpu": round(cpu, 1),
        "mem_percent": round(mem.percent, 1),
        "mem_used_mb": mem.used // 1024 // 1024,
        "mem_total_mb": mem.total // 1024 // 1024,
        "gpu_util": gpu_util,
        "gpu_mem_used_mb": gpu_mem_used,
        "gpu_mem_total_mb": gpu_mem_total,
        "net_up_kb": round(sent_rate / 1024, 1),
        "net_down_kb": round(recv_rate / 1024, 1),
    }


async def handle(websocket: websockets.ServerConnection) -> None:
    client = websocket.remote_address
    logger.info(f"connection from {client}")
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                cmd = msg.get("cmd")
                logger.info(f"cmd={cmd}")

                if cmd == "status":
                    running = tmux_session_exists()
                    resp = {"status": "ok", "claude_running": running}

                elif cmd == "launch":
                    resp = launch_claude(msg.get("session", TMUX_SESSION))

                elif cmd == "kill":
                    name = msg.get("session", TMUX_SESSION)
                    subprocess.run(["tmux", "kill-session", "-t", name])
                    resp = {"status": "killed", "session": name}

                elif cmd == "list_sessions":
                    resp = {"status": "ok", "sessions": list_tmux_sessions()}

                elif cmd == "capture_pane":
                    name = msg.get("session", TMUX_SESSION)
                    lines = msg.get("lines", 60)
                    output = capture_pane(name, lines) if tmux_session_exists(name) else ""
                    resp = {"status": "ok", "output": output}

                elif cmd == "send_keys":
                    name = msg.get("session", TMUX_SESSION)
                    keys = msg.get("keys", "")
                    if tmux_session_exists(name):
                        subprocess.run(["tmux", "send-keys", "-t", name, keys, "Enter"])
                        resp = {"status": "ok"}
                    else:
                        resp = {"status": "error", "message": "session not found"}

                elif cmd == "metrics":
                    resp = {"status": "ok", **get_metrics()}

                else:
                    resp = {"status": "error", "message": f"unknown cmd: {cmd}"}

                await websocket.send(json.dumps(resp))

            except json.JSONDecodeError:
                await websocket.send(json.dumps({"status": "error", "message": "invalid json"}))

    except websockets.exceptions.ConnectionClosed:
        logger.info(f"disconnected: {client}")


async def main() -> None:
    logger.info(f"ccremote server listening on {HOST}:{PORT}")
    async with websockets.serve(handle, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
