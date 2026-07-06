import json
import socket

import websockets
from loguru import logger

from config import PC_HOST, PC_MAC, PC_PORT, WS_TIMEOUT


def send_magic_packet(mac: str = PC_MAC) -> None:
    mac_bytes = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + mac_bytes * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(packet, ("<broadcast>", 9))


async def ws_cmd(payload: dict) -> dict:
    uri = f"ws://{PC_HOST}:{PC_PORT}"
    try:
        async with websockets.connect(uri, open_timeout=WS_TIMEOUT) as ws:
            await ws.send(json.dumps(payload))
            resp = await ws.recv()
            return {"pc_online": True, **json.loads(resp)}
    except Exception as e:
        logger.warning(f"ws_cmd failed: {e}")
        return {"pc_online": False, "status": "error", "message": "PC unreachable"}
