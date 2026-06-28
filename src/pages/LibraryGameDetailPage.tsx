import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  launchSteamApp,
  installSteamApp,
} from "../services/tauri";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";
import LibraryGameDetails from "../components/library/LibraryGameDetails";

import type { LibraryGame } from "../types/libraryGame";

import {
  showError,
  showWarning,
} from "../components/toast/GameToast";

type Props = {
  onBack?: () => void;
};

export default function LibraryGameDetailPage({ onBack }: Props) {
  const { selectedGame, setSelectedGame } = useLibraryGames();
  const game = selectedGame;

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      try {
        await launchSteamApp(Number(game.appId));
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else if (game.source === "local" && game.executablePath) {
      showWarning("Local executable launching is not available yet.", { title: "Not available" });
    } else {
      showWarning("This game cannot be launched yet.", { title: "Not available" });
    }
  }

  async function handleInstall(game: LibraryGame) {
    if (game.appId) {
      try {
        await installSteamApp(Number(game.appId));
      } catch (err) {
        showError(String(err), { title: "Error" });
      }
    } else {
      showWarning("This game cannot be installed through Steam because it has no AppID.", { title: "Not available" });
    }
  }

  function handleOpenSteamStore(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamStoreUrl(Number(game.appId))).catch(() =>
      showError("Could not open Steam page.", { title: "Error" })
    );
  }

  function handleOpenSteamDb(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamDbUrl(Number(game.appId))).catch(() =>
      showError("Could not open SteamDB.", { title: "Error" })
    );
  }

  function handleBack() {
    setSelectedGame(null);
    onBack?.();
  }

  if (!game) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <p className="text-(--color-muted)">No game selected.</p>
      </div>
    );
  }

  return (
    <LibraryGameDetails
      game={game}
      onPlay={handlePlay}
      onInstall={handleInstall}
      onOpenSteam={handleOpenSteamStore}
      onOpenSteamDb={handleOpenSteamDb}
      onBack={handleBack}
    />
  );
}
