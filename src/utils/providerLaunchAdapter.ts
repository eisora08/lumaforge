/**
 * Provider-neutral launch dispatch boundary.
 *
 * Called from GameSessionContext.launchGame() to dispatch a game launch
 * through the appropriate provider's protocol or direct executable.
 * Currently supports: Steam (inline), Epic (this adapter), Local/Manual (inline).
 */

import type { LibraryGame } from "../types/libraryGame";
import { EPIC_LAUNCH_ENABLED, EPIC_DIRECT_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LAUNCH } from "../services/epicFeatureFlag";

export type LaunchDispatchResult = {
  dispatched: boolean;
  method?: string;
  error?: string;
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

  // Not an Epic game or Epic launch not enabled
  return { dispatched: false };
}
