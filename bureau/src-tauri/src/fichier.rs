//! Fichiers présentés dans le fil (images, PDF…) : les enregistrer dans Téléchargements/Quart et les ouvrir dans le
//! navigateur. L'interface donne un nom et des octets, jamais un chemin : elle ne choisit ni où écrire ni quoi ouvrir.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn nom_valide(nom: &str) -> bool {
    !nom.is_empty()
        && nom.len() <= 200
        && !nom.starts_with('.')
        && !nom.chars().any(|c| c == '/' || c == '\\' || c.is_control())
}

fn dossier() -> PathBuf {
    dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Téléchargements")))
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Quart")
}

/// N'écrase jamais : « photo.png », puis « photo (2).png »…
fn chemin_libre(dossier: &Path, nom: &str) -> PathBuf {
    let premier = dossier.join(nom);
    if !premier.exists() {
        return premier;
    }
    let (base, ext) = match nom.rsplit_once('.') {
        Some((b, e)) if !b.is_empty() => (b.to_string(), format!(".{e}")),
        _ => (nom.to_string(), String::new()),
    };
    (2..10_000)
        .map(|i| dossier.join(format!("{base} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(premier)
}

#[tauri::command]
pub fn enregistrer_fichier(nom: String, octets: Vec<u8>) -> Result<String, String> {
    if !nom_valide(&nom) {
        return Err("nom de fichier refusé".into());
    }
    let d = dossier();
    fs::create_dir_all(&d).map_err(|e| format!("dossier {} impossible : {e}", d.display()))?;
    let chemin = chemin_libre(&d, &nom);
    fs::write(&chemin, octets).map_err(|e| {
        log::warn!("écriture de {} impossible : {e}", chemin.display());
        format!("écriture impossible : {e}")
    })?;
    Ok(chemin.to_string_lossy().into_owned())
}

/// L'entrée .desktop du navigateur par défaut (sinon xdg-open, qui choisit selon le type du fichier).
fn navigateur() -> Option<String> {
    let sortie = Command::new("xdg-settings").args(["get", "default-web-browser"]).output().ok()?;
    let id = String::from_utf8(sortie.stdout).ok()?.trim().trim_end_matches(".desktop").to_string();
    (!id.is_empty()).then_some(id)
}

#[tauri::command]
pub fn ouvrir_dans_navigateur(chemin: String) -> Result<(), String> {
    let p = PathBuf::from(&chemin);
    if !p.starts_with(dossier()) || !p.is_file() {
        return Err("seuls les fichiers enregistrés par Quart s’ouvrent d’ici".into());
    }
    let lance = match navigateur() {
        Some(id) => Command::new("gtk-launch").arg(id).arg(&p).spawn(),
        None => Command::new("xdg-open").arg(&p).spawn(),
    };
    lance.map(|_| ()).map_err(|e| {
        log::warn!("ouverture de {chemin} impossible : {e}");
        format!("navigateur introuvable : {e}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noms_acceptes_et_refuses() {
        assert!(nom_valide("capture.png"));
        assert!(nom_valide("photo de nuit.jpg"));
        for nom in ["", ".bashrc", "../x", "a/b.png", "a\\b", "x\ny"] {
            assert!(!nom_valide(nom), "{nom:?} devrait être refusé");
        }
    }

    #[test]
    fn ne_jamais_ecraser() {
        let d = std::env::temp_dir().join(format!("quart-essai-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a.png"), b"1").unwrap();
        fs::write(d.join("a (2).png"), b"2").unwrap();
        assert_eq!(chemin_libre(&d, "a.png"), d.join("a (3).png"));
        assert_eq!(chemin_libre(&d, "neuf.png"), d.join("neuf.png"));
        fs::remove_dir_all(&d).unwrap();
    }
}
