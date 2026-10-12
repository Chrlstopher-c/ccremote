# Installer le lanceur `cc` (centralisation des sessions)

À valider par Chris avant exécution. Rien ci-dessous n'a été exécuté : ni `~/.zshrc`, ni `~/.claude/settings.json`,
ni la copie déployée de Quart, ni aucun service.

Prérequis : la branche `centralisation-sessions` est déployée dans `~/.local/share/ccremote/code/` (sinon le lien
ci-dessous pointe vers l'ancien code), et `ccremote-poste` redémarré pour charger `lanceur.ts` et `gestionnaire.ts`.

## 1. Lien symbolique du lanceur

```sh
ln -sf ~/.local/share/ccremote/code/poste/session/cc ~/.local/bin/ccs
```

`cc` résout son propre chemin (`readlink -f`) : il retrouve `tmux.conf` à côté de lui.

## 2. Remplacer le wrapper zsh

Dans `~/.zshrc`, les lignes 51 à 53 sont aujourd'hui :

```
# Quart : chaque `claude` interactif vit dans `tmux -L claude`, géré et visible dans Quart (remplace le lanceur de Relais,
# même serveur tmux ; ancien lanceur : /mnt/projects/relais/sessions/claude.zsh)
[ -f "$HOME/.local/share/ccremote/code/poste/session/claude-tmux.zsh" ] && . "$HOME/.local/share/ccremote/code/poste/session/claude-tmux.zsh"
```

Les remplacer par :

```
# Quart : `claude` passe par le lanceur unique `cc` (registre des sessions dans ~/.local/state/cc/sessions)
claude() { "$HOME/.local/bin/ccs" "$@"; }
```

`claude-tmux.zsh` reste dans le dépôt, non supprimé, pour le retour arrière.

## 3. Vérifications (critères 2, 3 et 5 du tableau §7 du diagnostic)

Critère 2 : `cc` crée la session tmux et la fiche. Depuis un dossier de test, dans kitty (détacher avec Ctrl-b d) :

```sh
cd /tmp && cc            # puis, dans un autre terminal :
tmux -L claude list-sessions        # une ligne claude-tmp (ou claude-<nom>)
ls ~/.local/state/cc/sessions/      # une fiche <id>.json
```

Critère 3 : le `claude` du shell est bien `cc`, et un `claude` lancé dans kitty produit une session visible :

```sh
zsh -ic 'functions claude'          # doit afficher : "$HOME/.local/bin/ccs" "$@"
```

Critère 5 : après une session lancée par `cc` ou par Quart, aucune adoption à faux identifiant :

```sh
journalctl --user -u ccremote-poste --since "-30min" | grep -c '"id":"tmux-'    # doit afficher 0
```

Tests (aucun service touché, serveur tmux isolé `cc-test`) :

```sh
cd ~/.local/share/ccremote/code && bash poste/session/cc.test.sh
bun test poste/session
```

## 4. Retour arrière

```sh
rm ~/.local/bin/ccs
```

Dans `~/.zshrc`, supprimer la fonction `claude() { ... }` et rétablir les lignes 51 à 53 ci-dessus.
Puis ouvrir un nouveau shell. Les sessions déjà lancées par `cc` restent dans `~/.local/state/cc/sessions` : sans
effet sur Quart, l'effacer est sans risque (`rm -r ~/.local/state/cc`). Pour Quart, revenir à la version précédente
de la branche et redémarrer `ccremote-poste`.

## Notes

- Le lanceur `cc` n'est pas exécuté par `ci.yml` (le runner n'a pas tmux). À ajouter si Chris le veut.
- Les sessions déjà ouvertes avant le changement gardent leur ancien nom tmux.

## Veilleur (reprise des sessions Desktop interrompues)

Le veilleur (`poste/session/veilleur`) surveille `~/.claude/sessions/*.json` (entrypoint `claude-desktop`). Si Desktop
se ferme pendant qu'une session travaille (dernière entrée = demande sans réponse ou outil sans résultat), il la
reprend après 45 s via `cc --lanceur veilleur … -- --resume <id>`, une seule fois. Détection de Desktop : processus
`comm = claude-desktop` sans `--type=` dans ses arguments (processus principal Electron ; `ps -eo comm=,args=`).

Installation (rien n'est lancé tant que Chris ne l'a pas demandé) :

```sh
mkdir -p ~/.config/systemd/user
ln -sf ~/.local/share/ccremote/code/poste/session/cc-veilleur.service ~/.config/systemd/user/cc-veilleur.service
systemctl --user daemon-reload
systemctl --user enable --now cc-veilleur.service
```

Vérification :

```sh
systemctl --user status cc-veilleur.service          # active (running)
journalctl --user -u cc-veilleur.service -n 20       # « veilleur démarré », puis « reprise … » si besoin
cd ~/.local/share/ccremote/code && bash poste/session/veilleur.test.sh    # tests isolés (serveur tmux cc-test)
```

Retour arrière :

```sh
systemctl --user disable --now cc-veilleur.service
rm ~/.config/systemd/user/cc-veilleur.service && systemctl --user daemon-reload
rm -f ~/.local/state/cc/veilleur.json                # état des reprises (optionnel)
```

Notes :
- `ExecStart` pointe vers `~/.local/share/ccremote/code/` : `systemd-analyze verify` signale l'absence du fichier tant
  que la branche n'est pas déployée (attendu).
- `VEILLEUR_CC` vaut `~/.local/bin/cc` par défaut ; `cc` doit donc être installé (§1) avant le veilleur.
