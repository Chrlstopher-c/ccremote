import time

WINDOWS = ("minute", "hour", "day")
KINDS = ("requests", "tokens")
WINDOW_SECONDS = {"minute": 60, "hour": 3600, "day": 86400}


def _empty_quotas() -> dict:
    return {kind: {window: {"limit": None, "remaining": None} for window in WINDOWS} for kind in KINDS}


_snapshots: dict[str, dict] = {}
_updated_at: dict[str, float] = {}


def _effective_quotas(key_label: str) -> dict:
    """Le snapshot ne bouge qu'à chaque appel réel à Cerebras : sans nouvel appel, il reste figé
    sur les valeurs du dernier appel même si la fenêtre (minute/heure/jour) est repassée à zéro
    côté Cerebras entre-temps. On simule le reset : si le temps écoulé depuis la dernière mise à
    jour dépasse la durée de la fenêtre, le quota est forcément revenu au max."""
    raw = _snapshots.get(key_label, _empty_quotas())
    updated_at = _updated_at.get(key_label)
    if updated_at is None:
        return raw
    elapsed = time.time() - updated_at
    result = {}
    for kind in KINDS:
        result[kind] = {}
        for window in WINDOWS:
            quota = raw[kind][window]
            if quota["limit"] is not None and elapsed >= WINDOW_SECONDS[window]:
                result[kind][window] = {"limit": quota["limit"], "remaining": quota["limit"]}
            else:
                result[kind][window] = quota
    return result


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
        "quotas": _effective_quotas(key_label),
        "updated_at": _updated_at.get(key_label),
    }


def _combined_quotas(key_labels: list[str]) -> dict:
    combined = _empty_quotas()
    effective = {label: _effective_quotas(label) for label in key_labels}
    for kind in KINDS:
        for window in WINDOWS:
            limits = [effective[label][kind][window]["limit"] for label in key_labels]
            remainings = [effective[label][kind][window]["remaining"] for label in key_labels]
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
