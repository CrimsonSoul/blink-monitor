mod blink;
mod storage;
mod server;
mod immi;

use blink::{BlinkClient, Camera, Network};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Emitter, Manager, State, Window};
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;
use url::Url;
use serde_json::Value;
#[cfg(debug_assertions)]
use http::header;

struct AppState {
    blink_client: Arc<Mutex<BlinkClient>>,
    server_port: Mutex<Option<u16>>,
}

#[derive(Clone, serde::Serialize)]
struct LiveviewSettingCandidate {
    path: String,
    value: Value,
    network_id: Option<i64>,
    network_name: Option<String>,
}

fn is_liveview_candidate_key(key: &str, value: &Value) -> bool {
    let k = key.to_lowercase();
    let has_live = k.contains("live") || k.contains("liveview") || k.contains("live_view") || k.contains("lv");
    let has_save = k.contains("save") || k.contains("record") || k.contains("clip");
    if !(has_live && has_save) {
        return false;
    }
    matches!(value, Value::Bool(_) | Value::Number(_) | Value::String(_))
}

fn scan_liveview_candidates(
    value: &Value,
    path: &str,
    out: &mut Vec<LiveviewSettingCandidate>,
    network_id: Option<i64>,
    network_name: Option<String>,
) {
    match value {
        Value::Object(map) => {
            let mut next_network_id = network_id;
            let mut next_network_name = network_name.clone();

            if let (Some(id), Some(name), Some(_armed)) = (
                map.get("id").and_then(|v| v.as_i64()),
                map.get("name").and_then(|v| v.as_str()),
                map.get("armed").and_then(|v| v.as_bool()),
            ) {
                next_network_id = Some(id);
                next_network_name = Some(name.to_string());
            }

            for (k, v) in map {
                let next_path = if path.is_empty() {
                    k.to_string()
                } else {
                    format!("{}.{}", path, k)
                };
                if is_liveview_candidate_key(k, v) {
                    out.push(LiveviewSettingCandidate {
                        path: next_path.clone(),
                        value: v.clone(),
                        network_id: next_network_id,
                        network_name: next_network_name.clone(),
                    });
                }
                scan_liveview_candidates(v, &next_path, out, next_network_id, next_network_name.clone());
            }
        }
        Value::Array(items) => {
            for (idx, item) in items.iter().enumerate() {
                let next_path = format!("{}[{}]", path, idx);
                scan_liveview_candidates(item, &next_path, out, network_id, network_name.clone());
            }
        }
        _ => {}
    }
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
async fn get_raw_media_page(page: i64, since_days: i64, state: State<'_, AppState>) -> Result<String, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    match client.get_raw_media_page(page, since_days).await {
        Ok(res) => Ok(res),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(debug_assertions)]
#[derive(serde::Serialize)]
struct ProbeResult {
    url: String,
    status: u16,
    content_type: Option<String>,
    content_length: Option<u64>,
    final_url: Option<String>,
}

#[cfg(debug_assertions)]
#[tauri::command]
async fn probe_media_url(url: String, kind: String, state: State<'_, AppState>) -> Result<ProbeResult, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    let token = client.token().map_err(|e| e.to_string())?;
    let base_url = client.base_url.clone();
    let full_url = if url.starts_with("http") { url } else { format!("{}{}", base_url, url) };

    let parsed = Url::parse(&full_url).map_err(|e| e.to_string())?;
    let host = parsed.host_str().ok_or_else(|| "Invalid URL host".to_string())?;
    if !host.ends_with(".immedia-semi.com")
        && !host.ends_with(".blinkforhome.com")
        && !host.ends_with(".blink.com")
        && !host.ends_with(".amazonaws.com")
        && !host.ends_with(".cloudfront.net")
    {
        return Err(format!("Invalid URL host: {}", host));
    }

    let mut req = client.client.get(&full_url)
        .header("Authorization", format!("Bearer {}", token));
    if kind == "media" {
        req = req.header(header::RANGE, "bytes=0-0");
    } else {
        req = req.header(header::ACCEPT, "image/*");
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let content_type = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|v| v.to_string());
    let content_length = res.headers().get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let final_url = res.url().as_str().to_string();

    Ok(ProbeResult {
        url: full_url,
        status,
        content_type,
        content_length,
        final_url: Some(final_url),
    })
}

#[tauri::command]
async fn delete_media_items(items: Vec<serde_json::Value>, state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    let media_ids: Vec<i64> = items.iter()
        .filter_map(|item| item.get("id").and_then(|v| v.as_i64()))
        .collect();

    let delete_result = client.delete_media(media_ids.clone()).await;

    // Try richer payloads if the basic delete fails
    if delete_result.is_err() {
        let mut entries: Vec<serde_json::Value> = Vec::new();
        for item in &items {
            if let Some(obj) = item.as_object() {
                let mut map = obj.clone();
                if let Some(id_val) = map.get("id").cloned() {
                    if !map.contains_key("media_id") {
                        map.insert("media_id".to_string(), id_val.clone());
                    }
                    if let Some(id) = id_val.as_i64() {
                        map.insert("media_id".to_string(), serde_json::json!(id.to_string()));
                    }
                }
                entries.push(serde_json::Value::Object(map));
            } else {
                entries.push(item.clone());
            }
        }
        let _ = client.delete_media_with_payloads(media_ids.clone(), entries).await;
    }

    // Give Blink a moment to process
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    let raw = client.get_raw_media().await.map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut remaining = Vec::new();
    if let Some(items) = parsed.get("media").and_then(|v| v.as_array()) {
        let remaining_ids: std::collections::HashSet<i64> = items.iter()
            .filter_map(|item| item.get("id").and_then(|v| v.as_i64()))
            .collect();
        for id in media_ids {
            if remaining_ids.contains(&id) {
                remaining.push(id);
            }
        }
    }

    if remaining.is_empty() {
        return Ok(remaining);
    }

    if let Err(e) = delete_result {
        return Err(e.to_string());
    }

    Ok(remaining)
}

#[tauri::command]
async fn get_liveview_setting_candidates(state: State<'_, AppState>) -> Result<Vec<LiveviewSettingCandidate>, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    let raw = client.get_raw_homescreen().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    scan_liveview_candidates(&json, "", &mut candidates, None, None);
    Ok(candidates)
}

#[tauri::command]
async fn set_network_liveview_save(network_id: i64, enabled: bool, state: State<'_, AppState>) -> Result<bool, String> {
    let mut client = state.blink_client.lock().await;
    if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = storage::save_auth(&client.get_state());
    }
    client.set_network_liveview_save(network_id, enabled).await.map_err(|e| e.to_string())?;

    let raw = client.get_raw_homescreen().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let networks = json.get("networks").and_then(|v| v.as_array()).ok_or_else(|| "No networks in response".to_string())?;
    for net in networks {
        let id = net.get("id").and_then(|v| v.as_i64());
        if id == Some(network_id) {
            let lv_save = net.get("lv_save");
            let matches = match lv_save {
                Some(Value::Bool(b)) => *b == enabled,
                Some(Value::Number(n)) => n.as_i64().map(|v| v != 0).unwrap_or(false) == enabled,
                _ => false,
            };
            return Ok(matches);
        }
    }
    Err("Network not found in response".to_string())
}

#[tauri::command]
async fn download_clip(url: String, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let (token, base_url, http_client) = {
        let client = state.blink_client.lock().await;
        let (token, _account_id) = client.auth().map_err(|e: anyhow::Error| e.to_string())?;
        (token.to_string(), client.base_url.clone(), client.client.clone())
    };

    let full_url = if url.starts_with("http") {
        url
    } else {
        format!("{}{}", base_url, url)
    };

    let parsed = Url::parse(&full_url).map_err(|e| e.to_string())?;
    let host = parsed.host_str().ok_or_else(|| "Invalid URL host".to_string())?;
    if !host.ends_with(".immedia-semi.com")
        && !host.ends_with(".blinkforhome.com")
        && !host.ends_with(".blink.com")
        && !host.ends_with(".amazonaws.com")
        && !host.ends_with(".cloudfront.net")
    {
        return Err(format!("Invalid URL host: {}", host));
    }

    let res = http_client.get(&full_url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Download failed: {} {}", status, body));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&path, bytes).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    id: String,
    received: u64,
    total: Option<u64>,
}

#[tauri::command]
async fn download_clip_with_progress(
    window: Window,
    url: String,
    path: String,
    download_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (token, base_url, http_client) = {
        let client = state.blink_client.lock().await;
        let (token, _account_id) = client.auth().map_err(|e: anyhow::Error| e.to_string())?;
        (token.to_string(), client.base_url.clone(), client.client.clone())
    };

    let full_url = if url.starts_with("http") {
        url
    } else {
        format!("{}{}", base_url, url)
    };

    let parsed = Url::parse(&full_url).map_err(|e| e.to_string())?;
    let host = parsed.host_str().ok_or_else(|| "Invalid URL host".to_string())?;
    if !host.ends_with(".immedia-semi.com")
        && !host.ends_with(".blinkforhome.com")
        && !host.ends_with(".blink.com")
        && !host.ends_with(".amazonaws.com")
        && !host.ends_with(".cloudfront.net")
    {
        return Err(format!("Invalid URL host: {}", host));
    }

    let res = http_client.get(&full_url)
        .header("Authorization", format!("Bearer {}", token))
        .send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Download failed: {} {}", status, body));
    }

    let total = res.content_length();
    let mut received: u64 = 0;
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
    let mut stream = res.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let _ = window.emit("download-progress", DownloadProgress {
            id: download_id.clone(),
            received,
            total,
        });
    }

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
#[cfg(debug_assertions)]
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
            get_raw_media_page,
            probe_media_url,
            delete_media_items,
            get_liveview_setting_candidates,
            set_network_liveview_save,
            get_server_port,
            download_clip,
            download_clip_with_progress,
            get_camera_config,
            update_camera_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(debug_assertions))]
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
            get_raw_media_page,
            delete_media_items,
            get_liveview_setting_candidates,
            set_network_liveview_save,
            get_server_port,
            download_clip,
            download_clip_with_progress,
            get_camera_config,
            update_camera_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
