import { useEffect, useMemo, useState } from "react";
import {
  Database,
  ExternalLink,
  FileCode2,
  Filter,
  FolderSearch,
  Power,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";

import { useSettings } from "../context/SettingsContext";
import {
  deleteLuaScript,
  scanInstalledLuaScripts,
  setLuaScriptEnabled,
} from "../services/tauri";
import { InstalledLuaScript } from "../types/installedLua";
import { resolveGameNames } from "../services/gameNameResolver";
import { openExternalUrl } from "../services/externalLinks";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../utils/steamLinks";
import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

type LibraryFilter = "all" | "active" | "disabled";
type LibrarySort = "appid" | "name" | "modified" | "size";

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
  const [gameNames, setGameNames] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sortBy, setSortBy] = useState<LibrarySort>("appid");

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

      const names = await resolveGameNames(
        results.map((script) => script.app_id)
      );

      setGameNames(names);

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

  async function handleToggleScript(script: InstalledLuaScript) {
    try {
      const result = await setLuaScriptEnabled({
        luaPath: settings.luaPath,
        fileName: script.file_name,
        enabled: script.is_disabled,
      });

      showSuccess(result.message, {
        title: script.is_disabled ? "Lua activado" : "Lua deshabilitado",
      });

      await handleScan();
    } catch (error) {
      console.error(error);

      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo cambiar el estado del Lua.";

      showError(message, {
        title: "Acción fallida",
      });
    }
  }

  async function handleDeleteScript(script: InstalledLuaScript) {
    const accepted = window.confirm(
      `¿Eliminar definitivamente ${script.file_name}?`
    );

    if (!accepted) {
      return;
    }

    try {
      const result = await deleteLuaScript({
        luaPath: settings.luaPath,
        fileName: script.file_name,
      });

      showSuccess(result.message, {
        title: "Lua eliminado",
      });

      await handleScan();
    } catch (error) {
      console.error(error);

      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo eliminar el Lua.";

      showError(message, {
        title: "Eliminación fallida",
      });
    }
  }

  async function handleOpenSteamStore(script: InstalledLuaScript) {
    try {
      await openExternalUrl(getSteamStoreUrl(script.app_id));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir la página de Steam.", {
        title: "Error abriendo enlace",
      });
    }
  }

  async function handleOpenSteamDb(script: InstalledLuaScript) {
    try {
      await openExternalUrl(getSteamDbUrl(script.app_id));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir SteamDB.", {
        title: "Error abriendo enlace",
      });
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

  const filteredScripts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = scripts.filter((script) => {
      const gameName = gameNames[script.app_id] || "";
      const matchesQuery =
        !normalizedQuery ||
        script.app_id.toString().includes(normalizedQuery) ||
        script.file_name.toLowerCase().includes(normalizedQuery) ||
        gameName.toLowerCase().includes(normalizedQuery);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && !script.is_disabled) ||
        (filter === "disabled" && script.is_disabled);

      return matchesQuery && matchesFilter;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const aName = gameNames[a.app_id] || `Steam App ${a.app_id}`;
        const bName = gameNames[b.app_id] || `Steam App ${b.app_id}`;
        return aName.localeCompare(bName);
      }

      if (sortBy === "modified") {
        return b.modified_at - a.modified_at;
      }

      if (sortBy === "size") {
        return b.file_size - a.file_size;
      }

      return a.app_id - b.app_id;
    });
  }, [scripts, query, filter, sortBy, gameNames]);

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
            Busca, filtra y administra los scripts Lua instalados en Steam.
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

      <section className="lf-surface rounded-2xl border p-4">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_190px_190px]">
          <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
            <Search className="h-4 w-4 text-(--color-muted)" />

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre, AppID o archivo..."
              className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
            />
          </div>

          <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
            <Filter className="h-4 w-4 text-(--color-muted)" />

            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as LibraryFilter)}
              className="w-full bg-transparent text-sm text-(--color-text) outline-none"
            >
              <option className="bg-black text-white" value="all">
                Todos
              </option>
              <option className="bg-black text-white" value="active">
                Activos
              </option>
              <option className="bg-black text-white" value="disabled">
                Deshabilitados
              </option>
            </select>
          </div>

          <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
            <RefreshCcw className="h-4 w-4 text-(--color-muted)" />

            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as LibrarySort)}
              className="w-full bg-transparent text-sm text-(--color-text) outline-none"
            >
              <option className="bg-black text-white" value="appid">
                Ordenar por AppID
              </option>
              <option className="bg-black text-white" value="name">
                Ordenar por nombre
              </option>
              <option className="bg-black text-white" value="modified">
                Más recientes
              </option>
              <option className="bg-black text-white" value="size">
                Mayor tamaño
              </option>
            </select>
          </div>
        </div>
      </section>

      {filteredScripts.length === 0 ? (
        <section className="lf-surface rounded-2xl border p-10 text-center">
          <FileCode2 className="mx-auto h-10 w-10 text-(--color-muted)" />

          <h2 className="mt-4 font-semibold text-(--color-text)">
            No se encontraron scripts Lua
          </h2>

          <p className="mt-2 text-sm text-(--color-muted)">
            Cambia la búsqueda, el filtro o instala paquetes desde Paquetes.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {filteredScripts.map((script) => (
            <InstalledLuaCard
              key={script.path}
              script={script}
              gameName={gameNames[script.app_id]}
              onToggle={handleToggleScript}
              onDelete={handleDeleteScript}
              onOpenSteamStore={handleOpenSteamStore}
              onOpenSteamDb={handleOpenSteamDb}
            />
          ))}
        </section>
      )}
    </div>
  );
}

type InstalledLuaCardProps = {
  script: InstalledLuaScript;
  gameName?: string;
  onToggle: (script: InstalledLuaScript) => void;
  onDelete: (script: InstalledLuaScript) => void;
  onOpenSteamStore: (script: InstalledLuaScript) => void;
  onOpenSteamDb: (script: InstalledLuaScript) => void;
};

function InstalledLuaCard({
  script,
  gameName,
  onToggle,
  onDelete,
  onOpenSteamStore,
  onOpenSteamDb,
}: InstalledLuaCardProps) {
  return (
    <article className="lf-surface rounded-2xl border p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5">
            <FileCode2 className="h-5 w-5 text-(--color-accent)" />
          </div>

          <div className="min-w-0">
            <h3 className="truncate font-semibold text-(--color-text)">
              {gameName || `Steam App ${script.app_id}`}
            </h3>

            <p className="mt-0.5 truncate text-xs text-(--color-muted)">
              AppID {script.app_id} · {script.file_name}
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
        <InfoBox label="Tamaño" value={formatBytes(script.file_size)} />
        <InfoBox label="Modificado" value={formatDate(script.modified_at)} />
        <InfoBox label="Ruta" value={script.path} breakAll />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onOpenSteamStore(script)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Steam
        </button>

        <button
          type="button"
          onClick={() => onOpenSteamDb(script)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
        >
          <Database className="h-3.5 w-3.5" />
          SteamDB
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onToggle(script)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
        >
          <Power className="h-3.5 w-3.5" />
          {script.is_disabled ? "Activar" : "Deshabilitar"}
        </button>

        <button
          type="button"
          onClick={() => onDelete(script)}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </button>
      </div>
    </article>
  );
}

type InfoBoxProps = {
  label: string;
  value: string;
  breakAll?: boolean;
};

function InfoBox({ label, value, breakAll }: InfoBoxProps) {
  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
      <p>{label}</p>

      <p
        className={`mt-1 font-medium text-(--color-text) ${
          breakAll ? "break-all" : ""
        }`}
      >
        {value}
      </p>
    </div>
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