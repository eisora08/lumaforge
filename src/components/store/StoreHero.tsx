import { Sparkles, Store, Zap } from "lucide-react";

type StoreHeroProps = {
  totalResults: number;
  availableSources: number;
  installedCount: number;
};

export default function StoreHero({
  totalResults,
  availableSources,
  installedCount,
}: StoreHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-(--color-accent)/20 via-white/5 to-black/40 p-6 lg:p-8">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-(--color-accent)/20 blur-3xl" />
      <div className="absolute -bottom-20 left-1/3 h-52 w-52 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="relative z-10 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px] xl:items-end">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <Store className="h-3.5 w-3.5" />
            LumaForge Store
          </div>

          <h1 className="max-w-3xl text-4xl font-black tracking-tight text-(--color-text)">
            Busca juegos, revisa providers y descarga Lua/manifests desde un solo lugar.
          </h1>

          <p className="mt-3 max-w-2xl text-sm text-(--color-muted)">
            Explora juegos compatibles, revisa fuentes disponibles y prepara tu biblioteca Lua con una experiencia más parecida a un launcher.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <HeroPill icon={Sparkles} label="Steam metadata" />
            <HeroPill icon={Zap} label="Provider support" />
            <HeroPill icon={Store} label="Lua-ready games" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <HeroStat label="Games" value={totalResults} />
          <HeroStat label="Sources" value={availableSources} />
          <HeroStat label="Installed" value={installedCount} />
        </div>
      </div>
    </section>
  );
}

type HeroPillProps = {
  icon: React.ElementType;
  label: string;
};

function HeroPill({ icon: Icon, label }: HeroPillProps) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-(--surface-active-border) bg-black/20 px-3 py-1.5 text-xs text-(--color-text)">
      <Icon className="h-3.5 w-3.5 text-(--color-accent)" />
      {label}
    </span>
  );
}

type HeroStatProps = {
  label: string;
  value: number;
};

function HeroStat({ label, value }: HeroStatProps) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/25 p-4">
      <p className="text-xs text-(--color-muted)">
        {label}
      </p>

      <p className="mt-1 text-2xl font-bold text-(--color-text)">
        {value}
      </p>
    </div>
  );
}