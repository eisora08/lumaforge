# Phase 2A Implementation Plan — Epic Games: Provider-Native Launch + Play Activation

## Goal
Enable playing Epic Games from LumaForge's Library via the Epic Games Launcher protocol, with full session tracking, process detection, and playtime recording — identical to the Steam launch experience.

---

## Part 1: Verify Launch Mechanism (Manual Audit — No Code)

### What to verify
1. **Epic protocol URI**: `com.epicgames.launcher:/apps/<appName>?action=launch`
   - The `appName` is the Epic `AppName` slug from the manifest (e.g. `"Fortnite"`, `"Satisfactory"`).
   - This requires the Epic Games Launcher to be running.
   - If launcher is not running, Windows will attempt to start it.

2. **Direct executable fallback**: `Command::new(executable_path).args(launch_args).spawn()`
   - Only when `executableExists === true` in the scan result.
   - Bypasses the launcher (no cloud sync, no DLC checks).
   - Used as last resort.

### Evidence required before proceeding
- At least one Epic game launched via `com.epicgames.launcher:/apps/{appName}?action=launch`
- Confirmed the game process starts and appears in process list
- Confirmed `appName` from manifest works as the identity parameter

---

## Part 2: Rust — `launch_epic_game` Command

### File: `src-tauri/src/commands/epic.rs`

Add a new `#[tauri::command]` after the existing `scan_epic_installed_games`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicLaunchResult {
    pub success: bool,
    pub method: String,        // "protocol" | "direct-executable"
    pub error: Option<String>, // non-null on partial failure (e.g. protocol failed, fell back)
}

#[tauri::command]
pub fn launch_epic_game(
    app_name: String,
    executable_path: Option<String>,
    launch_arguments: Option<String>,
) -> Result<EpicLaunchResult, String> {
    // 1. Try protocol launch: com.epicgames.launcher:/apps/<appName>?action=launch
    let protocol_url = format!(
        "com.epicgames.launcher:/apps/{}?action=launch",
        app_name
    );
    
    match open::that_detached(&protocol_url) {
        Ok(_) => Ok(EpicLaunchResult {
            success: true,
            method: "protocol".to_string(),
            error: None,
        }),
        Err(protocol_err) => {
            // 2. Fallback: direct executable spawn
            if let Some(exe) = executable_path {
                let trimmed = exe.trim().trim_matches(|c| c == '"' || c == '\'');
                let mut cmd = std::process::Command::new(trimmed);
                
                if let Some(args_str) = launch_arguments {
                    if !args_str.is_empty() {
                        cmd.args(args_str.split_whitespace().filter(|s| !s.is_empty()));
                    }
                }
                
                cmd.stdout(std::process::Stdio::null())
                   .stderr(std::process::Stdio::null())
                   .stdin(std::process::Stdio::null());
                
                match cmd.spawn() {
                    Ok(child) => {
                        let pid = child.id();
                        std::mem::forget(child);
                        Ok(EpicLaunchResult {
                            success: true,
                            method: "direct-executable".to_string(),
                            error: Some(format!("Protocol failed ({}), used direct executable", protocol_err)),
                        })
                    }
                    Err(exe_err) => Err(format!(
                        "Both protocol and direct executable failed. Protocol: {}; Executable: {}",
                        protocol_err, exe_err
                    )),
                }
            } else {
                Err(format!(
                    "Epic launcher protocol failed ({}) and no executable path available",
                    protocol_err
                ))
            }
        }
    }
}
```

### File: `src-tauri/src/lib.rs`

Register the new command (after `scan_epic_installed_games`):
```rust
commands::epic::launch_epic_game,
```

---

## Part 3: TypeScript — TS Binding

### File: `src/services/tauri.ts`

Add at end (after `scanEpicInstalledGames`):

```typescript
export type EpicLaunchResult = {
  success: boolean;
  method: string;
  error?: string;
};

export async function launchEpicGame(
  appName: string,
  executablePath?: string,
  launchArguments?: string,
): Promise<EpicLaunchResult> {
  return await invoke<EpicLaunchResult>("launch_epic_game", {
    appName,
    executablePath: executablePath ?? null,
    launchArguments: launchArguments ?? null,
  });
}
```

---

## Part 4: Feature Flag

### File: `src/services/epicFeatureFlag.ts`

Add:
```typescript
/** Gate for Epic game launch (protocol + direct executable). Requires EPIC_LIBRARY_ENABLED. */
export const EPIC_LAUNCH_ENABLED = false;

/** Diagnostics gate for Epic launch path. */
export const DEBUG_EPIC_LAUNCH = false;
```

---

## Part 5: Epic Launch Metadata Retention

### File: `src/services/epicGameStore.ts`

Add a separate `Map` to retain raw scan metadata needed for launch (fields not carried by `LibraryGame`):

```typescript
type EpicLaunchMetadata = {
  appName?: string;
  namespace?: string;
  catalogItemId?: string;
  executablePath?: string;
  launchArguments?: string;
  processNames: string[];
  installLocation?: string;
  manifestPath?: string;
};

let _launchMetadataByProviderGameId = new Map<string, EpicLaunchMetadata>();
```

In `refreshEpicGames()`, after filtering eligible entries, store launch metadata:

```typescript
// Inside refreshEpicGames, after `const eligible = entries.filter(isEpicEntryEligible)`
for (const game of eligible) {
  _launchMetadataByProviderGameId.set(game.providerGameId, {
    appName: game.appName,
    namespace: game.namespace,
    catalogItemId: game.catalogItemId,
    executablePath: game.executablePath,
    launchArguments: game.launchArguments,
    processNames: game.processNames,
    installLocation: game.installLocation,
    manifestPath: game.manifestPath,
  });
}
```

Add public getter:
```typescript
export function getEpicLaunchMetadata(providerGameId: string): EpicLaunchMetadata | undefined {
  return _launchMetadataByProviderGameId.get(providerGameId);
}
```

Clear the map in `resetEpicGameCache()`.

---

## Part 6: Provider Launch Adapter

### File: `src/utils/providerLaunchAdapter.ts` (NEW)

Provider-neutral launch dispatch boundary. Called from `GameSessionContext.launchGame()`:

```typescript
import type { LibraryGame } from "../types/libraryGame";
import { EPIC_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LAUNCH } from "../services/epicFeatureFlag";

export type LaunchDispatchResult = {
  dispatched: boolean;
  method?: string;
  error?: string;
};

export async function dispatchProviderLaunch(game: LibraryGame): Promise<LaunchDispatchResult> {
  if (game.source === "epic" && EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED) {
    const { getEpicLaunchMetadata } = await import("../services/epicGameStore");
    const { launchEpicGame } = await import("../services/tauri");
    
    const meta = game.providerGameId ? getEpicLaunchMetadata(game.providerGameId) : undefined;
    
    if (!meta?.appName) {
      if (DEBUG_EPIC_LAUNCH) console.warn("[EPIC_LAUNCH] no appName in metadata", game.providerGameId);
      return { dispatched: false, error: "No Epic appName in metadata" };
    }
    
    if (DEBUG_EPIC_LAUNCH) console.log("[EPIC_LAUNCH] dispatching", { appName: meta.appName, method: "protocol" });
    
    try {
      const result = await launchEpicGame(
        meta.appName,
        meta.executablePath,
        meta.launchArguments,
      );
      return { dispatched: true, method: result.method, error: result.error ?? undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EPIC_LAUNCH] failed", msg);
      return { dispatched: false, error: msg };
    }
  }
  
  return { dispatched: false };
}
```

---

## Part 7: GameSessionContext — Epic Launch Dispatch

### File: `src/context/GameSessionContext.tsx`

**7a. Import the adapter:**
```typescript
import { dispatchProviderLaunch } from "../utils/providerLaunchAdapter";
```

**7b. In `launchGame()` line 881**, update the source mapping to include `"epic"`:
```typescript
source: game.source === "steam" ? "steam" : game.source === "epic" ? "epic" : game.source === "local" ? "local" : game.source === "manual" ? "manual" : "unknown",
```

**7c. In the dispatch switch (line 967)**, add Epic BEFORE the `else` clause:
```typescript
} else if (game.source === "epic") {
  // Epic protocol or direct executable launch
  const result = await dispatchProviderLaunch(game);
  if (ls.cancelled || ls.token !== token) return;
  
  if (result.dispatched) {
    if (ENABLE_VERBOSE_LAUNCH_LOGS) {
      console.debug("[Launch] epic dispatched", { gameKey: computedKey, method: result.method });
    }
    
    // Scan for process after launch (same pattern as Steam)
    ls.launchTimeout = setTimeout(async () => {
      ls.launchTimeout = null;
      if (ls.token !== token || ls.cancelled) return;
      
      await scanForProcessAfterLaunch(computedKey, game, token, 0);
      if (sessionsRef.current[computedKey]?.state !== "running") {
        await scanForProcessAfterLaunch(computedKey, game, token, 3000);
      }
      if (sessionsRef.current[computedKey]?.state !== "running") {
        await scanForProcessAfterLaunch(computedKey, game, token, 5000);
      }
      
      if (ls.token === token && !ls.cancelled && sessionsRef.current[computedKey]?.state === "launching") {
        setSessions((prev) => {
          const existing = prev[computedKey];
          if (!existing || existing.state !== "launching") return prev;
          return {
            ...prev,
            [computedKey]: { ...existing, state: "running" as ActiveGameState, softSession: true, trackingConfidence: "none", updatedAt: Date.now() },
          };
        });
      }
    }, 2000);
  } else {
    // Launch failed — clean up session
    console.warn("[Launch] epic failed", { gameKey: computedKey, error: result.error });
    setSessions((prev) => {
      const next = { ...prev };
      delete next[computedKey];
      return next;
    });
  }
} else if (game.source === "local") {
```

**7d. In the overlay event effects (lines 1254, 1327)**, add Epic provider label:
```typescript
const provider = curSession.source === "steam" ? "Steam" : curSession.source === "epic" ? "Epic" : curSession.source === "local" ? "Local" : curSession.source === "manual" ? "Manual" : "Unknown";
```

**7e. In playtime provider mapping (lines 1266, 1355)**, add Epic:
```typescript
const ptProvider = curSession.source === "steam" ? "steam" : curSession.source === "epic" ? "epic" : curSession.source === "local" ? "local" : curSession.source === "manual" ? "manual" : "unknown";
```

**7f. Dispatch delay for Epic** (line 956):
```typescript
const dispatchDelayMs = game.source === "steam" ? 1500 : game.source === "epic" ? 1500 : 800;
```

**7g. In hydrate effect (line 265)**, add Epic to soft session handling — already done (`s.source === "steam" || s.source === "epic"`).

---

## Part 8: `epicGameToLibraryGame` — `isPlayable` Derivation

### File: `src/services/epicGameLibraryMapper.ts`

Change the mapped game to derive `isPlayable`:

```typescript
import { EPIC_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED } from "./epicFeatureFlag";

export function epicGameToLibraryGame(game: EpicInstalledGame): LibraryGame {
  const canLaunch = EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED 
    && (game.appName || game.executablePath);
  
  const mapped: LibraryGame = {
    ...existing fields...,
    isPlayable: canLaunch,
    isInstalled: true,
    // ... rest unchanged
  };
```

---

## Part 9: `launcherGameActions.ts` — Primary Action

### File: `src/utils/launcherGameActions.ts`

Add Epic path to `getLauncherGamePrimaryAction()`:

```typescript
import { EPIC_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED } from "../services/epicFeatureFlag";

export function getLauncherGamePrimaryAction(game: LibraryGame): PrimaryAction {
  const hasLuaScripts = game.luaScripts && game.luaScripts.length > 0;
  const isEpicLaunchable = game.source === "epic" && EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED;

  // ... existing manual check ...
  
  if (isEpicLaunchable && game.isPlayable) {
    return "play";
  }
  
  // ... rest of existing logic unchanged
```

---

## Part 10: Gate Remaining Steam-Only Actions

### File: `src/components/games/GameLauncherTile.tsx`

Gate "Open in Steam" (line 728-734):
```typescript
{game.appId && game.source !== "epic" && (
  <MenuItem
    label="Open in Steam"
    ...existing...
  />
)}
```

"Browse Local Files" and "Create Shortcut" already work for Epic (they use `game.installDir`).

### File: `src/components/layout/SidebarLibraryList.tsx`

Already gated with `game.source !== "epic"` in Phase 1B. No changes needed.

---

## Part 11: Process Name Exclusion for Epic Launcher

### File: `src/context/GameSessionContext.tsx`

In the brute-force kill path (Layer 4, line 651), ensure Epic launcher/helper processes are excluded:

The existing code already has `!procName.includes("epic")` at line 651. This prevents accidentally killing the Epic Games Launcher when trying to stop a game. No changes needed — this is already correct.

For the `stopSession` Layer 1 and Layer 2 paths, the game's `processNames` from the manifest (stored in `_launchMetadataByProviderGameId`) will be used for targeted killing, so only the actual game process is terminated — not the launcher.

---

## Part 12: Build Validation

1. `cargo check` — Rust compiles with new `launch_epic_game` command
2. `tsc --noEmit` — TypeScript compiles with new types and imports
3. `vite build` — Production build succeeds

---

## Part 13: Runtime Validation

1. Enable flags: `EPIC_LIBRARY_ENABLED = true`, `EPIC_LAUNCH_ENABLED = true`
2. Verify Epic games appear in Library grid
3. Verify Play button appears for eligible Epic games
4. Click Play → Epic launcher opens / game starts
5. Verify session overlay shows "Epic" as provider
6. Verify process tracking picks up game PID
7. Verify playtime records after 15+ seconds of gameplay
8. Verify Stop kills the game process
9. Verify "Uninstall in Steam" is hidden for Epic games

---

## Execution Order

| Step | Files | Depends on |
|------|-------|-----------|
| 1 | Verify launch mechanism (manual) | — |
| 2 | `epic.rs` — add `launch_epic_game` | Step 1 |
| 3 | `lib.rs` — register command | Step 2 |
| 4 | `tauri.ts` — add TS binding | Step 3 |
| 5 | `epicFeatureFlag.ts` — add flags | — |
| 6 | `epicGameStore.ts` — retain launch metadata | Step 5 |
| 7 | `providerLaunchAdapter.ts` (NEW) — adapter | Steps 4-6 |
| 8 | `GameSessionContext.tsx` — Epic dispatch | Step 7 |
| 9 | `epicGameLibraryMapper.ts` — isPlayable | Step 5 |
| 10 | `launcherGameActions.ts` — primary action | Step 5 |
| 11 | `GameLauncherTile.tsx` — gate Steam actions | — |
| 12 | Build validation | All |
| 13 | Runtime validation | All |
