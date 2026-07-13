import type { LibraryGame } from "../types/libraryGame";

export type PrimaryAction = "play" | "install" | "uninstalling" | "missing-path" | "details" | "open-steam" | "open-lua-folder";

export function getLauncherGamePrimaryAction(game: LibraryGame): PrimaryAction {
  const hasLuaScripts = game.luaScripts && game.luaScripts.length > 0;

  let action: PrimaryAction;
  if (game.source === "manual" && game.executablePath) {
    action = "play";
  } else if (game.source === "manual" && !game.executablePath) {
    action = "missing-path";
  } else if (game.isPlayable && game.appId) {
    action = "play";
  } else if (game.isInstallable && game.appId) {
    action = "install";
  } else if (game.appId && !game.isPlayable && !game.steamInstalled) {
    // Any game with a valid Steam appId, not playable, not installed → Install
    // Covers owned-but-not-installed, Lua ownership-unknown, any future Steam-mapped entry
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

  if (hasLuaScripts || game.source === "lua") {
    console.log(`[LUA][ACTION] title="${game.title}" appId=${game.appId} hasLua=${hasLuaScripts} source=${game.source} steamInstalled=${game.steamInstalled} isPlayable=${game.isPlayable} isInstallable=${game.isInstallable} primaryAction=${action}`);
  }

  return action;
}
