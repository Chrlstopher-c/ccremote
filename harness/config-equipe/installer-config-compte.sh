#!/usr/bin/env bash
# Installe la configuration Claude Code d'un compte d'équipe.
#
# ☠ POURQUOI CE SCRIPT EXISTE. Isoler un compte par `CLAUDE_CONFIG_DIR` isole
# AUSSI toute la configuration : ni CLAUDE.md, ni skills, ni règles, ni settings.
# Le harness compense par des liens symboliques, posés à la main le 22/07 — et
# « à la main » est précisément le défaut. Relevé le 01/08 :
#
#   · `reference/` n'était lié sur AUCUN compte, alors que CLAUDE.md et les
#     règles y renvoient nommément. Les leads lisaient des consignes pointant
#     vers des fichiers inexistants ;
#   · `compte-b` n'avait ni `plugins` ni `settings.json`, là où `compte-a` les
#     avait. Comme la rotation multi-comptes est automatique, une équipe n'avait
#     donc pas les mêmes capacités selon le compte tiré — une asymétrie que rien
#     ne signalait et que personne ne pouvait constater depuis l'interface.
#
# Rendre l'opération reproductible et idempotente est la seule parade : un geste
# manuel non versionné se re-oublie au compte suivant. Le TODO le disait déjà
# (« à refaire pour tout nouveau compte ajouté ») — un rappel n'est pas un
# mécanisme.
#
# Usage : ./installer-config-compte.sh <compte-a|compte-b|…> [--verifier]

set -euo pipefail

COMPTE="${1:-}"
MODE="${2:-installer}"
if [[ -z "$COMPTE" ]]; then
  echo "usage : $0 <nom-du-compte> [--verifier]" >&2
  exit 2
fi

POSTE="$HOME/.claude"
CIBLE="$HOME/.claude-comptes/$COMPTE"
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ☠ `CLAUDE.md` ne pointe PAS vers celui du poste : celui-ci s'adresse à un agent
# qui converse avec l'opérateur (« ton interlocuteur », « il te répond »). Un lead
# qui le charge attend une réponse qui ne viendra jamais, et peut attribuer à
# l'humain des instructions venues de l'orchestrateur (H-66). Le fichier d'équipe
# garde les standards et les réflexes, et remplace la relation.
#
# ☠ `plugins/` est VOLONTAIREMENT absent de cette liste. C'est de l'ÉTAT par
# compte (cache, marketplaces installés, balayages datés), pas de la
# configuration partageable : le lier ferait écrire plusieurs workers concurrents
# dans le même dossier. Constaté le 01/08 — `compte-b` a le sien en propre et
# fonctionne. Ne pas « uniformiser » sans mesurer ce que ça déplace.
declare -A LIENS=(
  ["CLAUDE.md"]="$ICI/CLAUDE-equipe.md"
  ["rules"]="$POSTE/rules"
  ["reference"]="$POSTE/reference"
  ["skills"]="$POSTE/skills"
  ["commands"]="$POSTE/commands"
  ["settings.json"]="$POSTE/settings.json"
)

if [[ ! -d "$CIBLE" ]]; then
  echo "✗ $CIBLE n'existe pas — authentifie d'abord ce compte (CLAUDE_CONFIG_DIR=$CIBLE claude)" >&2
  exit 1
fi

manquants=0
for nom in "${!LIENS[@]}"; do
  source="${LIENS[$nom]}"
  lien="$CIBLE/$nom"

  # ☠ Une source absente n'est PAS une erreur silencieuse : un lien pendouillant
  # se lit comme un fichier vide côté CLI, ce qui est exactement le mode de
  # panne qu'on corrige.
  if [[ ! -e "$source" ]]; then
    echo "  ⚠ $nom — source absente ($source), lien non posé"
    manquants=$((manquants + 1))
    continue
  fi

  actuel=""
  [[ -L "$lien" ]] && actuel="$(readlink "$lien")"

  if [[ "$actuel" == "$source" ]]; then
    echo "  ✓ $nom"
    continue
  fi

  if [[ "$MODE" == "--verifier" ]]; then
    if [[ -z "$actuel" ]]; then echo "  ✗ $nom — ABSENT"; else echo "  ✗ $nom — pointe vers $actuel"; fi
    manquants=$((manquants + 1))
    continue
  fi

  # ☠ Un vrai fichier à cet endroit n'est JAMAIS écrasé sans copie : le voisin
  # `.credentials.json` rappelle ce qui vit dans ce dossier. On sauvegarde,
  # horodaté, puis on pose le lien — et on dit où est la copie. Un dossier réel,
  # lui, n'est pas touché du tout : c'est de l'état, pas un réglage.
  if [[ -d "$lien" && ! -L "$lien" ]]; then
    echo "  · $nom — dossier réel propre au compte, laissé tel quel"
    continue
  fi
  if [[ -e "$lien" && ! -L "$lien" ]]; then
    copie="$lien.avant-config-equipe.$(date +%Y%m%d%H%M%S)"
    cp -a "$lien" "$copie"
    echo "  · $nom — original sauvegardé dans $(basename "$copie")"
  fi

  ln -sfn "$source" "$lien"
  echo "  → $nom lié"
done

if [[ "$MODE" == "--verifier" && $manquants -gt 0 ]]; then
  echo "✗ $COMPTE : $manquants élément(s) manquant(s) — lance sans --verifier pour corriger" >&2
  exit 1
fi

echo "✓ $COMPTE configuré"
