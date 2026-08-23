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
  PauseCircle,
  RefreshCcw,
  ShieldQuestion,
  X,
} from "lucide-react";

import { PackageGame, PackageSource } from "../../types/package";
import { PackageInstallStatus } from "../../types/packageInstall";
import { getSteamDbUrl, getSteamStoreUrl } from "../../utils/steamLinks";
import { openExternalUrl } from "../../services/externalLinks";



type PackageDetailsModalProps = {
  game: PackageGame;
  installStatus: PackageInstallStatus;
  selectedSource?: PackageSource;
  open: boolean;
  rechecking?: boolean;
  onClose: () => void;
  onSelectSource: (sourceKey: string) => void;
  onDownload: () => void;
  onRecheckSources: (appId: string) => void;
};



function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function getInstallStatusLabel(status: PackageInstallStatus) {
  if (status === "active") {
    return {
      label: "Installed",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
      icon: CheckCircle2,
    };
  }

  if (status === "disabled") {
    return {
      label: "Disabled",
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
      icon: PauseCircle,
    };
  }

  return {
    label: "Not installed",
    className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
    icon: CircleX,
  };
}

function getFriendlySourceStatus(source: PackageSource) {
  if (source.available) {
    return {
      label: "Disponible",
      description: "Esta fuente está lista para descargar.",
      icon: CheckCircle2,
      className: "text-emerald-300",
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: "Requiere API key",
      description: "Configura tu API key para usar esta fuente.",
      icon: KeyRound,
      className: "text-yellow-300",
    };
  }

  return {
    label: "No disponible",
    description: "Esta fuente no está disponible ahora mismo.",
    icon: CircleX,
    className: "text-red-300",
  };
}

function formatCheckedAt(value?: string) {
  if (!value) return "No revisado";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "No revisado";
  }
}

export default function PackageDetailsModal({
  game,
  installStatus,
  selectedSource,
  open,
  rechecking = false,
  onClose,
  onSelectSource,
  onDownload,
  onRecheckSources,
}: PackageDetailsModalProps) {
  if (!open) {
    return null;
  }

  const installBadge = getInstallStatusLabel(installStatus);
  const InstallIcon = installBadge.icon;

  async function handleOpenSteam() {
    await openExternalUrl(getSteamStoreUrl(Number(game.appId)));
  }

  async function handleOpenSteamDb() {
    await openExternalUrl(getSteamDbUrl(Number(game.appId)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="lf-surface max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl border">
        <div className="relative h-48 overflow-hidden bg-white/5">
          {game.imageUrl ? (
            <img
              src={game.imageUrl}
              alt={game.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-12 w-12 text-(--color-muted)" />
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/30 to-transparent" />

          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute bottom-5 left-5 right-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${installBadge.className}`}
              >
                <InstallIcon className="h-3.5 w-3.5" />
                {installBadge.label}
              </span>

              <span className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                AppID {game.appId}
              </span>
            </div>

            <h2 className="text-3xl font-bold text-white">
              {game.title}
            </h2>

            <p className="mt-1 text-sm text-white/70">
              {game.developer || "Developer unknown"}
            </p>
          </div>
        </div>

        <div className="max-h-[calc(90vh-12rem)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
            <section className="space-y-5">
              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Información
                </h3>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoBox label="AppID" value={game.appId} />
                  <InfoBox
                    label="Developer"
                    value={game.developer || "Developer unknown"}
                  />
                  <InfoBox
                    label="Platforms"
                    value={game.platforms.join(", ") || "Unknown"}
                  />
                  <InfoBox label="Estado" value={installBadge.label} />
                </div>
              </div>

              <div className="lf-surface rounded-2xl border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-semibold text-(--color-text)">
                      Fuentes disponibles
                    </h3>

                    <p className="mt-1 text-sm text-(--color-muted)">
                      Elige desde cuál fuente quieres descargar el paquete.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRecheckSources(game.appId)}
                    disabled={rechecking}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCcw className={`h-4 w-4 ${rechecking ? "animate-spin" : ""}`} />
                    {rechecking ? "Revisando..." : "Revisar fuentes"}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {game.sources.map((source) => {
                    const sourceKey = getSourceKey(source);
                    const isSelected =
                      selectedSource &&
                      getSourceKey(selectedSource) === sourceKey;

                    const FileIcon = getFileIcon(source.fileType);
                    const status = getFriendlySourceStatus(source);
                    const StatusIcon = status.icon;

                    return (
                      <button
                        key={sourceKey}
                        type="button"
                        disabled={!source.available}
                        onClick={() => onSelectSource(sourceKey)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${isSelected
                            ? "border-(--color-accent) bg-(--color-accent)/10"
                            : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <StatusIcon className={`h-4 w-4 ${status.className}`} />

                              <span className="font-semibold text-(--color-text)">
                                {source.providerName}
                              </span>
                            </div>

                            <p className="mt-1 text-sm text-(--color-muted)">
                              {status.description}
                            </p>

                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-(--color-muted)">
                              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
                                <FileIcon className="h-3.5 w-3.5" />
                                .{source.fileType}
                              </span>

                              {source.requiresApiKey && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
                                  <KeyRound className="h-3.5 w-3.5" />
                                  {source.hasAuth ? "Cuenta configurada" : "Requiere cuenta"}
                                </span>
                              )}

                              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1">
                                <ShieldQuestion className="h-3.5 w-3.5" />
                                Revisado {formatCheckedAt(source.checkedAt)}
                              </span>
                            </div>
                          </div>

                          {isSelected && (
                            <span className="rounded-full bg-(--color-accent) px-3 py-1 text-[11px] font-medium text-(--color-accent-text)">
                              Selected
                            </span>
                          )}
                        </div>

                        <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-(--color-muted) hover:text-(--color-text)">
                            Detalles técnicos
                          </summary>

                          <div className="mt-3 space-y-2 text-xs text-(--color-muted)">
                            <TechLine
                              label="HTTP Status"
                              value={
                                typeof source.statusCode === "number"
                                  ? String(source.statusCode)
                                  : "N/A"
                              }
                            />

                            <TechLine
                              label="Provider Message"
                              value={source.providerMessage || source.error || "N/A"}
                            />

                            <TechLine
                              label="Auth"
                              value={
                                source.requiresApiKey
                                  ? source.hasAuth
                                    ? "Configurada"
                                    : "Requerida"
                                  : "No requerida"
                              }
                            />

                            <TechLine
                              label="Download URL"
                              value={source.downloadUrl || "N/A"}
                              breakAll
                            />
                          </div>
                        </details>
                      </button>
                    );
                  })}
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
                    disabled={!selectedSource || !selectedSource.available}
                    onClick={onDownload}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                    Descargar fuente seleccionada
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenSteam}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir Steam
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenSteamDb}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                  >
                    <Database className="h-4 w-4" />
                    Abrir SteamDB
                  </button>
                </div>
              </div>

              <div className="lf-surface rounded-2xl border p-4">
                <h3 className="font-semibold text-(--color-text)">
                  Fuente seleccionada
                </h3>

                {selectedSource ? (
                  <div className="mt-4 space-y-3 text-sm">
                    <InfoBox
                      label="Provider"
                      value={selectedSource.providerName}
                    />
                    <InfoBox
                      label="Tipo"
                      value={`.${selectedSource.fileType}`}
                    />
                    <InfoBox
                      label="Estado"
                      value={
                        selectedSource.available
                          ? "Lista para descargar"
                          : "No disponible"
                      }
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-(--color-muted)">
                    No hay una fuente seleccionada.
                  </p>
                )}
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

type TechLineProps = {
  label: string;
  value: string;
  breakAll?: boolean;
};

function TechLine({ label, value, breakAll }: TechLineProps) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-(--color-muted)">
        {label}
      </span>

      <span
        className={`text-(--color-text) ${breakAll ? "break-all" : ""
          }`}
      >
        {value}
      </span>
    </div>
  );
}