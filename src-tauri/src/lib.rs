mod pty;

use std::sync::{Arc, Mutex};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyState {
            pty_master: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Spawn Temporal dev server sidecar
            let temporal_sidecar = app.shell().sidecar("temporal").unwrap()
                .args(["server", "start-dev", "--port", "7466", "--http-port", "7467", "--ui-port", "8466"]);
            let (_, _rx1) = temporal_sidecar.spawn().expect("Failed to start Temporal sidecar");
            
            // Spawn Bun worker
            let bun_worker = app.shell().command("bun")
                .args(["run", "start"])
                .current_dir("../worker");
            let (_, _rx2) = bun_worker.spawn().expect("Failed to start Bun worker");
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

