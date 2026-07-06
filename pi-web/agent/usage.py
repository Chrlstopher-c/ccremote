import time

WINDOWS = ("minute", "hour", "day")
KINDS = ("requests", "tokens")

_snapshot: dict = {
    kind: {window: {"limit": None, "remaining": None} for window in WINDOWS} for kind in KINDS
}
_updated_at: float | None = None


def record_headers(headers) -> None:
    global _updated_at
    found = False
    for kind in KINDS:
        for window in WINDOWS:
            for field, key in (("limit", "limit"), ("remaining", "remaining")):
                header = f"x-ratelimit-{key}-{kind}-{window}"
                value = headers.get(header)
                if value is not None:
                    _snapshot[kind][window][field] = int(value)
                    found = True
    if found:
        _updated_at = time.time()


def get_snapshot() -> dict:
    return {"quotas": _snapshot, "updated_at": _updated_at}
