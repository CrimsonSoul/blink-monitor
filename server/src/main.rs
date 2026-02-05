use axum::{
  extract::{Query, State},
  http::StatusCode,
  routing::{get, post},
  Json, Router
};
use http::Method;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

#[path = "../../src-tauri/src/blink.rs"]
mod blink;
#[path = "../../src-tauri/src/immi.rs"]
mod immi;

mod media;
mod storage;

use blink::BlinkClient;
use media::ServerState;

type ApiResult<T> = Result<T, (StatusCode, String)>;

#[derive(Deserialize)]
struct LoginRequest {
  email: String,
  password: String
}

#[derive(Deserialize)]
struct PinRequest {
  pin: String
}

#[derive(Deserialize)]
struct SetArmRequest {
  networkId: i64,
  arm: bool
}

#[derive(Deserialize)]
struct MediaQuery {
  page: Option<i64>,
  sinceDays: Option<i64>
}

#[derive(Deserialize)]
struct DeleteMediaRequest {
  items: Vec<serde_json::Value>
}

#[derive(Deserialize)]
struct CameraConfigQuery {
  networkId: i64,
  cameraId: i64,
  productType: String
}

#[derive(Deserialize)]
struct CameraConfigUpdate {
  networkId: i64,
  cameraId: i64,
  productType: String,
  config: serde_json::Value
}

#[derive(Deserialize)]
struct ThumbnailQuery {
  path: String
}

#[tokio::main]
async fn main() {
  let blink_client = Arc::new(Mutex::new(BlinkClient::new()));
  if let Ok(saved) = storage::load_auth() {
    let mut client = blink_client.lock().await;
    *client = BlinkClient::from_state(saved);
  }

  let state = Arc::new(ServerState { blink_client });

  let cors = CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([Method::GET, Method::POST])
    .allow_headers(Any);

  let app = Router::new()
    .merge(media::router())
    .route("/api/health", get(health))
    .route("/api/check-auth", get(check_auth))
    .route("/api/login", post(login))
    .route("/api/verify-pin", post(verify_pin))
    .route("/api/logout", post(logout))
    .route("/api/homescreen", get(get_raw_homescreen))
    .route("/api/media", get(get_raw_media_page))
    .route("/api/set-arm", post(set_network_arm))
    .route("/api/delete-media", post(delete_media_items))
    .route("/api/camera-config", get(get_camera_config).post(update_camera_config))
    .route("/api/thumbnail-base64", get(get_thumbnail_base64))
    .with_state(state)
    .layer(cors);

  let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
  let addr = format!("0.0.0.0:{}", port);
  let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
  println!("Blink Monitor API listening on {}", addr);
  axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
  "ok"
}

async fn check_auth(State(state): State<Arc<ServerState>>) -> ApiResult<Json<bool>> {
  let mut client = state.blink_client.lock().await;
  if let Ok(saved) = storage::load_auth() {
    *client = BlinkClient::from_state(saved);
  }
  Ok(Json(client.token.is_some()))
}

async fn login(State(state): State<Arc<ServerState>>, Json(payload): Json<LoginRequest>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  client.start_oauth_flow().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("OAuth Init Failed: {}", e)))?;
  match client.login_oauth(&payload.email, &payload.password).await {
    Ok(status) => {
      if status == "SUCCESS" {
        let _ = storage::save_auth(&client.get_state());
      }
      Ok(status)
    }
    Err(e) => Err((StatusCode::UNAUTHORIZED, format!("Login Failed: {}", e)))
  }
}

async fn verify_pin(State(state): State<Arc<ServerState>>, Json(payload): Json<PinRequest>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  match client.verify_pin_oauth(&payload.pin).await {
    Ok(_) => {
      let _ = storage::save_auth(&client.get_state());
      Ok("SUCCESS".to_string())
    }
    Err(e) => Err((StatusCode::UNAUTHORIZED, format!("Verification Failed: {}", e)))
  }
}

async fn logout(State(state): State<Arc<ServerState>>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  client.token = None;
  client.refresh_token = None;
  client.account_id = None;
  client.token_expiry = None;
  storage::clear_auth().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
  Ok("Logged out successfully".to_string())
}

async fn get_raw_homescreen(State(state): State<Arc<ServerState>>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  client.get_raw_homescreen().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

async fn get_raw_media_page(State(state): State<Arc<ServerState>>, Query(query): Query<MediaQuery>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  let page = query.page.unwrap_or(1);
  let since_days = query.sinceDays.unwrap_or(30);
  client.get_raw_media_page(page, since_days).await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

async fn set_network_arm(State(state): State<Arc<ServerState>>, Json(payload): Json<SetArmRequest>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  client.set_arm(payload.networkId, payload.arm).await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
  Ok("Success".to_string())
}

async fn delete_media_items(State(state): State<Arc<ServerState>>, Json(payload): Json<DeleteMediaRequest>) -> ApiResult<Json<Vec<i64>>> {
  if payload.items.is_empty() {
    return Ok(Json(Vec::new()));
  }

  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }

  let media_ids: Vec<i64> = payload.items.iter()
    .filter_map(|item| item.get("id").and_then(|v| v.as_i64()))
    .collect();

  let delete_result = client.delete_media(media_ids.clone()).await;

  if delete_result.is_err() {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    for item in &payload.items {
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

  tokio::time::sleep(std::time::Duration::from_secs(2)).await;
  let raw = client.get_raw_media().await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
  let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
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
    return Ok(Json(remaining));
  }

  if let Err(e) = delete_result {
    return Err((StatusCode::BAD_REQUEST, e.to_string()));
  }

  Ok(Json(remaining))
}

async fn get_camera_config(State(state): State<Arc<ServerState>>, Query(query): Query<CameraConfigQuery>) -> ApiResult<Json<serde_json::Value>> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  let res = client.get_camera_config(query.networkId, query.cameraId, &query.productType)
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
  Ok(Json(res))
}

async fn update_camera_config(State(state): State<Arc<ServerState>>, Json(payload): Json<CameraConfigUpdate>) -> ApiResult<StatusCode> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  client.update_camera_config(payload.networkId, payload.cameraId, &payload.productType, payload.config)
    .await
    .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
  Ok(StatusCode::NO_CONTENT)
}

async fn get_thumbnail_base64(State(state): State<Arc<ServerState>>, Query(query): Query<ThumbnailQuery>) -> ApiResult<String> {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = storage::save_auth(&client.get_state());
  }
  let bytes = client.get_thumbnail(&query.path).await.map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
  let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
  Ok(format!("data:image/jpeg;base64,{}", encoded))
}
