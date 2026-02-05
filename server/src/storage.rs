use anyhow::Result;
use std::fs;
use std::path::PathBuf;

use crate::blink::BlinkAuthState;

fn auth_path() -> PathBuf {
    if let Ok(path) = std::env::var("BLINK_AUTH_PATH") {
        return PathBuf::from(path);
    }
    let dir = std::env::var("BLINK_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    let mut path = PathBuf::from(dir);
    path.push("auth.json");
    path
}

pub fn save_auth(state: &BlinkAuthState) -> Result<()> {
    let json = serde_json::to_string(state)?;
    let path = auth_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, json)?;
    Ok(())
}

pub fn load_auth() -> Result<BlinkAuthState> {
    let path = auth_path();
    let json = fs::read_to_string(&path)?;
    let state: BlinkAuthState = serde_json::from_str(&json)?;
    Ok(state)
}

pub fn clear_auth() -> Result<()> {
    let path = auth_path();
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}
