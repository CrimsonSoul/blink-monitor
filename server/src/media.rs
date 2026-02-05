use axum::{
  extract::{Path, Query, State},
  response::{IntoResponse, Response},
  routing::get,
  Router
};
use axum::body::Body;
use http::{header, StatusCode};
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use futures_util::StreamExt;
use tokio_util::sync::CancellationToken;
use chrono::{Utc, Duration};
use tokio_stream::wrappers::ReceiverStream;

use crate::blink::BlinkClient;
use crate::immi::{self, ImmiStream};

#[derive(serde::Deserialize)]
pub struct ProxyQuery {
  pub url: String
}

#[derive(serde::Deserialize)]
pub struct LiveQuery {
  pub serial: Option<String>,
  pub record: Option<bool>
}

pub struct ServerState {
  pub blink_client: Arc<Mutex<BlinkClient>>
}

pub fn router() -> Router<Arc<ServerState>> {
  Router::new()
    .route("/api/clip", get(proxy_clip))
    .route("/api/proxy", get(proxy_clip))
    .route("/api/thumbnail", get(proxy_thumbnail))
    .route("/api/live/:network_id/:camera_id/:product_type", get(proxy_live))
}

async fn proxy_request_internal(
  state: Arc<ServerState>,
  url: String,
  force_cache: bool,
) -> impl IntoResponse {
  let mut client = state.blink_client.lock().await;
  if let Ok(true) = client.refresh_token_if_needed().await {
    let _ = crate::storage::save_auth(&client.get_state());
  }
  
  let token = match &client.token {
    Some(t) => t.clone(),
    None => return (StatusCode::UNAUTHORIZED, "Not logged in").into_response(),
  };

  let req_url = if url.starts_with("http") {
    url.clone()
  } else {
    format!("{}{}", client.base_url, url)
  };

  if let Ok(parsed) = url::Url::parse(&req_url) {
    if let Some(host) = parsed.host_str() {
      if !host.ends_with(".immedia-semi.com")
        && !host.ends_with(".blinkforhome.com")
        && !host.ends_with(".blink.com")
        && !host.ends_with(".amazonaws.com")
        && !host.ends_with(".cloudfront.net")
      {
        return (StatusCode::BAD_REQUEST, format!("Invalid URL host: {}", host)).into_response();
      }
    } else {
      return (StatusCode::BAD_REQUEST, "Invalid URL").into_response();
    }
  } else {
    return (StatusCode::BAD_REQUEST, "Invalid URL format").into_response();
  }

  let res = match client.client.get(&req_url)
    .header("Authorization", format!("Bearer {}", token))
    .send()
    .await {
      Ok(r) => r,
      Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

  let status = res.status();
  let mut response_builder = Response::builder().status(status);

  for (name, value) in res.headers().iter() {
    if name != header::ACCESS_CONTROL_ALLOW_ORIGIN {
      response_builder = response_builder.header(name, value);
    }
  }

  if force_cache {
    response_builder = response_builder.header(header::CACHE_CONTROL, "public, max-age=3600");
  }

  let stream = res.bytes_stream().map(|result| {
    result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
  });
  let body = Body::from_stream(stream);

  response_builder.body(body).unwrap().into_response()
}

async fn proxy_clip(
  State(state): State<Arc<ServerState>>,
  Query(query): Query<ProxyQuery>,
) -> impl IntoResponse {
  proxy_request_internal(state, query.url, false).await
}

async fn proxy_thumbnail(
  State(state): State<Arc<ServerState>>,
  Query(query): Query<ProxyQuery>,
) -> impl IntoResponse {
  proxy_request_internal(state, query.url, true).await
}

async fn proxy_live(
  State(state): State<Arc<ServerState>>,
  Path((network_id, camera_id, product_type)): Path<(i64, i64, String)>,
  Query(query): Query<LiveQuery>,
) -> impl IntoResponse {
  let serial = query.serial.unwrap_or_default();
  let record = query.record.unwrap_or(false);
  let session_start_time = Utc::now();
  
  let mut lv_res = None;
  let mut retries = 0;
  let max_retries = 5;

  while retries < max_retries {
    let res = {
      let mut client = state.blink_client.lock().await;
      if let Ok(true) = client.refresh_token_if_needed().await {
        let _ = crate::storage::save_auth(&client.get_state());
      }
      client.request_liveview(network_id, camera_id, &product_type, record).await
    };

    match res {
      Ok(res) => {
        lv_res = Some(res);
        break;
      }
      Err(e) => {
        let err_msg = e.to_string();
        eprintln!("Liveview request failed: {}", err_msg);
        if err_msg.contains("307") || err_msg.contains("busy") {
          tokio::time::sleep(std::time::Duration::from_secs(4)).await;
          retries += 1;
          continue;
        } else {
          return (StatusCode::INTERNAL_SERVER_ERROR, format!("Blink API Error: {}", err_msg)).into_response();
        }
      }
    }
  }

  let lv_res = match lv_res {
    Some(res) => res,
    None => return (StatusCode::SERVICE_UNAVAILABLE, "Camera remains busy after retries").into_response(),
  };

  let immi = match ImmiStream::connect(&lv_res.server, &serial).await {
    Ok(s) => s,
    Err(e) => {
      eprintln!("IMMI connection failed: {}", e);
      return (StatusCode::INTERNAL_SERVER_ERROR, format!("IMMI Connection Failed: {}", e)).into_response();
    }
  };

  let (mut immi_rx, mut immi_tx) = (immi.reader, immi.writer);
  let cancel_token = CancellationToken::new();
  let (tx, rx) = mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);

  let token_keepalive = cancel_token.clone();
  let blink_client_inner = state.blink_client.clone();
  let polling_interval = lv_res.polling_interval as u64;
  let cmd_id = lv_res.command_id;
  
  tokio::spawn(async move {
    let mut last_poll = std::time::Instant::now();
    let mut keepalive_seq = 0u32;
    let mut every10s = 0u32;

    let _ = immi::send_latency_stats(&mut immi_tx).await;
    keepalive_seq += 1;
    let _ = immi::send_keepalive(&mut immi_tx, keepalive_seq).await;

    loop {
      tokio::select! {
        _ = token_keepalive.cancelled() => {
          break;
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
          if let Err(_) = immi::send_latency_stats(&mut immi_tx).await {
            break;
          }

          every10s += 1;
          if (every10s % 10) == 0 {
            keepalive_seq += 1;
            if let Err(_) = immi::send_keepalive(&mut immi_tx, keepalive_seq).await {
              break;
            }
          }

          if last_poll.elapsed().as_secs() >= polling_interval {
            let res = {
              let client = blink_client_inner.lock().await;
              client.get_command_status(network_id, cmd_id).await
            };
            match res {
              Ok(status) => {
                let mut running = false;
                if let Some(cmds) = status["commands"].as_array() {
                  for c in cmds {
                    if c["id"].as_i64() == Some(cmd_id) {
                      let state = c["state_condition"].as_str().unwrap_or("");
                      if state == "new" || state == "running" { running = true; }
                    }
                  }
                }
                if !running {
                  break;
                }
              }
              Err(_) => break,
            }
            last_poll = std::time::Instant::now();
          }
        }
      }
    }
    token_keepalive.cancel();
  });

  let token_reader = cancel_token.clone();
  let tx_clone = tx.clone();
  
  tokio::spawn(async move {
    let mut null_packet = vec![0x47, 0x1F, 0xFF, 0x10];
    null_packet.extend(vec![0xFF; 184]);
    
    for _ in 0..3 {
      if tx_clone.send(Ok(axum::body::Bytes::from(null_packet.clone()))).await.is_err() {
        token_reader.cancel();
        return;
      }
    }
    
    let mut mpegts_started = false;
    let mut last_null_packet = std::time::Instant::now();
    let stream_start_time = std::time::Instant::now();
    
    loop {
      let packet_res = tokio::select! {
        _ = token_reader.cancelled() => break,
        res = tokio::time::timeout(std::time::Duration::from_secs(20), immi::read_packet(&mut immi_rx)) => res,
      };

      match packet_res {
        Ok(Ok((msg_type, payload))) => {
          if msg_type == 0x00 && !payload.is_empty() {
            if payload[0] == 0x47 {
              if !mpegts_started {
                mpegts_started = true;
                eprintln!("First MPEG-TS packet received after {}ms", stream_start_time.elapsed().as_millis());
              }
              if tx_clone.send(Ok(axum::body::Bytes::from(payload))).await.is_err() {
                break;
              }
              last_null_packet = std::time::Instant::now();
            }
          } else if !mpegts_started && last_null_packet.elapsed().as_secs() >= 2 {
            if tx_clone.send(Ok(axum::body::Bytes::from(null_packet.clone()))).await.is_err() {
              break;
            }
            last_null_packet = std::time::Instant::now();
          }
        }
        Ok(Err(e)) => {
          eprintln!("IMMI read error: {}", e);
          break;
        }
        Err(_) => {
          eprintln!("IMMI read timeout");
          break;
        }
      }
      
      if !mpegts_started && stream_start_time.elapsed().as_secs() > 35 {
        eprintln!("Stream timed out waiting for data");
        break;
      }
    }
    token_reader.cancel();
  });

  let cleanup_token = cancel_token.clone();
  let cleanup_client = state.blink_client.clone();
  
  tokio::spawn(async move {
    cleanup_token.cancelled().await;
    
    if !record {
      let delays = [5u64, 10, 15, 20, 25, 30];
      let search_after = session_start_time - Duration::seconds(60);
      for delay in delays {
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        
        let ids = {
          let client = cleanup_client.lock().await;
          client.get_latest_media_for_camera(camera_id, search_after).await
        };

        match ids {
          Ok(ids) => {
            if !ids.is_empty() {
              {
                let client = cleanup_client.lock().await;
                let _ = client.delete_media(ids.clone()).await;
              };

              tokio::time::sleep(std::time::Duration::from_secs(4)).await;

              let verification = {
                let client = cleanup_client.lock().await;
                client.get_latest_media_for_camera(camera_id, search_after).await
              };

              match verification {
                Ok(remaining_ids) if remaining_ids.is_empty() => {
                  break;
                }
                _ => {}
              }
            }
          }
          Err(_) => {}
        }
      }
    }
  });

  let body_stream = ReceiverStream::new(rx);
  let body = Body::from_stream(body_stream);

  Response::builder()
    .header(header::CONTENT_TYPE, "video/mp2t")
    .header(header::CACHE_CONTROL, "no-cache")
    .header(header::CONNECTION, "keep-alive")
    .body(body)
    .unwrap()
    .into_response()
}
