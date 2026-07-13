import { useRef } from "react";
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
          : "cursor-pointer text-(--color-text) hover:bg-white/5"
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
  sourceAvailability,
  onChooseLocalFile,
  onToggleUrl,
  onUrlChange,
  onUrlSubmit,
  onToggleBrowse,
  onSourcePick,
  onOpenWebSearch,
  onRemove,
  onPreviewError,
}: GameMediaRoleRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
      {/* Header row */}
      <div className="flex items-start gap-4">
        {/* Preview thumbnail */}
        <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={label}
              className="h-full w-full object-cover"
              onError={onPreviewError}
            />
          ) : (
            <RoleIcon className="h-8 w-8 text-(--color-muted)/40" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-(--color-text)">{label}</span>
            {previewStatus === "set" ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                Set
              </span>
            ) : previewStatus === "missing" ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Missing
              </span>
            ) : previewStatus === "loading" ? (
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                Checking…
              </span>
            ) : (
              <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                Unset
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
          Choose File
        </button>
        <button
          type="button"
          onClick={onToggleUrl}
          disabled={saving}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
        >
          <Link className="h-3.5 w-3.5" />
          Set URL
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={onToggleBrowse}
            disabled={saving || isBrowsing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {isBrowsing ? "Fetching..." : "Browse"}
          </button>
          {browseOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-52 rounded-xl border border-(--color-border) bg-(--color-bg) py-1 shadow-xl">
              <SourceOption
                label="Current Local"
                icon={FolderOpen}
                disabled={!currentPath}
                onClick={() => onSourcePick("local")}
              />
              <SourceOption
                label="Steam Original Assets"
                icon={Globe}
                disabled={!sourceAvailability.steam}
                hint={!sourceAvailability.steam ? "No metadata" : undefined}
                onClick={() => onSourcePick("steam")}
              />
              <SourceOption
                label="SteamGridDB"
                icon={Image}
                disabled={!sourceAvailability.sgdb}
                hint={!sourceAvailability.sgdb ? "Not configured" : undefined}
                onClick={() => onSourcePick("sgdb")}
              />
              <SourceOption
                label="IGDB"
                icon={Image}
                disabled={!sourceAvailability.igdb}
                hint={!sourceAvailability.igdb ? "Configure in Settings" : undefined}
                onClick={() => onSourcePick("igdb")}
              />
              <SourceOption
                label="RAWG"
                icon={Image}
                disabled={!sourceAvailability.rawg}
                hint={!sourceAvailability.rawg ? "Configure in Settings" : undefined}
                onClick={() => onSourcePick("rawg")}
              />
              <div className="my-1 border-t border-(--color-border)" />
              <SourceOption
                label="Web Search"
                icon={SearchIcon}
                onClick={onOpenWebSearch}
              />
              <SourceOption
                label="URL"
                icon={Link}
                onClick={() => onSourcePick("url")}
              />
              <SourceOption
                label="Local File"
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
            Remove
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
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      )}
    </div>
  );
}
