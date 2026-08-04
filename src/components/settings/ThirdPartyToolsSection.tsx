import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Disc3,
  Rocket,
  X,
  HardDrive,
} from "lucide-react";

import {
  listThirdPartyTools,
  installThirdPartyTool,
  uninstallThirdPartyTool,
  checkThirdPartyUpdates,
  updateThirdPartyTool,
  openThirdPartyFolder,
  ThirdPartyToolInfo,
} from "../../services/tauri";
import { showSuccess, showError } from "../toast/GameToast";

function toolIcon(id: string): React.ReactNode {
  switch (id) {
    case "smokeapi":
      return <Disc3 className="h-5 w-5" />;
    case "steamless":
      return <Rocket className="h-5 w-5" />;
    case "goldberg_fork":
      return <HardDrive className="h-5 w-5" />;
    default:
      return <HardDrive className="h-5 w-5" />;
  }
}

export default function ThirdPartyToolsSection() {
  const [tools, setTools] = useState<ThirdPartyToolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workingAction, setWorkingAction] = useState<"install" | "uninstall" | "update">("install");
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listThirdPartyTools();
      setTools(result);
    } catch (err) {
      showError(`No se pudieron cargar las herramientas: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInstall = useCallback(async (toolId: string) => {
    setWorkingId(toolId);
    setWorkingAction("install");
    try {
      const res = await installThirdPartyTool(toolId);
      if (res.ok) showSuccess(res.message || "Instalada correctamente.");
      else showError(res.message || "Falló la instalación.");
    } catch (err) {
      showError(`Error al instalar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load]);

  const handleUninstall = useCallback(async (toolId: string) => {
    setWorkingId(toolId);
    setWorkingAction("uninstall");
    try {
      const res = await uninstallThirdPartyTool(toolId);
      if (res.ok) showSuccess(res.message || "Desinstalada correctamente.");
      else showError(res.message || "Falló la desinstalación.");
    } catch (err) {
      showError(`Error al desinstalar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWorkingId(null);
      load();
    }
  }, [load]);

  const handleUpdateAll = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const result = await checkThirdPartyUpdates();
      setTools(result);
      const outdated = result.filter((t) => t.updateAvailable);
      if (outdated.length === 0) {
        showSuccess("Todas las herramientas están actualizadas.");
        return;
      }
      let updated = 0;
      for (const t of outdated) {
        setWorkingId(t.id);
        setWorkingAction("update");
        const res = await updateThirdPartyTool(t.id);
        if (res.ok) updated++;
      }
      showSuccess(`${updated} de ${outdated.length} herramienta(s) actualizada(s).`);
    } catch (err) {
      showError(`Error al comprobar actualizaciones: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWorkingId(null);
      setCheckingUpdates(false);
      load();
    }
  }, [load]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await openThirdPartyFolder();
    } catch (err) {
      showError(`No se pudo abrir la carpeta: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const busy = workingId !== null;

  return (
    <div className="lf-surface overflow-hidden rounded-2xl border">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--surface-active-border) p-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <HardDrive className="h-4 w-4 text-(--color-accent)" />
            Herramientas de terceros
          </h3>
          <p className="mt-1 text-xs text-(--color-muted)">
            Utilidades para juegos (SmokeAPI, Steamless, Goldberg, Koaloader). Se descargan desde sus repositorios oficiales de GitHub.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Abrir carpeta
          </button>
          <button
            type="button"
            onClick={handleUpdateAll}
            disabled={busy || tools.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20 disabled:opacity-50"
          >
            {checkingUpdates ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Comprobar actualizaciones
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 p-5">
        {loading && tools.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-(--color-muted)">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando herramientas...
          </div>
        ) : tools.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <HardDrive className="h-8 w-8 text-(--color-muted)" />
            <p className="text-sm text-(--color-muted)">
              No hay herramientas registradas. Comprueba las actualizaciones o abre la carpeta.
            </p>
          </div>
        ) : (
          tools.map((tool) => {
            const isWorking = workingId === tool.id;
            return (
              <div
                key={tool.id}
                className="flex items-start gap-3 rounded-xl border border-(--surface-active-border) p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10 text-(--color-accent)">
                  {toolIcon(tool.id)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-(--color-text)">{tool.name}</span>
                    {tool.installed && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {tool.installedVersion ? `v${tool.installedVersion}` : "Instalada"}
                      </span>
                    )}
                    {tool.updateAvailable && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        Actualización {tool.latestVersion ? `v${tool.latestVersion}` : "disponible"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-(--color-muted)">{tool.description}</p>
                  {!tool.installed && tool.latestVersion && (
                    <p className="mt-0.5 text-[11px] text-(--color-muted)">
                      Última versión: v{tool.latestVersion}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {tool.installed ? (
                    <>
                      {tool.updateAvailable && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setWorkingId(tool.id);
                            setWorkingAction("update");
                            updateThirdPartyTool(tool.id).then((res) => {
                              if (res.ok) showSuccess(res.message || "Actualizada.");
                              else showError(res.message || "Falló la actualización.");
                            }).catch((err) =>
                              showError(err instanceof Error ? err.message : String(err))
                            ).finally(() => {
                              setWorkingId(null);
                              load();
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20 disabled:opacity-50"
                        >
                          {isWorking && workingAction === "update" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Actualizar
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUninstall(tool.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      >
                        {isWorking && workingAction === "uninstall" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        Desinstalar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleInstall(tool.id)}
                      className="flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
                    >
                      {isWorking && workingAction === "install" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HardDrive className="h-3.5 w-3.5" />
                      )}
                      Instalar
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}