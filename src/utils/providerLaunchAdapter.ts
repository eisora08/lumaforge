/**
 * Provider-neutral launch dispatch boundary.
 *
 * Called from GameSessionContext.launchGame() to dispatch a game launch
 * through the appropriate provider's protocol or direct executable.
 * Currently supports: Steam (inline), Epic (this adapter), Local/Manual (inline).
 */

import type { LibraryGame } from "../types/libraryGame";
import { EPIC_LAUNCH_ENABLED, EPIC_DIRECT_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LAUNCH } from "../services/epicFeatureFlag";
import { DEBRID_LAUNCH_ENABLED, DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_LAUNCH } from "../features/debrid/debridFeatureFlag";

export type LaunchDispatchResult = {
  dispatched: boolean;
  method?: string;
  error?: string;
  /** PID of the spawned process when the provider reports one (Debrid direct-executable). */
  pid?: number;
};

/**
 * Dispatch a launch for a non-Steam, non-local, non-manual game.
 * Currently handles Epic games via protocol URI or direct executable.
 *
 * Returns `{ dispatched: false }` for providers not handled by this adapter
 * (the caller falls through to its existing else/error branch).
 */
export async function dispatchProviderLaunch(game: LibraryGame): Promise<LaunchDispatchResult> {
  if (game.source === "epic" && EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED) {
    const { getEpicLaunchMetadata } = await import("../services/epicGameStore");
    const { launchEpicGame } = await import("../services/tauri");

    const meta = game.providerGameId ? getEpicLaunchMetadata(game.providerGameId) : undefined;

    if (!meta?.appName) {
      if (DEBUG_EPIC_LAUNCH) {
        console.warn("[EPIC_LAUNCH] no appName in metadata", game.providerGameId);
      }
      return { dispatched: false, error: "No Epic appName in metadata" };
    }

    if (DEBUG_EPIC_LAUNCH) {
      console.log("[EPIC_LAUNCH] dispatching", { appName: meta.appName, providerGameId: game.providerGameId });
    }

    try {
      const result = await launchEpicGame(
        meta.appName,
        meta.executablePath,
        meta.launchArguments,
        EPIC_DIRECT_LAUNCH_ENABLED,
        meta.namespace,
        meta.catalogItemId,
      );

      if (DEBUG_EPIC_LAUNCH) {
        console.log("[EPIC_LAUNCH] result", result);
      }

      return {
        dispatched: result.success,
        method: result.method,
        error: result.error ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EPIC_LAUNCH] failed", msg);
      return { dispatched: false, error: msg };
    }
  }

  // ── Debrid games: direct executable launch ──
  if (game.source === "debrid" && DEBRID_LAUNCH_ENABLED && DEBRID_LIBRARY_ENABLED) {
    if (!game.executablePath) {
      if (DEBUG_DEBRID_LAUNCH) {
        console.warn("[DEBRID_LAUNCH] no executablePath", { providerGameId: game.providerGameId });
      }
      return { dispatched: false, error: "No executable path for Debrid game" };
    }

    const { launchDebridGame } = await import("../services/tauri");

    if (DEBUG_DEBRID_LAUNCH) {
      console.log("[DEBRID_LAUNCH] dispatching", { executablePath: game.executablePath, providerGameId: game.providerGameId });
    }

    try {
      const result = await launchDebridGame({
        executablePath: game.executablePath,
        launchArguments: game.launchArguments ?? null,
        workingDirectory: game.workingDirectory ?? null,
      });

      if (DEBUG_DEBRID_LAUNCH) {
        console.log("[DEBRID_LAUNCH] result", result);
      }

      return {
        dispatched: result.success,
        method: result.method,
        error: result.error ?? undefined,
        pid: result.pid ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[DEBRID_LAUNCH] failed", msg);
      // UAC cancelled by user — not a real error, don't show to user
      if (msg.includes("cancelled by the user") || msg.includes("Elevation declined")) {
        return { dispatched: false };
      }
      return { dispatched: false, error: msg };
    }
  }

  // ── Emulator games: launch ROM via configured emulator ──
  if (game.source === "emulator") {
    if (!game.executablePath) {
      console.warn("[EMULATOR_LAUNCH] no ROM path", { providerGameId: game.providerGameId });
      return { dispatched: false, error: "No ROM path for emulator game" };
    }

    const configId = game.emulatorConfigId;
    const profileId = game.emulatorProfileId;

    if (!configId) {
      console.warn("[EMULATOR_LAUNCH] no emulator config assigned", { id: game.id });
      return { dispatched: false, error: "No emulator configured for this game" };
    }

    try {
      const { getEmulatorConfig } = await import("../services/emulatorConfigStore");
      const { getEmulatorById, getAllEmulatorDefinitions } = await import("../data/emulatorDefinitions/emulators");
      const { launchExecutableStr } = await import("../services/tauri");

      const config = getEmulatorConfig(configId);
      if (!config) {
        console.warn("[EMULATOR_LAUNCH] emulator config not found", { configId });
        return { dispatched: false, error: "Emulator configuration not found" };
      }

      const romPath = game.executablePath;
      const romExt = romPath.split(".").pop()?.toLowerCase() ?? "";
      const emulatorDir = config.installDir;

      // Helper: expand placeholders in an args template string.
      // Matches Playnite's ExpandVariables — plain text substitution, NO extra quoting.
      function expandArgs(template: string): string {
        return template
          .replace(/\{ImagePath\}/g, romPath)
          .replace(/\{ImageName\}/g, romPath.split(/[\\/]/).pop() ?? "")
          .replace(/\{ImageNameNoExt\}/g, romPath.split(/[\\/]/).pop()?.split(".")[0] ?? "")
          .replace(/\{EmulatorDir\}/g, emulatorDir)
          .replace(/\{Name\}/g, game.title ?? "");
      }

      // 1) Check custom profile with its own executable (no definitionId needed)
      const userProfile = profileId ? config.profiles.find(p => p.id === profileId) : undefined;

      if (userProfile?.type === "custom" && userProfile.executable) {
        const exePath = userProfile.executable;
        const argsString = expandArgs(userProfile.arguments ?? "");

        console.log("[EMULATOR_LAUNCH] custom profile", { exePath, argsString });
        const result = await launchExecutableStr(exePath, argsString, userProfile.workingDirectory ?? emulatorDir, game.title ?? undefined);
        return { dispatched: result.launched, method: "emulator-direct", pid: result.pid ?? undefined };
      }

      // 2) Also check any custom profile in the config that has an executable
      if (!userProfile || userProfile.type !== "custom") {
        const fallbackCustom = config.profiles.find(p => p.type === "custom" && p.executable);
        if (fallbackCustom?.executable) {
          const exePath = fallbackCustom.executable;
          const argsString = expandArgs(fallbackCustom.arguments ?? "");

          console.log("[EMULATOR_LAUNCH] fallback custom profile", { exePath, argsString, profileId: fallbackCustom.id });
          const result = await launchExecutableStr(exePath, argsString, fallbackCustom.workingDirectory ?? emulatorDir, game.title ?? undefined);
          return { dispatched: result.launched, method: "emulator-direct", pid: result.pid ?? undefined };
        }
      }

      // 3) Resolve emulator definition — try config.definitionId, then try matching by profile name
      let definition = config.definitionId ? getEmulatorById(config.definitionId) : undefined;

      if (!definition && config.profiles.length > 0) {
        const allDefs = getAllEmulatorDefinitions();
        for (const profile of config.profiles) {
          if (profile.type !== "builtin" || !profile.builtinProfileName) continue;
          for (const def of allDefs) {
            if (def.profiles.some(p => p.name === profile.builtinProfileName)) {
              definition = def;
              console.log("[EMULATOR_LAUNCH] resolved definition from profile name", { definitionId: def.id, profileName: profile.builtinProfileName });
              break;
            }
          }
          if (definition) break;
        }
      }

      if (!definition) {
        console.warn("[EMULATOR_LAUNCH] no emulator definition found", { configId: config.id, definitionId: config.definitionId });
        return { dispatched: false, error: "Emulator has no linked definition. Please set an Emulator Specification in Emulator Settings." };
      }

      // 4) Built-in profile or fallback
      let matchingBuiltin = profileId
        ? definition.profiles.find(p => p.name === profileId)
        : undefined;

      if (!matchingBuiltin) {
        matchingBuiltin = definition.profiles.find(p => p.imageExtensions.includes(romExt));
      }
      if (!matchingBuiltin && definition.profiles.length > 0) {
        matchingBuiltin = definition.profiles[0];
      }

      if (!matchingBuiltin) {
        console.warn("[EMULATOR_LAUNCH] no matching profile", { romExt, definitionId: definition.id });
        return { dispatched: false, error: "No matching emulator profile found" };
      }

      const exePath = `${emulatorDir}\\${matchingBuiltin.startupExecutable.replace(/[\^$]/g, "").replace(/\\(.)/g, "$1")}`;
      const argsString = expandArgs(matchingBuiltin.startupArguments);

      console.log("[EMULATOR_LAUNCH] dispatching", { exePath, argsString });
      const result = await launchExecutableStr(exePath, argsString, emulatorDir, game.title ?? undefined);

      return {
        dispatched: result.launched,
        method: "emulator-direct",
        pid: result.pid ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[EMULATOR_LAUNCH] failed", msg);
      return { dispatched: false, error: msg };
    }
  }

  // Not an Epic/Debrid/Emulator game or launch not enabled
  return { dispatched: false };
}
