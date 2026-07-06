import time

WINDOWS = ("minute", "hour", "day")
KINDS = ("requests", "tokens")


def _empty_quotas() -> dict:
    return {kind: {window: {"limit": None, "remaining": None} for window in WINDOWS} for kind in KINDS}


_snapshots: dict[str, dict] = {}
_updated_at: dict[str, float] = {}


def record_headers(key_label: str, headers) -> None:
    snapshot = _snapshots.setdefault(key_label, _empty_quotas())
    found = False
    for kind in KINDS:
        for window in WINDOWS:
            for field in ("limit", "remaining"):
                header = f"x-ratelimit-{field}-{kind}-{window}"
                value = headers.get(header)
                if value is not None:
                    snapshot[kind][window][field] = int(value)
                    found = True
    if found:
        _updated_at[key_label] = time.time()


def get_snapshot(key_label: str | None) -> dict:
    if key_label is None:
        return {"active_key": None, "quotas": _empty_quotas(), "updated_at": None}
    return {
        "active_key": key_label,
        "quotas": _snapshots.get(key_label, _empty_quotas()),
        "updated_at": _updated_at.get(key_label),
    }
