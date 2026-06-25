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
    <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
      <h2 className="mb-4 font-semibold text-white">Estado del sistema</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {checks.map((check) => {
          const Icon = check.icon;

          return (
            <div
              key={check.label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <Icon className="mb-3 h-5 w-5 text-[#b8d7dc]" />

              <p className="text-sm text-gray-300">{check.label}</p>
              <p className="mt-1 text-xs text-gray-500">{check.value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}