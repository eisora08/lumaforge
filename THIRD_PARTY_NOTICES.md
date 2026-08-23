# Third-Party Notices

This file contains the licenses and attributions for all third-party software, libraries, and services used by LumaForge.

---

## Rust Crates (40)

| Crate | License | Purpose |
|-------|---------|---------|
| `tauri` (2.11.3) | MIT | Application framework |
| `tauri-build` | MIT | Build tooling |
| `tauri-plugin-dialog` | MIT | Native file/folder dialogs |
| `tauri-plugin-fs` | MIT | File system access |
| `tauri-plugin-global-shortcut` | MIT | Global keyboard shortcuts |
| `tauri-plugin-http` | MIT | HTTP client |
| `tauri-plugin-log` | MIT | Logging |
| `tauri-plugin-opener` | MIT | Open URLs/files in default apps |
| `tauri-plugin-process` | MIT | Process management |
| `tauri-plugin-shell` | MIT | Shell command execution |
| `tauri-plugin-updater` | MIT | Application auto-update |
| `tauri-plugin-window-state` | MIT | Window position/size persistence |
| `tray-icon` (0.24.1) | MIT | System tray icon |
| `muda` (0.19.3) | MIT | Native menu library |
| `serde` / `serde_json` | MIT | JSON serialization |
| `rusqlite` | MIT | SQLite database |
| `tokio` | MIT | Async runtime |
| `reqwest` | MIT | HTTP client |
| `sha2` | MIT | SHA-256 hashing |
| `uuid` | MIT | UUID generation |
| `chrono` | MIT | Date/time handling |
| `anyhow` | MIT | Error handling |
| `thiserror` | MIT | Derive error types |
| `log` | MIT | Logging facade |
| `env_logger` | MIT | Logger implementation |
| `dirs` | MIT | Standard directory paths |
| `open` | MIT | Open URLs in browser |
| `zip` | MIT | ZIP archive extraction |
| `serde_yaml` | MIT | YAML parsing |
| `toml` | MIT | TOML parsing |
| `regex` | MIT | Regular expressions |
| `base64` | MIT | Base64 encoding |
| `dashmap` | MIT | Concurrent hash map |
| `once_cell` | MIT | Lazy initialization |
| `parking_lot` | MIT | Synchronization primitives |
| `bytes` | MIT | Byte buffer |
| `futures` | MIT | Async utilities |
| `pin-project` | MIT | Pin projection |
| `percent-encoding` | MIT | URL encoding |
| `librqbit` (8.x) | MIT | BitTorrent client |
| `mlua` (0.10) | MIT | Lua 5.4 runtime |
| `unrar` (0.5.8) | MIT | RAR extraction |
| `console` | MIT | Terminal formatting |
| `unicode-width` | MIT | Unicode character width |
| `itertools` | MIT | Iterator utilities |

> **Note:** All crates listed above are MIT-licensed unless otherwise noted. Some crates may have additional dependencies with their own licenses. Run `cargo license` for a complete audit.

---

## Runtime npm Packages (13)

| Package | License | Purpose |
|---------|---------|---------|
| `@tauri-apps/api` | MIT | Tauri JavaScript API |
| `@tauri-apps/plugin-dialog` | MIT | Dialog API |
| `@tauri-apps/plugin-fs` | MIT | File system API |
| `@tauri-apps/plugin-global-shortcut` | MIT | Global shortcuts API |
| `@tauri-apps/plugin-http` | MIT | HTTP client API |
| `@tauri-apps/plugin-log` | MIT | Logging API |
| `@tauri-apps/plugin-opener` | MIT | Open URLs/files |
| `@tauri-apps/plugin-process` | MIT | Process management API |
| `@tauri-apps/plugin-shell` | MIT | Shell execution API |
| `@tauri-apps/plugin-updater` | MIT | Auto-update API |
| `@tauri-apps/plugin-window-state` | MIT | Window state API |
| `react` (19.x) | MIT | UI framework |
| `react-dom` (19.x) | MIT | React DOM renderer |

---

## Dev npm Packages (14)

| Package | License | Purpose |
|---------|---------|---------|
| `@tauri-apps/cli` | MIT | Tauri CLI tooling |
| `@types/react` | MIT | React type definitions |
| `@types/react-dom` | MIT | React DOM types |
| `@vitejs/plugin-react` | MIT | Vite React plugin |
| `typescript` (5.4+) | Apache-2.0 | TypeScript compiler |
| `vite` (8.2) | MIT | Build tool |
| `vitest` | MIT | Test framework |
| `@tailwindcss/vite` | MIT | Tailwind CSS Vite plugin |
| `tailwindcss` (4.3) | MIT | Utility-first CSS |
| `lucide-react` | MIT | Icon library |
| `eslint` | MIT | Linter |
| `eslint-plugin-react-hooks` | MIT | React hooks linting |
| `prettier` | MIT | Code formatter |
| `@biomejs/biome` | MIT | Fast formatter/linter |

---

## External Tools (Runtime Downloads)

These tools are **not bundled** with LumaForge. They are downloaded at runtime when the user explicitly installs them via the third-party tools system.

### SmokeAPI

- **Repository:** [授他以荣/SmokeAPI](https://github.com/ainmmn/SmokeAPI)
- **License:** GPL-3.0
- **Purpose:** Steam API wrapper for game compatibility
- **Usage:** Applied per-game to modify `steam_api64.dll`/`steam_api.dll` behavior

### Steamless

- **Repository:** [DeathWeasel1337/Steamless](https://github.com/DeathWeasel1337/Steamless)
- **License:** CC-BY-NC-ND 4.0
- **Purpose:** SteamStub DRM unpacker
- **Usage:** Removes DRM from Steam games for backup/archival purposes

### Goldberg Emulator / GBE_Fork

- **Repository:** [Detanup01/gbe_fork](https://github.com/Detanup01/gbe_fork)
- **License:** GPL-3.0
- **Purpose:** Steam emulator for LAN multiplayer
- **Usage:** Replaces Steam API for offline/LAN play

### Koaloader

- **Repository:** [Shock-Admin/Koaloader](https://github.com/Shock-Admin/Koaloader)
- **License:** MIT
- **Purpose:** Plugin loader for game directories
- **Usage:** Loads compatible plugins into game processes

### OpenSteamTool

- **Repository:** [OpenSteamTool](https://github.com/DevTypeX/OpenSteamTool)
- **License:** GPL-3.0
- **Purpose:** Steam tools and utilities
- **Usage:** Steam configuration and management

### Online-Fix

- **Purpose:** Steam emulation for offline play
- **Usage:** Provides `steam_api64.dll` and SteamConfig for offline operation

---

## External APIs

These services are accessed via their public APIs. No API keys are bundled; users configure their own keys in Settings.

| Service | API Documentation | Purpose |
|---------|-------------------|---------|
| **Steam Web API** | [Steam Web API](https://developer.valvesoftware.com/wiki/Steam_Web_API) | Game metadata, achievement data, user stats |
| **Steam Store** | Store page scraping | Game descriptions, screenshots, media |
| **SteamGridDB** | [SteamGridDB API](https://www.steamgriddb.com/api/v2) | Game artwork (covers, heroes, logos) |
| **IGDB** | [IGDB API](https://api-docs.igdb.com/) | Game metadata, cover art, screenshots |
| **RAWG** | [RAWG API](https://rawg.io/apidocs) | Game backgrounds, screenshots |
| **TorBox** | [TorBox API](https://docs.torbox.app/) | Debrid torrent resolution |
| **Real-Debrid** | [Real-Debrid API](https://real-debrid.com/apidoc) | Debrid link unrestricting |
| **AllDebrid** | [AllDebrid API](https://docs.alldebrid.com/) | Debrid link unrestricting |
| **Premiumize** | [Premiumize API](https://www.premiumize.me/api) | Debrid cloud download |
| **Gofile.io** | Gofile API | File hosting direct downloads |

---

## Additional Attributions

- **Console Mode** design inspired by [Steam Big Picture](https://store.steampowered.com/steampad), [Playnite](https://playnite.link/), and [Solaris](https://github.com/nicehash/Solaris).
- **UI design** inspired by Discord, Steam Desktop, and modern launcher interfaces.
- **NSIS installer artwork** features custom midnight-blue gradient branding created for this project.

---

## License Compliance

LumaForge is licensed under GPL-3.0. All source code modifications to GPL-licensed dependencies (SmokeAPI, Goldberg/GBE_Fork) are available upon request. The MIT-licensed runtime tools (Koaloader) and CC-BY-NC-ND licensed tools (Steamless) are distributed as-is without modification.

For questions about licensing, contact the project maintainers.
