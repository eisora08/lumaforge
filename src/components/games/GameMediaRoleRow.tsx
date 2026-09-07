import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  Upload,
  Link,
  Trash2,
  Check,
  FolderOpen,
  Globe,
  Image,
  Search as SearchIcon,
  ChevronDown,
  Eye,
} from "lucide-react";

// ── Shared sub-component (also used by GameEditDialog general tab) ──

export function SourceOption({
  label,
  icon: Icon,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : "cursor-pointer text-(--color-text) hover:bg-white/[0.06]"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-(--color-muted)/50">{hint}</span>}
    </button>
  );
}

// ── Types ──

export type GameMediaRoleRowProps = {
  label: string;
  icon: LucideIcon;
  desc: string;
  previewUrl: string | null;
  previewStatus: "set" | "missing" | "unset" | "loading";
  currentPath: string | null;
  saving: boolean;
  urlExpanded: boolean;
  browseOpen: boolean;
  isBrowsing: boolean;
  urlValue: string;
  isManual?: boolean;
  sourceAvailability: {
    sgdb: boolean;
    igdb: boolean;
    rawg: boolean;
    steam: boolean;
  };
  onChooseLocalFile: (file: File) => void;
  onToggleUrl: () => void;
  onUrlChange: (value: string) => void;
  onUrlSubmit: () => void;
  onToggleBrowse: () => void;
  onSourcePick: (sourceId: string) => void;
  onOpenWebSearch: () => void;
  onRemove: () => void;
  onPreviewClick?: () => void;
  onPreviewError?: () => void;
};

// ── Component ──

export default function GameMediaRoleRow({
  label,
  icon: RoleIcon,
  desc,
  previewUrl,
  previewStatus,
  currentPath,
  saving,
  urlExpanded,
  browseOpen,
  isBrowsing,
  urlValue,
  isManual,
  sourceAvailability,
  onChooseLocalFile,
  onToggleUrl,
  onUrlChange,
  onUrlSubmit,
  onToggleBrowse,
  onSourcePick,
  onOpenWebSearch,
  onRemove,
  onPreviewClick,
  onPreviewError,
}: GameMediaRoleRowProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevBrowseOpenRef = useRef(browseOpen);

  useEffect(() => {
    if (browseOpen && !prevBrowseOpenRef.current && dropdownRef.current) {
      requestAnimationFrame(() => {
        dropdownRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
    }
    prevBrowseOpenRef.current = browseOpen;
  }, [browseOpen]);

  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
      {/* Header row */}
      <div className="flex items-start gap-4">
        {/* Preview thumbnail */}
        <div className="group relative flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt={label}
                className="h-full w-full object-cover"
                onError={onPreviewError}
              />
              {onPreviewClick && (
                <button
                  type="button"
                  onClick={onPreviewClick}
                  className="absolute top-1 right-1 rounded-md bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition"
                >
                  <Eye className="h-3 w-3 text-white" />
                </button>
              )}
            </>
          ) : (
            <RoleIcon className="h-8 w-8 text-(--color-muted)/40" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-(--color-text)">{label}</span>
            {previewStatus === "set" ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                {t("game_edit.status_set", "Set")}
              </span>
            ) : previewStatus === "missing" ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {t("game_edit.status_missing", "Missing")}
              </span>
            ) : previewStatus === "loading" ? (
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {t("game_edit.status_checking", "Checking…")}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                {t("game_edit.status_unset", "Unset")}
              </span>
            )}
          </div>
          {desc && (
            <p className="mt-0.5 text-[11px] text-(--color-muted)/60">{desc}</p>
          )}
          {currentPath && (
            <p className="mt-0.5 truncate text-[11px] text-(--color-muted)">{currentPath}</p>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={() => {
          const file = fileInputRef.current?.files?.[0];
          if (file) onChooseLocalFile(file);
        }}
      />

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={saving}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {t("game_edit.choose_file", "Choose File")}
        </button>
        <button
          type="button"
          onClick={onToggleUrl}
          disabled={saving}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
        >
          <Link className="h-3.5 w-3.5" />
          {t("game_edit.set_url", "Set URL")}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={onToggleBrowse}
            disabled={saving || isBrowsing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${browseOpen ? "rotate-180" : ""}`} />
            {isBrowsing ? t("game_edit.fetching", "Fetching...") : t("game_edit.browse", "Browse")}
          </button>
          {browseOpen && (
            <div ref={dropdownRef} className="lf-dropdown-menu absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-(--surface-active-border) bg-(--surface-active) py-1 shadow-lg backdrop-blur-md">
              <SourceOption
                label={t("game_edit.source_local", "Current Local")}
                icon={FolderOpen}
                disabled={!currentPath}
                onClick={() => onSourcePick("local")}
              />
              <SourceOption
                label="SteamGridDB"
                icon={Image}
                disabled={!sourceAvailability.sgdb}
                hint={!sourceAvailability.sgdb
                  ? t("game_edit.api_key_not_configured", "API key not configured")
                  : isManual && !sourceAvailability.steam
                    ? t("game_edit.search_by_name", "Search by game name")
                    : undefined}
                onClick={() => onSourcePick("sgdb")}
              />
              <SourceOption
                label={t("game_edit.source_steam", "Steam Official Assets")}
                icon={Globe}
                disabled={!sourceAvailability.steam}
                hint={!sourceAvailability.steam ? (isManual ? t("game_edit.link_steam_appid_first", "Link a Steam App ID first") : t("game_edit.no_metadata", "No metadata")) : undefined}
                onClick={() => onSourcePick("steam")}
              />
              {sourceAvailability.igdb && (
                <SourceOption
                  label="IGDB"
                  icon={Image}
                  onClick={() => onSourcePick("igdb")}
                />
              )}
              {!isManual && sourceAvailability.rawg && (
                <SourceOption
                  label="RAWG"
                  icon={Image}
                  onClick={() => onSourcePick("rawg")}
                />
              )}
              <div className="my-1 border-t border-(--surface-active-border)" />
              <SourceOption
                label={t("game_edit.source_web_search", "Web Search")}
                icon={SearchIcon}
                onClick={onOpenWebSearch}
              />
              <SourceOption
                label="URL"
                icon={Link}
                onClick={() => onSourcePick("url")}
              />
              <SourceOption
                label={t("game_edit.source_local_file", "Local File")}
                icon={Upload}
                onClick={() => onSourcePick("file")}
              />
            </div>
          )}
        </div>
        {currentPath && (
          <button
            type="button"
            onClick={onRemove}
            disabled={saving}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("game_edit.remove", "Remove")}
          </button>
        )}
      </div>

      {/* URL input (expandable) */}
      {urlExpanded && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={urlValue}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="flex-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
          />
          <button
            type="button"
            onClick={onUrlSubmit}
            disabled={saving || !urlValue.trim()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {t("game_edit.download", "Download")}
          </button>
        </div>
      )}
    </div>
  );
}
