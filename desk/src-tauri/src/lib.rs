mod desk;
mod pty;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(desk::Desk::default())
    .invoke_handler(tauri::generate_handler![
      desk::pane_create,
      desk::pane_attach,
      desk::pane_write,
      desk::pane_resize,
      desk::pane_close,
      desk::desk_snapshot,
      desk::home_dir
    ])
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let app = window.app_handle();
        app.state::<desk::Desk>().close_window(app, window.label());
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
