//! Ouvrir une page de connexion Claude dans le navigateur de l'utilisateur (connexion OAuth d'un compte).

use std::process::Command;

/// Seules les pages d'autorisation de Claude passent : l'interface ne peut pas faire ouvrir n'importe quoi.
fn autorisee(url: &str) -> bool {
    ["https://claude.com/", "https://claude.ai/", "https://platform.claude.com/"]
        .iter()
        .any(|p| url.starts_with(p))
        && !url.chars().any(char::is_whitespace)
}

#[tauri::command]
pub fn ouvrir_lien(url: String) -> Result<(), String> {
    if !autorisee(&url) {
        return Err("lien refusé : seules les pages de connexion Claude s’ouvrent d’ici".into());
    }
    Command::new("xdg-open").arg(&url).spawn().map(|_| ()).map_err(|e| {
        log::warn!("xdg-open impossible : {e}");
        format!("navigateur introuvable : {e}")
    })
}
