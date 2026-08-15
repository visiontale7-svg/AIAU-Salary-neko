mod analysis;
mod calendar;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod codex_app_server;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod codex_cli;
mod commands;
mod corrections;
mod domain;
mod error;
mod import;
mod keychain;
mod openai;
mod platform;
mod provider;
mod repository;
mod schemas;
mod spans;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let repository = tauri::async_runtime::block_on(repository::Repository::connect(
                data_dir.join("dialogue-atlas.sqlite3"),
            ))
            .map_err(|error| std::io::Error::other(error.to_string()))?;
            let openai = openai::OpenAiClient::new()
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(commands::AppState::new(repository, openai));
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                let state = app.state::<commands::AppState>();
                let calendar = state.calendar.clone();
                let repository = state.repository.clone();
                let codex_home = app.path().home_dir()?.join(".codex");
                tauri::async_runtime::spawn(async move {
                    let _ = calendar
                        .start_index(app_handle, repository, codex_home)
                        .await;
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::preview_codex_jsonl,
            commands::preview_paste,
            commands::start_codex_session_index,
            commands::cancel_codex_session_index,
            commands::get_codex_session_index_status,
            commands::query_calendar_entries,
            commands::list_undated_calendar_entries,
            commands::get_calendar_entry,
            commands::list_calendar_entry_versions,
            commands::start_import_preview,
            commands::cancel_import_preview,
            commands::commit_import,
            commands::list_conversations,
            commands::set_api_key,
            commands::test_api_key,
            commands::get_analysis_settings,
            commands::set_analysis_provider,
            commands::test_analysis_provider,
            commands::start_analysis,
            commands::cancel_analysis,
            commands::retry_failed_stage,
            commands::get_snapshot,
            commands::apply_correction,
            commands::reset_item_to_model,
            commands::save_layout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dialogue Atlas");
}
