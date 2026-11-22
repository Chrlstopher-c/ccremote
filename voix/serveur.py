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
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from loguru import logger

sys.path.insert(0, os.environ.get("REFLET_RACINE", "/mnt/projects/reflet"))
from serveur.ecoute.transcription import Transcription  # noqa: E402
from serveur import config  # noqa: E402
from serveur.parole.voix import Phrase  # noqa: E402  (Reflet, chemin ajouté ci-dessus)
from serveur.parole.voix import Voix  # noqa: E402

TEXTE_MAX = 600
DEBIT_MP3 = "48k"
# La transcription situe le tampon « Voilà. » ajouté par Reflet pour le couper (sans elle il était dit).
# Phrases courtes du mode vocal : une génération qui ne trouve pas sa fin est coupée plus tôt (plafond serré), et une
# température plus basse la rend plus rare (mesuré 22/11 : 3 phrases sur 20 à 10-16 s de calcul au lieu de 1-2 s).
from serveur.parole import garde_duree, voix as module_voix  # noqa: E402
garde_duree.MARGE_MULTIPLICATIVE = float(os.environ.get("LANTERNE_VOIX_MARGE", "1.7"))
garde_duree.MARGE_FIXE_S = 1.0
garde_duree.DUREE_MIN_S = 3.0
module_voix.TEMPERATURE = float(os.environ.get("LANTERNE_VOIX_TEMPERATURE", "0.65"))
# Flux : pas de tampon « Voilà. » (il faudrait attendre la fin de la phrase pour le couper : la queue mesurée va jusqu'à
# 2,2 s, la retenue annulerait le gain). Rien à retenir, donc RETENUE_S = 0 ; le mode entier garde sa coupe.
module_voix.RETENUE_S = 0.0
TYPE_PCM = "audio/L16;rate=24000;channels=1"  # PCM s16le mono 24 kHz, en morceaux HTTP chunked


class VoixServeur(module_voix.Voix):
    """Voix de Reflet, en deux modes : entier (tampon « Voilà. » coupé, comme Reflet) ou flux (sans tampon)."""

    def __init__(self, stt: object) -> None:
        super().__init__(stt=stt)
        self._sans_tampon = False

    def coupe(self, audio: np.ndarray, taux: int) -> int | None:
        return None if self._sans_tampon else super().coupe(audio, taux)

    def _flux(self, texte: str):
        return self._tts.generate_voice_clone_streaming(
            text=texte, language="french", ref_audio=str(config.VOIX_REF_WAV), ref_text=self._ref_texte,
            max_new_tokens=garde_duree.pas_max(texte), temperature=module_voix.TEMPERATURE,
            instruct=module_voix.CONSIGNE, chunk_size=module_voix.PAS_FLUX,
        )

    def dire_flux(self, texte: str, rendre: Callable[[np.ndarray], None]) -> Phrase:
        self._sans_tampon = True
        try:
            return self.dire_en_flux(texte, rendre)
        finally:
            self._sans_tampon = False


STT = Transcription()
VOIX = VoixServeur(stt=STT)


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
    protocol_version = "HTTP/1.1"  # requis pour la réponse chunked du flux

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
            self.close_connection = True  # corps non lu : la connexion ne peut pas servir une autre requête
            return self._json(404, {"erreur": "route inconnue"})
        try:
            demande = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        except (ValueError, OSError):
            return self._json(400, {"erreur": "corps illisible"})
        texte = str(demande.get("texte", "")).strip()[:TEXTE_MAX]
        if not texte or not VOIX.prete:
            return self._json(400 if not texte else 503, {"erreur": "texte vide" if not texte else "voix pas prête"})
        if demande.get("flux") is True:
            return self._synthetiser_flux(texte)
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

    def _entete_flux(self) -> None:
        self.send_response(200)
        self.send_header("content-type", TYPE_PCM)
        self.send_header("transfer-encoding", "chunked")
        self.end_headers()

    def _synthetiser_flux(self, texte: str) -> None:
        """Phrase → PCM par morceaux dès que la génération en livre un ; sans aucun son, une réponse d'erreur."""
        debut = time.perf_counter()
        ouverte, envoye, premier = False, 0, 0.0

        def rendre(morceau: np.ndarray) -> None:
            nonlocal ouverte, envoye, premier
            if not ouverte:
                self._entete_flux()
                ouverte, premier = True, time.perf_counter() - debut
            octets = (np.clip(morceau, -1.0, 1.0) * 32767).astype("<i2").tobytes()
            envoye += len(morceau)
            self.wfile.write(f"{len(octets):x}\r\n".encode() + octets + b"\r\n")

        try:
            VOIX.dire_flux(texte, rendre)
        except (RuntimeError, OSError, subprocess.CalledProcessError) as err:
            logger.error(f"synthèse en flux en échec « {texte[:40]} » : {err}")
            if not ouverte:
                return self._json(500, {"erreur": "synthèse en échec"})
            self.close_connection = True  # réponse coupée : le nœud la voit incomplète
            return
        if not ouverte:
            self._entete_flux()
        self.wfile.write(b"0\r\n\r\n")
        liberer_gpu()
        fin = (time.perf_counter() - debut) * 1000
        logger.info(f"flux : premier son à {premier * 1000:.0f} ms, fin à {fin:.0f} ms, "
                    f"{envoye / 24000:.1f} s d'audio · « {texte[:50]} »")


def main() -> None:
    port = int(os.environ["LANTERNE_VOIX_PORT"])
    debut = time.perf_counter()
    STT.charger()
    VOIX.charger()
    liberer_gpu()
    logger.info(f"voix chargée en {time.perf_counter() - debut:.1f} s, écoute 127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Gestion).serve_forever()


if __name__ == "__main__":
    main()
