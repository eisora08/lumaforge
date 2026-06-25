import {
  CircleCheck,
  Clock,
  Download,
  Info,
} from "lucide-react";

const activities = [
  {
    title: "Sistema iniciado",
    description: "LumaForge está listo para detectar Steam.",
    icon: CircleCheck,
    color: "text-emerald-400",
  },
  {
    title: "Esperando API",
    description: "La conexión con el catálogo remoto aún no ha sido configurada.",
    icon: Download,
    color: "text-orange-400",
  },
  {
    title: "Sin instalaciones recientes",
    description: "Los paquetes instalados aparecerán en este historial.",
    icon: Clock,
    color: "text-gray-400",
  },
];

export default function ActivityFeed() {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#302b2f] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-white">Actividad reciente</h2>
        <Info className="h-4 w-4 text-gray-500" />
      </div>

      <div className="space-y-4">
        {activities.map((activity) => {
          const Icon = activity.icon;

          return (
            <div key={activity.title} className="flex gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.05]">
                <Icon className={`h-4 w-4 ${activity.color}`} />
              </div>

              <div>
                <h3 className="text-sm font-medium text-white">
                  {activity.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  {activity.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
