# LumaForge — Project Context for AI Agents

## Overview
LumaForge is a **Tauri v2 (Rust + React/TypeScript) game launcher/library manager**.
Branch: `feat/linux-port`

## Tech Stack
- **Backend**: Rust (Tauri v2), with third-party crates for Steam integration
- **Frontend**: React + TypeScript, Vite bundler
- **Platform**: Linux (Wayland, Xwayland `DISPLAY=:0`, NVIDIA GPU, Nobara 44)
- **Target OS**: Linux primary, Windows secondary

## Build & Dev Commands
```bash
# Frontend type-check (DO NOT use `npm run build` — needs Tauri context)
npx tsc --noEmit

# Rust check (fast, no linking)
cargo check --manifest-path src-tauri/Cargo.toml

# Full dev build
cargo tauri dev

# Full build (release)
cargo tauri build
```

## Critical Architecture — SLS Steam Post-Download Flow

This is the most important flow in the Linux port. When a user downloads a game via DepotDownloaderMod, the following must happen **in order**:

### ACCELA-Style Flow (what we implemented)
1. **DepotDownloaderMod** downloads game files directly to `<steam_library>/steamapps/common/<game_name>/` (NOT a staging dir)
2. **appmanifest_{appid}.acf** is created at `<steam_library>/steamapps/` with:
   - `StateFlags: 4` (fully installed)
   - `platform_override_dest: linux` + `platform_override_source: windows` in `UserConfig` and `MountedConfig` (CRITICAL for Proton)
3. **depotcache/** — manifest files are moved here
4. **libraryfolders.vdf** is updated to include the app
5. **SLS Steam config** (`~/.config/SLSsteam/config.yaml`) — game added to `AdditionalApps`
6. **Steam kill + restart** with `LD_AUDIT=<library_inject.so>:<SLSsteam.so>`

### Why This Matters
Without `platform_override` in the ACF `UserConfig`, Steam cannot run Windows .exe games on Linux — the Play button shows but the game silently fails to launch.

### Flow Implementation
- **Rust**: `depot_downloader.rs` — `depot_downloader_start()` downloads to `steamapps/common/{game_name}` on Linux
- **TypeScript**: `InstallerProgressListener.tsx` — `handleDepotDownloadComplete()` does the 9-step post-download flow
- **Detection**: `slssteamStatus()` must return `installed: true` or the entire post-download flow is skipped

## Critical Bugs We Fixed (DO NOT REINTRODUCE)

### 1. SLS Steam Path Detection (ROOT CAUSE of "game doesn't launch")
**Files**: `src-tauri/src/commands/slssteam.rs`

`find_slssteam_so()` and `find_library_inject_so()` MUST use `app_handle.path().app_data_dir()` to resolve the thirdparty path. The app data dir is `~/.local/share/com.einey.lumaforge/`, NOT `~/.local/share/lumaforge/`.

```rust
// CORRECT — use AppHandle
pub fn find_slssteam_so(steam_path: Option<&str>, app_data_dir: &Path) -> Option<String> {
    // ...
    let base = app_data_dir.join("thirdparty").join("slssteam");
    let bin_path = base.join("bin").join("SLSsteam.so");
    // ...
}
```

```rust
// WRONG — do NOT use dirs::data_dir()
let base = dirs::data_dir()?.join("lumaforge").join("thirdparty").join("slssteam");
```

Requires `use tauri::Manager;` import for `.path()` method.

### 2. Config YAML Newline Bug
**File**: `src-tauri/src/utils/slssteam_config.rs`

`add_additional_app()` and `add_fake_app_id()` must advance past the `\n` after the section header before inserting:

```rust
if let Some(mat) = section_re.find(&content) {
    let after_header = &content[mat.end()..];
    let skip = if after_header.starts_with('\n') { 1 } else { 0 };
    let mut last_item_end = mat.end() + skip;
    // ... rest of insertion logic
}
```

Without this, entries get inserted on the same line as the header: `AdditionalApps:  - 3358170` (malformed YAML).

### 3. Proton Override in ACF
**File**: `src/components/downloads/InstallerProgressListener.tsx`

On Linux, `isProtonGame` MUST be `true` because DepotDownloaderMod downloads Windows depots:

```typescript
const isProtonGame = detectedPlatform === "linux";
```

### 4. DepotDownloaderMod Downloads to steamapps/common/ Directly
**File**: `src-tauri/src/commands/depot_downloader.rs`

On Linux, `-dir` argument must point to `steamapps/common/{game_name}`, NOT `{output_dir}/{appId}`:

```rust
#[cfg(target_os = "linux")]
let output_dir = {
    let safe_name: String = job.game_name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '.' { c } else { '_' })
        .collect::<String>().trim().replace(' ', "_");
    let installdir = if safe_name.is_empty() { format!("App_{}", job.app_id) } else { safe_name };
    PathBuf::from(&job.output_dir).join("steamapps").join("common").join(&installdir)
};
```

### 5. SLS Steam Config Template
**File**: `src-tauri/src/commands/slssteam.rs` (`slssteam_full_setup`)

Default config MUST include ALL fields SLS Steam expects, otherwise it logs warnings:

```yaml
DisableFamilyShareLock: yes
UseWhitelist: no
AppIds:
AdditionalApps:
DlcData:
AppTokens:
CDKeys:
FakeOffline:
FakeAppIds:
ManifestIds:
DepotBlacklist:
GameTitles:
SubscriptionTimestamps:
DenuvoGames:
SteamIdOverride:
SmartTickets: 0x1
MaxSchemaTries: 10
LaunchOptions:
SafeMode: no
WarnHashMissmatch: no
NotifyInit: yes
API: yes
Plugins: no
DisableCloud: yes
DisableUpdates: yes
FakeName: ""
FakeEmail: ""
FakeWalletBalance: 0
LogLevels: 0xff
DumpClientInterfaces: no
ExtendedLogging: no
```

### 6. Game Name Sanitization Must Match Between Rust and TypeScript
**Files**: `depot_downloader.rs` + `InstallerProgressListener.tsx`

Both use identical logic:
- Keep: alphanumeric, space, `-`, `.`
- Replace everything else with `_`
- Trim + replace each space with `_`
- Fallback to `App_{appId}` if empty

TypeScript regex: `[^a-zA-Z0-9 .-]` → replace with `_`, then `.trim()`, then `.replace(/ /g, "_")`

## File Reference

### New Files (Linux SLS Steam)
| File | Purpose |
|------|---------|
| `src-tauri/src/commands/slssteam.rs` | SLS Steam commands (status, kill, start, config, patch steam.sh) |
| `src-tauri/src/commands/steam_acf.rs` | appmanifest ACF generation with Proton support |
| `src-tauri/src/commands/steam_library.rs` | Steam library detection, structure creation, game install |
| `src-tauri/src/utils/slssteam_config.rs` | YAML config manager for SLS Steam |
| `src/components/downloads/SteamLibraryPicker.tsx` | Steam library selection UI (auto-detects libraries) |
| `src/components/settings/SLSSteamStatusCard.tsx` | SLS Steam status + Setup/Start buttons |
| `scripts/depotdownloadermod-linux-build.yml` | GitHub Actions workflow for building DepotDownloaderMod Linux |

### Modified Files
| File | What Changed |
|------|-------------|
| `src-tauri/src/commands/depot_downloader.rs` | Platform-aware output_dir, `depot_downloader_exe()` |
| `src-tauri/src/commands/thirdparty.rs` | `resolve_github()` with Linux overrides, chmod +x post-extract |
| `src-tauri/src/lib.rs` | SLS commands registered, panic hook, catch_unwind |
| `src-tauri/src/main.rs` | `GDK_BACKEND=x11`, nvidia quirk, panic hook |
| `src-tauri/Cargo.toml` | `webkit2gtk-nvidia-quirk` crate, `[patch.crates-io] tao` |
| `src-tauri/src/utils/manifest_fetcher.rs` | `ManifestHub3` constants (was dead `ManifestCache_Pro`) |
| `src/components/downloads/InstallerProgressListener.tsx` | Full Linux 9-step post-download flow |
| `src/components/library/DepotPickerModal.tsx` | SteamLibraryPicker on Linux |
| `src/services/tauri.ts` | TypeScript wrappers for all SLS/Steam commands |

### External Dependencies
| Tool | Location | Notes |
|------|----------|-------|
| DepotDownloaderMod (Linux) | `thirdparty/depotdownloader/DepotDownloaderMod` | Self-contained 76MB ELF, compiled from fork |
| SLS Steam | `thirdparty/slssteam/bin/SLSsteam.so` | 23MB, extracted from `SLSsteam-Any-release.7z` |
| library-inject.so | `thirdparty/slssteam/bin/library-inject.so` | 0 bytes — this is normal (by design in official release) |
| SLS Steam config | `~/.config/SLSsteam/config.yaml` | YAML, managed by `slssteam_config.rs` |

## External Repos

### DepotDownloaderMod Linux Build
- **Fork**: `github.com/eisora08/DepotDownloaderMod` (fork of `SteamAutoCracks/DepotDownloaderMod`)
- **Workflow**: `.github/workflows/build-linux.yml` — builds Linux binary on push
- **Release asset**: `DepotDownloaderMod-linux-x64.zip`
- **IMPORTANT**: The .csproj is named `DepotDownloader.csproj` (NOT `DepotDownloaderMod.csproj`)
- **IMPORTANT**: Branch is `master` (NOT `main`) — release condition must check `refs/heads/master`

### ManifestHub3
- **Repo**: `github.com/steamtools-games/ManifestHub3`
- **Branch per app**: `{depot_id}_{gid}.manifest` files
- Previous repo `SteamManifestCache_Pro` is dead (404)

### SLS Steam
- **Repo**: `github.com/AceSLS/SLSsteam`
- **Release**: `SLSsteam-Any-release.7z` — extracts to `bin/` subdirectory

## Known Issues / TODO
1. **`isProtonGame` detection**: Currently hardcoded to `true` on Linux. Should ideally detect from depot OS metadata.
2. **library-inject.so is 0 bytes**: Normal for official SLS Steam release. The real library is SLSsteam.so.
3. **platform-inject.so not implemented yet**: Phase 2 from SLS Steam wiki — would allow non-Steam launchers.
4. **.NET SDK required for DepotDownloaderMod builds**: Handled via GitHub Actions CI now.
5. **tao bug**: `tao-0.35.3` panics at `event_loop.rs:457` — patched in `patches/tao/`. Upstream: tao#1178
6. **WebKitGTK blur**: `backdrop-filter` does NOT work on WebKitGTK/Linux. User accepted.

## Testing Checklist
- [ ] `cargo check` — 0 errors
- [ ] `npx tsc --noEmit` — 0 new errors (pre-existing test errors are OK)
- [ ] SLS Steam detected as installed (`slssteamStatus().installed === true`)
- [ ] Game downloads to `steamapps/common/{game_name}/`
- [ ] ACF created with `platform_override` in UserConfig/MountedConfig
- [ ] `slssteamKillSteam()` + `slssteamStartSteam()` executes
- [ ] Steam restarts with LD_AUDIT
- [ ] Game launches via Proton in Steam
