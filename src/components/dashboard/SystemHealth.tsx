import {
  Database,
  Folder,
  HardDrive,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export default function SystemHealth() {
  const { t } = useTranslation();

  const checks = [
    {
      label: "Steam",
      value: t("dashboard.system_health.not_detected", "No detectado"),
      icon: HardDrive,
    },
    {
      label: "config/lua",
      value: t("dashboard.system_health.pending", "Pendiente"),
      icon: Folder,
    },
    {
      label: "depotcache",
      value: t("dashboard.system_health.pending", "Pendiente"),
      icon: Database,
    },
    {
      label: "API",
      value: t("dashboard.system_health.unverified", "Sin verificar"),
      icon: Server,
    },
  ];
  return (
    <section className="rounded-2xl lf-surface border p-5">
      <h2 className="mb-4 font-semibold text-(--color-text)">
        {t("dashboard.system_health.title", "Estado del sistema")}
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {checks.map((check) => {
          const Icon = check.icon;

          return (
            <div
              key={check.label}
              className="rounded-2xl border border-(--surface-active-border) bg-white/4 p-4"
            >
              <Icon className="mb-3 h-5 w-5 text-(--color-accent)" />

              <p className="text-sm text-(--color-text)">
                {check.label}
              </p>

              <p className="mt-1 text-xs text-(--color-muted)">
                {check.value}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}