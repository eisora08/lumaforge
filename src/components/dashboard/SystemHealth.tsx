import {
  Database,
  Folder,
  HardDrive,
  Server,
} from "lucide-react";

const checks = [
  {
    label: "Steam",
    value: "No detectado",
    icon: HardDrive,
  },
  {
    label: "config/lua",
    value: "Pendiente",
    icon: Folder,
  },
  {
    label: "depotcache",
    value: "Pendiente",
    icon: Database,
  },
  {
    label: "API",
    value: "Sin verificar",
    icon: Server,
  },
];

export default function SystemHealth() {
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-surface) p-5">
      <h2 className="mb-4 font-semibold text-(--color-text)">
        Estado del sistema
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {checks.map((check) => {
          const Icon = check.icon;

          return (
            <div
              key={check.label}
              className="rounded-2xl border border-(--color-border) bg-white/4 p-4"
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