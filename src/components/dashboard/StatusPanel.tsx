import {
  Folder,
  Database,
  Wifi,
  WifiOff,
  Crosshair,
} from "lucide-react";
import { useTranslation } from "react-i18next";

type StatusPanelProps = {
  steamRoot?: string;
  luaPath?: string;
  depotcachePath?: string;
  apiStatus?: "online" | "offline" | "unknown";
};

export default function StatusPanel({
  steamRoot,
  luaPath,
  depotcachePath,
  apiStatus = "unknown",
}: StatusPanelProps) {
  const { t } = useTranslation();

  const apiLabel = {
    online: t("dashboard.status_panel.connected", "Conectada"),
    offline: t("dashboard.status_panel.disconnected", "Desconectada"),
    unknown: t("dashboard.status_panel.unverified", "Sin verificar"),
  }[apiStatus];

  const ApiIcon = apiStatus === "online" ? Wifi : WifiOff;

  return (
    <section className="bg-[#302b2f] border border-white/10 rounded-2xl p-5 space-y-4">
      <StatusRow
        icon={Crosshair}
        label={t("dashboard.status_panel.steam_detected", "Steam detectado")}
        value={steamRoot || t("dashboard.status_panel.not_detected", "No detectado")}
      />

      <StatusRow
        icon={Folder}
        label={t("dashboard.status_panel.lua_folder", "Carpeta Lua")}
        value={luaPath || t("dashboard.status_panel.lua_not_found", "No detectada")}
      />

      <StatusRow
        icon={Database}
        label={t("dashboard.status_panel.depotcache", "Depotcache")}
        value={depotcachePath || t("dashboard.status_panel.not_detected", "No detectado")}
      />

      <div className="flex items-center gap-3">
        <ApiIcon className="h-5 w-5 text-[#b8d7dc]" />
        <p className="text-gray-200">
          {t("dashboard.status_panel.api", "API")}: <span className="text-gray-400">{apiLabel}</span>
        </p>
      </div>
    </section>
  );
}

type StatusRowProps = {
  icon: React.ElementType;
  label: string;
  value: string;
};

function StatusRow({ icon: Icon, label, value }: StatusRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 pb-4">
      <Icon className="h-5 w-5 text-[#b8d7dc]" />
      <p className="text-gray-200">
        {label}: <span className="text-gray-400">{value}</span>
      </p>
    </div>
  );
}