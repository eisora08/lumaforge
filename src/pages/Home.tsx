import ActivityFeed from "../components/dashboard/ActivityFeed";
import HeroPanel from "../components/dashboard/HeroPanel";
import LibraryPreview from "../components/dashboard/LibraryPreview";
import QuickActions from "../components/dashboard/QuickActions";
import RecentPackages from "../components/dashboard/RecentPackages";
import StatCard from "../components/dashboard/StatCard";
import SystemHealth from "../components/dashboard/SystemHealth";

export default function Home() {
  return (
    <div className="space-y-6 p-5 lg:p-7">
      <HeroPanel />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Juegos instalados"
          value={0}
          description="Detectados localmente"
        />

        <StatCard
          label="Luas instalados"
          value={0}
          description="Archivos en config/lua"
        />

        <StatCard
          label="Manifests"
          value={0}
          description="Archivos en depotcache"
        />

        <StatCard
          label="Descargas"
          value={0}
          description="En cola actualmente"
        />
      </section>

      <QuickActions />

      <section className="grid grid-cols-1 gap-5 2xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <LibraryPreview />
          <RecentPackages />
        </div>

        <div className="space-y-5">
          <SystemHealth />
          <ActivityFeed />
        </div>
      </section>
    </div>
  );
}