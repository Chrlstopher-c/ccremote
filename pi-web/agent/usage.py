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


def _combined_quotas(key_labels: list[str]) -> dict:
    combined = _empty_quotas()
    for kind in KINDS:
        for window in WINDOWS:
            limits = [_snapshots.get(label, _empty_quotas())[kind][window]["limit"] for label in key_labels]
            remainings = [_snapshots.get(label, _empty_quotas())[kind][window]["remaining"] for label in key_labels]
            if limits and all(v is not None for v in limits):
                combined[kind][window]["limit"] = sum(limits)
            if remainings and all(v is not None for v in remainings):
                combined[kind][window]["remaining"] = sum(remainings)
    return combined


def get_all(key_labels: list[str], active_key: str | None) -> dict:
    """Vue complète multi-clés : le fallback rend la capacité combinée réelle (pas cosmétique),
    donc on l'affiche — mais chaque clé reste visible séparément pour ne rien cacher."""
    updates = [_updated_at[label] for label in key_labels if label in _updated_at]
    return {
        "active_key": active_key,
        "keys": {label: get_snapshot(label) for label in key_labels},
        "combined": {
            "quotas": _combined_quotas(key_labels),
            "updated_at": max(updates) if updates else None,
        },
    }
