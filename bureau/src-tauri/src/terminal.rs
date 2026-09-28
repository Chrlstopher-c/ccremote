//! Ouvrir un kitty attaché à une session Claude (serveur `tmux -L claude`), sur cette machine ou via SSH.

use std::fs;
use std::process::Command;

/// Nom de machine ou de session tmux : lettres, chiffres, `_`, `-`, `.` seulement — ils passent dans une
/// commande distante interprétée par un shell, rien d'autre n'y entre.
fn valide(nom: &str) -> bool {
    !nom.is_empty() && nom.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// La machine locale, telle que le poste de cette machine la déclare au relais.
fn machine_locale() -> Option<String> {
    let chemin = dirs::config_dir()?.join("ccremote/poste.json");
    let json: serde_json::Value = serde_json::from_str(&fs::read_to_string(chemin).ok()?).ok()?;
    json.get("machine")?.as_str().map(str::to_owned)
}

#[tauri::command]
pub fn ouvrir_terminal(machine: String, tmux: String, utilisateur: Option<String>) -> Result<(), String> {
    if !valide(&machine) || !valide(&tmux) || !utilisateur.as_deref().map_or(true, valide) {
        return Err(format!("nom refusé : {machine} / {tmux}"));
    }
    let titre = format!("{tmux} · {machine}");
    let attache = ["tmux", "-L", "claude", "-u", "attach", "-t"];
    let cible = format!("={tmux}");
    let mut commande = Command::new("kitty");
    commande.args(["--title", &titre]);
    if machine_locale().as_deref() == Some(machine.as_str()) {
        commande.args(attache).arg(&cible);
    } else {
        // Connexion SSH dédiée (pas la maîtresse partagée) : fermer la fenêtre libère vraiment le client tmux.
        // La commande distante passe par le shell de la machine : `=nom` entre apostrophes, sinon zsh l'expanse.
        // `☠` Le Pi et le VPS n'ont pas la description de terminal `xterm-kitty` : tmux y refusait de s'attacher
        // (« missing or unsuitable terminal ») et la fenêtre se refermait aussitôt (Chris, 28/09).
        let distante = format!(
            "infocmp xterm-kitty >/dev/null 2>&1 || export TERM=xterm-256color; {} '{cible}'",
            attache.join(" ")
        );
        // Le poste peut tourner sous un autre compte que celui de l'alias SSH (le Pi : \`pi\`, l'alias : \`trinity\`) ;
        // son serveur tmux est dans SON dossier : c'est ce compte-là qu'il faut viser.
        commande.args(["ssh", "-t", "-o", "ControlPath=none"]);
        if let Some(u) = &utilisateur {
            commande.args(["-l", u]);
        }
        commande.args([&machine, &distante]);
    }
    commande.spawn().map(|_| ()).map_err(|e| {
        log::error!("kitty introuvable ou refusé : {e}");
        format!("impossible d’ouvrir kitty : {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::valide;

    #[test]
    fn noms_acceptes_et_refuses() {
        assert!(valide("claude-projet_essai-2"));
        assert!(valide("tour"));
        assert!(!valide(""));
        assert!(!valide("a;rm -rf ~"));
        assert!(!valide("$(id)"));
    }
}
