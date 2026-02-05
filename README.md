# Blink Monitor

Modern, minimal desktop client for Blink cameras built with **Tauri + React**.  
Designed for fast live view, clean clip browsing, and a sleek dark‑mode UI.

## Highlights
- Live view with theater mode, PiP, mute/unmute, and recording controls
- Clips timeline with search, filters, multi‑select delete, and download with progress
- Notifications for new motion events (with app icon)
- Fast local thumbnail caching and resilient media loading
- Secure storage via OS keychain (with dev‑mode override)

## Tech Stack
- **Tauri v2** (Rust backend)
- **React 19 + Vite**
- **TypeScript**
- **mpegts.js** for live stream playback

---

## Getting Started

### Prerequisites
- **Node.js 20+**
- **Rust toolchain** (stable)
- **Tauri prerequisites** for your OS  
  - macOS: Xcode Command Line Tools
  - Windows: MSVC build tools + WebView2 runtime

### Install
```bash
npm ci
```

### Run (dev)
```bash
npm run tauri dev
```

### Build (production)
```bash
npm run tauri build
```

---

## Hosted Web App (VPS / EasyPanel)

The web UI runs as static assets and talks to a standalone Rust API server that owns the Blink session.

### Run the API locally
```bash
cd server
cargo run --release
```

By default the API listens on `PORT=3000` and stores auth at `data/auth.json`.

### Run the web UI against the API
```bash
VITE_TARGET=web VITE_API_BASE=/api npm run dev
```

### EasyPanel deployment layout (recommended)
- **Service 1: web**
  - Build command: `npm ci && VITE_TARGET=web VITE_API_BASE=/api npm run build`
  - Output dir: `dist`
- **Service 2: api**
  - Working dir: `server`
  - Build command: `cargo build --release`
  - Start command: `./target/release/blink-monitor-server`

### Reverse proxy
Route `/api/*` from the web host to the API service. This keeps the UI same‑origin and avoids CORS issues.

### Docker builds (optional)
```bash
# Web UI
docker build -t blink-monitor-web --build-arg VITE_API_BASE=/api .

# API server
docker build -t blink-monitor-api -f server/Dockerfile .
```

### Optional environment variables (API)
| Variable | Description |
| --- | --- |
| `PORT` | API listen port (default: 3000). |
| `BLINK_DATA_DIR` | Directory for `auth.json` (default: `data`). |
| `BLINK_AUTH_PATH` | Full path to `auth.json` (overrides `BLINK_DATA_DIR`). |

**macOS outputs**
- App bundle: `src-tauri/target/release/bundle/macos/Blink Monitor.app`
- DMG: `src-tauri/target/release/bundle/dmg/Blink Monitor_*.dmg`

---

## Windows Portable Build (GitHub Actions)
The workflow produces a **portable self‑contained `.exe`** (no installer).

Artifact path in CI:
- `src-tauri/target/release/*.exe`

Workflow file:
- `.github/workflows/windows-build.yml`

To run in GitHub Actions:
- **Actions → Windows Build → Run workflow**

---

## Environment Variables

### Auth / Storage
| Variable | Description |
| --- | --- |
| `BLINK_DISABLE_KEYCHAIN=1` | Disable OS keychain use (dev convenience). |
| `BLINK_USE_KEYCHAIN=1` | Force keychain use. |
| `BLINK_ALLOW_PLAINTEXT_AUTH=1` | Allow plaintext fallback storage if keychain fails. |

### IMMI TLS (Live View)
| Variable | Description |
| --- | --- |
| `BLINK_IMMI_INSECURE_TLS=1` | Allow insecure TLS (debug builds only). |
| `BLINK_IMMI_SECURE_ONLY=1` | Require strict TLS verification; no insecure fallback. |

### Web Build
| Variable | Description |
| --- | --- |
| `VITE_TARGET=web` | Enable hosted web mode (uses HTTP API instead of Tauri). |
| `VITE_API_BASE=/api` | Base path for API calls (default: `/api`). |

---

## Notes & Tips
- **macOS notification icons are cached** by the OS.  
  If you update the icon, fully quit and relaunch the app to see the change.
- If live view fails, try the **Retry Stream** button before reloading the app.

---

## License
Private / internal project.
