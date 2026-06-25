import { Download, Gamepad2, Sparkles } from "lucide-react";

export default function HeroPanel() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-(--color-border) bg-linear-to-br from-(--color-surface) via-(--color-surface-soft) to-(--color-bg) p-7">
      <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-(--color-accent)/10 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl" />

      <div className="relative z-10 max-w-2xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
          <Sparkles className="h-3.5 w-3.5" />
          Premium Game Toolkit
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-(--color-text)">
          Gestiona tus juegos, paquetes Lua y manifests desde un solo lugar.
        </h1>

        <p className="mt-3 max-w-xl text-sm leading-6 text-(--color-muted)">
          Detecta Steam, instala paquetes desde API, administra descargas,
          revisa actividad y ejecuta tus juegos desde una interfaz moderna.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-3 text-sm font-medium text-black transition hover:opacity-90">
            <Download className="h-4 w-4" />
            Explorar paquetes
          </button>

          <button className="inline-flex items-center gap-2 rounded-xl border border-(--color-border) bg-white/6 px-5 py-3 text-sm text-(--color-text) transition hover:bg-white/10">
            <Gamepad2 className="h-4 w-4" />
            Ver biblioteca
          </button>
        </div>
      </div>
    </section>
  );
}