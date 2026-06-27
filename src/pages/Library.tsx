import { useEffect, useMemo, useState } from "react";
import {
  FileCode2,
  Filter,
  FolderSearch,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import LibraryItemDetailsModal from "../components/library/LibraryItemDetailsModal";
import { useSettings } from "../context/SettingsContext";
import {
  deleteLuaScript,
  scanInstalledLuaScripts,
  setLuaScriptEnabled,
} from "../services/tauri";
import { InstalledLuaScript } from "../types/installedLua";
// import { resolveGameNames } from "../services/gameNameResolver";
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

import LuaUpdateBadge from "../components/library/LuaUpdateBadge";
import { getLuaUpdateInfo } from "../utils/luaUpdateStatus";

import { resolveGameMetadata } from "../services/gameMetadataResolver";
import type { SteamAppMetadata } from "../types/gameMetadata";

type LibraryFilter = "all" | "active" | "disabled";
type LibrarySort = "appid" | "name" | "modified" | "size";


function formatDate(seconds: number) {
  if (!seconds) return "No disponible";
  return new Date(seconds * 1000).toLocaleDateString();
}

function getFallbackHeaderImageUrl(appId: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

function getBestCoverUrl(
  appId: number,
  metadata?: SteamAppMetadata
): string {
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    getFallbackHeaderImageUrl(appId)
  );
}



export default function Library() {
  const { settings } = useSettings();

  const [selectedScript, setSelectedScript] =
    useState<InstalledLuaScript | null>(null);

  const [scripts, setScripts] = useState<InstalledLuaScript[]>([]);
  const [gameMetadata, setGameMetadata] = useState<
    Record<number, SteamAppMetadata>
  >({});
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

      const metadata = await resolveGameMetadata(
        results.map((script) => script.app_id)
      );

      setGameMetadata(metadata);

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
      setSelectedScript(null);
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
      const metadata = gameMetadata[script.app_id];
      const gameTitle = metadata?.name || "";

      const matchesQuery =
        !normalizedQuery ||
        script.app_id.toString().includes(normalizedQuery) ||
        script.file_name.toLowerCase().includes(normalizedQuery) ||
        gameTitle.toLowerCase().includes(normalizedQuery);

      const matchesFilter =
        filter === "all" ||
        (filter === "active" && !script.is_disabled) ||
        (filter === "disabled" && script.is_disabled);

      return matchesQuery && matchesFilter;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const aTitle =
          gameMetadata[a.app_id]?.name || `Steam App ${a.app_id}`;
        const bTitle =
          gameMetadata[b.app_id]?.name || `Steam App ${b.app_id}`;

        return aTitle.localeCompare(bTitle);
      }

      if (sortBy === "modified") {
        return b.modified_at - a.modified_at;
      }

      if (sortBy === "size") {
        return b.file_size - a.file_size;
      }

      return a.app_id - b.app_id;
    });
  }, [scripts, query, filter, sortBy, gameMetadata]);

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <FolderSearch className="h-3.5 w-3.5" />
            Installed Lua Catalog
          </div>

          <h1 className="text-3xl font-bold text-(--color-text)">
            Biblioteca
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Explora tus scripts Lua instalados como un catálogo de juegos.
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
              Biblioteca Lua
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
            <RefreshCcw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
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
              onChange={(event) =>
                setFilter(event.target.value as LibraryFilter)
              }
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
              onChange={(event) =>
                setSortBy(event.target.value as LibrarySort)
              }
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
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredScripts.map((script) => (

            <InstalledLuaCatalogCard
              key={script.path}
              script={script}
              metadata={gameMetadata[script.app_id]}
              onDetails={setSelectedScript}
            />

          ))}
        </section>
      )}
      <LibraryItemDetailsModal
        open={Boolean(selectedScript)}
        script={selectedScript}
        metadata={
          selectedScript
            ? gameMetadata[selectedScript.app_id]
            : undefined
        }
        onClose={() => setSelectedScript(null)}
        onToggle={handleToggleScript}
        onDelete={handleDeleteScript}
        onOpenSteamStore={handleOpenSteamStore}
        onOpenSteamDb={handleOpenSteamDb}
      />
    </div>
  );
}


type InstalledLuaCatalogCardProps = {
  script: InstalledLuaScript;
  metadata?: SteamAppMetadata;
  onDetails: (script: InstalledLuaScript) => void;
};



function InstalledLuaCatalogCard({
  script,
  metadata,
  onDetails,
}: InstalledLuaCatalogCardProps) {

  const [imageFailed, setImageFailed] = useState(false);

  const title = metadata?.name || `Steam App ${script.app_id}`;
  const developer = metadata?.developer;
  const updateInfo = getLuaUpdateInfo(script);
  const coverUrl = getBestCoverUrl(script.app_id, metadata);

  return (
    <article className="group lf-surface overflow-hidden rounded-2xl border transition hover:border-(--color-accent)/30">
      <div className="relative h-32 overflow-hidden bg-white/5">
        {!imageFailed ? (
          <img
            src={coverUrl}
            alt={title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <LibraryCoverFallback appId={script.app_id} title={title} />
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-transparent" />

        <div className="absolute right-3 top-3">
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

        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="line-clamp-1 font-semibold text-white">
            {title}
          </h3>

          <p className="mt-0.5 text-xs text-white/70">
            AppID {script.app_id}
          </p>

          {developer && (
            <p className="mt-0.5 line-clamp-1 text-xs text-white/55">
              {developer}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3 p-4">
        {metadata?.platforms?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {metadata.platforms.map((platform) => (
              <span
                key={platform}
                className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)"
              >
                {platform}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-(--color-muted)">
              {script.file_name}
            </p>

            <p className="mt-1 text-[11px] text-(--color-muted)">
              Modificado: {formatDate(script.modified_at)}
            </p>
          </div>

          <LuaUpdateBadge info={updateInfo} />
        </div>


        <button
          type="button"
          onClick={() => onDetails(script)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
        >
          <FileCode2 className="h-3.5 w-3.5" />
          Details
        </button>






      </div>
    </article>
  );
}

type LibraryCoverFallbackProps = {
  appId: number;
  title: string;
};

function LibraryCoverFallback({
  appId,
  title,
}: LibraryCoverFallbackProps) {
  const initials = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex h-full w-full items-center justify-center bg-white/5">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
          {initials ? (
            <span className="text-sm font-bold text-white/80">
              {initials}
            </span>
          ) : (
            <FileCode2 className="h-6 w-6 text-white/40" />
          )}
        </div>

        <p className="mt-2 text-[11px] text-white/45">
          AppID {appId}
        </p>
      </div>
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

