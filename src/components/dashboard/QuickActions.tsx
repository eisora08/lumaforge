import {
  Crosshair,
  FolderOpen,
  RefreshCcw,
  Search,
  Cloud,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export default function QuickActions() {
  const { t } = useTranslation();

  const actions = [
    {
      label: t("dashboard.quick_actions.detect_steam", "Detectar Steam"),
      description: t("dashboard.quick_actions.detect_steam_desc", "Buscar instalación y rutas necesarias"),
      icon: Crosshair,
      color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    },
    {
      label: t("dashboard.quick_actions.scan_lua", "Escanear Lua"),
      description: t("dashboard.quick_actions.scan_lua_desc", "Leer archivos en config/lua"),
      icon: Search,
      color: "bg-purple-500/10 text-purple-300 border-purple-500/20",
    },
    {
      label: t("dashboard.quick_actions.load_api", "Cargar API"),
      description: t("dashboard.quick_actions.load_api_desc", "Sincronizar catálogo remoto"),
      icon: Cloud,
      color: "bg-orange-500/10 text-orange-300 border-orange-500/20",
    },
    {
      label: t("dashboard.quick_actions.open_folders", "Abrir carpetas"),
      description: t("dashboard.quick_actions.open_folders_desc", "Lua, depotcache y temporales"),
      icon: FolderOpen,
      color: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-(--color-text)">
          {t("dashboard.quick_actions.section_title", "Acciones rápidas")}
        </h2>

        <button className="inline-flex items-center gap-2 text-xs text-(--color-muted) hover:text-(--color-text)">
          <RefreshCcw className="h-3.5 w-3.5" />
          {t("dashboard.quick_actions.refresh", "Actualizar")}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              className="group rounded-2xl lf-surface border p-4 text-left transition hover:bg-white/6"
            >
              <div
                className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border ${action.color}`}
              >
                <Icon className="h-5 w-5" />
              </div>

              <h3 className="font-medium text-(--color-text) group-hover:text-(--color-accent)">
                {action.label}
              </h3>

              <p className="mt-1 text-xs leading-5 text-(--color-muted)">
                {action.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}