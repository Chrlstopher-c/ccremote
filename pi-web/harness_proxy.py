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
from fastapi.responses import JSONResponse
from loguru import logger

from config import HARNESS_API_URL

# Court : le harness est en local, il répond en millisecondes. Un délai long ne
# ferait qu'immobiliser l'interface quand le process est mort.
TIMEOUT_S = 5.0


def build_router(check_session) -> APIRouter:
    """`check_session` est injectée pour éviter d'importer `app.py` (cycle)."""
    router = APIRouter()

    @router.get("/api/harness/{chemin:path}")
    async def relayer(chemin: str, request: Request, _: str = Depends(check_session)):
        url = f"{HARNESS_API_URL}/api/harness/{chemin}"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
                reponse = await client.get(url, params=dict(request.query_params))
        except httpx.RequestError as erreur:
            logger.error(f"harness injoignable sur {url} : {erreur}")
            return JSONResponse(
                status_code=502,
                content={
                    "error": "harness_injoignable",
                    # Formulé pour être affichable tel quel : c'est ce message
                    # qui doit empêcher de croire à un simple PC éteint.
                    "message": "Le control plane du harness ne répond pas sur le Pi — ce n'est pas un PC éteint.",
                },
            )
        return JSONResponse(status_code=reponse.status_code, content=reponse.json())

    return router
