import { useEffect, useState } from "react";
import {
  FileCode2,
  FolderSearch,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { useSettings } from "../context/SettingsContext";
import { scanInstalledLuaScripts } from "../services/tauri";
import { InstalledLuaScript } from "../types/installedLua";
import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

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

export default function Library() {
  const { settings } = useSettings();

  const [scripts, setScripts] = useState<InstalledLuaScript[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleScan() {
    if (!settings.luaPath) {
      showWarning("Configura o detecta la ruta config/lua antes de escanear.", {
        title: "Ruta requerida",
      });

      return;
    }

    try {
      setLoading(true);

      const results = await scanInstalledLuaScripts(settings.luaPath);
      setScripts(results);

      showSuccess(`Se detectaron ${results.length} script(s) Lua.`, {
        title: "Biblioteca actualizada",
      });
    } catch (error) {
      console.error(error);

      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo escanear la carpeta Lua.";

      showError(message, {
        title: "Error escaneando Lua",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (settings.luaPath) {
      handleScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.luaPath]);

  const enabledScripts = scripts.filter((script) => !script.is_disabled);
  const disabledScripts = scripts.filter((script) => script.is_disabled);

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <FolderSearch className="h-3.5 w-3.5" />
            Installed Lua Scanner
          </div>

          <h1 className="text-3xl font-bold text-(--color-text)">
            Biblioteca
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Escanea los scripts Lua instalados en Steam y revisa qué AppIDs
            tienen archivos activos o deshabilitados.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Total" value={scripts.length} />
          <MiniStat label="Activos" value={enabledScripts.length} />
          <MiniStat label="Deshabilitados" value={disabledScripts.length} />
        </div>
      </header>

      <section className="lf-surface rounded-2xl border p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-semibold text-(--color-text)">
              Ruta escaneada
            </h2>

            <p className="mt-1 break-all text-sm text-(--color-muted)">
              {settings.luaPath || "No configurada"}
            </p>
          </div>

          <button
            type="button"
            onClick={handleScan}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Escaneando..." : "Escanear ahora"}
          </button>
        </div>
      </section>

      {scripts.length === 0 ? (
        <section className="lf-surface rounded-2xl border p-10 text-center">
          <FileCode2 className="mx-auto h-10 w-10 text-(--color-muted)" />

          <h2 className="mt-4 font-semibold text-(--color-text)">
            No se encontraron scripts Lua
          </h2>

          <p className="mt-2 text-sm text-(--color-muted)">
            Cuando instales paquetes, aparecerán aquí.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {scripts.map((script) => (
            <InstalledLuaCard
              key={script.path}
              script={script}
            />
          ))}
        </section>
      )}
    </div>
  );
}

type InstalledLuaCardProps = {
  script: InstalledLuaScript;
};

function InstalledLuaCard({ script }: InstalledLuaCardProps) {
  return (
    <article className="lf-surface rounded-2xl border p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5">
            <FileCode2 className="h-5 w-5 text-(--color-accent)" />
          </div>

          <div className="min-w-0">
            <h3 className="truncate font-semibold text-(--color-text)">
              AppID {script.app_id}
            </h3>

            <p className="mt-0.5 truncate text-xs text-(--color-muted)">
              {script.file_name}
            </p>
          </div>
        </div>

        {script.is_disabled ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-1 text-[11px] text-zinc-300">
            <ShieldOff className="h-3 w-3" />
            Disabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">
            <ShieldCheck className="h-3 w-3" />
            Active
          </span>
        )}
      </div>

      <div className="space-y-3 text-xs text-(--color-muted)">
        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Tamaño</p>
          <p className="mt-1 font-medium text-(--color-text)">
            {formatBytes(script.file_size)}
          </p>
        </div>

        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Modificado</p>
          <p className="mt-1 font-medium text-(--color-text)">
            {formatDate(script.modified_at)}
          </p>
        </div>

        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Ruta</p>
          <p className="mt-1 break-all font-medium text-(--color-text)">
            {script.path}
          </p>
        </div>
      </div>
    </article>
  );
}

type MiniStatProps = {
  label: string;
  value: string | number;
};

function MiniStat({ label, value }: MiniStatProps) {
  return (
    <div className="lf-surface rounded-2xl border px-4 py-3">
      <span className="text-xs text-(--color-muted)">
        {label}
      </span>

      <p className="mt-1 text-lg font-semibold text-(--color-text)">
        {value}
      </p>
    </div>
  );
}