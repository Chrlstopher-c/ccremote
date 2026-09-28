//! Quart — coquille native : l'interface vit dans le webview ; ici seulement ce qu'un navigateur ne peut pas faire.

mod lien;
mod terminal;

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![terminal::ouvrir_terminal, lien::ouvrir_lien])
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Quart");
}
