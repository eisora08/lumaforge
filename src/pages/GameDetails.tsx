import { useEffect, useMemo, useState } from "react";
import { useGameDetails } from "../context/GameDetailsContext";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import StoreGameDetailsPage from "../components/store/StoreGameDetailsPage";
import type { PackageGame } from "../types/package";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { PackageInstallStatus } from "../types/packageInstall";

export default function GameDetailsPage({ onBack }: { onBack: () => void }) {
  const { selectedGame, clearSelection } = useGameDetails();

  const [metadata, setMetadata] = useState<SteamAppMetadata | undefined>();
  const [reviewSummary, setReviewSummary] = useState<SteamReviewSummary | undefined>();
  const [installStatus] = useState<PackageInstallStatus>("not-installed");

  const packageGame: PackageGame | null = useMemo(() => {
    if (!selectedGame) return null;
    return {
      appId: selectedGame.appId,
      title: selectedGame.title,
      imageUrl: selectedGame.imageUrl,
      platforms: [],
      sources: [],
    };
  }, [selectedGame]);

  const appIdNum = selectedGame ? Number(selectedGame.appId) : null;
  const validAppIds: number[] = appIdNum !== null && Number.isFinite(appIdNum) ? [appIdNum] : [];

  useEffect(() => {
    if (validAppIds.length === 0) return;
    let cancelled = false;
    async function load() {
      try {
        const [metaMap] = await Promise.all([
          resolveGameMetadata(validAppIds),
        ]);
        if (cancelled) return;
        setMetadata(metaMap[validAppIds[0]]);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdNum]);

  useEffect(() => {
    if (validAppIds.length === 0) return;
    let cancelled = false;
    async function load() {
      try {
        const [summaries] = await Promise.all([
          resolveGameReviewSummaries(validAppIds),
        ]);
        if (cancelled) return;
        setReviewSummary(summaries[validAppIds[0]]);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdNum]);

  const handleBack = () => {
    clearSelection();
    onBack();
  };

  if (!packageGame) {
    return (
      <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-7">
        <p className="text-(--color-muted)">No game selected.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-7">
      <StoreGameDetailsPage
        game={packageGame}
        metadata={metadata}
        reviewSummary={reviewSummary}
        installStatus={installStatus}
        moreLikeThisGames={[]}
        onBack={handleBack}
      />
    </div>
  );
}
