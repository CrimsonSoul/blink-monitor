use crate::blink::BlinkAuthState;
use anyhow::{anyhow, Result};
use keyring::Entry;
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "blink-monitor";
const KEYRING_USERNAME: &str = "auth";

fn keyring_entry() -> Result<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)
        .map_err(|e| anyhow!("Failed to open keychain entry: {}", e))
}

fn allow_plaintext_auth() -> bool {
    std::env::var("BLINK_ALLOW_PLAINTEXT_AUTH")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn use_keychain() -> bool {
    if std::env::var("BLINK_DISABLE_KEYCHAIN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return false;
    }
    if std::env::var("BLINK_USE_KEYCHAIN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return true;
    }
    if cfg!(debug_assertions) {
        return false;
    }
    true
}

pub fn get_config_dir() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("blink-monitor");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

pub fn save_auth(state: &BlinkAuthState) -> Result<()> {
    let json = serde_json::to_string(state)?;
    if !use_keychain() {
        let mut path = get_config_dir();
        path.push("auth.json");
        fs::write(path, json)?;
        return Ok(());
    }
    let entry = keyring_entry()?;

    match entry.set_password(&json) {
        Ok(()) => Ok(()),
        Err(e) => {
            if allow_plaintext_auth() {
                let mut path = get_config_dir();
                path.push("auth.json");
                fs::write(path, json)?;
                Ok(())
            } else {
                Err(anyhow!(
                    "Keychain storage failed: {}. Set BLINK_ALLOW_PLAINTEXT_AUTH=1 to allow insecure fallback.",
                    e
                ))
            }
        }
    }
}

pub fn load_auth() -> Result<BlinkAuthState> {
    if use_keychain() {
        if let Ok(entry) = keyring_entry() {
            if let Ok(json) = entry.get_password() {
                let state: BlinkAuthState = serde_json::from_str(&json)?;
                return Ok(state);
            }
        }
    }

    let mut path = get_config_dir();
    path.push("auth.json");
    let json = fs::read_to_string(&path)?;
    let state: BlinkAuthState = serde_json::from_str(&json)?;

    // Best-effort migration to keychain storage.
    if use_keychain() {
        let _ = save_auth(&state);
    }
    Ok(state)
}

pub fn clear_auth() -> Result<()> {
    if use_keychain() {
        if let Ok(entry) = keyring_entry() {
            let _ = entry.delete_password();
        }
    }

    let mut path = get_config_dir();
    path.push("auth.json");
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}
