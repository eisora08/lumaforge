import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AsyncImage from "../common/AsyncImage";
import {
  CheckCircle2,
  CircleX,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileText,
  Gamepad2,
  KeyRound,
  X,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import { getSteamDbUrl, getSteamStoreUrl } from "../../utils/steamLinks";
import { openExternalUrl } from "../../services/externalLinks";
import { getBestAvailableSource, getSourceKey } from "../../utils/sourceHelpers";

type StoreSourceSelectorModalProps = {
  open: boolean;
  game: PackageGame | null;
  selectedSource?: PackageSource;
  onClose: () => void;
  onSelectSource?: (sourceKey: string) => void;
  onDownloadSource?: (source: PackageSource) => void;
  onOpenDetails?: (game: PackageGame) => void;
};

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function getSourceStatus(source: PackageSource, t: (key: string, fallback: string) => string) {
  if (source.available) {
    return {
      label: t("store.sourceSelector.ready", "Ready"),
      className: "text-(--color-success)",
      icon: CheckCircle2,
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: t("store.sourceSelector.needs_api_key", "Needs API key"),
      className: "text-(--color-warning)",
      icon: KeyRound,
    };
  }

  return {
    label: t("store.sourceSelector.unavailable", "Unavailable"),
    className: "text-(--color-destructive)",
    icon: CircleX,
  };
}

function SourceRow({
  source,
  isSelected,
  onSelect,
  t,
}: {
  source: PackageSource;
  isSelected: boolean;
  onSelect: (sourceKey: string) => void;
  t: (key: string, fallback: string) => string;
}) {
  const sourceKey = getSourceKey(source);

  const FileIcon = getFileIcon(source.fileType);
  const status = getSourceStatus(source, t);
  const StatusIcon = status.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(sourceKey)}
      className={`w-full rounded-xl border p-3.5 text-left transition ${
        isSelected
          ? "border-(--color-accent) bg-(--color-accent)/10"
          : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-4 w-4 ${status.className}`} />
            <span className="font-medium text-(--color-text)">
              {source.providerName}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-(--color-muted)">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5">
              <FileIcon className="h-3 w-3" />
              .{source.fileType}
            </span>

            <span className={status.className}>
              {status.label}
            </span>

            {source.requiresApiKey && !source.hasAuth && (
              <span className="text-(--color-warning)/70">
                {t("store.sourceSelector.api_key_required", "API key required")}
              </span>
            )}
          </div>
        </div>

        {isSelected && (
          <span className="mt-0.5">
            <CheckCircle2 className="h-5 w-5 text-(--color-accent)" />
          </span>
        )}
      </div>
    </button>
  );
}

export default function StoreSourceSelectorModal({
  open,
  game,
  selectedSource,
  onClose,
  onSelectSource,
  onDownloadSource,
  onOpenDetails,
}: StoreSourceSelectorModalProps) {
  const { t } = useTranslation();

  if (!open || !game) return null;

  const providerSources = game.sources;

  const bestSource = getBestAvailableSource({ ...game, sources: providerSources });
  const initialKey = selectedSource
    ? getSourceKey(selectedSource)
    : bestSource
      ? getSourceKey(bestSource)
      : null;

  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);

  useEffect(() => {
    setSelectedKey(initialKey);
  }, [game?.appId, initialKey]);

  const selectedSourceForDownload = selectedKey
    ? game.sources.find((s) => getSourceKey(s) === selectedKey)
    : null;

  function getDownloadLabel() {
    if (!selectedSourceForDownload) return t("store.sourceSelector.download", "Download");
    if (selectedSourceForDownload.fileType === "lua") return t("store.sourceSelector.download_lua", "Download Lua");
    if (selectedSourceForDownload.fileType === "zip") return t("store.sourceSelector.download_package", "Download Package");
    return t("store.sourceSelector.download", "Download");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="lf-surface w-full max-w-lg overflow-hidden rounded-3xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
              <AsyncImage
                src={game.imageUrl}
                alt={game.title}
                className="h-full w-full"
                fallback={
                  <div className="flex h-14 w-14 items-center justify-center">
                    <Gamepad2 className="h-6 w-6 text-(--color-muted)" />
                  </div>
                }
              />
            </div>

            <div className="min-w-0">
              <h2 className="line-clamp-1 text-lg font-bold text-(--color-text)">
                {game.title}
              </h2>

              <p className="mt-0.5 text-sm text-(--color-muted)">
                {t("store.sourceSelector.app_id", "AppID")} {game.appId}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto border-t border-(--surface-active-border) px-5 py-4 lf-scroll-area">
          {providerSources.length === 0 ? (
            <p className="py-6 text-center text-sm text-(--color-muted)">
              {t("store.sourceSelector.no_sources_available", "No sources available for this game.")}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-muted)">
                {t("store.sourceSelector.providers", "Providers")}
              </p>
              {providerSources.map((source) => (
                <SourceRow
                  key={getSourceKey(source)}
                  source={source}
                  isSelected={selectedKey === getSourceKey(source)}
                  onSelect={(sourceKey) => {
                    setSelectedKey(sourceKey);
                    onSelectSource?.(sourceKey);
                  }}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-(--surface-active-border) p-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenDetails?.(game);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            {t("store.sourceSelector.details", "Details")}
          </button>

          <button
            type="button"
            disabled={!selectedSourceForDownload?.available}
            onClick={() => {
              if (selectedSourceForDownload) {
                onDownloadSource?.(selectedSourceForDownload);
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {getDownloadLabel()}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                openExternalUrl(getSteamStoreUrl(Number(game.appId)))
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Steam
            </button>

            <button
              type="button"
              onClick={() =>
                openExternalUrl(getSteamDbUrl(Number(game.appId)))
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <Database className="h-3.5 w-3.5" />
              SteamDB
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
