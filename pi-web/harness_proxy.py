"""Relais vers l'API web du harness (Bun), qui tourne en local sur le Pi.

Pourquoi un relais plutôt qu'un appel direct depuis le navigateur : l'API du
harness n'a **aucune authentification propre** et n'écoute que sur la boucle
locale (elle refuse même de démarrer autrement). C'est `pi-web` qui porte la
session et le mot de passe ; tout passe donc par ici, et une seule vérité
existe sur « qui a le droit ».

`☠` Distinction à ne jamais perdre, elle vient de H-75 :

- **PC absent** — le harness répond normalement, avec `pcOnline: false`. Ce
  n'est PAS une erreur : c'est le régime nominal quand la machine de travail
  est éteinte la nuit. On relaie tel quel, en 200.
- **Harness injoignable** — le process Bun ne tourne pas sur le Pi. Ça, c'est
  une vraie panne, et elle doit se voir. On répond 502 avec un corps qui la
  nomme, jamais un `pcOnline: false` qui la ferait passer pour un PC éteint.

Confondre les deux mènerait à chercher un problème sur le PC pendant que le
control plane est mort sur le Pi.
"""

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from loguru import logger

from config import HARNESS_API_URL

# Court : le harness est en local, il répond en millisecondes. Un délai long ne
# ferait qu'immobiliser l'interface quand le process est mort.
TIMEOUT_S = 5.0


def build_router(check_session) -> APIRouter:
    """`check_session` est injectée pour éviter d'importer `app.py` (cycle)."""
    router = APIRouter()

    # ☠ Timeout LONG pour les écritures : la conversation orchestrateur peut
    # mettre plusieurs dizaines de secondes à répondre (le modèle réfléchit).
    # Les lectures, elles, gardent le timeout court : le harness répond en ms.
    TIMEOUT_ECRITURE_S = 130.0

    async def _relayer_injoignable(url: str, erreur: Exception) -> JSONResponse:
        logger.error(f"harness injoignable sur {url} : {erreur}")
        return JSONResponse(
            status_code=502,
            content={
                "error": "harness_injoignable",
                # Formulé pour être affichable tel quel : ce message doit empêcher
                # de croire à un simple PC éteint.
                "message": "Le control plane du harness ne répond pas sur le Pi — ce n'est pas un PC éteint.",
            },
        )

    # `☠` DÉCLARÉE AVANT le relais générique, sinon jamais atteinte : FastAPI
    # résout dans l'ordre de déclaration et `{chemin:path}` avale tout. Cette
    # route est la seule du harness qui rende des OCTETS — une pièce jointe
    # passée par `reponse.json()` ferait exploser le relais sur un PNG.
    @router.get("/api/harness/orchestrator/conversations/{cid}/pieces/{fichier}")
    async def relayer_piece_jointe(
        cid: str, fichier: str, _: str = Depends(check_session)
    ):
        url = f"{HARNESS_API_URL}/api/harness/orchestrator/conversations/{cid}/pieces/{fichier}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                reponse = await client.get(url)
        except httpx.RequestError as erreur:
            return await _relayer_injoignable(url, erreur)
        if reponse.status_code != 200:
            return JSONResponse(status_code=reponse.status_code, content=reponse.json())
        return Response(
            content=reponse.content,
            media_type=reponse.headers.get("content-type", "application/octet-stream"),
            headers={"cache-control": "private, max-age=86400"},
        )

    @router.get("/api/harness/{chemin:path}")
    async def relayer_lecture(chemin: str, request: Request, _: str = Depends(check_session)):
        url = f"{HARNESS_API_URL}/api/harness/{chemin}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                reponse = await client.get(url, params=dict(request.query_params))
        except httpx.RequestError as erreur:
            return await _relayer_injoignable(url, erreur)
        return JSONResponse(status_code=reponse.status_code, content=reponse.json())

    @router.post("/api/harness/{chemin:path}")
    async def relayer_ecriture(chemin: str, request: Request, _: str = Depends(check_session)):
        url = f"{HARNESS_API_URL}/api/harness/{chemin}"
        corps = await request.body()
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_ECRITURE_S) as client:
                reponse = await client.post(
                    url, content=corps, headers={"content-type": "application/json"}
                )
        except httpx.RequestError as erreur:
            return await _relayer_injoignable(url, erreur)
        return JSONResponse(status_code=reponse.status_code, content=reponse.json())

    return router
