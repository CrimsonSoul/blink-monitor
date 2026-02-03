use serde::{Deserialize, Serialize};
use reqwest::header::{HeaderMap, HeaderValue, REFERER, ORIGIN};
use anyhow::{Result, anyhow};
use uuid::Uuid;
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose};
use rand::{thread_rng, Rng};
use regex::Regex;
use chrono::{Utc, Duration};

pub const OAUTH_BASE_URL: &str = "https://api.oauth.blink.com";
pub const BASE_URL: &str = "https://rest-prod.immedia-semi.com";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HomescreenResponse {
    pub account: serde_json::Value,
    pub networks: Vec<Network>,
    #[serde(default)]
    pub cameras: Vec<Camera>,
    #[serde(default)]
    pub owls: Vec<Camera>,
    #[serde(default)]
    pub doorbells: Vec<Camera>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Network {
    pub id: i64,
    pub name: String,
    pub armed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CameraSignals {
    pub wifi: Option<i64>,
    pub battery: Option<i64>,
    pub temp: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Camera {
    pub id: i64,
    pub name: String,
    pub thumbnail: String,
    pub status: String,
    pub battery: Option<String>,
    pub signals: Option<CameraSignals>,
    pub network_id: Option<i64>,
    #[serde(rename = "type")]
    pub product_type: String,
    pub serial: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LiveViewResponse {
    pub server: String,
    pub command_id: i64,
    pub polling_interval: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Media {
    pub id: i64,
    pub device_name: String,
    pub thumbnail: String,
    pub media: String,
    pub created_at: String,
}

pub struct BlinkClient {
    pub client: reqwest::Client,
    pub token: Option<String>,
    pub refresh_token: Option<String>,
    pub account_id: Option<i64>,
    pub base_url: String,
    pub device_id: String,
    pub code_verifier: String,
    pub csrf_token: Option<String>,
    pub token_expiry: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlinkAuthState {
    pub token: Option<String>,
    pub refresh_token: Option<String>,
    pub account_id: Option<i64>,
    pub base_url: String,
    pub device_id: String,
    pub token_expiry: Option<i64>,
}

impl BlinkClient {
    pub fn new() -> Self {
        let device_id = Uuid::new_v4().to_string().to_uppercase();
        let mut headers = HeaderMap::new();
        headers.insert("User-Agent", HeaderValue::from_static("Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1"));

        Self {
            client: reqwest::Client::builder()
                .default_headers(headers)
                .cookie_store(true)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.url().scheme() == "immedia-blink" {
                        attempt.stop()
                    } else {
                        attempt.follow()
                    }
                }))
                .build()
                .unwrap(),
            token: None,
            refresh_token: None,
            account_id: None,
            base_url: BASE_URL.to_string(),
            device_id,
            code_verifier: Self::generate_verifier(),
            csrf_token: None,
            token_expiry: None,
        }
    }

    pub fn from_state(state: BlinkAuthState) -> Self {
        let mut client = Self::new();
        client.token = state.token;
        client.refresh_token = state.refresh_token;
        client.account_id = state.account_id;
        client.base_url = state.base_url;
        client.device_id = state.device_id;
        client.token_expiry = state.token_expiry;
        client
    }

    pub fn get_state(&self) -> BlinkAuthState {
        BlinkAuthState {
            token: self.token.clone(),
            refresh_token: self.refresh_token.clone(),
            account_id: self.account_id,
            base_url: self.base_url.clone(),
            device_id: self.device_id.clone(),
            token_expiry: self.token_expiry,
        }
    }

    // Helper to get token reference
    pub fn token(&self) -> Result<&str> {
        self.token.as_ref().map(|s| s.as_str()).ok_or(anyhow!("No token"))
    }

    // Helper to get both token and account_id
    pub fn auth(&self) -> Result<(&str, i64)> {
        let token = self.token()?;
        let account_id = self.account_id.ok_or(anyhow!("Not logged in"))?;
        Ok((token, account_id))
    }

    // Helper to resolve URL paths
    pub fn resolve_url(&self, path: &str) -> String {
        if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base_url, path)
        }
    }

    fn generate_verifier() -> String {
        let mut rng = thread_rng();
        let bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
        general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    fn get_challenge(verifier: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(verifier.as_bytes());
        let hash = hasher.finalize();
        general_purpose::URL_SAFE_NO_PAD.encode(hash)
    }

    pub async fn start_oauth_flow(&mut self) -> Result<()> {
        let challenge = Self::get_challenge(&self.code_verifier);
        let url = format!("{}/oauth/v2/authorize", OAUTH_BASE_URL);
        
        let params = [
            ("app_brand", "blink"),
            ("app_version", "30.0.0"),
            ("client_id", "ios"),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("device_brand", "Apple"),
            ("device_model", "iPhone16,1"),
            ("device_os_version", "18.2"),
            ("hardware_id", &self.device_id),
            ("redirect_uri", "immedia-blink://applinks.blink.com/signin/callback"),
            ("response_type", "code"),
            ("scope", "client"),
        ];

        let _res = self.client.get(&url).query(&params).send().await?;
        let signin_url = format!("{}/oauth/v2/signin", OAUTH_BASE_URL);
        let res = self.client.get(&signin_url).send().await?;
        let html = res.text().await?;
        
        let re = Regex::new(r#"(?s)<script[^>]*id="oauth-args"[^>]*>(.*?)</script>"#)?;
        if let Some(caps) = re.captures(&html) {
            let json: serde_json::Value = serde_json::from_str(caps[1].trim())?;
            self.csrf_token = json["csrf-token"].as_str().map(|s| s.to_string());
            if self.csrf_token.is_some() {
                Ok(())
            } else {
                Err(anyhow!("csrf-token not found in JSON data"))
            }
        } else {
            Err(anyhow!("Could not find script#oauth-args in signin page"))
        }
    }

    pub async fn login_oauth(&mut self, email: &str, password: &str) -> Result<String> {
        let csrf = self.csrf_token.as_ref().ok_or(anyhow!("No CSRF token"))?;
        let url = format!("{}/oauth/v2/signin", OAUTH_BASE_URL);
        
        let params = [
            ("username", email),
            ("password", password),
            ("csrf-token", csrf),
        ];

        let res = self.client.post(&url)
            .header(ORIGIN, "https://api.oauth.blink.com")
            .header(REFERER, &url)
            .form(&params)
            .send()
            .await?;

        if res.status().as_u16() == 412 {
            return Ok("2FA_REQUIRED".to_string());
        }

        if res.status().is_redirection() || res.status().is_success() {
            return self.exchange_code().await;
        }

        Err(anyhow!("Login failed with status: {}", res.status()))
    }

    pub async fn verify_pin_oauth(&mut self, pin: &str) -> Result<String> {
        let csrf = self.csrf_token.as_ref().ok_or(anyhow!("No CSRF token"))?;
        let url = format!("{}/oauth/v2/2fa/verify", OAUTH_BASE_URL);
        
        let params = [
            ("2fa_code", pin),
            ("csrf-token", csrf),
            ("remember_me", "false"),
        ];

        let res = self.client.post(&url)
            .header(ORIGIN, "https://api.oauth.blink.com")
            .header(REFERER, format!("{}/oauth/v2/signin", OAUTH_BASE_URL))
            .form(&params)
            .send()
            .await?;

        if res.status().as_u16() == 201 {
            return self.exchange_code().await;
        }

        Err(anyhow!("PIN verification failed: {}", res.status()))
    }

    async fn exchange_code(&mut self) -> Result<String> {
        let url = format!("{}/oauth/v2/authorize", OAUTH_BASE_URL);
        let res = self.client.get(&url).send().await?;
        
        let final_url = res.url().to_string();
        let code = if final_url.starts_with("immedia-blink") {
            let re = Regex::new(r"code=([^&]+)")?;
            re.captures(&final_url)
                .ok_or(anyhow!("Auth code not found in redirect: {}", final_url))?[1].to_string()
        } else {
            if let Some(loc) = res.headers().get("Location") {
                let loc_str = loc.to_str()?;
                let re = Regex::new(r"code=([^&]+)")?;
                re.captures(loc_str)
                    .ok_or(anyhow!("Auth code not found in Location header: {}", loc_str))?[1].to_string()
            } else {
                return Err(anyhow!("Auth code not found in final URL or Location: {}", final_url));
            }
        };

        let token_url = format!("{}/oauth/token", OAUTH_BASE_URL);
        let body = [
            ("app_brand", "blink"),
            ("client_id", "ios"),
            ("code", &code),
            ("code_verifier", &self.code_verifier),
            ("grant_type", "authorization_code"),
            ("hardware_id", &self.device_id),
            ("redirect_uri", "immedia-blink://applinks.blink.com/signin/callback"),
            ("scope", "client"),
        ];

        let res = self.client.post(&token_url)
            .header("User-Agent", "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0")
            .form(&body)
            .send()
            .await?;

        let auth_data = res.json::<AuthResponse>().await?;
        self.token = Some(auth_data.access_token);
        self.refresh_token = Some(auth_data.refresh_token);
        self.token_expiry = Some(Utc::now().timestamp() + auth_data.expires_in);
        
        self.fetch_tier_info().await?;
        Ok("SUCCESS".to_string())
    }

    pub async fn refresh_token_if_needed(&mut self) -> Result<bool> {
        if let Some(expiry) = self.token_expiry {
            if Utc::now().timestamp() < expiry - 60 {
                return Ok(false);
            }
        }

        let refresh = match &self.refresh_token {
            Some(r) => r.clone(),
            None => return Err(anyhow!("No refresh token available")),
        };

        let token_url = format!("{}/oauth/token", OAUTH_BASE_URL);
        let body = [
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh),
            ("client_id", "ios"),
            ("app_brand", "blink"),
        ];

        let res = self.client.post(&token_url)
            .header("User-Agent", "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0")
            .form(&body)
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(anyhow!("Token refresh failed: {}", res.status()));
        }

        let auth_data = res.json::<AuthResponse>().await?;
        self.token = Some(auth_data.access_token);
        self.refresh_token = Some(auth_data.refresh_token);
        self.token_expiry = Some(Utc::now().timestamp() + auth_data.expires_in);

        Ok(true)
    }

    pub async fn fetch_tier_info(&mut self) -> Result<()> {
        let token = self.token()?;
        let url = "https://rest-prod.immedia-semi.com/api/v1/users/tier_info";
        
        let res = self.client.get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let data: serde_json::Value = res.json().await?;
        let tier = data["tier"].as_str().ok_or(anyhow!("No tier in response"))?;
        self.account_id = data["account_id"].as_i64();
        self.base_url = format!("https://rest-{}.immedia-semi.com", tier);
        
        Ok(())
    }

    pub async fn get_homescreen(&self) -> Result<HomescreenResponse> {
        let text = self.get_raw_homescreen().await?;
        let mut response: HomescreenResponse = serde_json::from_str(&text)?;

        // Ensure all cameras have their type and network_id correctly set during merge
        let mut all_cameras = Vec::new();
        
        for mut cam in response.cameras {
            cam.product_type = "camera".to_string();
            all_cameras.push(cam);
        }
        for mut cam in response.owls {
            cam.product_type = "owl".to_string();
            all_cameras.push(cam);
        }
        for mut cam in response.doorbells {
            cam.product_type = "doorbell".to_string();
            all_cameras.push(cam);
        }

        response.cameras = all_cameras;
        response.owls = Vec::new();
        response.doorbells = Vec::new();

        if response.cameras.is_empty() {
            for network in &response.networks {
                if let Ok(cams) = self.get_network_cameras(network.id).await {
                    response.cameras.extend(cams);
                }
            }
        }
        
        Ok(response)
    }

    pub async fn get_raw_homescreen(&self) -> Result<String> {
        let (token, account_id) = self.auth()?;
        let url = format!("{}/api/v3/accounts/{}/homescreen", self.base_url, account_id);
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if res.status() == 401 {
            return Err(anyhow!("AUTH_EXPIRED"));
        }

        Ok(res.text().await?)
    }

    pub async fn get_raw_media(&self) -> Result<String> {
        self.get_raw_media_page(1, 30).await
    }

    pub async fn get_raw_media_page(&self, page: i64, since_days: i64) -> Result<String> {
        let (token, account_id) = self.auth()?;
        let safe_page = if page < 1 { 1 } else { page };
        let since = Utc::now() - Duration::days(since_days.max(1));
        let timestamp = since.format("%Y-%m-%dT%H:%M:%S+00:00").to_string();
        let url = format!("{}/api/v1/accounts/{}/media/changed?since={}&page={}", self.base_url, account_id, timestamp, safe_page);
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if res.status() == 401 {
            return Err(anyhow!("AUTH_EXPIRED"));
        }

        Ok(res.text().await?)
    }

    pub async fn get_network_cameras(&self, network_id: i64) -> Result<Vec<Camera>> {
        let token = self.token()?;
        let url = format!("{}/network/{}/cameras", self.base_url, network_id);
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let data: serde_json::Value = res.json().await?;
        let dev = data["dev"].as_array().ok_or(anyhow!("No dev in network response"))?;
        
        let mut cameras = Vec::new();
        for d in dev {
            cameras.push(Camera {
                id: d["id"].as_i64().unwrap_or(0),
                name: d["name"].as_str().unwrap_or("Unknown").to_string(),
                thumbnail: d["thumbnail"].as_str().unwrap_or("").to_string(),
                status: d["status"].as_str().unwrap_or("").to_string(),
                battery: d["battery"].as_str().map(|s| s.to_string()),
                signals: serde_json::from_value(d["signals"].clone()).ok(),
                network_id: Some(network_id),
                product_type: d["type"].as_str().unwrap_or("unknown").to_string(),
                serial: d["serial"].as_str().map(|s| s.to_string()),
            });
        }
        Ok(cameras)
    }

    pub async fn request_liveview(&self, network_id: i64, camera_id: i64, product_type: &str, _record: bool) -> Result<LiveViewResponse> {
        let (token, account_id) = self.auth()?;
        
        let path = match product_type {
            "tulip" | "doorbell" => format!("doorbells/{}", camera_id),
            "owl" | "mini" => format!("owls/{}", camera_id),
            _ => format!("cameras/{}", camera_id),
        };

        let url = if product_type == "tulip" || product_type == "doorbell" || product_type == "owl" || product_type == "mini" {
             format!("{}/api/v1/accounts/{}/networks/{}/{}/liveview", self.base_url, account_id, network_id, path)
        } else {
             // v5 endpoint for sedona and standard cameras
             format!("{}/api/v5/accounts/{}/networks/{}/cameras/{}/liveview", self.base_url, account_id, network_id, camera_id)
        };
        
        let body = serde_json::json!({
            "intent": "liveview"
        });

        let res = self.client.post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await?;

        let data: serde_json::Value = res.json().await?;
        let server = data["server"].as_str().ok_or(anyhow!("No server in liveview response. Body: {}", data))?.to_string();
        let command_id = data["command_id"].as_i64().ok_or(anyhow!("No command_id in response"))?;
        let polling_interval = data["polling_interval"].as_i64().unwrap_or(1);

        Ok(LiveViewResponse {
            server,
            command_id,
            polling_interval,
        })
    }

    pub async fn get_latest_media_for_camera(&self, camera_id: i64, after: chrono::DateTime<Utc>) -> Result<Vec<i64>> {
        let (token, account_id) = self.auth()?;
        // Format as ISO8601 for Blink API
        let timestamp = after.format("%Y-%m-%dT%H:%M:%S+00:00").to_string();
        let url = format!("{}/api/v1/accounts/{}/media/changed?since={}&page=1", self.base_url, account_id, timestamp);
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(anyhow!("Failed to fetch media: {}", res.status()));
        }

        let data: serde_json::Value = res.json().await?;
        let mut ids = Vec::new();
        
        if let Some(media_list) = data["media"].as_array() {
            for item in media_list {
                let mut device_match = false;
                for key in ["device_id", "camera_id", "sensor_id"] {
                    let item_device_id = item[key].as_i64()
                        .or_else(|| item[key].as_str().and_then(|s| s.parse::<i64>().ok()));
                    if item_device_id == Some(camera_id) {
                        device_match = true;
                        break;
                    }
                }
                if !device_match {
                    continue;
                }

                let mut created_at: Option<chrono::DateTime<Utc>> = None;
                let created_candidates = ["created_at", "created_at_utc", "updated_at", "time"];
                for key in created_candidates {
                    if let Some(created_at_str) = item[key].as_str() {
                        let parsed = chrono::DateTime::parse_from_rfc3339(created_at_str)
                            .or_else(|_| chrono::DateTime::parse_from_str(created_at_str, "%Y-%m-%dT%H:%M:%S%z"))
                            .or_else(|_| chrono::DateTime::parse_from_str(created_at_str, "%Y-%m-%dT%H:%M:%S%.f%z"))
                            .or_else(|_| chrono::DateTime::parse_from_str(created_at_str, "%Y-%m-%dT%H:%M:%S%:z"))
                            .or_else(|_| chrono::DateTime::parse_from_str(created_at_str, "%Y-%m-%dT%H:%M:%S%.f%:z"))
                            .map(|dt| dt.with_timezone(&Utc))
                            .ok()
                            .or_else(|| {
                                chrono::NaiveDateTime::parse_from_str(created_at_str, "%Y-%m-%dT%H:%M:%S")
                                    .or_else(|_| chrono::NaiveDateTime::parse_from_str(created_at_str, "%Y-%m-%d %H:%M:%S"))
                                    .ok()
                                    .map(|dt| chrono::DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
                            });

                        if let Some(dt) = parsed {
                            created_at = Some(dt);
                            break;
                        }
                        if let Ok(epoch) = created_at_str.parse::<i64>() {
                            let ts = if created_at_str.len() > 10 { epoch / 1000 } else { epoch };
                            if let Some(dt) = chrono::DateTime::<Utc>::from_timestamp(ts, 0) {
                                created_at = Some(dt);
                                break;
                            }
                        }
                    }
                }

                if let Some(created_at) = created_at {
                    if created_at >= after {
                        if let Some(id) = item["id"].as_i64() {
                            ids.push(id);
                        }
                    }
                }
            }
        }
        Ok(ids)
    }

    pub async fn delete_media(&self, media_ids: Vec<i64>) -> Result<()> {
        let (token, account_id) = self.auth()?;
        let url = format!("{}/api/v1/accounts/{}/media/delete", self.base_url, account_id);
        let payloads = vec![
            serde_json::json!({ "media_list": media_ids }),
            serde_json::json!({ "media_list": media_ids.iter().map(|id| serde_json::json!({ "id": id })).collect::<Vec<_>>() }),
            serde_json::json!({ "media_list": media_ids.iter().map(|id| serde_json::json!({ "media_id": id })).collect::<Vec<_>>() }),
        ];

        let mut last_error: Option<String> = None;
        for body in payloads {
            let res = self.client.post(&url)
                .header("Authorization", format!("Bearer {}", token))
                .json(&body)
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        return Ok(());
                    }
                    let text = response.text().await.unwrap_or_default();
                    last_error = Some(format!("{} {}", status, text));
                }
                Err(e) => {
                    last_error = Some(e.to_string());
                }
            }
        }

        Err(anyhow!(last_error.unwrap_or_else(|| "Delete failed".to_string())))
    }

    pub async fn delete_media_with_payloads(&self, media_ids: Vec<i64>, entries: Vec<serde_json::Value>) -> Result<()> {
        let (token, account_id) = self.auth()?;
        let url = format!("{}/api/v1/accounts/{}/media/delete", self.base_url, account_id);

        let payloads = vec![
            serde_json::json!({ "media_list": media_ids }),
            serde_json::json!({ "media_list": media_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>() }),
            serde_json::json!({ "media_list": entries }),
        ];

        let mut last_error: Option<String> = None;
        for body in payloads {
            let res = self.client.post(&url)
                .header("Authorization", format!("Bearer {}", token))
                .json(&body)
                .send()
                .await;

            match res {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        return Ok(());
                    }
                    let text = response.text().await.unwrap_or_default();
                    last_error = Some(format!("{} {}", status, text));
                }
                Err(e) => {
                    last_error = Some(e.to_string());
                }
            }
        }

        Err(anyhow!(last_error.unwrap_or_else(|| "Delete failed".to_string())))
    }

    pub async fn get_command_status(&self, network_id: i64, command_id: i64) -> Result<serde_json::Value> {
        let token = self.token()?;
        let url = format!("{}/network/{}/command/{}", self.base_url, network_id, command_id);
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        Ok(res.json().await?)
    }

    pub async fn get_thumbnail(&self, path: &str) -> Result<Vec<u8>> {
        let token = self.token()?;
        let url = self.resolve_url(path);
        let mut req = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "image/*");

        if let Ok(origin) = HeaderValue::from_str(&self.base_url) {
            req = req.header(ORIGIN, origin.clone());
            req = req.header(REFERER, origin);
        }

        let res = req.send().await?;

        Ok(res.bytes().await?.to_vec())
    }

    pub async fn set_arm(&self, network_id: i64, arm: bool) -> Result<()> {
        let (token, account_id) = self.auth()?;
        let action = if arm { "arm" } else { "disarm" };
        let url = format!("{}/api/v1/accounts/{}/networks/{}/state/{}", self.base_url, account_id, network_id, action);

        self.client.post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        Ok(())
    }

    pub async fn get_camera_config(&self, network_id: i64, camera_id: i64, product_type: &str) -> Result<serde_json::Value> {
        let token = self.token()?;
        let url = match product_type {
            "owl" | "mini" => format!("{}/api/v1/accounts/{}/networks/{}/owls/{}/config", self.base_url, self.account_id.unwrap_or(0), network_id, camera_id),
            "tulip" | "doorbell" => format!("{}/api/v1/accounts/{}/networks/{}/doorbells/{}/config", self.base_url, self.account_id.unwrap_or(0), network_id, camera_id),
            _ => format!("{}/network/{}/camera/{}/config", self.base_url, network_id, camera_id),
        };
        
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        Ok(res.json().await?)
    }

    pub async fn update_camera_config(&self, network_id: i64, camera_id: i64, product_type: &str, config: serde_json::Value) -> Result<()> {
        let token = self.token()?;
        let url = match product_type {
            "owl" | "mini" => format!("{}/api/v1/accounts/{}/networks/{}/owls/{}/config", self.base_url, self.account_id.unwrap_or(0), network_id, camera_id),
            "tulip" | "doorbell" => format!("{}/api/v1/accounts/{}/networks/{}/doorbells/{}/config", self.base_url, self.account_id.unwrap_or(0), network_id, camera_id),
            _ => format!("{}/network/{}/camera/{}/update", self.base_url, network_id, camera_id),
        };
        
        self.client.post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&config)
            .send()
            .await?;

        Ok(())
    }

    pub async fn set_network_liveview_save(&self, network_id: i64, enabled: bool) -> Result<()> {
        let (token, account_id) = self.auth()?;
        let endpoints = [
            format!("{}/api/v1/accounts/{}/networks/{}/update", self.base_url, account_id, network_id),
            format!("{}/network/{}/update", self.base_url, network_id),
        ];
        let payloads = [
            serde_json::json!({ "lv_save": enabled }),
            serde_json::json!({ "network": { "lv_save": enabled } }),
        ];

        let mut last_error: Option<String> = None;

        for url in endpoints {
            for payload in payloads.iter() {
                let payload = payload.clone();
                let res = self.client.post(&url)
                    .header("Authorization", format!("Bearer {}", token))
                    .json(&payload)
                    .send()
                    .await;

                match res {
                    Ok(response) => {
                        if response.status() == 401 {
                            return Err(anyhow!("AUTH_EXPIRED"));
                        }
                        if response.status().is_success() {
                            return Ok(());
                        }
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        last_error = Some(format!("{} {}", status, body));
                    }
                    Err(e) => {
                        last_error = Some(e.to_string());
                    }
                }
            }
        }

        Err(anyhow!(last_error.unwrap_or_else(|| "Failed to update lv_save".to_string())))
    }
}
