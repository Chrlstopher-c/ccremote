#!/usr/bin/env bash
# Construit l'app de bureau en release (à lancer sur la tour : les builds lourds n'ont pas leur place sur le portable).
# Les types partagés de ../commun dépendent des modules de la racine : les deux installations sont nécessaires.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"
(cd .. && bun install --frozen-lockfile)
bun install --frozen-lockfile
bunx tauri build --no-bundle
ls -la src-tauri/target/release/quart
