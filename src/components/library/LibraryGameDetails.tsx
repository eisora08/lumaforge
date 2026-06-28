import { useState } from "react";
import {
  ArrowLeft,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  Gamepad2,
  Play,
  Power,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";

type LibraryGameDetailsProps = {
  game: LibraryGame;
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

function getImageUrl(game: LibraryGame): string | undefined {
  return game.imageUrl || game.metadata?.header_image || game.metadata?.capsule_image || game.metadata?.capsule_image_v5 || undefined;
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

function formatTimestamp(ts?: number): string {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleDateString();
}

export default function LibraryGameDetails({
  game,
  onPlay,
  onInstall,
  onSync,
  onToggleScript,
  onDeleteScript,
  onOpenSteam,
  onOpenSteamDb,
  onOpenSourceSelector,
  onBack,
}: LibraryGameDetailsProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = getImageUrl(game);
  const script = game.luaScripts[0];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back button */}
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02] px-5 py-3 lg:px-7">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-(--color-muted) transition hover:text-(--color-text)"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Library
        </button>
      </div>

      {/* Hero image */}
      <div className="relative h-48 shrink-0 overflow-hidden bg-white/5 lg:h-64">
        {imageUrl && !imageFailed ? (
          <img
            src={imageUrl}
            alt={game.title}
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-white/10 via-white/5 to-black/50">
            <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/40 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-7">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {game.steamInstalled && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Installed
              </span>
            )}
            {game.isLuaActive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                <FileCode2 className="h-3.5 w-3.5" />
                Lua Active
              </span>
            )}
            {game.isLuaDisabled && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3 py-1 text-xs text-zinc-300">
                <ShieldOff className="h-3.5 w-3.5" />
                Lua Disabled
              </span>
            )}
            {game.hasLuaSource && !game.hasLua && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <Download className="h-3.5 w-3.5" />
                Lua Ready
              </span>
            )}
            {game.hasUpdate && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300">
                <RefreshCcw className="h-3.5 w-3.5" />
                Update Available
              </span>
            )}
          </div>

          <h1 className="line-clamp-1 text-2xl font-black text-white lg:text-3xl">
            {game.title}
          </h1>

          {game.metadata?.developer && (
            <p className="mt-1 text-sm text-white/70">{game.metadata.developer}</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6 p-5 lg:p-7">
        {/* Main actions */}
        <div className="flex flex-wrap gap-2">
          {game.isPlayable ? (
            <button
              type="button"
              onClick={() => onPlay(game)}
              className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              <Play className="h-4 w-4" />
              Play
            </button>
          ) : game.isInstallable ? (
            <button
              type="button"
              onClick={() => onInstall(game)}
              className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-bold text-black transition hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Install
            </button>
          ) : null}

          {game.hasLuaSource && onSync && (
            <button
              type="button"
              onClick={() => onSync(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
            >
              <RefreshCcw className="h-4 w-4" />
              Sync Lua
            </button>
          )}

          {onOpenSourceSelector && (
            <button
              type="button"
              onClick={() => onOpenSourceSelector(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
            >
              <Download className="h-4 w-4" />
              Manage Source
            </button>
          )}

          {onOpenSteam && game.appId && (
            <button
              type="button"
              onClick={() => onOpenSteam(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" />
              Open Steam
            </button>
          )}
        </div>

        {/* Secondary actions */}
        <div className="flex flex-wrap gap-2">
          {script && onToggleScript && (
            <button
              type="button"
              onClick={() => onToggleScript(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <Power className="h-3.5 w-3.5" />
              {game.isLuaDisabled ? "Enable Lua" : "Disable Lua"}
            </button>
          )}

          {onOpenSteamDb && game.appId && (
            <button
              type="button"
              onClick={() => onOpenSteamDb(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <Database className="h-3.5 w-3.5" />
              Open SteamDB
            </button>
          )}

          {script && onDeleteScript && (
            <button
              type="button"
              onClick={() => onDeleteScript(game)}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/15"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Lua
            </button>
          )}
        </div>

        {/* Info sections */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
              <Gamepad2 className="h-4 w-4 text-(--color-accent)" />
              Info
            </h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                <p className="text-xs text-(--color-muted)">Source</p>
                <p className="mt-1 text-sm text-(--color-text)">
                  {game.source === "steam" ? "Steam" : game.source === "local" ? "Local EXE" : "Lua"}
                </p>
              </div>

              {game.sizeOnDisk != null && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">Storage</p>
                  <p className="mt-1 text-sm text-(--color-text)">
                    {formatBytes(game.sizeOnDisk)}
                  </p>
                </div>
              )}

              {game.lastUpdated != null && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">Last Updated</p>
                  <p className="mt-1 text-sm text-(--color-text)">
                    {formatTimestamp(game.lastUpdated)}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <h3 className="flex items-center gap-2 font-semibold text-(--color-text)">
              <FileCode2 className="h-4 w-4 text-(--color-accent)" />
              Lua Status
            </h3>
            <div className="mt-4 space-y-3">
              {script ? (
                <>
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                    <p className="text-xs text-(--color-muted)">Script File</p>
                    <p className="mt-1 break-all text-sm font-medium text-(--color-text)">
                      {script.file_name}
                    </p>
                  </div>

                  <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                    <p className="text-xs text-(--color-muted)">Status</p>
                    <p className="mt-1 text-sm text-(--color-text)">
                      {game.isLuaDisabled ? "Disabled" : "Active"}
                    </p>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">Lua</p>
                  <p className="mt-1 text-sm text-(--color-text)">
                    {game.hasLuaSource ? "Source available — sync to install" : "No Lua script installed"}
                  </p>
                </div>
              )}

              {game.appId && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">App ID</p>
                  <p className="mt-1 text-sm text-(--color-text)">
                    {game.appId}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
