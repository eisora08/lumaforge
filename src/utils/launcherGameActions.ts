import type { LibraryGame } from "../types/libraryGame";

export type PrimaryAction = "play" | "install" | "missing-path" | "details";

export function getLauncherGamePrimaryAction(game: LibraryGame): PrimaryAction {
  if (game.isPlayable && game.appId) return "play";
  if (game.isInstallable && game.appId) return "install";
  if (game.source === "local" && game.executablePath) return "play";
  if (game.source === "local" && !game.executablePath) return "missing-path";
  if (game.isPlayable) return "play";
  if (game.isInstallable) return "install";
  return "details";
}
