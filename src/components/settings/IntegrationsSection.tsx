/**
 * Integrations Center — Settings section for provider management.
 *
 * Shows cards for Steam, Epic, Manual, and Lua integrations
 * with status, controls, and manual refresh actions.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Monitor,
  Home,
  LayoutGrid,
  Search,
  ShoppingCart,
  PanelLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Code,
  BookOpen,
  Gamepad2,
  AlertTriangle,
  Clock,
  Hash,
  Cloud,
} from "lucide-react";

import {
  IntegrationId,
  IntegrationSettings,
  IntegrationSurface,
  ALL_SURFACES,
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_DISPLAY_DESCRIPTIONS,
} from "../../types/integrations";
import {
  getIntegrationSettings,
  updateIntegrationSettings,
} from "../../services/integrationSettingsService";
import ToggleOption from "./ToggleOption";
import ConfirmModal from "../common/ConfirmModal";

const SURFACE_ICONS: Record<IntegrationSurface, React.ReactNode> = {
  library: <LayoutGrid className="h-3.5 w-3.5" />,
  sidebar: <PanelLeft className="h-3.5 w-3.5" />,
  home: <Home className="h-3.5 w-3.5" />,
  console: <Monitor className="h-3.5 w-3.5" />,
  store: <ShoppingCart className="h-3.5 w-3.5" />,
  search: <Search className="h-3.5 w-3.5" />,
};

const SURFACE_LABELS: Record<IntegrationSurface, string> = {
  library: "Library",
  sidebar: "Sidebar",
  home: "Home",
  console: "Console",
  store: "Store",
  search: "Search",
};

const INTEGRATION_ICONS: Record<IntegrationId, React.ReactNode> = {
  steam: <Gamepad2 className="h-5 w-5" />,
  epic: <Zap className="h-5 w-5" />,
  manual: <BookOpen className="h-5 w-5" />,
  lua: <Code className="h-5 w-5" />,
  debrid: <Cloud className="h-5 w-5" />,
};

const INTEGRATION_COLORS: Record<IntegrationId, string> = {
  steam: "text-blue-400 bg-blue-400/15",
  epic: "text-violet-400 bg-violet-400/15",
  manual: "text-amber-400 bg-amber-400/15",
  lua: "text-emerald-400 bg-emerald-400/15",
  debrid: "text-cyan-400 bg-cyan-400/15",
};

const REFRESH_LABELS: Record<IntegrationId, string> = {
  steam: "Scan Steam library",
  epic: "Refresh Epic games",
  manual: "Reload manual games",
  lua: "Scan Lua packages",
  debrid: "Refresh Debrid catalog",
};

const DISABLE_CONFIRM: Record<IntegrationId, { title: string; description: string }> = {
  steam: { title: "Disable Steam integration?", description: "Steam games will be hidden from Library, Sidebar and Console. All installed game data is preserved. You can re-enable anytime." },
  epic: { title: "Disable Epic integration?", description: "Epic games will be hidden from Library, Sidebar and Console. All installed game data is preserved. You can re-enable anytime." },
  manual: { title: "Disable Manual Games?", description: "Manually added games will be hidden from Library, Sidebar and Console. Your entries are preserved. You can re-enable anytime." },
  lua: { title: "Disable Lua integration?", description: "Lua script packages will be hidden from Library, Sidebar and Console. Package files are preserved. You can re-enable anytime." },
  debrid: { title: "Disable Debrid Repacks?", description: "Debrid repack entries will be hidden from Library, Sidebar and Console. Your catalog is preserved. You can re-enable anytime." },
};

type RefreshState = {
  [key in IntegrationId]?: "idle" | "running" | "success" | "error";
};

type IntegrationCardProps = {
  integrationId: IntegrationId;
  settings: IntegrationSettings;
  onPatch: (patch: Partial<Omit<IntegrationSettings, "id" | "updatedAt">>) => void;
  refreshState: RefreshState;
  onRefresh: (id: IntegrationId) => void;
  statusInfo?: { lastScan?: string; scanCount?: number; path?: string };
  onConfirmDisable?: (id: IntegrationId) => void;
};

function IntegrationCard({
  integrationId,
  settings,
  onPatch,
  refreshState,
  onRefresh,
  statusInfo,
  onConfirmDisable,
}: IntegrationCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rs = refreshState[integrationId] ?? "idle";

  return (
    <div className="lf-surface rounded-2xl border overflow-hidden">
      <div className="flex items-center gap-4 p-5">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${INTEGRATION_COLORS[integrationId]}`}>
          {INTEGRATION_ICONS[integrationId]}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-(--color-text)">
              {INTEGRATION_DISPLAY_NAMES[integrationId]}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              settings.enabled
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/5 text-(--color-muted)"
            }`}>
              {settings.enabled ? t("integrations_section.active", "Active") : t("integrations_section.disabled", "Disabled")}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-(--color-muted)">
            {INTEGRATION_DISPLAY_DESCRIPTIONS[integrationId]}
          </p>
          {statusInfo?.path && (
            <p className="mt-1 text-[10px] text-(--color-muted) truncate">
              {statusInfo.path}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {integrationId !== "manual" && (
            <button
              type="button"
              disabled={rs === "running"}
              onClick={() => onRefresh(integrationId)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/10 disabled:opacity-50"
            >
              {rs === "running" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : rs === "success" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              ) : rs === "error" ? (
                <AlertCircle className="h-3 w-3 text-red-400" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {rs === "running" ? t("integrations_section.scanning", "Scanning...") : rs === "success" ? t("integrations_section.done", "Done") : REFRESH_LABELS[integrationId]}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (settings.enabled && onConfirmDisable) {
                onConfirmDisable(integrationId);
              } else {
                onPatch({ enabled: !settings.enabled });
              }
            }}
            className={`relative h-7 w-12 rounded-full transition ${
              settings.enabled ? "bg-(--color-accent)" : "bg-white/10"
            }`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
              settings.enabled ? "left-6" : "left-1"
            }`} />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 border-t border-(--surface-active-border) px-5 py-2.5 text-xs text-(--color-muted) transition hover:bg-white/[0.02]"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t("integrations_section.advanced_settings", "Advanced settings")}
        {statusInfo?.lastScan && (
          <span className="ml-auto text-[10px]">Last scan: {statusInfo.lastScan}</span>
        )}
        {statusInfo?.scanCount != null && (
          <span className="ml-2 text-[10px]">({statusInfo.scanCount} games)</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-(--surface-active-border) p-5 space-y-4">
          {statusInfo && (statusInfo.lastScan || statusInfo.scanCount != null || statusInfo.path) && (
            <div className="rounded-lg bg-white/[0.03] p-3 space-y-1.5">
              <p className="text-[10px] font-medium text-(--color-muted) uppercase tracking-wider">{t("integrations_section.status", "Status")}</p>
              {statusInfo.lastScan && (
                <div className="flex items-center gap-1.5 text-xs text-(--color-text)">
                  <Clock className="h-3 w-3 text-(--color-muted)" />
                  {t("integrations_section.last_scan", "Last scan: {{time}}").replace("{{time}}", statusInfo.lastScan)}
                </div>
              )}
              {statusInfo.scanCount != null && (
                <div className="flex items-center gap-1.5 text-xs text-(--color-text)">
                  <Hash className="h-3 w-3 text-(--color-muted)" />
                  {t("integrations_section.games_found", "{{count}} games found").replace("{{count}}", String(statusInfo.scanCount))}
                </div>
              )}
              {statusInfo.path && (
                <div className="flex items-center gap-1.5 text-[11px] text-(--color-muted) truncate">
                  {t("integrations_section.path", "Path: {{path}}").replace("{{path}}", statusInfo.path)}
                </div>
              )}
            </div>
          )}

          <ToggleOption
            label={t("integrations_section.scan_on_startup", "Scan on startup")}
            description={t("integrations_section.scan_on_startup_desc", "Scan for this provider's games when LumaForge starts.")}
            enabled={settings.scanOnStartup}
            onChange={(v) => onPatch({ scanOnStartup: v })}
          />
          <ToggleOption
            label={t("integrations_section.background_scan", "Allow background scans")}
            description={t("integrations_section.background_scan_desc", "Allow periodic and idle background scans for this provider.")}
            enabled={settings.backgroundScan}
            onChange={(v) => onPatch({ backgroundScan: v })}
          />

          <div className="pt-2">
            <p className="text-xs font-medium text-(--color-text) mb-3">{t("integrations_section.ui_surfaces", "UI Surfaces")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_SURFACES.map((surface) => (
                <button
                  key={surface}
                  type="button"
                  onClick={() => {
                    const next = { ...settings.surfaces, [surface]: !settings.surfaces[surface] };
                    onPatch({ surfaces: next });
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                    settings.surfaces[surface]
                      ? "border-(--color-accent)/30 bg-(--color-accent)/10 text-(--color-accent)"
                      : "border-(--surface-active-border) bg-white/5 text-(--color-muted)"
                  }`}
                >
                  {SURFACE_ICONS[surface]}
                  {surface === "library" ? t("integrations_section.library", "Library") :
                   surface === "sidebar" ? t("integrations_section.sidebar", "Sidebar") :
                   surface === "home" ? t("integrations_section.home", "Home") :
                   surface === "console" ? t("integrations_section.console", "Console") :
                   surface === "store" ? t("integrations_section.store", "Store") :
                   surface === "search" ? t("integrations_section.search", "Search") :
                   SURFACE_LABELS[surface]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntegrationsSection() {
  const { t } = useTranslation();
  const [settings, setSettingsState] = useState(() => getIntegrationSettings());
  const [refreshState, setRefreshState] = useState<RefreshState>({});
  const refreshTimers = useRef<Map<IntegrationId, ReturnType<typeof setTimeout>>>(new Map());
  const [disableConfirmId, setDisableConfirmId] = useState<IntegrationId | null>(null);

  const handlePatch = useCallback((id: IntegrationId, patch: Partial<Omit<IntegrationSettings, "id" | "updatedAt">>) => {
    updateIntegrationSettings(id, patch);
    setSettingsState(getIntegrationSettings());
  }, []);

  const handleConfirmDisable = useCallback((id: IntegrationId) => {
    setDisableConfirmId(id);
  }, []);

  const handleExecuteDisable = useCallback(() => {
    if (disableConfirmId) {
      handlePatch(disableConfirmId, { enabled: false });
      setDisableConfirmId(null);
    }
  }, [disableConfirmId, handlePatch]);

  const handleRefresh = useCallback(async (id: IntegrationId) => {
    setRefreshState((prev) => ({ ...prev, [id]: "running" }));

    try {
      if (id === "steam") {
        const { scanSteamInstalledGames } = await import("../../services/tauri");
        const { loadSettings } = await import("../../context/SettingsContext");
        const s = loadSettings();
        if (s.steamRoot) {
          await scanSteamInstalledGames({ steamPath: s.steamRoot });
        }
      } else if (id === "epic") {
        const { refreshEpicGames } = await import("../../services/epicGameStore");
        await refreshEpicGames();
      } else if (id === "lua") {
        const { scanInstalledLuaScripts } = await import("../../services/tauri");
        const { loadSettings } = await import("../../context/SettingsContext");
        const s = loadSettings();
        if (s.luaPath) {
          await scanInstalledLuaScripts(s.luaPath);
        }
      } else if (id === "manual") {
        const { loadManualGamesFromJson } = await import("../../services/manualGameStore");
        await loadManualGamesFromJson();
      }

      setRefreshState((prev) => ({ ...prev, [id]: "success" }));

      const timer = setTimeout(() => {
        setRefreshState((prev) => ({ ...prev, [id]: "idle" }));
      }, 3000);
      refreshTimers.current.set(id, timer);
    } catch (err) {
      console.error(`[INTEGRATIONS][REFRESH] failed id=${id}`, err);
      setRefreshState((prev) => ({ ...prev, [id]: "error" }));
      const timer = setTimeout(() => {
        setRefreshState((prev) => ({ ...prev, [id]: "idle" }));
      }, 5000);
      refreshTimers.current.set(id, timer);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of refreshTimers.current.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {(["steam", "epic", "manual", "lua", "debrid"] as IntegrationId[]).map((id) => (
        <IntegrationCard
          key={id}
          integrationId={id}
          settings={settings.integrations[id]}
          onPatch={(patch) => handlePatch(id, patch)}
          refreshState={refreshState}
          onRefresh={handleRefresh}
          onConfirmDisable={handleConfirmDisable}
        />
      ))}

      {disableConfirmId && (
        <ConfirmModal
          open
          title={t(`integrations_section.disable_${disableConfirmId}_title`, DISABLE_CONFIRM[disableConfirmId].title)}
          description={t(`integrations_section.disable_${disableConfirmId}_desc`, DISABLE_CONFIRM[disableConfirmId].description)}
          confirmLabel={t("integrations_section.disable", "Disable")}
          variant="warning"
          icon={<AlertTriangle className="h-5 w-5" />}
          onConfirm={handleExecuteDisable}
          onCancel={() => setDisableConfirmId(null)}
        />
      )}
    </>
  );
}
