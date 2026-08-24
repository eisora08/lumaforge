import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Database,
  ExternalLink,
  Gamepad2,
  Languages,
  Power,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";

import type { InstalledLuaScript } from "../../types/installedLua";
import type { SteamAppMetadata } from "../../types/gameMetadata";

import LuaUpdateBadge from "./LuaUpdateBadge";
import type { LuaUpdateInfo } from "../../types/luaUpdate";
import { getLuaUpdateInfo } from "../../utils/luaUpdateStatus";

type LibraryItemDetailsModalProps = {
  open: boolean;
  script: InstalledLuaScript | null;
  metadata?: SteamAppMetadata;
  updateInfo?: LuaUpdateInfo;
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

function formatDate(seconds: number, t: (key: string, fallback: string) => string) {
  if (!seconds) return t("library_item_details.no_date", "No disponible");

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
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  if (!open || !script) {
    return null;
  }

  const title = metadata?.name || `Steam App ${script.app_id}`;
  const developer = metadata?.developer || t("library_item_details.developer_unknown", "Developer unknown");
  const coverUrl = getBestCoverUrl(script.app_id, metadata);
  const initials = getInitials(title);
  const updateInfo = getLuaUpdateInfo(script);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
                  {t("library_item_details.appid", "AppID")} {script.app_id}
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
                  {t("library_item_details.disabled", "Disabled")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("library_item_details.active", "Active")}
                </span>
              )}

              <span className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                {t("library_item_details.appid", "AppID")} {script.app_id}
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
                  {t("library_item_details.game_info", "Información del juego")}
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBox label={t("library_item_details.name", "Nombre")} value={title} />
                  <InfoBox label={t("library_item_details.appid", "AppID")} value={String(script.app_id)} />
                  <InfoBox label="Developer" value={developer} />
                  <InfoBox
                    label={t("library_item_details.dlc_content", "DLC Content")}
                    value={
                      metadata?.dlc_count
                        ? `${metadata.dlc_count} DLC(s) detectado(s)`
                        : t("library_item_details.not_detected", "No detectado")
                    }
                  />
                </div>

                {metadata?.platforms?.length ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-(--color-muted)">
                      {t("library_item_details.platforms", "Platforms")}
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
                      {t("library_item_details.languages", "Languages")}
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
                  {t("library_item_details.lua_file", "Archivo Lua")}
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBox label={t("library_item_details.file", "Archivo")} value={script.file_name} />
                  <InfoBox label={t("library_item_details.size", "Tamaño")} value={formatBytes(script.file_size)} />
                  <InfoBox
                    label={t("library_item_details.modified", "Modificado")}
                    value={formatDate(script.modified_at, t)}
                  />
                  <InfoBox label={t("library_item_details.update_status", "Estado de update")} value={updateInfo.label} />
                </div>

                <div className="mt-3 rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                  <p className="text-xs text-(--color-muted)">
                    {t("library_item_details.full_path", "Ruta completa")}
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
                  {t("library_item_details.actions", "Acciones")}
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenSteamStore(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("library_item_details.open_steam", "Abrir Steam")}
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenSteamDb(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <Database className="h-4 w-4" />
                    {t("library_item_details.open_steamdb", "Abrir SteamDB")}
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggle(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <Power className="h-4 w-4" />
                    {script.is_disabled ? t("library_item_details.enable_lua", "Activar Lua") : t("library_item_details.disable_lua", "Deshabilitar Lua")}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete(script)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 transition hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("library_item_details.delete_lua", "Eliminar Lua")}
                  </button>
                </div>
              </div>

              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  {t("library_item_details.summary", "Resumen")}
                </h3>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
                    <p className="mb-2 text-xs text-(--color-muted)">
                      {t("library_item_details.update", "Update")}
                    </p>

                    <LuaUpdateBadge info={updateInfo} />

                    <p className="mt-2 text-xs text-(--color-muted)">
                      {updateInfo.description}
                    </p>
                  </div>
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


