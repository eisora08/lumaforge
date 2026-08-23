<div align="center">

# LumaForge

**A Desktop game library manager built with Tauri v2.**

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Version](https://img.shields.io/badge/version-0.1.0--unreleased-purple)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)
![Rust](https://img.shields.io/badge/Rust-1.77+-orange?logo=rust)
![Tauri](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178c6?logo=typescript)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)

[English](README.md) · [Español](README.es.md)

</div>

---

## Disclaimer

LumaForge is an **educational project** and a **technical demonstration** of modern desktop application development using Tauri v2, Rust, React, and TypeScript. It is designed to showcase advanced software architecture patterns including plugin systems, Lua scripting integration, multi-provider game detection, background job queues, and SQLite-backed caching.

**LumaForge is not affiliated with, endorsed by, or connected to Valve Corporation, Steam, Epic Games, or any game publisher.** All trademarks belong to their respective owners.

This software is provided strictly for educational and demonstration purposes. Users are responsible for ensuring compliance with all applicable laws and terms of service for games and platforms they interact with through this software.

---

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider Library** | Unified game library from Steam, Epic Games, Lua scripts, and manually added entries |
| **Native Game Launching** | Direct launching of Steam and Epic games with process tracking and playtime recording |
| **Debrid/Torrent Integration** | Download and install games via debrid providers (TorBox, Real-Debrid, AllDebrid, Premiumize) or built-in torrent client (librqbit) |
| **Achievement Tracking** | Real-time achievement monitoring with unlock notifications, progress tracking, and Steam integration |
| **Console Mode** | Full-screen gamepad-navigable interface inspired by Steam Big Picture and Solaris |
| **Game Fixes** | One-click application of SmokeAPI, Steamless, Goldberg Emulator, Online-Fix, and Koaloader |
| **Media Management** | Automatic artwork resolution from Steam, SteamGridDB, IGDB, and RAWG with priority chains |
| **Smart Dashboard** | Personalized home screen with Continue Playing, Favorites, Recommendations, and discovery sections |
| **Extension System** | Lua-based plugin architecture for third-party tool integration and game detection |
| **Ambient Backgrounds** | Dynamic theme-driven backgrounds with color mode, image mode, and crossfade transitions |
| **Universal Download Manager** | Unified queue for Steam installs, debrid downloads, and torrent transfers with live speed charts |
| **SQLite-First Storage** | All game data, playtime, achievements, and settings persisted in SQLite with JSON migration |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Rust (Tauri v2.11.3) |
| **Frontend** | React 19 + TypeScript 5.4 + Vite 8.2 |
| **Database** | SQLite (via rusqlite) |
| **Bundler** | Rolldown (Vite 8.2) |
| **Torrent Engine** | librqbit 8.x (vendored) |
| **Lua Runtime** | mlua 0.10 (Lua 5.4, vendored) |
| **Styling** | Tailwind CSS 4.3 |
| **Installer** | NSIS (Tauri v2 native) |

## Building from Source

### Prerequisites

- **Rust** 1.77+ (with `cargo`)
- **Node.js** 20.19+ or 22.12+
- **pnpm** (recommended) or npm
- **WebView2** (ships with Windows 10/11)

### Setup

```bash
# Clone the repository
git clone https://github.com/einey/lumaforge.git
cd lumaforge

# Install frontend dependencies
npm install

# Build the Tauri app
npm run tauri build

# Or run in development mode
npm run tauri dev
```

### Development Commands

```bash
# Type-check TypeScript
npx tsc --noEmit

# Build frontend only (fast, for linting)
npx vite build

# Check Rust code
cargo check

# Run Rust tests
cargo test

# Run full Tauri dev build
npm run tauri dev
```

## Project Structure

```
LumaForge/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/               # UI components (dashboard, library, store, settings, etc.)
│   ├── context/                  # React contexts (GameSession, Library, Favorites, Settings)
│   ├── hooks/                    # Custom hooks (playtime, media, controller detection)
│   ├── services/                 # Business logic (game cache, achievements, debrid, metadata)
│   ├── features/                 # Feature modules (console mode, profile, debrid, DRM)
│   ├── pages/                    # Route pages (Home, Library, Store, Settings, Downloads)
│   └── types/                    # TypeScript type definitions
├── src-tauri/                    # Backend (Rust + Tauri v2)
│   ├── src/
│   │   ├── commands/             # Tauri command handlers (40+ modules)
│   │   ├── models/               # Data models and structs
│   │   ├── sqlite_cache/         # SQLite schema, migrations, and queries
│   │   ├── utils/                # Utility functions (progress, download, extraction)
│   │   └── lua_engine/           # Sandboxed Lua 5.4 runtime
│   ├── nsis/                     # NSIS installer artwork (BMP files)
│   └── tauri.conf.json           # Tauri configuration
├── tools/                        # Build tools and catalog generators
├── public/                       # Static assets (data catalogs, DRM indexes)
└── lumaforge-extensions/         # Built-in extension manifests
```

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
