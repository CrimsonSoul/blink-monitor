# Blink Monitor

Blink Monitor is a desktop-first client for Amazon Blink cameras, with an optional hosted web runtime for server deployments.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-0a7ea4) ![UI](https://img.shields.io/badge/ui-React%2019-149eca) ![Runtime](https://img.shields.io/badge/runtime-Tauri%20v2%20%7C%20Axum-1f6feb) ![Language](https://img.shields.io/badge/language-TypeScript%20%2B%20Rust-2ea043)

## Snapshot

- One React UI runs in two modes: desktop (Tauri IPC) and hosted web (HTTP API)
- Rust services handle Blink auth, media proxying, and IMMI live streaming relay
- Built for fast clip browsing, responsive live view, and practical daily monitoring
- Deployment paths include desktop bundles, Docker Compose, and CI Windows portable build

## Preview

![Blink Monitor icon](src-tauri/icons/128x128.png)

## Core Features

- Live camera view with theater mode, PiP, mute/unmute, and stream retry
- Clip timeline with search/filtering, multi-select delete, and downloads with progress
- Motion notifications with app icon support
- Camera arm/disarm and settings management
- Local thumbnail caching for faster repeat browsing

## Architecture

- `src/lib/apiClient.ts` abstracts runtime differences so components call one client API
- Desktop mode routes through Tauri commands in `src-tauri/src/`
- Hosted mode routes through standalone Axum handlers in `server/src/`

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4 |
| Desktop runtime | Tauri v2 (Rust) |
| Hosted API | Axum (Rust) |
| Live playback | mpegts.js |
| Networking | reqwest + rustls |

## Quick Start

### Desktop

```bash
npm ci
npm run tauri dev
```

### Hosted web mode

```bash
cd server
cargo run --release
```

```bash
VITE_TARGET=web VITE_API_BASE=/api npm run dev
```

### Docker

```bash
docker compose up --build
```

Web UI: `http://localhost:8080`  
API: `http://localhost:3020`

## Security and Reliability

- Desktop auth tokens default to OS keychain storage
- Proxy endpoints enforce Blink-domain allowlisting to reduce SSRF risk
- PKCE OAuth flow for authentication
- TLS behavior is configurable for secure-only vs debug scenarios

## Project Layout

- `src/`: React frontend and UI components
- `src/lib/apiClient.ts`: shared API facade (IPC vs HTTP)
- `src-tauri/src/`: desktop Rust commands and embedded proxy
- `server/src/`: standalone Axum API for hosted mode
- `.github/workflows/windows-build.yml`: Windows portable build pipeline

## License

Private/internal project.
