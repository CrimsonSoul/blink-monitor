use crate::blink::BlinkAuthState;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;

pub fn get_config_dir() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("blink-monitor");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

pub fn save_auth(state: &BlinkAuthState) -> Result<()> {
    let mut path = get_config_dir();
    path.push("auth.json");
    let json = serde_json::to_string(state)?;
    fs::write(path, json)?;
    Ok(())
}

pub fn load_auth() -> Result<BlinkAuthState> {
    let mut path = get_config_dir();
    path.push("auth.json");
    let json = fs::read_to_string(path)?;
    let state: BlinkAuthState = serde_json::from_str(&json)?;
    Ok(state)
}

pub fn clear_auth() -> Result<()> {
    let mut path = get_config_dir();
    path.push("auth.json");
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}
