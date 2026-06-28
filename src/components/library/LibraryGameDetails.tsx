import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Cloud,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  Gamepad2,
  HardDrive,
  LifeBuoy,
  MessageCircle,
  MoreHorizontal,
  Play,
  Puzzle,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
  Star,
  Trophy,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamStoreUrl,
  getSteamCommunityUrl,
  getSteamDiscussionsUrl,
  getSteamGuidesUrl,
  getSteamSupportUrl,
  getSteamDbUrl,
} from "../../utils/steamLinks";

type LibraryGameDetailsProps = {
  game: LibraryGame;
  loading?: boolean;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onSync?: (game: LibraryGame) => void;
  onToggleScript?: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
  onOpenSteam?: (game: LibraryGame) => void;
  onOpenSteamDb?: (game: LibraryGame) => void;
  onOpenSourceSelector?: (game: LibraryGame) => void;
  onBack: () => void;
};

function getHeroImageUrl(game: LibraryGame): string | undefined {
  return game.metadata?.library_hero_image
    || game.metadata?.background_image
    || game.metadata?.hero_image
    || game.metadata?.library_header_image
    || game.metadata?.header_image
    || game.metadata?.capsule_image
    || game.metadata?.wide_cover_image
    || game.metadata?.capsule_image_v5
    || game.imageUrl
    || undefined;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

function StatInline({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)">
      <span className="shrink-0">{icon}</span>
      <span className="hidden sm:inline text-[10px] uppercase tracking-wider">{label}:</span>
      <span className="font-medium text-(--color-text)">{value}</span>
    </div>
  );
}

export default function LibraryGameDetails({
  game,
  loading = false,
  onPlay,
  onInstall,
  onDeleteScript,
  onOpenSteam,
  onOpenSteamDb,
  onBack,
}: LibraryGameDetailsProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const imageUrl = getHeroImageUrl(game);
  const script = game.luaScripts[0];
  const action = getLauncherGamePrimaryAction(game);

  const rawShort = game.metadata?.short_description;
  const rawAbout = game.metadata?.about_the_game;
  const rawDetailed = game.metadata?.detailed_description;

  const aboutText = rawAbout ? stripHtml(rawAbout) : "";
  const detailedText = rawDetailed ? stripHtml(rawDetailed) : "";

  const shortIntro = (rawShort && stripHtml(rawShort)) || (aboutText ? aboutText.slice(0, 300) + (aboutText.length > 300 ? "…" : "") : "") || (detailedText ? detailedText.slice(0, 300) + (detailedText.length > 300 ? "…" : "") : "");
  const longDescText = aboutText || detailedText || "";
  const descriptionsMatch = shortIntro && longDescText && (longDescText.startsWith(shortIntro.replace(/…$/, "")) || shortIntro === longDescText);
  const hasLongDescription = longDescText.length > 300;
  const displayedDescription = hasLongDescription && !showFullDescription
    ? longDescText.slice(0, 300) + "…"
    : longDescText;

  const genres = game.metadata?.genres || [];
  const categories = game.metadata?.categories || [];

  const appIdNum = game.appId ? Number(game.appId) : null;

  useEffect(() => {
    if (!showActions) return;
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActions]);

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
          </div>
        </div>
        <div className="h-72 animate-pulse bg-white/5 lg:h-96" />
        <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
            <div className="mb-2 h-9 w-24 animate-pulse rounded-xl bg-white/10" />
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-3 w-24 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:py-8">
            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
              <div className="space-y-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
              </div>
              <div className="mt-6 lg:mt-0">
                <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back bar */}
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-2 text-sm text-(--color-muted) transition hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </button>
        </div>
      </div>

      {/* Hero banner */}
      <div className="relative h-72 shrink-0 overflow-hidden bg-white/5 lg:h-96">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={game.title}
            className="h-full w-full object-cover object-center"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-white/10 via-white/5 to-black/50">
            <Gamepad2 className="h-20 w-20 text-(--color-muted)" />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/95 via-black/50 to-transparent" />

        {/* Logo overlay */}
        {game.metadata?.logo_image && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <img
              src={game.metadata.logo_image}
              alt={`${game.title} logo`}
              className="max-h-28 max-w-[300px] object-contain drop-shadow-2xl lg:max-h-36 lg:max-w-[420px]"
            />
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0">
          <div className="mx-auto w-full max-w-[1440px] px-5 pb-5 lg:pb-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {game.steamInstalled && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Installed
                </span>
              )}
              {game.isLuaActive && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-[10px] text-(--color-accent)">
                  <FileCode2 className="h-3 w-3" />
                  Lua Active
                </span>
              )}
              {game.isLuaDisabled && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3 py-1 text-[10px] text-zinc-300">
                  <ShieldOff className="h-3 w-3" />
                  Lua Disabled
                </span>
              )}
              {game.hasLuaSource && !game.hasLua && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] text-emerald-300">
                  <Download className="h-3 w-3" />
                  Lua Ready
                </span>
              )}
              {game.hasUpdate && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] text-yellow-300">
                  <RefreshCcw className="h-3 w-3" />
                  Update Available
                </span>
              )}
            </div>

            <h1 className="line-clamp-1 text-2xl font-black text-white drop-shadow-sm lg:text-3xl">
              {game.title}
            </h1>

            {game.metadata?.developer && (
              <p className="mt-1 text-sm text-white/70">{game.metadata.developer}</p>
            )}
          </div>
        </div>
      </div>

      {/* Compact action/stats row */}
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Play / Install button */}
            <div className="shrink-0">
              {action === "play" && (
                <button
                  type="button"
                  onClick={() => onPlay(game)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <Play className="h-4 w-4" />
                  Play
                </button>
              )}
              {action === "install" && (
                <button
                  type="button"
                  onClick={() => onInstall(game)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <Download className="h-4 w-4" />
                  Install
                </button>
              )}
              {action === "missing-path" && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300">
                  Missing Path
                </span>
              )}
            </div>

            {/* Inline stats */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              <StatInline icon={<Cloud className="h-5 w-5" />} label="Cloud Status" value="Not tracked" />
              <StatInline icon={<Clock className="h-5 w-5" />} label="Last Played" value="Never" />
              <StatInline icon={<Trophy className="h-5 w-5" />} label="Play Time" value="Not tracked" />
              <StatInline icon={<HardDrive className="h-5 w-5" />} label="Size" value={formatBytes(game.sizeOnDisk)} />
              <StatInline icon={<Star className="h-5 w-5" />} label="Achievements" value="Unavailable" />
            </div>

            {/* Right side: Actions + Favorite */}
            <div className="flex items-center gap-1">
              {/* Actions dropdown */}
              <div className="relative" ref={actionsRef}>
                <button
                  type="button"
                  onClick={() => setShowActions(!showActions)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Actions</span>
                </button>

                {showActions && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowActions(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-xl border border-(--surface-active-border) bg-(--color-bg) p-1 shadow-lg">
                      {game.isPlayable && (
                        <DropdownItem
                          label="Uninstall Game"
                          disabled
                          subtitle="Coming soon"
                        />
                      )}
                      {script && onDeleteScript && (
                        <DropdownItem
                          label="Delete Lua"
                          onClick={() => {
                            setShowActions(false);
                            onDeleteScript(game);
                          }}
                        />
                      )}
                      {(!script || !onDeleteScript) && (
                        <DropdownItem
                          label="Delete Lua"
                          disabled={!script}
                          subtitle={!script ? "No Lua script" : undefined}
                        />
                      )}
                      <div className="border-t border-(--surface-active-border) my-1" />
                      <DropdownItem
                        label="Close"
                        onClick={() => setShowActions(false)}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Favorite button */}
              <button
                type="button"
                onClick={() => setFavorite(!favorite)}
                className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs transition hover:bg-white/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                title={favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  className={`h-3.5 w-3.5 ${favorite ? "text-yellow-400" : "text-(--color-muted)"}`}
                  fill={favorite ? "currentColor" : "none"}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content: two columns */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:py-8">
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
            {/* Left: Overview */}
            <div className="min-w-0 space-y-8">
              {/* Short intro */}
              {shortIntro && (
                <p className="text-sm leading-relaxed text-(--color-text)/80">
                  {shortIntro}
                </p>
              )}

              {/* About This Game (only if longer than short intro) */}
              {longDescText && !descriptionsMatch && (
                <section>
                  <h2 className="mb-3 text-base font-bold text-(--color-text)">
                    <BookOpen className="mr-2 inline h-4 w-4 text-(--color-accent)" />
                    About This Game
                  </h2>
                  <div className="space-y-3">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-(--color-text)/70">
                      {displayedDescription}
                    </p>
                    {hasLongDescription && (
                      <button
                        type="button"
                        onClick={() => setShowFullDescription(!showFullDescription)}
                        className="cursor-pointer text-xs font-medium text-(--color-accent) transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                      >
                        {showFullDescription ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {!shortIntro && !longDescText && (
                <p className="text-sm text-(--color-muted)">
                  Game description is not available yet.
                </p>
              )}

              {/* Genres & Categories */}
              {(genres.length > 0 || categories.length > 0) && (
                <section>
                  <h2 className="mb-3 text-base font-bold text-(--color-text)">
                    <Star className="mr-2 inline h-4 w-4 text-(--color-accent)" />
                    Features
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {genres.map((genre) => (
                      <span
                        key={genre}
                        className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-[10px] text-(--color-text)/70"
                      >
                        {genre}
                      </span>
                    ))}
                    {categories.map((cat) => (
                      <span
                        key={cat}
                        className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/5 px-3 py-1 text-[10px] text-(--color-accent)/80"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Release date */}
              {game.metadata?.release_date && (
                <section>
                  <h2 className="mb-3 text-base font-bold text-(--color-text)">
                    Release Date
                  </h2>
                  <p className="text-sm text-(--color-text)/70">
                    {game.metadata.release_date}
                  </p>
                </section>
              )}
            </div>

            {/* Right: Side panel */}
            <aside className="mt-8 lg:mt-0">
              <div className="sticky top-4 space-y-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  Links
                </h3>
                <div className="space-y-1">
                  <ShortcutRow
                    icon={<ExternalLink className="h-3.5 w-3.5" />}
                    label="Store Page"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum && onOpenSteam) onOpenSteam(game);
                      else if (appIdNum) openExternalUrl(getSteamStoreUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<Puzzle className="h-3.5 w-3.5" />}
                    label="DLC"
                    subtitle={
                      game.metadata && game.metadata.dlc_count > 0
                        ? `${game.metadata.dlc_count} available`
                        : undefined
                    }
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamStoreUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    label="Community Hub"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamCommunityUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    label="Discussions"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamDiscussionsUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<BookMarked className="h-3.5 w-3.5" />}
                    label="Guides"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamGuidesUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<LifeBuoy className="h-3.5 w-3.5" />}
                    label="Support"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamSupportUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<Database className="h-3.5 w-3.5" />}
                    label="SteamDB"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum && onOpenSteamDb) onOpenSteamDb(game);
                      else if (appIdNum) openExternalUrl(getSteamDbUrl(appIdNum));
                    }}
                  />
                </div>
              </div>

              {/* Lua section */}
              {(script || game.hasLua || game.hasLuaSource) && (
                <div className="mt-4 space-y-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                  <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                    <FileCode2 className="mr-1.5 inline h-3.5 w-3.5" />
                    Lua
                  </h3>
                  <div className="space-y-2">
                    {script && (
                      <>
                        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                          <p className="text-[10px] text-(--color-muted)">Script</p>
                          <p className="mt-0.5 text-xs font-medium text-(--color-text)">
                            {script.file_name}
                          </p>
                        </div>
                        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                          <p className="text-[10px] text-(--color-muted)">Status</p>
                          <p className="mt-0.5 text-xs text-(--color-text)">
                            {game.isLuaDisabled ? "Disabled" : "Active"}
                          </p>
                        </div>
                      </>
                    )}
                    {!script && game.hasLuaSource && (
                      <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                        <p className="text-[10px] text-(--color-muted)">Source</p>
                        <p className="mt-0.5 text-xs text-(--color-text)">
                          Available — sync to install
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* App ID */}
              {game.appId && (
                <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                  <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                    App ID
                  </h3>
                  <p className="mt-1 text-sm font-mono text-(--color-text)">
                    {game.appId}
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

type ShortcutRowProps = {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  enabled: boolean;
  onClick: () => void;
};

function ShortcutRow({ icon, label, subtitle, enabled, onClick }: ShortcutRowProps) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition ${
        enabled
          ? "cursor-pointer text-(--color-text) hover:bg-white/5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          : "cursor-not-allowed text-(--color-muted)/40"
      }`}
    >
      <span className="shrink-0 text-(--color-muted)">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {subtitle && (
        <span className="shrink-0 text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}

function DropdownItem({
  label,
  subtitle,
  disabled,
  onClick,
}: {
  label: string;
  subtitle?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}
