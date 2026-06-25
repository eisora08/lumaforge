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
      <h2 className="font-semibold mb-3">Paquetes recientes</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {recentPackages.map((item) => (
          <div
            key={item.name}
            className="h-32 rounded-2xl bg-[#302b2f] border border-white/10 p-5 flex flex-col justify-center"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center">
                <PackageOpen className="h-5 w-5 text-[#b8d7dc]" />
              </div>

              <div>
                <h3 className="font-semibold text-white">
                  {item.name}
                </h3>

                <p className="text-sm text-gray-400 mt-1">
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