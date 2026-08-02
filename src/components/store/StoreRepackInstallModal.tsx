import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Box,
  Download,
  FolderOpen,
  Loader2,
  Magnet,
  Trash2,
  X,
} from "lucide-react";
import type { RepackEntry } from "../../types/package";
import type {
  DebridInstallMethod,
  RepackInstallOptions,
} from "../../services/debridInstallChoice";
import { pickDirectDebridUri, pickMagnetDebridUri } from "../../services/debridInstallChoice";
import type { ProviderId } from "../../services/debridProviderService";
import { pickFolder, resolveAppDataDir } from "../../services/tauri";

const PROVIDER_LABELS: Record<ProviderId, string> = {
  torbox: "TorBox",
  realdebrid: "Real-Debrid",
  alldebrid: "AllDebrid",
  premiumize: "Premiumize",
};

function formatBytes(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "?";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

type MethodOption = {
  method: DebridInstallMethod;
  label: string;
  description: string;
};

type StoreRepackInstallModalProps = {
  open: boolean;
  entry: RepackEntry;
  configuredProviders: ProviderId[];
  onClose: () => void;
  onConfirm: (options: RepackInstallOptions) => void | Promise<void>;
};

export default function StoreRepackInstallModal({
  open,
  entry,
  configuredProviders,
  onClose,
  onConfirm,
}: StoreRepackInstallModalProps) {
  const [method, setMethod] = useState<DebridInstallMethod>("direct");
  const [provider, setProvider] = useState<ProviderId | undefined>(
    configuredProviders[0],
  );
  const [destDir, setDestDir] = useState("");
  const [resolvedAppDataDir, setResolvedAppDataDir] = useState("");
  const [autoExtract, setAutoExtract] = useState(true);
  const [deleteArchive, setDeleteArchive] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const directUri = useMemo(
    () => pickDirectDebridUri(entry.downloadUris),
    [entry.downloadUris],
  );
  const magnetUri = useMemo(
    () => pickMagnetDebridUri(entry.downloadUris),
    [entry.downloadUris],
  );

  const methodOptions = useMemo<MethodOption[]>(() => {
    const options: MethodOption[] = [];
    if (directUri) {
      options.push({
        method: "direct",
        label: "Descarga directa",
        description: "HTTP directo (gofile.io, etc.)",
      });
    }
    if (magnetUri) {
      options.push({
        method: "debrid",
        label: "Resolver con Debrid",
        description: "Resuelve el magnet vía proveedor",
      });
      options.push({
        method: "torrent",
        label: "Descargar vía torrent",
        description: "Cliente integrado (librqbit)",
      });
    }
    return options;
  }, [directUri, magnetUri]);

  useEffect(() => {
    if (!open) return;
    // Reset to the modal's default state each time it opens.
    if (directUri) setMethod("direct");
    else if (configuredProviders.length > 0 && magnetUri) setMethod("debrid");
    else if (magnetUri) setMethod("torrent");
    setProvider(configuredProviders[0]);
    setAutoExtract(true);
    setDeleteArchive(false);
    setConfirming(false);
    let cancelled = false;
    resolveAppDataDir()
      .then((appDataDir) => {
        if (!cancelled) {
          setResolvedAppDataDir(appDataDir);
          setDestDir(`${appDataDir}/games/debrid/${entry.id}`);
        }
      })
      .catch(() => {
        if (!cancelled) setDestDir(`games/debrid/${entry.id}`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry.id]);

  if (!open) return null;

  const debridDisabled = configuredProviders.length === 0;
  const canConfirm =
    (directUri || magnetUri) &&
    (method !== "debrid" || !debridDisabled) &&
    destDir.trim().length > 0;

  function selectedMethodLabel() {
    return methodOptions.find((o) => o.method === method)?.label ?? "Descargar";
  }

  async function handlePickFolder() {
    const root = resolvedAppDataDir
      ? `${resolvedAppDataDir}/games/debrid`
      : undefined;
    const dir = await pickFolder(
      "Elige la carpeta de destino",
      destDir.trim() || root || undefined,
    );
    if (dir) setDestDir(dir);
  }

  async function handleConfirm() {
    if (!canConfirm || confirming) return;
    setConfirming(true);
    try {
      await onConfirm({
        method,
        provider: method === "debrid" ? provider : undefined,
        destDir: destDir.trim(),
        autoExtract,
        deleteArchive,
      });
      onClose();
    } finally {
      setConfirming(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="lf-surface w-full max-w-lg overflow-hidden rounded-3xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/15">
              <Magnet className="h-6 w-6 text-(--color-accent)" />
            </div>
            <div className="min-w-0">
              <h2 className="line-clamp-1 text-lg font-bold text-(--color-text)">
                Instalar repack
              </h2>
              <p className="mt-0.5 line-clamp-1 text-sm text-(--color-muted)">
                {entry.title}
              </p>
              <p className="mt-0.5 text-xs text-(--color-muted)">
                {entry.repacker ? entry.repacker.toUpperCase() : "Repack"} ·{" "}
                {formatBytes(entry.fileSize)}
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

        <div className="max-h-[420px] space-y-4 overflow-y-auto border-t border-(--surface-active-border) px-5 py-4">
          {/* Método de descarga */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-muted)">
              Método de descarga
            </p>
            {methodOptions.length > 1 ? (
              <div className="mt-2 space-y-1.5">
                {methodOptions.map((opt) => {
                  const active = method === opt.method;
                  const disabled =
                    opt.method === "debrid" && debridDisabled;
                  return (
                    <button
                      key={opt.method}
                      type="button"
                      disabled={disabled}
                      onClick={() => setMethod(opt.method)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-(--color-accent) bg-(--color-accent)/10"
                          : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
                      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-medium text-(--color-text)">
                            {opt.label}
                          </span>
                          <p className="text-xs text-(--color-muted)">
                            {opt.description}
                            {disabled ? " · Configura un proveedor en Ajustes" : ""}
                          </p>
                        </div>
                        {active && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-(--color-accent)" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2.5 text-sm text-(--color-text)">
                {methodOptions[0]?.label ?? "Sin enlaces de descarga"}
              </p>
            )}
          </div>

          {/* Proveedor Debrid */}
          {method === "debrid" && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-muted)">
                Proveedor Debrid
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {configuredProviders.map((p) => {
                  const active = provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setProvider(p)}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${
                        active
                          ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                          : "border-(--surface-active-border) bg-white/5 text-(--color-text) hover:bg-white/10"
                      }`}
                    >
                      {PROVIDER_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ruta de destino */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-(--color-muted)">
              Ruta de destino
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3">
              <button
                type="button"
                onClick={() => void handlePickFolder()}
                title="Elegir carpeta"
                aria-label="Elegir carpeta"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
              <input
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
                placeholder="games/debrid/…"
                spellCheck={false}
                className="w-full bg-transparent py-2.5 font-mono text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/60"
              />
            </div>
            <p className="mt-1 text-[10px] text-(--color-muted)">
              Ruta donde se descargará el repack (por defecto games/debrid).
            </p>
          </div>

          {/* Checks */}
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2.5">
              <input
                type="checkbox"
                checked={autoExtract}
                onChange={(e) => setAutoExtract(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-(--color-accent)"
              />
              <span className="flex items-center gap-1.5 text-sm text-(--color-text)">
                <Box className="h-4 w-4 text-(--color-muted)" />
                Extraer automáticamente tras la descarga
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2.5 ${
                !autoExtract ? "pointer-events-none opacity-40" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={deleteArchive}
                onChange={(e) => setDeleteArchive(e.target.checked)}
                disabled={!autoExtract}
                className="mt-0.5 h-4 w-4 accent-(--color-accent)"
              />
              <span className="flex items-center gap-1.5 text-sm text-(--color-text)">
                <Trash2 className="h-4 w-4 text-(--color-muted)" />
                Eliminar el .rar/.zip tras la extracción exitosa
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-(--surface-active-border) p-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={!canConfirm || confirming}
            onClick={handleConfirm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {selectedMethodLabel()}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
