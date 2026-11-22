"""Voix de Lanterne — service de synthèse de la tour pour le mode vocal de l'iPhone.

Réutilise tel quel la synthèse de Reflet (classe `Voix` : Qwen3-TTS 0.6B, voix de référence, mot tampon coupé) ;
ne fait qu'exposer une phrase → audio sur la boucle locale. Le nœud Quart de la tour l'appelle, l'iPhone passe par
son canal chiffré : rien n'est exposé hors de la machine.

Variables : LANTERNE_VOIX_PORT (obligatoire), REFLET_RACINE (dossier de Reflet), REFLET_VOIX_REF, REFLET_CACHE_TTS.
"""
import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from loguru import logger

sys.path.insert(0, os.environ.get("REFLET_RACINE", "/mnt/projects/reflet"))
from serveur.parole.voix import Voix  # noqa: E402  (Reflet, chemin ajouté ci-dessus)

TEXTE_MAX = 600
DEBIT_MP3 = "48k"
VOIX = Voix(stt=None)


def encoder_mp3(audio: np.ndarray, taux: int) -> bytes:
    """float32 mono → MP3 (petit pour la 4G, lu nativement par AVAudioPlayer)."""
    commande = ["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(taux), "-ac", "1", "-i", "pipe:0",
                "-c:a", "libmp3lame", "-b:a", DEBIT_MP3, "-f", "mp3", "pipe:1"]
    try:
        sortie = subprocess.run(commande, input=audio.astype(np.float32).tobytes(), capture_output=True, check=True)
    except (OSError, subprocess.CalledProcessError) as err:
        logger.error(f"encodage mp3 impossible : {err}")
        raise
    return sortie.stdout


def encoder_wav(audio: np.ndarray, taux: int) -> bytes:
    import io

    import soundfile

    tampon = io.BytesIO()
    soundfile.write(tampon, audio, taux, format="WAV", subtype="PCM_16")
    return tampon.getvalue()


def liberer_gpu() -> None:
    """Rend au GPU le cache de l'allocateur : la carte est partagée avec la dictée et un LLM local."""
    import torch

    torch.cuda.empty_cache()
    logger.info(f"GPU : {torch.cuda.memory_allocated() >> 20} Mo alloués, {torch.cuda.memory_reserved() >> 20} réservés")


class Gestion(BaseHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        return

    def _repondre(self, statut: int, corps: bytes, type_: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(statut)
        self.send_header("content-type", type_)
        self.send_header("content-length", str(len(corps)))
        for cle, valeur in (extra or {}).items():
            self.send_header(cle, valeur)
        self.end_headers()
        self.wfile.write(corps)

    def _json(self, statut: int, donnee: dict) -> None:
        self._repondre(statut, json.dumps(donnee).encode(), "application/json")

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/sante":
            return self._json(404, {"erreur": "route inconnue"})
        self._json(200, {"pret": VOIX.prete})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/synthese":
            return self._json(404, {"erreur": "route inconnue"})
        try:
            demande = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        except (ValueError, OSError):
            return self._json(400, {"erreur": "corps illisible"})
        texte = str(demande.get("texte", "")).strip()[:TEXTE_MAX]
        if not texte or not VOIX.prete:
            return self._json(400 if not texte else 503, {"erreur": "texte vide" if not texte else "voix pas prête"})
        self._synthetiser(texte, demande.get("format") == "wav")

    def _synthetiser(self, texte: str, wav: bool) -> None:
        debut = time.perf_counter()
        try:
            phrase = VOIX.dire(texte)
            corps = encoder_wav(phrase.audio, phrase.taux) if wav else encoder_mp3(phrase.audio, phrase.taux)
        except (RuntimeError, OSError, subprocess.CalledProcessError) as err:
            logger.error(f"synthèse en échec « {texte[:40]} » : {err}")
            return self._json(500, {"erreur": "synthèse en échec"})
        liberer_gpu()
        calcul = int((time.perf_counter() - debut) * 1000)
        duree = int(len(phrase.audio) / phrase.taux * 1000)
        logger.info(f"{calcul} ms → {duree} ms d'audio · {len(corps)} o · « {texte[:50]} »")
        extra = {"x-calcul-ms": str(calcul), "x-duree-ms": str(duree)}
        self._repondre(200, corps, "audio/wav" if wav else "audio/mpeg", extra)


def main() -> None:
    port = int(os.environ["LANTERNE_VOIX_PORT"])
    debut = time.perf_counter()
    VOIX.charger()
    liberer_gpu()
    logger.info(f"voix chargée en {time.perf_counter() - debut:.1f} s, écoute 127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Gestion).serve_forever()


if __name__ == "__main__":
    main()
