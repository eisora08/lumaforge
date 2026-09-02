import type { LibraryGame } from "../types/libraryGame";
import { EPIC_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED } from "../services/epicFeatureFlag";
import { DEBRID_LIBRARY_ENABLED } from "../features/debrid/debridFeatureFlag";

const DEBUG_LUA_ACTIONS = false;

export type PrimaryAction = "play" | "install" | "uninstalling" | "missing-path" | "details" | "open-steam" | "open-lua-folder" | "installing" | "select-exe";

export function getLauncherGamePrimaryAction(game: LibraryGame): PrimaryAction {
  const hasLuaScripts = game.hasLua || (game.luaScripts && game.luaScripts.length > 0);
  const isEpicLaunchable = game.source === "epic" && EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED;

  // Debrid-specific status handling — standalone entries (no longer merged into Steam).
  if (DEBRID_LIBRARY_ENABLED) {
    if (game.debridStatus === "waiting-installer") {
      return "installing";
    }
    if (game.debridStatus === "needs-path") {
      return "select-exe";
    }
    if (game.source === "debrid" && game.isPlayable) {
      return "play";
    }
    if (game.source === "debrid" && game.isInstallable) {
      return "install";
    }
  }

  let action: PrimaryAction;
  if (game.source === "manual" && game.executablePath) {
    action = "play";
  } else if (game.source === "manual" && !game.executablePath) {
    action = "missing-path";
  } else if (isEpicLaunchable && game.isPlayable) {
    action = "play";
  } else if (game.isPlayable && game.appId) {
    action = "play";
  } else if (game.isInstallable && game.appId) {
    action = "install";
  } else if (game.appId && !game.isPlayable && !game.steamInstalled && !game.isInstalled) {
    action = "install";
  } else if (hasLuaScripts && !game.appId && !game.executablePath && !game.isPlayable) {
    action = "open-lua-folder";
  } else if (game.source === "local" && game.executablePath) {
    action = "play";
  } else if (game.source === "local" && !game.executablePath) {
    action = "missing-path";
  } else if (game.isPlayable) {
    action = "play";
  } else if (game.isInstallable) {
    action = "install";
  } else {
    action = "details";
  }

  if (DEBUG_LUA_ACTIONS && (hasLuaScripts || game.source === "lua")) {
    console.log(`[LUA][ACTION] title="${game.title}" appId=${game.appId} hasLua=${hasLuaScripts} source=${game.source} steamInstalled=${game.steamInstalled} isPlayable=${game.isPlayable} isInstallable=${game.isInstallable} primaryAction=${action}`);
  }

  return action;
}
