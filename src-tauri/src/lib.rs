mod blink;
mod storage;
mod server;
mod immi;

use blink::{BlinkClient, Camera, Network};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{State, Manager};

struct AppState {
    blink_client: Arc<Mutex<BlinkClient>>,
    server_port: Mutex<Option<u16>>,
}

#[tauri::command]
async fn get_server_port(state: State<'_, AppState>) -> Result<u16, String> {
    let port = state.server_port.lock().await;
    port.ok_or_else(|| "Server not started".to_string())
}

#[tauri::command]
async fn check_auth(state: State<'_, AppState>) -> Result<bool, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(saved) = storage::load_auth() {
        *client = BlinkClient::from_state(saved);
        return Ok(client.token.is_some());
    }
    Ok(false)
}

#[tauri::command]
async fn login(
    email: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    
    if let Err(e) = client.start_oauth_flow().await {
        return Err(format!("OAuth Init Failed: {}", e));
    }

    match client.login_oauth(&email, &password).await {
        Ok(status) => {
            if status == "SUCCESS" {
                let _ = storage::save_auth(&client.get_state());
            }
            Ok(status)
        },
        Err(e) => Err(format!("Login Failed: {}", e)),
    }
}

#[tauri::command]
async fn verify_pin(pin: String, state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    match client.verify_pin_oauth(&pin).await {
        Ok(_) => {
            let _ = storage::save_auth(&client.get_state());
            Ok("SUCCESS".to_string())
        },
        Err(e) => Err(format!("Verification Failed: {}", e)),
    }
}

#[tauri::command]
async fn get_cameras(state: State<'_, AppState>) -> Result<Vec<Camera>, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_homescreen().await {
        Ok(res) => Ok(res.cameras),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_networks(state: State<'_, AppState>) -> Result<Vec<Network>, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_homescreen().await {
        Ok(res) => Ok(res.networks),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_thumbnail_base64(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_thumbnail(&path).await {
        Ok(bytes) => Ok(format!("data:image/jpeg;base64,{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes))),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn set_network_arm(network_id: i64, arm: bool, state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.set_arm(network_id, arm).await {
        Ok(_) => Ok("Success".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    client.token = None;
    client.refresh_token = None;
    client.account_id = None;
    client.token_expiry = None;
    
    if let Err(e) = storage::clear_auth() {
        return Err(format!("Failed to clear auth: {}", e));
    }
    
    Ok("Logged out successfully".to_string())
}

#[tauri::command]
async fn get_raw_homescreen(state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_raw_homescreen().await {
        Ok(res) => Ok(res),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn get_raw_media(state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_raw_media().await {
        Ok(res) => Ok(res),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn download_clip(url: String, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let client = state.blink_client.lock().await;
    let (token, _account_id) = client.auth().map_err(|e: anyhow::Error| e.to_string())?;
    let full_url = client.resolve_url(&url);
    
    let res = client.client.get(&full_url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await.map_err(|e| e.to_string())?;
        
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_camera_config(network_id: i64, camera_id: i64, product_type: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let client = state.blink_client.lock().await;
    client.get_camera_config(network_id, camera_id, &product_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_camera_config(network_id: i64, camera_id: i64, product_type: String, config: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    let client = state.blink_client.lock().await;
    client.update_camera_config(network_id, camera_id, &product_type, config).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let blink_client = Arc::new(Mutex::new(BlinkClient::new()));

    tauri::Builder::default()
        .manage(AppState {
            blink_client: blink_client.clone(),
            server_port: Mutex::new(None),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let blink_client_clone = blink_client.clone();
            
            tauri::async_runtime::spawn(async move {
                let server_state = Arc::new(server::ServerState {
                    blink_client: blink_client_clone,
                });
                let port = server::start_server(server_state).await;
                
                let state = handle.state::<AppState>();
                let mut server_port = state.server_port.lock().await;
                *server_port = Some(port);
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_auth,
            login,
            verify_pin,
            logout,
            get_cameras,
            get_networks,
            get_thumbnail_base64,
            set_network_arm,
            get_raw_homescreen,
            get_raw_media,
            get_server_port,
            download_clip,
            get_camera_config,
            update_camera_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
