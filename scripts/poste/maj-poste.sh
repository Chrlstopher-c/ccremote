#!/usr/bin/env bash
# Mise à jour d'un poste Quart déjà installé, à la version du commit HEAD du dépôt.
# Deux routes, selon l'installation d'origine :
#   relais  <machine>                       : machine installée par le relais (ex. pi). Rejoue POST /api/machines/config/<machine>/installer
#                                             (unité, bornes et drop-ins conservés ; secret inchangé). Lit ~/.config/lanterne/moteur.env.
#   manuel  <cible-ssh> <unite> <dossier>   : poste installé à la main (ex. portable). Même séquence que l'installeur :
#                                             archive du HEAD, bun install --frozen-lockfile, ancien code gardé en code.avant-<sha>,
#                                             redémarrage de la seule unité du poste. Config, secret, tunnel et bornes non touchés.
# Vérifier ensuite par l'API : POST /api/machines/config/<machine>/tester, puis une session jetable (haiku, « Réponds seulement OK »).
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-}"
SHA="$(git -C "$RACINE" rev-parse --short HEAD)"

if [ "$MODE" = relais ]; then
  MACHINE="${2:?machine}"
  set -a; . "$HOME/.config/lanterne/moteur.env"; set +a
  curl -sS -m 900 -X POST -H "Authorization: Bearer ${LANTERNE_QUART_JETON}" \
    "${LANTERNE_QUART_URL}/api/machines/config/${MACHINE}/installer"
  echo
  exit 0
fi

if [ "$MODE" = manuel ]; then
  CIBLE="${2:?cible ssh}"; UNITE="${3:?unite}"; DOSSIER="${4:?dossier du poste, relatif a \$HOME}"
  ARCHIVE="$(mktemp -d)/poste-$SHA.tgz"
  git -C "$RACINE" archive --format=tar.gz -o "$ARCHIVE" HEAD poste commun package.json bun.lock
  scp -q "$ARCHIVE" "$CIBLE:$DOSSIER/poste-$SHA.tgz"
  rm -f "$ARCHIVE"
  ssh "$CIBLE" "bash -s -- '$DOSSIER' '$UNITE' '$SHA'" <<'DISTANT'
set -euo pipefail
B="$HOME/$1"; U="$2"; SHA="$3"; ARCHIVE="$B/poste-$SHA.tgz"
[ ! -e "$B/code.avant-$SHA" ] || { echo "sauvegarde code.avant-$SHA deja presente, arret" >&2; exit 3; }
rm -rf "$B/code-nouveau" && mkdir "$B/code-nouveau"
tar -xzf "$ARCHIVE" -C "$B/code-nouveau"
(cd "$B/code-nouveau" && bun install --frozen-lockfile --production >&2 </dev/null)
cd "$B" && { [ -d code ] && mv code "code.avant-$SHA" || true; }
mv code-nouveau code && rm -f "$ARCHIVE"
systemctl --user restart "$U"
sleep 6
systemctl --user is-active "$U"
DISTANT
  exit 0
fi

echo "usage: $0 relais <machine> | manuel <cible-ssh> <unite> <dossier-relatif>" >&2
exit 2
