"""Ce que ces tests prouvent : un client sous /api/ sans session valide reçoit du
JSON 401, jamais la page HTML de connexion en 200 (qu'il tenterait de décoder) ;
une route HTML garde la redirection 303 existante — l'interface web ne casse pas.
"""

from fastapi.testclient import TestClient

from app import app


def _client() -> TestClient:
    return TestClient(app, follow_redirects=False)


def test_api_sans_session_rend_401_json() -> None:
    reponse = _client().get("/api/status")
    assert reponse.status_code == 401
    assert reponse.headers["content-type"].startswith("application/json")
    assert reponse.json() == {"detail": "session expirée"}


def test_api_harness_sans_session_rend_401_json() -> None:
    reponse = _client().get("/api/harness/notifications")
    assert reponse.status_code == 401
    assert reponse.json() == {"detail": "session expirée"}


def test_route_html_sans_session_garde_la_redirection_303() -> None:
    reponse = _client().get("/")
    assert reponse.status_code == 303
    assert reponse.headers["location"] == "/login"
