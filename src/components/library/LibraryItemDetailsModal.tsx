import { useState } from "react";
import type { ElementType } from "react";

import {
  Database,
  ExternalLink,
  FileCode2,
  Gamepad2,
  Languages,
  Package,
  Power,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";

import type { InstalledLuaScript } from "../../types/installedLua";
import type { SteamAppMetadata } from "../../types/gameMetadata";

type LibraryItemDetailsModalProps = {
  open: boolean;
  script: InstalledLuaScript | null;
  metadata?: SteamAppMetadata;
  onClose: () => void;
  onToggle: (script: InstalledLuaScript) => void;
  onDelete: (script: InstalledLuaScript) => void;
  onOpenSteamStore: (script: InstalledLuaScript) => void;
  onOpenSteamDb: (script: InstalledLuaScript) => void;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(seconds: number) {
  if (!seconds) return "No disponible";

  return new Date(seconds * 1000).toLocaleString();
}

function getFallbackHeaderImageUrl(appId: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

function getBestCoverUrl(appId: number, metadata?: SteamAppMetadata) {
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    getFallbackHeaderImageUrl(appId)
  );
}

function getInitials(title: string) {
  return title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export default function LibraryItemDetailsModal({
  open,
  script,
  metadata,
  onClose,
  onToggle,
  onDelete,
  onOpenSteamStore,
  onOpenSteamDb,
}: LibraryItemDetailsModalProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!open || !script) {
    return null;
  }

  const title = metadata?.name || `Steam App ${script.app_id}`;
  const developer = metadata?.developer || "Developer unknown";
  const coverUrl = getBestCoverUrl(script.app_id, metadata);
  const initials = getInitials(title);

  const statusLabel = script.is_disabled ? "Disabled" : "Active";
  const updateLabel = script.is_disabled ? "Deshabilitado" : "No verificado";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="lf-surface max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl border">
        <div className="relative h-56 overflow-hidden bg-white/5">
          {!imageFailed ? (
            <img
              src={coverUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-white/10 via-white/5 to-black/50">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-black/30">
                  {initials ? (
                    <span className="text-lg font-bold text-white/80">
                      {initials}
                    </span>
                  ) : (
                    <Gamepad2 className="h-8 w-8 text-white/40" />
                  )}
                </div>

                <p className="mt-3 text-xs text-white/45">
                  AppID {script.app_id}
                </p>
              </div>
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-transparent" />

          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute bottom-5 left-5 right-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {script.is_disabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3 py-1 text-xs text-zinc-300">
                  <ShieldOff className="h-3.5 w-3.5" />
                  Disabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Active
                </span>
              )}

              <span className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                AppID {script.app_id}
              </span>
            </div>

            <h2 className="line-clamp-1 text-3xl font-bold text-white">
              {title}
            </h2>

            <p className="mt-1 text-sm text-white/70">
              {developer}
            </p>
          </div>
        </div>

        <div className="max-h-[calc(90vh-14rem)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
            <section className="space-y-5">
              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Información del juego
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBox label="Nombre" value={title} />
                  <InfoBox label="AppID" value={String(script.app_id)} />
                  <InfoBox label="Developer" value={developer} />
                  <InfoBox
                    label="DLC Content"
                    value={
                      metadata?.dlc_count
                        ? `${metadata.dlc_count} DLC(s) detectado(s)`
                        : "No detectado"
                    }
                  />
                </div>

                {metadata?.platforms?.length ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--color-muted)">
                      Platforms
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {metadata.platforms.map((platform) => (
                        <span
                          key={platform}
                          className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-xs text-(--color-muted)"
                        >
                          {platform}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {metadata?.languages?.length ? (
                  <div className="mt-4">
                    <p className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--color-muted)">
                      <Languages className="h-3.5 w-3.5" />
                      Languages
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {metadata.languages.map((language) => (
                        <span
                          key={language}
                          className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-xs text-(--color-muted)"
                        >
                          {language}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Archivo Lua
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBox label="Archivo" value={script.file_name} />
                  <InfoBox label="Tamaño" value={formatBytes(script.file_size)} />
                  <InfoBox
                    label="Modificado"
                    value={formatDate(script.modified_at)}
                  />
                  <InfoBox label="Estado de update" value={updateLabel} />
                </div>

                <div className="mt-3 rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">
                    Ruta completa
                  </p>

                  <p className="mt-1 break-all text-sm font-medium text-(--color-text)">
                    {script.path}
                  </p>
                </div>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Acciones
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenSteamStore(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir Steam
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSteamDb(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <Database className="h-4 w-4" />
                    Abrir SteamDB
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggle(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <Power className="h-4 w-4" />
                    {script.is_disabled ? "Activar Lua" : "Deshabilitar Lua"}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 transition hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar Lua
                  </button>
                </div>
              </div>

              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Resumen
                </h3>

                <div className="mt-4 space-y-3">
                  <SummaryLine
                    icon={FileCode2}
                    label="Lua"
                    value={script.file_name}
                  />

                  <SummaryLine
                    icon={Package}
                    label="Estado"
                    value={statusLabel}
                  />

                  <SummaryLine
                    icon={Package}
                    label="Update"
                    value={updateLabel}
                  />
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

type InfoBoxProps = {
  label: string;
  value: string;
};

function InfoBox({ label, value }: InfoBoxProps) {
  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
      <p className="text-xs text-(--color-muted)">
        {label}
      </p>

      <p className="mt-1 break-all text-sm font-medium text-(--color-text)">
        {value}
      </p>
    </div>
  );
}

type SummaryLineProps = {
  icon: ElementType;
  label: string;
  value: string;
};

function SummaryLine({
  icon: Icon,
  label,
  value,
}: SummaryLineProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
      <Icon className="h-4 w-4 text-(--color-accent)" />

      <div className="min-w-0">
        <p className="text-xs text-(--color-muted)">
          {label}
        </p>

        <p className="truncate text-sm font-medium text-(--color-text)">
          {value}
        </p>
      </div>
    </div>
  );
}