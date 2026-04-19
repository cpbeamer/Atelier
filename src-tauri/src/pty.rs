use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

pub struct PtyState {
    pub pty_master: Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(&args);

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    
    // Release slave
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let master_writer = pair.master; // We will store this to write to it

    *state.pty_master.lock().unwrap() = Some(master_writer);

    thread::spawn(move || {
        let mut buf = [0; 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let chunk = buf[..n].to_vec();
                    // Emit event to frontend
                    let _ = app.emit("pty-data", chunk);
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
        let _ = app.emit("pty-exit", ());
    });

    Ok(())
}

#[tauri::command]
pub fn write_pty(state: State<'_, PtyState>, data: String) -> Result<(), String> {
    let mut lock = state.pty_master.lock().unwrap();
    if let Some(master) = lock.as_mut() {
        let mut writer = master.try_clone_writer().map_err(|e| e.to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn resize_pty(state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let lock = state.pty_master.lock().unwrap();
    if let Some(master) = lock.as_ref() {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
