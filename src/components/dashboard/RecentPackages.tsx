import { PackageOpen } from "lucide-react";

const recentPackages = [
  {
    name: "Sin paquetes instalados",
    description: "Cuando instales algo, aparecerá aquí.",
  },
];

export default function RecentPackages() {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-(--color-text)">
        Paquetes recientes
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {recentPackages.map((item) => (
          <div
            key={item.name}
            className="flex h-32 flex-col justify-center rounded-2xl border border-(--color-border) bg-(--color-surface) p-5"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
                <PackageOpen className="h-5 w-5 text-(--color-accent)" />
              </div>

              <div>
                <h3 className="font-semibold text-(--color-text)">
                  {item.name}
                </h3>

                <p className="mt-1 text-sm text-(--color-muted)">
                  {item.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}