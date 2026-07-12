import { useMemo } from "react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeSecondsForAppId } from "../../services/playtimeService";
import { useUserProfile, resolveProfileMediaUrl } from "../profile/userProfile";
import { getAvatarPreset, getBannerPreset } from "../profile/profilePresets";

export default function ConsoleProfileHeader() {
  const { games } = useLibraryGames();
  const { favoriteIds } = useFavorites();
  const [profile] = useUserProfile();

  const avatarPreset = useMemo(() => getAvatarPreset(profile.avatarPreset), [profile.avatarPreset]);
  const bannerPreset = useMemo(() => getBannerPreset(profile.bannerPreset), [profile.bannerPreset]);
  const avatarDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.avatarUrl), [profile.avatarUrl]);

  const stats = useMemo(() => {
    const total = games.length;
    const installed = games.filter((g) => g.steamInstalled).length;
    const lua = games.filter((g) => g.hasLua).length;
    const favorites = favoriteIds.size;
    let totalSeconds = 0;
    for (const g of games) {
      if (g.appId) {
        totalSeconds += getPlaytimeSecondsForAppId(g.appId);
      }
    }
    return {
      total,
      installed,
      lua,
      favorites,
      totalPlaytimeHours: Math.round(totalSeconds / 3600),
    };
  }, [games, favoriteIds]);

  return (
    <div
      className="relative flex items-center gap-5 overflow-hidden rounded-2xl border border-(--surface-active-border) px-6 py-4 backdrop-blur-sm"
      style={bannerPreset ? { background: bannerPreset.gradient } : undefined}
    >
      {bannerPreset && (
        <div className="absolute inset-0 bg-black/30" />
      )}
      <div
        className="relative z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ring-2 ring-white/20"
        style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
      >
        {avatarDisplayUrl ? (
          <img src={avatarDisplayUrl} alt="" className="h-full w-full rounded-2xl object-cover" />
        ) : (
          <span className="text-2xl">{avatarPreset?.icon ?? "🎮"}</span>
        )}
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <h1 className="text-xl font-bold text-white drop-shadow-lg">
          {profile.displayName}
        </h1>
        <p className="mt-0.5 text-sm text-white/70 drop-shadow">
          {profile.status}
        </p>
      </div>

      <div className="relative z-10 hidden gap-6 sm:flex">
        <StatItem label="Games" value={stats.total} />
        <StatItem label="Installed" value={stats.installed} />
        <StatItem label="Lua" value={stats.lua} />
        <StatItem label="Favorites" value={stats.favorites} />
        {stats.totalPlaytimeHours > 0 && (
          <StatItem label="Playtime" value={`${stats.totalPlaytimeHours}h`} />
        )}
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-white drop-shadow-lg">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-white/60">
        {label}
      </div>
    </div>
  );
}
